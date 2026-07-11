-- Apple Wallet (Phase 5, plomberie) — remboursement → pass invalidé partout.
--
-- Quand un billet / une résa VIP passe en 'refunded', on marque le pass
-- `voided`, on bump `updated_at`, et on notifie les iPhone enregistrés
-- (send-push-notification, action wallet_pass_update → APNs topic = Pass
-- Type ID, payload vide) : Wallet vient re-télécharger le pass, qui s'affiche
-- barré. Même pattern pg_net best-effort que les autres triggers push.

CREATE OR REPLACE FUNCTION private.notify_wallet_pass_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_serial text;
BEGIN
  v_serial := CASE TG_TABLE_NAME
    WHEN 'tickets' THEN 't-' || NEW.id
    ELSE 'v-' || NEW.id
  END;

  UPDATE public.wallet_passes
  SET voided = true, updated_at = now()
  WHERE serial = v_serial;

  IF NOT FOUND THEN
    RETURN NEW; -- pas de pass émis pour cette entité : rien à pousser
  END IF;

  PERFORM net.http_post(
    url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', private.get_cron_secret()
    ),
    body := jsonb_build_object(
      'action', 'wallet_pass_update',
      'serial', v_serial
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort : ne jamais bloquer un remboursement pour un push raté.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_wallet_pass_refund() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wallet_pass_refund ON public.tickets;
CREATE TRIGGER trg_wallet_pass_refund
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW
  WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_wallet_pass_refund();

DROP TRIGGER IF EXISTS trg_wallet_pass_refund ON public.table_reservations;
CREATE TRIGGER trg_wallet_pass_refund
  AFTER UPDATE OF status ON public.table_reservations
  FOR EACH ROW
  WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_wallet_pass_refund();
