-- Enrichissement page DJ (Barreau D + profil) :
--   1. Un titre vedette lu nativement (fichier audio) -> 2 colonnes sur djs + bucket dj-tracks.
--   2. Galerie photo par personne -> table dj_photos (RLS owner, lecture publique via RPC definer).
--   3. RPC d'agrégation get_dj_public_extras : photos + clubs joués + orgas, clubs/orgas
--      classés par popularité (nombre d'abonnés).
-- L'identité DJ est PAR PERSONNE (djs.user_id) : track et photos se rattachent au user_id,
-- comme la sync photo/cover existante. Réutilise dj_user_from_slug + le filtre show_on_profile.

-- =============================================================================
-- 1. Titre vedette (audio natif) sur djs
-- =============================================================================
ALTER TABLE public.djs
  ADD COLUMN IF NOT EXISTS featured_track_url text,
  ADD COLUMN IF NOT EXISTS featured_track_title text;

-- =============================================================================
-- 2. Galerie photo par personne
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_photos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url        text NOT NULL,
  sort_order int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dj_photos_user_idx ON public.dj_photos (user_id, sort_order);

ALTER TABLE public.dj_photos ENABLE ROW LEVEL SECURITY;

-- Le DJ gère sa propre galerie. La lecture publique passe par get_dj_public_extras (definer).
DROP POLICY IF EXISTS dj_photos_self_select ON public.dj_photos;
CREATE POLICY dj_photos_self_select ON public.dj_photos
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS dj_photos_self_insert ON public.dj_photos;
CREATE POLICY dj_photos_self_insert ON public.dj_photos
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS dj_photos_self_update ON public.dj_photos;
CREATE POLICY dj_photos_self_update ON public.dj_photos
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS dj_photos_self_delete ON public.dj_photos;
CREATE POLICY dj_photos_self_delete ON public.dj_photos
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =============================================================================
-- 3. Bucket storage pour les titres audio (lecture publique, écriture authentifiée)
--    Miroir du bucket profile-photos. La galerie réutilise profile-photos (dossier dj-gallery/).
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('dj-tracks', 'dj-tracks', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anyone can view dj tracks" ON storage.objects;
CREATE POLICY "Anyone can view dj tracks"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'dj-tracks');

DROP POLICY IF EXISTS "Authenticated users can upload dj tracks" ON storage.objects;
CREATE POLICY "Authenticated users can upload dj tracks"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'dj-tracks' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update dj tracks" ON storage.objects;
CREATE POLICY "Authenticated users can update dj tracks"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'dj-tracks' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete dj tracks" ON storage.objects;
CREATE POLICY "Authenticated users can delete dj tracks"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'dj-tracks' AND auth.role() = 'authenticated');

-- =============================================================================
-- 4. Étendre le profil public avec le titre vedette
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
    'followers_count', COALESCE(v_followers, 0),
    'featured_track_url', v_row.featured_track_url,
    'featured_track_title', v_row.featured_track_title
  );
END; $$;

-- =============================================================================
-- 5. RPC publique : extras agrégés (galerie + clubs joués + orgas), un seul appel.
--    Clubs classés par abonnés (favorites type=club), orgas par abonnés
--    (organizer_profile_followers). Respecte show_on_profile comme get_dj_public_events.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_public_extras(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user   uuid;
  v_photos jsonb;
  v_venues jsonb;
  v_orgs   jsonb;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('photos', '[]'::jsonb, 'venues', '[]'::jsonb, 'organizers', '[]'::jsonb);
  END IF;

  -- Galerie de la personne
  SELECT COALESCE(jsonb_agg(jsonb_build_object('url', p.url) ORDER BY p.sort_order, p.created_at), '[]'::jsonb)
    INTO v_photos
    FROM public.dj_photos p
   WHERE p.user_id = v_user;

  -- Clubs où la personne a mixé, classés par abonnés du club
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.followers DESC), '[]'::jsonb)
    INTO v_venues
    FROM (
      SELECT v.id, v.name, v.city, v.logo_url,
             (SELECT count(*) FROM public.favorites f
               WHERE f.favorite_type = 'club' AND f.venue_id = v.id)::int AS followers
      FROM (
        SELECT DISTINCT e.venue_id
        FROM public.event_djs ed
        JOIN public.djs d    ON d.id = ed.dj_id AND d.user_id = v_user
        JOIN public.events e ON e.id = ed.event_id AND e.is_active = true AND e.visibility = 'public'
        LEFT JOIN public.dj_sets ds ON ds.dj_id = ed.dj_id AND ds.event_id = e.id
        WHERE (ds.id IS NULL OR ds.show_on_profile = true) AND e.venue_id IS NOT NULL
      ) dv
      JOIN public.venues v ON v.id = dv.venue_id
      ORDER BY followers DESC NULLS LAST
      LIMIT 12
    ) t;

  -- Orgas pour qui la personne a joué, classées par abonnés de l'orga
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.followers DESC), '[]'::jsonb)
    INTO v_orgs
    FROM (
      SELECT op.slug, op.display_name, op.avatar_url,
             (SELECT count(*) FROM public.organizer_profile_followers f
               WHERE f.organizer_user_id = op.user_id)::int AS followers
      FROM (
        SELECT DISTINCT e.organizer_user_id
        FROM public.event_djs ed
        JOIN public.djs d    ON d.id = ed.dj_id AND d.user_id = v_user
        JOIN public.events e ON e.id = ed.event_id AND e.is_active = true AND e.visibility = 'public'
        LEFT JOIN public.dj_sets ds ON ds.dj_id = ed.dj_id AND ds.event_id = e.id
        WHERE (ds.id IS NULL OR ds.show_on_profile = true) AND e.organizer_user_id IS NOT NULL
      ) dorg
      JOIN public.organizer_profiles op
        ON op.user_id = dorg.organizer_user_id AND op.is_public = true
      ORDER BY followers DESC NULLS LAST
      LIMIT 12
    ) t;

  RETURN jsonb_build_object('photos', v_photos, 'venues', v_venues, 'organizers', v_orgs);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_public_profile(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dj_public_extras(text)  TO anon, authenticated;
