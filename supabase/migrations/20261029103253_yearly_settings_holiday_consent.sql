-- Annual plans live in the existing owner-protected settings row. Legacy values
-- remain assigned to 2026; nothing is silently copied or opted in.
alter table public.app_settings add column if not exists legacy_year integer not null default 2026;
alter table public.app_settings add column if not exists yearly_settings jsonb not null default '{}'::jsonb;
alter table public.app_settings add constraint app_settings_yearly_object check (jsonb_typeof(yearly_settings) = 'object');

-- Same Gregorian holiday calendar as the client. Only weekdays count as days off.
create or replace function public.dutch_holiday_dates(p_year integer)
returns setof date language plpgsql immutable security invoker set search_path = '' as $$
declare
 a integer; b integer; c integer; d integer; e integer; f integer; g integer;
 h integer; i integer; k integer; l integer; m integer; em integer; ed integer; easter date;
begin
 if p_year is null or p_year < 1900 or p_year > 2200 then raise exception 'Invalid holiday year'; end if;
 a:=p_year%19; b:=p_year/100; c:=p_year%100; d:=b/4; e:=b%4;
 f:=(b+8)/25; g:=(b-f+1)/3; h:=(19*a+b-d-g+15)%30;
 i:=c/4; k:=c%4; l:=(32+2*e+2*i-h-k)%7; m:=(a+11*h+22*l)/451;
 em:=(h+l-7*m+114)/31; ed:=(h+l-7*m+114)%31+1; easter:=make_date(p_year,em,ed);
 return query select distinct holiday from unnest(array[
   make_date(p_year,1,1), easter-2, easter+1,
   make_date(p_year,4,27) - case when extract(isodow from make_date(p_year,4,27))=7 then 1 else 0 end,
   make_date(p_year,5,5), easter+39, easter+50,
   make_date(p_year,12,25), make_date(p_year,12,26)
 ]) holiday where extract(isodow from holiday) <= 5 order by holiday;
end $$;

create or replace function public.save_year_settings(
 p_year integer, p_settings jsonb, p_expected_updated_at timestamptz, p_mutation_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 v_user uuid := auth.uid();
 v_row public.app_settings;
 v_old jsonb;
 v_config jsonb;
 v_old_enabled boolean;
 v_enabled boolean;
 v_count integer;
 v_day date;
 v_key text;
begin
 if v_user is null then raise exception 'Not signed in' using errcode='28000'; end if;
 if p_year is null or p_year < 1900 or p_year > extract(year from current_date)::integer + 1 or p_mutation_id is null then
   raise exception 'Invalid configuration year or mutation';
 end if;
 if jsonb_typeof(p_settings) <> 'object' or p_settings is null then raise exception 'Invalid settings'; end if;
 foreach v_key in array array['targetNetMonth','weeklyHoursTarget','defaultShiftIncome','defaultShiftHours',
   'spouseMonthlyIncome','reserveBufferPercent','vacationDaysPerYear'] loop
   if p_settings->>v_key is not null and (
     jsonb_typeof(p_settings->v_key) <> 'number' or (p_settings->>v_key)::numeric < 0
   ) then raise exception 'Invalid numeric setting: %',v_key; end if;
 end loop;
 select * into v_row from public.app_settings where user_id=v_user for update;
 if found and v_row.last_mutation_id=p_mutation_id then
   return jsonb_build_object('status','saved','settings',to_jsonb(v_row));
 end if;
 if p_expected_updated_at is null then
   if found then return jsonb_build_object('status','conflict','reason','exists'); end if;
   begin
     insert into public.app_settings(user_id) values(v_user) returning * into v_row;
   exception when unique_violation then
     return jsonb_build_object('status','conflict','reason','exists');
   end;
 else
   if not found then return jsonb_build_object('status','conflict','reason','deleted'); end if;
   if v_row.updated_at <> p_expected_updated_at then
     return jsonb_build_object('status','conflict','reason','changed','current_updated_at',v_row.updated_at);
   end if;
 end if;

 v_old:=coalesce(v_row.yearly_settings->p_year::text,'{}'::jsonb);
 v_old_enabled:=coalesce((v_old->>'dutchHolidaysEnabled')::boolean,false);
 v_enabled:=coalesce((p_settings->>'dutchHolidaysEnabled')::boolean,false);
 select count(*) into v_count from public.dutch_holiday_dates(p_year);
 v_config:=(p_settings - 'updatedAt' - 'year' - 'yearlySettings') ||
   jsonb_build_object('dutchHolidaysEnabled',v_enabled,'holidayDaysAdded',case when v_enabled then v_count else 0 end);

 if v_enabled and not v_old_enabled then
   -- One-time fill. Existing days, expenses, work lines and user vacation always win.
   for v_day in select public.dutch_holiday_dates(p_year) loop
     insert into public.daily_entries(id,user_id,date,day_status,hours,invoiced_income,expenses,source,note)
     values(gen_random_uuid()::text,v_user,v_day::text,'vacation',0,0,0,
       'dutch-holiday','Dutch public holiday (approved for '||p_year||')')
     on conflict(user_id,date) do nothing;
   end loop;
 elsif v_old_enabled and not v_enabled then
   -- Only untouched marks belonging to this feature and year can be removed.
   delete from public.daily_entries d
    where d.user_id=v_user and d.date >= p_year::text||'-01-01'
      and d.date < (p_year+1)::text||'-01-01'
      and d.source='dutch-holiday' and d.day_status='vacation'
      and d.hours=0 and d.invoiced_income=0 and d.expenses=0
      and not exists(select 1 from public.daily_entry_work_items w where w.daily_entry_id=d.id);
 end if;
 update public.app_settings set
   yearly_settings=jsonb_set(yearly_settings,array[p_year::text],v_config,true),
   last_mutation_id=p_mutation_id
 where user_id=v_user returning * into v_row;
 return jsonb_build_object('status','saved','settings',to_jsonb(v_row));
end $$;
revoke all on function public.dutch_holiday_dates(integer) from public;
revoke all on function public.save_year_settings(integer,jsonb,timestamptz,uuid) from public;
grant execute on function public.dutch_holiday_dates(integer) to authenticated;
grant execute on function public.save_year_settings(integer,jsonb,timestamptz,uuid) to authenticated;

-- Preserve manual edits when holiday approval is later disabled.
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
      source = case when v_existing.source = 'dutch-holiday' then null else p_entry->>'source' end,
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

-- Old tabs must not silently save into the obsolete single-year configuration.
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

  if found and v_existing.yearly_settings <> '{}'::jsonb then
    raise exception 'Refresh the app to use year-specific configuration.';
  end if;

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
