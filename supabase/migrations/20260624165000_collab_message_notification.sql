-- =============================================================================
-- Notifier la partie adverse quand un partenaire écrit dans le fil de
-- communication d'une co-soirée (event_collab_messages).
--
-- Demande de Paul : un nouveau message d'un partenaire doit arriver dans le
-- centre de notifications (cloche + page). On écrit dans organizer_notifications
-- ou staff_notifications selon le destinataire, via notify_collab_party.
--
-- Anti-spam : un seul "Nouveau message" non-lu par fil. Tant que le destinataire
-- n'a pas lu la notif du fil, les messages suivants n'en recréent pas (il y a
-- déjà un badge). Dès qu'il l'a lue, le prochain message re-notifie.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_collab_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_venue_id text;
  v_org_id   uuid;
  v_title    text;
  v_actor    text;
  v_preview  text;
  v_pending  boolean;
BEGIN
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(NEW.event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN RETURN NEW; END IF;

  SELECT title INTO v_title FROM public.events WHERE id = NEW.event_id;
  v_title := COALESCE(v_title, 'une soirée');
  v_preview := left(regexp_replace(COALESCE(NEW.body, ''), '\s+', ' ', 'g'), 90);

  IF NEW.author_role = 'venue' THEN
    -- Émetteur = club → notifier l'organisateur.
    SELECT EXISTS (
      SELECT 1 FROM public.organizer_notifications
      WHERE organizer_user_id = v_org_id AND notification_type = 'collab_message'
        AND event_id = NEW.event_id AND read_at IS NULL
    ) INTO v_pending;
    IF v_pending THEN RETURN NEW; END IF;

    SELECT name INTO v_actor FROM public.venues WHERE id = v_venue_id;
    PERFORM public.notify_collab_party('organizer', v_venue_id, v_org_id, NEW.event_id,
      'collab_message', 'Nouveau message',
      COALESCE(v_actor, 'Le club') || ' · « ' || v_title || ' » : ' || v_preview,
      'normal', 'event_collab_message', NEW.id,
      jsonb_build_object('event_id', NEW.event_id, 'author_role', NEW.author_role));

  ELSIF NEW.author_role = 'organizer' THEN
    -- Émetteur = organisateur → notifier le club.
    SELECT EXISTS (
      SELECT 1 FROM public.staff_notifications
      WHERE venue_id = v_venue_id AND notification_type = 'collab_message'
        AND event_id = NEW.event_id AND read_at IS NULL
    ) INTO v_pending;
    IF v_pending THEN RETURN NEW; END IF;

    SELECT display_name INTO v_actor FROM public.organizer_profiles WHERE user_id = v_org_id;
    PERFORM public.notify_collab_party('venue', v_venue_id, v_org_id, NEW.event_id,
      'collab_message', 'Nouveau message',
      COALESCE(v_actor, 'L''organisateur') || ' · « ' || v_title || ' » : ' || v_preview,
      'normal', 'event_collab_message', NEW.id,
      jsonb_build_object('event_id', NEW.event_id, 'author_role', NEW.author_role));
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_collab_message ON public.event_collab_messages;
CREATE TRIGGER trg_notify_collab_message
  AFTER INSERT ON public.event_collab_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_collab_message();
