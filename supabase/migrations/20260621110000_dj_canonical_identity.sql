-- Fix identité DJ : un DJ est stocké comme N lignes `djs` (une par venue/orga),
-- chacune avec son propre slug (+ suffixe -id4) et ses propres events. Conséquence :
-- la page publique d'un slug ne montre que les events d'UN profil, et le slug est moche.
-- Ici on rend l'identité canonique PAR PERSONNE (djs.user_id) :
--   1. un handle propre unique par personne (/dj/marco-v),
--   2. des RPC qui résolvent un slug/handle vers la personne et agrègent ses events.
-- Les anciens liens /dj/marco-v-cad4 continuent de marcher (fallback sur djs.slug).

-- =============================================================================
-- 1. Table dj_handles — un identifiant public propre par personne
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_handles (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  handle     text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dj_handles ENABLE ROW LEVEL SECURITY;
-- Le DJ peut lire son propre handle (pour afficher /dj/<handle> dans son dashboard).
-- La résolution publique passe par des RPC SECURITY DEFINER (qui bypassent la RLS).
DROP POLICY IF EXISTS dj_handles_self_select ON public.dj_handles;
CREATE POLICY dj_handles_self_select ON public.dj_handles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- =============================================================================
-- 2. Génération de handle (slugify stage_name, désambiguïse entre personnes)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.gen_dj_handle(p_name text)
RETURNS text LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(lower(coalesce(p_name, 'dj')), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' THEN base := 'dj'; END IF;
  cand := base;
  WHILE EXISTS (SELECT 1 FROM public.dj_handles WHERE handle = cand) LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $$;

-- Crée le handle d'une personne dès qu'un de ses profils DJ est inséré (idempotent).
CREATE OR REPLACE FUNCTION public.ensure_dj_handle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_name text;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.dj_handles WHERE user_id = NEW.user_id) THEN RETURN NEW; END IF;
  v_name := COALESCE(NULLIF(btrim(NEW.stage_name), ''),
                     NULLIF(btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), ''),
                     'dj');
  INSERT INTO public.dj_handles (user_id, handle)
  VALUES (NEW.user_id, public.gen_dj_handle(v_name))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_ensure_dj_handle ON public.djs;
CREATE TRIGGER trg_ensure_dj_handle
  AFTER INSERT ON public.djs
  FOR EACH ROW EXECUTE FUNCTION public.ensure_dj_handle();

-- Backfill : un handle par personne existante (nom le plus récent par défaut).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT user_id,
           (array_agg(
              COALESCE(NULLIF(btrim(stage_name), ''),
                       NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
                       'dj')
              ORDER BY updated_at DESC NULLS LAST))[1] AS nm
    FROM public.djs
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    ORDER BY min(created_at)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.dj_handles WHERE user_id = r.user_id) THEN
      INSERT INTO public.dj_handles (user_id, handle)
      VALUES (r.user_id, public.gen_dj_handle(r.nm))
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- 3. Résolution slug/handle -> personne (helper interne)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.dj_user_from_slug(p_slug text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.dj_handles WHERE handle = p_slug;
  IF v_user IS NULL THEN
    SELECT user_id INTO v_user FROM public.djs WHERE slug = p_slug AND is_active = true LIMIT 1;
  END IF;
  RETURN v_user;
END; $$;

-- =============================================================================
-- 4. RPC publique : profil canonique d'une personne (+ handle + followers)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_public_profile(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid; v_row public.djs%ROWTYPE; v_handle text; v_followers bigint;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN RETURN NULL; END IF;

  -- Ligne canonique : on préfère celle qui a une cover, puis une photo, puis la + récente.
  SELECT * INTO v_row FROM public.djs
   WHERE user_id = v_user AND is_active = true
   ORDER BY (cover_image_url IS NOT NULL) DESC,
            (profile_image_url IS NOT NULL) DESC,
            updated_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT handle INTO v_handle FROM public.dj_handles WHERE user_id = v_user;

  SELECT count(DISTINCT f.user_id) INTO v_followers
    FROM public.favorites f
    JOIN public.djs d ON d.id = f.dj_id
   WHERE d.user_id = v_user AND f.favorite_type = 'dj';

  RETURN jsonb_build_object(
    'id', v_row.id,
    'stage_name', v_row.stage_name,
    'first_name', v_row.first_name,
    'last_name', v_row.last_name,
    'description', v_row.description,
    'bio', v_row.bio,
    'music_genres', v_row.music_genres,
    'profile_image_url', v_row.profile_image_url,
    'cover_image_url', v_row.cover_image_url,
    'instagram_url', v_row.instagram_url,
    'tiktok_url', v_row.tiktok_url,
    'soundcloud_url', v_row.soundcloud_url,
    'spotify_url', v_row.spotify_url,
    'youtube_url', v_row.youtube_url,
    'city', v_row.city,
    'country', v_row.country,
    'is_verified', v_row.is_verified,
    'slug', v_row.slug,
    'handle', v_handle,
    'followers_count', COALESCE(v_followers, 0)
  );
END; $$;

-- =============================================================================
-- 5. RPC publique : events agrégés de TOUS les profils de la personne
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_public_events(p_slug text)
RETURNS TABLE (
  id         uuid,
  title      text,
  start_at   timestamptz,
  end_at     timestamptz,
  poster_url text,
  venue_id   text,
  venue_name text,
  venue_city text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT e.id, e.title, e.start_at, e.end_at, e.poster_url,
         e.venue_id, v.name, v.city
  FROM public.event_djs ed
  JOIN public.djs d   ON d.id = ed.dj_id AND d.user_id = v_user
  JOIN public.events e ON e.id = ed.event_id AND e.is_active = true AND e.visibility = 'public'
  LEFT JOIN public.venues v ON v.id = e.venue_id
  ORDER BY e.start_at ASC;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_public_profile(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dj_public_events(text)  TO anon, authenticated;
