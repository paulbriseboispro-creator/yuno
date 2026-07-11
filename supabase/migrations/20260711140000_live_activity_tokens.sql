-- Live Activities (Phase 4) — suivi de commande boisson sur l'écran
-- verrouillé / Dynamic Island.
--
-- live_activity_tokens : le client démarre l'activité à la confirmation de
-- commande (app au premier plan), récupère le push token ActivityKit et
-- l'enregistre ici. Ensuite, LE CHEMIN QUI COMPTE : téléphone en poche en
-- boîte → le trigger ci-dessous pousse chaque changement de statut via APNs
-- (send-push-notification, action live_activity_update), sans que l'app soit
-- ouverte. Clone du pattern trg_live_entry_push (pg_net + x-cron-secret,
-- best-effort, jamais bloquant pour le barman).

CREATE TABLE IF NOT EXISTS public.live_activity_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id text NOT NULL,          -- identifiant ActivityKit côté device
  push_token text NOT NULL,           -- token APNs de CETTE activité
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz                -- posé quand l'activité est terminée (served)
);

CREATE INDEX IF NOT EXISTS live_activity_tokens_order_idx
  ON public.live_activity_tokens (order_id) WHERE ended_at IS NULL;

-- Une rotation de token ré-insère (nouveau token, même activité) ; l'ancien
-- token meurt en 410 côté APNs et sa ligne est purgée par l'action d'envoi.
CREATE UNIQUE INDEX IF NOT EXISTS live_activity_tokens_activity_token_key
  ON public.live_activity_tokens (activity_id, push_token);

ALTER TABLE public.live_activity_tokens ENABLE ROW LEVEL SECURITY;

-- Le client gère SES activités ; les envois passent par service-role (bypass).
DROP POLICY IF EXISTS live_activity_tokens_insert_own ON public.live_activity_tokens;
CREATE POLICY live_activity_tokens_insert_own ON public.live_activity_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS live_activity_tokens_select_own ON public.live_activity_tokens;
CREATE POLICY live_activity_tokens_select_own ON public.live_activity_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS live_activity_tokens_update_own ON public.live_activity_tokens;
CREATE POLICY live_activity_tokens_update_own ON public.live_activity_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- ── Trigger : statut de commande → mise à jour de l'activité ────────────────
CREATE OR REPLACE FUNCTION private.notify_order_live_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  -- Ne rien faire si aucune activité vivante pour cette commande (cas de
  -- 100 % des commandes tant que l'app native avec ActivityKit n'a pas shippé).
  IF NOT EXISTS (
    SELECT 1 FROM public.live_activity_tokens
    WHERE order_id = NEW.id AND ended_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', private.get_cron_secret()
    ),
    body := jsonb_build_object(
      'action', 'live_activity_update',
      'order_id', NEW.id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort : ne jamais casser la mise à jour d'une commande.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_order_live_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_live_activity_push ON public.orders;
CREATE TRIGGER trg_order_live_activity_push
  AFTER UPDATE OF status, ready_at, served_at, token_used ON public.orders
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.ready_at IS DISTINCT FROM NEW.ready_at
    OR OLD.served_at IS DISTINCT FROM NEW.served_at
    OR OLD.token_used IS DISTINCT FROM NEW.token_used
  )
  EXECUTE FUNCTION private.notify_order_live_activity();
