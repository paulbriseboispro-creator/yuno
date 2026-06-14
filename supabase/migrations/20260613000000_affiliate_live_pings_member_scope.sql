-- ============================================================
-- Scope affiliate_live_pings to members (per-promoter live count)
-- Members have their own /promo/:slug linktree; the "en ligne"
-- badge must reflect their own live visitors, not just the org's.
-- ============================================================

ALTER TABLE affiliate_live_pings
  ADD COLUMN IF NOT EXISTS affiliate_member_id uuid REFERENCES affiliate_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aff_live_member_id
  ON affiliate_live_pings(affiliate_member_id)
  WHERE affiliate_member_id IS NOT NULL;

-- Members can read live pings tied to their own linktree
CREATE POLICY "affiliate_live_pings_select_member"
  ON affiliate_live_pings FOR SELECT
  USING (
    affiliate_member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    )
  );
