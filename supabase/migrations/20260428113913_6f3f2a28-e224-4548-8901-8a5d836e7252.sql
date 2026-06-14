-- ============================================================
-- VAGUE 1 — Fondations Analytics Imbattables
-- ============================================================

-- 1. Enrichir visitor_sessions
ALTER TABLE public.visitor_sessions
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS landing_page_full text,
  ADD COLUMN IF NOT EXISTS referrer_category text,
  ADD COLUMN IF NOT EXISTS visitor_id text,
  ADD COLUMN IF NOT EXISTS is_returning boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS visit_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS viewport_w integer,
  ADD COLUMN IF NOT EXISTS viewport_h integer,
  ADD COLUMN IF NOT EXISTS connection_type text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS pages_viewed integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scroll_depth_max integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor_id ON public.visitor_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_referrer_cat ON public.visitor_sessions(referrer_category);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_country ON public.visitor_sessions(country);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_utm_campaign ON public.visitor_sessions(utm_campaign) WHERE utm_campaign IS NOT NULL;

-- Allow updating new fields too (validate trigger needs no change since only field check is for biz fields)

-- 2. visitor_events (micro-interactions)
CREATE TABLE IF NOT EXISTS public.visitor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  organizer_user_id uuid,
  user_id uuid,
  event_type text NOT NULL,
  target text,
  payload jsonb DEFAULT '{}'::jsonb,
  page_path text,
  ts timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_events_session ON public.visitor_events(session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_events_venue ON public.visitor_events(venue_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_events_event ON public.visitor_events(event_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_events_organizer ON public.visitor_events(organizer_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_events_type ON public.visitor_events(event_type);

ALTER TABLE public.visitor_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert visitor events"
  ON public.visitor_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Venue owners read their visitor events"
  ON public.visitor_events FOR SELECT
  TO authenticated
  USING (
    venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id)
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

-- 3. customer_activity_log
CREATE TABLE IF NOT EXISTS public.customer_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  ref_type text,
  ref_id uuid,
  amount_cents integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  ts timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_user ON public.customer_activity_log(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cal_venue ON public.customer_activity_log(venue_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cal_organizer ON public.customer_activity_log(organizer_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cal_event ON public.customer_activity_log(event_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_cal_type ON public.customer_activity_log(activity_type);

ALTER TABLE public.customer_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own activity"
  ON public.customer_activity_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Venue staff read venue activity"
  ON public.customer_activity_log FOR SELECT
  TO authenticated
  USING (
    venue_id IS NOT NULL AND (
      public.is_venue_owner(auth.uid(), venue_id)
      OR public.is_venue_staff(auth.uid(), venue_id)
    )
  );

CREATE POLICY "Organizers read their activity"
  ON public.customer_activity_log FOR SELECT
  TO authenticated
  USING (organizer_user_id = auth.uid() OR public.is_super_admin());

CREATE POLICY "System can insert activity"
  ON public.customer_activity_log FOR INSERT
  WITH CHECK (true);

-- 4. attribution_touchpoints
CREATE TABLE IF NOT EXISTS public.attribution_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  visitor_id text,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  touch_type text NOT NULL,
  source text,
  medium text,
  campaign text,
  referrer_domain text,
  ts timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_user ON public.attribution_touchpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_att_visitor ON public.attribution_touchpoints(visitor_id);
CREATE INDEX IF NOT EXISTS idx_att_venue ON public.attribution_touchpoints(venue_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_att_organizer ON public.attribution_touchpoints(organizer_user_id, ts DESC);

ALTER TABLE public.attribution_touchpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert touchpoints"
  ON public.attribution_touchpoints FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Venue owners read touchpoints"
  ON public.attribution_touchpoints FOR SELECT
  TO authenticated
  USING (
    venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id)
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

-- 5. Materialized view (rollup) — venue & organizer
CREATE MATERIALIZED VIEW IF NOT EXISTS public.analytics_daily_rollup AS
SELECT
  date_trunc('day', visited_at) AS day,
  venue_id,
  organizer_user_id,
  COUNT(*) AS visits,
  COUNT(DISTINCT visitor_id) AS unique_visitors,
  COUNT(*) FILTER (WHERE added_to_cart) AS carts,
  COUNT(*) FILTER (WHERE proceeded_to_checkout) AS checkouts,
  COUNT(*) FILTER (WHERE completed_order) AS conversions,
  COALESCE(SUM(cart_value_cents) FILTER (WHERE added_to_cart), 0) AS cart_value_cents_sum,
  COALESCE(AVG(duration_seconds), 0)::integer AS avg_duration_s,
  COUNT(*) FILTER (WHERE is_returning) AS returning_count,
  COUNT(DISTINCT referrer_category) AS source_diversity
FROM public.visitor_sessions
WHERE visited_at >= now() - interval '180 days'
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_rollup_unique
  ON public.analytics_daily_rollup(day, COALESCE(venue_id, ''), COALESCE(organizer_user_id::text, ''));
CREATE INDEX IF NOT EXISTS idx_analytics_rollup_venue ON public.analytics_daily_rollup(venue_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_rollup_organizer ON public.analytics_daily_rollup(organizer_user_id, day DESC);

-- Helper function to refresh the rollup (called by cron later)
CREATE OR REPLACE FUNCTION public.refresh_analytics_rollup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.analytics_daily_rollup;
END;
$$;

-- 6. Helper RPC: customer timeline
CREATE OR REPLACE FUNCTION public.get_customer_timeline(
  p_user_id uuid,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  ts timestamp with time zone,
  activity_type text,
  ref_type text,
  ref_id uuid,
  amount_cents integer,
  event_id uuid,
  metadata jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cal.ts, cal.activity_type, cal.ref_type, cal.ref_id, cal.amount_cents, cal.event_id, cal.metadata
  FROM public.customer_activity_log cal
  WHERE cal.user_id = p_user_id
    AND (p_venue_id IS NULL OR cal.venue_id = p_venue_id)
    AND (p_organizer_user_id IS NULL OR cal.organizer_user_id = p_organizer_user_id)
  ORDER BY cal.ts DESC
  LIMIT p_limit;
$$;