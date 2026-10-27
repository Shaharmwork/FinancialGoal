-- FinancialGoal: safe saving across devices.
--
-- Every save goes through a function that checks the row's version (updated_at)
-- and applies the change in one transaction. A stale device gets a "conflict"
-- answer instead of overwriting newer data, and nothing is ever deleted unless the
-- user deleted that specific record.
--
-- Retries are idempotent: each save carries a client-generated mutation id. If a
-- save committed but the response was lost, retrying the same mutation returns
-- the stored result instead of a conflict or a duplicate.
--
-- All functions run as the calling user (security invoker), so the existing
-- row-level security policies still apply.

-- 1. Pricing mode: null = saved before this migration (mode unknown),
--    'hourly' = hours x hourly_rate, 'fixed' = invoiced_income was entered as a total.
alter table public.daily_entries
  add column if not exists hourly_rate numeric,
  add column if not exists pricing_mode text,
  add column if not exists last_mutation_id uuid;

alter table public.daily_entries
  drop constraint if exists daily_entries_pricing_mode_check;
alter table public.daily_entries
  add constraint daily_entries_pricing_mode_check
  check (pricing_mode is null or pricing_mode in ('hourly', 'fixed'));

-- One row per user per day, so two devices can't both create the same day.
-- (Checked before writing this migration: no duplicate days exist.)
alter table public.daily_entries
  drop constraint if exists daily_entries_user_id_date_key;
alter table public.daily_entries
  add constraint daily_entries_user_id_date_key unique (user_id, date);

alter table public.daily_entry_work_items
  add column if not exists pricing_mode text;

alter table public.daily_entry_work_items
  drop constraint if exists daily_entry_work_items_pricing_mode_check;
alter table public.daily_entry_work_items
  add constraint daily_entry_work_items_pricing_mode_check
  check (pricing_mode is null or pricing_mode in ('hourly', 'fixed'));

alter table public.monthly_summaries
  add column if not exists last_mutation_id uuid;

alter table public.app_settings
  add column if not exists last_mutation_id uuid;

-- updated_at is the version that saves are checked against, so every change must
-- get a distinct value. now() is the transaction's start time; clock_timestamp()
-- is the actual time of the change.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

-- 2. Daily entries ------------------------------------------------------------

create or replace function public.daily_entry_result(p_entry public.daily_entries)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'status', 'saved',
    'entry', to_jsonb(p_entry),
    'work_items', coalesce(
      (select jsonb_agg(to_jsonb(w) order by w.line_index)
         from public.daily_entry_work_items w
        where w.daily_entry_id = p_entry.id),
      '[]'::jsonb
    )
  );
$$;

-- p_expected_updated_at: the version this device loaded, or null for a new day.
create or replace function public.save_daily_entry(
  p_entry jsonb,
  p_work_items jsonb,
  p_expected_updated_at timestamptz,
  p_mutation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.daily_entries;
  v_row public.daily_entries;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  -- Lock the day (by id, or by date for a day created elsewhere) so concurrent
  -- saves of the same day run one after the other.
  select * into v_existing
    from public.daily_entries
   where user_id = v_user_id
     and (id = p_entry->>'id' or date = p_entry->>'date')
   order by (id = p_entry->>'id') desc
   limit 1
   for update;

  -- A retry of a save that already committed: return the stored result.
  if found and v_existing.last_mutation_id = p_mutation_id then
    return public.daily_entry_result(v_existing);
  end if;

  if p_expected_updated_at is null then
    if found then
      return jsonb_build_object('status', 'conflict', 'reason', 'exists',
        'current_updated_at', v_existing.updated_at);
    end if;

    begin
      insert into public.daily_entries (
        id, user_id, date, day_status, hours, hourly_rate, pricing_mode,
        invoiced_income, paid_income, expenses, note, source, last_mutation_id
      ) values (
        p_entry->>'id', v_user_id, p_entry->>'date',
        coalesce(p_entry->>'day_status', 'worked'),
        coalesce((p_entry->>'hours')::numeric, 0),
        (p_entry->>'hourly_rate')::numeric,
        p_entry->>'pricing_mode',
        coalesce((p_entry->>'invoiced_income')::numeric, 0),
        coalesce((p_entry->>'invoiced_income')::numeric, 0),
        coalesce((p_entry->>'expenses')::numeric, 0),
        p_entry->>'note', p_entry->>'source', p_mutation_id
      )
      returning * into v_row;
    exception when unique_violation then
      -- Another device created this day at the same moment.
      return jsonb_build_object('status', 'conflict', 'reason', 'exists');
    end;
  else
    if not found or v_existing.id <> p_entry->>'id' then
      return jsonb_build_object('status', 'conflict', 'reason', 'deleted');
    end if;

    if v_existing.updated_at <> p_expected_updated_at then
      return jsonb_build_object('status', 'conflict', 'reason', 'changed',
        'current_updated_at', v_existing.updated_at);
    end if;

    update public.daily_entries set
      day_status = coalesce(p_entry->>'day_status', 'worked'),
      hours = coalesce((p_entry->>'hours')::numeric, 0),
      hourly_rate = (p_entry->>'hourly_rate')::numeric,
      pricing_mode = p_entry->>'pricing_mode',
      invoiced_income = coalesce((p_entry->>'invoiced_income')::numeric, 0),
      paid_income = coalesce((p_entry->>'invoiced_income')::numeric, 0),
      expenses = coalesce((p_entry->>'expenses')::numeric, 0),
      note = p_entry->>'note',
      source = p_entry->>'source',
      last_mutation_id = p_mutation_id
    where id = v_existing.id
    returning * into v_row;
  end if;

  -- Work items are replaced inside the same transaction: either all of the day's
  -- changes are stored, or none are.
  delete from public.daily_entry_work_items where daily_entry_id = v_row.id;

  insert into public.daily_entry_work_items (
    daily_entry_id, project_name, hours, hourly_rate, invoiced_income, line_index, pricing_mode
  )
  select v_row.id, item.project_name, coalesce(item.hours, 0), item.hourly_rate,
         coalesce(item.invoiced_income, 0), coalesce(item.line_index, 0), item.pricing_mode
    from jsonb_to_recordset(coalesce(p_work_items, '[]'::jsonb)) as item(
      project_name text, hours numeric, hourly_rate numeric,
      invoiced_income numeric, line_index integer, pricing_mode text
    );

  return public.daily_entry_result(v_row);
end;
$$;

create or replace function public.delete_daily_entry(
  p_id text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.daily_entries;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_existing
    from public.daily_entries
   where id = p_id and user_id = v_user_id
   for update;

  -- Already gone (deleted elsewhere, or a retry after a lost response).
  if not found then
    return jsonb_build_object('status', 'deleted');
  end if;

  if v_existing.updated_at <> p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'reason', 'changed',
      'current_updated_at', v_existing.updated_at);
  end if;

  -- Work items go with it (on delete cascade), in the same transaction.
  delete from public.daily_entries where id = p_id;
  return jsonb_build_object('status', 'deleted');
end;
$$;

-- 3. Monthly summaries (one per user per month) -------------------------------

create or replace function public.save_monthly_summary(
  p_summary jsonb,
  p_expected_updated_at timestamptz,
  p_mutation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.monthly_summaries;
  v_row public.monthly_summaries;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_existing
    from public.monthly_summaries
   where user_id = v_user_id and month_key = p_summary->>'month_key'
   for update;

  if found and v_existing.last_mutation_id = p_mutation_id then
    return jsonb_build_object('status', 'saved', 'summary', to_jsonb(v_existing));
  end if;

  if p_expected_updated_at is null then
    if found then
      return jsonb_build_object('status', 'conflict', 'reason', 'exists',
        'current_updated_at', v_existing.updated_at);
    end if;

    begin
      insert into public.monthly_summaries (
        user_id, month_key, month_type, hours, invoiced_income, paid_income, expenses,
        gross_salary, net_salary_received, tax_already_withheld, work_lines, last_mutation_id
      ) values (
        v_user_id, p_summary->>'month_key',
        coalesce(p_summary->>'month_type', 'business'),
        (p_summary->>'hours')::numeric,
        (p_summary->>'invoiced_income')::numeric,
        (p_summary->>'invoiced_income')::numeric,
        (p_summary->>'expenses')::numeric,
        (p_summary->>'gross_salary')::numeric,
        (p_summary->>'net_salary_received')::numeric,
        (p_summary->>'tax_already_withheld')::numeric,
        case when jsonb_typeof(p_summary->'work_lines') = 'array' then p_summary->'work_lines' end,
        p_mutation_id
      )
      returning * into v_row;
    exception when unique_violation then
      return jsonb_build_object('status', 'conflict', 'reason', 'exists');
    end;
  else
    if not found then
      return jsonb_build_object('status', 'conflict', 'reason', 'deleted');
    end if;

    if v_existing.updated_at <> p_expected_updated_at then
      return jsonb_build_object('status', 'conflict', 'reason', 'changed',
        'current_updated_at', v_existing.updated_at);
    end if;

    update public.monthly_summaries set
      month_type = coalesce(p_summary->>'month_type', 'business'),
      hours = (p_summary->>'hours')::numeric,
      invoiced_income = (p_summary->>'invoiced_income')::numeric,
      paid_income = (p_summary->>'invoiced_income')::numeric,
      expenses = (p_summary->>'expenses')::numeric,
      gross_salary = (p_summary->>'gross_salary')::numeric,
      net_salary_received = (p_summary->>'net_salary_received')::numeric,
      tax_already_withheld = (p_summary->>'tax_already_withheld')::numeric,
      work_lines = case when jsonb_typeof(p_summary->'work_lines') = 'array'
                        then p_summary->'work_lines' end,
      last_mutation_id = p_mutation_id
    where id = v_existing.id
    returning * into v_row;
  end if;

  return jsonb_build_object('status', 'saved', 'summary', to_jsonb(v_row));
end;
$$;

create or replace function public.delete_monthly_summary(
  p_month_key text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.monthly_summaries;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_existing
    from public.monthly_summaries
   where user_id = v_user_id and month_key = p_month_key
   for update;

  if not found then
    return jsonb_build_object('status', 'deleted');
  end if;

  if v_existing.updated_at <> p_expected_updated_at then
    return jsonb_build_object('status', 'conflict', 'reason', 'changed',
      'current_updated_at', v_existing.updated_at);
  end if;

  delete from public.monthly_summaries where id = v_existing.id;
  return jsonb_build_object('status', 'deleted');
end;
$$;

-- 4. Settings (one row per user) ------------------------------------------------

create or replace function public.save_settings(
  p_settings jsonb,
  p_expected_updated_at timestamptz,
  p_mutation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.app_settings;
  v_row public.app_settings;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select * into v_existing
    from public.app_settings
   where user_id = v_user_id
   for update;

  if found and v_existing.last_mutation_id = p_mutation_id then
    return jsonb_build_object('status', 'saved', 'settings', to_jsonb(v_existing));
  end if;

  if p_expected_updated_at is null then
    if found then
      return jsonb_build_object('status', 'conflict', 'reason', 'exists',
        'current_updated_at', v_existing.updated_at);
    end if;

    begin
      insert into public.app_settings (
        user_id, target_net_month, weekly_hours_target, default_shift_income,
        default_shift_hours, spouse_monthly_income, reserve_buffer_percent,
        qualifies_for_self_employed_deduction, qualifies_for_starters_deduction,
        vacation_days_per_year, last_mutation_id
      ) values (
        v_user_id,
        coalesce((p_settings->>'target_net_month')::numeric, 0),
        coalesce((p_settings->>'weekly_hours_target')::numeric, 0),
        coalesce((p_settings->>'default_shift_income')::numeric, 0),
        coalesce((p_settings->>'default_shift_hours')::numeric, 0),
        coalesce((p_settings->>'spouse_monthly_income')::numeric, 0),
        coalesce((p_settings->>'reserve_buffer_percent')::numeric, 0),
        coalesce((p_settings->>'qualifies_for_self_employed_deduction')::boolean, false),
        (p_settings->>'qualifies_for_starters_deduction')::boolean,
        (p_settings->>'vacation_days_per_year')::numeric,
        p_mutation_id
      )
      returning * into v_row;
    exception when unique_violation then
      return jsonb_build_object('status', 'conflict', 'reason', 'exists');
    end;
  else
    if not found then
      return jsonb_build_object('status', 'conflict', 'reason', 'deleted');
    end if;

    if v_existing.updated_at <> p_expected_updated_at then
      return jsonb_build_object('status', 'conflict', 'reason', 'changed',
        'current_updated_at', v_existing.updated_at);
    end if;

    update public.app_settings set
      target_net_month = coalesce((p_settings->>'target_net_month')::numeric, 0),
      weekly_hours_target = coalesce((p_settings->>'weekly_hours_target')::numeric, 0),
      default_shift_income = coalesce((p_settings->>'default_shift_income')::numeric, 0),
      default_shift_hours = coalesce((p_settings->>'default_shift_hours')::numeric, 0),
      spouse_monthly_income = coalesce((p_settings->>'spouse_monthly_income')::numeric, 0),
      reserve_buffer_percent = coalesce((p_settings->>'reserve_buffer_percent')::numeric, 0),
      qualifies_for_self_employed_deduction =
        coalesce((p_settings->>'qualifies_for_self_employed_deduction')::boolean, false),
      qualifies_for_starters_deduction = (p_settings->>'qualifies_for_starters_deduction')::boolean,
      vacation_days_per_year = (p_settings->>'vacation_days_per_year')::numeric,
      last_mutation_id = p_mutation_id
    where user_id = v_user_id
    returning * into v_row;
  end if;

  return jsonb_build_object('status', 'saved', 'settings', to_jsonb(v_row));
end;
$$;

-- 5. Only signed-in users may call the functions.
revoke all on function public.daily_entry_result(public.daily_entries) from public;
revoke all on function public.save_daily_entry(jsonb, jsonb, timestamptz, uuid) from public;
revoke all on function public.delete_daily_entry(text, timestamptz) from public;
revoke all on function public.save_monthly_summary(jsonb, timestamptz, uuid) from public;
revoke all on function public.delete_monthly_summary(text, timestamptz) from public;
revoke all on function public.save_settings(jsonb, timestamptz, uuid) from public;

grant execute on function public.daily_entry_result(public.daily_entries) to authenticated;
grant execute on function public.save_daily_entry(jsonb, jsonb, timestamptz, uuid) to authenticated;
grant execute on function public.delete_daily_entry(text, timestamptz) to authenticated;
grant execute on function public.save_monthly_summary(jsonb, timestamptz, uuid) to authenticated;
grant execute on function public.delete_monthly_summary(text, timestamptz) to authenticated;
grant execute on function public.save_settings(jsonb, timestamptz, uuid) to authenticated;
