-- Envoi push multi-langue par destinataire : quand une campagne manuelle
-- porte title_i18n/body_i18n ({en, fr, es}), send-push-campaign résout la
-- langue de chaque destinataire (profiles.preferred_language) — même principe
-- que les push automations. title/body restent le fallback (langue choisie
-- par l'owner à la composition).

ALTER TABLE public.push_campaigns
  ADD COLUMN IF NOT EXISTS title_i18n jsonb,
  ADD COLUMN IF NOT EXISTS body_i18n jsonb;
