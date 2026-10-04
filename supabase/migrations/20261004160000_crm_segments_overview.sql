-- ============================================================================
-- Yuno CRM — écran Segments : « Quels groupes répondent le mieux ? »
--
--   crm_segments_overview(portée, période)  tout l'écran en un appel :
--     totaux des messages (reçus → cliqué → billetterie → acheté), ventes
--     attribuées jour par jour, une ligne par segment (taille, évolution,
--     joignables, réponse aux messages, ventes), les envois de la période.
--   crm_segment_detail(portée, segment, période)  la fiche : entrées et
--     sorties sur la période, les envois qui ont touché ses membres.
--
-- Règles :
--   * Un segment = les cinq groupes automatiques (cycle de vie, porte unique
--     _crm_people_build) + les segments « à vous » (crm_segments). Les
--     chiffres d'un segment se lisent sur ses membres AUJOURD'HUI.
--   * Un message reçu = un destinataire `sent` (ou plainte : le message est
--     arrivé) d'une campagne de la portée, envoyée dans la période ; un SMS
--     compte aussi (statut sent / delivered) et se rattache à la personne par
--     son numéro. Les SMS n'ont pas de clic par personne : ils comptent dans
--     les reçus, jamais dans les clics.
--   * Une vente attribuée = un billet (valide ou transféré : remboursements
--     déduits) acheté dans les 7 jours qui suivent un clic sur un e-mail de
--     la portée, par la même adresse. Le DERNIER clic avant l'achat gagne ;
--     un billet n'est jamais compté deux fois.
--   * « Billetterie » = un clic vers une page de vente (lien suivi Yuno /l/,
--     page de soirée Yuno, Shotgun, ou l'hôte de billetterie d'une soirée de
--     la portée). Un CRM n'a pas de page de club : c'est l'étape mesurable
--     entre le clic et l'achat.
--   * L'évolution d'un segment se lit dans crm_segment_counts (une ligne par
--     jour et par segment) : écrite chaque nuit par le cron, à chaque
--     ouverture de l'écran pour aujourd'hui, et rattrapée à quelques dates
--     repères quand elles manquent (rejeu de la base à une date passée).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_segment_counts (
  scope_key   text NOT NULL,
  seg_key     text NOT NULL,
  day         date NOT NULL,
  n           integer NOT NULL,
  reachable   integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, seg_key, day)
);
ALTER TABLE public.crm_segment_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_segment_counts FROM anon, authenticated;

-- Les segments d'une portée : cinq automatiques, puis ceux du pro.
CREATE OR REPLACE FUNCTION public._crm_segment_defs(p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(seg_key text, kind text, name text, description text, template text, def jsonb, created_at timestamptz, sort integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.k, 'auto', NULL::text, NULL::text, NULL::text, jsonb_build_object('seg', x.k), NULL::timestamptz, x.o
    FROM (VALUES ('hab', 1), ('occ', 2), ('nou', 3), ('end', 4), ('none', 5)) AS x(k, o)
  UNION ALL
  SELECT s.id::text, 'custom', s.name, s.description, s.template, s.definition, s.created_at,
         100 + row_number() OVER (ORDER BY s.created_at)::integer
    FROM public.crm_segments s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public._crm_segment_defs(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_segment_defs(text, uuid) TO service_role;

-- Un clic mène-t-il à une page de vente ?
CREATE OR REPLACE FUNCTION public._crm_is_ticketing_link(p_link text, p_hosts text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_link IS NOT NULL
     AND p_link !~* '/unsubscribe'
     AND (p_link ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/'
       OR p_link ~* '^https?://([a-z0-9-]+\.)*shotgun\.live'
       OR lower(substring(p_link FROM '^https?://([^/:?#]+)')) = ANY (COALESCE(p_hosts, '{}')));
$$;

-- Compte chaque segment sur la base en cours (_cp) et l'inscrit au jour donné.
CREATE OR REPLACE FUNCTION public._crm_segment_counts_write(p_venue_id text, p_organizer_user_id uuid, p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_seg record;
  v_n integer;
  v_r integer;
BEGIN
  FOR v_seg IN SELECT * FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE p.email_ok OR p.phone_ok) FROM _cp p WHERE %s',
                   public._crm_filter_sql(v_seg.def, 'p'))
      INTO v_n, v_r;
    INSERT INTO public.crm_segment_counts (scope_key, seg_key, day, n, reachable, computed_at)
    VALUES (v_scope, v_seg.seg_key, p_day, v_n, v_r, now())
    ON CONFLICT (scope_key, seg_key, day) DO UPDATE SET n = EXCLUDED.n, reachable = EXCLUDED.reachable, computed_at = now();
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_segment_counts_write(text, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_segment_counts_write(text, uuid, date) TO service_role;

-- Les messages reçus dans [p_from, p_to) — temp _cm, une ligne par (envoi, personne).
-- Exige _cp construit (rattachement des SMS par numéro).
CREATE OR REPLACE FUNCTION public._crm_msg_build(p_venue_id text, p_organizer_user_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_hosts text[];
  v_n integer;
BEGIN
  SELECT array_agg(DISTINCT lower(substring(e.external_ticket_url FROM '^https?://([^/:?#]+)')))
    INTO v_hosts
    FROM public.events e
   WHERE e.external_ticket_url IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  DROP TABLE IF EXISTS _cmc;
  CREATE TEMP TABLE _cmc ON COMMIT DROP AS
    SELECT c.id, c.name, c.sent_at, c.audiences_json
      FROM public.email_campaigns c
     WHERE c.status IN ('sent', 'sending') AND c.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  -- Clics e-mail de la portée (toutes dates : un clic d'avant la période
  -- peut porter un achat de la période, il reste rattaché à SON envoi).
  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  -- Billets attribués : dernier clic dans les 7 jours avant l'achat.
  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
      FROM public._crm_tickets(p_venue_id, p_organizer_user_id) t
      JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
     ORDER BY t.id, k.at DESC;
  CREATE INDEX ON _cma (campaign_id, email);

  DROP TABLE IF EXISTS _cm0;
  CREATE TEMP TABLE _cm0 ON COMMIT DROP AS
    SELECT r.campaign_id, 'email'::text AS channel, lower(r.email) AS email, c.sent_at,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email)) AS clicked,
           EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email) AND k.ticketing) AS ticketing,
           COALESCE((SELECT sum(a.amount) FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)), 0) AS revenue
      FROM public.email_campaign_recipients r
      JOIN _cmc c ON c.id = r.campaign_id
     WHERE r.status IN ('sent', 'complained')
       AND c.sent_at >= p_from AND c.sent_at < p_to;

  -- SMS reçus, rattachés à la personne par son numéro.
  INSERT INTO _cm0 (campaign_id, channel, email, sent_at, clicked, ticketing, revenue)
  SELECT r.campaign_id, 'sms', p.email, COALESCE(s.sent_at, r.sent_at), false, false, 0
    FROM public.sms_campaign_recipients r
    JOIN public.sms_campaigns s ON s.id = r.campaign_id
    JOIN _cp p ON p.phone IS NOT NULL
             AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(r.phone_e164, '\D', '', 'g')
   WHERE r.status::text IN ('sent', 'delivered')
     AND s.venue_id IS NOT DISTINCT FROM p_venue_id
     AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
     AND COALESCE(s.sent_at, r.sent_at) >= p_from AND COALESCE(s.sent_at, r.sent_at) < p_to;

  DROP TABLE IF EXISTS _cm;
  CREATE TEMP TABLE _cm ON COMMIT DROP AS SELECT m.*, m.revenue > 0 AS bought FROM _cm0 m;
  CREATE INDEX ON _cm (email);
  SELECT count(*) INTO v_n FROM _cm;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_msg_build(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_msg_build(text, uuid, timestamptz, timestamptz) TO service_role;

-- La cible d'un envoi, lue dans audiences_json (convention de la Console CRM :
-- [{kind:'crm', segmentId?, def?}]). Rend la clé d'un segment, 'all' ou 'custom'.
CREATE OR REPLACE FUNCTION public._crm_send_target(p_aud jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_aud IS NULL OR jsonb_typeof(p_aud) <> 'array' OR jsonb_array_length(p_aud) = 0 THEN 'all'
    WHEN jsonb_array_length(p_aud) > 1 THEN 'custom'
    WHEN p_aud->0->>'kind' = 'crm' AND p_aud->0->>'segmentId' ~ '^[0-9a-f-]{36}$' THEN p_aud->0->>'segmentId'
    WHEN p_aud->0->>'kind' = 'crm'
         AND COALESCE(p_aud->0->'def'->>'seg', 'all') IN ('hab', 'occ', 'nou', 'end', 'none')
         AND COALESCE(p_aud->0->'def'->'f', '{}'::jsonb) = '{}'::jsonb
         AND COALESCE(p_aud->0->'def'->>'q', '') = '' THEN p_aud->0->'def'->>'seg'
    WHEN p_aud->0->>'kind' IN ('all', 'everyone') THEN 'all'
    WHEN p_aud->0->>'kind' = 'crm'
         AND COALESCE(p_aud->0->'def'->>'seg', 'all') = 'all'
         AND COALESCE(p_aud->0->'def'->'f', '{}'::jsonb) = '{}'::jsonb
         AND COALESCE(p_aud->0->'def'->>'q', '') = '' THEN 'all'
    ELSE 'custom' END;
$$;

CREATE OR REPLACE FUNCTION public.crm_segments_overview(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tz text := 'Europe/Paris';
  v_days integer := CASE p_period WHEN '90d' THEN 91 WHEN '12m' THEN 360 ELSE 30 END;
  v_step integer := CASE p_period WHEN '90d' THEN 7 WHEN '12m' THEN 30 ELSE 1 END;
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_from timestamptz;
  v_pfrom timestamptz;
  v_anchor date;
  v_missing boolean;
  v_seg record;
  v_pred text;
  v_stats jsonb;
  v_msg jsonb;
  v_segs jsonb := '[]'::jsonb;
  v_tot jsonb;
  v_prev numeric;
  v_series jsonb;
  v_sends jsonb;
  v_builds integer := 0;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_now - make_interval(days => v_days);
  v_pfrom := v_from - make_interval(days => v_days);

  -- Dates repères manquantes : rejeu de la base à cette date (3 au plus).
  FOREACH v_anchor IN ARRAY ARRAY[v_today - v_days, v_today - (v_days * 2 / 3), v_today - (v_days / 3)] LOOP
    SELECT EXISTS (
      SELECT 1 FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) d
       WHERE NOT EXISTS (SELECT 1 FROM public.crm_segment_counts c
                          WHERE c.scope_key = v_scope AND c.seg_key = d.seg_key AND c.day = v_anchor))
      INTO v_missing;
    IF v_missing THEN
      PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id,
                                       ((v_anchor + 1)::timestamp AT TIME ZONE v_tz) - interval '1 second');
      PERFORM public._crm_segment_counts_write(p_venue_id, p_organizer_user_id, v_anchor);
      v_builds := v_builds + 1;
    END IF;
  END LOOP;

  -- La base d'aujourd'hui, puis les messages de la période (et de la précédente).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_segment_counts_write(p_venue_id, p_organizer_user_id, v_today);
  PERFORM public._crm_msg_build(p_venue_id, p_organizer_user_id, v_pfrom, v_now);

  -- Une ligne par segment.
  FOR v_seg IN SELECT * FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) ORDER BY sort LOOP
    v_pred := public._crm_filter_sql(v_seg.def, 'p');
    EXECUTE format($q$
      SELECT jsonb_build_object(
        'n', count(*),
        'reachable', count(*) FILTER (WHERE p.email_ok OR p.phone_ok),
        'email', count(*) FILTER (WHERE p.email_ok),
        'sms', count(*) FILTER (WHERE p.phone_ok),
        'avg_spend', CASE WHEN count(*) > 0 THEN round(sum(p.spent) / count(*), 2) END,
        'avg_nights', CASE WHEN count(*) > 0 THEN round(avg(p.nights)::numeric, 1) END,
        'sources', jsonb_build_object(
          'shotgun', count(*) FILTER (WHERE p.source = 'shotgun'),
          'utm', count(*) FILTER (WHERE p.source = 'utm'),
          'import', count(*) FILTER (WHERE p.source = 'import'),
          'other', count(*) FILTER (WHERE p.source NOT IN ('shotgun', 'utm', 'import'))))
        FROM _cp p WHERE %s $q$, v_pred) INTO v_stats;
    EXECUTE format($q$
      SELECT jsonb_build_object(
        'received', count(*),
        'clicked', count(*) FILTER (WHERE m.clicked),
        'ticketing', count(*) FILTER (WHERE m.ticketing),
        'bought', count(*) FILTER (WHERE m.bought),
        'buyers', count(DISTINCT m.email) FILTER (WHERE m.bought),
        'revenue', COALESCE(round(sum(m.revenue), 2), 0))
        FROM _cm m JOIN _cp p ON p.email = m.email
       WHERE m.sent_at >= %L AND %s $q$, v_from, v_pred) INTO v_msg;

    v_segs := v_segs || jsonb_build_array(
      jsonb_build_object('key', v_seg.seg_key, 'kind', v_seg.kind, 'name', v_seg.name, 'description', v_seg.description,
                         'template', v_seg.template, 'definition', v_seg.def, 'created_at', v_seg.created_at)
      || v_stats
      || jsonb_build_object('msg', v_msg,
           'n_start', (SELECT c.n FROM public.crm_segment_counts c
                        WHERE c.scope_key = v_scope AND c.seg_key = v_seg.seg_key AND c.day = v_today - v_days),
           'spark', (SELECT COALESCE(jsonb_agg(jsonb_build_object('d', c.day, 'n', c.n) ORDER BY c.day), '[]'::jsonb)
                       FROM public.crm_segment_counts c
                      WHERE c.scope_key = v_scope AND c.seg_key = v_seg.seg_key
                        AND c.day >= v_today - v_days AND c.day <= v_today)));
  END LOOP;

  -- Totaux de la période et ventes de la période précédente.
  SELECT jsonb_build_object(
           'received', count(*),
           'sends', count(DISTINCT m.campaign_id),
           'clicked', count(*) FILTER (WHERE m.clicked),
           'ticketing', count(*) FILTER (WHERE m.ticketing),
           'bought', count(*) FILTER (WHERE m.bought),
           'buyers', count(DISTINCT m.email) FILTER (WHERE m.bought),
           'revenue', COALESCE(round(sum(m.revenue), 2), 0))
    INTO v_tot
    FROM _cm m WHERE m.sent_at >= v_from;
  SELECT COALESCE(round(sum(m.revenue), 2), 0) INTO v_prev FROM _cm m WHERE m.sent_at < v_from;

  -- Ventes attribuées par tranche (jour / semaine / mois), date d'achat ;
  -- les envois de chaque tranche pour les points du graphique.
  WITH b AS (
    SELECT g AS i, v_now - make_interval(days => v_days - g * v_step) AS lo,
           v_now - make_interval(days => v_days - (g + 1) * v_step) AS hi
      FROM generate_series(0, v_days / v_step - 1) g
  ), att AS (
    SELECT a.amount, a.bought_at FROM _cma a
     WHERE EXISTS (SELECT 1 FROM _cm m WHERE m.campaign_id = a.campaign_id AND m.email = a.email AND m.sent_at >= v_from)
  )
  SELECT jsonb_agg(jsonb_build_object(
           't', b.lo,
           'v', COALESCE((SELECT round(sum(att.amount), 2) FROM att WHERE att.bought_at >= b.lo AND att.bought_at < b.hi), 0),
           'sends', COALESCE((SELECT jsonb_agg(c.name ORDER BY c.sent_at) FROM _cmc c WHERE c.sent_at >= b.lo AND c.sent_at < b.hi), '[]'::jsonb))
           ORDER BY b.i)
    INTO v_series FROM b;

  -- Les envois de la période (e-mail et SMS), du plus récent au plus ancien.
  WITH s AS (
    SELECT m.campaign_id, m.channel, min(m.sent_at) AS sent_at,
           count(*) AS received, count(*) FILTER (WHERE m.clicked) AS clicked,
           count(*) FILTER (WHERE m.ticketing) AS ticketing, count(*) FILTER (WHERE m.bought) AS bought,
           count(DISTINCT m.email) FILTER (WHERE m.bought) AS buyers, COALESCE(round(sum(m.revenue), 2), 0) AS revenue
      FROM _cm m WHERE m.sent_at >= v_from
     GROUP BY m.campaign_id, m.channel
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.campaign_id, 'channel', s.channel,
           'name', COALESCE(c.name, sc.name), 'sent_at', s.sent_at,
           'target', CASE WHEN s.channel = 'email' THEN public._crm_send_target(c.audiences_json) ELSE 'custom' END,
           'received', s.received, 'clicked', s.clicked, 'ticketing', s.ticketing, 'bought', s.bought,
           'buyers', s.buyers, 'revenue', s.revenue) ORDER BY s.sent_at DESC), '[]'::jsonb)
    INTO v_sends
    FROM s
    LEFT JOIN _cmc c ON s.channel = 'email' AND c.id = s.campaign_id
    LEFT JOIN public.sms_campaigns sc ON s.channel = 'sms' AND sc.id = s.campaign_id;

  RETURN jsonb_build_object(
    'period', p_period, 'from', v_from, 'to', v_now, 'step_days', v_step,
    'totals', v_tot || jsonb_build_object('prev_revenue', v_prev,
                         'has_prev', EXISTS (SELECT 1 FROM _cm m WHERE m.sent_at < v_from)),
    'series', COALESCE(v_series, '[]'::jsonb),
    'segments', v_segs,
    'sends', v_sends,
    'rules', (SELECT to_jsonb(r) FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id) r),
    'computed_at', v_now,
    'rebuilt_anchors', v_builds);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_segments_overview(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segments_overview(text, uuid, text) TO authenticated;

-- Fiche d'un segment : entrées / sorties sur la période, envois reçus par ses membres.
CREATE OR REPLACE FUNCTION public.crm_segment_detail(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_seg_key text DEFAULT NULL, p_period text DEFAULT '30d'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_days integer := CASE p_period WHEN '90d' THEN 91 WHEN '12m' THEN 360 ELSE 30 END;
  v_now timestamptz := now();
  v_from timestamptz;
  v_def jsonb;
  v_p text;
  v_q text;
  v_entered integer;
  v_exited integer;
  v_sends jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT d.def INTO v_def FROM public._crm_segment_defs(p_venue_id, p_organizer_user_id) d WHERE d.seg_key = p_seg_key;
  IF v_def IS NULL THEN RETURN NULL; END IF;
  v_from := v_now - make_interval(days => v_days);
  v_p := public._crm_filter_sql(v_def, 'p');
  v_q := public._crm_filter_sql(v_def, 'q');

  -- La base au début de la période, gardée à part, puis celle d'aujourd'hui.
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, v_from);
  DROP TABLE IF EXISTS _cp0;
  CREATE TEMP TABLE _cp0 ON COMMIT DROP AS SELECT * FROM _cp;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  EXECUTE format('SELECT count(*) FROM _cp p WHERE %s AND NOT EXISTS (SELECT 1 FROM _cp0 q WHERE q.email = p.email AND %s)', v_p, v_q)
    INTO v_entered;
  EXECUTE format('SELECT count(*) FROM _cp0 q WHERE %s AND NOT EXISTS (SELECT 1 FROM _cp p WHERE p.email = q.email AND %s)', v_q, v_p)
    INTO v_exited;

  PERFORM public._crm_msg_build(p_venue_id, p_organizer_user_id, v_from, v_now);
  EXECUTE format($q$
    WITH s AS (
      SELECT m.campaign_id, m.channel, min(m.sent_at) AS sent_at, count(*) AS received,
             count(*) FILTER (WHERE m.clicked) AS clicked, COALESCE(round(sum(m.revenue), 2), 0) AS revenue,
             count(DISTINCT m.email) FILTER (WHERE m.bought) AS buyers
        FROM _cm m JOIN _cp p ON p.email = m.email
       WHERE %s
       GROUP BY m.campaign_id, m.channel
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.campaign_id, 'channel', s.channel,
             'name', COALESCE(c.name, sc.name), 'sent_at', s.sent_at, 'received', s.received,
             'clicked', s.clicked, 'revenue', s.revenue, 'buyers', s.buyers) ORDER BY s.sent_at DESC), '[]'::jsonb)
      FROM s
      LEFT JOIN _cmc c ON s.channel = 'email' AND c.id = s.campaign_id
      LEFT JOIN public.sms_campaigns sc ON s.channel = 'sms' AND sc.id = s.campaign_id $q$, v_p)
    INTO v_sends;

  RETURN jsonb_build_object('key', p_seg_key, 'period', p_period, 'entered', v_entered, 'exited', v_exited, 'sends', v_sends);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_segment_detail(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_segment_detail(text, uuid, text, text) TO authenticated;

-- Chaque nuit : la taille de chaque segment de chaque compte CRM.
CREATE OR REPLACE FUNCTION public.crm_segment_counts_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sc record;
  v_n integer := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  FOR v_sc IN
    SELECT v.id AS venue_id, NULL::uuid AS org FROM public.venues v WHERE v.product = 'crm'
    UNION ALL
    SELECT NULL::text, o.user_id FROM public.organizer_profiles o WHERE o.product = 'crm'
  LOOP
    BEGIN
      PERFORM public._crm_people_build(v_sc.venue_id, v_sc.org, NULL);
      PERFORM public._crm_segment_counts_write(v_sc.venue_id, v_sc.org, v_today);
      v_n := v_n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'crm_segment_counts_sweep % %: %', v_sc.venue_id, v_sc.org, SQLERRM;
    END;
  END LOOP;
  DELETE FROM public.crm_segment_counts WHERE day < v_today - 800;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_segment_counts_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_segment_counts_sweep() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('crm-segment-counts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-segment-counts');
  PERFORM cron.schedule('crm-segment-counts', '41 2 * * *', 'SELECT public.crm_segment_counts_sweep()');
END $$;
