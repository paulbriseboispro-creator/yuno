-- Followers for the new organizer_profiles table (keyed by organizer user_id)
CREATE TABLE IF NOT EXISTS public.organizer_profile_followers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organizer_user_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_profile_followers_org ON public.organizer_profile_followers(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_org_profile_followers_user ON public.organizer_profile_followers(user_id);

ALTER TABLE public.organizer_profile_followers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view organizer profile followers"
ON public.organizer_profile_followers
FOR SELECT USING (true);

CREATE POLICY "Users can follow organizer profiles"
ON public.organizer_profile_followers
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unfollow organizer profiles"
ON public.organizer_profile_followers
FOR DELETE USING (auth.uid() = user_id);