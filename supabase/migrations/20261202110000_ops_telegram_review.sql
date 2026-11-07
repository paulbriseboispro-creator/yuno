-- Validation de la semaine Instagram sur Telegram (Yuno Studio, demande de Paul du 07/11) : le dimanche,
-- les designs partent en albums (ops_telegram_outbox.media), Paul répond « OK » ou ses retours ; ses
-- messages arrivent par le webhook du bot (process-scheduled-campaigns, en-tête secret de Telegram, sans
-- relevé périodique) et sont rangés dans ops_telegram_inbox, que le Studio lit avec la clé serveur.

ALTER TABLE public.ops_telegram_outbox ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ops_telegram_chat ADD COLUMN IF NOT EXISTS last_update_id bigint;

CREATE TABLE IF NOT EXISTS public.ops_telegram_inbox (
  update_id bigint PRIMARY KEY,
  chat_id bigint NOT NULL,
  message_id bigint,
  reply_to bigint,
  text text,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_telegram_inbox_sent_idx ON public.ops_telegram_inbox (sent_at);
ALTER TABLE public.ops_telegram_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_telegram_inbox FROM PUBLIC, anon, authenticated;

-- media : [{url, caption?}] (https), envoyé en albums de 10 avant le texte
DROP FUNCTION IF EXISTS public.ops_telegram_notify(text, text, jsonb, text);
CREATE OR REPLACE FUNCTION public.ops_telegram_notify(p_source text, p_text text, p_buttons jsonb DEFAULT '[]'::jsonb,
                                                      p_dedup_key text DEFAULT NULL, p_media jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.ops_telegram_outbox (source, text, buttons, dedup_key, media)
  VALUES (left(p_source, 40), left(p_text, 3800), COALESCE(p_buttons, '[]'::jsonb), p_dedup_key,
          CASE WHEN jsonb_typeof(p_media) = 'array' THEN p_media ELSE '[]'::jsonb END)
  ON CONFLICT (dedup_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/process-scheduled-campaigns',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.get_cron_secret()),
      body := jsonb_build_object('task', 'ops_telegram'),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ops_telegram_notify(text, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_notify(text, text, jsonb, text, jsonb) TO service_role;

-- recréée pour rendre la colonne media, et SÉRIALISÉE : chaque message réveille la fonction, et deux
-- passages en parallèle enverraient les albums dans le désordre. Un seul passage à la fois (verrou), et
-- rien n'est pris tant qu'un message pris il y a moins de 5 min n'est pas parti.
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
      WHERE sent_at IS NULL AND attempts < 5
      ORDER BY created_at
      LIMIT GREATEST(1, LEAST(p_limit, 20)))
  RETURNING o.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_ops_telegram(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ops_telegram(int) TO service_role;

-- Relevé des messages : range les nouveaux, retient le dernier update_id (jamais en arrière)
CREATE OR REPLACE FUNCTION public.ops_telegram_inbox_save(p_rows jsonb, p_last_update_id bigint)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  INSERT INTO public.ops_telegram_inbox (update_id, chat_id, message_id, reply_to, text, sent_at)
  SELECT (r->>'update_id')::bigint, (r->>'chat_id')::bigint, (r->>'message_id')::bigint, NULLIF(r->>'reply_to', '')::bigint,
         left(r->>'text', 4000), to_timestamp((r->>'date')::double precision)
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) r
  ON CONFLICT (update_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.ops_telegram_chat SET last_update_id = GREATEST(COALESCE(last_update_id, 0), p_last_update_id) WHERE id = 1;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ops_telegram_inbox_save(jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_inbox_save(jsonb, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.ops_telegram_last_update_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT last_update_id FROM public.ops_telegram_chat WHERE id = 1 $$;
REVOKE ALL ON FUNCTION public.ops_telegram_last_update_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_last_update_id() TO service_role;

-- Purge : les messages relevés ne servent qu'à la validation de la semaine
CREATE OR REPLACE FUNCTION public.ops_telegram_purge()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.ops_telegram_inbox WHERE sent_at < now() - interval '60 days';
  DELETE FROM public.ops_telegram_outbox WHERE created_at < now() - interval '60 days';
$$;
REVOKE ALL ON FUNCTION public.ops_telegram_purge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_purge() TO service_role;
