-- ============================================================
-- Add 'affiliate' to platform_invitations.profile_type constraint
-- The invite-affiliate Edge Function stores pending invitations
-- in platform_invitations, but the original CHECK constraint
-- only allowed 'organizer', 'bde', 'private_organizer'.
-- ============================================================

ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_profile_type_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_profile_type_check
  CHECK (profile_type IN ('organizer', 'bde', 'private_organizer', 'affiliate'));
