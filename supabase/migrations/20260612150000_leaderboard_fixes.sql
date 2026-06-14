-- ============================================================
-- Leaderboard / Loyalty CRM — correctness + automation overhaul
--
-- Fixes:
--  P1  Scores never auto-recalculated (no cron/trigger)  -> recalc_all_leaderboards() + pg_cron
--  P2  Contest scoring ignored the contest date window    -> real windowed scoring from
--      and "monthly/yearly" were lifetime spend gated         orders/tickets/table_reservations
--      by "active this period"
--  P3  Winners computed but never delivered to clients    -> finalize now issues a redeemable
--                                                             reward_redemptions voucher + crm
--                                                             notification, validatable by staff
--  P4  finalize() read stale scores                       -> finalize recalculates first
--  Sec recency double-counted spend                       -> removed from total_score
-- ============================================================

-- ------------------------------------------------------------
-- 0. Schema additions
-- ------------------------------------------------------------

-- Let reward_redemptions carry non-loyalty (contest) vouchers.
ALTER TABLE public.reward_redemptions
  ALTER COLUMN reward_id DROP NOT NULL;

ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'loyalty',
  ADD COLUMN IF NOT EXISTS reward_label text,
  ADD COLUMN IF NOT EXISTS contest_winner_id uuid
    REFERENCES public.leaderboard_contest_winners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Link a winner back to the voucher we minted for them (so the owner dashboard
-- can reflect real "used / pending" state).
ALTER TABLE public.leaderboard_contest_winners
  ADD COLUMN IF NOT EXISTS redemption_id uuid
    REFERENCES public.reward_redemptions(id) ON DELETE SET NULL;

-- Per-contest, window-correct scores (separate from the perpetual client_scores board).
CREATE TABLE IF NOT EXISTS public.leaderboard_contest_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES public.leaderboard_contests(id) ON DELETE CASCADE,
  venue_id text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  spend numeric NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  ticket_count integer NOT NULL DEFAULT 0,
  table_count integer NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  rank integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_scores_contest_rank
  ON public.leaderboard_contest_scores (contest_id, rank);

ALTER TABLE public.leaderboard_contest_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue staff read contest scores" ON public.leaderboard_contest_scores;
CREATE POLICY "Venue staff read contest scores"
  ON public.leaderboard_contest_scores FOR SELECT
  TO authenticated
  USING (
    public.can_manage_venue(auth.uid(), venue_id)
    OR public.is_venue_staff(auth.uid(), venue_id)
    OR public.is_super_admin()
  );

-- ------------------------------------------------------------
-- 1. Shared activity aggregator (the authoritative spend source)
--    Sums real paid transactions in [p_start, p_end) for a venue,
--    optionally scoped to a single event. Refunds are netted out.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._leaderboard_user_activity(
  p_venue_id text,
  p_start timestamptz,
  p_end timestamptz,
  p_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  spend numeric,
  order_count integer,
  ticket_count integer,
  table_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    t.user_id,
    SUM(t.spend)::numeric                AS spend,
    SUM(t.is_order)::integer             AS order_count,
    SUM(t.is_ticket)::integer            AS ticket_count,
    SUM(t.is_table)::integer             AS table_count
  FROM (
    -- Drink orders (venue-scoped directly)
    SELECT
      o.user_id,
      GREATEST(COALESCE(o.total, 0) - COALESCE(o.refund_amount, 0), 0) AS spend,
      1 AS is_order, 0 AS is_ticket, 0 AS is_table
    FROM public.orders o
    WHERE o.venue_id = p_venue_id
      AND o.user_id IS NOT NULL
      AND o.status IN ('paid', 'served')
      AND o.refunded_at IS NULL
      AND COALESCE(o.paid_at, o.created_at) >= p_start
      AND COALESCE(o.paid_at, o.created_at) <  p_end
      AND (p_event_id IS NULL OR o.event_id = p_event_id)

    UNION ALL

    -- Event tickets (venue via events)
    SELECT
      tk.user_id,
      GREATEST(COALESCE(tk.total_price, 0) - COALESCE(tk.refund_amount, 0), 0),
      0, 1, 0
    FROM public.tickets tk
    JOIN public.events e ON e.id = tk.event_id
    WHERE e.venue_id = p_venue_id
      AND tk.user_id IS NOT NULL
      AND tk.status = 'paid'
      AND tk.refunded_at IS NULL
      AND COALESCE(tk.paid_at, tk.created_at) >= p_start
      AND COALESCE(tk.paid_at, tk.created_at) <  p_end
      AND (p_event_id IS NULL OR tk.event_id = p_event_id)

    UNION ALL

    -- Table reservations (venue via events)
    SELECT
      tr.user_id,
      GREATEST(COALESCE(tr.total_price, 0) - COALESCE(tr.refund_amount, 0), 0),
      0, 0, 1
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE e.venue_id = p_venue_id
      AND tr.user_id IS NOT NULL
      AND tr.status = 'paid'
      AND tr.refunded_at IS NULL
      AND COALESCE(tr.paid_at, tr.created_at) >= p_start
      AND COALESCE(tr.paid_at, tr.created_at) <  p_end
      AND (p_event_id IS NULL OR tr.event_id = p_event_id)
  ) t
  GROUP BY t.user_id;
$$;

-- ------------------------------------------------------------
-- 2. Perpetual board: calculate_client_scores
--    - all-time from venue_customers aggregates
--    - monthly/yearly now reflect REAL spend in the period
--    - recency no longer double-counted into total_score
--    - authorization relaxed for trusted server context (cron => auth.uid() IS NULL)
-- ------------------------------------------------------------
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
  v_month_start timestamptz := date_trunc('month', now());
  v_year_start  timestamptz := date_trunc('year', now());
  v_now timestamptz := now();
BEGIN
  -- Allow venue managers, super admins, or trusted server contexts (cron / service role).
  IF auth.uid() IS NOT NULL
     AND NOT (public.can_manage_venue(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(spend_weight, 1.0), COALESCE(visit_weight, 0.5), COALESCE(vip_weight, 2.0),
         COALESCE(event_weight, 0.3), COALESCE(recency_enabled, true), COALESCE(recency_days, 30)
    INTO v_spend_weight, v_visit_weight, v_vip_weight, v_event_weight, v_recency_enabled, v_recency_days
  FROM public.leaderboard_settings
  WHERE venue_id = p_venue_id;

  IF NOT FOUND THEN
    v_spend_weight := 1.0; v_visit_weight := 0.5; v_vip_weight := 2.0;
    v_event_weight := 0.3; v_recency_enabled := true; v_recency_days := 30;
  END IF;

  -- 2a. All-time scores from venue_customers aggregates.
  --     total_score = spend + visits + vip + event (+ recency boost, counted ONCE).
  INSERT INTO public.client_scores (
    user_id, venue_id, spend_score, visit_score, vip_score, event_score,
    recency_boost, total_score, monthly_score, yearly_score, last_activity_at, updated_at
  )
  SELECT
    vc.user_id, vc.venue_id,
    COALESCE(vc.total_spent, 0) * v_spend_weight,
    (COALESCE(vc.order_count, 0) + COALESCE(vc.ticket_count, 0)) * v_visit_weight,
    COALESCE(vc.table_count, 0) * v_vip_weight * 100,
    COALESCE(vc.ticket_count, 0) * v_event_weight * 10,
    CASE WHEN v_recency_enabled AND vc.last_visit_at > v_now - (v_recency_days || ' days')::interval
         THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.2 ELSE 0 END,
    -- total_score: base components + recency boost (single inclusion)
    (COALESCE(vc.total_spent, 0) * v_spend_weight)
      + ((COALESCE(vc.order_count, 0) + COALESCE(vc.ticket_count, 0)) * v_visit_weight)
      + (COALESCE(vc.table_count, 0) * v_vip_weight * 100)
      + (COALESCE(vc.ticket_count, 0) * v_event_weight * 10)
      + CASE WHEN v_recency_enabled AND vc.last_visit_at > v_now - (v_recency_days || ' days')::interval
             THEN (COALESCE(vc.total_spent, 0) * v_spend_weight) * 0.2 ELSE 0 END,
    0, 0,  -- monthly/yearly set below from real activity
    vc.last_visit_at, v_now
  FROM public.venue_customers vc
  WHERE vc.venue_id = p_venue_id AND vc.user_id IS NOT NULL
  ON CONFLICT (user_id, venue_id) DO UPDATE SET
    spend_score      = EXCLUDED.spend_score,
    visit_score      = EXCLUDED.visit_score,
    vip_score        = EXCLUDED.vip_score,
    event_score      = EXCLUDED.event_score,
    recency_boost    = EXCLUDED.recency_boost,
    total_score      = EXCLUDED.total_score,
    last_activity_at = EXCLUDED.last_activity_at,
    updated_at       = v_now;

  -- 2b. Reset period scores, then set from REAL windowed spend.
  UPDATE public.client_scores SET monthly_score = 0, yearly_score = 0
  WHERE venue_id = p_venue_id;

  UPDATE public.client_scores cs SET monthly_score =
      (a.spend * v_spend_weight)
      + ((a.order_count + a.ticket_count) * v_visit_weight)
      + (a.table_count * v_vip_weight * 100)
      + (a.ticket_count * v_event_weight * 10)
  FROM public._leaderboard_user_activity(p_venue_id, v_month_start, v_now + interval '1 second', NULL) a
  WHERE cs.venue_id = p_venue_id AND cs.user_id = a.user_id;

  UPDATE public.client_scores cs SET yearly_score =
      (a.spend * v_spend_weight)
      + ((a.order_count + a.ticket_count) * v_visit_weight)
      + (a.table_count * v_vip_weight * 100)
      + (a.ticket_count * v_event_weight * 10)
  FROM public._leaderboard_user_activity(p_venue_id, v_year_start, v_now + interval '1 second', NULL) a
  WHERE cs.venue_id = p_venue_id AND cs.user_id = a.user_id;

  -- 2c. Ranks.
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY total_score DESC) AS new_rank
    FROM public.client_scores WHERE venue_id = p_venue_id
  )
  UPDATE public.client_scores cs SET rank = r.new_rank FROM ranked r WHERE cs.id = r.id;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY monthly_score DESC) AS new_rank
    FROM public.client_scores WHERE venue_id = p_venue_id AND monthly_score > 0
  )
  UPDATE public.client_scores cs SET monthly_rank = r.new_rank FROM ranked r WHERE cs.id = r.id;
  UPDATE public.client_scores SET monthly_rank = NULL
  WHERE venue_id = p_venue_id AND monthly_score = 0;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY yearly_score DESC) AS new_rank
    FROM public.client_scores WHERE venue_id = p_venue_id AND yearly_score > 0
  )
  UPDATE public.client_scores cs SET yearly_rank = r.new_rank FROM ranked r WHERE cs.id = r.id;
  UPDATE public.client_scores SET yearly_rank = NULL
  WHERE venue_id = p_venue_id AND yearly_score = 0;
END;
$function$;

-- ------------------------------------------------------------
-- 3. Window-correct contest scoring
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_contest_scores(p_contest_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contest RECORD;
  v_spend_weight numeric;
  v_visit_weight numeric;
  v_vip_weight numeric;
  v_event_weight numeric;
  v_event_filter uuid;
BEGIN
  SELECT * INTO v_contest FROM public.leaderboard_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contest not found';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT (public.can_manage_venue(auth.uid(), v_contest.venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(spend_weight, 1.0), COALESCE(visit_weight, 0.5),
         COALESCE(vip_weight, 2.0), COALESCE(event_weight, 0.3)
    INTO v_spend_weight, v_visit_weight, v_vip_weight, v_event_weight
  FROM public.leaderboard_settings
  WHERE venue_id = v_contest.venue_id;

  IF NOT FOUND THEN
    v_spend_weight := 1.0; v_visit_weight := 0.5; v_vip_weight := 2.0; v_event_weight := 0.3;
  END IF;

  -- Event contests only count the linked event's transactions.
  v_event_filter := CASE WHEN v_contest.contest_type = 'event' THEN v_contest.event_id ELSE NULL END;

  -- Refresh the contest score table for this contest.
  DELETE FROM public.leaderboard_contest_scores WHERE contest_id = p_contest_id;

  INSERT INTO public.leaderboard_contest_scores
    (contest_id, venue_id, user_id, spend, order_count, ticket_count, table_count, score, updated_at)
  SELECT
    p_contest_id, v_contest.venue_id, a.user_id,
    a.spend, a.order_count, a.ticket_count, a.table_count,
    (a.spend * v_spend_weight)
      + ((a.order_count + a.ticket_count) * v_visit_weight)
      + (a.table_count * v_vip_weight * 100)
      + (a.ticket_count * v_event_weight * 10),
    now()
  FROM public._leaderboard_user_activity(
    v_contest.venue_id,
    v_contest.start_date::timestamptz,
    v_contest.end_date::timestamptz,
    v_event_filter
  ) a;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) AS new_rank
    FROM public.leaderboard_contest_scores
    WHERE contest_id = p_contest_id AND score > 0
  )
  UPDATE public.leaderboard_contest_scores cs
    SET rank = r.new_rank FROM ranked r WHERE cs.id = r.id;
END;
$function$;

-- ------------------------------------------------------------
-- 4. Reward delivery helper: mint a redeemable voucher + notify the winner.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._deliver_contest_reward(
  p_winner_id uuid,
  p_venue_id text,
  p_user_id uuid,
  p_contest_name text,
  p_reward_type text,
  p_reward_config jsonb,
  p_reward_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_loyalty_id uuid;
  v_redemption_id uuid;
  v_label text;
BEGIN
  SELECT id INTO v_customer_id
  FROM public.venue_customers
  WHERE venue_id = p_venue_id AND user_id = p_user_id;

  -- No venue_customer row means we have no contactable customer profile; skip silently.
  IF v_customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_loyalty_id := public.get_or_create_customer_loyalty(p_venue_id, p_user_id, v_customer_id);

  v_label := COALESCE(
    NULLIF(p_reward_description, ''),
    CASE p_reward_type
      WHEN 'free_ticket' THEN 'Free ticket'
      WHEN 'free_drink'  THEN 'Free drink'
      WHEN 'free_table'  THEN 'Free table'
      ELSE 'Reward'
    END
  ) || ' — ' || COALESCE(p_contest_name, 'Contest');

  INSERT INTO public.reward_redemptions (
    customer_loyalty_id, reward_id, venue_id, user_id, points_spent,
    qr_code, status, expires_at, source, reward_label, contest_winner_id, metadata
  ) VALUES (
    v_loyalty_id, NULL, p_venue_id, p_user_id, 0,
    'LB-' || replace(gen_random_uuid()::text, '-', ''),
    'pending', now() + interval '60 days',
    'contest', v_label, p_winner_id,
    jsonb_build_object(
      'reward_type', p_reward_type,
      'reward_config', COALESCE(p_reward_config, '{}'::jsonb),
      'contest_name', p_contest_name
    )
  )
  RETURNING id INTO v_redemption_id;

  UPDATE public.leaderboard_contest_winners
    SET redemption_id = v_redemption_id WHERE id = p_winner_id;

  INSERT INTO public.crm_notifications (
    venue_id, venue_customer_id, user_id, title, message, notification_type, metadata
  ) VALUES (
    p_venue_id, v_customer_id, p_user_id,
    'You won a reward!',
    'Congratulations — you placed in "' || COALESCE(p_contest_name, 'a contest')
      || '". Your reward (' || v_label || ') is ready in your rewards.',
    'reward',
    jsonb_build_object('contest_winner_id', p_winner_id, 'redemption_id', v_redemption_id)
  );

  RETURN v_redemption_id;
END;
$function$;

-- ------------------------------------------------------------
-- 5. finalize_leaderboard_contest — recalc first, score on the contest window,
--    deliver real vouchers when auto_reward is on.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_leaderboard_contest(p_contest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contest RECORD;
  v_reward RECORD;
  v_score RECORD;
  v_winner_id uuid;
  v_winners_count integer := 0;
  v_delivered_count integer := 0;
BEGIN
  SELECT * INTO v_contest FROM public.leaderboard_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Contest not found');
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT (public.can_manage_venue(auth.uid(), v_contest.venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_contest.rewards_distributed THEN
    RETURN jsonb_build_object('error', 'Rewards already distributed', 'winners', 0);
  END IF;

  -- P4: always score on fresh, window-correct data before picking winners.
  PERFORM public.calculate_contest_scores(p_contest_id);

  FOR v_reward IN
    SELECT lr.* FROM public.leaderboard_rewards lr
    WHERE lr.id = ANY(v_contest.reward_preset_ids) AND lr.is_active = true
  LOOP
    FOR v_score IN
      SELECT cs.user_id, cs.rank AS effective_rank, cs.score AS effective_score
      FROM public.leaderboard_contest_scores cs
      WHERE cs.contest_id = p_contest_id
        AND cs.rank BETWEEN v_reward.rank_min AND v_reward.rank_max
        AND cs.score > 0
    LOOP
      INSERT INTO public.leaderboard_contest_winners (
        contest_id, venue_id, user_id, rank, score,
        reward_type, reward_config, reward_description
      ) VALUES (
        p_contest_id, v_contest.venue_id, v_score.user_id,
        v_score.effective_rank, v_score.effective_score,
        v_reward.reward_type, v_reward.reward_config, v_reward.reward_description
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_winner_id;

      -- Only count + deliver for freshly inserted winners.
      IF v_winner_id IS NOT NULL THEN
        v_winners_count := v_winners_count + 1;

        IF v_contest.auto_reward THEN
          IF public._deliver_contest_reward(
              v_winner_id, v_contest.venue_id, v_score.user_id, v_contest.name,
              v_reward.reward_type, v_reward.reward_config, v_reward.reward_description
            ) IS NOT NULL THEN
            v_delivered_count := v_delivered_count + 1;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.leaderboard_contests
    SET status = 'ended', rewards_distributed = true, updated_at = now()
  WHERE id = p_contest_id;

  RETURN jsonb_build_object(
    'winners', v_winners_count,
    'delivered', v_delivered_count,
    'status', 'distributed'
  );
END;
$function$;

-- ------------------------------------------------------------
-- 6. When a contest voucher is validated/used, reflect it on the winner row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sync_contest_winner_redeemed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.source = 'contest'
     AND NEW.contest_winner_id IS NOT NULL
     AND NEW.status = 'used'
     AND COALESCE(OLD.status, '') <> 'used' THEN
    UPDATE public.leaderboard_contest_winners
      SET redeemed = true, redeemed_at = COALESCE(NEW.used_at, now())
    WHERE id = NEW.contest_winner_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_contest_winner_redeemed ON public.reward_redemptions;
CREATE TRIGGER trg_sync_contest_winner_redeemed
  AFTER UPDATE ON public.reward_redemptions
  FOR EACH ROW EXECUTE FUNCTION public._sync_contest_winner_redeemed();

-- ------------------------------------------------------------
-- 7. P1: automatic recalculation + auto-finalize across all active venues.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_all_leaderboards()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text;
  v_contest RECORD;
  v_count integer := 0;
BEGIN
  -- Refresh perpetual scores for every venue with the leaderboard enabled.
  FOR v_venue IN
    SELECT venue_id FROM public.leaderboard_settings WHERE is_enabled = true
  LOOP
    PERFORM public.calculate_client_scores(v_venue);
    v_count := v_count + 1;
  END LOOP;

  -- Keep live contest leaderboards fresh.
  FOR v_contest IN
    SELECT id FROM public.leaderboard_contests WHERE status = 'live'
  LOOP
    PERFORM public.calculate_contest_scores(v_contest.id);
  END LOOP;

  -- Auto-finalize expired live contests that opted into auto rewards.
  FOR v_contest IN
    SELECT id FROM public.leaderboard_contests
    WHERE status = 'live'
      AND end_date <= now()
      AND auto_reward = true
      AND rewards_distributed = false
  LOOP
    PERFORM public.finalize_leaderboard_contest(v_contest.id);
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Grants: callable by the UI (authenticated, in-function authz) + service role for cron.
REVOKE EXECUTE ON FUNCTION public._leaderboard_user_activity(text, timestamptz, timestamptz, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._deliver_contest_reward(uuid, text, uuid, text, text, jsonb, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_all_leaderboards() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_contest_scores(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_client_scores(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_leaderboard_contest(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 8. Schedule the recurring recalculation (hourly).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'leaderboard-recalc-hourly') THEN
      PERFORM cron.unschedule('leaderboard-recalc-hourly');
    END IF;
    PERFORM cron.schedule(
      'leaderboard-recalc-hourly',
      '7 * * * *',
      $cron$SELECT public.recalc_all_leaderboards()$cron$
    );
  END IF;
END $$;
