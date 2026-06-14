
-- Leaderboard contests table: each contest is a standalone instance with dates, type, status, and linked rewards
CREATE TABLE public.leaderboard_contests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  contest_type text NOT NULL DEFAULT 'monthly', -- monthly, yearly, event
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  start_date timestamptz NOT NULL DEFAULT now(),
  end_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft, live, ended, archived
  reward_preset_ids uuid[] DEFAULT '{}',
  scoring_config jsonb DEFAULT '{}',
  auto_reward boolean NOT NULL DEFAULT true,
  rewards_distributed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leaderboard_contests ENABLE ROW LEVEL SECURITY;

-- Owners and managers can manage contests for their venues
CREATE POLICY "Owners can manage leaderboard contests"
  ON public.leaderboard_contests FOR ALL TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

-- Clients can view live contests for venues they belong to
CREATE POLICY "Clients can view live contests"
  ON public.leaderboard_contests FOR SELECT TO authenticated
  USING (status IN ('live', 'ended'));

-- Contest winners table: stores awarded rewards per contest
CREATE TABLE public.leaderboard_contest_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES public.leaderboard_contests(id) ON DELETE CASCADE,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rank integer NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  reward_type text NOT NULL,
  reward_config jsonb DEFAULT '{}',
  reward_description text,
  redeemed boolean NOT NULL DEFAULT false,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leaderboard_contest_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage contest winners"
  ON public.leaderboard_contest_winners FOR ALL TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

CREATE POLICY "Users can view their own wins"
  ON public.leaderboard_contest_winners FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Index for fast lookups
CREATE INDEX idx_leaderboard_contests_venue_status ON public.leaderboard_contests(venue_id, status);
CREATE INDEX idx_leaderboard_contest_winners_user ON public.leaderboard_contest_winners(user_id);
CREATE INDEX idx_leaderboard_contest_winners_contest ON public.leaderboard_contest_winners(contest_id);
