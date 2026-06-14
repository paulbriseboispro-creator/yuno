ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS location_is_secret boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.location_is_secret IS
  'Private events only. When true, the venue name, city and address are hidden on the public event page; revealed only to confirmed attendees via email/push.';