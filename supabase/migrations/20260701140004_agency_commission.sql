-- Système d'agence autonome — Phase 1 (4/4) : cascade de commission + règlement.
--
-- Cascade à 2 niveaux (grand-livre) :
--   • le moteur existant calcule la commission du promoteur = son NET (fixé par
--     l'agence sur la ligne promoteur) → promoters.pending_amount += net.
--   • ce trigger enregistre, pour chaque vente d'un promoteur d'agence, une
--     ligne agency_conversions : brut (dû par le club à l'agence) = net + marge,
--     marge (gain agence) selon le contrat actif du club.
--
-- Le trigger est posé sur promoter_conversions → il capte AUTOMATIQUEMENT les
-- deux chemins de commission (RPC guest-list ET insert inline des billets
-- payants dans create-ticket-checkout). Il est volontairement NON bloquant
-- (aucun RAISE) pour ne jamais faire échouer un paiement.

-- ---------------------------------------------------------------------------
-- Trigger : marge agence au moment où une conversion promoteur est créée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_agency_margin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency_id uuid;
  v_venue_id text;
  v_org_id uuid;
  v_ov_type text;
  v_ov_value numeric;
  v_net numeric;
  v_margin numeric := 0;
BEGIN
  -- Lignes de base uniquement (on ignore les lignes 'override' chef d'équipe et
  -- toute ligne dérivée), et seulement si une commission réelle existe.
  IF NEW.conversion_type = 'override' OR NEW.parent_conversion_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.commission, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT agency_id, venue_id, organizer_user_id
    INTO v_agency_id, v_venue_id, v_org_id
  FROM promoters WHERE id = NEW.promoter_id;

  IF v_agency_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Marge définie par le contrat ACTIF entre l'agence et le club/orga du promoteur.
  IF v_venue_id IS NOT NULL THEN
    SELECT override_type, override_value INTO v_ov_type, v_ov_value
    FROM agency_venue_contracts
    WHERE agency_id = v_agency_id AND venue_id = v_venue_id AND status = 'active'
    LIMIT 1;
  ELSIF v_org_id IS NOT NULL THEN
    SELECT override_type, override_value INTO v_ov_type, v_ov_value
    FROM agency_venue_contracts
    WHERE agency_id = v_agency_id AND organizer_user_id = v_org_id AND status = 'active'
    LIMIT 1;
  END IF;

  v_net := NEW.commission;
  IF v_ov_type IS NOT NULL AND COALESCE(v_ov_value, 0) > 0 THEN
    v_margin := CASE WHEN v_ov_type = 'percentage'
      THEN ROUND(v_net * v_ov_value / 100, 2)
      ELSE v_ov_value END;
  END IF;

  INSERT INTO agency_conversions (
    agency_id, promoter_id, source_conversion_id, event_id,
    venue_id, organizer_user_id, gross_amount, margin_amount, net_amount, club_status
  ) VALUES (
    v_agency_id, NEW.promoter_id, NEW.id, NEW.event_id,
    v_venue_id, v_org_id, v_net + v_margin, v_margin, v_net, 'pending'
  )
  ON CONFLICT (source_conversion_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_agency_margin ON public.promoter_conversions;
CREATE TRIGGER trg_apply_agency_margin
  AFTER INSERT ON public.promoter_conversions
  FOR EACH ROW EXECUTE FUNCTION public.apply_agency_margin();

-- ---------------------------------------------------------------------------
-- settle_agency_promoter_payout : l'AGENCE règle un de ses promoteurs
-- (agence → promoteur). Agrège les conversions 'pending' du promoteur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_agency_promoter_payout(
  p_promoter_id uuid,
  p_period_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency_id uuid;
  v_venue_id text;
  v_org_id uuid;
  v_amount numeric;
  v_count int;
  v_payout_id uuid;
BEGIN
  SELECT agency_id, venue_id, organizer_user_id
    INTO v_agency_id, v_venue_id, v_org_id
  FROM promoters WHERE id = p_promoter_id;

  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'not an agency-managed promoter';
  END IF;
  IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
    RAISE EXCEPTION 'not authorized to settle this promoter';
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
    COALESCE(p_period_label, 'Versement agence ' || to_char(now(), 'DD/MM/YYYY')),
    now(), auth.uid(), now(), auth.uid()
  )
  RETURNING id INTO v_payout_id;

  UPDATE promoter_conversions
  SET status = 'paid', paid_at = now()
  WHERE promoter_id = p_promoter_id AND status = 'pending';

  UPDATE promoters
  SET pending_amount = 0, total_paid = COALESCE(total_paid, 0) + v_amount, updated_at = now()
  WHERE id = p_promoter_id;

  RETURN jsonb_build_object('settled', true, 'payout_id', v_payout_id, 'amount', v_amount, 'count', v_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- settle_club_to_agency : le CLUB/ORGA règle ce qu'il doit à l'agence
-- (club → agence). Solde le brut des conversions agence non encore réglées.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_club_to_agency(
  p_agency_id uuid,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
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
  v_payout_id uuid;
  v_authorized boolean;
BEGIN
  IF (p_venue_id IS NOT NULL)::int + (p_organizer_user_id IS NOT NULL)::int <> 1 THEN
    RAISE EXCEPTION 'exactly one of venue_id / organizer_user_id required';
  END IF;

  v_authorized := (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
    OR (p_organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), p_organizer_user_id));
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'not authorized to settle this agency';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    SELECT COALESCE(SUM(gross_amount), 0), COUNT(*) INTO v_amount, v_count
    FROM agency_conversions
    WHERE agency_id = p_agency_id AND venue_id = p_venue_id AND club_status = 'pending';
  ELSE
    SELECT COALESCE(SUM(gross_amount), 0), COUNT(*) INTO v_amount, v_count
    FROM agency_conversions
    WHERE agency_id = p_agency_id AND organizer_user_id = p_organizer_user_id AND club_status = 'pending';
  END IF;

  IF v_count = 0 OR v_amount <= 0 THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'nothing_pending');
  END IF;

  INSERT INTO agency_payouts (
    agency_id, venue_id, organizer_user_id, amount, status, period_label, paid_at, paid_by
  ) VALUES (
    p_agency_id, p_venue_id, p_organizer_user_id, v_amount, 'paid',
    COALESCE(p_period_label, 'Règlement club→agence ' || to_char(now(), 'DD/MM/YYYY')),
    now(), auth.uid()
  )
  RETURNING id INTO v_payout_id;

  IF p_venue_id IS NOT NULL THEN
    UPDATE agency_conversions SET club_status = 'paid', club_paid_at = now()
    WHERE agency_id = p_agency_id AND venue_id = p_venue_id AND club_status = 'pending';
  ELSE
    UPDATE agency_conversions SET club_status = 'paid', club_paid_at = now()
    WHERE agency_id = p_agency_id AND organizer_user_id = p_organizer_user_id AND club_status = 'pending';
  END IF;

  RETURN jsonb_build_object('settled', true, 'payout_id', v_payout_id, 'amount', v_amount, 'count', v_count);
END;
$$;

-- ---------------------------------------------------------------------------
-- Garde-fou : un promoteur géré par une agence NE DOIT PAS être réglé par le
-- club via settle_promoter_payout — c'est l'agence qui le paie. On redéfinit la
-- fonction existante avec ce seul contrôle ajouté (corps par ailleurs identique).
-- ---------------------------------------------------------------------------
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

  -- Nouveau : les promoteurs d'agence sont réglés par l'agence, pas par le club.
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

GRANT EXECUTE ON FUNCTION public.settle_agency_promoter_payout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_club_to_agency(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_promoter_payout(uuid, text) TO authenticated;
