-- ─────────────────────────────────────────────────────────────────────────────
-- Fix item 3 — notif owner « nouvel abonné » (jamais déclenchée).
--
-- FavoritesContext émettait la notif côté CLIENT par un INSERT direct dans
-- staff_notifications. Deux blocages : (1) la RLS INSERT exige
-- venue_id = get_user_venue_id(auth.uid()) → un fan n'est pas staff, rejeté ;
-- (2) reference_id est UUID mais le venue_id est TEXT → type mismatch. L'erreur
-- était avalée (try/catch best-effort) : l'owner n'a JAMAIS reçu de notif, et
-- aucun dedup n'existait.
--
-- Correctif au modèle du codebase (comme emit_admin_notification) : un trigger
-- SECURITY DEFINER sur favorites (donc non spoofable — il part du vrai follow
-- déjà RLS-checké, pas d'un RPC ouvert que n'importe qui pourrait appeler) émet
-- via emit_staff_notification, avec un dedup_key (une notif par abonné+sujet).
-- 'favorite_added' n'est pas dans l'allowlist du push staff → cloche uniquement,
-- pas de push (on ne réveille pas l'owner à chaque follow).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Clé de dédup sur staff_notifications (colonne + index partiel unique, comme
--    admin_notifications). Les autres types gardent dedup_key NULL → non affectés.
ALTER TABLE public.staff_notifications
  ADD COLUMN IF NOT EXISTS dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_notifications_dedup
  ON public.staff_notifications (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- 2. Émetteur SECURITY DEFINER (trigger-only : REVOKE de tous les rôles clients).
CREATE OR REPLACE FUNCTION public.emit_staff_notification(
  p_venue_id       TEXT,
  p_target_role    TEXT,
  p_type           TEXT,
  p_title          TEXT,
  p_message        TEXT,
  p_priority       TEXT  DEFAULT 'normal',
  p_reference_type TEXT  DEFAULT NULL,
  p_reference_id   UUID  DEFAULT NULL,
  p_event_id       UUID  DEFAULT NULL,
  p_metadata       JSONB DEFAULT '{}'::jsonb,
  p_dedup_key      TEXT  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.staff_notifications (
    venue_id, target_role, notification_type, title, message, priority,
    reference_type, reference_id, event_id, metadata, dedup_key
  ) VALUES (
    p_venue_id, COALESCE(p_target_role, 'owner'), p_type, p_title, p_message,
    COALESCE(p_priority, 'normal'), p_reference_type, p_reference_id, p_event_id,
    COALESCE(p_metadata, '{}'::jsonb), p_dedup_key
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.emit_staff_notification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, JSONB, TEXT)
  FROM public, anon, authenticated;

-- 3. Trigger : à chaque follow club / favori event, notifier l'owner (cloche).
--    Enveloppé d'un EXCEPTION WHEN OTHERS : une notif ratée ne doit jamais casser
--    le follow lui-même (l'écriture métier qu'elle observe).
CREATE OR REPLACE FUNCTION public.notify_owner_new_favorite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue_id TEXT;
  v_title    TEXT;
BEGIN
  IF NEW.favorite_type = 'club' AND NEW.venue_id IS NOT NULL THEN
    PERFORM public.emit_staff_notification(
      p_venue_id       => NEW.venue_id,
      p_target_role    => 'owner',
      p_type           => 'favorite_added',
      p_title          => 'Nouvel abonné — Club',
      p_message        => 'Un utilisateur s''est abonné à votre club',
      p_priority       => 'low',
      p_reference_type => 'venue',
      p_metadata       => jsonb_build_object('favorite_type', 'club', 'subscriber_id', NEW.user_id),
      p_dedup_key      => 'favorite_added:club:' || NEW.venue_id || ':' || NEW.user_id::text
    );

  ELSIF NEW.favorite_type = 'event' AND NEW.event_id IS NOT NULL THEN
    SELECT e.venue_id, e.title INTO v_venue_id, v_title
      FROM public.events e
     WHERE e.id = NEW.event_id;

    IF v_venue_id IS NOT NULL THEN
      PERFORM public.emit_staff_notification(
        p_venue_id       => v_venue_id,
        p_target_role    => 'owner',
        p_type           => 'favorite_added',
        p_title          => 'Nouveau favori — Soirée',
        p_message        => 'Un utilisateur a ajouté "' || COALESCE(v_title, '') || '" à ses favoris',
        p_priority       => 'low',
        p_reference_type => 'event',
        p_reference_id   => NEW.event_id,
        p_event_id       => NEW.event_id,
        p_metadata       => jsonb_build_object('favorite_type', 'event', 'event_title', v_title, 'subscriber_id', NEW.user_id),
        p_dedup_key      => 'favorite_added:event:' || NEW.event_id::text || ':' || NEW.user_id::text
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_owner_new_favorite ON public.favorites;
CREATE TRIGGER trg_notify_owner_new_favorite
  AFTER INSERT ON public.favorites
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_owner_new_favorite();
