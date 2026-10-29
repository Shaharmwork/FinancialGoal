-- Owner notifications are polled outside the Auth transaction: mail failures cannot break signup.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.registration_alert_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.registration_alert_settings DEFAULT VALUES;
CREATE TABLE private.registration_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'registration' CHECK (kind IN ('registration', 'test')),
  email text NOT NULL,
  display_name text,
  registered_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  error_code text,
  CHECK ((kind = 'registration' AND user_id IS NOT NULL) OR (kind = 'test' AND user_id IS NULL))
);
-- Remember already confirmed accounts too, so a later email/profile change cannot
-- make an existing account appear to be a new registration.
INSERT INTO private.registration_alerts(user_id,email,display_name,registered_at,confirmed_at,status)
SELECT id,email,NULL,created_at,email_confirmed_at,'skipped' FROM auth.users
WHERE email_confirmed_at IS NOT NULL AND coalesce(email,'')<>'' AND deleted_at IS NULL;
CREATE INDEX registration_alerts_pending ON private.registration_alerts(next_attempt_at) WHERE status='pending';
ALTER TABLE private.registration_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.registration_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.registration_alert_settings, private.registration_alerts FROM PUBLIC, anon, authenticated, service_role;

-- Only the server role can reach these functions. Private SECURITY DEFINER code
-- has a fixed search path; the public RPC wrappers retain caller privileges.
CREATE FUNCTION private.claim_registration_alert()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE claimed private.registration_alerts;
BEGIN
  INSERT INTO private.registration_alerts(user_id,email,display_name,registered_at,confirmed_at)
  SELECT u.id,u.email,left(u.raw_user_meta_data->>'display_name',120),u.created_at,u.email_confirmed_at
  FROM auth.users u CROSS JOIN private.registration_alert_settings s
  WHERE u.email_confirmed_at >= s.enabled_at
    AND u.deleted_at IS NULL AND u.is_anonymous IS NOT TRUE AND coalesce(u.email,'') <> ''
    AND NOT EXISTS (SELECT 1 FROM private.registration_alerts a WHERE a.user_id=u.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- A crash might occur after Gmail accepted an email. Do not blindly resend it.
  UPDATE private.registration_alerts SET status='uncertain',error_code='worker_interrupted'
  WHERE status='sending' AND claimed_at < now()-interval '10 minutes';

  UPDATE private.registration_alerts a SET status='sending',attempts=attempts+1,
    claimed_at=now(),claim_token=gen_random_uuid(),error_code=NULL
  WHERE a.id=(SELECT q.id FROM private.registration_alerts q
    WHERE q.status='pending' AND q.next_attempt_at<=now()
    ORDER BY q.next_attempt_at,q.id LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING a.* INTO claimed;
  IF claimed.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',claimed.id,'claim_token',claimed.claim_token,
    'kind',claimed.kind,'email',claimed.email,'display_name',claimed.display_name,
    'registered_at',claimed.registered_at,'confirmed_at',claimed.confirmed_at);
END $fn$;

CREATE FUNCTION private.finish_registration_alert(p_id uuid,p_claim_token uuid,p_outcome text,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE affected integer;
BEGIN
  IF p_outcome NOT IN ('sent','retry','failed','uncertain') OR p_outcome IS NULL THEN
    RAISE EXCEPTION 'Invalid alert outcome';
  END IF;
  UPDATE private.registration_alerts SET
    status=CASE WHEN p_outcome='retry' THEN CASE WHEN attempts<5 THEN 'pending' ELSE 'failed' END ELSE p_outcome END,
    next_attempt_at=now()+interval '15 minutes',
    sent_at=CASE WHEN p_outcome='sent' THEN now() ELSE NULL END,
    error_code=left(p_error_code,80)
  WHERE id=p_id AND claim_token=p_claim_token AND status='sending';
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
END $fn$;

CREATE FUNCTION public.claim_registration_alert()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT private.claim_registration_alert();
$fn$;
CREATE FUNCTION public.finish_registration_alert(p_id uuid,p_claim_token uuid,p_outcome text,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT private.finish_registration_alert(p_id,p_claim_token,p_outcome,p_error_code);
$fn$;
REVOKE ALL ON FUNCTION private.claim_registration_alert(), private.finish_registration_alert(uuid,uuid,text,text),
  public.claim_registration_alert(), public.finish_registration_alert(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.claim_registration_alert(), private.finish_registration_alert(uuid,uuid,text,text),
  public.claim_registration_alert(), public.finish_registration_alert(uuid,uuid,text,text) TO service_role;
