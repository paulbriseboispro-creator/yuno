-- Système d'agence autonome — Phase 1 (3/4) : RPC de gestion du contrat
-- agence ↔ club/organisateur. Double-signature : le contrat n'est 'active'
-- (donc opérant) qu'une fois signé des deux côtés. Toutes SECURITY DEFINER
-- (bypass RLS, contrôle d'autorisation explicite à l'intérieur).

-- ---------------------------------------------------------------------------
-- create_agency_venue_contract : l'initiateur (agence OU club/orga) crée le
-- contrat et signe automatiquement son propre côté. Exactement un de
-- p_venue_id / p_organizer_user_id doit être fourni.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agency_venue_contract(
  p_agency_id uuid,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_override_type text DEFAULT NULL,
  p_override_value numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_agency boolean;
  v_is_club boolean;
  v_contract_id uuid;
  v_now timestamptz := now();
BEGIN
  IF (p_venue_id IS NOT NULL)::int + (p_organizer_user_id IS NOT NULL)::int <> 1 THEN
    RAISE EXCEPTION 'exactly one of venue_id / organizer_user_id required';
  END IF;

  v_is_agency := public.is_agency_owner(auth.uid(), p_agency_id);
  v_is_club := (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
            OR (p_organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), p_organizer_user_id));

  IF NOT (v_is_agency OR v_is_club) THEN
    RAISE EXCEPTION 'not authorized to create this agency contract';
  END IF;

  INSERT INTO public.agency_venue_contracts (
    agency_id, venue_id, organizer_user_id, status,
    override_type, override_value, created_by,
    agency_signed_at, agency_signed_by, club_signed_at, club_signed_by
  ) VALUES (
    p_agency_id, p_venue_id, p_organizer_user_id, 'pending_signatures',
    p_override_type, COALESCE(p_override_value, 0), auth.uid(),
    CASE WHEN v_is_agency THEN v_now END, CASE WHEN v_is_agency THEN auth.uid() END,
    CASE WHEN v_is_club THEN v_now END, CASE WHEN v_is_club THEN auth.uid() END
  )
  RETURNING id INTO v_contract_id;

  RETURN v_contract_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- sign_agency_venue_contract : la partie qui n'a pas encore signé appose sa
-- signature. Quand les deux ont signé → 'active'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sign_agency_venue_contract(p_contract_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.agency_venue_contracts%ROWTYPE;
  v_is_agency boolean;
  v_is_club boolean;
  v_now timestamptz := now();
  v_new_status text;
BEGIN
  SELECT * INTO c FROM public.agency_venue_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found';
  END IF;
  IF c.status NOT IN ('draft','pending_signatures') THEN
    RAISE EXCEPTION 'contract not signable in status %', c.status;
  END IF;

  v_is_agency := public.is_agency_owner(auth.uid(), c.agency_id);
  v_is_club := (c.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), c.venue_id))
            OR (c.organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), c.organizer_user_id));

  IF NOT (v_is_agency OR v_is_club) THEN
    RAISE EXCEPTION 'not authorized to sign this contract';
  END IF;

  IF v_is_agency AND c.agency_signed_at IS NULL THEN
    UPDATE public.agency_venue_contracts
    SET agency_signed_at = v_now, agency_signed_by = auth.uid(), updated_at = v_now
    WHERE id = p_contract_id;
  ELSIF v_is_club AND c.club_signed_at IS NULL THEN
    UPDATE public.agency_venue_contracts
    SET club_signed_at = v_now, club_signed_by = auth.uid(), updated_at = v_now
    WHERE id = p_contract_id;
  END IF;

  SELECT CASE
    WHEN agency_signed_at IS NOT NULL AND club_signed_at IS NOT NULL THEN 'active'
    ELSE 'pending_signatures'
  END INTO v_new_status
  FROM public.agency_venue_contracts WHERE id = p_contract_id;

  UPDATE public.agency_venue_contracts
  SET status = v_new_status, updated_at = v_now
  WHERE id = p_contract_id;

  RETURN v_new_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- set_agency_contract_status : pause / reprise / fin / annulation. L'une ou
-- l'autre des parties peut mettre en pause ou clore la relation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_agency_contract_status(
  p_contract_id uuid,
  p_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.agency_venue_contracts%ROWTYPE;
  v_authorized boolean;
BEGIN
  IF p_status NOT IN ('active','paused','ended','cancelled') THEN
    RAISE EXCEPTION 'invalid target status %', p_status;
  END IF;

  SELECT * INTO c FROM public.agency_venue_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found';
  END IF;

  v_authorized := public.is_agency_owner(auth.uid(), c.agency_id)
    OR (c.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), c.venue_id))
    OR (c.organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), c.organizer_user_id))
    OR public.is_super_admin();

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'not authorized to change this contract';
  END IF;

  -- On ne peut ré-activer que si les deux signatures sont présentes.
  IF p_status = 'active' AND (c.agency_signed_at IS NULL OR c.club_signed_at IS NULL) THEN
    RAISE EXCEPTION 'contract requires both signatures to activate';
  END IF;

  UPDATE public.agency_venue_contracts
  SET status = p_status, updated_at = now()
  WHERE id = p_contract_id;

  RETURN p_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_agency_venue_contract(uuid, text, uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_agency_venue_contract(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_agency_contract_status(uuid, text) TO authenticated;
