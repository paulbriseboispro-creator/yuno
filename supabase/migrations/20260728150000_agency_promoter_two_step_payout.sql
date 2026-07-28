-- ============================================================================
-- Règlement agence → promoteur : même cycle en trois temps que les clubs.
--
-- L'agence réglait ses promoteurs d'un clic (settle_agency_promoter_payout) :
-- la dette disparaissait sans IBAN affiché, sans référence de virement, sans
-- accusé de réception du promoteur. Exactement le trou que le cycle en trois
-- temps a fermé pour les clubs (migrations 20260720193000 / 20260721090000).
--
-- Désormais le chef d'agence PRÉPARE (IBAN + référence figés), vire depuis sa
-- banque, DÉCLARE l'avoir fait, et le promoteur ACCUSE RÉCEPTION — seule étape
-- qui solde les commissions. Concrètement :
--   • prepare_promoter_payout accepte les promoteurs agency-managed quand
--     l'appelant est le chef de l'agence (l'exception 'agency_managed' ne
--     visait que les CLUBS, qui n'ont pas à régler un promoteur d'agence).
--   • declare / resolve / cancel routent l'autorisation sur l'agence quand le
--     promoteur est agency-managed — le club de rattachement ne peut PAS
--     piloter un lot qui ne lui appartient pas, même si la ligne porte son
--     venue_id (contexte d'affichage historique conservé).
--   • settle_agency_promoter_payout est fermé (use_two_step_flow), comme
--     settle_promoter_payout avant lui.
--   • Le chef d'agence gagne la LECTURE des lots de ses promoteurs (l'écriture
--     directe reste bloquée par guard_promoter_payout_write).
-- ============================================================================

-- ── 1. Préparer : ouvrir le cycle aux promoteurs d'agence ───────────────────
CREATE OR REPLACE FUNCTION public.prepare_promoter_payout(
  p_promoter_id uuid,
  p_period_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_agency_id uuid;
  v_iban text;
  v_bic text;
  v_iban_changed timestamptz;
  v_amount numeric;
  v_count int;
  v_payout_id uuid;
  v_ref text;
BEGIN
  SELECT venue_id, organizer_user_id, agency_id, iban, bic, iban_changed_at
    INTO v_venue_id, v_org_id, v_agency_id, v_iban, v_bic, v_iban_changed
  FROM promoters WHERE id = p_promoter_id;

  -- Un promoteur d'agence est réglé par SON agence ; un promoteur direct par
  -- son club ou son organisateur. Jamais l'inverse.
  IF v_agency_id IS NOT NULL THEN
    IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'promoter_not_found';
  END IF;

  -- Sans IBAN, le payeur n'a nulle part où virer : préparer un lot n'aurait
  -- aucun sens et bloquerait les commissions dans un lot inutilisable.
  IF v_iban IS NULL OR length(trim(v_iban)) < 8 THEN
    RAISE EXCEPTION 'promoter_iban_missing';
  END IF;

  -- Gel anti-détournement.
  IF v_iban_changed IS NOT NULL AND v_iban_changed > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'iban_recently_changed';
  END IF;

  -- Un seul lot ouvert à la fois. 'disputed' compte comme ouvert : on ne
  -- prépare pas un nouveau règlement tant qu'un litige n'est pas tranché.
  IF EXISTS (
    SELECT 1 FROM promoter_payouts
    WHERE promoter_id = p_promoter_id AND status IN ('pending', 'approved', 'disputed')
  ) THEN
    RAISE EXCEPTION 'payout_already_open';
  END IF;

  v_ref := public.build_payout_reference(p_promoter_id);

  INSERT INTO promoter_payouts (
    promoter_id, venue_id, organizer_user_id, amount, status, period_label, transfer_reference
  ) VALUES (
    p_promoter_id, v_venue_id, v_org_id, 0, 'pending',
    COALESCE(p_period_label, 'Reglement ' || to_char(now(), 'DD/MM/YYYY')),
    v_ref
  )
  RETURNING id INTO v_payout_id;

  -- Rattachement atomique des commissions dues et non déjà rattachées.
  WITH claimed AS (
    INSERT INTO promoter_payout_items (payout_id, conversion_id, commission)
    SELECT v_payout_id, pc.id, COALESCE(pc.commission, 0)
    FROM promoter_conversions pc
    WHERE pc.promoter_id = p_promoter_id
      AND pc.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM promoter_payout_items i WHERE i.conversion_id = pc.id)
    RETURNING commission
  )
  SELECT COALESCE(SUM(commission), 0), COUNT(*) INTO v_amount, v_count FROM claimed;

  IF v_count = 0 OR v_amount <= 0 THEN
    DELETE FROM promoter_payouts WHERE id = v_payout_id;
    RETURN jsonb_build_object('prepared', false, 'reason', 'nothing_pending');
  END IF;

  UPDATE promoter_payouts SET amount = v_amount WHERE id = v_payout_id;

  RETURN jsonb_build_object(
    'prepared', true, 'payout_id', v_payout_id,
    'amount', v_amount, 'count', v_count,
    'iban', v_iban, 'bic', v_bic, 'reference', v_ref
  );
END;
$fn$;

-- ── 2. Déclarer : autorisation routée sur l'agence si agency-managed ────────
CREATE OR REPLACE FUNCTION public.declare_promoter_payout_sent(
  p_payout_id uuid,
  p_confirm_days int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_agency_id uuid;
  v_status text;
  v_due timestamptz;
  v_days int;
BEGIN
  SELECT pp.venue_id, pp.organizer_user_id, pp.status, p.agency_id
    INTO v_venue_id, v_org_id, v_status, v_agency_id
  FROM promoter_payouts pp
  JOIN promoters p ON p.id = pp.promoter_id
  WHERE pp.id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payout_not_prepared'; END IF;

  IF v_agency_id IS NOT NULL THEN
    IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  v_days := LEAST(GREATEST(COALESCE(p_confirm_days, 5), 2), 30);
  v_due := now() + make_interval(days => v_days);

  UPDATE promoter_payouts
  SET status = 'approved', approved_at = now(), approved_by = auth.uid(), confirm_due_at = v_due
  WHERE id = p_payout_id;

  RETURN jsonb_build_object('declared', true, 'payout_id', p_payout_id, 'confirm_due_at', v_due);
END;
$fn$;

-- ── 3. Sortie de litige : même routage ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_promoter_payout_dispute(
  p_payout_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_agency_id uuid;
  v_status text;
  v_due timestamptz;
BEGIN
  SELECT pp.venue_id, pp.organizer_user_id, pp.status, p.agency_id
    INTO v_venue_id, v_org_id, v_status, v_agency_id
  FROM promoter_payouts pp
  JOIN promoters p ON p.id = pp.promoter_id
  WHERE pp.id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;
  IF v_status <> 'disputed' THEN RAISE EXCEPTION 'payout_not_disputed'; END IF;

  IF v_agency_id IS NOT NULL THEN
    IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  IF p_action = 'redeclare' THEN
    v_due := now() + interval '5 days';
    UPDATE promoter_payouts
    SET status = 'approved', disputed_at = NULL, dispute_reason = NULL, confirm_due_at = v_due
    WHERE id = p_payout_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'redeclare', 'confirm_due_at', v_due);

  ELSIF p_action = 'cancel' THEN
    -- Les items partent en cascade : les commissions redeviennent rattachables.
    DELETE FROM promoter_payouts WHERE id = p_payout_id;
    RETURN jsonb_build_object('resolved', true, 'action', 'cancel');
  END IF;

  RAISE EXCEPTION 'unknown_action';
END;
$fn$;

-- ── 4. Annulation d'un lot préparé : même routage ───────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_promoter_payout(p_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id text;
  v_org_id uuid;
  v_agency_id uuid;
  v_status text;
BEGIN
  SELECT pp.venue_id, pp.organizer_user_id, pp.status, p.agency_id
    INTO v_venue_id, v_org_id, v_status, v_agency_id
  FROM promoter_payouts pp
  JOIN promoters p ON p.id = pp.promoter_id
  WHERE pp.id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;

  -- Un virement déjà déclaré ne s'annule pas d'un clic : soit le promoteur
  -- confirme, soit il conteste et le payeur tranche via le litige.
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'payout_not_cancellable'; END IF;

  IF v_agency_id IS NOT NULL THEN
    IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), v_venue_id) OR public.can_manage_venue(auth.uid(), v_venue_id)) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  ELSIF v_org_id IS NOT NULL THEN
    IF auth.uid() <> v_org_id AND NOT public.is_organizer_promoter_admin(auth.uid(), v_org_id) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  DELETE FROM promoter_payouts WHERE id = p_payout_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$fn$;

-- ── 5. L'ancien règlement agence en un clic ne court-circuite plus le cycle ──
-- Même fermeture que settle_promoter_payout : la fonction reste appelable
-- (aucun front cassé en 404 RPC) mais lève un code stable que le front traduit.
CREATE OR REPLACE FUNCTION public.settle_agency_promoter_payout(
  p_promoter_id uuid,
  p_period_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RAISE EXCEPTION 'use_two_step_flow'
    USING HINT = 'Le règlement agence passe par prepare_promoter_payout → declare_promoter_payout_sent → accusé de réception du promoteur.';
END;
$fn$;

-- ── 6. Lecture : le chef d'agence voit les lots de SES promoteurs ───────────
-- L'écriture directe reste bloquée par guard_promoter_payout_write (trigger
-- SECURITY INVOKER) : seules les RPC DEFINER ci-dessus font avancer un lot.
DROP POLICY IF EXISTS "Agency owner can view own promoters payouts" ON public.promoter_payouts;
CREATE POLICY "Agency owner can view own promoters payouts"
ON public.promoter_payouts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.id = promoter_payouts.promoter_id
      AND p.agency_id IS NOT NULL
      AND public.is_agency_owner(auth.uid(), p.agency_id)
  )
);
