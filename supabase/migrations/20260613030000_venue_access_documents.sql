-- Venue-level access documents (waivers, release forms, health forms, ...).
-- Reusable per venue: every event of the venue inherits its active documents.
-- After a ticket purchase the buyer is prompted to download them on the
-- confirmation page, and they are attached to the confirmation email.
-- Files are stored in the existing public `venue-assets` bucket under
-- {venueId}/access-docs/<uuid>.<ext>; this table only holds metadata.

CREATE TABLE IF NOT EXISTS public.venue_access_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_access_documents_venue
  ON public.venue_access_documents (venue_id, is_active, position);

ALTER TABLE public.venue_access_documents ENABLE ROW LEVEL SECURITY;

-- Owners (and super admins) manage their venue's documents.
CREATE POLICY "Owners manage access documents"
  ON public.venue_access_documents FOR ALL
  USING (is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Super admins manage access documents"
  ON public.venue_access_documents FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Public read: blank templates, surfaced on the public confirmation page and by
-- the email function. The underlying files already live in a public bucket.
CREATE POLICY "Anyone can read active access documents"
  ON public.venue_access_documents FOR SELECT
  USING (is_active = true);
