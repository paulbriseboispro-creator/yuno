-- ============================================================
-- Grant affiliate access to Milo / MadByNight
-- Created manually: account exists but onboarding was bypassed
-- User: milodelloyecoiteux@gmail.com
-- UID:  4f43f5d4-8b67-40c5-b7d6-06e398596ea9
-- ============================================================

-- 1. Create affiliate record
INSERT INTO public.affiliates (user_id, name, type, city, commission_rate, is_active)
VALUES (
  '4f43f5d4-8b67-40c5-b7d6-06e398596ea9',
  'MadByNight',
  'city_agency',
  'Madrid',
  0,
  true
)
ON CONFLICT (user_id) DO UPDATE SET
  name        = EXCLUDED.name,
  type        = EXCLUDED.type,
  city        = EXCLUDED.city,
  is_active   = true;

-- 2. Grant affiliate role
INSERT INTO public.user_roles (user_id, role)
VALUES ('4f43f5d4-8b67-40c5-b7d6-06e398596ea9', 'affiliate')
ON CONFLICT ON CONSTRAINT user_roles_user_id_role_key DO NOTHING;

-- 3. Mark the pending invitation as accepted (if it exists)
UPDATE public.platform_invitations
SET
  status      = 'accepted',
  accepted_at = now(),
  accepted_by = '4f43f5d4-8b67-40c5-b7d6-06e398596ea9'
WHERE
  email        = 'milodelloyecoiteux@gmail.com'
  AND profile_type = 'affiliate'
  AND status   = 'pending';
