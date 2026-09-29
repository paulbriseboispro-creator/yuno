-- Un billet PAYÉ compte toujours ses places, même si sa réservation a expiré.
--
-- `reserve_ticket_capacity` tient les places 10 min (`_ttl_minutes: 10`), alors
-- que la session Stripe Checkout reste payable 31 min. Un acheteur qui paie à la
-- 12e minute trouvait sa réservation `expired` (cron cleanup-pending-purchases) :
-- `confirm_ticket_reservation` levait « not pending », et le repli de
-- verify-ticket-payment ajoutait `tickets.quantity` au lieu de la capacité tenue
-- (quantité × taille du groupe) — un billet « table de 4 » ne comptait qu'une
-- place, la jauge sous-comptait et pouvait survendre.
--
-- Cette fonction n'est appelée QUE par verify-ticket-payment, après un paiement
-- vérifié chez Stripe. Refuser de compter ne rend pas l'argent : on compte donc
-- la capacité tenue pour toute réservation non confirmée (pending, expired,
-- cancelled). Une éventuelle survente d'une place, sur un paiement réel, vaut
-- mieux qu'une jauge fausse. Idempotente : `confirmed` ne recompte jamais.
-- Réécrite depuis la définition EN LIGNE (pg_get_functiondef, 29/09).
CREATE OR REPLACE FUNCTION public.confirm_ticket_reservation(_reservation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round_id uuid;
  v_capacity integer;
  v_status text;
BEGIN
  SELECT ticket_round_id, capacity_held, status
  INTO v_round_id, v_capacity, v_status
  FROM public.ticket_reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found';
  END IF;

  IF v_status = 'confirmed' THEN
    RETURN; -- Idempotent
  END IF;

  IF v_status NOT IN ('pending', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'Reservation cannot be confirmed (status=%)', v_status;
  END IF;

  UPDATE public.ticket_reservations
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = _reservation_id;

  UPDATE public.ticket_rounds
  SET tickets_sold = tickets_sold + v_capacity
  WHERE id = v_round_id;
END;
$function$;

-- Service seulement, comme en ligne (verify-ticket-payment, service_role) :
-- accepter une réservation expirée ne doit jamais devenir appelable par un client.
REVOKE EXECUTE ON FUNCTION public.confirm_ticket_reservation(uuid) FROM PUBLIC, anon, authenticated;
