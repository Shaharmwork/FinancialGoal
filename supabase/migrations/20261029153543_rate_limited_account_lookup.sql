-- Deliberate product choice: reveal only account existence to signed-out users.
-- All callers share a database-enforced budget: 30/minute and 300/hour.
-- This is an enumeration safeguard, not a per-user/IP limit or DDoS protection.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.account_lookup_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  minute_started_at timestamptz NOT NULL DEFAULT '-infinity',
  minute_count integer NOT NULL DEFAULT 0 CHECK (minute_count >= 0),
  hour_started_at timestamptz NOT NULL DEFAULT '-infinity',
  hour_count integer NOT NULL DEFAULT 0 CHECK (hour_count >= 0)
);
ALTER TABLE private.account_lookup_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.account_lookup_budget FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private.account_lookup_budget (singleton) VALUES (true);

-- SECURITY DEFINER is intentional: anonymous callers may perform this single
-- bounded operation, but must never receive SELECT access to auth.users.
-- No user ID is required because this endpoint supports users before sign-in.
CREATE FUNCTION public.check_account_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
SET statement_timeout = '3s'
AS $function$
DECLARE
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  budget private.account_lookup_budget%ROWTYPE;
  checked_at timestamptz;
  retry_after integer := 0;
  account_exists boolean;
BEGIN
  IF normalized_email IS NULL OR pg_catalog.length(normalized_email) > 254
     OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_email');
  END IF;

  -- Serialize counting and lookup in one transaction. Counters survive browser
  -- reloads, concurrent requests, role changes, and service restarts.
  SELECT * INTO STRICT budget
  FROM private.account_lookup_budget WHERE singleton = true FOR UPDATE;
  checked_at := pg_catalog.clock_timestamp();

  IF checked_at >= budget.minute_started_at + interval '1 minute' THEN
    budget.minute_started_at := checked_at;
    budget.minute_count := 0;
  END IF;
  IF checked_at >= budget.hour_started_at + interval '1 hour' THEN
    budget.hour_started_at := checked_at;
    budget.hour_count := 0;
  END IF;

  IF budget.minute_count >= 30 THEN
    retry_after := greatest(1, ceil(extract(epoch FROM budget.minute_started_at + interval '1 minute' - checked_at))::integer);
  END IF;
  IF budget.hour_count >= 300 THEN
    retry_after := greatest(retry_after, 1, ceil(extract(epoch FROM budget.hour_started_at + interval '1 hour' - checked_at))::integer);
  END IF;
  IF retry_after > 0 THEN
    -- Return instead of raising: no existence result is leaked on throttling.
    RETURN pg_catalog.jsonb_build_object('status', 'rate_limited', 'retry_after', retry_after);
  END IF;

  UPDATE private.account_lookup_budget
  SET minute_started_at = budget.minute_started_at, minute_count = budget.minute_count + 1,
      hour_started_at = budget.hour_started_at, hour_count = budget.hour_count + 1
  WHERE singleton = true;

  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE pg_catalog.lower(u.email) = normalized_email
      AND u.deleted_at IS NULL
      AND u.is_anonymous IS NOT TRUE
  ) INTO account_exists;
  RETURN pg_catalog.jsonb_build_object('status', 'ok', 'exists', account_exists);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_account_email(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_account_email(text) TO anon, authenticated;
COMMENT ON FUNCTION public.check_account_email(text) IS
  'Intentional anonymous account-existence check; global 30/min and 300/hour budget; returns no account data.';
NOTIFY pgrst, 'reload schema';
