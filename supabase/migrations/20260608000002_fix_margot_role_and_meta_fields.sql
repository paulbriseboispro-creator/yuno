-- ============================================================
-- ADD affiliate_member TO app_role ENUM +
-- ADD PROFILE FIELDS TO INVITATIONS META
-- Must be in its own transaction before the UPDATE that uses
-- the new enum value (Postgres constraint).
-- ============================================================

-- 1. Add 'affiliate_member' to the app_role enum
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'affiliate_member';

-- 2. Add first_name, last_name, linktree_slug to affiliate_invitations_meta
ALTER TABLE affiliate_invitations_meta
  ADD COLUMN IF NOT EXISTS first_name    text,
  ADD COLUMN IF NOT EXISTS last_name     text,
  ADD COLUMN IF NOT EXISTS linktree_slug text;
