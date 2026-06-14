
CREATE TABLE public.venue_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  current_step INTEGER DEFAULT 1,
  steps JSONB DEFAULT '{"1":{"status":"not_started","completed_at":null},"2":{"status":"not_started","completed_at":null},"3":{"status":"not_started","completed_at":null},"4":{"status":"not_started","completed_at":null},"5":{"status":"not_started","completed_at":null},"6":{"status":"not_started","completed_at":null},"7":{"status":"not_started","completed_at":null}}'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(venue_id)
);

ALTER TABLE public.venue_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can manage own onboarding" ON public.venue_onboarding
  FOR ALL TO authenticated
  USING (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.is_venue_owner(auth.uid(), venue_id) OR public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Admin can read all onboarding" ON public.venue_onboarding
  FOR SELECT TO authenticated USING (public.is_super_admin());
