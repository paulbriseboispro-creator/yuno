-- Affiliate assigns specific events to promoters, who must submit their promo URL
CREATE TABLE IF NOT EXISTS affiliate_event_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_event_id uuid NOT NULL REFERENCES affiliate_events(id) ON DELETE CASCADE,
  -- NULL means assigned to all active promoters of this affiliate
  member_id uuid REFERENCES affiliate_members(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending_url'
    CHECK (status IN ('pending_url', 'url_submitted', 'skipped')),
  submitted_url text,
  submitted_at timestamptz,
  UNIQUE(affiliate_event_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_aff_assignments_event ON affiliate_event_assignments(affiliate_event_id);
CREATE INDEX IF NOT EXISTS idx_aff_assignments_member ON affiliate_event_assignments(member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aff_assignments_status ON affiliate_event_assignments(status);

ALTER TABLE affiliate_event_assignments ENABLE ROW LEVEL SECURITY;

-- Affiliate admin: full access to their own assignments (via event)
CREATE POLICY "affiliate_manage_assignments" ON affiliate_event_assignments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM affiliate_events ae
      JOIN affiliates a ON a.id = ae.affiliate_id
      WHERE ae.id = affiliate_event_assignments.affiliate_event_id
        AND a.user_id = auth.uid()
    )
  );

-- Member: read and update only their own assignments
CREATE POLICY "member_read_own_assignments" ON affiliate_event_assignments
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    )
    OR member_id IS NULL  -- "all" assignments visible to all active members
  );

CREATE POLICY "member_update_own_assignment" ON affiliate_event_assignments
  FOR UPDATE USING (
    member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    )
  );
