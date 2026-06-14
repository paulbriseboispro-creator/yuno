-- ============================================================
-- Add 'affiliate_member' to platform_invitations.profile_type constraint
-- The invite-affiliate-member Edge Function uses this profile_type
-- ============================================================

ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_profile_type_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_profile_type_check
  CHECK (profile_type IN ('organizer', 'bde', 'private_organizer', 'affiliate', 'affiliate_member'));
