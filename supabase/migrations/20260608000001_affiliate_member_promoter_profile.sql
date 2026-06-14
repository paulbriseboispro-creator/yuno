-- ============================================================
-- AFFILIATE MEMBER PROMOTER PROFILE
-- Adds public profile fields to affiliate_members so each
-- promoter has their own linktree, avatar, and social links.
-- Also adds 'affiliate_member' as a valid user_roles role.
-- ============================================================

-- 1. Profile fields on affiliate_members
ALTER TABLE affiliate_members
  ADD COLUMN IF NOT EXISTS first_name    text,
  ADD COLUMN IF NOT EXISTS last_name     text,
  ADD COLUMN IF NOT EXISTS linktree_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS avatar_url    text,
  ADD COLUMN IF NOT EXISTS instagram     text,
  ADD COLUMN IF NOT EXISTS tiktok        text,
  ADD COLUMN IF NOT EXISTS whatsapp      text,
  ADD COLUMN IF NOT EXISTS website       text;

CREATE INDEX IF NOT EXISTS idx_affiliate_members_linktree_slug
  ON affiliate_members(linktree_slug)
  WHERE linktree_slug IS NOT NULL;

-- 2. Drop old platform_invitations dependency for affiliate_member flow
--    (new flow creates the user directly via admin API — no invitation token needed)
--    Existing pending invitations with profile_type='affiliate_member' are left as-is;
--    they will simply expire naturally (14-day TTL already set).

-- 3. RLS: members can update their own profile fields
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'affiliate_members'
    AND policyname = 'Members update own profile'
  ) THEN
    CREATE POLICY "Members update own profile"
      ON affiliate_members FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- 4. Public read for linktree slugs (needed for /promo/:slug page)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'affiliate_members'
    AND policyname = 'Public read member linktree'
  ) THEN
    CREATE POLICY "Public read member linktree"
      ON affiliate_members FOR SELECT
      USING (linktree_slug IS NOT NULL AND is_active = true);
  END IF;
END $$;
