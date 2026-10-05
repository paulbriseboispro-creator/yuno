-- ============================================================================
-- Yuno CRM — Analyses : les liens de partage se lisent par story et par bio.
--
-- La famille `yl` (« liens de partage ») est éclatée selon le lien qui a fait
-- la vente, retrouvé par son code dans `tracked_links` :
--   ys  story Instagram          yb  lien en bio Instagram
--   yt  lien en bio TikTok       yl  tout autre lien de partage (WhatsApp, flyer…)
-- Les autres familles ne changent pas. `_crm_ticket_source` lit désormais une
-- table : elle passe de IMMUTABLE à STABLE (SECURITY DEFINER, comme ses appelants).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._crm_ticket_source(p_utm jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN s = '' THEN 'of'
    WHEN s = 'yuno' OR s LIKE 'yuno-m-%' THEN 'em'
    WHEN s LIKE 'yuno-s-%' THEN 'sm'
    WHEN s LIKE 'yuno-d-%' THEN 'dm'
    WHEN s LIKE 'yuno-%' THEN COALESCE((
      SELECT CASE
               WHEN tl.utm_source = 'instagram' AND tl.utm_medium = 'story' THEN 'ys'
               WHEN tl.utm_source = 'instagram' AND tl.utm_medium = 'bio' THEN 'yb'
               WHEN tl.utm_source = 'tiktok' AND tl.utm_medium = 'bio' THEN 'yt'
             END
        FROM public.tracked_links tl WHERE lower(tl.code) = substr(s, 6) LIMIT 1), 'yl')
    WHEN s = 'shotgun' THEN 'sg'
    WHEN s = 'direct' THEN 'di'
    WHEN s IN ('instagram', 'ig', 'facebook', 'fb', 'tiktok', 'snapchat', 'twitter', 'x', 'threads', 'linkedin', 'youtube', 'pinterest', 'messenger') THEN 'so'
    ELSE 'au' END
  FROM (SELECT lower(btrim(COALESCE(CASE WHEN jsonb_typeof(p_utm) = 'object' THEN p_utm->>'utm_source' END, ''))) AS s) x;
$$;

REVOKE ALL ON FUNCTION public._crm_ticket_source(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_ticket_source(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_series jsonb; v_sources jsonb; v_clicks jsonb; v_new jsonb; v_events jsonb; v_first jsonb; v_gained jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;

  -- Premier achat de chaque client dans l'espace (toutes époques).
  DROP TABLE IF EXISTS _afirst;
  CREATE TEMP TABLE _afirst ON COMMIT DROP AS
  SELECT DISTINCT ON (a.email) a.email, a.id, a.bought_at, a.src, a.ci, a.pi
    FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL
   ORDER BY a.email, a.bought_at, a.id;

  -- Clics sur les messages Yuno (un clic = une personne et une campagne).
  DROP TABLE IF EXISTS _aclk;
  CREATE TEMP TABLE _aclk ON COMMIT DROP AS
  SELECT k.campaign_id, k.email, k.at, k.event_id,
         public._crm_ana_bucket(m, k.at) AS ci,
         CASE m->>'mode'
           WHEN 'hour' THEN CASE WHEN k.at >= (m->>'start')::timestamptz - make_interval(hours => v_n) AND k.at < (m->>'start')::timestamptz THEN 0 END
           WHEN 'day' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                     BETWEEN (m->>'start')::date - v_n AND (m->>'start')::date - 1 THEN 0 END
           WHEN 'month' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                       >= ((m->>'start')::date - interval '12 months')::date
                                   AND public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int) < (m->>'start')::date THEN 0 END
           ELSE NULL END AS pi
    FROM (
      SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS at, c.event_id
        FROM public.email_campaign_events ev
        JOIN public.email_campaigns c ON c.id = ev.campaign_id
       WHERE ev.event_type = 'clicked'
         AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         AND ev.created_at > now() - interval '25 months'
       GROUP BY ev.campaign_id, lower(ev.recipient_email), c.event_id
    ) k;

  SELECT jsonb_agg(jsonb_build_object(
           'revenue', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT round(sum(a.amount), 2) FROM _atk_all a WHERE a.ok AND a.ci = g AND a.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci = g AND a.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k)),
           'clicks', COALESCE((SELECT count(*) FROM _aclk c WHERE c.ci = g), 0),
           'new_buyers', COALESCE((SELECT count(*) FROM _afirst f WHERE f.ci = g), 0)
         ) ORDER BY g)
    INTO v_series FROM generate_series(0, v_n - 1) g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', (SELECT count(DISTINCT a.ord) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'buyers', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k),
           'new_buyers', (SELECT count(*) FROM _afirst f WHERE f.ci IS NOT NULL AND f.src = s.k),
           'revenue', COALESCE((SELECT round(sum(a.amount), 2) FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL AND a.src = s.k), 0),
           'prev_tickets', COALESCE((SELECT sum(a.qty) FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.src = s.k), 0)
         )), '[]'::jsonb)
    INTO v_sources FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of']) s(k);

  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE ci IS NOT NULL),
           'prev', count(*) FILTER (WHERE pi IS NOT NULL))
    INTO v_clicks FROM _aclk;

  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND ci IS NOT NULL),
           'new', (SELECT count(*) FROM _afirst WHERE ci IS NOT NULL),
           'prev_buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND pi IS NOT NULL),
           'prev_new', (SELECT count(*) FROM _afirst WHERE pi IS NOT NULL))
    INTO v_new;

  -- Contacts gagnés : entrés dans la base pendant la fenêtre (premier achat,
  -- import, inscription), quelle que soit la porte.
  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE public._crm_ana_bucket(m, j.at) IS NOT NULL),
           'series', (SELECT jsonb_agg((SELECT count(*) FROM (
                         SELECT LEAST(f.bought_at, COALESCE(c.added_at, c.created_at)) AS at
                           FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
                          WHERE c.email IS NOT NULL) z
                        WHERE public._crm_ana_bucket(m, z.at) = g) ORDER BY g)
                       FROM generate_series(0, v_n - 1) g))
    INTO v_gained
    FROM (SELECT LEAST(f.bought_at, COALESCE(c.added_at, c.created_at)) AS at
            FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
           WHERE c.email IS NOT NULL) j;

  -- Soirées : acheteurs, part de nouveaux, clics de vos messages vers elles.
  WITH per AS (
    SELECT a.event_id, count(DISTINCT a.email) AS buyers,
           count(DISTINCT a.email) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = a.id)) AS new_buyers
      FROM _atk_all a WHERE a.ok AND a.event_id IS NOT NULL
       AND (m->>'mode' = 'event' AND a.event_id = (m->'event'->>'id')::uuid OR m->>'mode' <> 'event' AND a.ci IS NOT NULL)
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
           'state', CASE WHEN e.night = (m->>'today')::date THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
           'buyers', p.buyers, 'new_buyers', p.new_buyers,
           'clicks', (SELECT count(*) FROM _aclk c WHERE c.event_id = e.id)
         ) ORDER BY p.buyers DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM per ORDER BY buyers DESC LIMIT 7) p JOIN _aev e ON e.id = p.event_id;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
