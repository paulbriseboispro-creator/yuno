-- ============================================================
-- SET LINKTREE SLUG FOR MADBYNIGHT
-- MadByNight was created without a linktree_slug, so the /p/:slug
-- public page returned "Page introuvable" even after the RLS fix.
-- ============================================================

UPDATE affiliates
SET linktree_slug = 'madbynight'
WHERE name = 'MadByNight'
  AND linktree_slug IS NULL;
