-- Suggestions d'automatisations : « Reconquête » calculée en une passe.
--
-- _email_automation_suggestions (écran Automatisations du CRM et de la
-- Billetterie, balayage quotidien des suggestions) cherchait la dernière
-- venue de CHAQUE abonné par une sous-requête LATERAL. Mesuré le 15/10 en
-- prod (transaction annulée, compte d'un organisateur réel de 14 500 abonnés
-- + ~32 000 billets Shotgun simulés, machine Micro) : le planificateur
-- relisait tous les billets du compte pour chaque abonné (~38 000 pages par
-- personne), plus de 2 minutes ; crm_automations ne s'ouvrait plus.
-- Dernière venue calculée une fois par adresse, puis jointure : même règle.

CREATE OR REPLACE FUNCTION public._email_automation_suggestions(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours' AND e.start_at <= now() + interval '10 days'
       AND (((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out) OR (e.tables_enabled AND NOT e.tables_sold_out)
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
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
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
       OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')));
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
                   UNION
                   SELECT lower(xt.buyer_email) FROM public.external_tickets xt JOIN public.events e ON e.id = xt.event_id
                    WHERE xt.scanned_at IS NOT NULL AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
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

  -- L'habitué décroche : ≥ 3 habitués (deux sorties par mois) silencieux
  -- depuis six semaines, que personne n'a encore relancés.
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'regular_lapse') THEN
    SELECT count(*) INTO n
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, interval '42 days') r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id));
    IF n >= 3 THEN
      out := out || jsonb_build_object('kind', 'regular_lapse', 'reason_key', 'em.auto.sug.regularLapse',
               'reason_vars', jsonb_build_object('n', n), 'reach', n);
    END IF;
  END IF;

  -- Reconquête : ≥ 30 clients silencieux depuis 60 j (dernière venue entre 60 et 240 j).
  IF NOT public._email_automation_enabled(p_venue_id, p_organizer_user_id, 'win_back') THEN
    -- Dernière venue calculée UNE fois par adresse (20261016240000) : la
    -- version par abonné (LATERAL) relisait tous les billets Shotgun du
    -- compte pour chacun — plus de 2 minutes sur un compte de 30 000
    -- billets, et l'écran Automatisations ne s'ouvrait plus. Même règle.
    WITH act AS (
      SELECT x.em, max(x.at) AS last_at FROM (
        SELECT lower(t.user_email) AS em, t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
         WHERE t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT lower(r.user_email), r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
         WHERE r.status IN ('paid', 'used') AND r.user_email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT lower(ge.email), ge.entry_scanned_at FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
         WHERE ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL AND ge.email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        UNION ALL
        SELECT lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
         WHERE xt.status IN ('valid', 'transferred') AND xt.buyer_email IS NOT NULL
           AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
      ) x
      GROUP BY x.em
    )
    SELECT count(*) INTO n
      FROM public.newsletter_subscriptions s
      JOIN act ON act.em = lower(s.email)
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
       AND COALESCE(s.source, '') NOT LIKE 'import%' AND COALESCE(s.source, '') NOT LIKE 'platform%' AND COALESCE(s.source, '') NOT LIKE 'checkout%' AND COALESCE(s.source, '') NOT LIKE 'connector%'
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
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
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
$function$;
