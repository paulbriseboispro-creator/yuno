-- ─────────────────────────────────────────────────────────────────────────────
-- Organizer notification feed.
--
-- Clubs (venues) already have `staff_notifications` (venue-scoped). Organizers
-- run without a venue, so they get their own parallel inbox keyed by the
-- organizer's auth user id. Same shape as staff_notifications so the frontend
-- can render both feeds with one set of components.
--
-- Emission paths:
--   • Payments (edge functions, service role): ticket_sale, table_booked, and
--     the capacity thresholds — mirrored from the owner blocks, gated on the
--     event's resolved organizer id.
--   • Relational events (DB triggers, SECURITY DEFINER): a DJ accepting/declining
--     an organizer's booking request, and a club requesting/accepting a
--     partnership. The actor there is the DJ or the club, never the organizer,
--     so a trigger is the only place that can write the organizer's row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organizer_notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id           UUID REFERENCES public.events(id) ON DELETE SET NULL,
  notification_type  TEXT NOT NULL,
  title              TEXT NOT NULL,
  message            TEXT NOT NULL,
  reference_type     TEXT,
  reference_id       UUID,
  priority           TEXT NOT NULL DEFAULT 'normal',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at            TIMESTAMPTZ,
  read_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata           JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_organizer_notifications_user
  ON public.organizer_notifications (organizer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_organizer_notifications_unread
  ON public.organizer_notifications (organizer_user_id) WHERE read_at IS NULL;

-- Realtime (idempotent — adding an already-present table errors, so guard it).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.organizer_notifications;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.organizer_notifications ENABLE ROW LEVEL SECURITY;

-- The organizer reads and marks-read their own notifications. Inserts come only
-- from the service role (edge functions) and SECURITY DEFINER triggers, both of
-- which bypass RLS — so there is deliberately no INSERT policy for authenticated.
DROP POLICY IF EXISTS organizer_notifications_select ON public.organizer_notifications;
CREATE POLICY organizer_notifications_select
  ON public.organizer_notifications FOR SELECT
  USING (organizer_user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS organizer_notifications_update ON public.organizer_notifications;
CREATE POLICY organizer_notifications_update
  ON public.organizer_notifications FOR UPDATE
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());

-- ── Trigger 1: DJ responds to an organizer's booking request ──────────────────
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
  -- Only organizer-scoped requests transitioning pending -> accepted/declined.
  IF NEW.organizer_user_id IS NULL THEN RETURN NEW; END IF;
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_organizer_dj_booking_response ON public.dj_booking_requests;
CREATE TRIGGER trg_notify_organizer_dj_booking_response
  AFTER UPDATE OF status ON public.dj_booking_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_organizer_dj_booking_response();

-- ── Trigger 2: club requests or accepts a partnership with an organizer ────────
CREATE OR REPLACE FUNCTION public.notify_organizer_partnership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  club_name TEXT;
BEGIN
  SELECT name INTO club_name FROM public.venues WHERE id = NEW.venue_id;
  club_name := COALESCE(club_name, 'Un club');

  -- A club initiated a partnership request → the organizer has an invite to act on.
  IF TG_OP = 'INSERT' THEN
    IF NEW.initiated_by = 'venue' AND NEW.status = 'pending' THEN
      INSERT INTO public.organizer_notifications (
        organizer_user_id, notification_type, title, message,
        priority, reference_type, reference_id, metadata
      ) VALUES (
        NEW.organizer_user_id, 'partner_request', 'Nouvelle demande de partenariat',
        club_name || ' veut collaborer avec toi.', 'high',
        'partnership', NEW.id,
        jsonb_build_object('venue_id', NEW.venue_id, 'club_name', club_name, 'initiated_by', NEW.initiated_by)
      );
    END IF;
    RETURN NEW;
  END IF;

  -- The organizer's own request was accepted by the club (pending → active).
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'active'
     AND NEW.initiated_by = 'organizer' THEN
    INSERT INTO public.organizer_notifications (
      organizer_user_id, notification_type, title, message,
      priority, reference_type, reference_id, metadata
    ) VALUES (
      NEW.organizer_user_id, 'partner_accepted', 'Partenariat accepté',
      club_name || ' a accepté votre partenariat.', 'high',
      'partnership', NEW.id,
      jsonb_build_object('venue_id', NEW.venue_id, 'club_name', club_name)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_organizer_partnership_insert ON public.venue_organizer_partnerships;
CREATE TRIGGER trg_notify_organizer_partnership_insert
  AFTER INSERT ON public.venue_organizer_partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_organizer_partnership();

DROP TRIGGER IF EXISTS trg_notify_organizer_partnership_update ON public.venue_organizer_partnerships;
CREATE TRIGGER trg_notify_organizer_partnership_update
  AFTER UPDATE OF status ON public.venue_organizer_partnerships
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_organizer_partnership();
