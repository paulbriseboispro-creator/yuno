-- ============================================================
-- ADD PUBLIC READ POLICY ON affiliates TABLE
-- The /p/:slug linktree page is public — any visitor (anonymous
-- or authenticated) must be able to read the affiliate profile.
-- Without this policy, the RLS blocks all non-owner reads and
-- the linktree page shows "Page introuvable" for every visitor.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'affiliates'
    AND policyname = 'Public read active affiliate profiles'
  ) THEN
    CREATE POLICY "Public read active affiliate profiles"
      ON affiliates FOR SELECT
      USING (is_active = true AND linktree_slug IS NOT NULL);
  END IF;
END $$;
