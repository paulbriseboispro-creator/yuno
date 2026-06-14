-- ============================================================
-- FIX MARGOT BESSOULE — affiliate_members record
-- Margot was onboarded before the affiliate_member enum existed,
-- so the accept-affiliate-invitation flow failed silently at the
-- user_roles.upsert step. She ended up with role='affiliate' in
-- user_roles but no record in affiliate_members.
-- Migration 20260608000003 corrected her role; this one ensures
-- she has a properly linked affiliate_members record.
-- ============================================================

DO $$
DECLARE
  v_user_id    uuid;
  v_affiliate_id uuid;
BEGIN
  -- Resolve Margot's auth user id
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'margotbessoule@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User margotbessoule@gmail.com not found — skipping';
    RETURN;
  END IF;

  -- Resolve MadByNight affiliate id
  SELECT id INTO v_affiliate_id
  FROM affiliates
  WHERE user_id = '4f43f5d4-8b67-40c5-b7d6-06e398596ea9'
  LIMIT 1;

  IF v_affiliate_id IS NULL THEN
    RAISE NOTICE 'MadByNight affiliate not found — skipping';
    RETURN;
  END IF;

  -- Upsert affiliate_members record
  INSERT INTO affiliate_members (
    affiliate_id,
    user_id,
    role,
    first_name,
    last_name,
    linktree_slug,
    is_active
  )
  VALUES (
    v_affiliate_id,
    v_user_id,
    'promoter',
    'Margot',
    'Bessoule',
    'margot-bessoule',
    true
  )
  ON CONFLICT (affiliate_id, user_id) DO UPDATE SET
    first_name    = EXCLUDED.first_name,
    last_name     = EXCLUDED.last_name,
    linktree_slug = COALESCE(affiliate_members.linktree_slug, EXCLUDED.linktree_slug),
    is_active     = true;

  -- Ensure correct role (affiliate_member, not affiliate)
  INSERT INTO user_roles (user_id, role)
  VALUES (v_user_id, 'affiliate_member')
  ON CONFLICT ON CONSTRAINT user_roles_user_id_role_key DO NOTHING;

  -- Remove the incorrect affiliate admin role if still present
  DELETE FROM user_roles
  WHERE user_id = v_user_id AND role = 'affiliate';

  RAISE NOTICE 'Margot Bessoule affiliate_members record upserted (affiliate_id: %)', v_affiliate_id;
END $$;
