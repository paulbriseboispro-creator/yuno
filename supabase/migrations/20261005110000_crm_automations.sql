-- ============================================================================
-- Yuno CRM — Automatisations (/crm/automations) : « Que font vos
-- automatisations sans vous ? ».
--
-- Un compte CRM a six recettes (CRM_AUTOMATION_KINDS) : annonce d'une
-- soirée, dernier appel, merci, on vous a manqué, l'habitué qui décroche,
-- reconquête. Une recette = un e-mail, monté par le moteur existant
-- (collect_email_automations) en campagnes enfants. Cette migration ajoute :
-- * _email_automation_preview : le corps de preview_email_automation, sans
--   sa garde « titulaire seul », pour que l'écran CRM d'un éditeur ou d'un
--   lecteur dise aussi qui serait concerné. preview_email_automation garde sa
--   garde et appelle ce corps.
-- * crm_automations : tout l'écran en une lecture (recettes et leurs
--   résultats, ventes par semaine rattachées à un clic sous 7 jours, totaux
--   comparés, derniers envois, suggestions du moteur). Montants sous la clé
--   revenue, masqués par _crm_money_gate.
-- * crm_automation_save : allumer, couper, régler le délai, l'objet et le
--   modèle d'une recette, pour tout rôle qui écrit (la RLS de
--   email_automations ne laisse que le titulaire).
-- ============================================================================

-- Corps repris de la base liée (pg_get_functiondef, 04/10), garde retirée.
CREATE OR REPLACE FUNCTION public._email_automation_preview(p_venue_id text, p_organizer_user_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD;
  v_delay interval;
  v_threshold integer;
  v_enabled_at timestamptz;
  v_eligible integer := 0;
  v_base integer := 0;
  v_event_id uuid;
  v_event_title text;
  v_due timestamptz;
  v_start timestamptz;
  v_pub timestamptz;
  v_next uuid;
BEGIN
  IF (p_venue_id IS NULL AND p_organizer_user_id IS NULL) OR p_kind IS NULL THEN
    RETURN jsonb_build_object('eligible', 0, 'base', 0, 'next_event_id', NULL, 'next_event_title', NULL, 'next_due_at', NULL);
  END IF;

  SELECT x.* INTO a FROM public.email_automations x
   WHERE x.kind = p_kind
     AND ((p_venue_id IS NOT NULL AND x.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND x.organizer_user_id = p_organizer_user_id))
   LIMIT 1;
  v_delay := make_interval(hours => COALESCE(a.delay_hours, CASE p_kind
    WHEN 'abandoned_checkout' THEN 2 WHEN 'last_call' THEN 24 WHEN 'post_event_thanks' THEN 12
    WHEN 'post_event_missed' THEN 24 WHEN 'welcome' THEN 24 WHEN 'win_back' THEN 2160
    WHEN 'table_upsell' THEN 72 WHEN 'new_event' THEN 6 WHEN 'regular_lapse' THEN 1008 ELSE 24 END));
  v_threshold := COALESCE(a.threshold_pct, 85);
  v_enabled_at := COALESCE(a.enabled_at, now());
  v_next := public._email_automation_next_event(p_venue_id, p_organizer_user_id);

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  IF p_kind IN ('last_call', 'new_event') THEN
    SELECT e.id, e.title, e.start_at, e.published_at INTO v_event_id, v_event_title, v_start, v_pub
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours'
       AND (p_kind = 'last_call' OR (
             (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
             AND e.published_at IS NOT NULL AND e.start_at > now() + interval '48 hours'))
       AND (
         ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
         OR (e.tables_enabled AND NOT e.tables_sold_out)
         OR (NOT e.guest_list_sold_out AND EXISTS (
               SELECT 1 FROM public.guest_lists gl
                WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
       )
     ORDER BY (CASE WHEN p_kind = 'new_event' THEN e.published_at END) DESC NULLS LAST, e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := CASE WHEN p_kind = 'last_call' THEN v_start - v_delay ELSE v_pub + v_delay END;
      SELECT count(*) INTO v_eligible
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND NOT public._email_event_holder(v_event_id, s.email)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(s.email)));
    ELSE
      v_eligible := CASE WHEN p_kind = 'new_event' THEN v_base ELSE 0 END;
    END IF;

  ELSIF p_kind = 'table_upsell' THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_event_title, v_start
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := v_start - v_delay;
      SELECT count(DISTINCT lower(t.user_email)) INTO v_eligible
        FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r
                          WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email)
                            AND r.status IN ('paid', 'used', 'confirmed', 'pending'))
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = lower(t.user_email) AND s.opted_in AND s.opted_out_at IS NULL
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(t.user_email)));
    END IF;

  ELSIF p_kind = 'tier_closing' THEN
    SELECT e.id, e.title INTO v_event_id, v_event_title
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * v_threshold
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds n
                    WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                      AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO v_eligible FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c
          JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id
                OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i
      WHERE NOT public._email_event_holder(v_event_id, i.em)
        AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                     WHERE lower(s.email) = i.em AND s.opted_in AND s.opted_out_at IS NULL
                       AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
        AND (a.id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.email_automation_sends l
           WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = i.em));
    END IF;

  ELSIF p_kind = 'abandoned_checkout' THEN
    WITH pend AS (
      SELECT DISTINCT ON (lower(x.em), x.event_id) lower(x.em) AS em, x.event_id, x.created_at
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at
            FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND t.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at
            FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND r.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
        ) x
       ORDER BY lower(x.em), x.event_id, x.created_at DESC
    ),
    open AS (
      SELECT p.* FROM pend p
       WHERE NOT public._email_event_holder(p.event_id, p.em)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em))
    )
    SELECT count(*),
           min(o.created_at + v_delay) FILTER (WHERE o.created_at + v_delay > now()),
           (SELECT o2.event_id FROM open o2 WHERE o2.created_at + v_delay > now() ORDER BY o2.created_at LIMIT 1)
      INTO v_eligible, v_due, v_event_id
      FROM open o;
    IF v_event_id IS NOT NULL THEN
      SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
    END IF;

  ELSIF p_kind = 'welcome' THEN
    SELECT count(*), min(s.created_at + v_delay) FILTER (WHERE s.created_at + v_delay > now())
      INTO v_eligible, v_due
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%'
       AND COALESCE(s.source, '') NOT LIKE 'platform%'
       AND COALESCE(s.source, '') NOT LIKE 'checkout%'
       AND COALESCE(s.source, '') NOT LIKE 'connector%'
       AND s.created_at >= LEAST(v_enabled_at, now())
       AND s.created_at >= now() - interval '14 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email)));
    v_event_id := v_next;

  ELSIF p_kind IN ('post_event_thanks', 'post_event_missed') THEN
    -- Éligibles = la dernière soirée finie et scannée (5 j) ; prochain départ
    -- = la fin de la prochaine soirée + délai.
    SELECT e.id INTO v_event_id
      FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at <= now() AND e.end_at >= now() - interval '5 days'
       AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
         OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
         OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')))
     ORDER BY e.end_at DESC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      WITH came AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND ge.entry_scanned
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      holders AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      pop AS (
        SELECT em FROM came WHERE p_kind = 'post_event_thanks'
        UNION ALL
        SELECT h.em FROM holders h WHERE p_kind = 'post_event_missed' AND NOT EXISTS (SELECT 1 FROM came c WHERE c.em = h.em)
      )
      SELECT count(*) INTO v_eligible
        FROM pop
       WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = pop.em AND s.opted_in AND s.opted_out_at IS NULL
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = pop.em));
    END IF;
    SELECT e.id, e.title, e.end_at + v_delay INTO v_event_id, v_event_title, v_due
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now()
     ORDER BY e.start_at ASC
     LIMIT 1;

  ELSIF p_kind = 'win_back' THEN
    SELECT count(*) INTO v_eligible
      FROM public.newsletter_subscriptions s
      JOIN LATERAL (
        SELECT max(x.at) AS last_at FROM (
          SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT ge.entry_scanned_at FROM public.guest_list_entries ge
            JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
           WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
           WHERE lower(xt.buyer_email) = lower(s.email) AND xt.status IN ('valid', 'transferred')
             AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
        ) x
      ) act ON true
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - v_delay
       AND act.last_at > now() - v_delay - interval '120 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
            AND l.created_at > now() - interval '180 days'));
    v_event_id := v_next;

  ELSIF p_kind = 'regular_lapse' THEN
    -- Même porte que le moteur. La soirée affichée est celle que Yuno a
    -- choisie pour le plus récent d'entre eux (chacun reçoit la sienne).
    SELECT count(*), (array_agg(r.pick_event_id ORDER BY r.last_at DESC) FILTER (WHERE r.pick_event_id IS NOT NULL))[1]
      INTO v_eligible, v_event_id
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, v_delay) r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = r.em
            AND l.created_at > now() - interval '120 days'));
    v_event_id := COALESCE(v_event_id, v_next);
  END IF;

  IF v_event_id IS NOT NULL AND v_event_title IS NULL THEN
    SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'eligible', COALESCE(v_eligible, 0),
    'base', COALESCE(v_base, 0),
    'next_event_id', v_event_id,
    'next_event_title', v_event_title,
    'next_due_at', CASE WHEN v_due > now() THEN v_due END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._email_automation_preview(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_automation_preview(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.preview_email_automation(p_venue_id text, p_organizer_user_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  RETURN public._email_automation_preview(p_venue_id, p_organizer_user_id, p_kind);
END;
$function$;
REVOKE ALL ON FUNCTION public.preview_email_automation(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_email_automation(text, uuid, text) TO authenticated, service_role;

-- L'écran : recettes, résultats, semaines, totaux, derniers envois.
CREATE OR REPLACE FUNCTION public.crm_automations__core(
  p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_n int := CASE WHEN p_period = '90d' THEN 13 ELSE 5 END;
  v_now timestamptz := now();
  v_from timestamptz;
  v_pfrom timestamptz;
  v_kinds text[] := ARRAY['new_event', 'last_call', 'post_event_thanks', 'post_event_missed', 'regular_lapse', 'win_back'];
  v_recipes jsonb; v_weeks jsonb; v_tot jsonb; v_prev jsonb; v_feed jsonb; v_sug jsonb;
  v_limit jsonb; v_base int; v_active int;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_now - make_interval(days => v_n * 7);
  v_pfrom := v_from - make_interval(days => v_n * 7);

  -- Clics et achats rattachés (règle des résultats d'e-mail : billet acheté
  -- sous 7 jours après un clic, rattaché au dernier clic).
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _xa;
  CREATE TEMP TABLE _xa ON COMMIT DROP AS
  SELECT a.* FROM public.email_automations a
   WHERE a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND a.kind = ANY (v_kinds);

  -- Campagnes enfants des recettes.
  DROP TABLE IF EXISTS _xc;
  CREATE TEMP TABLE _xc ON COMMIT DROP AS
  SELECT c.id, a.kind, c.subject FROM public.email_campaigns c JOIN _xa a ON a.id = c.automation_id;

  DROP TABLE IF EXISTS _xr;
  CREATE TEMP TABLE _xr ON COMMIT DROP AS
  SELECT r.campaign_id, c.kind, lower(r.email) AS email, r.sent_at, r.first_name, r.last_name
    FROM public.email_campaign_recipients r JOIN _xc c ON c.id = r.campaign_id
   WHERE r.status IN ('sent', 'complained') AND r.sent_at IS NOT NULL;
  CREATE INDEX ON _xr (kind, sent_at);

  DROP TABLE IF EXISTS _xk;
  CREATE TEMP TABLE _xk ON COMMIT DROP AS
  SELECT k.campaign_id, c.kind, k.email, k.at FROM _cmk k JOIN _xc c ON c.id = k.campaign_id;

  DROP TABLE IF EXISTS _xb;
  CREATE TEMP TABLE _xb ON COMMIT DROP AS
  SELECT m.id, m.email, m.amount, m.bought_at, c.kind FROM _cma m JOIN _xc c ON c.id = m.campaign_id;

  SELECT jsonb_agg(jsonb_build_object(
           'kind', k.kind, 'id', a.id, 'enabled', COALESCE(a.enabled, false), 'enabled_at', a.enabled_at,
           'updated_at', a.updated_at, 'delay_hours', a.delay_hours, 'subject', a.subject, 'template_id', a.template_id,
           'template_name', tpl.name, 'template_subject', tpl.subject,
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_from),
           'sent', (SELECT count(*) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.kind = k.kind AND x.at >= v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.kind = k.kind AND b.bought_at >= v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.kind = k.kind AND b.bought_at >= v_from),
           'all', jsonb_build_object(
             'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.kind = k.kind),
             'purchases', (SELECT count(*) FROM _xb b WHERE b.kind = k.kind),
             'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.kind = k.kind)),
           -- Envois des 13 dernières semaines (la plus ancienne d'abord).
           'weekly', (SELECT jsonb_agg((SELECT count(*) FROM _xr r WHERE r.kind = k.kind
                                         AND r.sent_at >= v_now - make_interval(days => (13 - g) * 7)
                                         AND r.sent_at < v_now - make_interval(days => (12 - g) * 7)) ORDER BY g)
                        FROM generate_series(0, 12) g),
           -- Rythme d'envoi des 4 dernières semaines : ce qu'elle consomme.
           'week_avg', (SELECT round(count(*) / 4.0, 1) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_now - interval '28 days'),
           'last_sent_at', (SELECT max(r.sent_at) FROM _xr r WHERE r.kind = k.kind),
           'pending', CASE WHEN a.id IS NULL THEN 0 ELSE
             (SELECT count(*) FROM public.email_automation_sends l WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL)
             + (SELECT count(*) FROM public.email_campaign_recipients q JOIN _xc c ON c.id = q.campaign_id WHERE c.kind = k.kind AND q.status = 'pending') END,
           'skipped', CASE WHEN a.id IS NULL THEN 0 ELSE
             (SELECT count(*) FROM public.email_automation_sends l WHERE l.automation_id = a.id AND l.status = 'skipped' AND l.created_at >= v_from) END,
           'preview', public._email_automation_preview(p_venue_id, p_organizer_user_id, k.kind)
         ) ORDER BY k.ord)
    INTO v_recipes
    FROM unnest(v_kinds) WITH ORDINALITY k(kind, ord)
    LEFT JOIN _xa a ON a.kind = k.kind
    LEFT JOIN public.email_campaign_templates tpl ON tpl.id = a.template_id;

  -- Une case par semaine, la plus ancienne d'abord (la dernière est en cours).
  SELECT jsonb_agg(jsonb_build_object(
           'start', v_now - make_interval(days => (v_n - g) * 7),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b
                        WHERE b.bought_at >= v_now - make_interval(days => (v_n - g) * 7)
                          AND b.bought_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'purchases', (SELECT count(*) FROM _xb b
                          WHERE b.bought_at >= v_now - make_interval(days => (v_n - g) * 7)
                            AND b.bought_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'sent', (SELECT count(*) FROM _xr r
                     WHERE r.sent_at >= v_now - make_interval(days => (v_n - g) * 7)
                       AND r.sent_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r
                          WHERE r.sent_at >= v_now - make_interval(days => (v_n - g) * 7)
                            AND r.sent_at < v_now - make_interval(days => (v_n - g - 1) * 7))
         ) ORDER BY g)
    INTO v_weeks FROM generate_series(0, v_n - 1) g;

  SELECT jsonb_build_object(
           'sent', (SELECT count(*) FROM _xr r WHERE r.sent_at >= v_from),
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.sent_at >= v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.at >= v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.bought_at >= v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.bought_at >= v_from),
           'recipes', (SELECT count(DISTINCT r.kind) FROM _xr r WHERE r.sent_at >= v_from))
    INTO v_tot;
  SELECT jsonb_build_object(
           'sent', (SELECT count(*) FROM _xr r WHERE r.sent_at >= v_pfrom AND r.sent_at < v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.at >= v_pfrom AND x.at < v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.bought_at >= v_pfrom AND b.bought_at < v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.bought_at >= v_pfrom AND b.bought_at < v_from))
    INTO v_prev;

  -- Les derniers envois : prénom et initiale seulement.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'first_name', NULLIF(trim(f.first_name), ''),
           'last_initial', upper(left(NULLIF(trim(f.last_name), ''), 1)),
           'kind', f.kind, 'subject', f.subject, 'at', f.sent_at) ORDER BY f.sent_at DESC), '[]'::jsonb)
    INTO v_feed
    FROM (SELECT r.first_name, r.last_name, r.kind, r.sent_at, c.subject
            FROM _xr r JOIN _xc c ON c.id = r.campaign_id
           ORDER BY r.sent_at DESC LIMIT 8) f;

  -- Ce que le moteur propose d'allumer (recettes éteintes, faits des 30 j).
  SELECT COALESCE(jsonb_agg(s.value) FILTER (WHERE s.value->>'kind' = ANY (v_kinds)), '[]'::jsonb)
    INTO v_sug
    FROM jsonb_array_elements(public._email_automation_suggestions(p_venue_id, p_organizer_user_id)) s;

  v_limit := public.crm_scope_limits(public.crm_scope_key(p_venue_id, p_organizer_user_id))->'automations';
  SELECT count(*) INTO v_active FROM _xa WHERE enabled;
  SELECT count(*) INTO v_base FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  RETURN jsonb_build_object(
    'period', CASE WHEN p_period = '90d' THEN '90d' ELSE '30d' END, 'weeks_n', v_n, 'from', v_from, 'now', v_now,
    'recipes', COALESCE(v_recipes, '[]'::jsonb), 'weeks', COALESCE(v_weeks, '[]'::jsonb),
    'totals', v_tot, 'prev', v_prev, 'feed', v_feed, 'suggestions', v_sug,
    'limit', CASE WHEN v_limit IS NULL OR v_limit = 'null'::jsonb THEN NULL ELSE v_limit END, 'active', v_active, 'base', v_base,
    'has_connection', EXISTS (SELECT 1 FROM public.ticketing_connections tc
                               WHERE (p_venue_id IS NOT NULL AND tc.venue_id = p_venue_id)
                                  OR (p_organizer_user_id IS NOT NULL AND tc.organizer_user_id = p_organizer_user_id))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.crm_automations__core(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_automations__core(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_automations(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_period text DEFAULT '30d'
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._crm_money_gate(public.crm_automations__core(p_venue_id, p_organizer_user_id, p_period),
                                p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.crm_automations(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_automations(text, uuid, text) TO authenticated, service_role;

-- Écrire une recette : rôle qui écrit (titulaire, admin, éditeur, gérant).
-- p_subject NULL garde l'objet, '' l'efface (l'objet du modèle reprend).
-- Une recette allumée sans modèle n'enverrait rien : refusé.
CREATE OR REPLACE FUNCTION public.crm_automation_save(
  p_venue_id text, p_organizer_user_id uuid, p_kind text,
  p_enabled boolean DEFAULT NULL, p_delay_hours integer DEFAULT NULL,
  p_subject text DEFAULT NULL, p_template_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.email_automations%ROWTYPE;
  v_allowed int[];
  v_default int;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Les délais proposés par l'écran (AUTOMATION_META, en heures).
  CASE p_kind
    WHEN 'new_event' THEN v_allowed := ARRAY[2, 6, 24]; v_default := 6;
    WHEN 'last_call' THEN v_allowed := ARRAY[12, 24, 48, 72]; v_default := 24;
    WHEN 'post_event_thanks' THEN v_allowed := ARRAY[6, 12, 24, 48]; v_default := 12;
    WHEN 'post_event_missed' THEN v_allowed := ARRAY[12, 24, 48, 72]; v_default := 24;
    WHEN 'regular_lapse' THEN v_allowed := ARRAY[672, 1008, 1344]; v_default := 1008;
    WHEN 'win_back' THEN v_allowed := ARRAY[1080, 1440, 2160, 2880]; v_default := 2160;
    ELSE RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023';
  END CASE;
  IF p_delay_hours IS NOT NULL AND NOT (p_delay_hours = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'bad_delay' USING ERRCODE = '22023';
  END IF;
  IF p_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.email_campaign_templates t
     WHERE t.id = p_template_id
       AND t.venue_id IS NOT DISTINCT FROM p_venue_id AND t.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ) THEN
    RAISE EXCEPTION 'bad_template' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.email_automations a
   WHERE a.kind = p_kind
     AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    INSERT INTO public.email_automations (venue_id, organizer_user_id, kind, enabled, delay_hours, subject, template_id, created_by)
    VALUES (p_venue_id, p_organizer_user_id, p_kind, false, COALESCE(p_delay_hours, v_default),
            NULLIF(trim(p_subject), ''), p_template_id, auth.uid())
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.email_automations a
     SET delay_hours = COALESCE(p_delay_hours, a.delay_hours),
         subject = CASE WHEN p_subject IS NULL THEN a.subject ELSE NULLIF(trim(p_subject), '') END,
         template_id = COALESCE(p_template_id, a.template_id),
         enabled = COALESCE(p_enabled, a.enabled)
   WHERE a.id = v_row.id
  RETURNING * INTO v_row;
  IF v_row.enabled AND v_row.template_id IS NULL THEN
    RAISE EXCEPTION 'template_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN to_jsonb(v_row) - 'created_by';
END;
$$;
REVOKE ALL ON FUNCTION public.crm_automation_save(text, uuid, text, boolean, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_automation_save(text, uuid, text, boolean, integer, text, uuid) TO authenticated, service_role;

-- Les automatisations se calculent dans des tables temporaires : elles
-- rejoignent les lectures autorisées en aperçu démo (corps repris de la base liée).
CREATE OR REPLACE FUNCTION public.demo_preview_writable_rpc(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(coalesce(p_name, '')) = ANY (ARRAY[
    -- CTA « Activer mon compte » des sessions vitrine (seul canal d'écriture voulu)
    'request_showcase_claim',
    -- mesure d'audience / live view (battements, vues, clics)
    'ping_live_visitor', 'platform_heartbeat', 'track_platform_view',
    'track_links_event', 'ping_affiliate_live', 'flush_affiliate_session',
    'track_guest_artist_click',
    -- parcours client consultable depuis la démo (anti-flood, déverrouillage)
    'check_promo_code', 'unlock_event_sale', 'open_discovery_selection',
    -- écrans de lecture dont le calcul passe par une table temporaire / un cache
    'list_contact_base', 'count_contact_segment_def', 'analyze_contact_lists',
    'check_contact_import', 'get_contact_intelligence_overview',
    'get_contact_segment_panel', 'get_campaign_list_impact',
    'get_dj_audience', 'get_tracked_link_stats', 'get_user_nightlife_stats',
    'seed_event_tracked_links', 'seed_guest_list_tracked_links',
    'seed_venue_tracked_links', 'demo_is_live',
    -- composition d'un email (20260927162000) : rien de tout ça n'envoie
    'save_contact_segments', 'bump_email_template_usage',
    'refresh_contact_engagement', 'refresh_campaign_list_impacts',
    -- Console Yuno CRM : lectures calculées dans des tables temporaires
    'crm_home', 'crm_clients_overview', 'crm_clients_list', 'crm_client',
    'crm_audience_count', 'crm_audience_counts', 'crm_segments_brief',
    'crm_segments_overview', 'crm_segment_detail', 'crm_import_check',
    'crm_email_overview', 'crm_email_campaigns', 'crm_email_analysis',
    'crm_email_result', 'crm_email_result_segments', 'crm_email_recipients',
    'crm_email_recipient_emails', 'crm_email_send_options',
    'crm_email_audience_preview', 'crm_email_audience_sizes',
    'crm_night_detail', 'crm_rules_preview',
    'crm_ana_sales', 'crm_ana_traffic', 'crm_ana_community',
    'crm_journey', 'crm_automations'
  ]::text[]);
$function$;
