
-- Create guest_lists table
CREATE TABLE public.guest_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL,
  quota INTEGER NOT NULL DEFAULT 100,
  quota_female INTEGER,
  quota_male INTEGER,
  free_before_time TIME NOT NULL DEFAULT '02:00',
  includes_drink BOOLEAN NOT NULL DEFAULT false,
  visible_on_club_page BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  share_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id)
);

-- Create guest_list_entries table
CREATE TABLE public.guest_list_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_list_id UUID NOT NULL REFERENCES public.guest_lists(id) ON DELETE CASCADE,
  user_id UUID,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  gender TEXT,
  qr_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  entry_scanned BOOLEAN NOT NULL DEFAULT false,
  entry_scanned_at TIMESTAMPTZ,
  entry_scanned_by UUID,
  promoter_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.guest_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_list_entries ENABLE ROW LEVEL SECURITY;

-- RLS policies for guest_lists
CREATE POLICY "Anyone can view active guest lists"
  ON public.guest_lists FOR SELECT
  USING (true);

CREATE POLICY "Owners can insert guest lists"
  ON public.guest_lists FOR INSERT
  WITH CHECK (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.can_manage_venue(auth.uid(), venue_id)
  );

CREATE POLICY "Owners can update guest lists"
  ON public.guest_lists FOR UPDATE
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.can_manage_venue(auth.uid(), venue_id)
  );

CREATE POLICY "Owners can delete guest lists"
  ON public.guest_lists FOR DELETE
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.can_manage_venue(auth.uid(), venue_id)
  );

-- RLS policies for guest_list_entries
CREATE POLICY "Anyone can insert guest list entries"
  ON public.guest_list_entries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can view own entries or owners can view all"
  ON public.guest_list_entries FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.guest_lists gl
      WHERE gl.id = guest_list_id
      AND (
        public.is_venue_owner(auth.uid(), gl.venue_id)
        OR public.can_manage_venue(auth.uid(), gl.venue_id)
        OR public.is_venue_staff(auth.uid(), gl.venue_id)
      )
    )
  );

CREATE POLICY "Owners and staff can update entries"
  ON public.guest_list_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_lists gl
      WHERE gl.id = guest_list_id
      AND (
        public.is_venue_owner(auth.uid(), gl.venue_id)
        OR public.can_manage_venue(auth.uid(), gl.venue_id)
        OR public.is_venue_staff(auth.uid(), gl.venue_id)
      )
    )
  );

-- Trigger for updated_at on guest_lists
CREATE TRIGGER update_guest_lists_updated_at
  BEFORE UPDATE ON public.guest_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes
CREATE INDEX idx_guest_lists_event_id ON public.guest_lists(event_id);
CREATE INDEX idx_guest_lists_venue_id ON public.guest_lists(venue_id);
CREATE INDEX idx_guest_lists_share_token ON public.guest_lists(share_token);
CREATE INDEX idx_guest_list_entries_guest_list_id ON public.guest_list_entries(guest_list_id);
CREATE INDEX idx_guest_list_entries_email ON public.guest_list_entries(email);
CREATE INDEX idx_guest_list_entries_qr_code ON public.guest_list_entries(qr_code);
CREATE INDEX idx_guest_list_entries_user_id ON public.guest_list_entries(user_id);

-- Enable realtime for entries
ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_list_entries;
