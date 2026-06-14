-- ============================================================
-- FIX AFFILIATE PUBLIC READ POLICY
-- The previous policy required linktree_slug IS NOT NULL, but
-- the nested join from affiliate_members → affiliates (for the
-- /promo/:slug promoter linktree page) needs to read the org's
-- name/city even when the org has no linktree_slug set.
-- Replace with a simpler USING (is_active = true).
-- ============================================================

DROP POLICY IF EXISTS "Public read active affiliate profiles" ON affiliates;

CREATE POLICY "Public read active affiliate profiles"
  ON affiliates FOR SELECT
  USING (is_active = true);
