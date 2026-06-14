
-- ============================================================================
-- 1) Extend tables: add organizer_user_id and make venue_id nullable
-- ============================================================================

ALTER TABLE public.promoters
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.commission_templates
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.promoter_teams
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.promoter_announcements
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.promoter_payouts
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Constraints: exactly one context (venue_id XOR organizer_user_id) - drop if exists then add
ALTER TABLE public.promoters DROP CONSTRAINT IF EXISTS promoters_context_check;
ALTER TABLE public.promoters
  ADD CONSTRAINT promoters_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1);

ALTER TABLE public.commission_templates DROP CONSTRAINT IF EXISTS commission_templates_context_check;
ALTER TABLE public.commission_templates
  ADD CONSTRAINT commission_templates_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1);

ALTER TABLE public.promoter_teams DROP CONSTRAINT IF EXISTS promoter_teams_context_check;
ALTER TABLE public.promoter_teams
  ADD CONSTRAINT promoter_teams_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1);

ALTER TABLE public.promoter_announcements DROP CONSTRAINT IF EXISTS promoter_announcements_context_check;
ALTER TABLE public.promoter_announcements
  ADD CONSTRAINT promoter_announcements_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1);

ALTER TABLE public.promoter_payouts DROP CONSTRAINT IF EXISTS promoter_payouts_context_check;
ALTER TABLE public.promoter_payouts
  ADD CONSTRAINT promoter_payouts_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1);

-- Indexes for organizer-based lookups
CREATE INDEX IF NOT EXISTS idx_promoters_organizer ON public.promoters(organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commission_templates_organizer ON public.commission_templates(organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promoter_teams_organizer ON public.promoter_teams(organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promoter_announcements_organizer ON public.promoter_announcements(organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promoter_payouts_organizer ON public.promoter_payouts(organizer_user_id) WHERE organizer_user_id IS NOT NULL;

-- Unique promo_code per organizer context
CREATE UNIQUE INDEX IF NOT EXISTS promoters_organizer_promo_code_unique
  ON public.promoters (organizer_user_id, lower(promo_code))
  WHERE organizer_user_id IS NOT NULL;

-- One promoter row per (user, organizer) - prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS promoters_user_organizer_unique
  ON public.promoters (user_id, organizer_user_id)
  WHERE organizer_user_id IS NOT NULL;

-- ============================================================================
-- 2) Helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_organizer_promoter_admin(_user_id uuid, _organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id = _organizer_user_id
      OR public.is_org_team_member(_user_id, _organizer_user_id, 'admin')
      OR public.is_super_admin();
$$;

CREATE OR REPLACE FUNCTION public.can_view_organizer_promoters(_user_id uuid, _organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user_id = _organizer_user_id
      OR public.is_org_team_member(_user_id, _organizer_user_id, 'editor')
      OR public.org_member_has_permission(_user_id, _organizer_user_id, 'view_finance')
      OR public.is_super_admin();
$$;

-- Determine the "managing" organizer for an event (lead organizer if any)
CREATE OR REPLACE FUNCTION public.get_event_managing_organizer(_event_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(organizer_user_id, partner_organizer_id)
  FROM public.events WHERE id = _event_id
$$;

-- ============================================================================
-- 3) RLS policies extension
-- ============================================================================

-- promoters table policies
DROP POLICY IF EXISTS "Organizer can manage own promoters" ON public.promoters;
CREATE POLICY "Organizer can manage own promoters"
  ON public.promoters FOR ALL
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
  WITH CHECK (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id));

DROP POLICY IF EXISTS "Org members can view own promoters" ON public.promoters;
CREATE POLICY "Org members can view own promoters"
  ON public.promoters FOR SELECT
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND public.can_view_organizer_promoters(auth.uid(), organizer_user_id));

-- Allow promoter user to see their own organizer-linked profile
DROP POLICY IF EXISTS "Promoter can view own organizer profile" ON public.promoters;
CREATE POLICY "Promoter can view own organizer profile"
  ON public.promoters FOR SELECT
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND user_id = auth.uid());

DROP POLICY IF EXISTS "Promoter can update own organizer profile" ON public.promoters;
CREATE POLICY "Promoter can update own organizer profile"
  ON public.promoters FOR UPDATE
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND user_id = auth.uid())
  WITH CHECK (organizer_user_id IS NOT NULL AND user_id = auth.uid());

-- Venue owners can view promoters of partner organizers (collab read-only)
DROP POLICY IF EXISTS "Venue owner can view partner organizer promoters" ON public.promoters;
CREATE POLICY "Venue owner can view partner organizer promoters"
  ON public.promoters FOR SELECT
  TO authenticated
  USING (
    organizer_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
      WHERE v.owner_id = auth.uid()
        AND (e.organizer_user_id = promoters.organizer_user_id OR e.partner_organizer_id = promoters.organizer_user_id)
    )
  );

-- commission_templates policies
DROP POLICY IF EXISTS "Organizer can manage own templates" ON public.commission_templates;
CREATE POLICY "Organizer can manage own templates"
  ON public.commission_templates FOR ALL
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
  WITH CHECK (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id));

DROP POLICY IF EXISTS "Org promoters can view org templates" ON public.commission_templates;
CREATE POLICY "Org promoters can view org templates"
  ON public.commission_templates FOR SELECT
  TO authenticated
  USING (
    organizer_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.user_id = auth.uid()
        AND p.organizer_user_id = commission_templates.organizer_user_id
    )
  );

-- promoter_teams policies
DROP POLICY IF EXISTS "Organizer can manage own teams" ON public.promoter_teams;
CREATE POLICY "Organizer can manage own teams"
  ON public.promoter_teams FOR ALL
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
  WITH CHECK (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id));

-- promoter_announcements policies
DROP POLICY IF EXISTS "Organizer can manage own announcements" ON public.promoter_announcements;
CREATE POLICY "Organizer can manage own announcements"
  ON public.promoter_announcements FOR ALL
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
  WITH CHECK (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id));

DROP POLICY IF EXISTS "Org promoters can view announcements" ON public.promoter_announcements;
CREATE POLICY "Org promoters can view announcements"
  ON public.promoter_announcements FOR SELECT
  TO authenticated
  USING (
    organizer_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.user_id = auth.uid()
        AND p.organizer_user_id = promoter_announcements.organizer_user_id
    )
  );

-- promoter_payouts policies
DROP POLICY IF EXISTS "Organizer can manage own payouts" ON public.promoter_payouts;
CREATE POLICY "Organizer can manage own payouts"
  ON public.promoter_payouts FOR ALL
  TO authenticated
  USING (
    organizer_user_id IS NOT NULL
    AND (
      public.is_organizer_promoter_admin(auth.uid(), organizer_user_id)
      OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'view_finance')
    )
  )
  WITH CHECK (
    organizer_user_id IS NOT NULL
    AND (
      public.is_organizer_promoter_admin(auth.uid(), organizer_user_id)
      OR public.org_member_has_permission(auth.uid(), organizer_user_id, 'view_finance')
    )
  );

DROP POLICY IF EXISTS "Promoter can view own org payouts" ON public.promoter_payouts;
CREATE POLICY "Promoter can view own org payouts"
  ON public.promoter_payouts FOR SELECT
  TO authenticated
  USING (
    organizer_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_payouts.promoter_id
        AND p.user_id = auth.uid()
    )
  );

-- promoter_event_assignments: extend to allow organizer admin
DROP POLICY IF EXISTS "Organizer can manage org promoter assignments" ON public.promoter_event_assignments;
CREATE POLICY "Organizer can manage org promoter assignments"
  ON public.promoter_event_assignments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_event_assignments.promoter_id
        AND p.organizer_user_id IS NOT NULL
        AND public.is_organizer_promoter_admin(auth.uid(), p.organizer_user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_event_assignments.promoter_id
        AND p.organizer_user_id IS NOT NULL
        AND public.is_organizer_promoter_admin(auth.uid(), p.organizer_user_id)
    )
  );

-- Venue owner can view partner-organizer assignments on their events (collab read-only)
DROP POLICY IF EXISTS "Venue owner can view partner org assignments" ON public.promoter_event_assignments;
CREATE POLICY "Venue owner can view partner org assignments"
  ON public.promoter_event_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
      WHERE e.id = promoter_event_assignments.event_id
        AND v.owner_id = auth.uid()
    )
  );

-- promoter_clicks: organizer can view clicks of their promoters
DROP POLICY IF EXISTS "Organizer can view org promoter clicks" ON public.promoter_clicks;
CREATE POLICY "Organizer can view org promoter clicks"
  ON public.promoter_clicks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_clicks.promoter_id
        AND p.organizer_user_id IS NOT NULL
        AND public.can_view_organizer_promoters(auth.uid(), p.organizer_user_id)
    )
  );

DROP POLICY IF EXISTS "Venue owner can view partner promoter clicks" ON public.promoter_clicks;
CREATE POLICY "Venue owner can view partner promoter clicks"
  ON public.promoter_clicks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
      WHERE e.id = promoter_clicks.event_id
        AND v.owner_id = auth.uid()
    )
  );

-- promoter_conversions
DROP POLICY IF EXISTS "Organizer can view org promoter conversions" ON public.promoter_conversions;
CREATE POLICY "Organizer can view org promoter conversions"
  ON public.promoter_conversions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_conversions.promoter_id
        AND p.organizer_user_id IS NOT NULL
        AND public.can_view_organizer_promoters(auth.uid(), p.organizer_user_id)
    )
  );

DROP POLICY IF EXISTS "Organizer admin can update org conversions" ON public.promoter_conversions;
CREATE POLICY "Organizer admin can update org conversions"
  ON public.promoter_conversions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_conversions.promoter_id
        AND p.organizer_user_id IS NOT NULL
        AND public.is_organizer_promoter_admin(auth.uid(), p.organizer_user_id)
    )
  );

DROP POLICY IF EXISTS "Venue owner can view partner conversions" ON public.promoter_conversions;
CREATE POLICY "Venue owner can view partner conversions"
  ON public.promoter_conversions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
      WHERE e.id = promoter_conversions.event_id
        AND v.owner_id = auth.uid()
    )
  );

-- promoter_messages: organizer admin can manage
DROP POLICY IF EXISTS "Organizer admin can manage org messages" ON public.promoter_messages;
CREATE POLICY "Organizer admin can manage org messages"
  ON public.promoter_messages FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_messages.promoter_id
        AND p.organizer_user_id IS NOT NULL
        AND public.is_organizer_promoter_admin(auth.uid(), p.organizer_user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_messages.promoter_id
        AND p.organizer_user_id IS NOT NULL
        AND public.is_organizer_promoter_admin(auth.uid(), p.organizer_user_id)
    )
  );
