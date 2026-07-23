-- ═══════════════════════════════════════════════════════════════════════════
-- Vocabulaire musical unique — porte unique côté base
--
-- Les sélecteurs de genre avaient dérivé en QUATRE vocabulaires différents :
--   • filtre public / owner events / organisateur / DJ : les 8 libellés réels
--   • formulaires affiliés : Reggaeton, Latin, Afrobeats, R&B, Drum & Bass,
--                            Hip-Hop, Electronic  (10 libellés)
--   • fiche club owner     : Afro, Électro, Latino, Commercial  (10 libellés)
--   • imports / scraping   : open-format, house, techno  (slugs minuscules)
--
-- Le filtre Explorer compare les libellés stockés à ceux du filtre, sans table
-- de correspondance. Conséquence : une soirée affiliée taguée « Reggaeton »
-- n'était retrouvable par AUCUN filtre. Sur les 10 genres proposés aux
-- affiliés, seuls House, Techno et Open Format remontaient réellement.
--
-- Cette migration :
--   1. crée `public.canonical_music_genre(text)` — la table de correspondance ;
--   2. réécrit l'existant sur les 8 libellés officiels ;
--   3. pose des triggers pour que TOUTE écriture future (app, edge function,
--      assistant IA, import) atterrisse déjà canonisée.
--
-- Non destructif : un libellé sans correspondance est laissé tel quel plutôt
-- que supprimé (la fiche club owner a un champ de saisie libre à côté des
-- puces, et perdre un genre écrit à la main serait pire que le laisser hors
-- filtre).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Table de correspondance ─────────────────────────────────────────────

-- `unaccent` n'est pas garanti installé sur le projet : repli maison sur les
-- accents FR/ES, seuls concernés ici.
CREATE OR REPLACE FUNCTION public.unaccent_music_genre(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT translate(
    coalesce(p_raw, ''),
    'àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ',
    'aaaaaaeeeeiiiiooooouuuuyyncAAAAAAEEEEIIIIOOOOOUUUUYNC'
  );
$$;

-- Clé de comparaison : minuscules, sans accents, sans ponctuation.
-- « R&B », « R & B », « RnB » → « r b ». « Électro » → « electro ».
-- « open-format » → « open format ».
CREATE OR REPLACE FUNCTION public.music_genre_key(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(
    lower(public.unaccent_music_genre(p_raw)),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

COMMENT ON FUNCTION public.music_genre_key(text) IS
  'Clé de comparaison des genres musicaux : minuscules, sans accents ni ponctuation.';

CREATE OR REPLACE FUNCTION public.canonical_music_genre(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_key text := public.music_genre_key(p_raw);
BEGIN
  IF v_key = '' THEN
    RETURN NULL;
  END IF;

  RETURN CASE v_key
    WHEN 'house'            THEN 'House'
    WHEN 'deep house'       THEN 'House'
    WHEN 'tech house'       THEN 'House'
    WHEN 'afro house'       THEN 'House'

    WHEN 'techno'           THEN 'Techno'
    WHEN 'hard techno'      THEN 'Techno'

    WHEN 'rap'              THEN 'Rap / Hip-Hop'
    WHEN 'hip hop'          THEN 'Rap / Hip-Hop'
    WHEN 'hiphop'           THEN 'Rap / Hip-Hop'
    WHEN 'rap hip hop'      THEN 'Rap / Hip-Hop'
    WHEN 'r b'              THEN 'Rap / Hip-Hop'
    WHEN 'rnb'              THEN 'Rap / Hip-Hop'
    WHEN 'urban'            THEN 'Rap / Hip-Hop'
    WHEN 'trap'             THEN 'Rap / Hip-Hop'

    WHEN 'afro'             THEN 'Afro / Shatta'
    WHEN 'afro shatta'      THEN 'Afro / Shatta'
    WHEN 'afrobeat'         THEN 'Afro / Shatta'
    WHEN 'afrobeats'        THEN 'Afro / Shatta'
    WHEN 'shatta'           THEN 'Afro / Shatta'
    WHEN 'dancehall'        THEN 'Afro / Shatta'
    WHEN 'amapiano'         THEN 'Afro / Shatta'

    WHEN 'reggaeton'        THEN 'Reggaeton / Latino'
    WHEN 'reggaeton latino' THEN 'Reggaeton / Latino'
    WHEN 'latino'           THEN 'Reggaeton / Latino'
    WHEN 'latin'            THEN 'Reggaeton / Latino'
    WHEN 'latina'           THEN 'Reggaeton / Latino'
    WHEN 'salsa'            THEN 'Reggaeton / Latino'
    WHEN 'bachata'          THEN 'Reggaeton / Latino'

    WHEN 'commercial'       THEN 'Commercial / Hits'
    WHEN 'commercial hits'  THEN 'Commercial / Hits'
    WHEN 'hits'             THEN 'Commercial / Hits'
    WHEN 'mainstream'       THEN 'Commercial / Hits'
    WHEN 'pop'              THEN 'Commercial / Hits'
    WHEN 'top 40'           THEN 'Commercial / Hits'
    WHEN 'disco'            THEN 'Commercial / Hits'

    WHEN 'electro'          THEN 'Electro / EDM'
    WHEN 'electro edm'      THEN 'Electro / EDM'
    WHEN 'electronic'       THEN 'Electro / EDM'
    WHEN 'electronique'     THEN 'Electro / EDM'
    WHEN 'edm'              THEN 'Electro / EDM'
    WHEN 'trance'           THEN 'Electro / EDM'
    WHEN 'drum bass'        THEN 'Electro / EDM'
    WHEN 'drum and bass'    THEN 'Electro / EDM'
    WHEN 'dnb'              THEN 'Electro / EDM'

    WHEN 'open'             THEN 'Open Format'
    WHEN 'open format'      THEN 'Open Format'
    WHEN 'openformat'       THEN 'Open Format'
    WHEN 'all styles'       THEN 'Open Format'
    WHEN 'varie'            THEN 'Open Format'
    WHEN 'multi'            THEN 'Open Format'

    ELSE btrim(p_raw)
  END;
END;
$$;

COMMENT ON FUNCTION public.canonical_music_genre(text) IS
  'Ramène un genre musical sur les 8 libellés officiels du filtre Explorer. Valeur inconnue rendue telle quelle, NULL si vide.';

-- Version tableau : canonise, dédoublonne, retire les vides, conserve l'ordre
-- de première apparition.
CREATE OR REPLACE FUNCTION public.canonical_music_genres(p_raw text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_raw IS NULL THEN NULL
    ELSE coalesce(
      (SELECT array_agg(g ORDER BY ord)
         FROM (
           SELECT public.canonical_music_genre(v) AS g, min(o) AS ord
             FROM unnest(p_raw) WITH ORDINALITY AS t(v, o)
            WHERE public.canonical_music_genre(v) IS NOT NULL
            GROUP BY 1
         ) s),
      '{}'::text[]
    )
  END;
$$;

COMMENT ON FUNCTION public.canonical_music_genres(text[]) IS
  'canonical_music_genre() appliqué à un tableau : dédoublonné, ordre de première apparition conservé.';

-- ── 2. Réécriture de l'existant ────────────────────────────────────────────

UPDATE public.affiliate_venues
   SET genres = public.canonical_music_genres(genres)
 WHERE genres IS DISTINCT FROM public.canonical_music_genres(genres);

UPDATE public.affiliate_events
   SET genres = public.canonical_music_genres(genres)
 WHERE genres IS DISTINCT FROM public.canonical_music_genres(genres);

UPDATE public.affiliate_recurring_templates
   SET genres = public.canonical_music_genres(genres)
 WHERE genres IS DISTINCT FROM public.canonical_music_genres(genres);

UPDATE public.events
   SET music_genres = public.canonical_music_genres(music_genres),
       music_genre  = public.canonical_music_genre(music_genre)
 WHERE music_genres IS DISTINCT FROM public.canonical_music_genres(music_genres)
    OR music_genre  IS DISTINCT FROM public.canonical_music_genre(music_genre);

UPDATE public.owner_recurring_templates
   SET music_genres = public.canonical_music_genres(music_genres)
 WHERE music_genres IS DISTINCT FROM public.canonical_music_genres(music_genres);

UPDATE public.venues
   SET music_genre = public.canonical_music_genre(music_genre)
 WHERE music_genre IS DISTINCT FROM public.canonical_music_genre(music_genre);

UPDATE public.djs
   SET music_genres = public.canonical_music_genres(music_genres)
 WHERE music_genres IS DISTINCT FROM public.canonical_music_genres(music_genres);

UPDATE public.dj_sets
   SET music_genre = public.canonical_music_genre(music_genre)
 WHERE music_genre IS DISTINCT FROM public.canonical_music_genre(music_genre);

-- ── 3. Porte unique sur les écritures futures ──────────────────────────────
--
-- Le front n'est pas le seul écrivain : l'assistant owner pose des
-- music_genres via son tool `update_event`, les imports affiliés écrivent en
-- direct. La canonisation est donc posée en base, une fois, plutôt que
-- répétée dans chaque appelant. Trois fonctions, une par nom de colonne :
-- un trigger générique en jsonb serait plus court et beaucoup plus fragile.
--
-- SECURITY INVOKER : ces triggers ne décident rien, ils normalisent. Ils ne
-- doivent surtout pas contourner les gardes de responsabilité co-event, qui
-- comparent OLD et NEW sur les champs de design (dont music_genres). L'étape 2
-- ayant déjà canonisé l'existant, OLD est canonique et la normalisation de NEW
-- ne crée aucun faux écart.

CREATE OR REPLACE FUNCTION public.canonicalize_genres_col()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.genres := public.canonical_music_genres(NEW.genres);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_music_genres_col()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.music_genres := public.canonical_music_genres(NEW.music_genres);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_music_genre_col()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.music_genre := public.canonical_music_genre(NEW.music_genre);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.canonicalize_event_genres()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.music_genres := public.canonical_music_genres(NEW.music_genres);
  NEW.music_genre  := public.canonical_music_genre(NEW.music_genre);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canonical_genres ON public.affiliate_venues;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF genres ON public.affiliate_venues
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_genres_col();

DROP TRIGGER IF EXISTS trg_canonical_genres ON public.affiliate_events;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF genres ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_genres_col();

DROP TRIGGER IF EXISTS trg_canonical_genres ON public.affiliate_recurring_templates;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF genres ON public.affiliate_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_genres_col();

DROP TRIGGER IF EXISTS trg_canonical_genres ON public.events;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF music_genres, music_genre ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_event_genres();

DROP TRIGGER IF EXISTS trg_canonical_genres ON public.owner_recurring_templates;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF music_genres ON public.owner_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_music_genres_col();

DROP TRIGGER IF EXISTS trg_canonical_genres ON public.djs;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF music_genres ON public.djs
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_music_genres_col();

DROP TRIGGER IF EXISTS trg_canonical_genres ON public.dj_sets;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF music_genre ON public.dj_sets
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_music_genre_col();

-- `venues.music_genre` garde sa saisie libre : le trigger ne fait que ramener
-- les libellés reconnus sur l'officiel, il ne refuse rien.
DROP TRIGGER IF EXISTS trg_canonical_genres ON public.venues;
CREATE TRIGGER trg_canonical_genres
  BEFORE INSERT OR UPDATE OF music_genre ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_music_genre_col();
