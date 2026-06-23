-- ─────────────────────────────────────────────────────────────────────────────
-- Reminder: add the DJ line-up to each newly published recurring event.
--
-- Recurring club/organizer nights are materialized by `generate_recurring_events`
-- (daily pg_cron + on save), which inserts fresh occurrences into `events` with a
-- non-null `recurring_template_id` and never a line-up (`event_djs` is empty at
-- that point). A filled line-up powers the public "DJs not to miss" rail on
-- Explore and the per-event line-up section — both conversion levers — but it is
-- optional, so we nudge rather than block.
--
-- This AFTER INSERT trigger drops a low-friction reminder into the right inbox:
--   • venue_id                          -> staff_notifications (target_role 'owner')
--   • organizer_user_id / partner org   -> organizer_notifications
-- A co-event (venue_id + partner_organizer_id) notifies BOTH sides, since either
-- party can edit the shared line-up.
--
-- SECURITY DEFINER so it can write the notification tables (neither has an INSERT
-- policy for `authenticated`; only definer / service-role paths write them).
--
-- Fail-soft is load-bearing: `generate_recurring_events` wraps each occurrence in
-- its own BEGIN/EXCEPTION block, so an error raised here would silently roll back
-- that occurrence (0 events generated, swallowed as a warning). The whole body is
-- guarded — a reminder failure must never abort event creation.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_recurring_event_lineup_reminder()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   uuid;
  v_date_str text;
  v_title    text;
  v_msg      text;
BEGIN
  -- Only recurring occurrences. Manual events are created through the editor
  -- where the line-up is filled inline, so they don't need the nudge.
  IF NEW.recurring_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_date_str := to_char((NEW.start_at AT TIME ZONE 'Europe/Paris'), 'DD/MM');
    v_title := '🎧 Ajoute le line-up DJ';
    v_msg := '« ' || COALESCE(NULLIF(TRIM(NEW.title), ''), 'Ta soirée') || ' » le '
             || v_date_str || ' — renseigne les DJs pour booster les ventes (optionnel).';

    -- Club / venue inbox.
    IF NEW.venue_id IS NOT NULL THEN
      INSERT INTO public.staff_notifications (
        venue_id, event_id, target_role, notification_type, title, message,
        reference_type, reference_id, priority, metadata
      ) VALUES (
        NEW.venue_id, NEW.id, 'owner', 'lineup_reminder', v_title, v_msg,
        'event', NEW.id, 'normal',
        jsonb_build_object('event_title', NEW.title, 'recurring', true)
      );
    END IF;

    -- Organizer inbox: a solo-organizer template (organizer_user_id) or the
    -- partner organizer of a co-event (partner_organizer_id).
    v_org_id := COALESCE(NEW.organizer_user_id, NEW.partner_organizer_id);
    IF v_org_id IS NOT NULL THEN
      INSERT INTO public.organizer_notifications (
        organizer_user_id, event_id, notification_type, title, message,
        reference_type, reference_id, priority, metadata
      ) VALUES (
        v_org_id, NEW.id, 'lineup_reminder', v_title, v_msg,
        'event', NEW.id, 'normal',
        jsonb_build_object('event_title', NEW.title, 'recurring', true)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never let a reminder failure abort (and silently roll back) event creation.
    RAISE WARNING 'lineup reminder failed for event %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_recurring_event_lineup_reminder ON public.events;
CREATE TRIGGER trg_notify_recurring_event_lineup_reminder
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_recurring_event_lineup_reminder();
