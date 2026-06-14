-- ============================================================
-- Enrich affiliate_clicks with attribution columns + is_internal flag
-- ============================================================

ALTER TABLE affiliate_clicks
  ADD COLUMN IF NOT EXISTS affiliate_venue_id uuid REFERENCES affiliate_venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_type        text,
  ADD COLUMN IF NOT EXISTS referrer_category  text,
  ADD COLUMN IF NOT EXISTS utm_source         text,
  ADD COLUMN IF NOT EXISTS utm_medium         text,
  ADD COLUMN IF NOT EXISTS utm_campaign       text,
  ADD COLUMN IF NOT EXISTS visitor_id         text,
  ADD COLUMN IF NOT EXISTS is_returning       boolean,
  ADD COLUMN IF NOT EXISTS is_internal        boolean NOT NULL DEFAULT false;

-- ============================================================
-- Add is_internal flag to affiliate_visitor_sessions
-- ============================================================

ALTER TABLE affiliate_visitor_sessions
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_venue_id
  ON affiliate_clicks(affiliate_venue_id);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_is_internal
  ON affiliate_clicks(is_internal) WHERE is_internal = false;

CREATE INDEX IF NOT EXISTS idx_affiliate_sessions_is_internal
  ON affiliate_visitor_sessions(is_internal) WHERE is_internal = false;
