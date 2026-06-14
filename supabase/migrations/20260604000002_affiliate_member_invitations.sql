-- ============================================================
-- AFFILIATE MEMBER INVITATIONS
-- Adds affiliate_id + member_role to invitation metadata
-- so accept flow can create the affiliate_members record
-- ============================================================

ALTER TABLE affiliate_invitations_meta
  ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES affiliates(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS member_role text CHECK (member_role IN ('promoter', 'manager'));
