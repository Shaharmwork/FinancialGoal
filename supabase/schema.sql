create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  id text primary key default 'default',
  user_id uuid not null,
  target_net_month numeric not null default 0,
  weekly_hours_target numeric not null default 0,
  default_shift_income numeric not null default 0,
  default_shift_hours numeric not null default 0,
  spouse_monthly_income numeric not null default 0,
  reserve_buffer_percent numeric not null default 0,
  qualifies_for_self_employed_deduction boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.daily_entries (
  id text primary key,
  user_id uuid not null,
  date text not null,
  hours numeric not null default 0,
  invoiced_income numeric not null default 0,
  paid_income numeric not null default 0,
  expenses numeric not null default 0,
  source text,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  month_key text not null unique,
  hours numeric not null default 0,
  invoiced_income numeric not null default 0,
  paid_income numeric not null default 0,
  expenses numeric not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row
execute function public.set_updated_at();

drop trigger if exists daily_entries_set_updated_at on public.daily_entries;
create trigger daily_entries_set_updated_at
before update on public.daily_entries
for each row
execute function public.set_updated_at();

drop trigger if exists monthly_summaries_set_updated_at on public.monthly_summaries;
create trigger monthly_summaries_set_updated_at
before update on public.monthly_summaries
for each row
execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.daily_entries enable row level security;
alter table public.monthly_summaries enable row level security;

drop policy if exists "app_settings_select_own" on public.app_settings;
drop policy if exists "app_settings_insert_own" on public.app_settings;
drop policy if exists "app_settings_update_own" on public.app_settings;
drop policy if exists "app_settings_delete_own" on public.app_settings;

drop policy if exists "daily_entries_select_own" on public.daily_entries;
drop policy if exists "daily_entries_insert_own" on public.daily_entries;
drop policy if exists "daily_entries_update_own" on public.daily_entries;
drop policy if exists "daily_entries_delete_own" on public.daily_entries;

drop policy if exists "monthly_summaries_select_own" on public.monthly_summaries;
drop policy if exists "monthly_summaries_insert_own" on public.monthly_summaries;
drop policy if exists "monthly_summaries_update_own" on public.monthly_summaries;
drop policy if exists "monthly_summaries_delete_own" on public.monthly_summaries;

create policy "app_settings_select_own"
on public.app_settings
for select
to authenticated
using (auth.uid() = user_id);

create policy "app_settings_insert_own"
on public.app_settings
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "app_settings_update_own"
on public.app_settings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "app_settings_delete_own"
on public.app_settings
for delete
to authenticated
using (auth.uid() = user_id);

create policy "daily_entries_select_own"
on public.daily_entries
for select
to authenticated
using (auth.uid() = user_id);

create policy "daily_entries_insert_own"
on public.daily_entries
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "daily_entries_update_own"
on public.daily_entries
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "daily_entries_delete_own"
on public.daily_entries
for delete
to authenticated
using (auth.uid() = user_id);

create policy "monthly_summaries_select_own"
on public.monthly_summaries
for select
to authenticated
using (auth.uid() = user_id);

create policy "monthly_summaries_insert_own"
on public.monthly_summaries
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "monthly_summaries_update_own"
on public.monthly_summaries
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "monthly_summaries_delete_own"
on public.monthly_summaries
for delete
to authenticated
using (auth.uid() = user_id);
