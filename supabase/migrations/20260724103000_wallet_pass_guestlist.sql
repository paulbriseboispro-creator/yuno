-- Apple Wallet — nouveau type de pass « guestlist ».
--
-- Une entrée de guest list est un vrai billet de porte (QR scanné au même
-- endroit que les billets payants), elle mérite donc sa place dans Wallet.
-- La contrainte inline d'origine n'autorisait que ticket/vip/credits, et son
-- nom auto-généré par Postgres est `wallet_passes_pass_type_check`.
--
-- Le serial d'un pass guest list est préfixé 'g-' (voir ensureWalletPass) :
-- aucune collision possible avec 't-' (billet) ni 'v-' (table VIP).
ALTER TABLE public.wallet_passes DROP CONSTRAINT IF EXISTS wallet_passes_pass_type_check;
ALTER TABLE public.wallet_passes
  ADD CONSTRAINT wallet_passes_pass_type_check
  CHECK (pass_type IN ('ticket', 'vip', 'credits', 'guestlist'));

-- Révocation d'un pass. Le CASE d'origine avait un ELSE fourre-tout qui aurait
-- rangé une entrée de guest list sous le préfixe VIP et voidé le pass d'un
-- homonyme. On nomme les trois tables ; une table inconnue ne révoque rien.
-- Le reste (push de mise à jour du pass, tolérance aux erreurs) est conservé
-- tel quel : ce trigger ne doit jamais bloquer un remboursement.
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
    WHEN 'table_reservations' THEN 'v-' || NEW.id
    WHEN 'guest_list_entries' THEN 'g-' || NEW.id
    ELSE NULL
  END;

  IF v_serial IS NULL THEN
    RETURN NEW;
  END IF;

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

-- Une inscription annulée révoque son pass : le QR de porte ne doit plus être
-- présentable depuis Wallet. Statut 'cancelled' ici — une guest list est
-- gratuite, elle n'est jamais 'refunded'.
DROP TRIGGER IF EXISTS trg_wallet_pass_void_guest_list ON public.guest_list_entries;
CREATE TRIGGER trg_wallet_pass_void_guest_list
  AFTER UPDATE OF status ON public.guest_list_entries
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_wallet_pass_refund();
