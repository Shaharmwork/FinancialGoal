-- Supabase default privileges may grant anon separately from PUBLIC.
-- Annual settings and holiday approval are authenticated operations only.
revoke all on function public.save_year_settings(integer,jsonb,timestamptz,uuid) from anon;
revoke all on function public.dutch_holiday_dates(integer) from anon;
