
CREATE OR REPLACE FUNCTION public.finalize_leaderboard_contest(p_contest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_contest RECORD;
  v_reward RECORD;
  v_score RECORD;
  v_winners_count integer := 0;
BEGIN
  -- Get contest
  SELECT * INTO v_contest FROM leaderboard_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Contest not found');
  END IF;
  
  IF v_contest.rewards_distributed THEN
    RETURN jsonb_build_object('error', 'Rewards already distributed', 'winners', 0);
  END IF;

  -- For each linked reward preset, find matching winners by rank
  FOR v_reward IN 
    SELECT lr.* FROM leaderboard_rewards lr
    WHERE lr.id = ANY(v_contest.reward_preset_ids)
    AND lr.is_active = true
  LOOP
    -- Get scores/ranks for this venue based on contest type
    FOR v_score IN
      SELECT cs.user_id,
        CASE 
          WHEN v_contest.contest_type = 'monthly' THEN cs.monthly_rank
          WHEN v_contest.contest_type = 'yearly' THEN cs.yearly_rank
          ELSE cs.rank
        END as effective_rank,
        CASE 
          WHEN v_contest.contest_type = 'monthly' THEN cs.monthly_score
          WHEN v_contest.contest_type = 'yearly' THEN cs.yearly_score
          ELSE cs.total_score
        END as effective_score
      FROM client_scores cs
      WHERE cs.venue_id = v_contest.venue_id
      AND CASE 
        WHEN v_contest.contest_type = 'monthly' THEN cs.monthly_rank
        WHEN v_contest.contest_type = 'yearly' THEN cs.yearly_rank
        ELSE cs.rank
      END BETWEEN v_reward.rank_min AND v_reward.rank_max
      AND CASE 
        WHEN v_contest.contest_type = 'monthly' THEN cs.monthly_score
        WHEN v_contest.contest_type = 'yearly' THEN cs.yearly_score
        ELSE cs.total_score
      END > 0
    LOOP
      INSERT INTO leaderboard_contest_winners (
        contest_id, venue_id, user_id, rank, score,
        reward_type, reward_config, reward_description
      ) VALUES (
        p_contest_id, v_contest.venue_id, v_score.user_id,
        v_score.effective_rank, v_score.effective_score,
        v_reward.reward_type, v_reward.reward_config, v_reward.reward_description
      ) ON CONFLICT DO NOTHING;
      v_winners_count := v_winners_count + 1;
    END LOOP;
  END LOOP;

  -- Mark contest as ended with rewards distributed
  UPDATE leaderboard_contests
  SET status = 'ended', rewards_distributed = true, updated_at = now()
  WHERE id = p_contest_id;

  RETURN jsonb_build_object('winners', v_winners_count, 'status', 'distributed');
END;
$$;

-- Function to auto-finalize expired contests (called by cron)
CREATE OR REPLACE FUNCTION public.auto_finalize_leaderboard_contests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_contest RECORD;
  v_count integer := 0;
BEGIN
  FOR v_contest IN
    SELECT id FROM leaderboard_contests
    WHERE status = 'live'
    AND end_date <= now()
    AND auto_reward = true
    AND rewards_distributed = false
  LOOP
    PERFORM finalize_leaderboard_contest(v_contest.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
