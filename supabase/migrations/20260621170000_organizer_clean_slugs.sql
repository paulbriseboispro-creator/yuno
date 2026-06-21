-- Organizer public slugs : propres et logiques (comme les venues casanova / irish / le-bonsai).
-- Avant : generate_organizer_profile_slug() collait les 4 premiers caractères de l'UUID
-- (display_name + "-ef75") UNIQUEMENT à l'INSERT. Conséquence : une orga renommée
-- (« BDE D'MO Paris » -> « Yuno ») gardait un slug périmé et moche (bde-d-mo-paris-ef75).
-- Désormais :
--   * slug propre dérivé du display_name, désambiguïsé en -2, -3... (jamais d'UUID),
--   * resynchronisé automatiquement quand l'orga est renommée,
--   * l'ancien slug est conservé en alias -> aucun lien partagé ne casse (redirige).

-- =============================================================================
-- 1. Historique des slugs : chaque slug qu'une orga a porté résout vers elle.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.organizer_slug_aliases (
  slug       text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.organizer_profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organizer_slug_aliases_user_idx ON public.organizer_slug_aliases(user_id);
ALTER TABLE public.organizer_slug_aliases ENABLE ROW LEVEL SECURITY;
-- La résolution publique passe par resolve_organizer_slug() (SECURITY DEFINER) : pas de
-- policy SELECT anon nécessaire.

-- =============================================================================
-- 2. Générateur de slug propre (désambiguïse contre slugs vivants ET alias retirés).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.gen_organizer_slug(p_name text, p_exclude uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(lower(coalesce(p_name, 'orga')), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' THEN base := 'orga'; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.organizer_profiles WHERE slug = cand AND user_id IS DISTINCT FROM p_exclude)
     OR EXISTS (SELECT 1 FROM public.organizer_slug_aliases WHERE slug = cand AND user_id IS DISTINCT FROM p_exclude)
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

-- =============================================================================
-- 3. Sync slug <-> display_name. Retire l'ancien slug en alias lors d'un renommage.
--    Un slug fourni explicitement (édition manuelle future) est respecté.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_organizer_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_new text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
      NEW.slug := public.gen_organizer_slug(NEW.display_name, NEW.user_id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE : un slug explicitement modifié l'emporte (on ne le réécrit pas).
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RETURN NEW;
  END IF;
  -- Renommage : resynchroniser le slug, archiver l'ancien.
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    v_new := public.gen_organizer_slug(NEW.display_name, NEW.user_id);
    IF v_new IS DISTINCT FROM OLD.slug THEN
      INSERT INTO public.organizer_slug_aliases (slug, user_id)
        VALUES (OLD.slug, NEW.user_id) ON CONFLICT (slug) DO NOTHING;
      NEW.slug := v_new;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS organizer_profiles_slug_trigger ON public.organizer_profiles;
DROP TRIGGER IF EXISTS organizer_profiles_slug_sync ON public.organizer_profiles;
CREATE TRIGGER organizer_profiles_slug_sync
  BEFORE INSERT OR UPDATE ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_organizer_slug();

-- Ancien générateur (suffixe UUID) plus utilisé.
DROP FUNCTION IF EXISTS public.generate_organizer_profile_slug();

-- =============================================================================
-- 4. Résolution d'un slug historique -> slug canonique courant (anon-safe).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_organizer_slug(p_slug text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_slug text; v_user uuid;
BEGIN
  SELECT slug INTO v_slug FROM public.organizer_profiles
   WHERE slug = p_slug AND is_public = true;
  IF v_slug IS NOT NULL THEN RETURN v_slug; END IF;

  SELECT a.user_id INTO v_user FROM public.organizer_slug_aliases a WHERE a.slug = p_slug;
  IF v_user IS NULL THEN RETURN NULL; END IF;

  SELECT slug INTO v_slug FROM public.organizer_profiles
   WHERE user_id = v_user AND is_public = true;
  RETURN v_slug;
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_organizer_slug(text) TO anon, authenticated;

-- =============================================================================
-- 5. Backfill : nettoie chaque slug existant, archive l'ancien en alias.
--    (ex. « Yuno » : bde-d-mo-paris-ef75 -> yuno, ancien gardé en redirection.)
-- =============================================================================
DO $$
DECLARE r record; v_new text;
BEGIN
  FOR r IN SELECT user_id, display_name, slug FROM public.organizer_profiles LOOP
    v_new := public.gen_organizer_slug(r.display_name, r.user_id);
    IF v_new IS DISTINCT FROM r.slug THEN
      INSERT INTO public.organizer_slug_aliases (slug, user_id)
        VALUES (r.slug, r.user_id) ON CONFLICT (slug) DO NOTHING;
      UPDATE public.organizer_profiles SET slug = v_new WHERE user_id = r.user_id;
    END IF;
  END LOOP;
END $$;
