-- 1. Create enum types for profile types and event visibility
DO $$ BEGIN
  CREATE TYPE public.profile_type AS ENUM ('club', 'organizer', 'bde', 'private_organizer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_visibility AS ENUM ('public', 'private', 'unlisted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_kind AS ENUM ('club_event', 'organizer_event', 'private_event');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.discovery_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Add profile_type & organization fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_type public.profile_type NOT NULL DEFAULT 'club',
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS organization_logo_url text,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- 3. Make events.venue_id nullable + add organizer_id and visibility fields
ALTER TABLE public.events
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_kind public.event_kind NOT NULL DEFAULT 'club_event',
  ADD COLUMN IF NOT EXISTS visibility public.event_visibility NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS is_discoverable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS discovery_status public.discovery_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS location_address text,
  ADD COLUMN IF NOT EXISTS location_city text;

-- Ensure either venue_id or organizer_user_id is set
ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_owner_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_owner_check CHECK (venue_id IS NOT NULL OR organizer_user_id IS NOT NULL);

-- Index for organizer queries
CREATE INDEX IF NOT EXISTS idx_events_organizer_user_id ON public.events(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_events_visibility_discoverable ON public.events(visibility, is_discoverable);

-- 4. Helper function: is this user the organizer of this event?
CREATE OR REPLACE FUNCTION public.is_event_organizer(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events
    WHERE id = _event_id
    AND organizer_user_id = _user_id
  )
$$;

-- 5. RLS policies for organizer-owned events
DROP POLICY IF EXISTS "Organizers manage their own events" ON public.events;
CREATE POLICY "Organizers manage their own events"
ON public.events
FOR ALL
TO authenticated
USING (organizer_user_id = auth.uid())
WITH CHECK (organizer_user_id = auth.uid());

-- Public can read public + discoverable events (organizer or club)
DROP POLICY IF EXISTS "Public can view discoverable events" ON public.events;
CREATE POLICY "Public can view discoverable events"
ON public.events
FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND visibility = 'public'
  AND is_discoverable = true
  AND discovery_status = 'approved'
);

-- Anyone with a direct event ID link can read non-public organizer events
-- (we keep this permissive for unlisted/private events accessed via direct link)
DROP POLICY IF EXISTS "Anyone can view organizer events by id" ON public.events;
CREATE POLICY "Anyone can view organizer events by id"
ON public.events
FOR SELECT
TO anon, authenticated
USING (organizer_user_id IS NOT NULL AND is_active = true);

-- 6. Backfill: existing events default to club_event with venue
UPDATE public.events
SET event_kind = 'club_event'
WHERE event_kind IS NULL AND venue_id IS NOT NULL;
