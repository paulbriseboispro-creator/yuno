-- ============================================================
-- AFFILIATE SOCIAL LINKS + TRUST STATS
-- Adds agency-level social links and configurable trust slider
-- stats. trust_stats is a jsonb array of {value, label} objects
-- set by the affiliate admin and displayed on all their
-- promoters' public linktrees.
-- ============================================================

-- Social links for the affiliate agency (used on external-agency header)
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS instagram   text,
  ADD COLUMN IF NOT EXISTS tiktok      text,
  ADD COLUMN IF NOT EXISTS website     text,
  ADD COLUMN IF NOT EXISTS whatsapp    text;

-- Customizable trust slider stats shown on promoter linktrees
-- Format: [{"value": "+250", "label": "Clients satisfaits"}, ...]
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS trust_stats jsonb NOT NULL DEFAULT '[]'::jsonb;
