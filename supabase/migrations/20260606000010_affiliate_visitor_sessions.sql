-- ============================================================
-- AFFILIATE VISITOR SESSIONS
-- Full page-view tracking for affiliate public pages
-- (mirrors visitor_sessions but scoped to affiliates)
-- ============================================================

CREATE TABLE affiliate_visitor_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         text NOT NULL,
  affiliate_id       uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  affiliate_event_id uuid REFERENCES affiliate_events(id) ON DELETE SET NULL,
  affiliate_venue_id uuid REFERENCES affiliate_venues(id) ON DELETE SET NULL,

  -- Persistent pseudonymous visitor identity
  visitor_id         text,
  is_returning       boolean DEFAULT false,
  visit_number       int DEFAULT 1,

  -- Device & browser
  device_type        text,         -- mobile | tablet | desktop
  user_agent         text,
  language           text,
  viewport_w         int,
  viewport_h         int,
  connection_type    text,

  -- Attribution
  referrer           text,
  referrer_domain    text,
  referrer_category  text,         -- direct | social | search | qr | email | paid | referral | internal
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  utm_content        text,
  utm_term           text,
  landing_page_full  text,
  entry_page         text,
  entry_page_type    text,         -- event_page | venue_page | linktree

  -- Engagement (updated on leave)
  duration_seconds   int,
  scroll_depth_max   int,
  last_activity_at   timestamptz,

  -- Geo (enriched async by geocode function if needed)
  country            text,
  city               text,

  visited_at         timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- AFFILIATE LIVE PINGS
-- Heartbeat for real-time live visitor count
-- ============================================================

CREATE TABLE affiliate_live_pings (
  session_id         text PRIMARY KEY,
  affiliate_id       uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  affiliate_event_id uuid REFERENCES affiliate_events(id) ON DELETE SET NULL,
  affiliate_venue_id uuid REFERENCES affiliate_venues(id) ON DELETE SET NULL,
  last_seen          timestamptz NOT NULL DEFAULT now(),
  page_path          text
);

-- ============================================================
-- ENRICH affiliate_clicks with attribution data
-- ============================================================

ALTER TABLE affiliate_clicks
  ADD COLUMN IF NOT EXISTS device_type        text,
  ADD COLUMN IF NOT EXISTS referrer_category  text,
  ADD COLUMN IF NOT EXISTS utm_source         text,
  ADD COLUMN IF NOT EXISTS utm_medium         text,
  ADD COLUMN IF NOT EXISTS utm_campaign       text,
  ADD COLUMN IF NOT EXISTS visitor_id         text,
  ADD COLUMN IF NOT EXISTS is_returning       boolean,
  ADD COLUMN IF NOT EXISTS affiliate_venue_id uuid REFERENCES affiliate_venues(id) ON DELETE SET NULL;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_aff_sessions_affiliate_id  ON affiliate_visitor_sessions(affiliate_id);
CREATE INDEX idx_aff_sessions_event_id      ON affiliate_visitor_sessions(affiliate_event_id);
CREATE INDEX idx_aff_sessions_venue_id      ON affiliate_visitor_sessions(affiliate_venue_id);
CREATE INDEX idx_aff_sessions_visited_at    ON affiliate_visitor_sessions(visited_at);
CREATE INDEX idx_aff_sessions_visitor_id    ON affiliate_visitor_sessions(visitor_id);

CREATE INDEX idx_aff_live_affiliate_id      ON affiliate_live_pings(affiliate_id);
CREATE INDEX idx_aff_live_last_seen         ON affiliate_live_pings(last_seen);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE affiliate_visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_live_pings ENABLE ROW LEVEL SECURITY;

-- Public insert (anonymous visitors can track themselves)
CREATE POLICY "affiliate_sessions_insert_public"
  ON affiliate_visitor_sessions FOR INSERT
  WITH CHECK (true);

-- Affiliate owner can read their own sessions
CREATE POLICY "affiliate_sessions_select_owner"
  ON affiliate_visitor_sessions FOR SELECT
  USING (
    affiliate_id IN (
      SELECT id FROM affiliates WHERE user_id = auth.uid()
    )
  );

-- Public upsert for heartbeat pings
CREATE POLICY "affiliate_live_pings_upsert_public"
  ON affiliate_live_pings FOR INSERT
  WITH CHECK (true);

CREATE POLICY "affiliate_live_pings_update_public"
  ON affiliate_live_pings FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Affiliate owner can read their live pings
CREATE POLICY "affiliate_live_pings_select_owner"
  ON affiliate_live_pings FOR SELECT
  USING (
    affiliate_id IN (
      SELECT id FROM affiliates WHERE user_id = auth.uid()
    )
  );

-- Update duration/scroll on session (visitor updates their own row)
CREATE POLICY "affiliate_sessions_update_duration"
  ON affiliate_visitor_sessions FOR UPDATE
  USING (true)
  WITH CHECK (true);
