-- Les messages de Paul sur Telegram depuis ses outils locaux (Yuno Studio : choix de la semaine
-- du samedi, « contenu prêt » du dimanche). Le bot vit ici (secret TELEGRAM_BOT_TOKEN, chat
-- ops_telegram_chat) : un outil local n'a que la clé serveur, il écrit dans cette file par
-- ops_telegram_notify, qui réveille process-scheduled-campaigns (tâche ops_telegram) ; la
-- fonction envoie et marque. Une file vide ne coûte rien ; un réveil manqué est rattrapé au
-- passage suivant du cron.

CREATE TABLE IF NOT EXISTS public.ops_telegram_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 3800),
  buttons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(buttons) = 'array'),
  dedup_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  error text
);
ALTER TABLE public.ops_telegram_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_telegram_outbox FROM PUBLIC, anon, authenticated;

-- Outil local (service_role) → un message dans la file + réveil immédiat de l'envoi.
-- dedup_key : le même message (même semaine, même étape) ne part qu'une fois.
CREATE OR REPLACE FUNCTION public.ops_telegram_notify(p_source text, p_text text, p_buttons jsonb DEFAULT '[]'::jsonb, p_dedup_key text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.ops_telegram_outbox (source, text, buttons, dedup_key)
  VALUES (left(p_source, 40), left(p_text, 3800), COALESCE(p_buttons, '[]'::jsonb), p_dedup_key)
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
  EXCEPTION WHEN OTHERS THEN NULL;            -- le cron rattrape
  END;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ops_telegram_notify(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_notify(text, text, jsonb, text) TO service_role;

-- Envoi : prise des messages en attente (un message pris il y a plus de 5 min est repris), 5 essais au plus.
CREATE OR REPLACE FUNCTION public.claim_ops_telegram(p_limit int DEFAULT 10)
RETURNS SETOF public.ops_telegram_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ops_telegram_outbox o
     SET claimed_at = now(), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.ops_telegram_outbox
      WHERE sent_at IS NULL AND attempts < 5 AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
      ORDER BY created_at
      LIMIT GREATEST(1, LEAST(p_limit, 20))
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*
$$;
REVOKE ALL ON FUNCTION public.claim_ops_telegram(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ops_telegram(int) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_ops_telegram(p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ops_telegram_outbox
     SET sent_at = CASE WHEN p_ok THEN now() END,
         claimed_at = CASE WHEN p_ok THEN claimed_at END,
         error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 300) END
   WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.finish_ops_telegram(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_ops_telegram(uuid, boolean, text) TO service_role;
