-- Add publication_url to recurring templates (default ticket/event page link)
-- and update default advance_days from 14 to 7

ALTER TABLE affiliate_recurring_templates
  ADD COLUMN IF NOT EXISTS publication_url text;

ALTER TABLE affiliate_recurring_templates
  ALTER COLUMN advance_days SET DEFAULT 7;
