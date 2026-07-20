-- ============================================================================
-- 1. settle_promoter_payout : supprimer la fenêtre de course qui perdait de
--    l'argent du promoteur.
--
-- L'ancienne version faisait SUM(commission) sur les conversions en attente,
-- PUIS un UPDATE ... WHERE status = 'pending' réévalué. En READ COMMITTED, une
-- vente validée entre les deux est invisible de la somme mais capturée par
-- l'UPDATE : elle passe à « payée », n'entre dans aucun versement, et le
-- pending_amount remis à zéro efface sa trace. Le promoteur perd la commission,
-- sans aucun signal. Fenêtre étroite, mais c'est celle du samedi soir, quand
-- ventes et règlements se chevauchent.
--
-- Correctif : on RÉCLAME les lignes avec UPDATE ... RETURNING et on somme
-- exactement ce qui a été réclamé. Il devient impossible de marquer payée une
-- conversion absente du montant versé.
--
-- pending_amount est décrémenté du montant réellement réglé au lieu d'être
-- forcé à zéro : une conversion arrivée après la réclamation reste ainsi due,
-- au lieu d'être effacée du compteur.
-- ============================================================================
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
  v_agency_id uuid;
  v_payout_id uuid;
BEGIN
  SELECT venue_id, organizer_user_id, agency_id
    INTO v_venue_id, v_org_id, v_agency_id
  FROM promoters WHERE id = p_promoter_id;

  -- Les promoteurs d'agence sont réglés par l'agence, pas par le club.
  IF v_agency_id IS NOT NULL THEN
    RAISE EXCEPTION 'agency-managed promoter must be settled by the agency';
  END IF;

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

  -- Réclamation atomique : le montant versé est, par construction, exactement
  -- la somme des lignes passées à « payée » par CETTE exécution.
  WITH claimed AS (
    UPDATE promoter_conversions
    SET status = 'paid', paid_at = now()
    WHERE promoter_id = p_promoter_id AND status = 'pending'
    RETURNING commission
  )
  SELECT COALESCE(SUM(commission), 0), COUNT(*) INTO v_amount, v_count FROM claimed;

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

  UPDATE promoters
  SET pending_amount = GREATEST(COALESCE(pending_amount, 0) - v_amount, 0),
      total_paid = COALESCE(total_paid, 0) + v_amount,
      updated_at = now()
  WHERE id = p_promoter_id;

  RETURN jsonb_build_object('settled', true, 'payout_id', v_payout_id, 'amount', v_amount, 'count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_promoter_payout(uuid, text) TO authenticated;

-- ============================================================================
-- 2. promoter_payouts : « voir les finances » ne doit pas donner le droit
--    d'écrire.
--
-- La policy organisateur était FOR ALL : un membre d'équipe porteur de la
-- permission view_finance — intitulé de LECTURE — pouvait réécrire un montant
-- ou supprimer des lignes d'historique de paiement directement via l'API.
-- Incohérent avec settle_promoter_payout, qui exige is_organizer_promoter_admin.
--
-- On sépare : lecture pour view_finance + admin, écriture réservée à l'admin.
-- ============================================================================
-- Idempotent : un autre fichier de migration partage cet horodatage (collision
-- de timestamp entre deux chantiers du meme jour), donc la CLI peut rejouer
-- celui-ci. Sans ces DROP, le rejeu echoue en 42710 et bloque toute la file.
DROP POLICY IF EXISTS "Organizer can manage own payouts" ON public.promoter_payouts;
DROP POLICY IF EXISTS "Organizer can view own payouts" ON public.promoter_payouts;
DROP POLICY IF EXISTS "Organizer admins can write own payouts" ON public.promoter_payouts;

CREATE POLICY "Organizer can view own payouts"
ON public.promoter_payouts FOR SELECT
TO authenticated
USING (
  organizer_user_id IS NOT NULL
  AND (
    auth.uid() = organizer_user_id
    OR public.is_organizer_promoter_admin(auth.uid(), organizer_user_id)
    OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'view_finance')
  )
);

CREATE POLICY "Organizer admins can write own payouts"
ON public.promoter_payouts FOR ALL
TO authenticated
USING (
  organizer_user_id IS NOT NULL
  AND (
    auth.uid() = organizer_user_id
    OR public.is_organizer_promoter_admin(auth.uid(), organizer_user_id)
  )
)
WITH CHECK (
  organizer_user_id IS NOT NULL
  AND (
    auth.uid() = organizer_user_id
    OR public.is_organizer_promoter_admin(auth.uid(), organizer_user_id)
  )
);
