-- =====================================================================
-- Annonces natives d'AGENCE à ses promoteurs — parité owner.
--
-- promoter_announcements est scopé club/organisateur (XOR à 2). On ajoute le
-- scope AGENCE (XOR à 3 + RLS additive) et on étend le trigger de push existant
-- (promoter_push_on_announcement) pour brancher le chef d'agence comme émetteur
-- et ses promoteurs comme destinataires. Le push passe par la FILE
-- (enqueue_promoter_push), jamais en direct — conforme à la règle promoteur.
-- =====================================================================

ALTER TABLE public.promoter_announcements
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE CASCADE;

ALTER TABLE public.promoter_announcements DROP CONSTRAINT IF EXISTS promoter_announcements_context_check;
ALTER TABLE public.promoter_announcements
  ADD CONSTRAINT promoter_announcements_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int + (agency_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS idx_promoter_announcements_agency
  ON public.promoter_announcements(agency_id) WHERE agency_id IS NOT NULL;

-- Le chef d'agence gère ses annonces ; ses promoteurs les lisent (feed in-app).
DROP POLICY IF EXISTS "Agency owner manages agency announcements" ON public.promoter_announcements;
CREATE POLICY "Agency owner manages agency announcements"
  ON public.promoter_announcements FOR ALL TO authenticated
  USING (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id));

DROP POLICY IF EXISTS "Agency promoters view agency announcements" ON public.promoter_announcements;
CREATE POLICY "Agency promoters view agency announcements"
  ON public.promoter_announcements FOR SELECT TO authenticated
  USING (agency_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE p.agency_id = promoter_announcements.agency_id AND p.user_id = auth.uid()
  ));

-- Trigger de push : + branche agence (émetteur = nom de l'agence ; destinataires
-- = promoteurs de l'agence). Le reste (file, dedup, deeplink) inchangé.
CREATE OR REPLACE FUNCTION public.promoter_push_on_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sender text;
  r RECORD;
BEGIN
  IF NEW.venue_id IS NOT NULL THEN
    SELECT name INTO v_sender FROM venues WHERE id = NEW.venue_id;
  ELSIF NEW.organizer_user_id IS NOT NULL THEN
    SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
      INTO v_sender FROM profiles WHERE id = NEW.organizer_user_id;
  ELSIF NEW.agency_id IS NOT NULL THEN
    SELECT name INTO v_sender FROM agencies WHERE id = NEW.agency_id;
  END IF;

  FOR r IN
    SELECT p.id, p.user_id
    FROM promoters p
    WHERE p.is_active
      AND p.user_id IS NOT NULL
      AND ((NEW.venue_id IS NOT NULL AND p.venue_id = NEW.venue_id)
        OR (NEW.organizer_user_id IS NOT NULL AND p.organizer_user_id = NEW.organizer_user_id)
        OR (NEW.agency_id IS NOT NULL AND p.agency_id = NEW.agency_id))
  LOOP
    PERFORM public.enqueue_promoter_push(
      r.user_id, r.id, 'promoter_announcement',
      jsonb_build_object(
        'sender', COALESCE(NULLIF(v_sender, ''), 'Le club'),
        'title', COALESCE(NEW.title, '')
      ),
      '/promoter',
      'announcement:' || NEW.id || ':' || r.id
    );
  END LOOP;

  RETURN NEW;
END;
$fn$;
