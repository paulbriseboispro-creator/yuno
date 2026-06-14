-- Phase 3 — Liquidation en un clic (atomique).
-- Agrège toutes les commissions en attente d'un promoteur en un seul paiement marqué
-- payé, bascule les conversions concernées en 'paid', et met à jour le solde du
-- promoteur — le tout dans une seule transaction pour éviter les états incohérents.

CREATE OR REPLACE FUNCTION public.settle_promoter_payout(
  p_promoter_id uuid,
  p_period_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_amount numeric;
  v_count int;
  v_venue_id text;
  v_org_id uuid;
  v_payout_id uuid;
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM promoters WHERE id = p_promoter_id;

  -- Authorization: caller must own/manage the promoter's scope.
  IF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not authorized to settle this promoter';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not authorized to settle this promoter';
    END IF;
  ELSE
    RAISE EXCEPTION 'promoter not found';
  END IF;

  SELECT COALESCE(SUM(commission), 0), COUNT(*) INTO v_amount, v_count
  FROM promoter_conversions
  WHERE promoter_id = p_promoter_id AND status = 'pending';

  IF v_count = 0 OR v_amount <= 0 THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'nothing_pending');
  END IF;

  INSERT INTO promoter_payouts (
    promoter_id, venue_id, organizer_user_id, amount, status,
    period_label, approved_at, approved_by, paid_at, paid_by
  ) VALUES (
    p_promoter_id, v_venue_id, v_org_id, v_amount, 'paid',
    COALESCE(p_period_label, 'Liquidation ' || to_char(now(), 'DD/MM/YYYY')),
    now(), auth.uid(), now(), auth.uid()
  )
  RETURNING id INTO v_payout_id;

  UPDATE promoter_conversions
  SET status = 'paid', paid_at = now()
  WHERE promoter_id = p_promoter_id AND status = 'pending';

  UPDATE promoters
  SET pending_amount = 0,
      total_paid = COALESCE(total_paid, 0) + v_amount,
      updated_at = now()
  WHERE id = p_promoter_id;

  RETURN jsonb_build_object('settled', true, 'payout_id', v_payout_id, 'amount', v_amount, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_promoter_payout(uuid, text) TO authenticated;
