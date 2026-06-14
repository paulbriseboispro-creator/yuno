-- ============================================================
-- FIX MARGOT'S ROLE: affiliate → affiliate_member
-- Separate migration required because Postgres does not allow
-- using a newly added enum value in the same transaction.
-- ============================================================

UPDATE user_roles
SET role = 'affiliate_member'
WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'margotbessoule@gmail.com'
)
AND role = 'affiliate';
