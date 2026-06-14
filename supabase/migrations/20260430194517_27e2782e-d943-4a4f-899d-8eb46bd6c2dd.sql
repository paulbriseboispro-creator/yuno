
-- Onboarding tracking table for organizer accounts
CREATE TABLE IF NOT EXISTS public.organizer_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  current_step INTEGER NOT NULL DEFAULT 1,
  steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizer_onboarding_user_id ON public.organizer_onboarding(user_id);

ALTER TABLE public.organizer_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizers can view their own onboarding"
  ON public.organizer_onboarding FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Organizers can insert their own onboarding"
  ON public.organizer_onboarding FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Organizers can update their own onboarding"
  ON public.organizer_onboarding FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all organizer onboardings"
  ON public.organizer_onboarding FOR SELECT
  USING (public.is_super_admin());

CREATE TRIGGER trg_organizer_onboarding_updated_at
  BEFORE UPDATE ON public.organizer_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
