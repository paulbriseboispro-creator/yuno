-- ============================================================
-- AFFILIATE PROFILE ENRICHMENT + MEMBERS SYSTEM
-- Adds public profile fields + sub-promoter management
-- ============================================================

-- 1. Enrich affiliate profile with public-facing fields
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS linktree_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Index for linktree slug lookup
CREATE INDEX IF NOT EXISTS idx_affiliates_linktree_slug
  ON affiliates(linktree_slug)
  WHERE linktree_slug IS NOT NULL;

-- 2. Affiliate members — sub-promoters who work under a city agency
CREATE TABLE IF NOT EXISTS affiliate_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid REFERENCES affiliates(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL DEFAULT 'promoter'
    CHECK (role IN ('promoter', 'manager')),
  invited_by uuid REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_members_affiliate ON affiliate_members(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_members_user ON affiliate_members(user_id);

-- 3. RLS for affiliate_members
ALTER TABLE affiliate_members ENABLE ROW LEVEL SECURITY;

-- Affiliate admin can manage their members
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'affiliate_members' AND policyname = 'Affiliate manages own members'
  ) THEN
    CREATE POLICY "Affiliate manages own members"
      ON affiliate_members FOR ALL
      USING (
        affiliate_id IN (
          SELECT id FROM affiliates WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Members can read the team list
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'affiliate_members' AND policyname = 'Members read own team'
  ) THEN
    CREATE POLICY "Members read own team"
      ON affiliate_members FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;

-- 4. Affiliate event linktree items — curated selection for the public linktree page
--    (affiliate chooses which events appear on their /p/:slug page)
CREATE TABLE IF NOT EXISTS affiliate_linktree_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid REFERENCES affiliates(id) ON DELETE CASCADE NOT NULL,
  affiliate_event_id uuid REFERENCES affiliate_events(id) ON DELETE CASCADE NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, affiliate_event_id)
);

ALTER TABLE affiliate_linktree_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'affiliate_linktree_events' AND policyname = 'Affiliate manages linktree events'
  ) THEN
    CREATE POLICY "Affiliate manages linktree events"
      ON affiliate_linktree_events FOR ALL
      USING (
        affiliate_id IN (
          SELECT id FROM affiliates WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'affiliate_linktree_events' AND policyname = 'Public read linktree events'
  ) THEN
    CREATE POLICY "Public read linktree events"
      ON affiliate_linktree_events FOR SELECT
      USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_affiliate_linktree_affiliate
  ON affiliate_linktree_events(affiliate_id, sort_order);

-- 5. Members also get the 'affiliate' role so they can access the affiliate app
-- (handled at invitation acceptance — no migration needed, uses user_roles table)
