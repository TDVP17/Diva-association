-- Migration: 20261106130500_setup_pg_cron_tontine_jobs
-- Active les extensions pg_cron et pg_net pour exécuter les tâches périodiques des cotisations
-- directement sur Supabase (0 CPU sur Vercel).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE SCHEMA IF NOT EXISTS private;

-- Helper d'invocation sécurisé vers l'Edge Function tontine-cron
CREATE OR REPLACE FUNCTION private.invoke_tontine_cron(p_task text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request_id bigint;
  v_url text := 'https://tyejoxdanqldespwesor.supabase.co/functions/v1/tontine-cron?task=' || p_task;
  v_key text := current_setting('app.settings.service_role_key', true);
BEGIN
  -- Si le paramètre de configuration n'est pas défini, lire depuis le contexte ou fallback
  IF v_key IS NULL OR v_key = '' THEN
    v_key := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1);
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_key, '')
    ),
    body := jsonb_build_object('task', p_task)
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

-- Nettoyer les anciens jobs tontine s'ils existaient déjà
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT jobid, jobname FROM cron.job WHERE jobname LIKE 'tontine-%' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END;
$$;

-- Enregistrement des 7 tâches périodiques dans pg_cron
SELECT cron.schedule('tontine-turn-reminder', '0 7 * * *', $$SELECT private.invoke_tontine_cron('turn-reminder')$$);
SELECT cron.schedule('tontine-reminder-eve', '0 9 * * *', $$SELECT private.invoke_tontine_cron('reminder-eve')$$);
SELECT cron.schedule('tontine-reminder-noon', '0 11 * * *', $$SELECT private.invoke_tontine_cron('reminder-noon')$$);
SELECT cron.schedule('tontine-reminder-urgent', '0 16 * * *', $$SELECT private.invoke_tontine_cron('reminder-urgent')$$);
SELECT cron.schedule('tontine-food-turn', '30 17 * * *', $$SELECT private.invoke_tontine_cron('food-turn')$$);
SELECT cron.schedule('tontine-check-penalties', '31 17 * * *', $$SELECT private.invoke_tontine_cron('check-penalties')$$);
SELECT cron.schedule('tontine-refund-queue', '0 6 * * *', $$SELECT private.invoke_tontine_cron('process-refund-queue')$$);

