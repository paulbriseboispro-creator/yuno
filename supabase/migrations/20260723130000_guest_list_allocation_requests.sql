-- =====================================================================
-- Guest list en collaboration — ATTRIBUTION par demande + validation.
--
-- Quand le club tient l'opérationnel, il maîtrise la capacité de sa porte :
-- l'organisateur ne s'auto-alloue pas des places, il en DEMANDE. Le club
-- approuve (en ajustant le quota s'il veut) ou refuse. À l'accord, la part
-- « organizer » de l'orga est créée/mise à jour avec le quota accordé.
--
-- Trois briques :
--   1. holder_type 'organizer' — la part d'allocation de l'orga, distincte de
--      la part MAISON ('club') qui suit déjà le domaine operations.
--   2. guest_list_allocation_requests — la demande, avec son cycle de vie.
--   3. deux RPC (déposer / trancher) + un garde-fou : l'orga ne peut jamais
--      remonter lui-même le quota que le club lui a accordé.
-- =====================================================================

-- 1. Nouveau holder_type -----------------------------------------------------
ALTER TABLE public.guest_lists DROP CONSTRAINT IF EXISTS guest_lists_holder_type_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_holder_type_check
  CHECK (holder_type IN ('club', 'dj', 'promoter', 'custom', 'organizer'));

-- Une seule part d'allocation par (soirée, organisateur).
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_organizer_uniq
  ON public.guest_lists (event_id, organizer_user_id)
  WHERE holder_type = 'organizer';

-- 2. Les demandes ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_list_allocation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL,
  requested_quota integer NOT NULL CHECK (requested_quota > 0),
  requested_quota_female integer,
  requested_quota_male integer,
  requested_free_before_time time,
  requested_includes_drink boolean NOT NULL DEFAULT false,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  granted_quota integer,
  decision_note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Une seule demande EN ATTENTE par (soirée, demandeur) : une nouvelle demande
-- écrase la précédente plutôt que d'empiler une file.
CREATE UNIQUE INDEX IF NOT EXISTS glar_one_pending_per_requester
  ON public.guest_list_allocation_requests (event_id, requester_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS glar_event_status_idx
  ON public.guest_list_allocation_requests (event_id, status);

ALTER TABLE public.guest_list_allocation_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Requester views own allocation requests" ON public.guest_list_allocation_requests;
CREATE POLICY "Requester views own allocation requests"
ON public.guest_list_allocation_requests FOR SELECT TO authenticated
USING (requester_user_id = auth.uid());

DROP POLICY IF EXISTS "Operations holder views allocation requests" ON public.guest_list_allocation_requests;
CREATE POLICY "Operations holder views allocation requests"
ON public.guest_list_allocation_requests FOR SELECT TO authenticated
USING (public.can_manage_event_guestlist_house(auth.uid(), event_id));

-- Écriture uniquement via les RPC ci-dessous (SECURITY DEFINER).

-- 3a. RPC — l'organisateur dépose (ou remplace) sa demande -------------------
CREATE OR REPLACE FUNCTION public.request_guest_list_allocation(
  p_event_id uuid,
  p_quota integer,
  p_quota_female integer DEFAULT NULL,
  p_quota_male integer DEFAULT NULL,
  p_free_before_time time DEFAULT NULL,
  p_includes_drink boolean DEFAULT false,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  IF p_quota IS NULL OR p_quota <= 0 THEN
    RAISE EXCEPTION 'Quota demandé invalide';
  END IF;

  -- Seul un organisateur RATTACHÉ à la soirée peut demander.
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND (e.organizer_user_id = v_uid OR e.partner_organizer_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Vous n''êtes pas organisateur de cette soirée';
  END IF;

  -- Inutile de demander ce qu'on peut déjà faire soi-même.
  IF public.can_manage_event_guestlist_house(v_uid, p_event_id) THEN
    RAISE EXCEPTION 'Vous tenez déjà l''opérationnel : gérez la guest list directement'
      USING HINT = 'Aucune demande nécessaire.';
  END IF;

  INSERT INTO public.guest_list_allocation_requests (
    event_id, requester_user_id, requested_quota, requested_quota_female,
    requested_quota_male, requested_free_before_time, requested_includes_drink, note
  )
  VALUES (p_event_id, v_uid, p_quota, p_quota_female, p_quota_male,
          p_free_before_time, COALESCE(p_includes_drink, false), p_note)
  ON CONFLICT (event_id, requester_user_id) WHERE status = 'pending'
  DO UPDATE SET
    requested_quota = EXCLUDED.requested_quota,
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

GRANT EXECUTE ON FUNCTION public.request_guest_list_allocation(uuid, integer, integer, integer, time, boolean, text) TO authenticated;

-- 3b. RPC — le détenteur des opérations tranche ------------------------------
CREATE OR REPLACE FUNCTION public.decide_guest_list_allocation_request(
  p_request_id uuid,
  p_approve boolean,
  p_granted_quota integer DEFAULT NULL,
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
  v_quota integer;
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

  -- Seul le détenteur de l'opérationnel tranche.
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

  -- Le club peut accorder moins (ou plus) que demandé.
  v_quota := COALESCE(p_granted_quota, v_req.requested_quota);
  IF v_quota <= 0 THEN
    RAISE EXCEPTION 'Quota accordé invalide';
  END IF;

  SELECT COALESCE(e.venue_id, e.partner_venue_id) INTO v_venue
    FROM public.events e WHERE e.id = v_req.event_id;

  -- La part d'allocation de l'orga : créée, ou re-dimensionnée si elle existe.
  INSERT INTO public.guest_lists (
    event_id, venue_id, organizer_user_id, holder_type, quota,
    quota_female, quota_male, free_before_time, includes_drink,
    visible_on_club_page, is_active
  )
  VALUES (
    v_req.event_id, v_venue, v_req.requester_user_id, 'organizer', v_quota,
    v_req.requested_quota_female, v_req.requested_quota_male,
    COALESCE(v_req.requested_free_before_time, '02:00'::time),
    v_req.requested_includes_drink, false, true
  )
  ON CONFLICT (event_id, organizer_user_id) WHERE holder_type = 'organizer'
  DO UPDATE SET
    quota = EXCLUDED.quota,
    quota_female = EXCLUDED.quota_female,
    quota_male = EXCLUDED.quota_male,
    free_before_time = EXCLUDED.free_before_time,
    includes_drink = EXCLUDED.includes_drink,
    is_active = true;

  UPDATE public.guest_list_allocation_requests
     SET status = 'approved', granted_quota = v_quota, decision_note = p_decision_note,
         decided_by = v_uid, decided_at = now()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_guest_list_allocation_request(uuid, boolean, integer, text) TO authenticated;

-- 4. Garde-fou : l'orga ne remonte pas son propre quota -----------------------
-- La part 'organizer' est éditable par son porteur (ses invités, son horaire),
-- mais le QUOTA est fixé par le club : seul le détenteur de l'opérationnel le
-- change. Sinon l'accord ne vaudrait rien.
CREATE OR REPLACE FUNCTION public.guard_guest_list_house()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_house boolean;
  v_event uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_is_house := (OLD.holder_type = 'club');
    v_event := OLD.event_id;
  ELSE
    v_is_house := (OLD.holder_type = 'club' OR NEW.holder_type = 'club');
    v_event := NEW.event_id;
  END IF;

  IF v_is_house AND NOT public.can_manage_event_guestlist_house(auth.uid(), v_event) THEN
    RAISE EXCEPTION 'La guest list maison est tenue par la partie qui gère l''opérationnel'
      USING HINT = 'Proposez un avenant pour déplacer l''opérationnel, ou demandez une allocation.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.holder_type = 'organizer'
     AND NOT public.can_manage_event_guestlist_house(auth.uid(), NEW.event_id)
     AND (NEW.quota        IS DISTINCT FROM OLD.quota
       OR NEW.quota_female IS DISTINCT FROM OLD.quota_female
       OR NEW.quota_male   IS DISTINCT FROM OLD.quota_male
       OR NEW.quota_normal IS DISTINCT FROM OLD.quota_normal
       OR NEW.quota_drink  IS DISTINCT FROM OLD.quota_drink
       OR NEW.quota_table  IS DISTINCT FROM OLD.quota_table) THEN
    RAISE EXCEPTION 'Le quota de votre part est fixé par le club'
      USING HINT = 'Déposez une nouvelle demande d''allocation pour en obtenir plus.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
