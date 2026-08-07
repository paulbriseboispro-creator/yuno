-- Handshake lineup ↔ booking : jusqu'ici les deux systèmes vivaient en parallèle.
-- Ajouter un DJ au line-up (event_djs) n'envoyait aucune demande au DJ, et une
-- demande de booking acceptée (dj_booking_requests → dj_sets) n'apparaissait
-- jamais sur l'affiche publique (EventDetails et la page publique du DJ lisent
-- tous deux event_djs). Cette migration soude les deux :
--
--   1. accept_dj_booking_request : quand la demande est liée à une soirée,
--      l'acceptation inscrit aussi le DJ au line-up public (event_djs).
--   2. cancel_dj_booking_request : annuler une demande acceptée retire le DJ
--      du line-up qu'elle avait inscrit (en plus du set futur déjà supprimé).
--   3. notify_organizer_dj_booking_response : la réponse du DJ notifie aussi
--      les clubs (staff_notifications) — jusqu'ici seuls les organisateurs
--      étaient prévenus, un owner n'apprenait l'acceptation qu'en rouvrant la page.

-- ── 1. Accept : inscrire le DJ au line-up public de la soirée liée ─────────────
CREATE OR REPLACE FUNCTION public.accept_dj_booking_request(p_id uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r       public.dj_booking_requests%ROWTYPE;
  v_src   public.djs%ROWTYPE;
  v_dj_id uuid;
  v_set_id uuid;
  v_start timestamptz;
  v_end   timestamptz;
BEGIN
  SELECT * INTO r FROM public.dj_booking_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.dj_user_id <> auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  IF r.expires_at < now() THEN
    UPDATE public.dj_booking_requests SET status = 'expired', updated_at = now() WHERE id = p_id;
    RAISE EXCEPTION 'Request has expired';
  END IF;

  -- Résout (ou crée) la ligne djs SOUS LE SCOPE DU BOOKER pour cette personne.
  IF r.venue_id IS NOT NULL THEN
    SELECT id INTO v_dj_id FROM public.djs
      WHERE user_id = r.dj_user_id AND venue_id = r.venue_id LIMIT 1;
  ELSE
    SELECT id INTO v_dj_id FROM public.djs
      WHERE user_id = r.dj_user_id AND organizer_user_id = r.organizer_user_id LIMIT 1;
  END IF;

  IF v_dj_id IS NULL THEN
    SELECT * INTO v_src FROM public.djs
      WHERE user_id = r.dj_user_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    INSERT INTO public.djs (user_id, venue_id, organizer_user_id, first_name, last_name,
                            stage_name, music_genres, is_active)
    VALUES (r.dj_user_id, r.venue_id, r.organizer_user_id,
            COALESCE(v_src.first_name, ''), COALESCE(v_src.last_name, ''), v_src.stage_name,
            COALESCE(v_src.music_genres, '{}'), true)
    RETURNING id INTO v_dj_id;
  END IF;

  v_start := COALESCE(r.start_time, r.requested_date::timestamptz + interval '22 hours');
  v_end   := COALESCE(r.end_time,   r.requested_date::timestamptz + interval '28 hours');

  INSERT INTO public.dj_sets (dj_id, venue_id, organizer_user_id, event_id, title, start_time, end_time, fee)
  VALUES (v_dj_id, r.venue_id, r.organizer_user_id, r.event_id,
          COALESCE(r.message, 'Booking'), v_start, v_end, COALESCE(r.agreed_fee, 0))
  RETURNING id INTO v_set_id;

  -- Demande liée à une soirée : l'acceptation vaut inscription au line-up public.
  -- Garde anti-doublon par PERSONNE (une autre ligne djs du même artiste peut
  -- déjà être à l'affiche via un ajout direct sous un autre scope).
  IF r.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_djs ed
    JOIN public.djs d ON d.id = ed.dj_id
    WHERE ed.event_id = r.event_id AND d.user_id = r.dj_user_id
  ) THEN
    INSERT INTO public.event_djs (event_id, dj_id)
    VALUES (r.event_id, v_dj_id)
    ON CONFLICT (event_id, dj_id) DO NOTHING;
  END IF;

  UPDATE public.dj_booking_requests
     SET status = 'accepted', dj_response_note = NULLIF(btrim(p_note), ''),
         responded_at = now(), created_dj_set_id = v_set_id, updated_at = now()
   WHERE id = p_id;

  RETURN v_set_id;
END; $$;

-- ── 2. Cancel : retirer le DJ du line-up inscrit par l'acceptation ─────────────
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

-- ── 3. Réponse du DJ : notifier aussi les clubs, pas seulement les organisateurs ─
CREATE OR REPLACE FUNCTION public.notify_organizer_dj_booking_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dj_name TEXT;
  date_str TEXT;
BEGIN
  -- Seules les transitions pending -> accepted/declined émettent une notification.
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('accepted', 'declined') THEN RETURN NEW; END IF;

  SELECT COALESCE(
           d.stage_name,
           NULLIF(TRIM(CONCAT_WS(' ', d.first_name, d.last_name)), ''),
           NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
           'Le DJ'
         )
    INTO dj_name
    FROM public.profiles p
    LEFT JOIN public.djs d ON d.user_id = p.id
   WHERE p.id = NEW.dj_user_id;

  date_str := to_char(NEW.requested_date, 'DD/MM/YYYY');

  IF NEW.organizer_user_id IS NOT NULL THEN
    INSERT INTO public.organizer_notifications (
      organizer_user_id, event_id, notification_type, title, message,
      priority, reference_type, reference_id, metadata
    ) VALUES (
      NEW.organizer_user_id,
      NEW.event_id,
      CASE WHEN NEW.status = 'accepted' THEN 'dj_booking_accepted' ELSE 'dj_booking_declined' END,
      CASE WHEN NEW.status = 'accepted'
           THEN 'Booking DJ accepté'
           ELSE 'Booking DJ décliné' END,
      CASE WHEN NEW.status = 'accepted'
           THEN COALESCE(dj_name, 'Le DJ') || ' a accepté ta demande pour le ' || date_str
           ELSE COALESCE(dj_name, 'Le DJ') || ' a décliné ta demande pour le ' || date_str END,
      CASE WHEN NEW.status = 'accepted' THEN 'high' ELSE 'normal' END,
      'dj_booking_request',
      NEW.id,
      jsonb_build_object('dj_user_id', NEW.dj_user_id, 'dj_name', dj_name, 'requested_date', NEW.requested_date, 'status', NEW.status)
    );
  ELSIF NEW.venue_id IS NOT NULL THEN
    -- Cloche du dashboard club. Une notification qui échoue ne doit jamais
    -- faire échouer l'acceptation elle-même.
    BEGIN
      INSERT INTO public.staff_notifications (
        venue_id, event_id, target_role, notification_type, title, message,
        priority, reference_type, reference_id, metadata
      ) VALUES (
        NEW.venue_id,
        NEW.event_id,
        'owner',
        CASE WHEN NEW.status = 'accepted' THEN 'dj_booking_accepted' ELSE 'dj_booking_declined' END,
        CASE WHEN NEW.status = 'accepted'
             THEN 'Booking DJ accepté'
             ELSE 'Booking DJ décliné' END,
        CASE WHEN NEW.status = 'accepted'
             THEN COALESCE(dj_name, 'Le DJ') || ' a accepté ta demande pour le ' || date_str
             ELSE COALESCE(dj_name, 'Le DJ') || ' a décliné ta demande pour le ' || date_str END,
        CASE WHEN NEW.status = 'accepted' THEN 'high' ELSE 'normal' END,
        'dj_booking_request',
        NEW.id,
        jsonb_build_object('dj_user_id', NEW.dj_user_id, 'dj_name', dj_name, 'requested_date', NEW.requested_date, 'status', NEW.status)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;
