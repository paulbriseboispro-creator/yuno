-- Recherche insensible aux accents (barre de recherche Explorer).
--
-- Avant : `name ilike '%bonsai%'` ne matchait PAS « Le Bonsaï », `title ilike
-- '%soiree%'` ne matchait pas « Soirée Été ». Sur une app FR/ES où les clubs et
-- les soirées sont massivement accentués et où personne ne tape les accents,
-- ça rendait une bonne partie du catalogue introuvable.
--
-- PostgREST ne sait pas appliquer une fonction à une colonne dans un filtre
-- (`unaccent(name) ilike '%q%'` est inexprimable côté API REST). On matérialise
-- donc la forme normalisée en colonnes générées, et le front filtre dessus avec
-- un terme lui aussi normalisé (searchNorm(), src/lib/searchNorm.ts).
--
-- La sémantique de match ne change PAS : mêmes colonnes, mêmes OR, même `%q%`.
-- Seuls les accents et la casse cessent de compter.

BEGIN;

-- unaccent vit dans le schéma `extensions` chez Supabase (cf. 20260705160000),
-- on qualifie donc les appels pour ne dépendre d'aucun search_path. Idempotent.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- `extensions.unaccent(text)` (1 arg) est STABLE — il résout la dictionnaire au
-- runtime — donc interdit dans une colonne générée. La forme 2 args avec la
-- dictionnaire explicite est IMMUTABLE : on l'emballe pour ne l'écrire qu'une fois.
CREATE OR REPLACE FUNCTION public.search_norm(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text))
$$;

COMMENT ON FUNCTION public.search_norm(text) IS
  'Normalise un texte pour la recherche : minuscules + suppression des accents. '
  'IMMUTABLE -> utilisable en colonne générée. Doit rester le miroir exact de '
  'searchNorm() côté front (src/lib/searchNorm.ts) : si les deux divergent, la '
  'recherche cesse silencieusement de matcher.';

-- ── Colonnes générées : la forme normalisée de chaque champ cherché ──────────
-- STORED + GENERATED ALWAYS : impossibles à désynchroniser de la source, aucun
-- trigger à maintenir. Tables minuscules (4 venues, 87 events) -> réécriture
-- instantanée.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS search_name text
    GENERATED ALWAYS AS (public.search_norm(name)) STORED,
  ADD COLUMN IF NOT EXISTS search_city text
    GENERATED ALWAYS AS (public.search_norm(city)) STORED;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS search_title text
    GENERATED ALWAYS AS (public.search_norm(title)) STORED;

ALTER TABLE public.affiliate_venues
  ADD COLUMN IF NOT EXISTS search_name text
    GENERATED ALWAYS AS (public.search_norm(name)) STORED,
  ADD COLUMN IF NOT EXISTS search_city text
    GENERATED ALWAYS AS (public.search_norm(city)) STORED;

ALTER TABLE public.affiliate_events
  ADD COLUMN IF NOT EXISTS search_name text
    GENERATED ALWAYS AS (public.search_norm(name)) STORED;

ALTER TABLE public.djs
  ADD COLUMN IF NOT EXISTS search_stage_name text
    GENERATED ALWAYS AS (public.search_norm(stage_name)) STORED,
  ADD COLUMN IF NOT EXISTS search_first_name text
    GENERATED ALWAYS AS (public.search_norm(first_name)) STORED,
  ADD COLUMN IF NOT EXISTS search_last_name text
    GENERATED ALWAYS AS (public.search_norm(last_name)) STORED;

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS search_display_name text
    GENERATED ALWAYS AS (public.search_norm(display_name)) STORED;

-- ── Vue publique des DJs ────────────────────────────────────────────────────
-- Le front cherche les DJs via `djs_public`, pas via `djs` : les colonnes
-- normalisées doivent y être exposées, sinon le filtre est inexprimable.
-- Vue DEFINER (security_invoker=false) — NE PAS basculer en invoker, `djs` n'a
-- pas de policy anon et la vue renverrait 0 ligne. CREATE OR REPLACE en
-- ajoutant les colonnes EN FIN de SELECT conserve l'ordre existant, le flag
-- definer et les GRANT (cf. 20260618173000 + 20260621180000).
CREATE OR REPLACE VIEW public.djs_public AS
SELECT
  d.id, d.venue_id, d.first_name, d.last_name, d.stage_name, d.instagram_url, d.tiktok_url,
  d.music_genres, d.bio, d.description, d.profile_image_url, d.cover_image_url,
  d.soundcloud_url, d.spotify_url, d.youtube_url, d.country, d.city, d.is_verified,
  d.is_active, d.slug,
  h.handle,
  d.search_stage_name, d.search_first_name, d.search_last_name
FROM public.djs d
LEFT JOIN public.dj_handles h ON h.user_id = d.user_id
WHERE d.is_active = true;

-- ── GRANTs ──────────────────────────────────────────────────────────────────
-- `venues` et `organizer_profiles` sont les deux seules tables cherchées où anon
-- n'a QUE des GRANT colonne par colonne (20260703140000) : une colonne ajoutée
-- n'y est donc PAS lisible par défaut. Or filtrer sur une colonne exige le SELECT
-- dessus -> sans ces GRANT, toute la requête tombe en 403 et la recherche
-- redevient vide. Les autres tables gardent un GRANT au niveau table, qui couvre
-- automatiquement les nouvelles colonnes.
GRANT SELECT (search_name, search_city) ON public.venues TO anon;
GRANT SELECT (search_display_name) ON public.organizer_profiles TO anon;

COMMIT;
