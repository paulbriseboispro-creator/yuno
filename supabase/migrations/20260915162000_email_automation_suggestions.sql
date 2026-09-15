-- ─────────────────────────────────────────────────────────────────────────────
-- Automatisations email v2 — « Yuno te propose d'allumer… »
--
-- Des suggestions calculées sur des FAITS des 30 derniers jours, démo exclue,
-- seulement pour les recettes éteintes : paniers abandonnés sans relance,
-- soirée proche avec une base sans billet, tables libres et billets vendus,
-- soirée publiée sans aucun email, soirées scannées sans merci, clients
-- silencieux, nouvelles inscriptions sans bienvenue, palier presque plein.
--
-- Trois surfaces : la page Automatisations (bandeau), la page Campagnes
-- (carte), et une notification in-app UNE fois par recette et par mois
-- (dedup_key). Jamais de push.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Les notifications organisateur apprennent la dédup ───────────────────
-- staff_notifications l'a depuis 20260728170300 ; organizer_notifications n'en
-- avait pas — une suggestion mensuelle sans dédup se répéterait chaque matin.
ALTER TABLE public.organizer_notifications ADD COLUMN IF NOT EXISTS dedup_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizer_notifications_dedup
  ON public.organizer_notifications (dedup_key) WHERE dedup_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.emit_organizer_notification(
  p_organizer_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_priority text DEFAULT 'normal',
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_dedup_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.organizer_notifications
    (organizer_user_id, notification_type, title, message, priority, reference_type, reference_id, event_id, metadata, dedup_key)
  VALUES
    (p_organizer_user_id, p_type, p_title, p_message, COALESCE(p_priority, 'normal'),
     p_reference_type, p_reference_id, p_event_id, COALESCE(p_metadata, '{}'::jsonb), p_dedup_key)
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.emit_organizer_notification(uuid, text, text, text, text, text, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── 2. Une recette est-elle allumée dans la portée ? ────────────────────────
CREATE OR REPLACE FUNCTION public._email_automation_enabled(p_venue_id text, p_organizer_user_id uuid, p_kind text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.email_automations a
     WHERE a.kind = p_kind AND a.enabled
       AND ((p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id))
  );
$$;
REVOKE ALL ON FUNCTION public._email_automation_enabled(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._email_automation_enabled(text, uuid, text) TO service_role, authenticated;

-- ── 3. Les suggestions (interne, sans garde : le balayage et la RPC l'appellent) ──
CREATE OR REPLACE FUNCTION public._email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  out jsonb := '[]'::jsonb;
  v_base integer := 0;
  n integer;
  v_event_id uuid;
  v_title text;
  v_start timestamptz;
  v_pct integer;
BEGIN
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN RETURN out; END IF;
  -- La démo n'est pas un chiffre.
  IF p_venue_id IS NOT NULL AND p_venue_id = ANY (public.demo_venue_ids()) THEN RETURN out; END IF;
  IF p_organizer_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = p_organizer_user_id AND public.is_demo_email(p.email)
  ) THEN RETURN out; END IF;

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  -- Panier abandonné : ≥ 3 paiements commencés et jamais finis sur 30 j.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'abandoned_checkout') THEN
    SELECT count(*) INTO n FROM (
      SELECT DISTINCT lower(x.em), x.event_id FROM (
        SELECT t.user_email AS em, t.event_id FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE t.status = 'pending' AND t.user_email IS NOT NULL AND t.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT r.user_email, r.event_id FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE r.status = 'pending' AND r.user_email IS NOT NULL AND r.created_at >= now() - interval '30 days'
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
      ) x
      WHERE NOT public._email_event_holder(x.event_id, x.em)
    ) y;
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'abandoned_checkout', 'reason_key', 'em.auto.sug.abandoned',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Dernier appel : prochaine soirée sous 10 j qui vend encore, base ≥ 50.
  IF v_base >= 50 AND NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'last_call') THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_title, v_start
      FROM public.events e
     WHERE e.status = 'active' AND e.is_active AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours' AND e.start_at <= now() + interval '10 days'
       AND ((e.ticketing_enabled AND NOT e.tickets_sold_out) OR (e.tables_enabled AND NOT e.tables_sold_out)
            OR (NOT e.guest_list_sold_out AND EXISTS (SELECT 1 FROM public.guest_lists gl WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out)))
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO n FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL AND NOT public._email_event_holder(v_event_id, s.email);
      out := out || jsonb_build_object('kind', 'last_call', 'reason_key', 'em.auto.sug.lastCall',
               'reason_vars', jsonb_build_object('event', v_title, 'd', GREATEST(0, floor(extract(epoch FROM (v_start - now())) / 86400))::integer, 'n', n),
               'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Passe en table : prochaine soirée avec tables libres et ≥ 20 billets vendus.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'table_upsell') THEN
    v_event_id := NULL;
    SELECT e.id, e.title INTO v_event_id, v_title
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND e.is_active AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
       AND (SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t WHERE t.event_id = e.id AND t.status IN ('paid', 'used')) >= 20
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(DISTINCT lower(t.user_email)) INTO n FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email) AND r.status IN ('paid', 'used', 'confirmed', 'pending'));
      out := out || jsonb_build_object('kind', 'table_upsell', 'reason_key', 'em.auto.sug.tableUpsell',
               'reason_vars', jsonb_build_object('event', v_title, 'n', n), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Nouvelle soirée : ≥ 1 soirée publiée sur 30 j sans aucune campagne reliée.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'new_event') THEN
    SELECT count(*) INTO n FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.published_at >= now() - interval '30 days'
       AND NOT EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.event_id = e.id
                         AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 1 THEN
      out := out || jsonb_build_object('kind', 'new_event', 'reason_key', 'em.auto.sug.newEvent',
               'reason_vars', jsonb_build_object('n', n), 'reach', v_base);
    END IF;
  END IF;

  -- Merci / On t'a manqué : ≥ 1 soirée passée avec scans sur 30 j.
  SELECT count(*) INTO n FROM public.events e
   WHERE e.status = 'active' AND e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
     AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
       OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
       OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)));
  IF n >= 1 THEN
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_thanks') THEN
      out := out || jsonb_build_object('kind', 'post_event_thanks', 'reason_key', 'em.auto.sug.thanks',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT em) FROM (
                   SELECT lower(t.user_email) AS em FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                    WHERE (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)) AND t.user_email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                   UNION
                   SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
                    WHERE ge.entry_scanned AND ge.email IS NOT NULL
                      AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                      AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
                 ) c));
    END IF;
    IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'post_event_missed') THEN
      out := out || jsonb_build_object('kind', 'post_event_missed', 'reason_key', 'em.auto.sug.missed',
               'reason_vars', jsonb_build_object('n', n), 'reach', (
                 SELECT count(DISTINCT lower(t.user_email)) FROM public.tickets t JOIN public.events e ON e.id = t.event_id
                  WHERE t.status = 'paid' AND NOT t.used AND NOT COALESCE(t.entry_scanned, false) AND t.user_email IS NOT NULL
                    AND e.end_at <= now() AND e.end_at >= now() - interval '30 days'
                    AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))));
    END IF;
  END IF;

  -- Reconquête : ≥ 30 clients silencieux depuis 60 j (dernière venue entre 60 et 240 j).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'win_back') THEN
    SELECT count(*) INTO n
      FROM public.newsletter_subscriptions s
      JOIN LATERAL (
        SELECT max(x.at) AS last_at FROM (
          SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT ge.entry_scanned_at FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
           WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        ) x
      ) act ON true
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - interval '60 days'
       AND act.last_at > now() - interval '240 days';
    IF n >= 30 THEN
      out := out || jsonb_build_object('kind', 'win_back', 'reason_key', 'em.auto.sug.winBack',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Bienvenue : ≥ 10 nouvelles inscriptions sur 30 j (hors imports, checkout, plateforme).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'welcome') THEN
    SELECT count(*) INTO n FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%' AND COALESCE(s.source, '') NOT LIKE 'platform%' AND COALESCE(s.source, '') NOT LIKE 'checkout%'
       AND s.created_at >= now() - interval '30 days';
    IF n >= 10 THEN
      out := out || jsonb_build_object('kind', 'welcome', 'reason_key', 'em.auto.sug.welcome',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Le tarif monte : une soirée en paliers dont le palier ouvert dépasse 70 %, avec un palier plus cher ensuite.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'tier_closing') THEN
    v_event_id := NULL;
    SELECT e.id, e.title, cur.pct INTO v_event_id, v_title, v_pct
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price, (r.tickets_sold * 100 / r.max_tickets)::integer AS pct
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * 70
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND e.is_active AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds nx WHERE nx.event_id = e.id AND nx.position > cur.position AND nx.price > cur.price AND NOT nx.manually_sold_out AND nx.tickets_sold < nx.max_tickets)
     ORDER BY e.start_at LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO n FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i WHERE NOT public._email_event_holder(v_event_id, i.em);
      out := out || jsonb_build_object('kind', 'tier_closing', 'reason_key', 'em.auto.sug.tier',
               'reason_vars', jsonb_build_object('event', v_title, 'p', v_pct), 'reach', n, 'event_id', v_event_id);
    END IF;
  END IF;

  -- Les plus larges d'abord.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'reach')::integer DESC), '[]'::jsonb) INTO out
    FROM jsonb_array_elements(out) x;
  RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public._email_automation_suggestions(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._email_automation_suggestions(text, uuid) TO service_role;

-- La RPC de l'écran : même calcul, derrière la garde de portée.
CREATE OR REPLACE FUNCTION public.get_email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  RETURN public._email_automation_suggestions(p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_automation_suggestions(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_automation_suggestions(text, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_email_automation_suggestions(text, uuid) IS
  'Recettes éteintes que les faits des 30 derniers jours justifient d''allumer : {kind, reason_key, reason_vars, reach, event_id?}. Démo exclue.';

-- ── 4. La notification mensuelle (cron quotidien, dédup par recette et par mois) ──
CREATE OR REPLACE FUNCTION public._email_automation_suggestion_text(p_item jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_item->>'reason_key'
    WHEN 'em.auto.sug.abandoned'   THEN format('%s paniers abandonnés ce mois, personne ne les a relancés.', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.lastCall'    THEN format('%s dans %s jours, %s contacts sans billet.', p_item->'reason_vars'->>'event', p_item->'reason_vars'->>'d', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.tableUpsell' THEN format('%s : %s billets vendus et des tables encore libres.', p_item->'reason_vars'->>'event', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.newEvent'    THEN format('%s soirée(s) publiée(s) ce mois sans aucun email d''annonce.', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.thanks'      THEN format('%s soirée(s) scannée(s) ce mois : un merci peut partir tout seul.', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.missed'      THEN format('%s soirée(s) scannée(s) ce mois : les absents peuvent être relancés.', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.winBack'     THEN format('%s clients silencieux depuis 60 jours.', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.welcome'     THEN format('%s nouvelles inscriptions ce mois, sans mot de bienvenue.', p_item->'reason_vars'->>'n')
    WHEN 'em.auto.sug.tier'        THEN format('%s : le palier ouvert est à %s %%.', p_item->'reason_vars'->>'event', p_item->'reason_vars'->>'p')
    ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION public._email_automation_kind_label(p_kind text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'abandoned_checkout' THEN 'Panier abandonné'
    WHEN 'last_call'          THEN 'Dernier appel'
    WHEN 'table_upsell'       THEN 'Passe en table'
    WHEN 'new_event'          THEN 'Nouvelle soirée'
    WHEN 'post_event_thanks'  THEN 'Merci d''être venu'
    WHEN 'post_event_missed'  THEN 'On t''a manqué'
    WHEN 'win_back'           THEN 'Reconquête'
    WHEN 'welcome'            THEN 'Bienvenue'
    WHEN 'tier_closing'       THEN 'Le tarif monte'
    ELSE p_kind END;
$$;

CREATE OR REPLACE FUNCTION public.email_automation_suggestions_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  o RECORD;
  item jsonb;
  v_month text := to_char(now(), 'YYYY-MM');
  v_scopes integer := 0;
  v_emitted integer := 0;
  v_id uuid;
BEGIN
  -- Clubs : un propriétaire, pas démo, pas décommissionné, une base opt-in.
  FOR v IN
    SELECT ve.id
      FROM public.venues ve
     WHERE ve.owner_id IS NOT NULL AND ve.decommissioned_at IS NULL AND NOT COALESCE(ve.is_hidden, false)
       AND NOT (ve.id = ANY (public.demo_venue_ids()))
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s WHERE s.venue_id = ve.id AND s.opted_in AND s.opted_out_at IS NULL)
  LOOP
    v_scopes := v_scopes + 1;
    FOR item IN SELECT * FROM jsonb_array_elements(public._email_automation_suggestions(v.id, NULL)) LOOP
      v_id := public.emit_staff_notification(
        p_venue_id => v.id, p_target_role => 'owner', p_type => 'automation_suggested',
        p_title => 'Yuno te propose d''allumer : ' || public._email_automation_kind_label(item->>'kind'),
        p_message => public._email_automation_suggestion_text(item),
        p_priority => 'low', p_reference_type => 'email_automation', p_reference_id => NULL,
        p_event_id => NULLIF(item->>'event_id', '')::uuid, p_metadata => item,
        p_dedup_key => 'auto_sug:v:' || v.id || ':' || (item->>'kind') || ':' || v_month);
      IF v_id IS NOT NULL THEN v_emitted := v_emitted + 1; END IF;
    END LOOP;
  END LOOP;

  -- Organisateurs : une soirée sur 60 j, pas démo, une base opt-in.
  FOR o IN
    SELECT DISTINCT e.organizer_user_id AS id
      FROM public.events e
      JOIN public.profiles p ON p.id = e.organizer_user_id
     WHERE e.organizer_user_id IS NOT NULL AND e.start_at > now() - interval '60 days'
       AND NOT public.is_demo_email(p.email)
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s WHERE s.organizer_user_id = e.organizer_user_id AND s.opted_in AND s.opted_out_at IS NULL)
  LOOP
    v_scopes := v_scopes + 1;
    FOR item IN SELECT * FROM jsonb_array_elements(public._email_automation_suggestions(NULL, o.id)) LOOP
      v_id := public.emit_organizer_notification(
        p_organizer_user_id => o.id, p_type => 'automation_suggested',
        p_title => 'Yuno te propose d''allumer : ' || public._email_automation_kind_label(item->>'kind'),
        p_message => public._email_automation_suggestion_text(item),
        p_priority => 'low', p_reference_type => 'email_automation', p_reference_id => NULL,
        p_event_id => NULLIF(item->>'event_id', '')::uuid, p_metadata => item,
        p_dedup_key => 'auto_sug:o:' || o.id::text || ':' || (item->>'kind') || ':' || v_month);
      IF v_id IS NOT NULL THEN v_emitted := v_emitted + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('scopes', v_scopes, 'emitted', v_emitted);
END;
$$;
REVOKE ALL ON FUNCTION public.email_automation_suggestions_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_automation_suggestions_sweep() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'email-automation-suggestions';
    PERFORM cron.schedule('email-automation-suggestions', '15 8 * * *', 'SELECT public.email_automation_suggestions_sweep();');
  END IF;
END $$;
