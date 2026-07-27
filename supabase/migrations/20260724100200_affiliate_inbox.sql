-- ============================================================================
-- Boîte de réception affilié — 4e flux du modèle staff/organizer/admin.
--
-- L'espace affilié n'avait aucune notification REÇUE : affiliate_notifications
-- est un canal d'ÉMISSION (l'agence écrit à son équipe) sans état de lecture
-- par personne. Cette table est l'inbox lue par la cloche du header et la page
-- /affiliate/inbox, même forme que staff_notifications pour brancher le
-- composant partagé NotificationsBell sans le modifier.
--
-- feed_key est la clé de filtre unique de la cloche (un seul eq + realtime) :
--   'admin:<affiliate_id>'  → flux du chef d'agence (lu aussi par les managers)
--   'member:<member_id>'    → flux personnel d'un promoteur/manager
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.affiliate_app_notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id      uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  -- NULL = ligne du flux admin ; sinon flux personnel de ce membre.
  member_id         uuid REFERENCES affiliate_members(id) ON DELETE CASCADE,
  feed_key          text NOT NULL,
  notification_type text NOT NULL,
  title             text NOT NULL,
  message           text NOT NULL,
  priority          text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reference_type    text,
  reference_id      uuid,
  metadata          jsonb NOT NULL DEFAULT '{}',
  read_at           timestamptz,
  read_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_app_notif_feed
  ON affiliate_app_notifications(feed_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aff_app_notif_unread
  ON affiliate_app_notifications(feed_key) WHERE read_at IS NULL;

ALTER TABLE affiliate_app_notifications ENABLE ROW LEVEL SECURITY;

-- Lecture : le chef d'agence et les managers actifs lisent le flux admin ;
-- chaque membre lit son flux personnel.
CREATE POLICY "aff_app_notif_select" ON affiliate_app_notifications
  FOR SELECT USING (
    (member_id IS NOT NULL AND member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    ))
    OR (member_id IS NULL AND (
      affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid())
      OR affiliate_id IN (
        SELECT affiliate_id FROM affiliate_members
        WHERE user_id = auth.uid() AND role = 'manager' AND is_active = true
      )
    ))
  );

-- Marquage lu : mêmes lecteurs, uniquement leurs lignes visibles.
CREATE POLICY "aff_app_notif_mark_read" ON affiliate_app_notifications
  FOR UPDATE USING (
    (member_id IS NOT NULL AND member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    ))
    OR (member_id IS NULL AND (
      affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid())
      OR affiliate_id IN (
        SELECT affiliate_id FROM affiliate_members
        WHERE user_id = auth.uid() AND role = 'manager' AND is_active = true
      )
    ))
  )
  WITH CHECK (
    (member_id IS NOT NULL AND member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    ))
    OR (member_id IS NULL AND (
      affiliate_id IN (SELECT id FROM affiliates WHERE user_id = auth.uid())
      OR affiliate_id IN (
        SELECT affiliate_id FROM affiliate_members
        WHERE user_id = auth.uid() AND role = 'manager' AND is_active = true
      )
    ))
  );

-- Pas de policy INSERT/DELETE : seules les fonctions SECURITY DEFINER écrivent.

-- Realtime pour le badge live de la cloche.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.affiliate_app_notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- Émetteur central. Jamais appelable par un rôle client : les seuls appels
-- viennent des triggers ci-dessous (SECURITY DEFINER).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_affiliate_app_notification(
  p_affiliate_id uuid,
  p_member_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_priority text DEFAULT 'normal',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO affiliate_app_notifications
    (affiliate_id, member_id, feed_key, notification_type, title, message,
     priority, reference_type, reference_id, metadata)
  VALUES
    (p_affiliate_id, p_member_id,
     CASE WHEN p_member_id IS NULL
          THEN 'admin:' || p_affiliate_id::text
          ELSE 'member:' || p_member_id::text END,
     p_type, left(p_title, 200), left(p_message, 500),
     p_priority, p_reference_type, p_reference_id, COALESCE(p_metadata, '{}'));
END;
$$;

REVOKE ALL ON FUNCTION public.emit_affiliate_app_notification(uuid, uuid, text, text, text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. Nouvelle assignation → notifier le(s) promoteur(s) visé(s).
--    member_id NULL sur l'assignation = tous les promoteurs actifs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_affiliate_assignment_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_member RECORD;
BEGIN
  SELECT ae.id, ae.name, ae.event_date, ae.affiliate_id
  INTO v_event
  FROM affiliate_events ae
  WHERE ae.id = NEW.affiliate_event_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.member_id IS NOT NULL THEN
    PERFORM emit_affiliate_app_notification(
      v_event.affiliate_id, NEW.member_id,
      'aff_new_assignment',
      'Nouvelle soirée à promouvoir',
      v_event.name || ' — soumets ton lien promo depuis ton espace.',
      'normal', 'affiliate_event', v_event.id,
      jsonb_build_object('event_id', v_event.id)
    );
  ELSE
    FOR v_member IN
      SELECT id FROM affiliate_members
      WHERE affiliate_id = v_event.affiliate_id
        AND is_active = true AND role = 'promoter'
    LOOP
      PERFORM emit_affiliate_app_notification(
        v_event.affiliate_id, v_member.id,
        'aff_new_assignment',
        'Nouvelle soirée à promouvoir',
        v_event.name || ' — soumets ton lien promo depuis ton espace.',
        'normal', 'affiliate_event', v_event.id,
        jsonb_build_object('event_id', v_event.id)
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une notification ne doit jamais faire échouer l'écriture métier.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aff_assignment_created_notify ON affiliate_event_assignments;
CREATE TRIGGER trg_aff_assignment_created_notify
  AFTER INSERT ON affiliate_event_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_affiliate_assignment_created();

-- ----------------------------------------------------------------------------
-- 2. Lien promo soumis → notifier le flux admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_affiliate_assignment_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_member_name text;
BEGIN
  IF NEW.status <> 'url_submitted' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT ae.id, ae.name, ae.affiliate_id
  INTO v_event
  FROM affiliate_events ae
  WHERE ae.id = NEW.affiliate_event_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
  INTO v_member_name
  FROM affiliate_members WHERE id = NEW.member_id;

  PERFORM emit_affiliate_app_notification(
    v_event.affiliate_id, NULL,
    'aff_url_submitted',
    'Lien promo soumis',
    COALESCE(NULLIF(v_member_name, ''), 'Un promoteur') || ' a soumis son lien pour ' || v_event.name || '.',
    'normal', 'affiliate_event', v_event.id,
    jsonb_build_object('event_id', v_event.id, 'member_id', NEW.member_id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aff_assignment_submitted_notify ON affiliate_event_assignments;
CREATE TRIGGER trg_aff_assignment_submitted_notify
  AFTER UPDATE ON affiliate_event_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_affiliate_assignment_submitted();

-- ----------------------------------------------------------------------------
-- 3. Cycle de révision du linktree membre.
--    pending_review → flux admin ; approved / retour draft → flux du membre.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_affiliate_linktree_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_name text;
BEGIN
  IF NEW.linktree_status IS NOT DISTINCT FROM OLD.linktree_status THEN
    RETURN NEW;
  END IF;

  v_member_name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));

  IF NEW.linktree_status = 'pending_review' THEN
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NULL,
      'aff_linktree_pending',
      'Linktree à valider',
      COALESCE(NULLIF(v_member_name, ''), 'Un promoteur') || ' a soumis son linktree pour révision.',
      'high', 'affiliate_member', NEW.id,
      jsonb_build_object('member_id', NEW.id)
    );
  ELSIF NEW.linktree_status = 'approved' AND OLD.linktree_status = 'pending_review' THEN
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NEW.id,
      'aff_linktree_approved',
      'Linktree approuvé',
      'Ta page publique est validée et en ligne.',
      'normal', 'affiliate_member', NEW.id, '{}'
    );
  ELSIF NEW.linktree_status = 'draft' AND OLD.linktree_status = 'pending_review' THEN
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NEW.id,
      'aff_linktree_rejected',
      'Linktree à retravailler',
      'Ta page publique a été renvoyée en brouillon — vois avec ton manager ce qui bloque.',
      'high', 'affiliate_member', NEW.id, '{}'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aff_linktree_review_notify ON affiliate_members;
CREATE TRIGGER trg_aff_linktree_review_notify
  AFTER UPDATE ON affiliate_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_affiliate_linktree_review();

-- ----------------------------------------------------------------------------
-- 4. Messages d'équipe (envois manuels + automations d'affiliate_notifications)
--    → fan-out dans le flux personnel de chaque membre visé, pour que la
--    cloche des promoteurs porte AUSSI la communication de l'agence.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fanout_affiliate_team_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member RECORD;
BEGIN
  IF NEW.target_member_id IS NOT NULL THEN
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NEW.target_member_id,
      'aff_team_message',
      left(NEW.title, 200), left(COALESCE(NEW.body, ''), 500),
      'normal', 'affiliate_notification', NEW.id,
      jsonb_build_object('action_url', NEW.action_url, 'automation_type', NEW.automation_type)
    );
  ELSE
    FOR v_member IN
      SELECT id FROM affiliate_members
      WHERE affiliate_id = NEW.affiliate_id AND is_active = true
    LOOP
      PERFORM emit_affiliate_app_notification(
        NEW.affiliate_id, v_member.id,
        'aff_team_message',
        left(NEW.title, 200), left(COALESCE(NEW.body, ''), 500),
        'normal', 'affiliate_notification', NEW.id,
        jsonb_build_object('action_url', NEW.action_url, 'automation_type', NEW.automation_type)
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aff_team_message_fanout ON affiliate_notifications;
CREATE TRIGGER trg_aff_team_message_fanout
  AFTER INSERT ON affiliate_notifications
  FOR EACH ROW EXECUTE FUNCTION public.fanout_affiliate_team_message();
