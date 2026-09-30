-- Un billet REMBOURSÉ rend ses places à la jauge, une seule fois, quel que soit
-- le chemin du remboursement.
--
-- Avant : `ticket_rounds.tickets_sold` n'était décrémenté que par la porte
-- (staff-cancel) et l'annulation assurée (cancel-ticket), et de `quantity` — un
-- billet « groupe de 4 » tient 4 places (`ticket_reservations.capacity_held`)
-- mais n'en rendait qu'une. Le remboursement depuis la Console (owner-refund) et
-- le remboursement fait depuis le tableau de bord Stripe du pro (webhook
-- `charge.refunded`) ne rendaient rien : la place remboursée restait vendue, et
-- une soirée pouvait afficher « complet » avec des places libres.
--
-- La porte est le PASSAGE du statut `paid` → `refunded` : chaque chemin l'écrit
-- par une mise à jour conditionnelle (`status <> 'refunded'`), donc un seul
-- l'emporte, et ce trigger ne voit le passage qu'une fois. Les chemins ne
-- décrémentent plus eux-mêmes.
--
-- Ce que le billet occupait : la capacité TENUE par sa réservation (quantité ×
-- taille du groupe, comptée par `confirm_ticket_reservation`), sinon sa
-- quantité (billets antérieurs aux réservations), comme verify-ticket-payment.
-- Un billet déjà SCANNÉ garde sa place : la personne est entrée, la place a été
-- occupée — la rendre à la vente pendant la soirée ferait dépasser la jauge.
--
-- Le même passage supprime les crédits boissons du billet : ils étaient compris
-- dans le prix rendu. Les chemins le faisaient chacun ; le webhook l'oubliait.
-- Les options achetées avec le billet (`ticket_upsell_selections`, vestiaire
-- prépayé) n'ont pas de statut : elles valent tant que le billet est `paid`
-- (`cloakroom_deposit` le vérifie). Les chemins y écrivaient un
-- `status = 'cancelled'` sur une colonne qui n'existe pas — l'écriture échouait
-- sans bruit ; elle est retirée.
--
-- SECURITY DEFINER : ce n'est pas un trigger de GARDE (il ne discrimine pas sur
-- `current_user`), et `tickets.status` n'est de toute façon modifiable que côté
-- serveur (`protect_ticket_immutable_fields`). Le corps ne fait jamais échouer
-- l'écriture du remboursement : l'argent est déjà rendu quand elle arrive.

CREATE OR REPLACE FUNCTION public.release_refunded_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seats integer;
BEGIN
  IF NEW.ticket_round_id IS NOT NULL AND NOT COALESCE(OLD.entry_scanned, false) THEN
    BEGIN
      SELECT r.capacity_held INTO v_seats
      FROM public.ticket_reservations r
      WHERE r.id = NEW.reservation_id;

      v_seats := COALESCE(NULLIF(v_seats, 0), NULLIF(NEW.quantity, 0), 1);

      UPDATE public.ticket_rounds
      SET tickets_sold = GREATEST(0, tickets_sold - v_seats)
      WHERE id = NEW.ticket_round_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'release_refunded_ticket: seats not released for ticket % (%)', NEW.id, SQLERRM;
    END;
  END IF;

  BEGIN
    DELETE FROM public.order_pack_credits WHERE ticket_order_id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'release_refunded_ticket: drink credits not removed for ticket % (%)', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.release_refunded_ticket() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_release_refunded_ticket ON public.tickets;
CREATE TRIGGER trg_release_refunded_ticket
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW
  WHEN (OLD.status = 'paid' AND NEW.status = 'refunded')
  EXECUTE FUNCTION public.release_refunded_ticket();
