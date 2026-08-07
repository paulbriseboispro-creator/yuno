-- Demande de booking DJ : push au DJ + accès managers.
--
-- 1. Clé 'dj_booking_request' dans le registre super admin
--    (/admin/notifications) : l'edge function notify-dj-booking-request pousse
--    le DJ sur son téléphone (app Yuno Pro) quand un club ou un organisateur
--    lui envoie une demande — jusqu'ici l'inbox était uniquement en pull, le
--    DJ ne découvrait la demande qu'en ouvrant son app.
-- 2. create/cancel_dj_booking_request s'ouvrent aux MANAGERS du club
--    (has_role 'manager' + get_user_venue_id), pas seulement au propriétaire :
--    un manager qui édite une soirée doit pouvoir envoyer le brief au DJ.
--    L'acceptation reste au DJ seul, le règlement du cachet reste inchangé.

INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  ('dj_booking_request', 'transactional')
ON CONFLICT (notification_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_dj_booking_request(
  p_dj_user_id        uuid,
  p_requested_date    date,
  p_start             timestamptz DEFAULT NULL,
  p_end               timestamptz DEFAULT NULL,
  p_agreed_fee        numeric     DEFAULT NULL,
  p_message           text        DEFAULT NULL,
  p_event_id          uuid        DEFAULT NULL,
  p_venue_id          text        DEFAULT NULL,
  p_organizer_user_id uuid        DEFAULT NULL,
  p_requested_genres  text[]      DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL)
     OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of venue or organizer scope is required';
  END IF;

  -- Scope club : propriétaire OU manager du même club.
  IF p_venue_id IS NOT NULL
     AND NOT public.is_venue_owner(auth.uid(), p_venue_id)
     AND NOT (public.has_role(auth.uid(), 'manager') AND public.get_user_venue_id(auth.uid()) = p_venue_id) THEN
    RAISE EXCEPTION 'Unauthorized: not the venue owner';
  END IF;
  IF p_organizer_user_id IS NOT NULL AND p_organizer_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: organizer scope mismatch';
  END IF;
  IF p_dj_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot book yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.djs WHERE user_id = p_dj_user_id AND is_active = true) THEN
    RAISE EXCEPTION 'Target is not an active DJ';
  END IF;

  INSERT INTO public.dj_booking_requests (
    venue_id, organizer_user_id, created_by, dj_user_id, requested_date,
    start_time, end_time, agreed_fee, message, event_id, requested_genres
  ) VALUES (
    p_venue_id, p_organizer_user_id, auth.uid(), p_dj_user_id, p_requested_date,
    p_start, p_end, p_agreed_fee, NULLIF(btrim(p_message), ''), p_event_id,
    COALESCE(p_requested_genres, '{}')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_dj_booking_request(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r public.dj_booking_requests%ROWTYPE;
  v_set_dj_id uuid;
BEGIN
  SELECT * INTO r FROM public.dj_booking_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (r.created_by = auth.uid()
          OR (r.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), r.venue_id))
          OR (r.venue_id IS NOT NULL AND public.has_role(auth.uid(), 'manager')
              AND public.get_user_venue_id(auth.uid()) = r.venue_id)
          OR (r.organizer_user_id IS NOT NULL AND r.organizer_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF r.status NOT IN ('pending', 'accepted') THEN RAISE EXCEPTION 'Cannot cancel this request'; END IF;

  -- Si déjà accepté, retire le set futur créé — et le line-up qui en découlait.
  -- On ne touche au line-up que si le set futur a bien été supprimé : une soirée
  -- passée reste affichée telle qu'elle a eu lieu.
  IF r.status = 'accepted' AND r.created_dj_set_id IS NOT NULL THEN
    DELETE FROM public.dj_sets WHERE id = r.created_dj_set_id AND start_time > now()
    RETURNING dj_id INTO v_set_dj_id;
    IF v_set_dj_id IS NOT NULL AND r.event_id IS NOT NULL THEN
      DELETE FROM public.event_djs WHERE event_id = r.event_id AND dj_id = v_set_dj_id;
    END IF;
  END IF;

  UPDATE public.dj_booking_requests SET status = 'cancelled', updated_at = now() WHERE id = p_id;
END; $$;
