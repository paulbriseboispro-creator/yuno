-- ============================================================================
-- Comptes vitrine ORGANISATEUR — bouclier de visibilité des events.
--
-- Trois trous rendraient une vitrine orga visible du public malgré
-- organizer_profiles.is_public=false :
--   1. RLS : la policy « Anyone can view organizer events by id »
--      (20260417104044) ouvre tout event d'orga actif à anon, et la policy
--      héritée « Everyone can view active events » (20251119130625, jamais
--      droppée, CONFIRMÉE vivante en prod) ouvre même tous les events actifs.
--      Les policies permissives étant OR-ées, on ne colmate pas en les
--      modifiant une à une : on pose une policy RESTRICTIVE, qui s'applique
--      EN PLUS (AND) de toutes les permissives, présentes et futures.
--   2. Les flags de découverte : un event d'orga standard devient
--      is_discoverable=true + approved automatiquement
--      (evaluate_event_discoverability) → Explore, sitemap, for-you, taste.
--      → trigger zz_* (nommé pour passer APRÈS events_quality_check_trigger,
--      ordre alphabétique des triggers BEFORE) qui force is_discoverable=false
--      tant que l'orga est une vitrine. À la réclamation, le handoff re-sauve
--      les events → les règles normales reprennent la main.
--   3. get_discovery_events_for_user (push découverte, SECURITY DEFINER sans
--      AUCUN filtre de visibilité) → clause d'exclusion explicite.
-- ============================================================================

-- 1) Policy RESTRICTIVE : un event d'une vitrine orga n'est lisible que par le
--    fantôme lui-même (session preview) et le super admin. Les events sans
--    organisateur (organizer_user_id NULL) passent toujours.
DROP POLICY IF EXISTS "Showcase organizer events are private" ON public.events;
CREATE POLICY "Showcase organizer events are private"
  ON public.events
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (
    organizer_user_id IS NULL
    OR NOT public.is_showcase_organizer(organizer_user_id)
    OR organizer_user_id = auth.uid()
    OR public.is_super_admin()
  );

-- 2) Ceinture-bretelles côté flags : jamais découvrable tant que vitrine.
CREATE OR REPLACE FUNCTION public.zz_showcase_hide_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organizer_user_id IS NOT NULL
     AND public.is_showcase_organizer(NEW.organizer_user_id) THEN
    NEW.is_discoverable := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_showcase_hide_event ON public.events;
CREATE TRIGGER zz_showcase_hide_event
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.zz_showcase_hide_event();

-- 3) Le push découverte ne propose jamais un event de vitrine. Recréation à
--    l'identique de 20260722193000 + la clause d'exclusion.
CREATE OR REPLACE FUNCTION public.get_discovery_events_for_user(
  p_user_id uuid,
  p_window  text
)
RETURNS TABLE (
  event_id  uuid,
  title     text,
  venue_id  text,
  city      text,
  start_at  timestamptz,
  slug      text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_city      text;
  v_genres    text[];
  v_has_genre boolean;
  v_end       timestamptz;
BEGIN
  SELECT p.city INTO v_city FROM public.profiles p WHERE p.id = p_user_id;
  IF v_city IS NULL OR btrim(v_city) = '' THEN
    RETURN; -- pas de ville => pas de signal géo => pas de push (anti-spam)
  END IF;

  -- Fenêtre temporelle.
  IF p_window = 'weekend' THEN
    v_end := date_trunc('week', now()) + interval '6 days 23 hours 59 minutes';
  ELSE
    v_end := now() + interval '7 days';
  END IF;
  IF v_end <= now() THEN
    v_end := now() + interval '3 days';
  END IF;

  -- Genres du quiz -> genres d'events (via la table de correspondance).
  -- 'everything' (ou absence de quiz) => v_genres vide => pas de filtre de genre.
  SELECT array_agg(DISTINCT eg)
    INTO v_genres
    FROM public.user_taste_profiles utp
    CROSS JOIN LATERAL unnest(string_to_array(utp.music_style, ',')) AS code
    JOIN public.discovery_genre_map m ON m.quiz_code = btrim(code)
    CROSS JOIN LATERAL unnest(m.event_genres) AS eg
   WHERE utp.user_id = p_user_id
     AND btrim(code) <> 'everything';
  v_has_genre := v_genres IS NOT NULL AND array_length(v_genres, 1) >= 1;

  RETURN QUERY
  SELECT e.id,
         e.title,
         e.venue_id,
         COALESCE(v.city, e.location_city) AS city,
         e.start_at,
         e.slug
    FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id
   WHERE e.is_active = true
     AND e.cancelled_at IS NULL
     AND e.start_at > now()
     AND e.start_at <= v_end
     AND (e.organizer_user_id IS NULL
          OR NOT public.is_showcase_organizer(e.organizer_user_id))
     AND public.search_norm(COALESCE(v.city, e.location_city)) = public.search_norm(v_city)
     AND (NOT v_has_genre OR e.music_genres && v_genres)
     AND NOT EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE t.event_id = e.id AND t.user_id = p_user_id AND t.status IN ('paid', 'used')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.discovery_event_notifications d
        WHERE d.user_id = p_user_id AND d.event_id = e.id
     )
   ORDER BY e.start_at ASC
   LIMIT 3;
END;
$$;

REVOKE ALL ON FUNCTION public.get_discovery_events_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_events_for_user(uuid, text) TO service_role;
