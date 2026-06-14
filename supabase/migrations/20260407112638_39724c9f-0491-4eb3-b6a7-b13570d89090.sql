
-- Add leaderboard_visibility to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS leaderboard_visibility text NOT NULL DEFAULT 'public';

-- Create client_scores table
CREATE TABLE public.client_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  total_score numeric NOT NULL DEFAULT 0,
  spend_score numeric NOT NULL DEFAULT 0,
  visit_score numeric NOT NULL DEFAULT 0,
  vip_score numeric NOT NULL DEFAULT 0,
  event_score numeric NOT NULL DEFAULT 0,
  recency_boost numeric NOT NULL DEFAULT 0,
  rank integer,
  monthly_score numeric NOT NULL DEFAULT 0,
  monthly_rank integer,
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, venue_id)
);

-- Create leaderboard_settings table
CREATE TABLE public.leaderboard_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE UNIQUE,
  is_enabled boolean NOT NULL DEFAULT false,
  leaderboard_type text NOT NULL DEFAULT 'lifetime',
  spend_weight numeric NOT NULL DEFAULT 1.0,
  visit_weight numeric NOT NULL DEFAULT 0.5,
  vip_weight numeric NOT NULL DEFAULT 2.0,
  event_weight numeric NOT NULL DEFAULT 0.3,
  recency_enabled boolean NOT NULL DEFAULT true,
  recency_days integer NOT NULL DEFAULT 30,
  show_top_count integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create leaderboard_rewards table
CREATE TABLE public.leaderboard_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  rank_min integer NOT NULL,
  rank_max integer NOT NULL,
  reward_type text NOT NULL DEFAULT 'recognition',
  reward_description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.client_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_rewards ENABLE ROW LEVEL SECURITY;

-- client_scores: anyone can read public scores, owners can manage
CREATE POLICY "Anyone can view client scores" ON public.client_scores
  FOR SELECT USING (true);

CREATE POLICY "Venue owners can manage client scores" ON public.client_scores
  FOR ALL TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

-- leaderboard_settings: anyone can read (to check if enabled), owners can manage
CREATE POLICY "Anyone can view leaderboard settings" ON public.leaderboard_settings
  FOR SELECT USING (true);

CREATE POLICY "Venue owners can manage leaderboard settings" ON public.leaderboard_settings
  FOR ALL TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

-- leaderboard_rewards: anyone can read, owners can manage
CREATE POLICY "Anyone can view leaderboard rewards" ON public.leaderboard_rewards
  FOR SELECT USING (true);

CREATE POLICY "Venue owners can manage leaderboard rewards" ON public.leaderboard_rewards
  FOR ALL TO authenticated
  USING (public.can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (public.can_manage_venue(auth.uid(), venue_id));

-- Scoring function
CREATE OR REPLACE FUNCTION public.calculate_client_scores(p_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_spend_weight numeric;
  v_visit_weight numeric;
  v_vip_weight numeric;
  v_event_weight numeric;
  v_recency_enabled boolean;
  v_recency_days integer;
BEGIN
  -- Get weights from settings (or defaults)
  SELECT 
    COALESCE(spend_weight, 1.0),
    COALESCE(visit_weight, 0.5),
    COALESCE(vip_weight, 2.0),
    COALESCE(event_weight, 0.3),
    COALESCE(recency_enabled, true),
    COALESCE(recency_days, 30)
  INTO v_spend_weight, v_visit_weight, v_vip_weight, v_event_weight, v_recency_enabled, v_recency_days
  FROM leaderboard_settings
  WHERE venue_id = p_venue_id;

  -- If no settings found, use defaults
  IF NOT FOUND THEN
    v_spend_weight := 1.0;
    v_visit_weight := 0.5;
    v_vip_weight := 2.0;
    v_event_weight := 0.3;
    v_recency_enabled := true;
    v_recency_days := 30;
  END IF;

  -- Upsert scores from venue_customers
  INSERT INTO client_scores (user_id, venue_id, spend_score, visit_score, vip_score, event_score, recency_boost, total_score, monthly_score, last_activity_at, updated_at)
  SELECT 
    vc.user_id,
    vc.venue_id,
    COALESCE(vc.total_spent, 0) * v_spend_weight,
    (COALESCE(vc.order_count, 0) + COALESCE(vc.ticket_count, 0)) * v_visit_weight,
    COALESCE(vc.table_count, 0) * v_vip_weight * 100,
    COALESCE(vc.ticket_count, 0) * v_event_weight * 10,
    CASE WHEN v_recency_enabled AND vc.last_visit_at > now() - (v_recency_days || ' days')::interval
      THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.2
      ELSE 0 
    END,
    -- total_score
    (COALESCE(vc.total_spent, 0) * v_spend_weight) +
    ((COALESCE(vc.order_count, 0) + COALESCE(vc.ticket_count, 0)) * v_visit_weight) +
    (COALESCE(vc.table_count, 0) * v_vip_weight * 100) +
    (COALESCE(vc.ticket_count, 0) * v_event_weight * 10) +
    CASE WHEN v_recency_enabled AND vc.last_visit_at > now() - (v_recency_days || ' days')::interval
      THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.2
      ELSE 0 
    END,
    -- monthly_score: only count activity from current month
    CASE WHEN vc.last_visit_at >= date_trunc('month', now())
      THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.5
      ELSE 0
    END,
    vc.last_visit_at,
    now()
  FROM venue_customers vc
  WHERE vc.venue_id = p_venue_id AND vc.user_id IS NOT NULL
  ON CONFLICT (user_id, venue_id) DO UPDATE SET
    spend_score = EXCLUDED.spend_score,
    visit_score = EXCLUDED.visit_score,
    vip_score = EXCLUDED.vip_score,
    event_score = EXCLUDED.event_score,
    recency_boost = EXCLUDED.recency_boost,
    total_score = EXCLUDED.total_score,
    monthly_score = EXCLUDED.monthly_score,
    last_activity_at = EXCLUDED.last_activity_at,
    updated_at = now();

  -- Update lifetime ranks
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY total_score DESC) as new_rank
    FROM client_scores WHERE venue_id = p_venue_id
  )
  UPDATE client_scores cs SET rank = r.new_rank
  FROM ranked r WHERE cs.id = r.id;

  -- Update monthly ranks
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY monthly_score DESC) as new_rank
    FROM client_scores WHERE venue_id = p_venue_id AND monthly_score > 0
  )
  UPDATE client_scores cs SET monthly_rank = r.new_rank
  FROM ranked r WHERE cs.id = r.id;
END;
$$;
