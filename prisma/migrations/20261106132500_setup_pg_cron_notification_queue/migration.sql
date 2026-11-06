-- Migration: 20261106132500_setup_pg_cron_notification_queue
-- Planifie le traitement de la file de notifications (email) via pg_cron et pg_net
-- directement sur l'Edge Function send-email (0 CPU Vercel).

CREATE OR REPLACE FUNCTION private.invoke_send_email(p_action text DEFAULT 'process-queue')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request_id bigint;
  v_url text := 'https://tyejoxdanqldespwesor.supabase.co/functions/v1/send-email?action=' || p_action;
  v_key text := current_setting('app.settings.service_role_key', true);
BEGIN
  IF v_key IS NULL OR v_key = '' THEN
    v_key := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1);
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_key, '')
    ),
    body := jsonb_build_object('action', p_action)
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- Nettoyer l'ancien job s'il existait
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT jobid, jobname FROM cron.job WHERE jobname = 'notification-email-queue' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- Planifier le dispatch des notifications toutes les minutes
SELECT cron.schedule(
  'notification-email-queue',
  '* * * * *',
  'SELECT private.invoke_send_email(''process-queue'');'
);
