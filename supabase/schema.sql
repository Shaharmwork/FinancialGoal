create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  user_id uuid primary key,
  target_net_month numeric not null default 0,
  weekly_hours_target numeric not null default 0,
  default_shift_income numeric not null default 0,
  default_shift_hours numeric not null default 0,
  spouse_monthly_income numeric not null default 0,
  reserve_buffer_percent numeric not null default 0,
  qualifies_for_self_employed_deduction boolean not null default false,
  vacation_days_per_year numeric,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.app_settings
  add column if not exists vacation_days_per_year numeric;

create table if not exists public.daily_entries (
  id text primary key,
  user_id uuid not null,
  date text not null,
  day_status text not null default 'worked',
  hours numeric not null default 0,
  invoiced_income numeric not null default 0,
  paid_income numeric not null default 0,
  expenses numeric not null default 0,
  source text,
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.daily_entries
  drop constraint if exists daily_entries_day_status_check;

alter table public.daily_entries
  add constraint daily_entries_day_status_check
  check (day_status in ('worked', 'no_work', 'vacation'));

create table if not exists public.monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  month_key text not null,
  month_type text not null default 'business',
  hours numeric,
  invoiced_income numeric,
  paid_income numeric,
  expenses numeric,
  gross_salary numeric,
  net_salary_received numeric,
  tax_already_withheld numeric,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, month_key)
);

alter table public.monthly_summaries
  add column if not exists month_type text not null default 'business',
  add column if not exists gross_salary numeric,
  add column if not exists net_salary_received numeric,
  add column if not exists tax_already_withheld numeric;

alter table public.monthly_summaries
  alter column hours drop not null,
  alter column invoiced_income drop not null,
  alter column paid_income drop not null,
  alter column expenses drop not null;

alter table public.monthly_summaries
  drop constraint if exists monthly_summaries_month_type_check;

alter table public.monthly_summaries
  add constraint monthly_summaries_month_type_check
  check (month_type in ('business', 'employment'));

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
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

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.daily_entries enable row level security;
alter table public.monthly_summaries enable row level security;

alter table public.profiles enable row level security;

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

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

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

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "profiles_delete_own"
on public.profiles
for delete
to authenticated
using (auth.uid() = id);
