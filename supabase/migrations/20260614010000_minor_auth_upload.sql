-- Minor-authorization UPLOAD flow (buyer-side, pre-payment).
-- The blank template lives on venues/organizer_profiles.minor_auth_doc_url
-- (added in 20260614000000). When a venue/organizer requires a minor doc, a
-- minor buyer must download it, fill/sign it, and re-upload it BEFORE paying.
-- This migration stores (a) the uploaded filled doc on the ticket, and
-- (b) a Storage bucket to hold the uploads.

-- 1. The buyer's uploaded, filled-in authorization, kept with the ticket so the
--    club/bouncer can retrieve it later.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS minor_auth_doc_url text;

-- 2. Storage bucket for the uploaded docs. Public read (consistent with the
--    template buckets venue-assets / profile-photos) with unguessable UUID paths.
--    Path convention: {eventId}/<uuid>.<ext>
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'minor-auth-uploads',
  'minor-auth-uploads',
  true,
  10485760, -- 10MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Policies.

-- Public read (the URL is stored on the ticket; paths are random UUIDs).
DO $$ BEGIN
  CREATE POLICY "Public read minor auth uploads"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'minor-auth-uploads');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Anyone can upload (guest checkout has no auth session). The bucket caps size
-- and mime types; paths are random so there is no overwrite/enumeration vector.
DO $$ BEGIN
  CREATE POLICY "Anyone can upload minor auth docs"
    ON storage.objects FOR INSERT
    TO anon, authenticated
    WITH CHECK (bucket_id = 'minor-auth-uploads');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
