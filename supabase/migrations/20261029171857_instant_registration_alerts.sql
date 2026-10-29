-- HTTP requests begin only after commit; the existing scheduler remains a fallback.
CREATE EXTENSION IF NOT EXISTS pg_net;
REVOKE ALL ON net.http_request_queue FROM PUBLIC, anon, authenticated, service_role;

-- Enable only after the Netlify endpoint is deployed.
ALTER TABLE private.registration_alert_settings ADD COLUMN webhooks_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE private.registration_alerts ADD COLUMN webhook_token uuid;
ALTER TABLE private.registration_alerts ALTER COLUMN webhook_token SET DEFAULT gen_random_uuid();
ALTER TABLE private.registration_alerts ADD COLUMN webhook_request_id bigint;
ALTER TABLE private.registration_alerts ADD COLUMN webhook_error text;

CREATE FUNCTION private.dispatch_registration_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE request_id bigint;
BEGIN
  IF NEW.status <> 'pending' OR NEW.webhook_token IS NULL THEN RETURN NEW; END IF;
  IF NOT (SELECT webhooks_enabled FROM private.registration_alert_settings WHERE singleton) THEN RETURN NEW; END IF;
  BEGIN
    SELECT net.http_post(
      url := 'https://businessfinancialgoal.netlify.app/.netlify/functions/registration-alert-event',
      body := jsonb_build_object('id',NEW.id,'token',NEW.webhook_token),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 25000
    ) INTO request_id;
    UPDATE private.registration_alerts SET webhook_request_id=request_id WHERE id=NEW.id;
  EXCEPTION WHEN OTHERS THEN
    -- Keep the durable queue entry for the scheduled worker if dispatch fails.
    UPDATE private.registration_alerts SET webhook_error='dispatch_failed' WHERE id=NEW.id;
    RAISE WARNING 'Registration alert dispatch failed; scheduled fallback will retry';
  END;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.dispatch_registration_alert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER registration_alert_dispatch AFTER INSERT ON private.registration_alerts
FOR EACH ROW EXECUTE FUNCTION private.dispatch_registration_alert();

CREATE FUNCTION private.enqueue_confirmed_registration_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
  IF NEW.email_confirmed_at IS NULL OR NEW.deleted_at IS NOT NULL
    OR NEW.is_anonymous IS TRUE OR coalesce(NEW.email,'')='' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.email_confirmed_at IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO private.registration_alerts(user_id,email,display_name,registered_at,confirmed_at)
  SELECT NEW.id,NEW.email,left(NEW.raw_user_meta_data->>'display_name',120),NEW.created_at,NEW.email_confirmed_at
  FROM private.registration_alert_settings s WHERE NEW.email_confirmed_at >= s.enabled_at
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- The periodic scan can recover the event; don't fail confirmation for an alert.
  RAISE WARNING 'Registration alert enqueue failed; scheduled fallback will retry';
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.enqueue_confirmed_registration_alert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financialgoal_confirmed_registration_alert
AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.enqueue_confirmed_registration_alert();

-- A separate random token authorizes only this event, never arbitrary recipients.
-- It is sent in the HTTPS body, not the URL, and is consumed atomically on claim.
CREATE FUNCTION private.claim_registration_alert_event(p_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE claimed private.registration_alerts;
BEGIN
  UPDATE private.registration_alerts a SET status='sending',attempts=attempts+1,
    claimed_at=now(),claim_token=gen_random_uuid(),webhook_token=NULL,error_code=NULL
  WHERE a.id=p_id AND a.webhook_token=p_token AND a.status='pending' AND a.next_attempt_at<=now()
  RETURNING a.* INTO claimed;
  IF claimed.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',claimed.id,'claim_token',claimed.claim_token,
    'kind',claimed.kind,'email',claimed.email,'display_name',claimed.display_name,
    'registered_at',claimed.registered_at,'confirmed_at',claimed.confirmed_at);
END $fn$;
CREATE FUNCTION public.claim_registration_alert_event(p_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT private.claim_registration_alert_event(p_id,p_token);
$fn$;
REVOKE ALL ON FUNCTION private.claim_registration_alert_event(uuid,uuid), public.claim_registration_alert_event(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.claim_registration_alert_event(uuid,uuid), public.claim_registration_alert_event(uuid,uuid)
  TO service_role;
