-- ============================================================================
-- Clics affiliés : autoriser les clics « réserver une table » des pages club.
--
-- affiliate_clicks.affiliate_event_id était NOT NULL : impossible d'enregistrer
-- un clic sur external_booking_url d'un club partenaire (pas de soirée liée).
-- Tout le trafic « réservation » sortant des pages venue était invisible.
--
-- Un clic doit désormais cibler une soirée OU un club, et porte son type
-- (ticket / booking) pour que les analytics distinguent les deux flux.
-- ============================================================================

ALTER TABLE affiliate_clicks
  ALTER COLUMN affiliate_event_id DROP NOT NULL;

ALTER TABLE affiliate_clicks
  ADD COLUMN IF NOT EXISTS click_type text NOT NULL DEFAULT 'ticket'
    CHECK (click_type IN ('ticket', 'booking'));

ALTER TABLE affiliate_clicks
  DROP CONSTRAINT IF EXISTS affiliate_clicks_target_check;
ALTER TABLE affiliate_clicks
  ADD CONSTRAINT affiliate_clicks_target_check
  CHECK (affiliate_event_id IS NOT NULL OR affiliate_venue_id IS NOT NULL);
