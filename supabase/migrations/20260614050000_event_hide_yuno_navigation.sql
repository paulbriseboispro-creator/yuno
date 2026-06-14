-- Private organizer parties: option to keep visitors locked on the event page.
-- When enabled, the public event page hides the top "back to Yuno" button so
-- attendees can't navigate out to the club / organizer / Yuno homepage.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS hide_yuno_navigation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.hide_yuno_navigation IS
  'Private events only: hide the top back/home navigation on the public event page so visitors stay on the event.';
