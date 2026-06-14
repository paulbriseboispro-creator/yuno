-- ============================================================
-- AFFILIATE SYSTEM
-- Allows Yuno, city agencies, and independents to manage
-- partner clubs + events with external ticket links (Shotgun, RA, etc.)
-- ============================================================

-- 1. Core affiliate entity (one per account)
CREATE TABLE affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'independent'
    CHECK (type IN ('yuno_internal', 'city_agency', 'independent')),
  city text,
  commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  tracking_prefix text UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Partner clubs managed by an affiliate (no owner account needed)
CREATE TABLE affiliate_venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid REFERENCES affiliates(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  city text,
  neighborhood text,
  description text,
  cover_image_url text,
  gallery_urls text[] DEFAULT '{}',
  instagram text,
  tiktok text,
  website text,
  external_booking_url text,
  genres text[] DEFAULT '{}',
  min_age int,
  dress_code text,
  address text,
  lat numeric(10,7),
  lng numeric(10,7),
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Events with external ticket URL (tracked redirect)
CREATE TABLE affiliate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid REFERENCES affiliates(id) ON DELETE CASCADE NOT NULL,
  affiliate_venue_id uuid REFERENCES affiliate_venues(id) ON DELETE SET NULL,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  event_date date NOT NULL,
  start_time time,
  end_time time,
  flyer_url text,
  gallery_urls text[] DEFAULT '{}',
  description text,
  genres text[] DEFAULT '{}',
  dj_names text[] DEFAULT '{}',
  external_ticket_url text,
  price_from numeric(10,2),
  is_free boolean NOT NULL DEFAULT false,
  is_sold_out boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'featured')),
  recurring_template_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Recurring event templates (day-of-week → auto-generate instances)
CREATE TABLE affiliate_recurring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid REFERENCES affiliates(id) ON DELETE CASCADE NOT NULL,
  affiliate_venue_id uuid REFERENCES affiliate_venues(id) ON DELETE SET NULL,
  name text NOT NULL,
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  advance_days int NOT NULL DEFAULT 14,
  start_time time,
  end_time time,
  price_from numeric(10,2),
  is_free boolean NOT NULL DEFAULT false,
  genres text[] DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK from affiliate_events to template
ALTER TABLE affiliate_events
  ADD CONSTRAINT affiliate_events_recurring_template_id_fkey
  FOREIGN KEY (recurring_template_id)
  REFERENCES affiliate_recurring_templates(id) ON DELETE SET NULL;

-- 5. Click tracking for external ticket links
CREATE TABLE affiliate_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_event_id uuid REFERENCES affiliate_events(id) ON DELETE CASCADE NOT NULL,
  affiliate_id uuid REFERENCES affiliates(id) ON DELETE CASCADE NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users,
  browser_id text,
  ip_hash text,
  referrer text
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_affiliate_venues_affiliate_id ON affiliate_venues(affiliate_id);
CREATE INDEX idx_affiliate_venues_slug ON affiliate_venues(slug);
CREATE INDEX idx_affiliate_venues_city ON affiliate_venues(city) WHERE is_active = true;

CREATE INDEX idx_affiliate_events_affiliate_id ON affiliate_events(affiliate_id);
CREATE INDEX idx_affiliate_events_venue_id ON affiliate_events(affiliate_venue_id);
CREATE INDEX idx_affiliate_events_date ON affiliate_events(event_date);
CREATE INDEX idx_affiliate_events_status ON affiliate_events(status);
CREATE INDEX idx_affiliate_events_slug ON affiliate_events(slug);

CREATE INDEX idx_affiliate_clicks_event_id ON affiliate_clicks(affiliate_event_id);
CREATE INDEX idx_affiliate_clicks_affiliate_id ON affiliate_clicks(affiliate_id);
CREATE INDEX idx_affiliate_clicks_clicked_at ON affiliate_clicks(clicked_at);

CREATE INDEX idx_affiliate_recurring_affiliate_id ON affiliate_recurring_templates(affiliate_id);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER affiliate_venues_updated_at
  BEFORE UPDATE ON affiliate_venues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER affiliate_events_updated_at
  BEFORE UPDATE ON affiliate_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER affiliate_recurring_templates_updated_at
  BEFORE UPDATE ON affiliate_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- EXTEND app_role enum to include 'affiliate'
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'affiliate'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'app_role')
  ) THEN
    ALTER TYPE app_role ADD VALUE 'affiliate';
  END IF;
END
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks ENABLE ROW LEVEL SECURITY;

-- Public: read active venues and published/featured events
CREATE POLICY "Public read active affiliate venues"
  ON affiliate_venues FOR SELECT
  USING (is_active = true);

CREATE POLICY "Public read published affiliate events"
  ON affiliate_events FOR SELECT
  USING (status IN ('published', 'featured'));

-- Affiliate: full access to own data
CREATE POLICY "Affiliate full access to own profile"
  ON affiliates FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Affiliate full access to own venues"
  ON affiliate_venues FOR ALL
  USING (
    affiliate_id IN (
      SELECT id FROM affiliates WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Affiliate full access to own events"
  ON affiliate_events FOR ALL
  USING (
    affiliate_id IN (
      SELECT id FROM affiliates WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Affiliate full access to own templates"
  ON affiliate_recurring_templates FOR ALL
  USING (
    affiliate_id IN (
      SELECT id FROM affiliates WHERE user_id = auth.uid()
    )
  );

-- Clicks: insert by anyone (tracking), read by affiliate
CREATE POLICY "Anyone can insert affiliate clicks"
  ON affiliate_clicks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Affiliate reads own clicks"
  ON affiliate_clicks FOR SELECT
  USING (
    affiliate_id IN (
      SELECT id FROM affiliates WHERE user_id = auth.uid()
    )
  );

-- Admin: service role bypasses all RLS (no policy needed)
