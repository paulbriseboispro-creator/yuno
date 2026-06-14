-- Minor-ticket records: who bought a minor ticket and (optionally) the signed
-- authorization they uploaded at checkout. Written directly by the client at
-- checkout (works for guests too), so this does NOT depend on the edge function
-- that's currently blocked by the Supabase function cap (402). Owner/organizer
-- screens read it to ENRICH already-paid customer/ticket rows; orphan rows from
-- abandoned checkouts simply never match a paid purchase and stay invisible.

CREATE TABLE IF NOT EXISTS public.minor_ticket_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_email text NOT NULL,
  buyer_name text,
  birth_date date,
  doc_url text,
  doc_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_minor_ticket_docs_event_email
  ON public.minor_ticket_docs (event_id, lower(buyer_email));

ALTER TABLE public.minor_ticket_docs ENABLE ROW LEVEL SECURITY;

-- Anyone checking out (incl. guests, no auth session) can record their minor row.
-- No exposure risk: reads are locked down below and only paid purchases are shown.
DO $$ BEGIN
  CREATE POLICY "Anyone can record a minor ticket"
    ON public.minor_ticket_docs FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only the event's venue owner / organizer (or their partners / super admins)
-- can read the rows. Ownership is derived from the trusted events table, never
-- from a client-supplied value.
DO $$ BEGIN
  CREATE POLICY "Event owners read minor ticket docs"
    ON public.minor_ticket_docs FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = minor_ticket_docs.event_id
        AND (
          is_venue_owner(auth.uid(), e.venue_id)
          OR is_venue_owner(auth.uid(), e.partner_venue_id)
          OR e.organizer_user_id = auth.uid()
          OR e.partner_organizer_id = auth.uid()
          OR is_super_admin()
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
