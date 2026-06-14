-- Visual block editor support for admin transactional email templates.
-- Existing templates keep editor_mode='code' (raw HTML preserved, incl. {{#if}}
-- conditionals and {{stats_section}} partials). New templates can opt into the
-- visual block editor; on save the app compiles blocks_json -> html_content so
-- the transactional send pipeline (send-test-email) stays unchanged.

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS blocks_json jsonb,
  ADD COLUMN IF NOT EXISTS theme_json jsonb,
  ADD COLUMN IF NOT EXISTS editor_mode text NOT NULL DEFAULT 'code';

COMMENT ON COLUMN public.email_templates.blocks_json IS 'Email blocks when edited in the visual editor (null = code-only template).';
COMMENT ON COLUMN public.email_templates.theme_json IS 'Theme used by the visual editor to compile html_content.';
COMMENT ON COLUMN public.email_templates.editor_mode IS 'code | visual — which editor the admin last used for this template.';
