-- ============================================================================
-- Notifications de DÉCOUVERTE (relance de tous les membres, par goûts + ville)
-- ============================================================================
-- Push personnalisée qui relance TOUS les membres joignables (pas seulement les
-- non-abonnés) avec les soirées de la semaine / du week-end qui collent à leurs
-- goûts (TasteQuiz) et à leur ville. Découplé du système de follow.
--
-- Anti-spam par construction :
--   • on n'envoie QUE s'il y a un vrai match (sinon silence) ;
--   • opt-out par utilisateur (profiles.discovery_opt_out) ;
--   • cadence : géré côté cron (1 découverte / 48h + cap global 3/jour) ;
--   • dédup : jamais deux fois la même soirée au même user
--     (discovery_event_notifications).
--
-- Traçable super-admin : deux clés au registre (discovery_weekend, discovery_week),
-- catégorie 'marketing' → toggles + stats dans /admin/notifications.
--
-- Hébergé dans la fonction edge EXISTANTE `weekly-digest` (déjà déployée, cron
-- lundi) qu'on étend : lundi → 'week', jeudi → 'weekend'. Aucune nouvelle
-- fonction edge (pas de blocage 402).

-- ── 1. Opt-out découverte par utilisateur ───────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discovery_opt_out boolean NOT NULL DEFAULT false;

-- ── 2. Registre super-admin ─────────────────────────────────────────────────
INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  ('discovery_weekend', 'marketing'),
  ('discovery_week',    'marketing')
ON CONFLICT (notification_key) DO NOTHING;

-- ── 3. Correspondance genres du quiz -> genres d'events ──────────────────────
-- Le quiz stocke des codes minuscules (music_style CSV), les events des libellés
-- (events.music_genres). Table de correspondance maintenable plutôt qu'un CASE
-- figé dans le RPC. 'everything' n'y est pas : traité comme « pas de filtre ».
CREATE TABLE IF NOT EXISTS public.discovery_genre_map (
  quiz_code    text PRIMARY KEY,
  event_genres text[] NOT NULL
);
ALTER TABLE public.discovery_genre_map ENABLE ROW LEVEL SECURITY;

INSERT INTO public.discovery_genre_map (quiz_code, event_genres) VALUES
  ('techno',    ARRAY['Techno']),
  ('house',     ARRAY['House']),
  ('edm',       ARRAY['Electro / EDM']),
  ('trance',    ARRAY['Electro / EDM']),
  ('hiphop',    ARRAY['Rap / Hip-Hop']),
  ('rnb',       ARRAY['Rap / Hip-Hop', 'Commercial / Hits']),
  ('trap',      ARRAY['Rap / Hip-Hop']),
  ('reggaeton', ARRAY['Reggaeton / Latino']),
  ('salsa',     ARRAY['Reggaeton / Latino']),
  ('afrobeats', ARRAY['Afro / Shatta']),
  ('pop',       ARRAY['Commercial / Hits']),
  ('rock',      ARRAY['Open Format']),
  ('disco',     ARRAY['Open Format']),
  ('jazz',      ARRAY['Open Format'])
ON CONFLICT (quiz_code) DO UPDATE SET event_genres = EXCLUDED.event_genres;

-- ── 4. Dédup : une soirée poussée une seule fois par user ────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_event_notifications (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);
ALTER TABLE public.discovery_event_notifications ENABLE ROW LEVEL SECURITY;
-- Table interne (cron service-role uniquement) : RLS activée SANS policy = fermée
-- à anon/authenticated, le service role la traverse.
CREATE INDEX IF NOT EXISTS idx_discovery_event_notifs_user_sent
  ON public.discovery_event_notifications (user_id, sent_at DESC);

-- ── 5. Le matcher : meilleur(s) event(s) pour un user selon goûts + ville ────
-- SECURITY DEFINER : appelé par le cron avec la service role. Retourne au plus 3
-- soirées à venir dans la fenêtre, en ville, matchant les genres du quiz (si
-- l'user en a — sinon toutes les soirées de sa ville passent), hors billets déjà
-- pris et hors soirées déjà poussées. Le tri privilégie le plus tôt.
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

-- ── 6. Cadence : ajouter le run du jeudi (week-end). Le lundi (semaine) existe
--       déjà (weekly-digest, 20260430181933). Même fonction, la fenêtre est
--       déduite du jour côté fonction.
SELECT private.reschedule_edge_cron('weekly-digest-thursday', '0 17 * * 4', 'weekly-digest');
