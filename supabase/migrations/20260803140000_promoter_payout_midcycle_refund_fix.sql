-- ─────────────────────────────────────────────────────────────────────────────
-- Règlement promoteur — remboursement EN COURS DE CYCLE (audit 2026-07-31, item 7).
--
-- Le cycle est en trois temps : prepare (gel du lot + montant) → declare_sent
-- (le club vire) → confirm_received (le promoteur accuse réception, seul moment
-- où les commissions passent 'paid').
--
-- Bug : si une conversion du lot est REMBOURSÉE entre prepare et confirm, le
-- trigger de refund la passe 'cancelled' et retire DÉJÀ sa commission de
-- promoters.pending_amount. Mais confirm_promoter_payout_received bougeait
-- pending_amount ET total_paid du montant GELÉ du lot (`v_amount`, qui incluait
-- encore cette commission remboursée). Résultat : pending_amount décrémenté DEUX
-- fois (par le trigger puis par le confirm), et total_paid gonflé d'une vente
-- jamais réellement due.
--
-- Correctif : le confirm ne solde que les conversions ENCORE 'pending' du lot
-- (il le faisait déjà via le filtre `pc.status = 'pending'`), et bouge
-- pending_amount / total_paid de leur somme RÉELLE (`v_settled`), pas du montant
-- gelé. Dans le cas normal (aucun remboursement en cours de cycle), v_settled ==
-- montant gelé → comportement inchangé. `promoter_payouts.amount` reste le
-- montant déclaré viré (ce que le club a réellement envoyé) — non modifié.
--
-- Une seule fonction à corriger : le règlement agence est désactivé
-- (settle_agency_promoter_payout lève use_two_step_flow) et passe par ce même
-- confirm. CREATE OR REPLACE (même signature) → grants et logique de litige
-- préservés.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.confirm_promoter_payout_received(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_promoter_id uuid;
  v_status text;
  v_settled numeric;
BEGIN
  SELECT pp.promoter_id, pp.status
    INTO v_promoter_id, v_status
  FROM promoter_payouts pp WHERE pp.id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;

  -- Un lot en litige (pas de réponse à temps, ou contesté) reste confirmable :
  -- l'argent a pu arriver en retard. Sortie normale d'un litige, elle appartient
  -- au promoteur.
  IF v_status NOT IN ('approved', 'disputed') THEN RAISE EXCEPTION 'payout_not_declared'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM promoters p WHERE p.id = v_promoter_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only_promoter_can_confirm';
  END IF;

  -- Solde EXACTEMENT les commissions ENCORE DUES du lot, et capture leur somme
  -- RÉELLE. Une conversion remboursée en cours de cycle est déjà 'cancelled' (et
  -- déjà retirée de pending_amount par le trigger de refund) : le filtre
  -- `pc.status = 'pending'` l'exclut, et on ne la recompte pas.
  WITH settled AS (
    UPDATE promoter_conversions pc
    SET status = 'paid', paid_at = now()
    FROM promoter_payout_items i
    WHERE i.payout_id = p_payout_id
      AND pc.id = i.conversion_id
      AND pc.status = 'pending'
    RETURNING pc.commission AS commission
  )
  SELECT COALESCE(SUM(commission), 0) INTO v_settled FROM settled;

  UPDATE promoter_payouts
  SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
      disputed_at = NULL, dispute_reason = NULL
  WHERE id = p_payout_id;

  UPDATE promoters
  SET pending_amount = GREATEST(COALESCE(pending_amount, 0) - v_settled, 0),
      total_paid = COALESCE(total_paid, 0) + v_settled,
      updated_at = now()
  WHERE id = v_promoter_id;

  RETURN jsonb_build_object('confirmed', true, 'amount', v_settled);
END;
$fn$;
