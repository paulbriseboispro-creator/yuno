-- Add a public city to organizer profiles.
-- Mirrors venues.city so an organizer's favorites card can show "MapPin · City"
-- exactly like a club card. Nullable: existing organizers simply have no city
-- until they fill it in from the org-app public profile editor.
ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS city text;

COMMENT ON COLUMN public.organizer_profiles.city IS
  'Public city of the organizer, displayed on the public profile and on followers'' favorites cards.';
