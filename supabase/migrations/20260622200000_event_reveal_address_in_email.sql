-- Secret-location events: let the organizer choose HOW the exact address reaches
-- confirmed attendees.
--   true  (default) = the exact address is included in the booking confirmation email,
--                     sent automatically the moment a reservation is confirmed.
--   false           = the system keeps the address out of the confirmation email; the
--                     organizer reveals it themselves via their own (schedulable)
--                     campaign email to confirmed attendees.
-- Only meaningful when location_is_secret = true. Non-secret events always show the
-- address (on the public page and in the confirmation email).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reveal_address_in_email boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.reveal_address_in_email IS
  'Secret-location events only: true = include the exact address in the booking confirmation email; false = the organizer reveals it via their own scheduled/manual email.';
