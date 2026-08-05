-- ============================================================================
-- YUNO TASTE ENGINE — cerveau de goût unique + envoi adaptatif
-- ============================================================================
-- Un seul vecteur de goût (1536 dims, même espace que event_embeddings) qui
-- FUSIONNE l'explicite (quiz d'onboarding embeddé) et l'implicite (achats /
-- favoris / clubs suivis). Il alimente DEUX surfaces avec la même intelligence :
--   1. la colonne « Pour toi » de l'app (get_for_you_events, mise à jour ici) ;
--   2. les notifs push de découverte (get_taste_events_for_user, nouvelle).
--
-- Fusion élégante : avg() sur une UNION { vecteur quiz } ∪ { embeddings des
-- events avec signal }. Aucun achat → 100 % quiz (cold-start réglé). Plus l'user
-- devient actif, plus le poids du quiz se dilue (1/(N+1)) au profit du réel.
--
-- Envoi ADAPTATIF : user_send_profiles stocke l'heure+jour de pointe (histogramme
-- d'activité) et une cadence pilotée par l'engagement. Le cron weekly-digest
-- passe en HORAIRE et envoie à chacun à SON moment.

-- ── 1. Quiz enrichi + embedding sur user_taste_profiles ─────────────────────
ALTER TABLE public.user_taste_profiles
  ADD COLUMN IF NOT EXISTS genres text[] NOT NULL DEFAULT '{}',       -- libellés RÉELS (MUSIC_GENRES)
  ADD COLUMN IF NOT EXISTS energy text,                              -- question « énergie » du nouveau quiz
  ADD COLUMN IF NOT EXISTS taste_embedding extensions.vector(1536),  -- quiz embeddé (rempli par le cron)
  ADD COLUMN IF NOT EXISTS taste_content_hash text;                  -- invalidation d'embedding

-- ── 2. Profil d'envoi adaptatif par utilisateur ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_send_profiles (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_dow    int  NOT NULL DEFAULT 4,   -- 0=dim … 4=jeudi (extract(dow), heure de Paris)
  preferred_hour   int  NOT NULL DEFAULT 18,  -- 0-23, heure de Paris
  engagement_score numeric NOT NULL DEFAULT 0,-- clics/envois (60j)
  cadence_days     int  NOT NULL DEFAULT 12,  -- délai min entre deux découvertes (adaptatif)
  last_sent_at     timestamptz,               -- maintenu par le cron d'envoi
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_send_profiles ENABLE ROW LEVEL SECURITY; -- interne : service role only

-- Index pour les histogrammes par user (visitor_events n'en avait pas).
CREATE INDEX IF NOT EXISTS idx_visitor_events_user_ts
  ON public.visitor_events (user_id, ts) WHERE user_id IS NOT NULL;

-- ── 3. Registre super-admin ─────────────────────────────────────────────────
INSERT INTO public.platform_notification_settings (notification_key, category) VALUES
  ('taste_discovery', 'marketing')
ON CONFLICT (notification_key) DO NOTHING;

-- ── 4. « Pour toi » (colonne app) : on fusionne le quiz dans le vecteur ──────
-- Même signature, même opt-out. SEUL changement : le vecteur de goût inclut
-- désormais l'embedding du quiz → la section s'affiche dès le quiz, sans achat.
CREATE OR REPLACE FUNCTION public.get_for_you_events(p_limit int DEFAULT 12)
RETURNS TABLE (event_id uuid, similarity double precision)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_taste extensions.vector(1536);
  v_opt_out boolean;
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;

  SELECT p.personalization_opt_out INTO v_opt_out
  FROM public.profiles p WHERE p.id = v_user;
  IF COALESCE(v_opt_out, false) THEN RETURN; END IF;

  -- Vecteur fusionné : { quiz } ∪ { events avec signal (12 mois) }.
  SELECT avg(emb)::extensions.vector(1536) INTO v_taste
  FROM (
    SELECT tp.taste_embedding AS emb
    FROM public.user_taste_profiles tp
    WHERE tp.user_id = v_user AND tp.taste_embedding IS NOT NULL
    UNION ALL
    SELECT e.embedding
    FROM public.event_embeddings e
    WHERE e.event_id IN (
      SELECT t.event_id FROM public.tickets t
       WHERE t.user_id = v_user AND t.status = 'paid' AND t.created_at > now() - interval '12 months'
      UNION
      SELECT f.event_id FROM public.favorites f
       WHERE f.user_id = v_user AND f.event_id IS NOT NULL AND f.created_at > now() - interval '12 months'
      UNION
      SELECT ev.id FROM public.favorites f
        JOIN public.events ev ON ev.venue_id = f.venue_id
       WHERE f.user_id = v_user AND f.venue_id IS NOT NULL AND ev.start_at > now() - interval '12 months'
    )
  ) src;

  IF v_taste IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT ev.id,
         1 - (emb.embedding OPERATOR(extensions.<=>) v_taste) AS similarity
  FROM public.events ev
  JOIN public.event_embeddings emb ON emb.event_id = ev.id
  WHERE ev.is_active = true AND ev.visibility = 'public' AND ev.is_discoverable = true
    AND ev.cancelled_at IS NULL AND ev.start_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.user_id = v_user AND t.event_id = ev.id AND t.status = 'paid'
    )
  ORDER BY (emb.embedding OPERATOR(extensions.<=>) v_taste)
    + (extract(epoch FROM (ev.start_at - now())) / 86400.0) * 0.005
  LIMIT greatest(1, least(p_limit, 30));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_for_you_events(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_for_you_events(int) TO authenticated;

-- ── 5. Reco pour les NOTIFS (batch service-role) ────────────────────────────
-- Même cerveau, mais paramétré par user, gaté par discovery_opt_out, avec
-- horizon + exclusion des soirées déjà poussées, et renvoie les genres (pour
-- écrire « … : House, Open Format »).
CREATE OR REPLACE FUNCTION public.get_taste_events_for_user(
  p_user_id uuid,
  p_limit   int DEFAULT 3,
  p_days    int DEFAULT 21
)
RETURNS TABLE (
  event_id     uuid,
  title        text,
  venue_id     text,
  city         text,
  start_at     timestamptz,
  slug         text,
  music_genres text[],
  similarity   double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_taste extensions.vector(1536);
  v_opt_out boolean;
BEGIN
  SELECT COALESCE(p.discovery_opt_out, false) INTO v_opt_out
  FROM public.profiles p WHERE p.id = p_user_id;
  IF COALESCE(v_opt_out, false) THEN RETURN; END IF;

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

  IF v_taste IS NULL THEN RETURN; END IF; -- ni quiz ni comportement → pas de push

  RETURN QUERY
  SELECT ev.id, ev.title, ev.venue_id,
         COALESCE(v.city, ev.location_city) AS city,
         ev.start_at, ev.slug, ev.music_genres,
         1 - (emb.embedding OPERATOR(extensions.<=>) v_taste) AS similarity
  FROM public.events ev
  JOIN public.event_embeddings emb ON emb.event_id = ev.id
  LEFT JOIN public.venues v ON v.id = ev.venue_id
  WHERE ev.is_active = true AND ev.visibility = 'public' AND ev.is_discoverable = true
    AND ev.cancelled_at IS NULL
    AND ev.start_at > now() AND ev.start_at <= now() + (p_days || ' days')::interval
    AND NOT EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.user_id = p_user_id AND t.event_id = ev.id AND t.status = 'paid'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.discovery_event_notifications d
      WHERE d.user_id = p_user_id AND d.event_id = ev.id
    )
  ORDER BY (emb.embedding OPERATOR(extensions.<=>) v_taste)
    + (extract(epoch FROM (ev.start_at - now())) / 86400.0) * 0.005
  LIMIT greatest(1, least(p_limit, 10));
END;
$$;

REVOKE ALL ON FUNCTION public.get_taste_events_for_user(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_taste_events_for_user(uuid, int, int) TO service_role;

-- ── 6. Calcul des profils d'envoi adaptatifs (histogrammes) ─────────────────
-- Heure+jour de pointe = mode pondéré de l'activité (clics push ×3, browsing ×2,
-- achats ×1), heure de Paris. Cadence pilotée par l'engagement : on relance plus
-- ceux qui cliquent, on met en pause (30j) ceux qui ignorent tout. last_sent_at
-- n'est JAMAIS écrasé ici (c'est le cron d'envoi qui le maintient).
CREATE OR REPLACE FUNCTION public.refresh_user_send_profiles()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  WITH reachable AS (
    SELECT DISTINCT user_id FROM public.push_subscriptions WHERE platform = 'ios' AND user_id IS NOT NULL
  ),
  activity AS (
    SELECT user_id, created_at AS ts, 3 AS w FROM public.auto_push_events
     WHERE event_type = 'clicked' AND created_at > now() - interval '90 days' AND user_id IS NOT NULL
    UNION ALL
    SELECT user_id, created_at, 3 FROM public.push_campaign_events
     WHERE event_type = 'clicked' AND created_at > now() - interval '90 days' AND user_id IS NOT NULL
    UNION ALL
    SELECT user_id, ts, 2 FROM public.visitor_events
     WHERE user_id IS NOT NULL AND ts > now() - interval '90 days'
    UNION ALL
    SELECT user_id, created_at, 1 FROM public.tickets
     WHERE created_at > now() - interval '180 days' AND user_id IS NOT NULL
    UNION ALL
    SELECT user_id, created_at, 1 FROM public.orders
     WHERE created_at > now() - interval '180 days' AND user_id IS NOT NULL
  ),
  binned AS (
    SELECT a.user_id,
           extract(dow  FROM a.ts AT TIME ZONE 'Europe/Paris')::int AS dow,
           extract(hour FROM a.ts AT TIME ZONE 'Europe/Paris')::int AS hour,
           sum(a.w) AS wsum
    FROM activity a
    JOIN reachable r ON r.user_id = a.user_id
    GROUP BY 1, 2, 3
  ),
  best AS (
    SELECT DISTINCT ON (user_id) user_id, dow, hour
    FROM binned ORDER BY user_id, wsum DESC, hour
  ),
  engagement AS (
    SELECT r.user_id,
      (SELECT count(*) FROM public.auto_push_events e
        WHERE e.user_id = r.user_id AND e.event_type = 'clicked' AND e.created_at > now() - interval '60 days') AS clicks,
      (SELECT count(*) FROM public.auto_push_events e
        WHERE e.user_id = r.user_id AND e.event_type = 'sent' AND e.created_at > now() - interval '60 days') AS sends
    FROM reachable r
  )
  INSERT INTO public.user_send_profiles AS usp
    (user_id, preferred_dow, preferred_hour, engagement_score, cadence_days, updated_at)
  SELECT r.user_id,
         COALESCE(b.dow, 4),
         -- fenêtre de planification : on borne l'heure entre 11h et 21h (on ne
         -- pousse pas de la découverte à 4h du matin même si l'user achète alors).
         LEAST(21, GREATEST(11, COALESCE(b.hour, 18))),
         CASE WHEN e.sends > 0 THEN round(e.clicks::numeric / e.sends, 3) ELSE 0 END,
         CASE
           WHEN e.sends > 0 AND e.clicks::numeric / e.sends >= 0.30 THEN 5
           WHEN e.sends > 0 AND e.clicks::numeric / e.sends >= 0.10 THEN 8
           WHEN e.sends >= 4 AND e.clicks = 0 THEN 30
           ELSE 12
         END,
         now()
  FROM reachable r
  LEFT JOIN best b       ON b.user_id = r.user_id
  LEFT JOIN engagement e ON e.user_id = r.user_id
  ON CONFLICT (user_id) DO UPDATE SET
    preferred_dow    = EXCLUDED.preferred_dow,
    preferred_hour   = EXCLUDED.preferred_hour,
    engagement_score = EXCLUDED.engagement_score,
    cadence_days     = EXCLUDED.cadence_days,
    updated_at       = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_user_send_profiles() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_send_profiles() TO service_role;

-- ── 7. Cadence : weekly-digest passe en HORAIRE (envoi adaptatif) ────────────
-- L'ancien lundi/jeudi fixe est remplacé. weekly-digest sera réécrit en moteur
-- adaptatif qui, à chaque heure, envoie aux users dont c'est le moment.
DO $$ BEGIN PERFORM cron.unschedule('weekly-digest-thursday'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT private.reschedule_edge_cron('weekly-digest', '0 * * * *', 'weekly-digest');

-- Rafraîchissement quotidien des profils d'envoi (SQL direct via pg_cron).
DO $$ BEGIN PERFORM cron.unschedule('refresh-send-profiles-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('refresh-send-profiles-daily', '0 5 * * *', $$SELECT public.refresh_user_send_profiles();$$);
