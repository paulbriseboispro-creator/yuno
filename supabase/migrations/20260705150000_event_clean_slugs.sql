-- URLs d'events propres : /events/:host/:slug  (ex. /events/womber/techno-rise).
-- Avant : les events n'avaient PAS de slug -> liens /event/<UUID> et
-- /club/<venue>/event/<UUID> pleins de chiffres. Les venues (id humain), orgas
-- (/o/:slug) et DJs (/dj/:slug) étaient déjà propres ; l'event était le seul trou.
--
-- Le « host » d'un event colle EXACTEMENT au routing front (isOrganizerLed = !!organizer_user_id) :
--   * organizer-led (organizer_user_id NOT NULL) -> host = slug de l'orga (organizer_profiles.slug)
--   * sinon (soirée en club)                      -> host = venue_id (déjà propre, = PK texte)
-- Le slug d'event est donc UNIQUE PAR HOST (deux clubs peuvent chacun avoir "techno-rise").
--
-- Comme les orgas/DJs : slug propre dérivé du titre, désambiguïsé en -2/-3 (jamais d'UUID),
-- resynchronisé au renommage, ancien slug archivé en alias -> aucun lien partagé ne casse.

-- =============================================================================
-- 1. Colonne slug + historique des slugs (chaque slug qu'un event a porté résout vers lui).
-- =============================================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS slug text;

CREATE TABLE IF NOT EXISTS public.event_slug_aliases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  slug       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, slug)
);
CREATE INDEX IF NOT EXISTS event_slug_aliases_slug_idx  ON public.event_slug_aliases(slug);
CREATE INDEX IF NOT EXISTS event_slug_aliases_event_idx ON public.event_slug_aliases(event_id);
ALTER TABLE public.event_slug_aliases ENABLE ROW LEVEL SECURITY;
-- La résolution publique passe par resolve_event_path() (SECURITY DEFINER) : pas de policy anon.

-- Index de lookup scopé par host (slug unique par scope).
CREATE INDEX IF NOT EXISTS events_org_slug_idx   ON public.events(organizer_user_id, slug)
  WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_venue_slug_idx ON public.events(venue_id, slug)
  WHERE organizer_user_id IS NULL;

-- =============================================================================
-- 2. Générateur de slug propre, scopé au host de l'event (orga OU venue).
--    Désambiguïse contre les slugs vivants ET les alias, DANS LE MÊME SCOPE.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.gen_event_slug(
  p_title text,
  p_event_id uuid DEFAULT NULL,
  p_org uuid DEFAULT NULL,
  p_venue text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(lower(coalesce(p_title, 'event')), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' THEN base := 'event'; END IF;
  cand := base;
  WHILE EXISTS (
          SELECT 1 FROM public.events e
           WHERE e.slug = cand
             AND e.id IS DISTINCT FROM p_event_id
             AND ( (p_org IS NOT NULL  AND e.organizer_user_id = p_org)
                OR (p_org IS NULL      AND e.organizer_user_id IS NULL AND e.venue_id IS NOT DISTINCT FROM p_venue) )
        )
     OR EXISTS (
          SELECT 1 FROM public.event_slug_aliases a
            JOIN public.events e ON e.id = a.event_id
           WHERE a.slug = cand
             AND a.event_id IS DISTINCT FROM p_event_id
             AND ( (p_org IS NOT NULL  AND e.organizer_user_id = p_org)
                OR (p_org IS NULL      AND e.organizer_user_id IS NULL AND e.venue_id IS NOT DISTINCT FROM p_venue) )
        )
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

-- =============================================================================
-- 3. Sync slug <-> titre/host. Archive l'ancien slug en alias lors d'un renommage
--    ou d'un changement de host. Un slug fourni explicitement est respecté.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_event_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_new text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := public.gen_event_slug(NEW.title, NEW.id, NEW.organizer_user_id, NEW.venue_id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : un slug explicitement modifié l'emporte (on ne le réécrit pas).
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RETURN NEW;
  END IF;
  -- Renommage OU changement de host : resynchroniser, archiver l'ancien.
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.organizer_user_id IS DISTINCT FROM OLD.organizer_user_id
     OR (NEW.organizer_user_id IS NULL AND NEW.venue_id IS DISTINCT FROM OLD.venue_id) THEN
    v_new := public.gen_event_slug(NEW.title, NEW.id, NEW.organizer_user_id, NEW.venue_id);
    IF v_new IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL THEN
      INSERT INTO public.event_slug_aliases (event_id, slug)
        VALUES (NEW.id, OLD.slug) ON CONFLICT (event_id, slug) DO NOTHING;
      NEW.slug := v_new;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS events_slug_sync ON public.events;
CREATE TRIGGER events_slug_sync
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.sync_event_slug();

-- =============================================================================
-- 4. Résolution d'un chemin propre /events/:host/:slug -> event (anon-safe).
--    Renvoie l'id + le host canonique + le slug canonique (pour redirection front).
--    host = venue_id (soirée club) OU slug d'orga (organizer-led, alias résolu).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_event_path(p_host text, p_slug text)
RETURNS TABLE (event_id uuid, host text, slug text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_org uuid; v_org_slug text;
BEGIN
  -- --- Branche VENUE : host = venue_id (id texte de la table venues). ---
  IF EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_host) THEN
    RETURN QUERY
      SELECT e.id, e.venue_id, e.slug
        FROM public.events e
       WHERE e.venue_id = p_host
         AND e.organizer_user_id IS NULL
         AND e.is_active = true
         AND ( e.slug = p_slug
            OR EXISTS (SELECT 1 FROM public.event_slug_aliases a
                        WHERE a.event_id = e.id AND a.slug = p_slug) )
       ORDER BY (e.slug = p_slug) DESC
       LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- --- Branche ORGA : host = slug d'orga (courant ou alias historique). ---
  SELECT o.user_id INTO v_org FROM public.organizer_profiles o
   WHERE o.slug = p_host AND o.is_public = true;
  IF v_org IS NULL THEN
    SELECT al.user_id INTO v_org FROM public.organizer_slug_aliases al WHERE al.slug = p_host;
  END IF;
  IF v_org IS NOT NULL THEN
    SELECT o.slug INTO v_org_slug FROM public.organizer_profiles o WHERE o.user_id = v_org;
    RETURN QUERY
      SELECT e.id, v_org_slug, e.slug
        FROM public.events e
       WHERE e.organizer_user_id = v_org
         AND e.is_active = true
         AND ( e.slug = p_slug
            OR EXISTS (SELECT 1 FROM public.event_slug_aliases a
                        WHERE a.event_id = e.id AND a.slug = p_slug) )
       ORDER BY (e.slug = p_slug) DESC
       LIMIT 1;
  END IF;
  RETURN;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_event_path(text, text) TO anon, authenticated;

-- Helper inverse : le host canonique d'un event (pour construire l'URL côté back/worker).
CREATE OR REPLACE FUNCTION public.event_host_slug(p_event_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
           WHEN e.organizer_user_id IS NOT NULL
             THEN (SELECT o.slug FROM public.organizer_profiles o WHERE o.user_id = e.organizer_user_id)
           ELSE e.venue_id
         END
    FROM public.events e WHERE e.id = p_event_id;
$$;
GRANT EXECUTE ON FUNCTION public.event_host_slug(uuid) TO anon, authenticated;

-- =============================================================================
-- 5. Backfill : slug propre pour chaque event existant (aucun alias, état neuf).
--    Ordre chronologique -> la 1re occurrence d'un titre récurrent garde le slug nu.
-- =============================================================================
DO $$
DECLARE r record; v_new text;
BEGIN
  FOR r IN SELECT id, title, organizer_user_id, venue_id
             FROM public.events
            WHERE slug IS NULL OR btrim(slug) = ''
            ORDER BY created_at NULLS LAST, id LOOP
    v_new := public.gen_event_slug(r.title, r.id, r.organizer_user_id, r.venue_id);
    UPDATE public.events SET slug = v_new WHERE id = r.id;
  END LOOP;
END $$;
