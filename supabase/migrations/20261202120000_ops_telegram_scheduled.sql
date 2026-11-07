-- Messages Telegram programmés (Yuno Studio, règle de Paul du 07/11) : une fois la semaine validée le
-- dimanche, chaque publication lui est envoyée 30 min avant son heure (images + légende, ou consignes de
-- la story), une par une. Le Studio dépose tout d'un coup avec send_after ; le passage de
-- process-scheduled-campaigns (toutes les 5 min, déjà en place) envoie ce qui est échu. Rien de nouveau ne tourne.

ALTER TABLE public.ops_telegram_outbox ADD COLUMN IF NOT EXISTS send_after timestamptz;
CREATE INDEX IF NOT EXISTS ops_telegram_outbox_due_idx ON public.ops_telegram_outbox (send_after) WHERE sent_at IS NULL;

DROP FUNCTION IF EXISTS public.ops_telegram_notify(text, text, jsonb, text, jsonb);
CREATE OR REPLACE FUNCTION public.ops_telegram_notify(p_source text, p_text text, p_buttons jsonb DEFAULT '[]'::jsonb,
                                                      p_dedup_key text DEFAULT NULL, p_media jsonb DEFAULT '[]'::jsonb,
                                                      p_send_after timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.ops_telegram_outbox (source, text, buttons, dedup_key, media, send_after)
  VALUES (left(p_source, 40), left(p_text, 3800), COALESCE(p_buttons, '[]'::jsonb), p_dedup_key,
          CASE WHEN jsonb_typeof(p_media) = 'array' THEN p_media ELSE '[]'::jsonb END, p_send_after)
  ON CONFLICT (dedup_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF p_send_after IS NULL OR p_send_after <= now() THEN      -- a scheduled message waits for its time
    BEGIN
      PERFORM net.http_post(
        url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/process-scheduled-campaigns',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.get_cron_secret()),
        body := jsonb_build_object('task', 'ops_telegram'),
        timeout_milliseconds := 10000
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ops_telegram_notify(text, text, jsonb, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_notify(text, text, jsonb, text, jsonb, timestamptz) TO service_role;

-- Un passage à la fois (verrou), dans l'ordre, et seulement ce qui est échu.
DROP FUNCTION IF EXISTS public.claim_ops_telegram(int);
CREATE FUNCTION public.claim_ops_telegram(p_limit int DEFAULT 10)
RETURNS SETOF public.ops_telegram_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ops_telegram_outbox')) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_telegram_outbox WHERE sent_at IS NULL AND claimed_at > now() - interval '5 minutes') THEN RETURN; END IF;
  RETURN QUERY
  UPDATE public.ops_telegram_outbox o
     SET claimed_at = now(), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.ops_telegram_outbox
      WHERE sent_at IS NULL AND attempts < 5 AND (send_after IS NULL OR send_after <= now())
      ORDER BY COALESCE(send_after, created_at), created_at
      LIMIT GREATEST(1, LEAST(p_limit, 20)))
  RETURNING o.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_ops_telegram(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ops_telegram(int) TO service_role;

-- Une semaine refaite après validation : ses messages programmés pas encore partis sont retirés.
CREATE OR REPLACE FUNCTION public.ops_telegram_cancel(p_prefix text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  IF p_prefix IS NULL OR length(p_prefix) < 12 THEN RETURN 0; END IF;
  DELETE FROM public.ops_telegram_outbox WHERE sent_at IS NULL AND dedup_key LIKE p_prefix || '%';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ops_telegram_cancel(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_cancel(text) TO service_role;
