-- Incident du 29-30/09 : Supabase ne répondait plus (PGRST002, auth à 20 s).
-- Cause : budget d'I/O disque de l'instance épuisé par deux crons.
--   * contact-engagement-sweep (toutes les 10 min) réécrivait TOUTES les
--     lignes de contact_engagement de chaque portée ayant envoyé une campagne
--     dans les 30 jours, même inchangées (updated_at = now()) : 15 Go de WAL
--     et 2,4 M blocs écrits en dix jours, ~17 s de disque par passage.
--   * chaque réécriture déclenchait le trigger d'invalidation du cache de la
--     base de contacts, que contact-base-cache-refresh (chaque minute)
--     reconstruisait en entier (DELETE + INSERT de ~12 000 lignes).
-- Correctif :
--   1. refresh_contact_engagement ne réécrit qu'une ligne qui a CHANGÉ ;
--   2. le balayage ne reprend une portée que si quelque chose a bougé depuis
--      son dernier rafraîchissement (événement email, tranche d'envoi), sinon
--      au plus toutes les 12 h (fenêtres 90/180 j) ou 24 h (fichiers importés).
-- Les deux crons ont été mis en pause pendant l'incident ; ils sont rallumés
-- ici, une fois ces deux gardes en place.

CREATE OR REPLACE FUNCTION public.refresh_contact_engagement(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        updated_at = now()
    -- Une ligne identique n'est PAS réécrite : sans cette garde, chaque
    -- passage réécrivait toute la portée (WAL, index, trigger du cache).
    WHERE (ce.user_id, ce.origin, ce.emails_sent, ce.emails_delivered, ce.opens, ce.clicks, ce.click_events,
           ce.opens_90d, ce.clicks_90d, ce.first_sent_at, ce.last_sent_at, ce.last_opened_at, ce.last_clicked_at,
           ce.bounced_at, ce.complained_at, ce.unsubscribed_at, ce.suppressed, ce.subscribed, ce.status)
          IS DISTINCT FROM
          (COALESCE(EXCLUDED.user_id, ce.user_id), EXCLUDED.origin, EXCLUDED.emails_sent, EXCLUDED.emails_delivered,
           EXCLUDED.opens, EXCLUDED.clicks, EXCLUDED.click_events, EXCLUDED.opens_90d, EXCLUDED.clicks_90d,
           EXCLUDED.first_sent_at, EXCLUDED.last_sent_at, EXCLUDED.last_opened_at, EXCLUDED.last_clicked_at,
           EXCLUDED.bounced_at, EXCLUDED.complained_at, EXCLUDED.unsubscribed_at, EXCLUDED.suppressed,
           EXCLUDED.subscribed, EXCLUDED.status);

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
$function$;

CREATE OR REPLACE FUNCTION public.contact_engagement_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_done integer := 0;
  v_err integer := 0;
BEGIN
  FOR r IN
    WITH cand AS (
      -- Un événement email (ouverture, clic, bounce…) depuis le dernier passage.
      SELECT c.venue_id, c.organizer_user_id, max(e.created_at) AS since
        FROM public.email_campaign_events e
        JOIN public.email_campaigns c ON c.id = e.campaign_id
       WHERE e.created_at > now() - interval '1 day'
       GROUP BY 1, 2
      UNION ALL
      -- Une campagne en cours d'envoi, ou une tranche partie depuis.
      SELECT c.venue_id, c.organizer_user_id,
             max(CASE WHEN c.status = 'sending' THEN now() - interval '10 minutes' ELSE c.last_slice_at END)
        FROM public.email_campaigns c
       WHERE c.status = 'sending' OR c.last_slice_at > now() - interval '1 day'
       GROUP BY 1, 2
      UNION ALL
      -- Fenêtres glissantes (90 / 180 j) : deux fois par jour suffit.
      SELECT c.venue_id, c.organizer_user_id, now() - interval '12 hours'
        FROM public.email_campaigns c
       WHERE c.status IN ('sent', 'sending', 'paused')
         AND c.sent_at > now() - interval '30 days'
       GROUP BY 1, 2
      UNION ALL
      -- Toute portée qui a importé un fichier : une fois par jour.
      SELECT li.venue_id, li.organizer_user_id, now() - interval '24 hours'
        FROM public.contact_list_imports li
       GROUP BY 1, 2
    ), due AS (
      SELECT venue_id, organizer_user_id, max(since) AS since FROM cand GROUP BY 1, 2
    )
    SELECT d.venue_id, d.organizer_user_id
      FROM due d
      LEFT JOIN public.contact_engagement_state s
        ON s.scope_key = COALESCE('v:' || d.venue_id, 'o:' || d.organizer_user_id::text, 'p')
     WHERE s.refreshed_at IS NULL OR s.refreshed_at < d.since
     ORDER BY s.refreshed_at NULLS FIRST
     LIMIT 25
  LOOP
    BEGIN
      PERFORM public.refresh_contact_engagement(r.venue_id, r.organizer_user_id);
      PERFORM public.refresh_campaign_list_impacts(r.venue_id, r.organizer_user_id);
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      RAISE WARNING 'contact_engagement_sweep(%, %): %', r.venue_id, r.organizer_user_id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('scopes', v_done, 'errors', v_err);
END;
$function$;

-- Crons rallumés (mis en pause pendant l'incident).
SELECT cron.alter_job(jobid, active := true)
  FROM cron.job
 WHERE jobname IN ('contact-engagement-sweep', 'contact-base-cache-refresh');
