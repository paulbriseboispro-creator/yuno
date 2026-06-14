-- Optional "minor authorization" document (parental consent / waiver to sign),
-- attached to the global "allow minors (alcohol-free)" setting. One per owner
-- (venue) and one per organizer. Surfaced for download on alcohol-free events.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS minor_auth_doc_url text,
  ADD COLUMN IF NOT EXISTS minor_auth_doc_name text;

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS minor_auth_doc_url text,
  ADD COLUMN IF NOT EXISTS minor_auth_doc_name text;
