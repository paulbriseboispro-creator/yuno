
-- Add 'organizer' to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'organizer';

-- ============================================================
-- Organizers: independent party organizer profiles
-- ============================================================
CREATE TABLE public.organizers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT,
  logo_url TEXT,
  cover_image_url TEXT,
  website_url TEXT,
  instagram_url TEXT,
  user_id UUID NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizers ENABLE ROW LEVEL SECURITY;

-- Anyone can view active organizers (public profiles)
CREATE POLICY "Anyone can view active organizers"
  ON public.organizers FOR SELECT
  USING (is_active = true);

-- Organizer owner can update their own org
CREATE POLICY "Organizer owner can update"
  ON public.organizers FOR UPDATE
  USING (auth.uid() = user_id);

-- Organizer owner can insert
CREATE POLICY "Organizer owner can insert"
  ON public.organizers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE TRIGGER update_organizers_updated_at
  BEFORE UPDATE ON public.organizers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-generate slug
CREATE OR REPLACE FUNCTION public.generate_organizer_slug()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := LOWER(
      REGEXP_REPLACE(
        REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9\-]', '-', 'g'),
        '-+', '-', 'g'
      )
    ) || '-' || SUBSTRING(NEW.id::text FROM 1 FOR 4);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER generate_organizer_slug_trigger
  BEFORE INSERT ON public.organizers
  FOR EACH ROW EXECUTE FUNCTION public.generate_organizer_slug();

-- ============================================================
-- Event ↔ Organizer link
-- ============================================================
CREATE TABLE public.event_organizers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
  organizer_id UUID REFERENCES public.organizers(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, organizer_id)
);

ALTER TABLE public.event_organizers ENABLE ROW LEVEL SECURITY;

-- Anyone can see event-organizer links (public)
CREATE POLICY "Anyone can view event organizers"
  ON public.event_organizers FOR SELECT
  USING (true);

-- Venue owners can manage event-organizer links
CREATE POLICY "Venue owners can manage event organizers"
  ON public.event_organizers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.venues v ON v.id = e.venue_id
      WHERE e.id = event_id AND v.owner_id = auth.uid()
    )
  );

-- Organizer owner can manage their own links
CREATE POLICY "Organizer owner can manage event organizers"
  ON public.event_organizers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.organizers o
      WHERE o.id = organizer_id AND o.user_id = auth.uid()
    )
  );

-- ============================================================
-- Venue ↔ Organizer collaboration
-- ============================================================
CREATE TABLE public.venue_organizers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL,
  organizer_id UUID REFERENCES public.organizers(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(venue_id, organizer_id)
);

ALTER TABLE public.venue_organizers ENABLE ROW LEVEL SECURITY;

-- Anyone can see venue-organizer links
CREATE POLICY "Anyone can view venue organizers"
  ON public.venue_organizers FOR SELECT
  USING (true);

-- Venue owners can manage
CREATE POLICY "Venue owners can manage venue organizers"
  ON public.venue_organizers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = venue_id AND v.owner_id = auth.uid()
    )
  );

-- ============================================================
-- Organizer invitations (venue owner invites orga by email)
-- ============================================================
CREATE TABLE public.organizer_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL,
  email TEXT NOT NULL,
  organizer_name TEXT,
  invited_by UUID NOT NULL,
  token TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  status TEXT NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizer_invitations ENABLE ROW LEVEL SECURITY;

-- Venue owners can view/manage their invitations
CREATE POLICY "Venue owners can manage organizer invitations"
  ON public.organizer_invitations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.venues v
      WHERE v.id = venue_id AND v.owner_id = auth.uid()
    )
  );

-- Invited user can view their invitation by token (handled by edge function with service role)

-- ============================================================
-- Organizer followers
-- ============================================================
CREATE TABLE public.organizer_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID REFERENCES public.organizers(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organizer_id, user_id)
);

ALTER TABLE public.organizer_followers ENABLE ROW LEVEL SECURITY;

-- Anyone can see follower counts (we'll count them)
CREATE POLICY "Anyone can view organizer followers"
  ON public.organizer_followers FOR SELECT
  USING (true);

-- Authenticated users can follow/unfollow
CREATE POLICY "Users can follow organizers"
  ON public.organizer_followers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unfollow organizers"
  ON public.organizer_followers FOR DELETE
  USING (auth.uid() = user_id);
