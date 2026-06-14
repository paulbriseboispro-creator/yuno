
-- 1. Create promoter_teams table
CREATE TABLE public.promoter_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  leader_promoter_id uuid REFERENCES public.promoters(id) ON DELETE SET NULL,
  max_sales integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Add team_id and can_scan_entries to promoters
ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.promoter_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS can_scan_entries boolean NOT NULL DEFAULT false;

-- 3. Add quota and access control columns to promoter_event_assignments
ALTER TABLE public.promoter_event_assignments
  ADD COLUMN IF NOT EXISTS max_tickets integer,
  ADD COLUMN IF NOT EXISTS can_access_guestlist boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_access_tables boolean NOT NULL DEFAULT true;

-- 4. RLS for promoter_teams
ALTER TABLE public.promoter_teams ENABLE ROW LEVEL SECURITY;

-- Owner/manager can do everything on their venue teams
CREATE POLICY "Venue owners can manage teams"
  ON public.promoter_teams FOR ALL
  TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

-- Promoters can view teams in their venue
CREATE POLICY "Promoters can view own venue teams"
  ON public.promoter_teams FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.user_id = auth.uid()
      AND p.venue_id = promoter_teams.venue_id
    )
  );
