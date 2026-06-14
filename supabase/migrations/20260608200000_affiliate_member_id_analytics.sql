-- ============================================================
-- Add affiliate_member_id to affiliate_visitor_sessions + clicks
-- Allows per-promoter analytics (each member has their own linktree)
-- ============================================================

ALTER TABLE affiliate_visitor_sessions
  ADD COLUMN IF NOT EXISTS affiliate_member_id uuid REFERENCES affiliate_members(id) ON DELETE SET NULL;

ALTER TABLE affiliate_clicks
  ADD COLUMN IF NOT EXISTS affiliate_member_id uuid REFERENCES affiliate_members(id) ON DELETE SET NULL;

-- Indexes for per-member analytics queries
CREATE INDEX IF NOT EXISTS idx_aff_sessions_member_id
  ON affiliate_visitor_sessions(affiliate_member_id)
  WHERE affiliate_member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aff_clicks_member_id
  ON affiliate_clicks(affiliate_member_id)
  WHERE affiliate_member_id IS NOT NULL;

-- Update entry_page_type detection note:
-- '/promo/:slug' pages are detected as 'member_linktree' in the frontend hook
-- '/p/:slug' pages are detected as 'linktree' (affiliate company linktree)

-- Update the select policy so members can read their own sessions
CREATE POLICY "affiliate_sessions_select_member"
  ON affiliate_visitor_sessions FOR SELECT
  USING (
    affiliate_member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "affiliate_clicks_select_member"
  ON affiliate_clicks FOR SELECT
  USING (
    affiliate_member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    )
  );
