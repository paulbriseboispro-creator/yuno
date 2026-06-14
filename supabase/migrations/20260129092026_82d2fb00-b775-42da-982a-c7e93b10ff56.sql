-- Table for staff notifications (realtime alerts)
CREATE TABLE public.staff_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  target_role TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  priority TEXT DEFAULT 'normal',
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ,
  read_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'
);

-- Enable realtime for staff_notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_notifications;

-- Enable RLS
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;

-- RLS: Staff can read notifications for their venue
CREATE POLICY "Staff can read own venue notifications"
  ON public.staff_notifications FOR SELECT
  USING (venue_id = public.get_user_venue_id(auth.uid()));

-- RLS: Staff can insert notifications for their venue
CREATE POLICY "Staff can insert notifications"
  ON public.staff_notifications FOR INSERT
  WITH CHECK (venue_id = public.get_user_venue_id(auth.uid()));

-- RLS: Staff can update (mark as read) their venue notifications
CREATE POLICY "Staff can update own venue notifications"
  ON public.staff_notifications FOR UPDATE
  USING (venue_id = public.get_user_venue_id(auth.uid()));

-- Index for efficient queries
CREATE INDEX idx_staff_notifications_venue_role ON public.staff_notifications(venue_id, target_role, created_at DESC);
CREATE INDEX idx_staff_notifications_unread ON public.staff_notifications(venue_id, target_role) WHERE read_at IS NULL;

-- Table for VIP customer notes
CREATE TABLE public.vip_customer_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  note TEXT NOT NULL,
  note_type TEXT DEFAULT 'general',
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vip_customer_notes ENABLE ROW LEVEL SECURITY;

-- RLS: Staff can read/write notes for their venue
CREATE POLICY "Staff can read vip notes for their venue"
  ON public.vip_customer_notes FOR SELECT
  USING (venue_id = public.get_user_venue_id(auth.uid()));

CREATE POLICY "Staff can insert vip notes for their venue"
  ON public.vip_customer_notes FOR INSERT
  WITH CHECK (venue_id = public.get_user_venue_id(auth.uid()));

CREATE POLICY "Staff can delete their own vip notes"
  ON public.vip_customer_notes FOR DELETE
  USING (created_by = auth.uid());

-- Index for efficient queries
CREATE INDEX idx_vip_customer_notes_venue_user ON public.vip_customer_notes(venue_id, user_id);

-- Add new columns to vip_consumptions for enhanced tracking
ALTER TABLE public.vip_consumptions
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS special_request TEXT;

-- Add entry_scanned columns to table_reservations if not exists
ALTER TABLE public.table_reservations
ADD COLUMN IF NOT EXISTS entry_scanned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS entry_scanned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS entry_scanned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;