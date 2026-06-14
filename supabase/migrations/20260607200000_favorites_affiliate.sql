-- Add affiliate_event_id and affiliate_venue_id to the favorites table
-- so users can save affiliate partner events and venues to their favorites.

ALTER TABLE favorites
  ADD COLUMN affiliate_event_id UUID REFERENCES affiliate_events(id) ON DELETE CASCADE,
  ADD COLUMN affiliate_venue_id UUID REFERENCES affiliate_venues(id)  ON DELETE CASCADE;

-- RLS: existing policies already scope by user_id — no new policies needed.
