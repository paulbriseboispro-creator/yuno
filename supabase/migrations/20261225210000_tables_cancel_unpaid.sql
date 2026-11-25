-- Tables VIP, vague A — P4.3 : annuler une table SANS paiement Stripe (sur place, ajout manuel, jamais payée en ligne).
--
-- Décision D1 : le pro peut annuler une table. Payée en ligne, l'annulation passe par owner-refund `cancel_table` (remboursement
-- total, frais de service compris). Sans paiement Stripe il n'y a rien à rembourser : cette RPC passe la réservation en `cancelled`,
-- libère la table, et l'edge envoie l'e-mail « annulée ». owner-refund l'appelle avec le JWT du pro (ses droits s'appliquent).
--
--   cancel_unpaid_table_reservation(p_reservation_id uuid, p_reason text) RETURNS jsonb
--     → {ok, reservation_id, previous_status, released_table}
--
-- Droits : ceux de vip_set_table_placement (_can_manage_table_reservation) SAUF l'hôte VIP « pur » : pour lui le statut est un champ
-- financier (enforce_vip_host_reservation_columns), il place mais n'annule pas.
-- Codes : 42501 not_authenticated | not_allowed ; P0002 reservation_not_found ;
--         YU006 use_refund  (un paiement Stripe existe : passer par owner-refund `cancel_table`) ;
--         YU008 reservation_not_active (déjà annulée / remboursée / jamais payée : une réservation en attente de paiement
--               ne s'annule pas à la main, sa session Stripe peut encore aboutir).
--
-- Effets de bord étendus à `cancelled` (jusqu'ici seul `refunded` les déclenchait) :
--   • trg_wallet_pass_refund : le pass Wallet de la table est invalidé (une table sur place a reçu un pass à la confirmation) ;
--   • trg_cancel_promoter_conv_on_refund : la commission promoteur en attente d'une vente qui n'existe plus est annulée.
-- Les QR des invités ne sont plus scannables : guard_table_reservation_guest n'accepte un scan que si la réservation est `paid`.

CREATE OR REPLACE FUNCTION public.cancel_unpaid_table_reservation(p_reservation_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r public.table_reservations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._can_manage_table_reservation(v_uid, r.event_id, r.zone_id, false) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id FOR UPDATE;

  IF r.stripe_payment_intent_id IS NOT NULL OR r.stripe_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'use_refund' USING ERRCODE = 'YU006';
  END IF;
  IF r.status NOT IN ('paid', 'confirmed') THEN
    RAISE EXCEPTION 'reservation_not_active' USING ERRCODE = 'YU008';
  END IF;

  UPDATE public.table_reservations
     SET status = 'cancelled',
         refund_reason = NULLIF(left(btrim(COALESCE(p_reason, '')), 200), ''),
         assigned_table_id = NULL,
         placement_status = 'none',
         placement_adjustment = NULL,
         placement_adjustment_amount = NULL
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', r.id,
    'previous_status', r.status,
    'released_table', r.assigned_table_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_unpaid_table_reservation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_unpaid_table_reservation(uuid, text) TO authenticated, service_role;

-- Pass Wallet et commission promoteur : une table annulée se comporte comme une table remboursée.
DROP TRIGGER IF EXISTS trg_wallet_pass_refund ON public.table_reservations;
CREATE TRIGGER trg_wallet_pass_refund
  AFTER UPDATE OF status ON public.table_reservations
  FOR EACH ROW
  WHEN (new.status IN ('refunded', 'cancelled') AND old.status IS DISTINCT FROM new.status)
  EXECUTE FUNCTION private.notify_wallet_pass_refund();

DROP TRIGGER IF EXISTS trg_cancel_promoter_conv_on_refund ON public.table_reservations;
CREATE TRIGGER trg_cancel_promoter_conv_on_refund
  AFTER UPDATE OF status ON public.table_reservations
  FOR EACH ROW
  WHEN (new.status IN ('refunded', 'cancelled') AND old.status IS DISTINCT FROM new.status)
  EXECUTE FUNCTION public.cancel_promoter_conversions_for_refund();
