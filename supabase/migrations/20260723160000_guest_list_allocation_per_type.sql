-- =====================================================================
-- Demande d'allocation guest list — PAR TYPE d'entrée.
--
-- Une allocation ne se demande pas en bloc : l'organisateur veut « 10 standard
-- + 5 avec boisson + 2 table ». C'est le même modèle que les parts déléguées
-- (quota_normal / quota_drink / quota_table, total = somme, includes_drink
-- dérivé de drink > 0), donc la demande le porte à l'identique et le club
-- accorde type par type.
-- =====================================================================

ALTER TABLE public.guest_list_allocation_requests
  ADD COLUMN IF NOT EXISTS requested_quota_normal integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requested_quota_drink  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requested_quota_table  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS granted_quota_normal   integer,
  ADD COLUMN IF NOT EXISTS granted_quota_drink    integer,
  ADD COLUMN IF NOT EXISTS granted_quota_table    integer;

-- Reprise des demandes déjà déposées : tout en standard.
UPDATE public.guest_list_allocation_requests
   SET requested_quota_normal = requested_quota
 WHERE requested_quota_normal = 0
   AND requested_quota > 0;

-- Anciennes signatures remplacées (pas d'overload ambigu côté PostgREST).
DROP FUNCTION IF EXISTS public.request_guest_list_allocation(uuid, integer, integer, integer, time, boolean, text);
DROP FUNCTION IF EXISTS public.decide_guest_list_allocation_request(uuid, boolean, integer, text);

-- 1. L'organisateur dépose (ou remplace) sa demande, ventilée par type --------
CREATE OR REPLACE FUNCTION public.request_guest_list_allocation(
  p_event_id uuid,
  p_quota_normal integer DEFAULT 0,
  p_quota_drink integer DEFAULT 0,
  p_quota_table integer DEFAULT 0,
  p_quota_female integer DEFAULT NULL,
  p_quota_male integer DEFAULT NULL,
  p_free_before_time time DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total integer := COALESCE(p_quota_normal, 0) + COALESCE(p_quota_drink, 0) + COALESCE(p_quota_table, 0);
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Demandez au moins une place';
  END IF;
  IF COALESCE(p_quota_female, 0) + COALESCE(p_quota_male, 0) > v_total THEN
    RAISE EXCEPTION 'La répartition femmes/hommes dépasse le total demandé';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND (e.organizer_user_id = v_uid OR e.partner_organizer_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Vous n''êtes pas organisateur de cette soirée';
  END IF;

  IF public.can_manage_event_guestlist_house(v_uid, p_event_id) THEN
    RAISE EXCEPTION 'Vous tenez déjà l''opérationnel : gérez la guest list directement'
      USING HINT = 'Aucune demande nécessaire.';
  END IF;

  INSERT INTO public.guest_list_allocation_requests (
    event_id, requester_user_id, requested_quota,
    requested_quota_normal, requested_quota_drink, requested_quota_table,
    requested_quota_female, requested_quota_male,
    requested_free_before_time, requested_includes_drink, note
  )
  VALUES (
    p_event_id, v_uid, v_total,
    COALESCE(p_quota_normal, 0), COALESCE(p_quota_drink, 0), COALESCE(p_quota_table, 0),
    p_quota_female, p_quota_male,
    p_free_before_time, COALESCE(p_quota_drink, 0) > 0, p_note
  )
  ON CONFLICT (event_id, requester_user_id) WHERE status = 'pending'
  DO UPDATE SET
    requested_quota = EXCLUDED.requested_quota,
    requested_quota_normal = EXCLUDED.requested_quota_normal,
    requested_quota_drink = EXCLUDED.requested_quota_drink,
    requested_quota_table = EXCLUDED.requested_quota_table,
    requested_quota_female = EXCLUDED.requested_quota_female,
    requested_quota_male = EXCLUDED.requested_quota_male,
    requested_free_before_time = EXCLUDED.requested_free_before_time,
    requested_includes_drink = EXCLUDED.requested_includes_drink,
    note = EXCLUDED.note,
    created_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_guest_list_allocation(uuid, integer, integer, integer, integer, integer, time, text) TO authenticated;

-- 2. Le détenteur de l'opérationnel tranche, type par type -------------------
CREATE OR REPLACE FUNCTION public.decide_guest_list_allocation_request(
  p_request_id uuid,
  p_approve boolean,
  p_quota_normal integer DEFAULT NULL,
  p_quota_drink integer DEFAULT NULL,
  p_quota_table integer DEFAULT NULL,
  p_decision_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.guest_list_allocation_requests%ROWTYPE;
  v_n integer; v_d integer; v_t integer; v_total integer;
  v_venue text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT * INTO v_req FROM public.guest_list_allocation_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Cette demande a déjà été traitée';
  END IF;
  IF NOT public.can_manage_event_guestlist_house(v_uid, v_req.event_id) THEN
    RAISE EXCEPTION 'Seule la partie qui gère l''opérationnel peut répondre à cette demande';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.guest_list_allocation_requests
       SET status = 'denied', decision_note = p_decision_note,
           decided_by = v_uid, decided_at = now()
     WHERE id = p_request_id;
    RETURN;
  END IF;

  -- Sans précision, on accorde exactement ce qui a été demandé.
  v_n := COALESCE(p_quota_normal, v_req.requested_quota_normal);
  v_d := COALESCE(p_quota_drink,  v_req.requested_quota_drink);
  v_t := COALESCE(p_quota_table,  v_req.requested_quota_table);
  v_total := COALESCE(v_n, 0) + COALESCE(v_d, 0) + COALESCE(v_t, 0);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Quota accordé invalide';
  END IF;

  SELECT COALESCE(e.venue_id, e.partner_venue_id) INTO v_venue
    FROM public.events e WHERE e.id = v_req.event_id;

  INSERT INTO public.guest_lists (
    event_id, venue_id, organizer_user_id, holder_type, quota,
    quota_normal, quota_drink, quota_table,
    quota_female, quota_male, free_before_time, includes_drink,
    visible_on_club_page, is_active
  )
  VALUES (
    v_req.event_id, v_venue, v_req.requester_user_id, 'organizer', v_total,
    v_n, v_d, v_t,
    v_req.requested_quota_female, v_req.requested_quota_male,
    COALESCE(v_req.requested_free_before_time, '02:00'::time),
    v_d > 0, false, true
  )
  ON CONFLICT (event_id, organizer_user_id) WHERE holder_type = 'organizer'
  DO UPDATE SET
    quota = EXCLUDED.quota,
    quota_normal = EXCLUDED.quota_normal,
    quota_drink = EXCLUDED.quota_drink,
    quota_table = EXCLUDED.quota_table,
    quota_female = EXCLUDED.quota_female,
    quota_male = EXCLUDED.quota_male,
    free_before_time = EXCLUDED.free_before_time,
    includes_drink = EXCLUDED.includes_drink,
    is_active = true;

  UPDATE public.guest_list_allocation_requests
     SET status = 'approved', granted_quota = v_total,
         granted_quota_normal = v_n, granted_quota_drink = v_d, granted_quota_table = v_t,
         decision_note = p_decision_note, decided_by = v_uid, decided_at = now()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_guest_list_allocation_request(uuid, boolean, integer, integer, integer, text) TO authenticated;
