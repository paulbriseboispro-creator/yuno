-- Accès support Yuno — notifications au client ciblé.
--
-- Le consentement ne vaut que s'il est vu : chaque étape du cycle (demande
-- d'accès, session ouverte, session close) tombe dans la cloche du pro, du côté
-- où il travaille — organisateur (organizer_notifications) et/ou club
-- (staff_notifications, cible 'owner'). Aucune notif super admin ici : le flux
-- part de l'admin, il n'a pas à s'auto-notifier.
--
-- Modèle repris de 20260723210000 (emit_admin_notification) : corps enveloppé
-- d'un EXCEPTION WHEN OTHERS — une notif ratée ne doit jamais faire échouer
-- l'écriture métier qu'elle observe (ici : l'ouverture d'une session support).

CREATE OR REPLACE FUNCTION public.notify_support_grant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type   text;
  v_title  text;
  v_msg    text;
  v_venue  text;
  v_is_org boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
    v_type  := 'support_access_requested';
    v_title := 'Yuno demande un accès assisté';
    v_msg   := 'L''équipe Yuno demande un accès temporaire à votre compte pour vous aider à le configurer. Aucun accès aux paiements. À vous d''accepter ou de refuser.';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'revoked' THEN
    v_type  := 'support_access_ended';
    v_title := 'Accès assisté Yuno révoqué';
    v_msg   := 'L''accès assisté de l''équipe Yuno à votre compte est terminé.';
  ELSE
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM organizer_profiles op WHERE op.user_id = NEW.target_user_id)
    INTO v_is_org;
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = NEW.target_user_id LIMIT 1;

  IF v_is_org THEN
    INSERT INTO organizer_notifications (
      organizer_user_id, notification_type, title, message, priority,
      reference_type, reference_id, metadata
    ) VALUES (
      NEW.target_user_id, v_type, v_title, v_msg, 'high',
      'support_grant', NEW.id, jsonb_build_object('grant_id', NEW.id, 'status', NEW.status)
    );
  END IF;

  IF v_venue IS NOT NULL THEN
    PERFORM emit_staff_notification(
      v_venue, 'owner', v_type, v_title, v_msg, 'high',
      'support_grant', NEW.id, NULL,
      jsonb_build_object('grant_id', NEW.id, 'status', NEW.status),
      'support_grant:' || NEW.id::text || ':' || v_type
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_support_grant_change
  AFTER INSERT OR UPDATE OF status ON public.admin_support_grants
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_grant_change();

-- Session ouverte : le client doit le savoir au moment où ça arrive, pas après.
CREATE OR REPLACE FUNCTION public.notify_support_session_opened()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue  text;
  v_is_org boolean;
  v_title  text := 'Session d''assistance Yuno ouverte';
  v_msg    text := 'Un membre de l''équipe Yuno vient d''ouvrir une session d''assistance sur votre compte. Chaque action est journalisée et vous pouvez couper l''accès à tout moment.';
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;

  SELECT EXISTS (SELECT 1 FROM organizer_profiles op WHERE op.user_id = NEW.target_user_id)
    INTO v_is_org;
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = NEW.target_user_id LIMIT 1;

  IF v_is_org THEN
    INSERT INTO organizer_notifications (
      organizer_user_id, notification_type, title, message, priority,
      reference_type, reference_id, metadata
    ) VALUES (
      NEW.target_user_id, 'support_access_session', v_title, v_msg, 'high',
      'support_session', NEW.id, jsonb_build_object('session_id', NEW.id, 'grant_id', NEW.grant_id)
    );
  END IF;

  IF v_venue IS NOT NULL THEN
    PERFORM emit_staff_notification(
      v_venue, 'owner', 'support_access_session', v_title, v_msg, 'high',
      'support_session', NEW.id, NULL,
      jsonb_build_object('session_id', NEW.id, 'grant_id', NEW.grant_id),
      'support_session:' || NEW.id::text
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_support_session_opened
  AFTER INSERT ON public.admin_support_sessions
  FOR EACH ROW EXECUTE FUNCTION public.notify_support_session_opened();
