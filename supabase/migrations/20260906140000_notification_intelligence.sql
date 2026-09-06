-- ─────────────────────────────────────────────────────────────────────────────
-- Notifications client INTELLIGENTES (2026-09-06)
--
-- Constat de l'audit : le moteur « pour toi » recommandait sans filtre de ville
-- ni d'inventaire réel (soirées du club démo poussées à Madrid), le fan-out
-- « nouvelle soirée » créait une campagne par instance récurrente auto-générée
-- (created_at du jour) et ciblait sur created_at plutôt que sur la publication,
-- et aucune règle commune (heures calmes, plafonds, préférences) ne protégeait
-- le client. Cette migration pose la couche de décision côté base :
--
--   1. events.published_at   — la vraie date de mise en ligne (trigger).
--   2. profiles.notification_prefs — préférences granulaires du client.
--   3. discovery_selections  — la sélection EXACTE promise par un push, pour
--      que le tap ouvre ces soirées-là et pas le feed.
--   4. user_home_cities()    — la zone du client (profil, clubs suivis, achats).
--   5. get_taste_events_for_user() v2 — zone + inventaire réel + plancher de
--      pertinence + soirées partenaires (affiliés) par genre.
--   6. client_push_policy()  — la porte unique anti-spam (opt-out, heures
--      calmes, 1/jour, 3/semaine, cooldown par clé).
--   7. get_new_events_to_announce() — les vraies nouveautés à annoncer aux
--      abonnés (publication < 72 h, pas de re-génération récurrente, lieu
--      visible).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. published_at ──────────────────────────────────────────────────────────
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS published_at timestamptz;

CREATE OR REPLACE FUNCTION public.events_stamp_published_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active
     AND COALESCE(NEW.visibility, 'public') = 'public'
     AND NEW.cancelled_at IS NULL
     AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_stamp_published_at ON public.events;
CREATE TRIGGER trg_events_stamp_published_at
  BEFORE INSERT OR UPDATE OF is_active, visibility, cancelled_at
  ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_stamp_published_at();

-- Reprise : ce qui est en ligne aujourd'hui compte comme publié à sa création.
UPDATE public.events
   SET published_at = created_at
 WHERE published_at IS NULL
   AND is_active
   AND COALESCE(visibility, 'public') = 'public'
   AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_published_at ON public.events (published_at DESC)
  WHERE published_at IS NOT NULL;

-- ── 2. Préférences client ────────────────────────────────────────────────────
-- Clés lues par client_push_policy() :
--   discovery        (bool, défaut true)  suggestions « pour toi », relances
--   follow_new_event (bool, défaut true)  nouveautés des clubs/orgas suivis
--   marketing        (bool, défaut true)  panier abandonné et assimilés
-- Les rappels de soirées ACHETÉES ne sont pas des préférences marketing.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 3. Sélections de découverte ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_selections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_key text NOT NULL DEFAULT 'taste_discovery',
  -- Soirées Yuno (events.id) et soirées partenaires (affiliate_events.id),
  -- dans l'ordre du classement. Deux colonnes : deux tables, deux pages.
  event_ids           uuid[] NOT NULL DEFAULT '{}',
  affiliate_event_ids uuid[] NOT NULL DEFAULT '{}',
  city             text,
  genres           text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  opened_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_discovery_selections_user ON public.discovery_selections (user_id, created_at DESC);
ALTER TABLE public.discovery_selections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discovery_selections_select_own ON public.discovery_selections;
CREATE POLICY discovery_selections_select_own ON public.discovery_selections
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Aucune policy d'écriture : seul le service (weekly-digest) écrit, et
-- l'ouverture passe par la RPC ci-dessous.

CREATE OR REPLACE FUNCTION public.open_discovery_selection(p_id uuid)
RETURNS TABLE (
  id uuid, notification_key text, event_ids uuid[], affiliate_event_ids uuid[],
  city text, genres text[], created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.discovery_selections s
     SET opened_at = COALESCE(s.opened_at, now())
   WHERE s.id = p_id AND s.user_id = auth.uid();
  RETURN QUERY
    SELECT s.id, s.notification_key, s.event_ids, s.affiliate_event_ids, s.city, s.genres, s.created_at
      FROM public.discovery_selections s
     WHERE s.id = p_id AND s.user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.open_discovery_selection(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_discovery_selection(uuid) TO authenticated, service_role;

-- ── 4. Zone du client ────────────────────────────────────────────────────────
-- Villes normalisées (search_norm) pondérées : profil (posé par l'Explore à
-- chaque résolution de ville) > achats récents > clubs et soirées suivis.
CREATE OR REPLACE FUNCTION public.user_home_cities(p_user_id uuid)
RETURNS TABLE (city_norm text, city_label text, weight int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT p.city AS city, 4 AS w
      FROM public.profiles p
     WHERE p.id = p_user_id AND NULLIF(btrim(p.city), '') IS NOT NULL
    UNION ALL
    SELECT COALESCE(v.city, e.location_city), 3
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE t.user_id = p_user_id AND t.status = 'paid'
       AND t.created_at > now() - interval '12 months'
    UNION ALL
    SELECT COALESCE(v.city, e.location_city), 3
      FROM public.table_reservations r
      JOIN public.events e ON e.id = r.event_id
      LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE r.user_id = p_user_id AND r.status = 'paid'
       AND r.created_at > now() - interval '12 months'
    UNION ALL
    SELECT v.city, 2
      FROM public.favorites f
      JOIN public.venues v ON v.id = f.venue_id
     WHERE f.user_id = p_user_id AND f.venue_id IS NOT NULL
    UNION ALL
    SELECT av.city, 2
      FROM public.favorites f
      JOIN public.affiliate_venues av ON av.id = f.affiliate_venue_id
     WHERE f.user_id = p_user_id AND f.affiliate_venue_id IS NOT NULL
    UNION ALL
    SELECT COALESCE(v.city, e.location_city), 1
      FROM public.favorites f
      JOIN public.events e ON e.id = f.event_id
      LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE f.user_id = p_user_id AND f.event_id IS NOT NULL
       AND f.created_at > now() - interval '12 months'
  )
  SELECT public.search_norm(city) AS city_norm,
         (array_agg(city ORDER BY w DESC))[1] AS city_label,
         sum(w)::int AS weight
    FROM src
   WHERE NULLIF(btrim(city), '') IS NOT NULL
   GROUP BY 1
   ORDER BY 3 DESC;
$$;
REVOKE ALL ON FUNCTION public.user_home_cities(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_home_cities(uuid) TO service_role;

-- ── 5. Moteur de goût v2 ─────────────────────────────────────────────────────
-- Le type de retour change : DROP obligatoire (CREATE OR REPLACE le refuse).
DROP FUNCTION IF EXISTS public.get_taste_events_for_user(uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_taste_events_for_user(
  p_user_id uuid,
  p_limit   int DEFAULT 3,
  p_days    int DEFAULT 21
)
RETURNS TABLE (
  event_id      uuid,
  is_affiliate  boolean,
  title         text,
  venue_id      text,
  venue_name    text,
  city          text,
  start_at      timestamptz,
  slug          text,
  music_genres  text[],
  score         double precision,
  reason        text   -- 'genre' | 'follow' | 'taste'
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_taste   extensions.vector(1536);
  v_opt_out boolean;
  v_prefs   jsonb;
  v_genres  text[];
  v_home    int;
BEGIN
  SELECT COALESCE(p.discovery_opt_out, false), COALESCE(p.notification_prefs, '{}'::jsonb)
    INTO v_opt_out, v_prefs
    FROM public.profiles p WHERE p.id = p_user_id;
  IF COALESCE(v_opt_out, false) OR COALESCE(v_prefs->>'discovery', 'true') = 'false' THEN RETURN; END IF;

  -- Zone : sans la moindre ville connue, on ne pousse JAMAIS à l'aveugle.
  SELECT count(*) INTO v_home FROM public.user_home_cities(p_user_id);
  IF v_home = 0 THEN RETURN; END IF;

  -- Genres du client : quiz ∪ genres des soirées achetées / suivies (12 mois).
  SELECT array_agg(DISTINCT lower(g)) INTO v_genres
  FROM (
    SELECT unnest(tp.genres) AS g FROM public.user_taste_profiles tp WHERE tp.user_id = p_user_id
    UNION ALL
    SELECT unnest(e.music_genres) FROM public.tickets t JOIN public.events e ON e.id = t.event_id
     WHERE t.user_id = p_user_id AND t.status = 'paid' AND t.created_at > now() - interval '12 months'
    UNION ALL
    SELECT unnest(e.music_genres) FROM public.favorites f JOIN public.events e ON e.id = f.event_id
     WHERE f.user_id = p_user_id AND f.event_id IS NOT NULL
    UNION ALL
    SELECT unnest(ae.genres) FROM public.favorites f JOIN public.affiliate_events ae ON ae.id = f.affiliate_event_id
     WHERE f.user_id = p_user_id AND f.affiliate_event_id IS NOT NULL
  ) g WHERE g IS NOT NULL AND btrim(g) <> '';
  v_genres := COALESCE(v_genres, '{}'::text[]);

  -- Vecteur de goût (cerveau unique : quiz ⊕ comportement).
  SELECT avg(emb)::extensions.vector(1536) INTO v_taste
  FROM (
    SELECT tp.taste_embedding AS emb
      FROM public.user_taste_profiles tp
     WHERE tp.user_id = p_user_id AND tp.taste_embedding IS NOT NULL
    UNION ALL
    SELECT e.embedding
      FROM public.event_embeddings e
     WHERE e.event_id IN (
       SELECT t.event_id FROM public.tickets t
        WHERE t.user_id = p_user_id AND t.status = 'paid' AND t.created_at > now() - interval '12 months'
       UNION
       SELECT f.event_id FROM public.favorites f
        WHERE f.user_id = p_user_id AND f.event_id IS NOT NULL AND f.created_at > now() - interval '12 months'
       UNION
       SELECT ev.id FROM public.favorites f
         JOIN public.events ev ON ev.venue_id = f.venue_id
        WHERE f.user_id = p_user_id AND f.venue_id IS NOT NULL AND ev.start_at > now() - interval '12 months'
     )
  ) src;

  -- Ni goût vectoriel ni genre déclaré : aucun signal → rien.
  IF v_taste IS NULL AND cardinality(v_genres) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH yuno AS (
    SELECT ev.id AS event_id, false AS is_affiliate, ev.title, ev.venue_id,
           COALESCE(v.name, ev.location_name) AS venue_name,
           COALESCE(v.city, ev.location_city) AS city,
           ev.start_at, ev.slug, ev.music_genres,
           CASE WHEN v_taste IS NULL OR emb.embedding IS NULL THEN NULL
                ELSE 1 - (emb.embedding OPERATOR(extensions.<=>) v_taste) END AS sim,
           EXISTS (SELECT 1 FROM unnest(COALESCE(ev.music_genres, '{}')) g WHERE lower(g) = ANY (v_genres)) AS genre_hit,
           EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = p_user_id AND f.venue_id = ev.venue_id) AS follow_hit,
           h.weight AS home_w
      FROM public.events ev
      LEFT JOIN public.event_embeddings emb ON emb.event_id = ev.id
      LEFT JOIN public.venues v ON v.id = ev.venue_id
      JOIN public.user_home_cities(p_user_id) h ON h.city_norm = public.search_norm(COALESCE(v.city, ev.location_city))
     WHERE ev.is_active = true AND ev.visibility = 'public' AND ev.is_discoverable = true
       AND ev.cancelled_at IS NULL
       AND COALESCE(ev.requires_access_code, false) = false
       AND ev.start_at > now() AND ev.start_at <= now() + (p_days || ' days')::interval
       -- Inventaire RÉEL : jamais un club caché / décommissionné (club démo inclus).
       AND (ev.venue_id IS NULL OR (COALESCE(v.is_hidden, false) = false AND v.decommissioned_at IS NULL))
       AND NOT EXISTS (SELECT 1 FROM public.tickets t
                        WHERE t.user_id = p_user_id AND t.event_id = ev.id AND t.status = 'paid')
       AND NOT EXISTS (SELECT 1 FROM public.discovery_event_notifications d
                        WHERE d.user_id = p_user_id AND d.event_id = ev.id)
  ),
  partner AS (
    SELECT ae.id AS event_id, true AS is_affiliate, ae.name AS title, av.id AS venue_id,
           av.name AS venue_name, av.city,
           (ae.event_date::timestamp + COALESCE(ae.start_time::text, '23:00')::interval) AT TIME ZONE 'Europe/Madrid' AS start_at,
           ae.slug, ae.genres AS music_genres,
           NULL::double precision AS sim,
           EXISTS (SELECT 1 FROM unnest(COALESCE(ae.genres, '{}')) g WHERE lower(g) = ANY (v_genres)) AS genre_hit,
           EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = p_user_id AND f.affiliate_venue_id = av.id) AS follow_hit,
           h.weight AS home_w
      FROM public.affiliate_events ae
      JOIN public.affiliate_venues av ON av.id = ae.affiliate_venue_id
      JOIN public.user_home_cities(p_user_id) h ON h.city_norm = public.search_norm(av.city)
     WHERE ae.status = 'published' AND av.is_active = true
       AND COALESCE(ae.is_sold_out, false) = false
       AND ae.event_date >= current_date
       AND ae.event_date <= current_date + p_days
       AND NOT EXISTS (SELECT 1 FROM public.discovery_event_notifications d
                        WHERE d.user_id = p_user_id AND d.event_id = ae.id)
  ),
  pool AS (SELECT * FROM yuno UNION ALL SELECT * FROM partner),
  stats AS (
    SELECT avg(sim) AS avg_sim, COALESCE(stddev_pop(sim), 0) AS sd_sim, count(sim) AS n_sim FROM pool
  ),
  scored AS (
    SELECT p.*,
           -- Score = affinité vectorielle (ou base neutre) + goût déclaré + club suivi
           --         + fraîcheur de la date, pondéré par le poids de la ville.
           COALESCE(p.sim, s.avg_sim, 0.5)
             + CASE WHEN p.genre_hit  THEN 0.08 ELSE 0 END
             + CASE WHEN p.follow_hit THEN 0.06 ELSE 0 END
             + (LEAST(p.home_w, 6)::double precision * 0.01)
             - (extract(epoch FROM (p.start_at - now())) / 86400.0) * 0.003 AS score,
           CASE WHEN p.follow_hit THEN 'follow'
                WHEN p.genre_hit  THEN 'genre'
                ELSE 'taste' END AS reason,
           -- Plancher de pertinence : un genre du client, un lieu suivi, ou une
           -- affinité nettement au-dessus du vivier (z ≥ 0,25 dès 4 candidats).
           (p.genre_hit OR p.follow_hit
             OR (p.sim IS NOT NULL AND s.n_sim >= 4 AND p.sim >= s.avg_sim + 0.25 * s.sd_sim)
             OR (p.sim IS NOT NULL AND s.n_sim < 4 AND cardinality(v_genres) = 0)) AS relevant
      FROM pool p CROSS JOIN stats s
  )
  SELECT sc.event_id, sc.is_affiliate, sc.title, sc.venue_id, sc.venue_name, sc.city,
         sc.start_at, sc.slug, sc.music_genres, sc.score, sc.reason
    FROM scored sc
   WHERE sc.relevant
   ORDER BY sc.score DESC, sc.start_at
   LIMIT greatest(1, least(p_limit, 10));
END;
$$;
REVOKE ALL ON FUNCTION public.get_taste_events_for_user(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_taste_events_for_user(uuid, int, int) TO service_role;

-- ── 6. Porte anti-spam unique ────────────────────────────────────────────────
-- Toute notification NON transactionnelle destinée au client passe ici avant
-- l'envoi. Les rappels de soirées achetées (type 'reminder') n'entrent pas
-- dans les plafonds : ils concernent une soirée que la personne a payée.
CREATE OR REPLACE FUNCTION public.client_push_policy(p_user_id uuid, p_key text)
RETURNS TABLE (allowed boolean, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefs    jsonb;
  v_opt_out  boolean;
  v_hour     int;
  v_day      int;
  v_week     int;
  v_last_key timestamptz;
  v_cooldown interval;
BEGIN
  SELECT COALESCE(p.notification_prefs, '{}'::jsonb), COALESCE(p.discovery_opt_out, false)
    INTO v_prefs, v_opt_out
    FROM public.profiles p WHERE p.id = p_user_id;
  IF v_prefs IS NULL THEN
    RETURN QUERY SELECT false, 'no_profile'; RETURN;
  END IF;

  -- Préférences par famille.
  IF p_key IN ('taste_discovery', 'inactivity_reminder', 'discovery_week', 'discovery_weekend', 'weekly_digest') THEN
    IF v_opt_out OR COALESCE(v_prefs->>'discovery', 'true') = 'false' THEN
      RETURN QUERY SELECT false, 'opted_out'; RETURN;
    END IF;
  ELSIF p_key IN ('new_event', 'agency_new_event') THEN
    IF COALESCE(v_prefs->>'follow_new_event', 'true') = 'false' THEN
      RETURN QUERY SELECT false, 'opted_out'; RETURN;
    END IF;
  ELSIF p_key IN ('cart_abandonment', 'win_back', 'birthday') THEN
    IF COALESCE(v_prefs->>'marketing', 'true') = 'false' THEN
      RETURN QUERY SELECT false, 'opted_out'; RETURN;
    END IF;
  END IF;

  -- Heures calmes : rien entre 22 h et 10 h (Paris).
  v_hour := extract(hour FROM now() AT TIME ZONE 'Europe/Paris')::int;
  IF v_hour >= 22 OR v_hour < 10 THEN
    RETURN QUERY SELECT false, 'quiet_hours'; RETURN;
  END IF;

  -- Plafonds : 1 non-transactionnelle par 24 h, 3 par 7 jours.
  SELECT count(*) INTO v_day FROM public.notification_log l
   WHERE l.user_id = p_user_id AND l.notification_type IN ('marketing', 'campaign')
     AND l.sent_at > now() - interval '24 hours';
  IF v_day >= 1 THEN RETURN QUERY SELECT false, 'daily_cap'; RETURN; END IF;

  SELECT count(*) INTO v_week FROM public.notification_log l
   WHERE l.user_id = p_user_id AND l.notification_type IN ('marketing', 'campaign')
     AND l.sent_at > now() - interval '7 days';
  IF v_week >= 3 THEN RETURN QUERY SELECT false, 'weekly_cap'; RETURN; END IF;

  -- Cooldown par clé (unitaires via auto_push_events, fan-out via campagnes).
  v_cooldown := CASE p_key
    WHEN 'new_event' THEN interval '20 hours'
    WHEN 'agency_new_event' THEN interval '20 hours'
    WHEN 'taste_discovery' THEN interval '4 days'
    WHEN 'inactivity_reminder' THEN interval '21 days'
    WHEN 'cart_abandonment' THEN interval '3 days'
    ELSE interval '2 days' END;
  SELECT max(x.at) INTO v_last_key FROM (
    SELECT e.created_at AS at FROM public.auto_push_events e
     WHERE e.user_id = p_user_id AND e.notification_key = p_key AND e.event_type = 'sent'
    UNION ALL
    SELECT ce.created_at FROM public.push_campaign_events ce
      JOIN public.push_campaigns c ON c.id = ce.campaign_id
     WHERE ce.user_id = p_user_id AND ce.event_type = 'sent'
       AND (c.template_key = p_key OR c.template_key LIKE p_key || ':%')
  ) x;
  IF v_last_key IS NOT NULL AND v_last_key > now() - v_cooldown THEN
    RETURN QUERY SELECT false, 'key_cooldown'; RETURN;
  END IF;

  RETURN QUERY SELECT true, 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.client_push_policy(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_push_policy(uuid, text) TO service_role;

-- Version LOT pour les fan-out : ne garde que les destinataires autorisés.
CREATE OR REPLACE FUNCTION public.filter_client_push_recipients(p_user_ids uuid[], p_key text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
    FROM unnest(p_user_ids) AS u(id)
   WHERE (SELECT pol.allowed FROM public.client_push_policy(u.id, p_key) pol LIMIT 1);
$$;
REVOKE ALL ON FUNCTION public.filter_client_push_recipients(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filter_client_push_recipients(uuid[], text) TO service_role;

-- ── 7. Vraies nouveautés à annoncer ──────────────────────────────────────────
-- Une instance générée par un modèle récurrent n'est une nouveauté que la
-- PREMIÈRE fois : « La Nikoumouk » chaque lundi n'est pas une annonce.
CREATE OR REPLACE FUNCTION public.get_new_events_to_announce()
RETURNS TABLE (
  event_id uuid, title text, slug text, venue_id text, organizer_user_id uuid,
  start_at timestamptz, host_name text, host_kind text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.title, e.slug, e.venue_id, e.organizer_user_id, e.start_at,
         COALESCE(
           v.name,
           NULLIF(btrim(op.display_name), ''),
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
           'Yuno') AS host_name,
         CASE WHEN e.venue_id IS NOT NULL THEN 'venue' ELSE 'organizer' END AS host_kind
    FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
    LEFT JOIN public.profiles p ON p.id = e.organizer_user_id
   WHERE e.is_active = true
     AND e.visibility = 'public'
     AND e.cancelled_at IS NULL
     AND COALESCE(e.requires_access_code, false) = false
     AND e.start_at > now()
     AND e.published_at > now() - interval '72 hours'
     AND (e.venue_id IS NULL OR (COALESCE(v.is_hidden, false) = false AND v.decommissioned_at IS NULL))
     AND (e.recurring_template_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.events e2
             WHERE e2.recurring_template_id = e.recurring_template_id
               AND e2.id <> e.id AND e2.created_at < e.created_at))
     AND NOT EXISTS (
            SELECT 1 FROM public.push_campaigns c
             WHERE c.event_id = e.id AND c.template_key = 'new_event' AND c.source = 'auto')
   ORDER BY e.published_at;
$$;
REVOKE ALL ON FUNCTION public.get_new_events_to_announce() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_new_events_to_announce() TO service_role;

-- Inventaire réel dans la zone du client (relance d'inactivité honnête).
CREATE OR REPLACE FUNCTION public.count_zone_events_for_user(p_user_id uuid, p_days int DEFAULT 14)
RETURNS TABLE (city_label text, n int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH home AS (SELECT * FROM public.user_home_cities(p_user_id)),
  inv AS (
    SELECT public.search_norm(COALESCE(v.city, e.location_city)) AS c
      FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.is_active AND e.visibility = 'public' AND e.is_discoverable AND e.cancelled_at IS NULL
       AND e.start_at > now() AND e.start_at <= now() + (p_days || ' days')::interval
       AND (e.venue_id IS NULL OR (COALESCE(v.is_hidden, false) = false AND v.decommissioned_at IS NULL))
    UNION ALL
    SELECT public.search_norm(av.city)
      FROM public.affiliate_events ae JOIN public.affiliate_venues av ON av.id = ae.affiliate_venue_id
     WHERE ae.status = 'published' AND av.is_active
       AND ae.event_date >= current_date AND ae.event_date <= current_date + p_days
  )
  SELECT h.city_label, count(inv.c)::int
    FROM home h LEFT JOIN inv ON inv.c = h.city_norm
   GROUP BY h.city_label, h.weight
   ORDER BY h.weight DESC, 2 DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.count_zone_events_for_user(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_zone_events_for_user(uuid, int) TO service_role;
