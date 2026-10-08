-- ============================================================================
-- Yuno CRM — « Qui cibler » : l'ordre d'envoi et le recouvrement (2026-10-14).
-- Plan : docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md (lot 4). Décisions de Paul
-- (08/10) : les cartes sont rangées et numérotées dans l'ordre conseillé
-- (« 1er envoi », « 2e envoi »…, avec « dont N nouveaux » : ceux qui ne sont
-- dans aucune audience d'avant) ; chaque carte dit son plus gros recouvrement
-- avec une autre audience (10 personnes en commun et 25 % au moins).
-- Ordre : le moment conseillé (maintenant, la semaine d'avant, la veille),
-- puis la famille confirmée sur le compte, puis le plus d'acheteurs attendus
-- PAR PERSONNE (décision de Paul, 08/10 : en total, une grosse audience passait
-- devant et vidait les petites, plus ciblées — au banc, « Les plus probables »
-- arrivait 3e avec 0 nouveau) ; sans score validé, l'effet de la famille sur le
-- compte (gain). Chacun reçoit ainsi d'abord le message le plus proche de lui.
-- L'envoi lui-même ne change pas : « Leur écrire » écrit toujours à toute
-- l'audience (exclure les déjà contactés est une décision ouverte, voir le plan).
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs).
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope  text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  e        record;
  v_tz     text;
  v_local  date;
  v_series text;
  v_res    numeric := COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2);
  v_eve    timestamptz;
  v_week   timestamptz;
  v_out    jsonb;
  v_auds   jsonb;
  v_union  jsonb;
  v_score  boolean;
  v_scorej jsonb;
  v_gate   jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT ev.id, ev.title, ev.start_at, ev.end_at, ev.timezone, x.artists, x.genres INTO e
    FROM public.events ev
    LEFT JOIN public.external_events x ON x.event_id = ev.id
   WHERE ev.id = p_event_id AND ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;
  IF COALESCE(e.end_at, e.start_at + interval '6 hours') <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_upcoming');
  END IF;

  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');
  v_local := (e.start_at AT TIME ZONE v_tz)::date;
  v_series := public._crm_night_series(e.title);
  -- Moments conseillés : la veille à 18 h (heure de la soirée), la semaine
  -- d'avant à 18 h ; jamais dans le passé.
  v_eve := GREATEST(now(), ((v_local - 1)::timestamp + time '18:00') AT TIME ZONE v_tz);
  v_week := GREATEST(now(), ((v_local - 7)::timestamp + time '18:00') AT TIME ZONE v_tz);

  -- Joignables : la même base que l'envoi (consentements e-mail et SMS).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ntg;
  CREATE TEMP TABLE _ntg ON COMMIT DROP AS
  SELECT a.aud, t.email
    FROM unnest(ARRAY['likely', 'concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local']) a(aud)
   CROSS JOIN LATERAL public._crm_night_target_set(v_scope, p_event_id, a.aud) t;

  -- Score de prédiction (20261012100000) : seulement un modèle validé.
  v_score := EXISTS (SELECT 1 FROM public.crm_score_model m WHERE m.scope_key = v_scope AND m.status = 'ok');

  -- Chaque audience, ses joignables, sa famille, son moment (une ligne).
  DROP TABLE IF EXISTS _nta;
  CREATE TEMP TABLE _nta ON COMMIT DROP AS
  WITH counts AS (
    SELECT g.aud, count(*)::int AS n,
           count(*) FILTER (WHERE c.email_ok)::int AS email,
           count(*) FILTER (WHERE c.phone_ok)::int AS sms,
           sum(s.p) AS expected
      FROM _ntg g LEFT JOIN _cp c ON c.email = g.email
      LEFT JOIN public.crm_person_night_score s ON v_score AND s.scope_key = v_scope AND s.event_id = p_event_id AND s.email = g.email
     GROUP BY g.aud
  ), fam AS (
    SELECT a.aud, a.family, a.moment, a.mord
      FROM (VALUES ('likely', NULL, 'now', 1), ('concept', 'series', 'now', 1), ('lineup', 'artist', 'now', 1), ('genre', 'genre', 'week', 2),
                   ('early', 'early', 'now', 1), ('last_minute', 'last_minute', 'eve', 3), ('once_local', NULL, 'week', 2)) a(aud, family, moment, mord)
  )
  SELECT f.aud, f.family, f.moment, f.mord, COALESCE(c.n, 0) AS n, COALESCE(c.email, 0) AS email, COALESCE(c.sms, 0) AS sms,
         c.expected, s.status, s.availability, s.gain, NULL::int AS rk, NULL::int AS new_n, NULL::jsonb AS overlap
    FROM fam f
    LEFT JOIN counts c ON c.aud = f.aud
    LEFT JOIN LATERAL (
      SELECT fs.status, fs.availability, fs.gain FROM public.crm_family_status fs
       WHERE fs.scope_key = v_scope AND fs.family = f.family AND COALESCE(fs.variant, '') = '' LIMIT 1) s ON true;

  -- Ordre d'envoi conseillé (20261014130000, décisions de Paul du 08/10) : le
  -- moment d'abord (maintenant, la semaine d'avant, la veille), puis la
  -- famille confirmée sur le compte, puis le plus d'acheteurs attendus par
  -- personne (sans score : l'effet de la famille).
  UPDATE _nta a SET rk = r.rk
    FROM (SELECT x.aud, row_number() OVER (ORDER BY x.mord,
                   CASE WHEN x.status = 'supported' AND x.availability IN ('ok', 'reduced') THEN 0 ELSE 1 END,
                   CASE WHEN v_score THEN -COALESCE(x.expected, 0) / x.n ELSE -COALESCE(x.gain, 0) END, x.n DESC, x.aud)::int AS rk
            FROM _nta x WHERE x.n > 0) r
   WHERE r.aud = a.aud;
  -- « dont N nouveaux » : absents des audiences d'avant dans l'ordre.
  UPDATE _nta a SET new_n = (
    SELECT count(*) FROM _ntg g
     WHERE g.aud = a.aud
       AND NOT EXISTS (SELECT 1 FROM _ntg g2 JOIN _nta b ON b.aud = g2.aud
                        WHERE g2.email = g.email AND b.rk < a.rk))
   WHERE a.rk IS NOT NULL;
  -- Le plus gros recouvrement avec une autre audience : 10 personnes en
  -- commun et 25 % de l'audience au moins, sinon rien.
  UPDATE _nta a SET overlap = o.j
    FROM (SELECT z.aud, jsonb_build_object('key', z.other, 'n', z.common, 'pct', round(100.0 * z.common / z.n)) AS j
            FROM (SELECT ga.aud, gb.aud AS other, count(*)::int AS common, x.n,
                         row_number() OVER (PARTITION BY ga.aud ORDER BY count(*) DESC, gb.aud) AS k
                    FROM _ntg ga JOIN _ntg gb ON gb.email = ga.email AND gb.aud <> ga.aud
                    JOIN _nta x ON x.aud = ga.aud
                   GROUP BY ga.aud, gb.aud, x.n) z
           WHERE z.k = 1 AND z.common >= 10 AND z.common >= 0.25 * z.n) o
   WHERE o.aud = a.aud;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'key', ta.aud,
           'n', ta.n, 'email', ta.email, 'sms', ta.sms,
           -- Acheteurs attendus : somme des chances (score validé seulement).
           'expected', CASE WHEN v_score THEN round(COALESCE(ta.expected, 0)) END,
           'order', ta.rk, 'new_n', ta.new_n, 'overlap', ta.overlap,
           'family', ta.family,
           'status', ta.status, 'availability', ta.availability, 'gain', ta.gain,
           'moment', ta.moment,
           'send_at', CASE ta.moment WHEN 'eve' THEN v_eve WHEN 'week' THEN v_week ELSE now() END,
           'params', CASE ta.aud
             WHEN 'concept' THEN jsonb_build_object('series', v_series,
               'editions', (SELECT count(*) FROM public.crm_night_profile np
                             WHERE np.scope_key = v_scope AND lower(np.series) = lower(v_series) AND np.starts_at < now()))
             WHEN 'lineup' THEN jsonb_build_object('artists', (
               SELECT COALESCE(jsonb_agg(jsonb_build_object('name', z.name, 'n', z.n) ORDER BY z.n DESC, z.name), '[]'::jsonb)
                 FROM (SELECT COALESCE(a->>'name', z0.k) AS name,
                              (SELECT count(*) FROM _ntg g JOIN public.crm_person_profile p ON p.scope_key = v_scope AND p.email = g.email
                                WHERE g.aud = 'lineup' AND ('a:' || z0.k) = ANY (p.tags))::int AS n
                         FROM jsonb_array_elements(COALESCE(e.artists, '[]'::jsonb)) a
                         CROSS JOIN LATERAL (SELECT public._crm_artist_key(a) AS k) z0
                        WHERE z0.k IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st
                                           WHERE st.scope_key = v_scope AND st.artist_key = z0.k AND st.share > v_res)) z
                WHERE z.n > 0))
             WHEN 'genre' THEN jsonb_build_object('genres', to_jsonb(COALESCE(e.genres, '{}'::text[])))
           END)) ORDER BY ta.rk NULLS LAST, ta.aud), '[]'::jsonb)
    INTO v_auds
    FROM _nta ta;

  SELECT jsonb_build_object('n', count(*), 'email', count(*) FILTER (WHERE c.email_ok), 'sms', count(*) FILTER (WHERE c.phone_ok))
    INTO v_union
    FROM (SELECT DISTINCT email FROM _ntg) g LEFT JOIN _cp c ON c.email = g.email;

  -- Toute la base connue sans place : acheteurs attendus (score validé).
  IF v_score THEN
    SELECT jsonb_build_object('status', 'ok', 'expected', round(COALESCE(sum(s.p), 0)), 'people', count(*))
      INTO v_scorej
      FROM public.crm_person_night_score s
     WHERE s.scope_key = v_scope AND s.event_id = p_event_id
       AND EXISTS (SELECT 1 FROM public.crm_person_profile pp WHERE pp.scope_key = v_scope AND pp.email = s.email)
       AND NOT EXISTS (SELECT 1 FROM public.external_tickets t
                        WHERE t.event_id = p_event_id AND lower(t.buyer_email) = s.email AND t.status IN ('valid', 'transferred'));
    -- Projection de remplissage (20261013110000) : montrée au pro seulement
    -- quand elle a tenu (écart moyen < 15 % sur ses 8 dernières soirées à J-7,
    -- décision de Paul du 07/10). En ACHETEURS : c'est ce que le journal mesure.
    v_gate := public._crm_projection_gate(v_scope);
    IF COALESCE((v_gate->>'open')::boolean, false) THEN
      SELECT v_scorej || jsonb_build_object('projection', jsonb_build_object(
               'buyers', b.n, 'expected', round(k.p), 'band', round(2 * sqrt(k.v)), 'newcomers', round(COALESCE(nw.x, 0)),
               'total', round(b.n + k.p + COALESCE(nw.x, 0)),
               'low', round(GREATEST(b.n, b.n + k.p - 2 * sqrt(k.v) + COALESCE(nw.x, 0))),
               'high', round(b.n + k.p + 2 * sqrt(k.v) + COALESCE(nw.x, 0))))
        INTO v_scorej
        FROM (SELECT count(DISTINCT lower(t.buyer_email)) AS n FROM public.external_tickets t
               WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.raw) AND t.buyer_email IS NOT NULL) b,
             (SELECT COALESCE(sum(s.p), 0) AS p, COALESCE(sum(s.p * (1 - s.p)), 0) AS v FROM public.crm_person_night_score s
               WHERE s.scope_key = v_scope AND s.event_id = p_event_id) k,
             (SELECT avg(np.new_people) * COALESCE((SELECT sn.remaining_share FROM public.crm_score_night sn
                                                     WHERE sn.scope_key = v_scope AND sn.event_id = p_event_id), 1) AS x
                FROM (SELECT n.new_people FROM public.crm_night_profile n
                       WHERE n.scope_key = v_scope AND n.starts_at < now() ORDER BY n.starts_at DESC LIMIT 8) np) nw;
    END IF;
  ELSE
    v_scorej := jsonb_build_object('status', COALESCE((SELECT m.status FROM public.crm_score_model m WHERE m.scope_key = v_scope), 'none'));
  END IF;

  v_out := jsonb_build_object('ok', true, 'score', v_scorej,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'series', v_series,
                                'genres', to_jsonb(COALESCE(e.genres, '{}'::text[]))),
    'days_left', GREATEST(0, v_local - (now() AT TIME ZONE v_tz)::date),
    'has_ticket', (SELECT count(DISTINCT lower(t.buyer_email)) FROM public.external_tickets t
                    WHERE t.event_id = p_event_id AND t.status IN ('valid', 'transferred') AND t.buyer_email IS NOT NULL),
    'computed', EXISTS (SELECT 1 FROM public.crm_analysis_state st WHERE st.scope_key = v_scope),
    'union', v_union,
    'audiences', v_auds);
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_targets(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_targets(text, uuid, uuid) TO authenticated, service_role;
