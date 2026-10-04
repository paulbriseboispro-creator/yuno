-- ============================================================================
-- Console CRM — les chiffres des e-mails sans reconstruire toute la base.
-- _crm_email_attrib ne prépare que ce dont un envoi a besoin : les campagnes
-- envoyées de la portée (_cmc), leurs clics (_cmk) et les billets attribués
-- (_cma, dernier clic dans les 7 jours avant l'achat) — mêmes définitions que
-- _crm_msg_build, sans les réceptions par personne ni les SMS, qui exigent la
-- base clients (_cp). _crm_email_stats et crm_email_recipients s'en servent :
-- la liste des campagnes et la vue d'ensemble ne paient plus la base entière.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._crm_email_attrib(p_venue_id text, p_organizer_user_id uuid)
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

  DROP TABLE IF EXISTS _cmk;
  CREATE TEMP TABLE _cmk ON COMMIT DROP AS
    SELECT ev.campaign_id, lower(ev.recipient_email) AS email, ev.created_at AS at,
           public._crm_is_ticketing_link(ev.metadata->'click'->>'link', v_hosts) AS ticketing
      FROM public.email_campaign_events ev
      JOIN _cmc c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL;
  CREATE INDEX ON _cmk (campaign_id, email);
  CREATE INDEX ON _cmk (email, at);

  DROP TABLE IF EXISTS _cma;
  CREATE TEMP TABLE _cma ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id) t.id, t.email, t.amount, t.bought_at, k.campaign_id
      FROM public._crm_tickets(p_venue_id, p_organizer_user_id) t
      JOIN _cmk k ON k.email = t.email AND k.at <= t.bought_at AND k.at > t.bought_at - interval '7 days'
     ORDER BY t.id, k.at DESC;
  CREATE INDEX ON _cma (campaign_id, email);
  SELECT count(*) INTO v_n FROM _cma;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_email_attrib(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_email_attrib(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_email_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ces;
  CREATE TEMP TABLE _ces ON COMMIT DROP AS
  SELECT ec.id, ec.name, ec.subject, ec.sent_at, ec.audiences_json, ec.template_kind, ec.event_id,
         r.n, r.bounced, r.complained, GREATEST(r.n - r.bounced, 0) AS received,
         COALESCE(o.opened, 0) AS opened,
         COALESCE(k.clicked, 0) AS clicked, COALESCE(k.ticketing, 0) AS ticketing,
         COALESCE(b.purchases, 0) AS purchases, COALESCE(b.revenue, 0) AS revenue,
         COALESCE(ec.unsubscribes_count, 0) AS unsub
    FROM public.email_campaigns ec
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE rr.status IN ('sent', 'complained', 'bounced')) AS n,
             count(*) FILTER (WHERE rr.status = 'bounced') AS bounced,
             count(*) FILTER (WHERE rr.status = 'complained') AS complained
        FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id
    ) r
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT lower(e.recipient_email)) AS opened FROM public.email_campaign_events e
       WHERE e.campaign_id = ec.id AND e.event_type = 'opened'
    ) o ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT kk.email) AS clicked, count(DISTINCT kk.email) FILTER (WHERE kk.ticketing) AS ticketing
        FROM _cmk kk WHERE kk.campaign_id = ec.id
    ) k ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS purchases, COALESCE(sum(aa.amount), 0) AS revenue FROM _cma aa WHERE aa.campaign_id = ec.id
    ) b ON true
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id
     AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
     AND ec.sent_at >= p_from AND ec.sent_at < p_to;
  SELECT count(*) INTO v_n FROM _ces;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_email_recipients(
  p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid,
  p_filter text DEFAULT 'all', p_q text DEFAULT NULL, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer; v jsonb; v_sent timestamptz;
  v_q text := NULLIF(lower(btrim(COALESCE(p_q, ''))), '');
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT c.sent_at INTO v_sent FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _crr;
  CREATE TEMP TABLE _crr ON COMMIT DROP AS
  SELECT lower(r.email) AS email, COALESCE(r.first_name, p.first_name) AS first_name, COALESCE(r.last_name, p.last_name) AS last_name,
         r.status, p.lifecycle,
         EXISTS (SELECT 1 FROM public.email_campaign_events e WHERE e.campaign_id = r.campaign_id AND e.event_type = 'opened' AND lower(e.recipient_email) = lower(r.email)) AS opened,
         EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = r.campaign_id AND k.email = lower(r.email)) AS clicked,
         COALESCE((SELECT sum(a.amount) FROM _cma a WHERE a.campaign_id = r.campaign_id AND a.email = lower(r.email)), 0) AS revenue
    FROM public.email_campaign_recipients r
    LEFT JOIN _cp p ON p.email = lower(r.email)
   WHERE r.campaign_id = p_campaign_id AND r.status IN ('sent', 'complained', 'bounced');

  SELECT count(*) INTO v_total FROM _crr x
   WHERE (p_filter = 'all' OR (p_filter = 'opened' AND x.opened) OR (p_filter = 'clicked' AND x.clicked)
       OR (p_filter = 'bought' AND x.revenue > 0) OR (p_filter = 'unopened' AND NOT x.opened AND x.status = 'sent')
       OR (p_filter = 'bounced' AND x.status = 'bounced'))
     AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('email', email, 'first_name', first_name, 'last_name', last_name, 'status', status,
           'lifecycle', lifecycle, 'opened', opened, 'clicked', clicked, 'revenue', round(revenue, 2))), '[]'::jsonb)
    INTO v FROM (
      SELECT * FROM _crr x
       WHERE (p_filter = 'all' OR (p_filter = 'opened' AND x.opened) OR (p_filter = 'clicked' AND x.clicked)
           OR (p_filter = 'bought' AND x.revenue > 0) OR (p_filter = 'unopened' AND NOT x.opened AND x.status = 'sent')
           OR (p_filter = 'bounced' AND x.status = 'bounced'))
         AND (v_q IS NULL OR x.email LIKE '%' || v_q || '%' OR lower(COALESCE(x.first_name, '') || ' ' || COALESCE(x.last_name, '')) LIKE '%' || v_q || '%')
       ORDER BY x.revenue DESC, x.clicked DESC, x.opened DESC, x.email
       LIMIT 50 OFFSET GREATEST(p_offset, 0)) z;
  RETURN jsonb_build_object('total', v_total, 'rows', v,
    'counts', (SELECT jsonb_build_object('all', count(*), 'opened', count(*) FILTER (WHERE opened), 'clicked', count(*) FILTER (WHERE clicked),
                 'bought', count(*) FILTER (WHERE revenue > 0), 'unopened', count(*) FILTER (WHERE NOT opened AND status = 'sent'),
                 'bounced', count(*) FILTER (WHERE status = 'bounced')) FROM _crr));
END;
$$;
