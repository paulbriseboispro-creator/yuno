-- ============================================================================
-- Yuno CRM — Analyses › Communauté : plus de recherche « par personne » sans
-- index.
--
-- Mesuré le 05/10 sur WOH (12 334 contacts, avant tout billet Shotgun) :
-- 63 s, base chaude et prod calme — l'écran tombait sur le délai de 8 s de
-- PostgREST. La fiche (âge, ville) était lue par un LEFT JOIN LATERAL sur _cr
-- sans index (une lecture complète par personne), et la première date d'achat
-- par une sous-requête corrélée sur _atk_all (une recherche par
-- personne). La fiche et la première date se joignent désormais d'un coup.
--
-- Corps repris de la base liée (pg_get_functiondef, 05/10) ; résultat
-- identique vérifié (même transaction, avant / après) sur la démo CRM et WOH.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_ana_community__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid, p_seg text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_seg text;
  v_today date;
  v_series jsonb; v_lc jsonb; v_reach jsonb; v_stats jsonb; v_spark jsonb; v_cohort jsonb; v_hist jsonb;
  v_aud jsonb; v_age jsonb; v_city jsonb; v_top jsonb; v_wake jsonb; v_base_total int; v_base_prev int;
  v_next uuid;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, p_seg);
  v_n := (m->>'n')::int;
  v_seg := m->>'seg';
  v_today := (m->>'today')::date;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  -- Les personnes regardées : toute la base, ou le segment ; pour une soirée,
  -- ses acheteurs.
  DROP TABLE IF EXISTS _apeo;
  CREATE TEMP TABLE _apeo ON COMMIT DROP AS
  WITH fb AS (
    SELECT a.email, min(a.bought_at) AS first_buy FROM _atk_all a WHERE a.ok GROUP BY a.email
  ), cr AS (
    -- La fiche (âge, ville) : une ligne par adresse, jointe d'un coup.
    SELECT DISTINCT ON (lower(x.email)) lower(x.email) AS em, x.age, x.city
      FROM _cr x WHERE x.email IS NOT NULL
     ORDER BY lower(x.email), (x.age IS NULL), (x.city IS NULL)
  )
  SELECT p.*, LEAST(p.first_night, p.added_at, fb.first_buy) AS joined_at,
         c.age AS c_age, c.city AS c_city
    FROM _cp p
    LEFT JOIN fb ON fb.email = p.email
    LEFT JOIN cr c ON c.em = p.email
   WHERE (v_seg = 'all' OR p.lifecycle = v_seg)
     AND (m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                            AND a.event_id = (m->'event'->>'id')::uuid));

  -- Courbe : la base au total à la fin de chaque case, et les nouveaux venus.
  -- Pour une soirée : ses acheteurs, jour après jour.
  IF m->>'mode' = 'event' THEN
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(DISTINCT a.email) FROM _atk_all a JOIN _apeo p ON p.email = a.email
                        WHERE a.ok AND a.ci IS NOT NULL AND a.ci <= g),
             'new', (SELECT count(DISTINCT a.email) FROM _atk_all a JOIN _apeo p ON p.email = a.email
                      WHERE a.ok AND a.ci = g
                        AND NOT EXISTS (SELECT 1 FROM _atk_all b WHERE b.email = a.email AND b.ok AND b.bought_at < a.bought_at)),
             'prev_total', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL AND a.pi <= g),
             'prev_new', (SELECT count(DISTINCT a.email) FROM _atk_all a WHERE a.ok AND a.pi = g
                           AND NOT EXISTS (SELECT 1 FROM _atk_all b WHERE b.email = a.email AND b.ok AND b.bought_at < a.bought_at))
           ) ORDER BY g)
      INTO v_series FROM generate_series(0, v_n - 1) g;
  ELSE
    SELECT jsonb_agg(jsonb_build_object(
             'total', (SELECT count(*) FROM _apeo p WHERE p.joined_at IS NOT NULL
                        AND public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                            <= CASE m->>'mode'
                                 WHEN 'hour' THEN public._crm_night_date((m->>'start')::timestamptz + make_interval(hours => g + 1), m->>'tz', (m->>'night_end_hour')::int)
                                 WHEN 'month' THEN ((m->>'start')::date + make_interval(months => g + 1) - interval '1 day')::date
                                 ELSE (m->>'start')::date + g END),
             'new', (SELECT count(*) FROM _apeo p WHERE public._crm_ana_bucket(m, p.joined_at) = g),
             'prev_new', (SELECT count(*) FROM _apeo p WHERE p.joined_at IS NOT NULL AND CASE m->>'mode'
                             WHEN 'hour' THEN p.joined_at >= (m->>'start')::timestamptz - make_interval(hours => v_n - g)
                                              AND p.joined_at < (m->>'start')::timestamptz - make_interval(hours => v_n - g - 1)
                             WHEN 'month' THEN public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                                               >= ((m->>'start')::date - interval '12 months' + make_interval(months => g))::date
                                               AND public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int)
                                               < ((m->>'start')::date - interval '12 months' + make_interval(months => g + 1))::date
                             ELSE public._crm_night_date(p.joined_at, m->>'tz', (m->>'night_end_hour')::int) = (m->>'start')::date - v_n + g END)
           ) ORDER BY g)
      INTO v_series FROM generate_series(0, v_n - 1) g;
  END IF;

  SELECT count(*) INTO v_base_total FROM _apeo;

  -- Cycle de vie (toute la base, ou les acheteurs de la soirée).
  SELECT jsonb_build_object(
           'hab', count(*) FILTER (WHERE lifecycle = 'hab'), 'occ', count(*) FILTER (WHERE lifecycle = 'occ'),
           'nou', count(*) FILTER (WHERE lifecycle = 'nou'), 'end', count(*) FILTER (WHERE lifecycle = 'end'),
           'none', count(*) FILTER (WHERE lifecycle = 'none'))
    INTO v_lc
    FROM _cp p
   WHERE m->>'mode' <> 'event' OR EXISTS (SELECT 1 FROM _atk_all a WHERE a.email = p.email AND a.ok
                                           AND a.event_id = (m->'event'->>'id')::uuid);

  SELECT jsonb_build_object(
           'total', count(*),
           'email_sms', count(*) FILTER (WHERE email_ok AND phone_ok),
           'email', count(*) FILTER (WHERE email_ok AND NOT phone_ok),
           'sms', count(*) FILTER (WHERE phone_ok AND NOT email_ok),
           'none', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok))
    INTO v_reach FROM _apeo;

  SELECT jsonb_build_object(
           'came', count(*) FILTER (WHERE nights > 0),
           'returning', count(*) FILTER (WHERE nights >= 2),
           'avg_nights', round(avg(nights) FILTER (WHERE nights > 0), 2),
           'spent', round(avg(spent) FILTER (WHERE nights > 0), 2))
    INTO v_stats FROM _apeo;

  -- Les mêmes mesures à la fin des six derniers mois (étincelles, écart).
  SELECT jsonb_agg(jsonb_build_object('returning_pct', q.rp, 'avg_nights', q.an, 'spent', q.sp) ORDER BY q.k DESC)
    INTO v_spark FROM (
      SELECT k,
             round(100.0 * count(*) FILTER (WHERE n >= 2) / NULLIF(count(*), 0), 1) AS rp,
             round(avg(n), 2) AS an, round(avg(s), 2) AS sp
        FROM generate_series(0, 5) k
        CROSS JOIN LATERAL (
          SELECT a.email, count(DISTINCT a.event_id) AS n, sum(a.amount) AS s
            FROM _atk_all a JOIN _apeo p ON p.email = a.email
           WHERE a.ok AND a.event_id IS NOT NULL
             AND a.bought_at < CASE WHEN k = 0 THEN now()
                                    ELSE (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - make_interval(months => k - 1)) AT TIME ZONE 'Europe/Paris' END
           GROUP BY a.email) x
       GROUP BY k) q;

  -- Qui revient : les cinq dernières soirées passées, et la part de leurs
  -- acheteurs revenus aux soirées suivantes (+1 à +4).
  WITH evs AS (
    SELECT e.id, e.title, e.start_at, e.night, row_number() OVER (ORDER BY e.start_at) AS rn
      FROM _aev e WHERE EXISTS (SELECT 1 FROM _atk_all a WHERE a.event_id = e.id AND a.ok)
  ), last5 AS (
    SELECT * FROM evs WHERE start_at < now() ORDER BY start_at DESC LIMIT 5
  ), buyers AS (
    SELECT DISTINCT a.event_id, a.email FROM _atk_all a JOIN _apeo p ON p.email = a.email WHERE a.ok AND a.email IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'title', l.title, 'night', l.night,
           'buyers', (SELECT count(*) FROM buyers b WHERE b.event_id = l.id),
           'back', (SELECT jsonb_agg(CASE WHEN nx.id IS NULL THEN NULL ELSE
                       (SELECT round(100.0 * count(*) / NULLIF((SELECT count(*) FROM buyers b0 WHERE b0.event_id = l.id), 0), 0)
                          FROM buyers b WHERE b.event_id = l.id
                           AND EXISTS (SELECT 1 FROM buyers b2 WHERE b2.event_id = nx.id AND b2.email = b.email)) END ORDER BY s)
                     FROM generate_series(1, 4) s LEFT JOIN evs nx ON nx.rn = l.rn + s)
         ) ORDER BY l.start_at), '[]'::jsonb)
    INTO v_cohort FROM last5 l;

  SELECT jsonb_build_object(
           'n1', count(*) FILTER (WHERE nights = 1), 'n2', count(*) FILTER (WHERE nights = 2),
           'n3', count(*) FILTER (WHERE nights BETWEEN 3 AND 4), 'n5', count(*) FILTER (WHERE nights BETWEEN 5 AND 9),
           'n10', count(*) FILTER (WHERE nights >= 10))
    INTO v_hist FROM _apeo;

  -- Qui vient : les acheteurs de la fenêtre, par cycle de vie.
  SELECT jsonb_build_object(
           'buyers', count(DISTINCT a.email),
           'groups', (SELECT jsonb_object_agg(g.k, jsonb_build_object(
                          'buyers', (SELECT count(DISTINCT x.email) FROM _atk x JOIN _cp p ON p.email = x.email
                                      WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle = g.k),
                          'revenue', (SELECT COALESCE(round(sum(x.amount), 2), 0) FROM _atk x JOIN _cp p ON p.email = x.email
                                      WHERE x.ok AND x.ci IS NOT NULL AND p.lifecycle = g.k)))
                        FROM unnest(ARRAY['nou', 'occ', 'hab', 'end']) g(k)))
    INTO v_aud
    FROM _atk a WHERE a.ok AND a.ci IS NOT NULL;

  -- Âge et lieu : billets d'abord (déclarés à l'achat), sinon la fiche.
  WITH pa AS (
    SELECT p.email,
           COALESCE((SELECT max(a.age) FROM _atk_all a WHERE a.email = p.email AND a.age BETWEEN 14 AND 99), NULLIF(p.c_age, 0)) AS age,
           COALESCE((SELECT a.city FROM _atk_all a WHERE a.email = p.email AND a.city IS NOT NULL ORDER BY a.bought_at DESC LIMIT 1),
                    NULLIF(btrim(p.c_city), '')) AS city
      FROM _apeo p
  )
  SELECT jsonb_build_object(
           'known', count(*) FILTER (WHERE age IS NOT NULL), 'total', count(*),
           'b', jsonb_build_array(count(*) FILTER (WHERE age BETWEEN 14 AND 21), count(*) FILTER (WHERE age BETWEEN 22 AND 25),
                                  count(*) FILTER (WHERE age BETWEEN 26 AND 30), count(*) FILTER (WHERE age BETWEEN 31 AND 35),
                                  count(*) FILTER (WHERE age >= 36))),
         jsonb_build_object(
           'known', count(*) FILTER (WHERE city IS NOT NULL), 'total', count(*),
           'top', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city', c, 'n', k) ORDER BY k DESC), '[]'::jsonb) FROM (
                     SELECT initcap(lower(city)) AS c, count(*) AS k FROM pa WHERE city IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t))
    INTO v_age, v_city FROM pa;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
           'nights', p.nights, 'spent', p.spent, 'last_night', p.last_night) ORDER BY p.spent DESC), '[]'::jsonb)
    INTO v_top FROM (SELECT * FROM _apeo WHERE nights > 0 ORDER BY spent DESC, nights DESC LIMIT 5) p;

  -- À réveiller : endormis, venus une seule fois (il y a plus d'un mois),
  -- habitués sans place pour la prochaine soirée.
  SELECT id INTO v_next FROM _aev WHERE upcoming ORDER BY start_at LIMIT 1;
  SELECT jsonb_build_object(
           'end', jsonb_build_object('n', count(*) FILTER (WHERE lifecycle = 'end'),
                                     'reachable', count(*) FILTER (WHERE lifecycle = 'end' AND (email_ok OR phone_ok))),
           'once', jsonb_build_object('n', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days'),
                                      'reachable', count(*) FILTER (WHERE nights = 1 AND last_night < now() - interval '30 days' AND (email_ok OR phone_ok))),
           'hab_no_ticket', CASE WHEN v_next IS NOT NULL THEN jsonb_build_object(
               'event_id', v_next, 'title', (SELECT title FROM _aev WHERE id = v_next),
               'n', count(*) FILTER (WHERE lifecycle = 'hab' AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next)),
               'reachable', count(*) FILTER (WHERE lifecycle = 'hab' AND (email_ok OR phone_ok) AND NOT EXISTS (
                      SELECT 1 FROM _atk_all a WHERE a.email = _cp.email AND a.ok AND a.event_id = v_next))) END)
    INTO v_wake FROM _cp;

  RETURN jsonb_build_object(
    'meta', m,
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months),
    'series', COALESCE(v_series, '[]'::jsonb),
    'base', v_base_total,
    'lifecycle', v_lc,
    'reach', v_reach,
    'stats', v_stats,
    'spark', COALESCE(v_spark, '[]'::jsonb),
    'cohort', v_cohort,
    'hist', v_hist,
    'audience', v_aud,
    'age', v_age,
    'city', v_city,
    'top', v_top,
    'wake', v_wake,
    'has_any', EXISTS (SELECT 1 FROM _cp)
  );
END;
$function$;
