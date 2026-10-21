-- Les QR par personne d'un billet de N places, lisibles par un acheteur SANS compte.
--
-- Constat (21/10, première commande à 2 billets payée par un invité) : la page de
-- confirmation lit `ticket_attendees` depuis le navigateur. La seule policy de lecture
-- « acheteur » compare `tickets.user_id = auth.uid()` : un invité (user_id NULL, pas de
-- session) reçoit une liste VIDE, et le carrousel retombe sur le seul QR du billet entier.
-- Les N places créées à l'achat existaient en base mais personne ne pouvait les montrer.
--
-- Même modèle que `fix_ticket_email` : la PREUVE est le QR du billet (`TK-<uuid>`, secret
-- que seul l'acheteur détient, dans son e-mail et sur sa confirmation). Aucune policy
-- n'est ouverte sur la table : une seule fonction, qui rend les noms et QR de CE billet.

CREATE OR REPLACE FUNCTION public.get_ticket_places(p_ticket_id uuid, p_qr text)
RETURNS TABLE (id uuid, full_name text, qr_code text, entry_scanned boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.full_name, a.qr_code, COALESCE(a.entry_scanned, false)
    FROM public.ticket_attendees a
    JOIN public.tickets t ON t.id = a.ticket_id
   WHERE t.id = p_ticket_id
     AND p_qr IS NOT NULL
     AND t.qr_code = p_qr
     AND t.status IN ('paid', 'used')
   ORDER BY a.created_at, a.qr_code;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_places(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ticket_places(uuid, text) TO anon, authenticated, service_role;


-- ── Passes Apple Wallet PAR PERSONNE d'un billet de N places ─────────────────
-- Un pass `p-<id de la place>` (type `ticket_place`) porte le QR et le nom d'une
-- personne ; il vit à côté du pass `t-<billet>` (QR du billet entier), qui ne change pas.
ALTER TABLE public.wallet_passes DROP CONSTRAINT IF EXISTS wallet_passes_pass_type_check;
ALTER TABLE public.wallet_passes
  ADD CONSTRAINT wallet_passes_pass_type_check
  CHECK (pass_type IN ('ticket', 'vip', 'credits', 'guestlist', 'ticket_place'));

-- Révocation : un billet remboursé révoque aussi les passes de ses places ; une
-- place remboursée seule (refus à la porte) révoque le sien. Même mécanique et
-- même tolérance que `private.notify_wallet_pass_refund` : ne jamais bloquer un
-- remboursement pour un push raté. Fonction à part : le déclencheur existant
-- (t-, v-, g-) n'est pas touché.
CREATE OR REPLACE FUNCTION private.void_ticket_place_passes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_serial text;
BEGIN
  FOR v_serial IN
    UPDATE public.wallet_passes w
       SET voided = true, updated_at = now()
     WHERE w.pass_type = 'ticket_place'
       AND w.voided IS NOT TRUE
       AND w.serial IN (
         SELECT 'p-' || a.id
           FROM public.ticket_attendees a
          WHERE (TG_TABLE_NAME = 'tickets' AND a.ticket_id = NEW.id)
             OR (TG_TABLE_NAME = 'ticket_attendees' AND a.id = NEW.id)
       )
    RETURNING w.serial
  LOOP
    PERFORM net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('action', 'wallet_pass_update', 'serial', v_serial)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.void_ticket_place_passes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_wallet_place_void_ticket ON public.tickets;
CREATE TRIGGER trg_wallet_place_void_ticket
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW
  WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.void_ticket_place_passes();

DROP TRIGGER IF EXISTS trg_wallet_place_void_attendee ON public.ticket_attendees;
CREATE TRIGGER trg_wallet_place_void_attendee
  AFTER UPDATE OF refunded_at ON public.ticket_attendees
  FOR EACH ROW
  WHEN (NEW.refunded_at IS NOT NULL AND OLD.refunded_at IS NULL)
  EXECUTE FUNCTION private.void_ticket_place_passes();

NOTIFY pgrst, 'reload schema';
