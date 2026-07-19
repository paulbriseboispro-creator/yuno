-- Push « ta commande est prête » — comble le trou app-fermée.
--
-- Jusqu'ici, le passage d'une commande à « prête » ne touchait le client que
-- via la Live Activity iOS (si démarrée) et le Realtime in-app (si l'app est
-- ouverte). Téléphone en poche sans Live Activity → silence total, le client
-- rate le retrait au bar.
--
-- On étend le trigger existant sur orders : en PLUS de la mise à jour de la
-- Live Activity (branche inchangée), la transition ready_at NULL → non-NULL
-- déclenche un push alerte classique (action 'order_ready' du relay), gated par
-- le registre platform_notification_settings côté edge function. La condition
-- OLD.ready_at IS NULL fait office de dédup (un seul push par commande).

CREATE OR REPLACE FUNCTION private.notify_order_live_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  -- Branche 1 : mise à jour de la Live Activity (uniquement si une activité
  -- vivante existe pour cette commande).
  IF EXISTS (
    SELECT 1 FROM public.live_activity_tokens
    WHERE order_id = NEW.id AND ended_at IS NULL
  ) THEN
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
  END IF;

  -- Branche 2 : commande qui vient de passer « prête » → push alerte classique.
  -- Les commandes guest (user_id NULL) n'ont pas d'abonnement push : on saute.
  IF NEW.ready_at IS NOT NULL AND OLD.ready_at IS NULL AND NEW.user_id IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object(
        'action', 'order_ready',
        'order_id', NEW.id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort : ne jamais casser la mise à jour d'une commande.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_order_live_activity() FROM PUBLIC, anon, authenticated;

-- Le trigger existant (trg_order_live_activity_push, AFTER UPDATE OF status,
-- ready_at, served_at, token_used) pointe déjà sur cette fonction — pas besoin
-- de le recréer.
