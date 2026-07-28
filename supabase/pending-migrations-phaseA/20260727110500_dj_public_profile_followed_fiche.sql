-- ─────────────────────────────────────────────────────────────────────────────
-- Fix item 6 — bouton « suivre DJ » au grain PERSONNE sur la page publique.
--
-- Le suivi DJ vise la personne (djs.user_id), pas la fiche (favorites.dj_id) : le
-- trigger de dédup garde UNE seule ligne favorites par personne, pointant vers la
-- fiche par laquelle l'utilisateur a suivi (souvent depuis un event ou une carte
-- Explore, donc une AUTRE fiche que la fiche canonique affichée par cette page).
-- Résultat : FavoriteButton.isFavorite(fiche) se trompait — le bouton affichait
-- « suivre » alors que l'utilisateur suit déjà, et un clic ré-insérait une fiche.
--
-- Le fan (authenticated non-owner) ne peut pas lire `djs` en direct (RLS restrictive,
-- policy publique retirée en mig 141811) : impossible de résoudre l'ensemble des
-- fiches d'une personne côté client. On fait donc porter la résolution par ce RPC
-- DEFINER (déjà l'unique porte de la page) : il renvoie `followed_dj_id` = la fiche
-- que auth.uid() suit pour cette personne (NULL si pas suivi / anon). Le front passe
-- alors `followed_dj_id ?? id` au bouton → isFavorite ET le toggle visent la bonne
-- ligne, sans changer FavoriteButton.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dj_public_profile(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user      uuid;
  v_row       public.djs%ROWTYPE;
  v_handle    text;
  v_followers bigint;
  v_followed  uuid;
  v_tiers     jsonb;
  v_rate      public.dj_rate_card%ROWTYPE;
BEGIN
  v_user := public.dj_user_from_slug(p_slug);
  IF v_user IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.djs
   WHERE user_id = v_user AND is_active = true
   ORDER BY (cover_image_url IS NOT NULL) DESC,
            (profile_image_url IS NOT NULL) DESC,
            updated_at DESC NULLS LAST
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT handle INTO v_handle FROM public.dj_handles WHERE user_id = v_user;

  SELECT count(DISTINCT f.user_id) INTO v_followers
    FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
   WHERE d.user_id = v_user AND f.favorite_type = 'dj';

  -- Fiche que l'utilisateur courant suit pour CETTE personne (grain personne).
  -- NULL pour un visiteur anonyme (auth.uid() IS NULL) : personne à suivre.
  SELECT f.dj_id INTO v_followed
    FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
   WHERE d.user_id = v_user AND f.favorite_type = 'dj' AND f.user_id = auth.uid()
   LIMIT 1;

  v_tiers := public.get_dj_tiers(v_user);
  SELECT * INTO v_rate FROM public.dj_rate_card WHERE user_id = v_user AND is_public = true;

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
    'followed_dj_id', v_followed,
    'featured_track_url', v_row.featured_track_url,
    'featured_track_title', v_row.featured_track_title,
    'rising', COALESCE((v_tiers->>'rising')::boolean, false),
    'resident_at', COALESCE(v_tiers->'resident_scopes', '[]'::jsonb),
    'rate', CASE WHEN v_rate.user_id IS NOT NULL
                 THEN jsonb_build_object('min_fee', v_rate.min_fee, 'max_fee', v_rate.max_fee,
                                         'currency', v_rate.currency, 'note', v_rate.rate_note)
                 ELSE NULL END
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dj_public_profile(text) TO anon, authenticated;
