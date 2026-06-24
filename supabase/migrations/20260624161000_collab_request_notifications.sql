-- =============================================================================
-- Notifier la PARTIE adverse quand une collaboration sur une soirée bouge.
--
-- Bug constaté (Paul) : un club qui propose de co-organiser une soirée à un
-- organisateur Yuno crée un `event_collab_contracts` (statut pending_signatures,
-- club pré-signé) — mais l'organisateur ne reçoit RIEN : aucune notif, aucune
-- entrée dans son centre de notifications. La proposition n'apparaissait que
-- dans un bandeau du dashboard org (OrgPendingProposals), invisible ailleurs.
--
-- On comble le trou avec deux triggers SECURITY DEFINER sur
-- event_collab_contracts :
--   • INSERT  → notifie la partie qui DOIT signer (collab_request).
--   • UPDATE  → quand le contrat passe `active` (les 2 ont signé), notifie le
--               proposeur que sa collab est confirmée (collab_accepted).
--
-- Symétrique : club→orga écrit dans organizer_notifications,
-- orga→club écrit dans staff_notifications (target_role 'owner'). Le centre de
-- notifs et la cloche lisent déjà ces deux tables (cf. src/lib/notifications.ts).
-- =============================================================================

-- ── Helper : poser une notif vers la bonne table selon le rôle destinataire ───
CREATE OR REPLACE FUNCTION public.notify_collab_party(
  p_recipient_role   text,        -- 'venue' | 'organizer'
  p_venue_id         text,
  p_organizer_user_id uuid,
  p_event_id         uuid,
  p_type             text,
  p_title            text,
  p_message          text,
  p_priority         text,
  p_reference_type   text,
  p_reference_id     uuid,
  p_metadata         jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_recipient_role = 'organizer' THEN
    IF p_organizer_user_id IS NULL THEN RETURN; END IF;
    INSERT INTO public.organizer_notifications (
      organizer_user_id, event_id, notification_type, title, message,
      priority, reference_type, reference_id, metadata
    ) VALUES (
      p_organizer_user_id, p_event_id, p_type, p_title, p_message,
      COALESCE(p_priority, 'normal'), p_reference_type, p_reference_id,
      COALESCE(p_metadata, '{}'::jsonb)
    );
  ELSE
    IF p_venue_id IS NULL THEN RETURN; END IF;
    INSERT INTO public.staff_notifications (
      venue_id, event_id, target_role, notification_type, title, message,
      reference_type, reference_id, priority, metadata
    ) VALUES (
      p_venue_id, p_event_id, 'owner', p_type, p_title, p_message,
      p_reference_type, p_reference_id, COALESCE(p_priority, 'normal'),
      COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;
END; $$;

-- ── Trigger 1 : un contrat de co-soirée est proposé → notifier le signataire ───
CREATE OR REPLACE FUNCTION public.notify_collab_contract_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event_title text;
  v_club_name   text;
  v_org_name    text;
BEGIN
  SELECT title INTO v_event_title FROM public.events WHERE id = NEW.event_id;
  SELECT name  INTO v_club_name  FROM public.venues WHERE id = NEW.venue_id;
  SELECT display_name INTO v_org_name
    FROM public.organizer_profiles WHERE user_id = NEW.organizer_user_id;
  v_event_title := COALESCE(v_event_title, 'une soirée');

  -- Club a pré-signé (venue_signed_at posé, org pas encore) → l'orga doit agir.
  IF NEW.org_signed_at IS NULL AND NEW.venue_signed_at IS NOT NULL THEN
    PERFORM public.notify_collab_party(
      'organizer', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_request', 'Nouvelle proposition de soirée',
      COALESCE(v_club_name, 'Un club') || ' te propose de co-organiser « ' || v_event_title || ' ». À toi de valider.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('venue_id', NEW.venue_id, 'club_name', v_club_name, 'event_id', NEW.event_id)
    );

  -- Orga a pré-signé → le club doit agir.
  ELSIF NEW.venue_signed_at IS NULL AND NEW.org_signed_at IS NOT NULL THEN
    PERFORM public.notify_collab_party(
      'venue', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_request', 'Nouvelle proposition de soirée',
      COALESCE(v_org_name, 'Un organisateur') || ' te propose de co-organiser « ' || v_event_title || ' ». À toi de valider.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('organizer_user_id', NEW.organizer_user_id, 'organizer_name', v_org_name, 'event_id', NEW.event_id)
    );
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_collab_contract_created ON public.event_collab_contracts;
CREATE TRIGGER trg_notify_collab_contract_created
  AFTER INSERT ON public.event_collab_contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_collab_contract_created();

-- ── Trigger 2 : le contrat devient `active` → notifier le proposeur ───────────
CREATE OR REPLACE FUNCTION public.notify_collab_contract_signed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_event_title text;
  v_club_name   text;
  v_org_name    text;
BEGIN
  IF NEW.status <> 'active' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title INTO v_event_title FROM public.events WHERE id = NEW.event_id;
  SELECT name  INTO v_club_name  FROM public.venues WHERE id = NEW.venue_id;
  SELECT display_name INTO v_org_name
    FROM public.organizer_profiles WHERE user_id = NEW.organizer_user_id;
  v_event_title := COALESCE(v_event_title, 'une soirée');

  -- created_by = le proposeur (il avait pré-signé). On le prévient que l'autre
  -- partie a accepté et que la billetterie peut ouvrir.
  IF NEW.created_by = NEW.organizer_user_id THEN
    -- L'orga avait proposé → le club a accepté → notifier l'orga.
    PERFORM public.notify_collab_party(
      'organizer', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_accepted', 'Collaboration confirmée',
      COALESCE(v_club_name, 'Le club') || ' a accepté de co-organiser « ' || v_event_title || ' ». La billetterie peut ouvrir.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('venue_id', NEW.venue_id, 'club_name', v_club_name, 'event_id', NEW.event_id)
    );
  ELSE
    -- Le club avait proposé → l'orga a accepté → notifier le club.
    PERFORM public.notify_collab_party(
      'venue', NEW.venue_id, NEW.organizer_user_id, NEW.event_id,
      'collab_accepted', 'Collaboration confirmée',
      COALESCE(v_org_name, 'L''organisateur') || ' a accepté de co-organiser « ' || v_event_title || ' ». La billetterie peut ouvrir.',
      'high', 'event_collab_contract', NEW.id,
      jsonb_build_object('organizer_user_id', NEW.organizer_user_id, 'organizer_name', v_org_name, 'event_id', NEW.event_id)
    );
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_collab_contract_signed ON public.event_collab_contracts;
CREATE TRIGGER trg_notify_collab_contract_signed
  AFTER UPDATE OF status ON public.event_collab_contracts
  FOR EACH ROW EXECUTE FUNCTION public.notify_collab_contract_signed();

GRANT EXECUTE ON FUNCTION public.notify_collab_party(text, text, uuid, uuid, text, text, text, text, text, uuid, jsonb) TO authenticated, service_role;
