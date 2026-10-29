-- Only abandoned email/password signups. Never expose this maintenance function as an RPC.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.cleanup_abandoned_registrations()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '2s'
SET statement_timeout = '15s'
AS $cleanup$
DECLARE
  candidate_ids uuid[];
  deleted_count integer;
BEGIN
  -- These app tables do not all have auth.users foreign keys. Briefly block writes
  -- while checking and deleting, so a concurrent insert cannot race the no-data check.
  -- A busy table aborts this run after 2s; the next daily run retries.
  LOCK TABLE public.profiles, public.app_settings, public.daily_entries,
    public.monthly_summaries, storage.objects, storage.buckets IN SHARE MODE;

  SELECT array_agg(candidate.id) INTO candidate_ids
  FROM (
    SELECT u.id
    FROM auth.users u
    WHERE u.email IS NOT NULL
      AND u.email_confirmed_at IS NULL
      AND u.phone_confirmed_at IS NULL
      AND u.confirmed_at IS NULL
      AND u.last_sign_in_at IS NULL
      AND u.invited_at IS NULL
      AND u.deleted_at IS NULL
      AND u.is_anonymous IS NOT TRUE
      AND u.is_sso_user IS NOT TRUE
      AND u.created_at < now() - interval '7 days'
      AND greatest(u.created_at, u.confirmation_sent_at, u.updated_at) < now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email')
      AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider <> 'email')
      AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors m WHERE m.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.app_settings s WHERE s.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.daily_entries d WHERE d.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.monthly_summaries m WHERE m.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.owner = u.id OR o.owner_id = u.id::text)
      AND NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.owner = u.id OR b.owner_id = u.id::text)
    ORDER BY u.created_at, u.id
    LIMIT 200
    -- Confirmation/sign-in updates lock this same row. Skip an in-flight account.
    FOR UPDATE OF u SKIP LOCKED
  ) candidate;

  DELETE FROM auth.users WHERE id = ANY(candidate_ids);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$cleanup$;
REVOKE ALL ON FUNCTION private.cleanup_abandoned_registrations() FROM PUBLIC, anon, authenticated, service_role;

-- SCHEDULER: production only; the function above is tested in local Postgres.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'financialgoal-cleanup-abandoned-registrations',
  '17 3 * * *',
  $job$SET statement_timeout = '15s'; SELECT private.cleanup_abandoned_registrations();$job$
);
