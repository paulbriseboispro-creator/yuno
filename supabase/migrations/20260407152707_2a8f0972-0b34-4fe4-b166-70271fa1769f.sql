
-- Add new columns to leaderboard_settings
ALTER TABLE public.leaderboard_settings 
  ADD COLUMN IF NOT EXISTS contest_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_reward boolean NOT NULL DEFAULT true;

-- Update leaderboard_type default to 'monthly'
ALTER TABLE public.leaderboard_settings 
  ALTER COLUMN leaderboard_type SET DEFAULT 'monthly';

-- Add yearly scoring to client_scores
ALTER TABLE public.client_scores
  ADD COLUMN IF NOT EXISTS yearly_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yearly_rank integer;

-- Update calculate_client_scores function to support yearly scores
CREATE OR REPLACE FUNCTION public.calculate_client_scores(p_venue_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_spend_weight numeric;
  v_visit_weight numeric;
  v_vip_weight numeric;
  v_event_weight numeric;
  v_recency_enabled boolean;
  v_recency_days integer;
BEGIN
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

  IF NOT FOUND THEN
    v_spend_weight := 1.0;
    v_visit_weight := 0.5;
    v_vip_weight := 2.0;
    v_event_weight := 0.3;
    v_recency_enabled := true;
    v_recency_days := 30;
  END IF;

  -- Upsert scores from venue_customers
  INSERT INTO client_scores (user_id, venue_id, spend_score, visit_score, vip_score, event_score, recency_boost, total_score, monthly_score, yearly_score, last_activity_at, updated_at)
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
    -- total_score (lifetime)
    (COALESCE(vc.total_spent, 0) * v_spend_weight) +
    ((COALESCE(vc.order_count, 0) + COALESCE(vc.ticket_count, 0)) * v_visit_weight) +
    (COALESCE(vc.table_count, 0) * v_vip_weight * 100) +
    (COALESCE(vc.ticket_count, 0) * v_event_weight * 10) +
    CASE WHEN v_recency_enabled AND vc.last_visit_at > now() - (v_recency_days || ' days')::interval
      THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.2
      ELSE 0 
    END,
    -- monthly_score: activity from current month
    CASE WHEN vc.last_visit_at >= date_trunc('month', now())
      THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.5
      ELSE 0
    END,
    -- yearly_score: activity from current year
    CASE WHEN vc.last_visit_at >= date_trunc('year', now())
      THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.8
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
    yearly_score = EXCLUDED.yearly_score,
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

  -- Update yearly ranks
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY yearly_score DESC) as new_rank
    FROM client_scores WHERE venue_id = p_venue_id AND yearly_score > 0
  )
  UPDATE client_scores cs SET yearly_rank = r.new_rank
  FROM ranked r WHERE cs.id = r.id;
END;
$function$;
