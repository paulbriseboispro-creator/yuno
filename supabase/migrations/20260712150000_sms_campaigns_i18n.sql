-- SMS multi-langue par destinataire : quand une campagne porte body_i18n
-- ({en, fr, es}), send-sms-campaign résout la langue de chaque destinataire
-- (profiles.preferred_language) — même mécanique que push_campaigns.title_i18n.
-- body_template reste le fallback (langue composée par l'owner).

ALTER TABLE public.sms_campaigns
  ADD COLUMN IF NOT EXISTS body_i18n jsonb;
