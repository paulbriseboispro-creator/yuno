-- Push notification automations config per affiliate
CREATE TABLE IF NOT EXISTS affiliate_notification_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  automation_type text NOT NULL CHECK (automation_type IN (
    'new_event_published',
    'event_sold_out',
    'assignment_reminder',
    'event_in_48h',
    'linktree_stale',
    'weekly_top_promoter',
    'missing_ticket_url',
    'weekly_recap'
  )),
  is_enabled boolean NOT NULL DEFAULT true,
  -- Extra config per type, e.g. {"delay_hours": 24, "stale_days": 7}
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(affiliate_id, automation_type)
);

CREATE INDEX IF NOT EXISTS idx_aff_automations_affiliate ON affiliate_notification_automations(affiliate_id);

ALTER TABLE affiliate_notification_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "affiliate_manage_automations" ON affiliate_notification_automations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM affiliates WHERE id = affiliate_notification_automations.affiliate_id AND user_id = auth.uid())
  );

-- Sent notification log (manual + automated)
CREATE TABLE IF NOT EXISTS affiliate_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  -- NULL = sent to all active members
  target_member_id uuid REFERENCES affiliate_members(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('automation', 'manual')),
  automation_type text,
  title text NOT NULL,
  body text NOT NULL,
  action_url text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_count int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_aff_notifs_affiliate ON affiliate_notifications(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_aff_notifs_member ON affiliate_notifications(target_member_id) WHERE target_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aff_notifs_sent_at ON affiliate_notifications(sent_at DESC);

ALTER TABLE affiliate_notifications ENABLE ROW LEVEL SECURITY;

-- Affiliate admin: full access
CREATE POLICY "affiliate_manage_notifications" ON affiliate_notifications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM affiliates WHERE id = affiliate_notifications.affiliate_id AND user_id = auth.uid())
  );

-- Members: read notifications addressed to them or broadcast (target_member_id IS NULL)
CREATE POLICY "member_read_notifications" ON affiliate_notifications
  FOR SELECT USING (
    target_member_id IN (
      SELECT id FROM affiliate_members WHERE user_id = auth.uid()
    )
    OR (
      target_member_id IS NULL
      AND EXISTS (
        SELECT 1 FROM affiliate_members
        WHERE affiliate_id = affiliate_notifications.affiliate_id
          AND user_id = auth.uid()
          AND is_active = true
      )
    )
  );

-- Seed default automations for each new affiliate (trigger)
CREATE OR REPLACE FUNCTION seed_affiliate_automations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  automation_types text[] := ARRAY[
    'new_event_published',
    'event_sold_out',
    'assignment_reminder',
    'event_in_48h',
    'linktree_stale',
    'weekly_top_promoter',
    'missing_ticket_url',
    'weekly_recap'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY automation_types LOOP
    INSERT INTO affiliate_notification_automations(affiliate_id, automation_type, is_enabled, config)
    VALUES (NEW.id, t, true, '{}')
    ON CONFLICT (affiliate_id, automation_type) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_affiliate_automations
  AFTER INSERT ON affiliates
  FOR EACH ROW EXECUTE FUNCTION seed_affiliate_automations();

-- Backfill automations for existing affiliates
DO $$
DECLARE
  automation_types text[] := ARRAY[
    'new_event_published',
    'event_sold_out',
    'assignment_reminder',
    'event_in_48h',
    'linktree_stale',
    'weekly_top_promoter',
    'missing_ticket_url',
    'weekly_recap'
  ];
  t text;
  a record;
BEGIN
  FOR a IN SELECT id FROM affiliates LOOP
    FOREACH t IN ARRAY automation_types LOOP
      INSERT INTO affiliate_notification_automations(affiliate_id, automation_type, is_enabled, config)
      VALUES (a.id, t, true, '{}')
      ON CONFLICT (affiliate_id, automation_type) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;
