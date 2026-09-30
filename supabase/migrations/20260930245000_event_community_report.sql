-- Communauté PAR SOIRÉE — « ce que cette soirée m'a apporté ».
--
-- `get_event_community(p_event_id)` : les personnes venues (billets, tables,
-- guest list), ce qu'elles valent pour le CRM (nouveaux contacts, email / SMS /
-- appli joignables, comptes), les abonnés gagnés pendant la vente, la fidélité
-- (première soirée, 2e, habitués) et, une fois la soirée ancienne, le retour
-- aux soirées suivantes. Sur une soirée à plusieurs (contrat collab,
-- co-organisation), la même lecture PARTIE PAR PARTIE : qui a amené quelles
-- personnes, quels contacts et quels abonnés chacune a gagnés.
--
-- Même porte que le Rapport de soirée (`event_analytics_scope`). Volumes
-- seulement : jamais un nom, un email ou un numéro — une partie voit combien de
-- contacts une autre a gagnés, pas lesquels (le consentement nommé reste ce
-- qui décide qui reçoit un contact, cf. « CRM = consentement NOMMÉ »).
--
-- Fenêtre de la soirée : de la première vente (ou de la publication) jusqu'à 72 h
-- après la fin. Un abonné « gagné » = un abonnement dans cette fenêtre ; un
-- contact « gagné » = une inscription email ou SMS créée dans cette fenêtre.

CREATE OR REPLACE FUNCTION public.get_event_community(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  e           record;
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_tz        text;
  v_end       timestamptz;
  v_phase     text;
  v_win_start timestamptz;
  v_win_end   timestamptz;
  v_me        text;
  v_later_cnt integer;
  v_result    jsonb;
  v_take      jsonb := '[]'::jsonb;
  v_people    integer;
  v_fresh     integer;
  v_any       integer;
  v_noemail   integer;
  v_gained    integer;
  v_days      numeric;
  v_expected  numeric;
  v_top       record;
  v_known     integer;
BEGIN
  SELECT * INTO g FROM public.event_analytics_scope(p_event_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  SELECT ev.*, COALESCE(ev.timezone, v.timezone, 'Europe/Paris') AS tz
    INTO e
    FROM public.events ev
    LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
   WHERE ev.id = p_event_id;

  v_tz := e.tz;
  v_end := COALESCE(e.end_at, e.start_at + interval '8 hours');
  v_phase := CASE WHEN v_now < e.start_at THEN 'before' WHEN v_now < v_end THEN 'live' ELSE 'after' END;
  v_me := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue:' || g.scope_venue ELSE 'org:' || g.scope_org::text END;

  -- Début de fenêtre : la première vente / inscription, sinon la publication.
  SELECT least(
           COALESCE((SELECT min(COALESCE(t.paid_at, t.created_at)) FROM public.tickets t
                      WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')), 'infinity'::timestamptz),
           COALESCE((SELECT min(COALESCE(r.paid_at, r.created_at)) FROM public.table_reservations r
                      WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')), 'infinity'::timestamptz),
           COALESCE((SELECT min(ge.created_at) FROM public.guest_list_entries ge
                       JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                      WHERE gl.event_id = p_event_id AND ge.status <> 'cancelled'), 'infinity'::timestamptz),
           COALESCE(e.published_at, e.created_at))
    INTO v_win_start;
  v_win_end := LEAST(v_end + interval '72 hours', v_now);
  IF v_win_start IS NULL OR v_win_start = 'infinity'::timestamptz THEN v_win_start := e.created_at; END IF;

  WITH
  promo AS (
    SELECT pr.id,
           CASE WHEN pr.organizer_user_id IS NOT NULL THEN 'org:' || pr.organizer_user_id
                WHEN pr.venue_id IS NOT NULL THEN 'venue:' || pr.venue_id END AS pkey
      FROM public.promoters pr
  ),
  links AS (
    SELECT tl.id,
           COALESCE((SELECT pm.pkey FROM promo pm WHERE pm.id = tl.promoter_id),
                    CASE WHEN tl.organizer_user_id IS NOT NULL THEN 'org:' || tl.organizer_user_id
                         WHEN tl.venue_id IS NOT NULL THEN 'venue:' || tl.venue_id END) AS pkey
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id
  ),
  -- ── Une ligne par venue (billet, table, inscription), avec la partie qui l'a amenée
  rows_all AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, lower(btrim(t.user_email)) AS email, t.user_id,
           COALESCE(t.paid_at, t.created_at) AS at_ts,
           greatest(COALESCE(t.quantity, 1), 1) AS heads,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0),
                     greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount,
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.ticket_id = t.id AND pm.pkey IS NOT NULL LIMIT 1)) AS pkey
      FROM public.tickets t
      LEFT JOIN links l ON l.id = t.tracked_link_id
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', lower(btrim(r.user_email)), r.user_id,
           COALESCE(r.paid_at, r.created_at),
           greatest(COALESCE(r.guest_count, 0), 1),
           greatest(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)),
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM public.promoter_conversions c JOIN promo pm ON pm.id = c.promoter_id
               WHERE c.table_reservation_id = r.id AND pm.pkey IS NOT NULL LIMIT 1))
      FROM public.table_reservations r
      LEFT JOIN links l ON l.id = r.tracked_link_id
     WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'guest_list', lower(nullif(btrim(ge.email), '')), ge.user_id, ge.created_at, 1, 0::numeric,
           COALESCE(l.pkey,
             (SELECT pm.pkey FROM promo pm WHERE pm.id = ge.promoter_id),
             (SELECT pm.pkey FROM promo pm WHERE pm.id = gl.promoter_id),
             CASE WHEN gl.organizer_user_id IS NOT NULL THEN 'org:' || gl.organizer_user_id
                  WHEN gl.venue_id IS NOT NULL THEN 'venue:' || gl.venue_id END)
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      LEFT JOIN links l ON l.id = ge.tracked_link_id
     WHERE gl.event_id = p_event_id AND ge.status <> 'cancelled'
  ),
  -- ── Les personnes (un email = une personne) ───────────────────────────────
  people AS MATERIALIZED (
    SELECT r.email,
           min(r.at_ts) AS first_at,
           (array_agg(r.user_id) FILTER (WHERE r.user_id IS NOT NULL))[1] AS user_id,
           sum(r.heads) FILTER (WHERE r.pillar <> 'guest_list') AS heads_paid,
           bool_or(r.pillar IN ('tickets', 'tables')) AS buyer,
           bool_or(r.pillar = 'guest_list') AS guest,
           COALESCE(sum(r.amount), 0) AS amount,
           (array_agg(r.pkey ORDER BY r.at_ts) FILTER (WHERE r.pkey IS NOT NULL))[1] AS pkey
      FROM rows_all r
     WHERE r.email IS NOT NULL
     GROUP BY r.email
  ),
  no_email AS (SELECT count(*) AS n FROM rows_all WHERE email IS NULL),
  scope_events AS MATERIALIZED (
    SELECT x.id, x.start_at FROM public.events x
     WHERE x.id = ANY (g.scope_ids) AND x.id <> p_event_id AND x.cancelled_at IS NULL
  ),
  -- ── Fidélité : à combien de soirées ANTÉRIEURES de la portée chacun est venu
  -- (ensembliste : on lit les soirées d'avant UNE fois, puis on les recoupe
  -- avec les personnes — jamais une recherche par personne).
  prior_ev AS MATERIALIZED (SELECT id FROM scope_events WHERE start_at < e.start_at),
  prior_rows AS MATERIALIZED (
    SELECT lower(btrim(t.user_email)) AS email, t.event_id FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM prior_ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT lower(btrim(r.user_email)), r.event_id FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM prior_ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT lower(btrim(ge.email)), gl.event_id FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM prior_ev) AND ge.status <> 'cancelled'
  ),
  prior_hits AS (
    SELECT pr.email, pr.event_id FROM prior_rows pr WHERE pr.email IN (SELECT email FROM people)
  ),
  prior_n AS (SELECT email, count(DISTINCT event_id) AS n FROM prior_hits GROUP BY email),
  -- ── Retour : venus à une soirée POSTÉRIEURE (déjà passée) de la portée ────
  later_events AS MATERIALIZED (
    SELECT id FROM scope_events WHERE start_at > v_end AND start_at < v_now
  ),
  later_rows AS MATERIALIZED (
    SELECT lower(btrim(t.user_email)) AS email FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM later_events) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT lower(btrim(r.user_email)) FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM later_events) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT lower(btrim(ge.email)) FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM later_events) AND ge.status <> 'cancelled'
  ),
  later_hits AS (
    SELECT DISTINCT lr.email FROM later_rows lr WHERE lr.email IN (SELECT email FROM people)
  ),
  -- ── Les parties de la soirée (une seule hors collab) ──────────────────────
  parties AS MATERIALIZED (
    SELECT pt.party_key, pt.kind, pt.venue_id, pt.organizer_user_id, pt.role, pt.share_crm,
           pt.display_name, pt.avatar_url, pt.ord,
           CASE WHEN pt.kind = 'venue' THEN 'venue' ELSE 'organizer' END AS subject_type,
           CASE WHEN pt.kind = 'venue' THEN pt.venue_id ELSE pt.organizer_user_id::text END AS subject_id
      FROM public.event_parties(p_event_id) pt
  ),
  -- ── Le registre de consentement de chaque partie, restreint aux personnes ─
  ns AS MATERIALIZED (
    SELECT p.party_key, lower(n.email) AS email, n.opted_in, n.created_at
      FROM parties p
      JOIN public.newsletter_subscriptions n ON n.venue_id = p.venue_id
     WHERE p.kind = 'venue' AND lower(n.email) IN (SELECT email FROM people)
    UNION ALL
    SELECT p.party_key, lower(n.email), n.opted_in, n.created_at
      FROM parties p
      JOIN public.newsletter_subscriptions n ON n.organizer_user_id = p.organizer_user_id
     WHERE p.kind = 'org' AND lower(n.email) IN (SELECT email FROM people)
  ),
  sm AS MATERIALIZED (
    SELECT p.party_key, lower(c.email) AS email, c.phone_e164, c.sms_consent_at, c.source_event_id
      FROM parties p
      JOIN public.venue_sms_contacts c ON c.venue_id = p.venue_id
     WHERE p.kind = 'venue' AND COALESCE(c.unsubscribed, false) = false
       AND (c.source_event_id = p_event_id OR lower(c.email) IN (SELECT email FROM people))
    UNION ALL
    SELECT p.party_key, lower(c.email), c.phone_e164, c.sms_consent_at, c.source_event_id
      FROM parties p
      JOIN public.venue_sms_contacts c ON c.organizer_user_id = p.organizer_user_id
     WHERE p.kind = 'org' AND COALESCE(c.unsubscribed, false) = false
       AND (c.source_event_id = p_event_id OR lower(c.email) IN (SELECT email FROM people))
  ),
  -- ── Abonnés : le journal de chaque partie, dans la fenêtre de la soirée ───
  fw AS MATERIALIZED (
    SELECT p.party_key, f.follower_user_id, f.action, f.source, f.created_at
      FROM parties p
      JOIN public.audience_follow_events f
        ON f.subject_type = p.subject_type AND f.subject_id = p.subject_id
     WHERE f.created_at >= v_win_start - interval '60 days' AND f.created_at <= v_win_end
  ),
  fw_party AS (
    SELECT p.party_key,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at >= v_win_start) AS gained,
           count(*) FILTER (WHERE f.action = 'unfollow' AND f.created_at >= v_win_start) AS lost,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at >= v_win_start AND f.source = 'event_page') AS from_event_page,
           count(DISTINCT f.follower_user_id) FILTER (
             WHERE f.action = 'follow' AND f.created_at >= v_win_start
               AND f.follower_user_id IN (SELECT user_id FROM people WHERE user_id IS NOT NULL)) AS from_attendees,
           count(*) FILTER (WHERE f.action = 'follow' AND f.created_at < v_win_start) AS before_follows
      FROM parties p LEFT JOIN fw f ON f.party_key = p.party_key
     GROUP BY p.party_key
  ),
  snap AS (
    SELECT DISTINCT ON (s.subject_type, s.subject_id) s.subject_type, s.subject_id, s.followers_total
      FROM public.audience_daily_snapshots s
     WHERE (s.subject_type, s.subject_id) IN (SELECT subject_type, subject_id FROM parties)
     ORDER BY s.subject_type, s.subject_id, s.snapshot_date DESC
  ),
  -- ── Chiffres de chaque partie ─────────────────────────────────────────────
  party_rows AS (
    SELECT p.party_key, p.display_name, p.kind, p.role, p.share_crm, p.avatar_url, p.ord,
           (SELECT count(*) FROM people x WHERE x.pkey = p.party_key) AS brought,
           (SELECT count(*) FROM people x WHERE x.pkey = p.party_key
               AND NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = x.email)) AS brought_new,
           (SELECT count(DISTINCT n.email) FROM ns n WHERE n.party_key = p.party_key AND n.opted_in) AS email_total,
           (SELECT count(DISTINCT n.email) FROM ns n
             WHERE n.party_key = p.party_key AND n.opted_in AND n.created_at >= v_win_start) AS email_gained,
           (SELECT count(DISTINCT COALESCE(s.phone_e164, s.email)) FROM sm s WHERE s.party_key = p.party_key) AS sms_total,
           (SELECT count(DISTINCT COALESCE(s.phone_e164, s.email)) FROM sm s
             WHERE s.party_key = p.party_key
               AND (s.source_event_id = p_event_id OR s.sms_consent_at >= v_win_start)) AS sms_gained,
           COALESCE(fp.gained, 0) AS followers_gained, COALESCE(fp.lost, 0) AS followers_lost,
           COALESCE(fp.from_event_page, 0) AS followers_event_page, COALESCE(fp.from_attendees, 0) AS followers_attendees,
           COALESCE(fp.before_follows, 0) AS followers_before,
           (SELECT sn.followers_total FROM snap sn WHERE sn.subject_type = p.subject_type AND sn.subject_id = p.subject_id) AS followers_total
      FROM parties p LEFT JOIN fw_party fp ON fp.party_key = p.party_key
  ),
  -- ── Joignabilité des personnes, pour la partie de l'appelant ──────────────
  me_ns AS (SELECT DISTINCT email FROM ns WHERE party_key = v_me AND opted_in),
  me_sm AS (SELECT DISTINCT email FROM sm WHERE party_key = v_me AND email IS NOT NULL),
  app AS (
    SELECT DISTINCT p.email
      FROM people p
     WHERE p.user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.user_id AND ps.platform = 'ios')
  ),
  acct AS (
    SELECT DISTINCT p.email
      FROM people p
     WHERE p.user_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.profiles pf WHERE lower(pf.email) = p.email)
  ),
  reach AS (
    SELECT count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns)) AS email_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_sm)) AS sms_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM app)) AS app,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM acct)) AS account,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns) OR p.email IN (SELECT email FROM me_sm)
                                OR p.email IN (SELECT email FROM app)) AS any_ok,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)) AS fresh,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)
                              AND p.email IN (SELECT email FROM me_ns)) AS fresh_email_ok,
           count(*) FILTER (WHERE p.buyer) AS buyers,
           count(*) FILTER (WHERE p.guest AND NOT p.buyer) AS guests_only,
           COALESCE(sum(p.heads_paid), 0) AS heads_paid,
           COALESCE(sum(p.amount), 0) AS amount
      FROM people p
  ),
  loyalty AS (
    SELECT count(*) FILTER (WHERE COALESCE(pn.n, 0) = 0) AS first_time,
           count(*) FILTER (WHERE pn.n = 1) AS second_time,
           count(*) FILTER (WHERE pn.n >= 2) AS regulars
      FROM people p LEFT JOIN prior_n pn ON pn.email = p.email
  ),
  retention AS (
    SELECT (SELECT count(*) FROM later_events) AS later_events,
           (SELECT count(*) FROM later_hits) AS returned
  ),
  -- ── Dans le temps (d = jours calendaires avant la soirée) ─────────────────
  tl_people AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (p.first_at AT TIME ZONE v_tz)::date AS d,
           count(*) AS people,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM prior_n pn WHERE pn.email = p.email)) AS fresh
      FROM people p GROUP BY 1
  ),
  tl_fw AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (f.created_at AT TIME ZONE v_tz)::date AS d, count(*) AS followers
      FROM fw f
     WHERE f.party_key = v_me AND f.action = 'follow' AND f.created_at >= v_win_start
     GROUP BY 1
  ),
  tl_ns AS (
    SELECT (e.start_at AT TIME ZONE v_tz)::date - (n.created_at AT TIME ZONE v_tz)::date AS d, count(DISTINCT n.email) AS optins
      FROM ns n
     WHERE n.party_key = v_me AND n.opted_in AND n.created_at >= v_win_start
     GROUP BY 1
  ),
  tl_days AS (
    SELECT d FROM tl_people UNION SELECT d FROM tl_fw UNION SELECT d FROM tl_ns
  ),
  timeline AS (
    SELECT t.d, COALESCE(pp.people, 0) AS people, COALESCE(pp.fresh, 0) AS fresh,
           COALESCE(ff.followers, 0) AS followers, COALESCE(nn.optins, 0) AS optins
      FROM tl_days t
      LEFT JOIN tl_people pp ON pp.d = t.d
      LEFT JOIN tl_fw ff ON ff.d = t.d
      LEFT JOIN tl_ns nn ON nn.d = t.d
     WHERE t.d BETWEEN -3 AND 120
  ),
  -- Le même flux d'abonnés, hors soirée : la moyenne quotidienne des 60 jours avant.
  baseline AS (
    SELECT count(*) FILTER (WHERE f.action = 'follow' AND f.created_at < v_win_start)::numeric / 60.0 AS per_day
      FROM fw f WHERE f.party_key = v_me
  )
  SELECT jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'me', v_me,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', v_end, 'poster', e.poster_url,
      'cancelled', e.cancelled_at IS NOT NULL, 'phase', v_phase
    ),
    'window', jsonb_build_object('from', v_win_start, 'to', v_win_end),
    'people', (SELECT jsonb_build_object(
        'total', people, 'buyers', buyers, 'guestsOnly', guests_only, 'headsPaid', heads_paid,
        'noEmail', (SELECT n FROM no_email),
        'spend', CASE WHEN g.money AND buyers > 0 THEN round(amount, 2) END
      ) FROM reach),
    'crm', (SELECT jsonb_build_object(
        'new', fresh, 'known', people - fresh,
        'emailOk', email_ok, 'smsOk', sms_ok, 'app', app, 'account', account, 'anyReach', any_ok,
        'newEmailOk', fresh_email_ok
      ) FROM reach),
    'loyalty', (SELECT jsonb_build_object('first', first_time, 'second', second_time, 'regulars', regulars) FROM loyalty),
    'retention', (SELECT CASE WHEN later_events >= 1 AND v_phase = 'after' AND v_end < v_now - interval '14 days'
                              THEN jsonb_build_object('laterEvents', later_events, 'returned', returned) END
                    FROM retention),
    'parties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'party', party_key, 'name', display_name, 'kind', kind, 'role', role, 'shareCrm', share_crm,
        'avatar', avatar_url, 'mine', party_key = v_me,
        'brought', brought, 'broughtNew', brought_new,
        'emailTotal', email_total, 'emailGained', email_gained,
        'smsTotal', sms_total, 'smsGained', sms_gained,
        'followersGained', followers_gained, 'followersLost', followers_lost,
        'followersEventPage', followers_event_page, 'followersAttendees', followers_attendees,
        'followersTotal', followers_total
      ) ORDER BY ord, party_key) FROM party_rows), '[]'::jsonb),
    'followers', (SELECT jsonb_build_object(
        'gained', followers_gained, 'lost', followers_lost, 'eventPage', followers_event_page,
        'attendees', followers_attendees, 'total', followers_total,
        'baselinePerDay', round((SELECT per_day FROM baseline), 2)
      ) FROM party_rows WHERE party_key = v_me),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'd', d, 'people', people, 'fresh', fresh, 'followers', followers, 'optins', optins) ORDER BY d DESC) FROM timeline), '[]'::jsonb)
  ) INTO v_result;

  -- ── « À retenir » : 0 à 3 constats, chacun avec son seuil de volume ────────
  -- (calculés ici, jamais au front : un constat nouveau se pose en SQL.)
  v_people  := (v_result #>> '{people,total}')::int;
  v_fresh   := (v_result #>> '{crm,new}')::int;
  v_any     := (v_result #>> '{crm,anyReach}')::int;
  v_noemail := (v_result #>> '{people,noEmail}')::int;

  IF v_people >= 10 AND v_fresh::numeric / v_people >= 0.4 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'new_contacts', 'tone', 'good', 'section', 'crm',
      'params', jsonb_build_object('n', v_fresh, 'pct', round(v_fresh::numeric / v_people * 100),
                                   'email', (v_result #>> '{crm,newEmailOk}')::int)));
  END IF;
  IF v_people >= 20 AND v_any::numeric / v_people < 0.4 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'low_reach', 'tone', 'bad', 'section', 'crm',
      'params', jsonb_build_object('pct', round(v_any::numeric / v_people * 100))));
  END IF;
  IF v_noemail >= 10 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'no_email', 'tone', 'bad', 'section', 'crm', 'params', jsonb_build_object('n', v_noemail)));
  END IF;
  IF v_result -> 'followers' IS NOT NULL AND v_result ->> 'followers' <> 'null' THEN
    v_gained := (v_result #>> '{followers,gained}')::int;
    v_days := greatest(1, round(extract(epoch FROM (v_win_end - v_win_start)) / 86400.0));
    v_expected := (v_result #>> '{followers,baselinePerDay}')::numeric * v_days;
    IF v_gained >= 5 AND v_expected >= 1 AND v_gained >= 2 * v_expected THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', 'follower_lift', 'tone', 'good', 'section', 'followers',
        'params', jsonb_build_object('n', v_gained, 'lift', round(v_gained / v_expected, 1))));
    END IF;
  END IF;
  IF v_result -> 'retention' IS NOT NULL AND v_result ->> 'retention' <> 'null' AND v_people >= 20 THEN
    v_take := v_take || jsonb_build_array(jsonb_build_object(
      'key', 'comes_back', 'tone', 'info', 'section', 'who',
      'params', jsonb_build_object('pct', round((v_result #>> '{retention,returned}')::numeric / v_people * 100))));
  END IF;
  SELECT COALESCE(sum((p ->> 'brought')::int), 0) INTO v_known FROM jsonb_array_elements(v_result -> 'parties') p;
  IF jsonb_array_length(v_result -> 'parties') > 1 AND v_known >= 20 THEN
    SELECT p ->> 'name' AS name, round((p ->> 'brought')::numeric / v_known * 100) AS pct
      INTO v_top
      FROM jsonb_array_elements(v_result -> 'parties') p
     ORDER BY (p ->> 'brought')::int DESC LIMIT 1;
    IF v_top.pct >= 50 THEN
      v_take := v_take || jsonb_build_array(jsonb_build_object(
        'key', 'partner_lead', 'tone', 'info', 'section', 'parties',
        'params', jsonb_build_object('name', v_top.name, 'pct', v_top.pct)));
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object('takeaways', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_take) x LIMIT 3) z));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_community(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_community(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
