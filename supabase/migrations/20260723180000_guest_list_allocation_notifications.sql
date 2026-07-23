-- =====================================================================
-- Demande d'allocation guest list — notifications DANS LA CLOCHE.
--
-- Une demande qui n'existe que sur la page Guest list n'est pas vue. On la pose
-- là où le club regarde déjà : sa cloche (staff_notifications, target_role
-- 'owner'). Et on ferme la boucle : l'organisateur est notifié de la décision
-- dans SA cloche (organizer_notifications).
--
-- NB : insérer une ligne staff_notifications alimente la cloche in-app ; le PUSH
-- reste soumis à l'allowlist du trigger d'envoi (hors périmètre ici).
-- =====================================================================

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
  v_venue text;
  v_event_title text;
  v_who text;
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

  -- Cloche du club : c'est lui qui doit trancher.
  SELECT COALESCE(e.venue_id, e.partner_venue_id), e.title
    INTO v_venue, v_event_title
    FROM public.events e WHERE e.id = p_event_id;

  SELECT COALESCE(NULLIF(op.display_name, ''), 'Un organisateur') INTO v_who
    FROM public.organizer_profiles op WHERE op.user_id = v_uid;

  IF v_venue IS NOT NULL THEN
    INSERT INTO public.staff_notifications (
      venue_id, target_role, notification_type, title, message, priority, event_id, reference_type, reference_id, metadata
    ) VALUES (
      v_venue, 'owner', 'guest_list_allocation_request',
      'Demande de guest list',
      COALESCE(v_who, 'Un organisateur') || ' demande ' || v_total || ' places sur « ' || COALESCE(v_event_title, 'la soirée') || ' »',
      'high', p_event_id, 'guest_list_allocation_request', v_id,
      jsonb_build_object('requested_quota', v_total, 'requester_user_id', v_uid)
    );
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_guest_list_allocation(uuid, integer, integer, integer, integer, integer, time, text) TO authenticated;

-- Décision : on prévient l'organisateur dans SA cloche ------------------------
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
  v_event_title text;
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

  SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_req.event_id;

  IF NOT p_approve THEN
    UPDATE public.guest_list_allocation_requests
       SET status = 'denied', decision_note = p_decision_note,
           decided_by = v_uid, decided_at = now()
     WHERE id = p_request_id;

    INSERT INTO public.organizer_notifications (
      organizer_user_id, notification_type, title, message, priority, event_id, reference_type, reference_id
    ) VALUES (
      v_req.requester_user_id, 'guest_list_allocation_denied',
      'Demande de guest list refusée',
      'Le club a refusé ta demande sur « ' || COALESCE(v_event_title, 'la soirée') || ' »'
        || COALESCE(' — ' || NULLIF(p_decision_note, ''), ''),
      'normal', v_req.event_id, 'guest_list_allocation_request', p_request_id
    );
    RETURN;
  END IF;

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

  INSERT INTO public.organizer_notifications (
    organizer_user_id, notification_type, title, message, priority, event_id, reference_type, reference_id
  ) VALUES (
    v_req.requester_user_id, 'guest_list_allocation_granted',
    'Guest list accordée',
    'Le club t''accorde ' || v_total || ' places sur « ' || COALESCE(v_event_title, 'la soirée') || ' »',
    'high', v_req.event_id, 'guest_list_allocation_request', p_request_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.decide_guest_list_allocation_request(uuid, boolean, integer, integer, integer, text) TO authenticated;
