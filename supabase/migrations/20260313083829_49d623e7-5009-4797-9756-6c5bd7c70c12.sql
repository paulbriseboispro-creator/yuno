
-- =============================================
-- Promoter System Refactor — Phase 1 Migration
-- =============================================

-- 1) New table: commission_templates
CREATE TABLE public.commission_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_commission_templates_venue ON public.commission_templates(venue_id);

ALTER TABLE public.commission_templates ENABLE ROW LEVEL SECURITY;

-- Owner/manager can CRUD for their venue
CREATE POLICY "Owner/manager can manage commission templates"
  ON public.commission_templates FOR ALL
  TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

-- Promoter can read templates for their venue
CREATE POLICY "Promoter can view own venue templates"
  ON public.commission_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.user_id = auth.uid()
      AND p.venue_id = commission_templates.venue_id
      AND p.is_active = true
    )
  );

-- 2) New table: promoter_event_assignments
CREATE TABLE public.promoter_event_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id uuid NOT NULL REFERENCES public.promoters(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  commission_template_id uuid REFERENCES public.commission_templates(id) ON DELETE SET NULL,
  goal_target int,
  status text NOT NULL DEFAULT 'active',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promoter_id, event_id)
);

CREATE INDEX idx_pea_promoter ON public.promoter_event_assignments(promoter_id);
CREATE INDEX idx_pea_event ON public.promoter_event_assignments(event_id);

ALTER TABLE public.promoter_event_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner/manager can manage event assignments"
  ON public.promoter_event_assignments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_event_assignments.promoter_id
      AND public.can_manage_venue(auth.uid(), p.venue_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_event_assignments.promoter_id
      AND public.can_manage_venue(auth.uid(), p.venue_id)
    )
  );

CREATE POLICY "Promoter can view own assignments"
  ON public.promoter_event_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_event_assignments.promoter_id
      AND p.user_id = auth.uid()
    )
  );

-- 3) New table: promoter_payouts
CREATE TABLE public.promoter_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id uuid NOT NULL REFERENCES public.promoters(id) ON DELETE CASCADE,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  period_label text,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  approved_at timestamptz,
  approved_by uuid,
  paid_at timestamptz,
  paid_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_promoter_payouts_promoter_status ON public.promoter_payouts(promoter_id, status);

ALTER TABLE public.promoter_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner/manager can manage payouts"
  ON public.promoter_payouts FOR ALL
  TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Promoter can view own payouts"
  ON public.promoter_payouts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_payouts.promoter_id
      AND p.user_id = auth.uid()
    )
  );

-- 4) Alter promoter_clicks: add event_id and source
ALTER TABLE public.promoter_clicks
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX idx_promoter_clicks_event ON public.promoter_clicks(event_id);

-- 5) Alter promoter_conversions: add event_id
ALTER TABLE public.promoter_conversions
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX idx_promoter_conversions_event ON public.promoter_conversions(event_id);

-- 6) Alter promoters: add default_commission_template_id
ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS default_commission_template_id uuid REFERENCES public.commission_templates(id) ON DELETE SET NULL;
