-- ============================================================================
-- Base de contacts vivante : trois corrections après le premier passage en
-- prod (2026-09-15, suite de 180000 / 181000)
--
--   1. `refresh_campaign_list_impacts` : la variable de boucle `c` masquait
--      l'alias de table `c` du EXISTS d'entrée (plpgsql substitue la variable,
--      « record c is not assigned yet »). Variables préfixées.
--   2. Statuts : une adresse SUPPRIMÉE (bounce dur, plainte) passait
--      « désabonnée », parce que suppress_email coupe aussi opted_in. Un
--      bounce n'est pas un choix de la personne : « injoignable » passe
--      devant. Et le bounce dur se lit AUSSI sur le statut du destinataire
--      (la file en marque 353 là où seuls 62 événements portent le type
--      Permanent : les bounces transitoires — boîte pleine — ne rendent pas
--      une adresse injoignable).
--   3. Le rafraîchissement ne se fait plus « en ligne » dans la vue
--      d'ensemble ni dans le bilan de campagne : 4,9 s pour 12 300 contacts,
--      sous le plafond de 8 s du rôle authenticated mais sans marge. Le cron
--      (10 min) et la fin d'envoi rafraîchissent ; l'écran affiche l'heure de
--      la dernière lecture et propose « Actualiser ». Le bilan de campagne
--      ne recalcule que les photos (bien moins cher).
--   4. L'export sort en UNE passe (lignes en tableaux + en-tête de colonnes,
--      appartenance aux segments calculée dans la même requête) : la boucle
--      d'UPDATE par segment sur 12 300 lignes dépassait 8 s.
-- ============================================================================

-- ── 1+2. refresh_contact_engagement ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_contact_engagement(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
  v_n integer := 0;
  v_changed integer := 0;
  v_linked integer := 0;
  v_summary jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'refresh_contact_engagement: une seule portée à la fois';
  END IF;
  IF NOT public.contact_scope_allowed_or_internal(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.newsletter_subscriptions ns
     SET user_id = u.id
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
   WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND ns.user_id IS NULL
     AND u.deleted_at IS NULL
     AND u.email IS NOT NULL
     AND lower(u.email) = lower(ns.email);
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  DROP TABLE IF EXISTS _eng;
  CREATE TEMP TABLE _eng ON COMMIT DROP AS
  WITH camp AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
  ), rec AS (
    SELECT lower(r.email) AS em,
           count(*) FILTER (WHERE r.status IN ('sent', 'bounced', 'complained')) AS sent_n,
           min(r.sent_at) AS first_sent,
           max(r.sent_at) AS last_sent,
           max(COALESCE(r.sent_at, r.created_at)) FILTER (WHERE r.status = 'bounced') AS bounced_r,
           max(COALESCE(r.sent_at, r.created_at)) FILTER (WHERE r.status = 'complained') AS complained_r
      FROM public.email_campaign_recipients r
      JOIN camp ON camp.id = r.campaign_id
     GROUP BY lower(r.email)
  ), evt AS (
    SELECT lower(e.recipient_email) AS em,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'delivered') AS delivered_n,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'opened') AS opens_n,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'clicked') AS clicks_n,
           count(*) FILTER (WHERE e.event_type = 'clicked') AS click_events,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'opened' AND e.created_at > now() - interval '90 days') AS opens_90,
           count(DISTINCT e.campaign_id) FILTER (WHERE e.event_type = 'clicked' AND e.created_at > now() - interval '90 days') AS clicks_90,
           max(e.created_at) FILTER (WHERE e.event_type = 'opened') AS last_open,
           max(e.created_at) FILTER (WHERE e.event_type = 'clicked') AS last_click,
           max(e.created_at) FILTER (WHERE e.event_type = 'bounced'
                                       AND lower(COALESCE(e.metadata->'bounce'->>'type', '') || ' ' || COALESCE(e.metadata->'bounce'->>'subType', '')) !~ '(soft|transient|undetermined)') AS bounced_hard,
           max(e.created_at) FILTER (WHERE e.event_type = 'bounced') AS bounced_any,
           max(e.created_at) FILTER (WHERE e.event_type = 'complained') AS complained_e
      FROM public.email_campaign_events e
      JOIN camp ON camp.id = e.campaign_id
     WHERE EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                    WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))
     GROUP BY lower(e.recipient_email)
  ), subs AS (
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           bool_or(NOT ns.opted_in OR ns.opted_out_at IS NOT NULL) AS unsub,
           max(COALESCE(ns.opted_out_at, ns.updated_at)) FILTER (WHERE NOT ns.opted_in OR ns.opted_out_at IS NOT NULL) AS unsub_at,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           bool_or(ns.import_id IS NOT NULL OR COALESCE(ns.source, '') LIKE '%import%') AS from_import,
           bool_or(ns.import_id IS NULL AND COALESCE(ns.source, '') NOT LIKE '%import%') AS from_yuno
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
     GROUP BY lower(ns.email)
  ), imp AS (
    SELECT DISTINCT ic.email AS em
      FROM public.imported_contacts ic
     WHERE public.marketing_scope_match(ic.venue_id, ic.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ic.email IS NOT NULL
  ), yc AS (
    SELECT y.email AS em, y.user_id AS uid
      FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id) y
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS em FROM public.email_suppressions s
  ), universe AS (
    SELECT em FROM imp
    UNION SELECT em FROM yc
    UNION SELECT em FROM subs
    UNION SELECT em FROM rec
  ), joined AS (
    SELECT u.em,
           COALESCE(y.uid, s.uid) AS uid,
           CASE WHEN i.em IS NOT NULL AND (y.em IS NOT NULL OR COALESCE(s.from_yuno, false)) THEN 'both'
                WHEN i.em IS NOT NULL THEN 'import'
                WHEN y.em IS NOT NULL OR COALESCE(s.from_yuno, false) THEN 'yuno'
                ELSE 'campaign' END AS origin,
           COALESCE(r.sent_n, 0)::int AS emails_sent,
           COALESCE(v.delivered_n, 0)::int AS emails_delivered,
           COALESCE(v.opens_n, 0)::int AS opens,
           COALESCE(v.clicks_n, 0)::int AS clicks,
           COALESCE(v.click_events, 0)::int AS click_events,
           COALESCE(v.opens_90, 0)::int AS opens_90d,
           COALESCE(v.clicks_90, 0)::int AS clicks_90d,
           r.first_sent AS first_sent_at,
           r.last_sent AS last_sent_at,
           v.last_open AS last_opened_at,
           v.last_click AS last_clicked_at,
           -- Bounce dur : l'événement typé Permanent, sinon le statut de la
           -- file (le webhook y marque tout bounce). Un bounce transitoire
           -- seul (boîte pleine) n'est pas retenu.
           COALESCE(v.bounced_hard,
                    CASE WHEN v.bounced_any IS NULL THEN r.bounced_r END) AS bounced_at,
           COALESCE(v.complained_e, r.complained_r) AS complained_at,
           CASE WHEN COALESCE(s.unsub, false) AND NOT COALESCE(s.subscribed, false) THEN s.unsub_at END AS unsubscribed_at,
           (sp.em IS NOT NULL) AS suppressed,
           COALESCE(s.subscribed, false) AS subscribed,
           COALESCE(s.unsub, false) AND NOT COALESCE(s.subscribed, false) AS is_unsub
      FROM universe u
      LEFT JOIN imp i ON i.em = u.em
      LEFT JOIN yc y ON y.em = u.em
      LEFT JOIN subs s ON s.em = u.em
      LEFT JOIN rec r ON r.em = u.em
      LEFT JOIN evt v ON v.em = u.em
      LEFT JOIN sup sp ON sp.em = u.em
     WHERE u.em IS NOT NULL AND position('@' in u.em) > 1
  )
  SELECT j.*,
         CASE
           WHEN j.suppressed OR j.bounced_at IS NOT NULL OR j.complained_at IS NOT NULL THEN 'unreachable'
           WHEN j.is_unsub THEN 'unsubscribed'
           WHEN j.last_clicked_at > now() - interval '90 days' OR j.opens_90d >= 2 THEN 'active'
           WHEN j.last_opened_at > now() - interval '180 days' THEN 'passive'
           WHEN j.emails_sent >= 2 THEN 'silent'
           ELSE 'new'
         END AS status
    FROM joined j;

  SELECT count(*) INTO v_changed
    FROM _eng n JOIN public.contact_engagement o ON o.scope_key = v_key AND o.email = n.em
   WHERE o.status <> n.status;

  INSERT INTO public.contact_engagement AS ce
    (venue_id, organizer_user_id, email, user_id, origin, emails_sent, emails_delivered, opens, clicks, click_events,
     opens_90d, clicks_90d, first_sent_at, last_sent_at, last_opened_at, last_clicked_at, bounced_at, complained_at,
     unsubscribed_at, suppressed, subscribed, status, status_changed_at, updated_at)
  SELECT p_venue_id, p_organizer_user_id, n.em, n.uid, n.origin, n.emails_sent, n.emails_delivered, n.opens, n.clicks, n.click_events,
         n.opens_90d, n.clicks_90d, n.first_sent_at, n.last_sent_at, n.last_opened_at, n.last_clicked_at, n.bounced_at, n.complained_at,
         n.unsubscribed_at, n.suppressed, n.subscribed, n.status, now(), now()
    FROM _eng n
  ON CONFLICT (scope_key, email) DO UPDATE
    SET user_id = COALESCE(EXCLUDED.user_id, ce.user_id),
        origin = EXCLUDED.origin,
        emails_sent = EXCLUDED.emails_sent, emails_delivered = EXCLUDED.emails_delivered,
        opens = EXCLUDED.opens, clicks = EXCLUDED.clicks, click_events = EXCLUDED.click_events,
        opens_90d = EXCLUDED.opens_90d, clicks_90d = EXCLUDED.clicks_90d,
        first_sent_at = EXCLUDED.first_sent_at, last_sent_at = EXCLUDED.last_sent_at,
        last_opened_at = EXCLUDED.last_opened_at, last_clicked_at = EXCLUDED.last_clicked_at,
        bounced_at = EXCLUDED.bounced_at, complained_at = EXCLUDED.complained_at,
        unsubscribed_at = EXCLUDED.unsubscribed_at, suppressed = EXCLUDED.suppressed, subscribed = EXCLUDED.subscribed,
        status = EXCLUDED.status,
        status_changed_at = CASE WHEN ce.status = EXCLUDED.status THEN ce.status_changed_at ELSE now() END,
        updated_at = now();

  DELETE FROM public.contact_engagement ce
   WHERE ce.scope_key = v_key
     AND NOT EXISTS (SELECT 1 FROM _eng n WHERE n.em = ce.email);

  SELECT count(*),
         jsonb_build_object(
           'contacts', count(*),
           'by_status', jsonb_build_object(
             'active', count(*) FILTER (WHERE status = 'active'),
             'passive', count(*) FILTER (WHERE status = 'passive'),
             'silent', count(*) FILTER (WHERE status = 'silent'),
             'new', count(*) FILTER (WHERE status = 'new'),
             'unreachable', count(*) FILTER (WHERE status = 'unreachable'),
             'unsubscribed', count(*) FILTER (WHERE status = 'unsubscribed')),
           'by_origin', jsonb_build_object(
             'import', count(*) FILTER (WHERE origin = 'import'),
             'yuno', count(*) FILTER (WHERE origin = 'yuno'),
             'both', count(*) FILTER (WHERE origin = 'both'),
             'campaign', count(*) FILTER (WHERE origin = 'campaign')),
           'with_account', count(*) FILTER (WHERE uid IS NOT NULL),
           'status_changed', v_changed,
           'accounts_linked', v_linked)
    INTO v_n, v_summary
    FROM _eng;
  DROP TABLE IF EXISTS _eng;

  INSERT INTO public.contact_engagement_state (scope_key, venue_id, organizer_user_id, refreshed_at, duration_ms, summary)
  VALUES (v_key, p_venue_id, p_organizer_user_id, now(),
          (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int, COALESCE(v_summary, '{}'::jsonb))
  ON CONFLICT (scope_key) DO UPDATE
    SET refreshed_at = EXCLUDED.refreshed_at, duration_ms = EXCLUDED.duration_ms, summary = EXCLUDED.summary;

  RETURN COALESCE(v_summary, '{}'::jsonb) || jsonb_build_object('refreshed_at', now());
END;
$$;

-- ── 1. refresh_campaign_list_impacts (variables préfixées) ──────────────────
CREATE OR REPLACE FUNCTION public.refresh_campaign_list_impacts(p_venue_id text, p_organizer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_snap jsonb;
  v_n integer := 0;
  v_c record;
  v_now jsonb;
  v_rec_status jsonb;
  v_new_engaged integer;
  v_reactivated integer;
  v_engaged integer;
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
BEGIN
  IF NOT public.contact_scope_allowed_or_internal(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.email_campaigns ec
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ec.status = 'sent' AND ec.sent_at > now() - interval '30 days') THEN
    RETURN 0;
  END IF;

  v_snap := public.contact_base_snapshot(p_venue_id, p_organizer_user_id);

  FOR v_c IN
    SELECT ec.id, ec.sent_at, COALESCE(ec.send_started_at, ec.sent_at) AS started_at
      FROM public.email_campaigns ec
     WHERE public.marketing_scope_match(ec.venue_id, ec.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ec.status = 'sent' AND ec.sent_at > now() - interval '30 days'
  LOOP
    SELECT jsonb_build_object(
             'active', count(*) FILTER (WHERE ce.status = 'active'),
             'passive', count(*) FILTER (WHERE ce.status = 'passive'),
             'silent', count(*) FILTER (WHERE ce.status = 'silent'),
             'new', count(*) FILTER (WHERE ce.status = 'new'),
             'unreachable', count(*) FILTER (WHERE ce.status = 'unreachable'),
             'unsubscribed', count(*) FILTER (WHERE ce.status = 'unsubscribed'),
             'total', count(*))
      INTO v_rec_status
      FROM public.email_campaign_recipients r
      LEFT JOIN public.contact_engagement ce ON ce.email = lower(r.email) AND ce.scope_key = v_key
     WHERE r.campaign_id = v_c.id AND r.status IN ('sent', 'bounced', 'complained');

    SELECT count(*),
           count(*) FILTER (WHERE p.em IS NULL),
           count(*) FILTER (WHERE p.em IS NOT NULL AND p.last_prior < v_c.started_at - interval '180 days')
      INTO v_engaged, v_new_engaged, v_reactivated
      FROM (
        SELECT DISTINCT lower(e.recipient_email) AS em
          FROM public.email_campaign_events e
         WHERE e.campaign_id = v_c.id AND e.event_type IN ('opened', 'clicked')
           AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                        WHERE r.campaign_id = v_c.id AND lower(r.email) = lower(e.recipient_email))
      ) g
      LEFT JOIN (
        SELECT lower(e.recipient_email) AS em, max(e.created_at) AS last_prior
          FROM public.email_campaign_events e
          JOIN public.email_campaigns c2 ON c2.id = e.campaign_id
         WHERE public.marketing_scope_match(c2.venue_id, c2.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND c2.id <> v_c.id AND e.event_type IN ('opened', 'clicked')
           AND e.created_at < v_c.started_at
         GROUP BY lower(e.recipient_email)
      ) p ON p.em = g.em;

    v_now := v_snap || jsonb_build_object(
      'recipients', v_rec_status,
      'engaged', COALESCE(v_engaged, 0),
      'newly_engaged', COALESCE(v_new_engaged, 0),
      'reactivated', COALESCE(v_reactivated, 0));

    INSERT INTO public.email_campaign_list_impact (campaign_id, venue_id, organizer_user_id, current, computed_at)
    VALUES (v_c.id, p_venue_id, p_organizer_user_id, v_now, now())
    ON CONFLICT (campaign_id) DO UPDATE SET current = EXCLUDED.current, computed_at = EXCLUDED.computed_at;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── 3. Bilan de campagne : ne recalcule que les photos ──────────────────────
CREATE OR REPLACE FUNCTION public.get_campaign_list_impact(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_c record; v_i record; v_deltas jsonb; v_has boolean := false; v_refreshed timestamptz;
BEGIN
  SELECT id, name, subject, venue_id, organizer_user_id, sent_at, status, recipients_count, opens_count, clickers_count,
         unsubscribes_count, bounced_count, complained_count
    INTO v_c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.contact_scope_allowed(v_c.venue_id, v_c.organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_c.status <> 'sent' THEN RETURN NULL; END IF;

  SELECT * INTO v_i FROM public.email_campaign_list_impact WHERE campaign_id = p_campaign_id;
  v_has := FOUND;
  IF NOT v_has OR v_i.current IS NULL OR v_i.computed_at < now() - interval '10 minutes' THEN
    PERFORM public.refresh_campaign_list_impacts(v_c.venue_id, v_c.organizer_user_id);
    SELECT * INTO v_i FROM public.email_campaign_list_impact WHERE campaign_id = p_campaign_id;
    v_has := FOUND;
  END IF;
  IF NOT v_has THEN RETURN NULL; END IF;

  SELECT s.refreshed_at INTO v_refreshed FROM public.contact_engagement_state s
   WHERE s.scope_key = COALESCE('v:' || v_c.venue_id, 'o:' || v_c.organizer_user_id::text, 'p');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', cur->>'id', 'name', cur->>'name',
           'before', (b->>'contacts')::int, 'after', (cur->>'contacts')::int,
           'delta', (cur->>'contacts')::int - (b->>'contacts')::int,
           'emails_before', (b->>'emails')::int, 'emails_after', (cur->>'emails')::int)
           ORDER BY abs((cur->>'contacts')::int - (b->>'contacts')::int) DESC, cur->>'name'), '[]'::jsonb)
    INTO v_deltas
    FROM jsonb_array_elements(COALESCE(v_i.current->'segments', '[]'::jsonb)) cur
    JOIN jsonb_array_elements(COALESCE(v_i.baseline->'segments', '[]'::jsonb)) b ON b->>'id' = cur->>'id';

  RETURN jsonb_build_object(
    'campaign', jsonb_build_object('id', v_c.id, 'name', v_c.name, 'subject', v_c.subject, 'sent_at', v_c.sent_at,
                  'recipients', v_c.recipients_count, 'opens', v_c.opens_count, 'clickers', v_c.clickers_count,
                  'unsubscribes', v_c.unsubscribes_count, 'bounced', v_c.bounced_count, 'complained', v_c.complained_count),
    'baseline', v_i.baseline, 'baseline_at', v_i.baseline_at,
    'current', v_i.current, 'computed_at', v_i.computed_at,
    'engagement_refreshed_at', v_refreshed,
    'deltas', v_deltas);
END;
$$;

-- ── 3. La vue d'ensemble ne rafraîchit plus en ligne ────────────────────────
CREATE OR REPLACE FUNCTION public.get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_segs jsonb := '[]'::jsonb;
  v_key text := COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
  v_refreshed timestamptz;
  v_eng jsonb; v_orig jsonb; v_reach integer; v_reach_sms integer;
  r record;
  c_n integer; c_e integer; c_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT s.refreshed_at INTO v_refreshed FROM public.contact_engagement_state s WHERE s.scope_key = v_key;

  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);

  FOR r IN
    SELECT cs.* FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at DESC
  LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.definition, 'c'))
      INTO c_n, c_e, c_p;
    v_segs := v_segs || jsonb_build_object(
      'id', r.id, 'name', r.name, 'description', r.description, 'definition', r.definition,
      'origin', r.origin, 'suggestion_key', r.suggestion_key, 'created_at', r.created_at,
      'counts', jsonb_build_object('contacts', COALESCE(c_n,0), 'emails', COALESCE(c_e,0), 'phones', COALESCE(c_p,0)));
  END LOOP;

  SELECT jsonb_build_object(
           'active', count(*) FILTER (WHERE eng_status = 'active'),
           'passive', count(*) FILTER (WHERE eng_status = 'passive'),
           'silent', count(*) FILTER (WHERE eng_status = 'silent'),
           'new', count(*) FILTER (WHERE eng_status = 'new'),
           'unreachable', count(*) FILTER (WHERE eng_status = 'unreachable'),
           'unsubscribed', count(*) FILTER (WHERE eng_status = 'unsubscribed'),
           'sent_any', count(*) FILTER (WHERE emails_sent > 0)),
         jsonb_build_object(
           'import', count(*) FILTER (WHERE origin = 'import'),
           'yuno', count(*) FILTER (WHERE origin = 'yuno'),
           'both', count(*) FILTER (WHERE origin = 'both'),
           'with_account', count(*) FILTER (WHERE has_account)),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok)
    INTO v_eng, v_orig, v_reach, v_reach_sms
    FROM _cr;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'lists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', li.id, 'list_name', li.list_name, 'filename', li.filename, 'created_at', li.created_at,
                 'row_count', li.row_count, 'email_count', li.email_count, 'phone_count', li.phone_count,
                 'both_count', li.both_count, 'analyzed_at', li.analyzed_at,
                 'email_import_id', li.email_import_id, 'sms_import_id', li.sms_import_id,
                 'detected_columns', li.detected_columns) ORDER BY li.created_at DESC)
               FROM public.contact_list_imports li
              WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)), '[]'::jsonb),
    'segments', v_segs,
    'contacts', v_n,
    'reachable_emails', COALESCE(v_reach, 0),
    'reachable_phones', COALESCE(v_reach_sms, 0),
    'engagement', v_eng,
    'origin', v_orig,
    'refreshed_at', v_refreshed,
    'impacts', COALESCE((
      SELECT jsonb_agg(x.obj ORDER BY x.sent_at DESC) FROM (
        SELECT ec.sent_at, jsonb_build_object(
                 'campaign_id', i.campaign_id, 'name', ec.name, 'subject', ec.subject, 'sent_at', ec.sent_at,
                 'recipients', ec.recipients_count, 'opens', ec.opens_count, 'clickers', ec.clickers_count,
                 'unsubscribes', ec.unsubscribes_count, 'bounced', ec.bounced_count, 'complained', ec.complained_count,
                 'baseline', i.baseline, 'baseline_at', i.baseline_at, 'current', i.current, 'computed_at', i.computed_at) AS obj
          FROM public.email_campaign_list_impact i
          JOIN public.email_campaigns ec ON ec.id = i.campaign_id
         WHERE public.marketing_scope_match(i.venue_id, i.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND ec.status = 'sent' AND ec.sent_at > now() - interval '60 days'
         ORDER BY ec.sent_at DESC LIMIT 6) x), '[]'::jsonb),
    'analysis', (SELECT li.analysis FROM public.contact_list_imports li
                  WHERE li.analysis IS NOT NULL
                    AND (public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id))
                  ORDER BY li.analyzed_at DESC LIMIT 1)
  );
END;
$$;

-- ── 4. L'export en une passe : {columns, rows[][]} ──────────────────────────
CREATE OR REPLACE FUNCTION public.export_contact_base(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_seg_expr text := 'NULL::text';
  v_parts text[] := '{}';
  v_rows jsonb;
  v_cols jsonb := '["email","phone","first_name","last_name","origin","has_account","email_ok","phone_ok","status","emails_sent","opens","clicks","last_opened_at","last_clicked_at","unsubscribed_at","bounced","total_spent","event_count","last_purchase_at","imported_spent","imported_events","yuno_spent","yuno_events","ticket_count","table_count","order_count","guest_list_count","first_seen_at","last_seen_at","country_code","region","city","postal_code","zone","age","gender","list","segments"]'::jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'export_contact_base: une seule portée à la fois';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Export indisponible en session support';
  END IF;

  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);

  FOR r IN
    SELECT cs.name, cs.definition FROM public.contact_segments cs
     WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY cs.created_at
  LOOP
    v_parts := v_parts || format('CASE WHEN %s THEN %L END', public.contact_definition_predicate(r.definition, 'c'), r.name);
  END LOOP;
  IF array_length(v_parts, 1) IS NOT NULL THEN
    v_seg_expr := format('array_to_string(ARRAY[%s]::text[], '' ; '')', array_to_string(v_parts, ', '));
  END IF;

  EXECUTE format($q$
    SELECT COALESCE(jsonb_agg(jsonb_build_array(
             c.email, c.phone_e164, c.first_name, c.last_name, c.origin, c.has_account, c.email_ok, c.phone_ok,
             c.eng_status, c.emails_sent, c.opens, c.clicks, c.last_opened_at, c.last_clicked_at, c.unsubscribed_at, c.bounced,
             c.total_spent, c.event_count, c.last_purchase_at, c.imported_spent, c.imported_events, c.yuno_spent, c.yuno_events,
             c.ticket_count, c.table_count, c.order_count, c.guest_list_count, COALESCE(c.added_at, c.yuno_first_at), c.last_seen_at,
             c.country_code, c.region, c.city, c.postal_code, c.zone, c.age, c.gender,
             li.list_name, %s
           ) ORDER BY c.last_seen_at DESC NULLS LAST, c.email), '[]'::jsonb)
      FROM _cr c
      LEFT JOIN public.contact_list_imports li ON li.id = c.list_import_id
  $q$, v_seg_expr) INTO v_rows;
  DROP TABLE IF EXISTS _cr;
  RETURN jsonb_build_object('columns', v_cols, 'rows', v_rows);
END;
$$;

-- Le bon état, tout de suite.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT venue_id, organizer_user_id FROM (
      SELECT li.venue_id, li.organizer_user_id FROM public.contact_list_imports li
      UNION
      SELECT c.venue_id, c.organizer_user_id FROM public.email_campaigns c WHERE c.status = 'sent'
    ) s
  LOOP
    BEGIN
      PERFORM public.refresh_contact_engagement(r.venue_id, r.organizer_user_id);
      PERFORM public.refresh_campaign_list_impacts(r.venue_id, r.organizer_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact engagement backfill (%, %): %', r.venue_id, r.organizer_user_id, SQLERRM;
    END;
  END LOOP;
END $$;
