-- ============================================================
-- PROMOTER LINKTREE EVENTS
-- Curated event selection per affiliate_member (promoter).
-- Each promoter picks up to 15 upcoming events from their
-- organisation to showcase on their public /promo/:slug page,
-- with an optional direct promo link (ticketing URL with their
-- tracking code).
-- ============================================================

CREATE TABLE IF NOT EXISTS promoter_linktree_events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id          uuid        NOT NULL REFERENCES affiliate_members(id) ON DELETE CASCADE,
  affiliate_event_id uuid        NOT NULL REFERENCES affiliate_events(id)  ON DELETE CASCADE,
  promo_link         text,
  sort_order         smallint    NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, affiliate_event_id)
);

CREATE INDEX IF NOT EXISTS idx_promoter_linktree_member
  ON promoter_linktree_events(member_id, sort_order);

ALTER TABLE promoter_linktree_events ENABLE ROW LEVEL SECURITY;

-- Promoter can manage their own linktree events
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'promoter_linktree_events'
    AND policyname = 'Member manages own linktree events'
  ) THEN
    CREATE POLICY "Member manages own linktree events"
      ON promoter_linktree_events FOR ALL
      USING (
        member_id IN (
          SELECT id FROM affiliate_members WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        member_id IN (
          SELECT id FROM affiliate_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Public can read linktree events (for /promo/:slug page)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'promoter_linktree_events'
    AND policyname = 'Public read promoter linktree events'
  ) THEN
    CREATE POLICY "Public read promoter linktree events"
      ON promoter_linktree_events FOR SELECT
      USING (true);
  END IF;
END $$;
