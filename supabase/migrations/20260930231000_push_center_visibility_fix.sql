-- get_push_center : events.visibility est un ENUM (event_visibility). NULLIF(e.visibility, '')
-- castait '' en enum et faisait tomber toute la fonction au plan (22P02, vu par db lint
-- juste après l'application de 20260930230000). Même corps, seule la lecture de la
-- visibilité change (cast en text).

CREATE OR REPLACE FUNCTION public.get_push_center(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid       uuid := auth.uid();
  v_money     boolean := false;
  v_party     text;
  v_event_ids uuid[];
  v_days      integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 120);
  v_from      timestamptz;
  v_result    jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  v_from := now() - make_interval(days => v_days);

  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT (v_uid = p_organizer_user_id OR public.is_super_admin()
            OR public.is_org_team_member(v_uid, p_organizer_user_id, 'admin')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := v_uid = p_organizer_user_id OR public.is_super_admin()
      OR public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    v_party := 'org:' || p_organizer_user_id::text;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
        OR e.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id));
  ELSIF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR public.is_venue_owner(v_uid, p_venue_id)
            OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                        WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                          AND (COALESCE(mp.can_manage_crm, false) OR COALESCE(mp.can_view_analytics, false)))) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                  WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                    AND (COALESCE(mp.can_view_analytics, false) OR COALESCE(mp.can_view_finance, false)));
    v_party := 'venue:' || p_venue_id;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
        OR e.id IN (SELECT public.cohost_event_ids_venue(p_venue_id));
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  WITH
  ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, COALESCE(e.poster_url, e.image_url) AS image, e.published_at,
           COALESCE(e.visibility::text, 'public') AS visibility
      FROM public.events e
     WHERE e.id = ANY (v_event_ids) AND e.cancelled_at IS NULL
       AND e.start_at >= v_from AND e.start_at < now() + interval '180 days'
  ),
  camp AS MATERIALIZED (
    SELECT pc.id, pc.event_id, pc.created_at, COALESCE(pc.sent_count, 0) AS sent_count,
           CASE pc.template_key
             WHEN 'almost_sold_out' THEN 'last_tickets' WHEN 'thank_you' THEN 'after_thanks'
             WHEN 'reminder_day_of' THEN 'event_day_reminder' WHEN 'drinks_preorder' THEN 'event_day_reminder'
             WHEN 'event_live' THEN 'doors_open' ELSE pc.template_key END AS rule
      FROM public.push_campaigns pc
     WHERE pc.source = 'auto' AND pc.event_id IN (SELECT ev.id FROM ev)
  ),
  recv AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'sent' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  taps AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'clicked' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  sales AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.id, t.user_id, t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
           GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - LEAST(GREATEST(COALESCE(t.refund_amount, 0), 0),
                     GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t
     WHERE t.event_id IN (SELECT ev.id FROM ev) AND t.status IN ('paid', 'used') AND t.user_id IS NOT NULL
    UNION ALL
    SELECT 'tables', r.id, r.user_id, r.event_id, COALESCE(r.paid_at, r.created_at),
           GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0),
                     GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT ev.id FROM ev) AND r.status IN ('paid', 'confirmed') AND r.user_id IS NOT NULL
    UNION ALL
    SELECT 'guestlist', g.id, g.user_id, gl.event_id, g.created_at, 0
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id IN (SELECT ev.id FROM ev) AND g.status <> 'cancelled' AND g.user_id IS NOT NULL
  ),
  touch AS MATERIALIZED (
    SELECT DISTINCT ON (s.pillar, s.id) s.pillar, s.id AS sale_id, s.user_id, s.event_id, s.amount,
           c.rule, tp.campaign_id
      FROM sales s
      JOIN taps tp ON tp.user_id = s.user_id
      JOIN camp c ON c.id = tp.campaign_id AND c.event_id = s.event_id
     WHERE s.at >= tp.at AND s.at < tp.at + interval '72 hours'
     ORDER BY s.pillar, s.id, tp.at DESC
  ),
  infl AS MATERIALIZED (
    SELECT DISTINCT rv.campaign_id, rv.user_id
      FROM recv rv
      JOIN camp c ON c.id = rv.campaign_id
      JOIN sales s ON s.user_id = rv.user_id AND s.event_id = c.event_id AND s.pillar <> 'guestlist'
     WHERE s.at >= rv.at AND s.at < rv.at + interval '72 hours'
  ),
  cand AS MATERIALIZED (
    SELECT c.rule_key, c.event_id, c.status, COALESCE(c.hold_reason, '') AS hold, c.reason_party,
           c.user_id, c.campaign_id, c.not_before
      FROM public.push_candidates c
     WHERE c.event_id IN (SELECT ev.id FROM ev)
  ),
  per_camp AS MATERIALIZED (
    SELECT c.id, c.event_id, c.rule, c.created_at, c.sent_count,
           (SELECT count(*) FROM taps t WHERE t.campaign_id = c.id) AS taps,
           (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.campaign_id = c.id AND t.pillar <> 'guestlist') AS buyers,
           (SELECT count(*) FROM touch t WHERE t.campaign_id = c.id AND t.pillar = 'guestlist') AS entries,
           (SELECT COALESCE(sum(t.amount), 0) FROM touch t WHERE t.campaign_id = c.id) AS revenue,
           (SELECT count(*) FROM infl i WHERE i.campaign_id = c.id) AS influenced
      FROM camp c
  ),
  steps AS MATERIALIZED (
    SELECT k.event_id, k.rule,
           COALESCE(sum(pc.sent_count), 0) AS sent,
           COALESCE(sum(pc.taps), 0) AS taps,
           COALESCE(sum(pc.buyers), 0) AS buyers,
           COALESCE(sum(pc.entries), 0) AS entries,
           COALESCE(sum(pc.revenue), 0) AS revenue,
           COALESCE(sum(pc.influenced), 0) AS influenced,
           max(pc.created_at) AS last_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('pending', 'claimed')) AS queued,
           (SELECT min(x.not_before) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status = 'pending') AS next_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('skipped', 'expired')
               AND x.hold IN ('daily_cap', 'weekly_cap', 'fatigue', 'quiet_hours', 'event_budget',
                                  'lower_priority', 'awaiting_announcement', 'window_passed')) AS held,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.hold = 'already_bought') AS bought_before
      FROM (SELECT DISTINCT camp.event_id, camp.rule FROM camp
            UNION SELECT DISTINCT cand.event_id, cand.rule_key FROM cand) k
      LEFT JOIN per_camp pc ON pc.event_id = k.event_id AND pc.rule = k.rule
     GROUP BY k.event_id, k.rule
  ),
  mine AS MATERIALIZED (
    SELECT x.user_id, x.campaign_id FROM cand x WHERE x.status = 'sent' AND x.reason_party = v_party
  ),
  disc AS (
    SELECT count(*) AS selections, count(DISTINCT ds.user_id) AS people,
           count(*) FILTER (WHERE ds.opened_at IS NOT NULL) AS opened
      FROM public.discovery_selections ds
     WHERE ds.created_at >= v_from AND ds.event_ids && v_event_ids
  ),
  evj AS (
    SELECT e.*, ps.announce_at,
           (SELECT count(*) FROM public.event_parties(e.id)) AS parties,
           EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0) AS announced,
           (e.start_at > now() + interval '3 hours'
            AND e.visibility = 'public'
            AND NOT EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0)
            AND (public.is_super_admin() OR EXISTS (
                  SELECT 1 FROM public.event_parties(e.id) p
                   WHERE p.role IN ('lead', 'partner') AND public.coorg_party_level(v_uid, p.party_key) >= 2))) AS can_schedule
      FROM ev e
      LEFT JOIN public.push_event_settings ps ON ps.event_id = e.id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'money', v_money,
    'days', v_days,
    'party', v_party,
    'summary', jsonb_build_object(
      'sent',       (SELECT COALESCE(sum(pc.sent_count), 0) FROM per_camp pc),
      'people',     (SELECT count(DISTINCT rv.user_id) FROM recv rv),
      'taps',       (SELECT count(*) FROM taps),
      'buyers',     (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.pillar <> 'guestlist'),
      'entries',    (SELECT count(*) FROM touch t WHERE t.pillar = 'guestlist'),
      'influenced', (SELECT count(DISTINCT i.user_id) FROM infl i),
      'revenue',    CASE WHEN v_money THEN round((SELECT COALESCE(sum(t.amount), 0) FROM touch t)::numeric, 2) END,
      'held',       (SELECT COALESCE(sum(st.held), 0) FROM steps st),
      'boughtBefore', (SELECT COALESCE(sum(st.bought_before), 0) FROM steps st),
      'queued',     (SELECT COALESCE(sum(st.queued), 0) FROM steps st)
    ),
    'viaMe', jsonb_build_object(
      'multiParty', EXISTS (SELECT 1 FROM evj WHERE evj.parties > 1),
      'sent',  (SELECT count(*) FROM mine),
      'taps',  (SELECT count(*) FROM mine m JOIN taps t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id),
      'buyers', (SELECT count(DISTINCT m.user_id) FROM mine m
                   JOIN touch t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id AND t.pillar <> 'guestlist')
    ),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', s.notification_key, 'enabled', s.enabled, 'params', s.params,
               'sent',    (SELECT COALESCE(sum(st.sent), 0) FROM steps st WHERE st.rule = s.notification_key),
               'taps',    (SELECT COALESCE(sum(st.taps), 0) FROM steps st WHERE st.rule = s.notification_key),
               'buyers',  (SELECT COALESCE(sum(st.buyers), 0) FROM steps st WHERE st.rule = s.notification_key),
               'revenue', CASE WHEN v_money THEN round((SELECT COALESCE(sum(st.revenue), 0) FROM steps st WHERE st.rule = s.notification_key)::numeric, 2) END,
               'held',    (SELECT COALESCE(sum(st.held), 0) FROM steps st WHERE st.rule = s.notification_key),
               'queued',  (SELECT COALESCE(sum(st.queued), 0) FROM steps st WHERE st.rule = s.notification_key)
             ) ORDER BY s.notification_key)
        FROM public.platform_notification_settings s WHERE s.category = 'event_engine'
    ), '[]'::jsonb),
    'discovery', (SELECT jsonb_build_object('selections', d.selections, 'people', d.people, 'opened', d.opened) FROM disc d),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'startAt', e.start_at, 'image', e.image,
               'publishedAt', e.published_at, 'visibility', e.visibility,
               'upcoming', e.start_at > now(),
               'announceAt', e.announce_at, 'announced', e.announced,
               'canSchedule', e.can_schedule, 'parties', e.parties,
               'steps', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'rule', st.rule, 'sent', st.sent, 'taps', st.taps, 'buyers', st.buyers,
                          'entries', st.entries, 'influenced', st.influenced,
                          'revenue', CASE WHEN v_money THEN round(st.revenue::numeric, 2) END,
                          'queued', st.queued, 'nextAt', st.next_at, 'held', st.held,
                          'boughtBefore', st.bought_before, 'lastAt', st.last_at))
                   FROM steps st WHERE st.event_id = e.id), '[]'::jsonb)
             ) ORDER BY (e.start_at < now()), CASE WHEN e.start_at >= now() THEN e.start_at END ASC, e.start_at DESC)
        FROM (SELECT * FROM evj
               ORDER BY (evj.start_at < now()), CASE WHEN evj.start_at >= now() THEN evj.start_at END ASC, evj.start_at DESC
               LIMIT 30) e
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
