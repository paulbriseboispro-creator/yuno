-- Event brief: marketing materials for promoters (caption, hashtags, door time, etc.)
CREATE TABLE IF NOT EXISTS affiliate_event_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_event_id uuid NOT NULL UNIQUE REFERENCES affiliate_events(id) ON DELETE CASCADE,
  instagram_caption text,
  hashtags text,
  door_time time,
  dress_code text,
  lineup_notes text,
  promo_notes text,
  extra_info text,
  -- Can differ from the event's main flyer (e.g., story-format crop)
  brief_flyer_url text,
  -- Tracks whether this brief was auto-created from a recurring template
  is_auto_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aff_briefs_event ON affiliate_event_briefs(affiliate_event_id);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_affiliate_event_brief_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_aff_brief_updated_at
  BEFORE UPDATE ON affiliate_event_briefs
  FOR EACH ROW EXECUTE FUNCTION update_affiliate_event_brief_updated_at();

ALTER TABLE affiliate_event_briefs ENABLE ROW LEVEL SECURITY;

-- Affiliate admin: full access to their briefs
CREATE POLICY "affiliate_manage_briefs" ON affiliate_event_briefs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM affiliate_events ae
      JOIN affiliates a ON a.id = ae.affiliate_id
      WHERE ae.id = affiliate_event_briefs.affiliate_event_id
        AND a.user_id = auth.uid()
    )
  );

-- Members: read-only access to briefs for their affiliate's events
CREATE POLICY "member_read_briefs" ON affiliate_event_briefs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM affiliate_events ae
      JOIN affiliate_members am ON am.affiliate_id = ae.affiliate_id
      WHERE ae.id = affiliate_event_briefs.affiliate_event_id
        AND am.user_id = auth.uid()
        AND am.is_active = true
    )
  );

-- linktree_status for manager validation workflow
ALTER TABLE affiliate_members
  ADD COLUMN IF NOT EXISTS linktree_status text NOT NULL DEFAULT 'draft'
    CHECK (linktree_status IN ('draft', 'pending_review', 'approved'));
