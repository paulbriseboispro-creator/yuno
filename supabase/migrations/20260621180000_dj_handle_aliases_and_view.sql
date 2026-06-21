-- Identité publique DJ : rendre le handle propre (marco-v) utilisable par TOUS les liens.
-- Avant : la page DJ résolvait déjà le slug moche (marco-v-71a8) vers le handle propre,
-- mais chaque lien de l'app (Explore, recherche, line-up d'event, favoris) pointait encore
-- vers le slug par-venue. Ici :
--   * on expose `handle` sur la vue publique djs_public -> les listes peuvent linker propre,
--   * on garde les anciens handles vivants via une table d'alias (renommage = pas de 404),
--   * on resynchronise le handle quand un DJ change de nom de scène.

-- =============================================================================
-- 1. Alias de handles retirés (un DJ renommé garde son ancien /dj/<handle> qui redirige).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_handle_aliases (
  handle     text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dj_handle_aliases_user_idx ON public.dj_handle_aliases(user_id);
ALTER TABLE public.dj_handle_aliases ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. gen_dj_handle : éviter aussi les collisions avec les alias retirés, et pouvoir
--    exclure le handle courant d'une personne (sinon un resync se renomme en -2).
-- =============================================================================
DROP FUNCTION IF EXISTS public.gen_dj_handle(text);
CREATE OR REPLACE FUNCTION public.gen_dj_handle(p_name text, p_exclude uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(lower(coalesce(p_name, 'dj')), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' THEN base := 'dj'; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.dj_handles WHERE handle = cand AND user_id IS DISTINCT FROM p_exclude)
     OR EXISTS (SELECT 1 FROM public.dj_handle_aliases WHERE handle = cand AND user_id IS DISTINCT FROM p_exclude)
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

-- =============================================================================
-- 3. Resync du handle quand le nom de scène change (ancien handle archivé en alias).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resync_dj_handle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_old text; v_new text; v_name text;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  -- Ne réagit qu'à un vrai changement de nom.
  IF NEW.stage_name IS NOT DISTINCT FROM OLD.stage_name
     AND NEW.first_name IS NOT DISTINCT FROM OLD.first_name
     AND NEW.last_name  IS NOT DISTINCT FROM OLD.last_name THEN
    RETURN NEW;
  END IF;

  SELECT handle INTO v_old FROM public.dj_handles WHERE user_id = NEW.user_id;
  IF v_old IS NULL THEN RETURN NEW; END IF;  -- la création est gérée par ensure_dj_handle

  v_name := COALESCE(NULLIF(btrim(NEW.stage_name), ''),
                     NULLIF(btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), ''),
                     'dj');
  v_new := public.gen_dj_handle(v_name, NEW.user_id);
  IF v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.dj_handle_aliases (handle, user_id)
      VALUES (v_old, NEW.user_id) ON CONFLICT (handle) DO NOTHING;
    UPDATE public.dj_handles SET handle = v_new WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_resync_dj_handle ON public.djs;
CREATE TRIGGER trg_resync_dj_handle
  AFTER UPDATE OF stage_name, first_name, last_name ON public.djs
  FOR EACH ROW EXECUTE FUNCTION public.resync_dj_handle();

-- =============================================================================
-- 4. Résolution slug/handle -> personne : handle courant, puis alias, puis ancien slug.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.dj_user_from_slug(p_slug text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.dj_handles WHERE handle = p_slug;
  IF v_user IS NULL THEN
    SELECT user_id INTO v_user FROM public.dj_handle_aliases WHERE handle = p_slug;
  END IF;
  IF v_user IS NULL THEN
    SELECT user_id INTO v_user FROM public.djs WHERE slug = p_slug AND is_active = true LIMIT 1;
  END IF;
  RETURN v_user;
END; $$;

-- =============================================================================
-- 5. Exposer le handle propre sur la vue publique (definer) -> liens propres côté front.
--    CREATE OR REPLACE = ajout d'une colonne en fin de SELECT (ordre des colonnes
--    existantes inchangé), conserve security_invoker=false et les GRANT.
-- =============================================================================
CREATE OR REPLACE VIEW public.djs_public AS
SELECT
  d.id, d.venue_id, d.first_name, d.last_name, d.stage_name, d.instagram_url, d.tiktok_url,
  d.music_genres, d.bio, d.description, d.profile_image_url, d.cover_image_url,
  d.soundcloud_url, d.spotify_url, d.youtube_url, d.country, d.city, d.is_verified,
  d.is_active, d.slug,
  h.handle
FROM public.djs d
LEFT JOIN public.dj_handles h ON h.user_id = d.user_id
WHERE d.is_active = true;
