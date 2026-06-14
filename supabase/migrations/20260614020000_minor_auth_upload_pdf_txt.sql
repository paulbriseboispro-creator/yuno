-- The uploaded minor authorization is a filled-in PDF or TXT (the blank template
-- the owner/organizer attaches in their settings is also PDF or TXT). Restrict the
-- upload bucket to those two types (drop the image types from the initial version).
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['application/pdf', 'text/plain']
  WHERE id = 'minor-auth-uploads';
