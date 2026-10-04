-- ============================================================================
-- Règlement des promoteurs d'un organisateur et création d'agence : anon ne
-- passe plus.
--
-- `IF auth.uid() <> v_org_id AND NOT is_organizer_promoter_admin(...)` : sans
-- session, la première moitié vaut NULL et la seconde ne peut que rendre NULL
-- ou vrai, donc le IF ne levait jamais. Même forme dans create_agency
-- (`v_owner <> auth.uid()`). Prouvé le 04/10 en transaction annulée :
-- prepare_promoter_payout passait la garde pour anon, et create_agency créait
-- une agence au nom d'un autre compte en lui donnant le rôle `agency`.
-- (cancel / declare / resolve étaient arrêtés plus loin par le verrou
-- guard_promoter_payout_write, pas par leur garde.)
-- Les tests deviennent `IS DISTINCT FROM`, la porte est lue par COALESCE, et
-- ces fonctions ne sont plus exécutables par anon. Les contrats et règlements
-- agence ↔ organisateur (create / sign_agency_venue_contract,
-- set_agency_contract_status, settle_club_to_agency) passaient aussi pour anon
-- par is_organizer_promoter_admin : leur porte est corrigée dans
-- 20261005210000, et ils ne sont plus exécutables par anon non plus.
-- Corps repris de la base liée (pg_get_functiondef, 04/10).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prepare_promoter_payout(p_promoter_id uuid, p_period_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF auth.uid() IS DISTINCT FROM v_org_id AND NOT COALESCE(public.is_organizer_promoter_admin(auth.uid(), v_org_id), false) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.cancel_promoter_payout(p_payout_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF auth.uid() IS DISTINCT FROM v_org_id AND NOT COALESCE(public.is_organizer_promoter_admin(auth.uid(), v_org_id), false) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;

  DELETE FROM promoter_payouts WHERE id = p_payout_id;
  RETURN jsonb_build_object('cancelled', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.declare_promoter_payout_sent(p_payout_id uuid, p_confirm_days integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF auth.uid() IS DISTINCT FROM v_org_id AND NOT COALESCE(public.is_organizer_promoter_admin(auth.uid(), v_org_id), false) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.resolve_promoter_payout_dispute(p_payout_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF auth.uid() IS DISTINCT FROM v_org_id AND NOT COALESCE(public.is_organizer_promoter_admin(auth.uid(), v_org_id), false) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.create_agency(p_name text, p_owner_user_id uuid DEFAULT NULL::uuid, p_city text DEFAULT NULL::text, p_slug text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_id uuid;
  v_email text;
BEGIN
  v_owner := COALESCE(p_owner_user_id, auth.uid());

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no owner resolved';
  END IF;
  IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized to create an agency for another user';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'agency name required';
  END IF;

  -- Idempotent : si l'owner a déjà une agence, la retourner au lieu d'en
  -- créer une deuxième (double submit, back-navigation…).
  SELECT id INTO v_id FROM public.agencies
  WHERE owner_user_id = v_owner
  ORDER BY created_at ASC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.agencies (owner_user_id, name, city, slug, contact_email)
  VALUES (v_owner, trim(p_name), p_city, NULLIF(trim(COALESCE(p_slug, '')), ''), p_contact_email)
  RETURNING id INTO v_id;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_owner;

  INSERT INTO public.user_roles (user_id, role, email)
  VALUES (v_owner, 'agency', v_email)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_id;
END;
$function$;


REVOKE ALL ON FUNCTION public.prepare_promoter_payout(p_promoter_id uuid, p_period_label text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_promoter_payout(p_promoter_id uuid, p_period_label text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_promoter_payout(p_payout_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_promoter_payout(p_payout_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.declare_promoter_payout_sent(p_payout_id uuid, p_confirm_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declare_promoter_payout_sent(p_payout_id uuid, p_confirm_days integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_promoter_payout_dispute(p_payout_id uuid, p_action text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_promoter_payout_dispute(p_payout_id uuid, p_action text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_agency(p_name text, p_owner_user_id uuid, p_city text, p_slug text, p_contact_email text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agency(p_name text, p_owner_user_id uuid, p_city text, p_slug text, p_contact_email text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_agency_venue_contract(p_agency_id uuid, p_venue_id text, p_organizer_user_id uuid, p_override_type text, p_override_value numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_agency_venue_contract(p_agency_id uuid, p_venue_id text, p_organizer_user_id uuid, p_override_type text, p_override_value numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sign_agency_venue_contract(p_contract_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_agency_venue_contract(p_contract_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_agency_contract_status(p_contract_id uuid, p_status text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agency_contract_status(p_contract_id uuid, p_status text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.settle_club_to_agency(p_agency_id uuid, p_venue_id text, p_organizer_user_id uuid, p_period_label text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_club_to_agency(p_agency_id uuid, p_venue_id text, p_organizer_user_id uuid, p_period_label text) TO authenticated, service_role;
