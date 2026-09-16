-- ───────────────────────────────────────────────────────────────────────────
-- Emailing : ce que la plaquette promet, tenu par le code (2026-09-16).
--
-- « Il connaît votre inventaire » et « La segmentation intelligente » (PDF
-- envoyé aux organisateurs) ont été confrontés au code. Trois trous côté base :
--
-- 1. Le vocabulaire des segments contacts (contact_definition_predicate) ne
--    savait pas dire « a déjà pris une table » ni « vu il y a moins de N
--    jours » alors que la base vivante (contact_rows, 20260915180000) porte
--    table_count / ticket_count / order_count / last_seen_at depuis le 15/09.
--    Ajouts : tables · tickets · orders {op,value} · last_seen_days {op,value}.
--    Même contrat : condition inconnue ⇒ FAUX, valeurs par %L. Au passage,
--    un bug présent depuis 20260908220000 : `parts := parts || 'false'`
--    (littéral non typé, lu comme text[]) levait 22P02 sur toute condition
--    inconnue ou valeur non numérique — la résolution PLANTAIT au lieu de
--    rendre FAUX. `array_append` partout où le littéral était nu.
--
-- 2. Les audiences intégrées d'un ORGANISATEUR (VIP, gros dépensiers,
--    réguliers, nouveaux, dormants) ne lisaient que `tickets` : un organisateur
--    qui vend des tables ou remplit une guest list n'avait ni VIP ni habitué.
--    resolve_campaign_audience passe sur contact_scope_customers (billets +
--    tables + guest list, la source de la base de contacts), et
--    count_organizer_audience_kinds rend les effectifs en UN appel (la RPC
--    count_campaign_recipients est venue-scopée : l'écran Audience d'un
--    organisateur n'affichait aucun chiffre).
--
-- 3. Les règles de visibilité par bloc n'avaient pas de complément : « le bloc
--    Table VIP pour ceux qui en ont pris une, le bloc Liste invités pour les
--    autres » était impossible. get_recipient_block_conds émet aussi
--    no_vip_table et no_buyers — le complément EXACT sur le lot demandé.
--
-- Réécritures à partir de l'état LIVE (pg_get_functiondef), jamais d'un ancien
-- fichier : voir CLAUDE.md § Marketing plateforme, « piège vécu ».
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Vocabulaire des segments contacts : tables, billets, boissons, récence ──
CREATE OR REPLACE FUNCTION public.contact_definition_predicate(p_definition jsonb, p_alias text DEFAULT 'c'::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $$
DECLARE
  c jsonb;
  parts text[] := '{}';
  a text := quote_ident(COALESCE(p_alias, 'c'));
  t text; op text; sqlop text; v text; lst text; vmin text; vmax text;
BEGIN
  IF p_definition IS NULL OR jsonb_typeof(p_definition->'conditions') <> 'array' THEN
    RETURN 'false';
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_definition->'conditions') LOOP
    t := c->>'type';
    op := c->>'op';
    sqlop := CASE op WHEN 'gte' THEN '>=' WHEN 'gt' THEN '>' WHEN 'lte' THEN '<=' WHEN 'lt' THEN '<' WHEN 'eq' THEN '=' ELSE NULL END;
    v := c->>'value';
    IF t IN ('country','country_not','zone','city','region','gender','list','engagement','origin') THEN
      SELECT string_agg(format('%L', CASE
                 WHEN t IN ('country','country_not') THEN upper(btrim(x))
                 WHEN t IN ('zone','city','region') THEN lower(btrim(x))
                 ELSE x END), ',')
        INTO lst
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'in') = 'array' THEN c->'in' ELSE '[]'::jsonb END) x;
      IF lst IS NULL THEN parts := array_append(parts, 'false'); CONTINUE; END IF;
    END IF;

    CASE t
      WHEN 'country' THEN
        parts := parts || format('(upper(COALESCE(%s.country_code, '''')) IN (%s))', a, lst);
      WHEN 'country_not' THEN
        parts := parts || format('(%s.country_code IS NOT NULL AND upper(%s.country_code) NOT IN (%s))', a, a, lst);
      WHEN 'zone' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.zone, ''''))) IN (%s))', a, lst);
      WHEN 'city' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.city, ''''))) IN (%s))', a, lst);
      WHEN 'region' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.region, ''''))) IN (%s))', a, lst);
      WHEN 'gender' THEN
        parts := parts || format('(COALESCE(%s.gender, '''') IN (%s))', a, lst);
      WHEN 'list' THEN
        parts := parts || format('(%s.list_import_id::text IN (%s))', a, lst);
      WHEN 'engagement' THEN
        parts := parts || format('(COALESCE(%s.eng_status, ''new'') IN (%s))', a, lst);
      WHEN 'origin' THEN
        parts := parts || format('(COALESCE(%s.origin, '''') IN (%s))', a, lst);
      WHEN 'spent' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.total_spent %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'spent_per_event' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((%s.total_spent / NULLIF(%s.event_count, 0)) %s %s::numeric, false)', a, a, sqlop, v); END IF;
      WHEN 'events' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.event_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'tables' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.table_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'tickets' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.ticket_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'orders' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.order_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_seen_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_seen_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'guest_lists' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.guest_list_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'emails_received' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.emails_sent %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'opens' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.opens %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'clicks' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.clicks %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_purchase_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_purchase_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_open_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_opened_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_click_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_clicked_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'added_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.added_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'age' THEN
        vmin := COALESCE(c->>'min', '0'); vmax := COALESCE(c->>'max', '200');
        IF vmin !~ '^[0-9]{1,3}$' OR vmax !~ '^[0-9]{1,3}$' THEN parts := array_append(parts, 'false');
        ELSE parts := parts || format('COALESCE(%s.age BETWEEN %s AND %s, false)', a, vmin, vmax); END IF;
      WHEN 'newsletter_opt_in' THEN
        parts := parts || format('COALESCE(%s.newsletter_opt_in = %L::boolean, false)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_email' THEN
        parts := parts || format('((%s.email IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_phone' THEN
        parts := parts || format('((%s.phone_e164 IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'yuno_customer' THEN
        parts := parts || format('((COALESCE(%s.origin, '''') IN (''yuno'',''both'')) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_account' THEN
        parts := parts || format('(COALESCE(%s.has_account, false) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      ELSE
        parts := array_append(parts, 'false');
    END CASE;
  END LOOP;
  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$$;

-- ── 2. Audiences organisateur : billets + tables + guest list ─────────────
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
  -- Mode de combinaison des audiences cochées : 'any' (réunir, défaut) ou
  -- 'all' (croiser : le contact doit être dans CHAQUE audience cochée).
  v_match_all boolean := false;
  v_aud_n integer := 0;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := (v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin();
  ELSE
    -- Portée plateforme : super admin uniquement.
    v_is_authorized := public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── Portée plateforme ────────────────────────────────────────────────────
  -- Yuno écrit à SA base, jamais à celle d'un club. Une seule source : le
  -- registre plateforme (`newsletter_subscriptions` avec les deux colonnes de
  -- portée à NULL), alimenté par `sync_platform_marketing_contacts` et par les
  -- imports attestés. C'est lui qui porte le jeton de désinscription : aucune
  -- adresse ne peut entrer dans une campagne sans porte de sortie.
  IF v_campaign.venue_id IS NULL AND v_campaign.organizer_user_id IS NULL THEN
    v_audiences := COALESCE(v_campaign.audiences_json, '[]'::jsonb);
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    IF jsonb_typeof(v_audiences) <> 'array' OR jsonb_array_length(v_audiences) = 0 THEN
      RETURN;                       -- audience vide ⇒ personne, jamais « tout le monde »
    END IF;

    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    RETURN QUERY
    WITH cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.venue_id IS NULL AND cs.organizer_user_id IS NULL
        CROSS JOIN LATERAL public.resolve_contact_segment_def(NULL, NULL, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name) AS fname,
             COALESCE(p.last_name,  ns.last_name)  AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(ns.source, '') AS src,
             EXISTS (SELECT 1 FROM public.tickets t
                      WHERE LOWER(t.user_email) = LOWER(ns.email) AND t.status = 'paid') AS bought
        FROM public.newsletter_subscriptions ns
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a
          WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'clients'    THEN s.src = 'platform:clients'
            WHEN 'pros'       THEN s.src = 'platform:pros'
            WHEN 'waitlist'   THEN s.src = 'platform:waitlist'
            WHEN 'leads'      THEN s.src = 'platform:leads'
            WHEN 'app_users'  THEN s.uid IS NOT NULL
            WHEN 'no_account' THEN s.uid IS NULL
            WHEN 'buyers'     THEN s.bought
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'     THEN s.imp IS NOT NULL
                                   AND s.imp::text = lower(COALESCE(a->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.venue_id IS NULL AND c2.organizer_user_id IS NULL
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
    RETURN;
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  IF jsonb_typeof(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) > 0 THEN

    v_audiences := v_campaign.audiences_json;
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        SELECT DISTINCT LOWER(seg.email) AS addr, vs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), cseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
      ), vseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM seg_emails GROUP BY addr
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
               COALESCE(ch.n, 0)::integer AS seg_hits, COALESCE(vh.n, 0)::integer AS vseg_hits,
               COALESCE(p.first_name, vc.first_name, ns.first_name) AS fname,
               COALESCE(p.last_name,  vc.last_name, ns.last_name)  AS lname,
               ns.user_id AS uid, ns.unsubscribe_token AS tok,
               ns.import_id AS imp,
               COALESCE(vc.total_spent, 0) AS spent,
               (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) AS visits,
               vc.last_visit_at AS last_visit
          FROM public.newsletter_subscriptions ns
          LEFT JOIN public.venue_customers vc
            ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
          LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
          LEFT JOIN vseg_hits vh ON vh.addr = LOWER(ns.email)
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE (
           SELECT count(*) FROM jsonb_array_elements(v_audiences) a
            WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
              WHEN 'all_subscribers' THEN true
              WHEN 'vip'           THEN s.spent >= 500
              WHEN 'big_spenders'  THEN s.spent >= 1000
              WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
              WHEN 'new_customers' THEN s.visits <= 1
              WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
              WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.tickets t
                      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                        AND LOWER(t.user_email) = s.addr)
              WHEN 'segment' THEN false  -- compté via vseg_hits
              WHEN 'contact_segment' THEN false  -- compté via seg_hits
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id
                  AND r.status = 'sent'
                  AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                  AND LOWER(r.email) = m.addr))
         AND (NOT v_excl_buyers OR (
               NOT EXISTS (SELECT 1 FROM public.tickets t
                            WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                              AND LOWER(t.user_email) = m.addr)
               AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                            WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                              AND LOWER(tr.user_email) = m.addr)));
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      -- Un client est quelqu'un qui est VENU : billets, tables ET guest list
      -- (contact_scope_customers, la même source que la base de contacts).
      -- Avant, seuls les billets comptaient : un organisateur qui ne vend que
      -- des tables n'avait ni VIP, ni habitué, ni dormant.
      SELECT c.email AS addr,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name AS fname0,
             c.last_name AS lname0
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name, a.fname0) AS fname,
             COALESCE(p.last_name, ns.last_name, a.lname0) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a2
          WHERE a2->>'kind' NOT IN ('contact_segment','segment') AND CASE a2->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'vip'           THEN s.spent >= 500
            WHEN 'big_spenders'  THEN s.spent >= 1000
            WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
            WHEN 'new_customers' THEN s.visits <= 1
            WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
            WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                      AND LOWER(t.user_email) = s.addr)
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR (
             NOT EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                            AND LOWER(t.user_email) = m.addr)
             AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                          WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                            AND LOWER(tr.user_email) = m.addr)));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'custom_segment' THEN
    IF v_campaign.venue_id IS NULL OR v_campaign.segment_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text,
      COALESCE(p.first_name, vc.first_name)::text,
      COALESCE(p.last_name, vc.last_name)::text,
      ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.resolve_venue_segment(
           v_campaign.venue_id,
           (SELECT vs.definition FROM public.venue_segments vs
             WHERE vs.id = v_campaign.segment_id AND vs.venue_id = v_campaign.venue_id)
         ) seg ON LOWER(seg.email) = LOWER(ns.email)
    LEFT JOIN public.venue_customers vc
      ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true;
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT c.email,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name, c.last_name
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    )
    SELECT a.email::text,
           a.first_name::text,
           a.last_name::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
    RETURN;
  END IF;
END;
$$;

-- ── 2b. Effectifs par audience, organisateur (un appel pour l'écran Audience) ──
CREATE OR REPLACE FUNCTION public.count_organizer_audience_kinds(
  p_organizer_user_id uuid,
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF p_organizer_user_id IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR p_organizer_user_id = auth.uid()
          OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Mêmes seuils que resolve_campaign_audience (portée organisateur) : ce que
  -- l'écran affiche est ce que l'envoi résoudra.
  WITH cust AS (
    SELECT c.email, COALESCE(c.spent, 0) AS spent, COALESCE(c.event_count, 0) AS visits, c.last_at
      FROM public.contact_scope_customers(NULL, p_organizer_user_id) c
  ), subs AS (
    SELECT DISTINCT ON (LOWER(ns.email)) LOWER(ns.email) AS addr, cu.spent, cu.visits, cu.last_at
      FROM public.newsletter_subscriptions ns
      LEFT JOIN cust cu ON cu.email = LOWER(ns.email)
     WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true
     ORDER BY LOWER(ns.email)
  )
  SELECT jsonb_build_object(
    'all_subscribers', count(*),
    'vip',           count(*) FILTER (WHERE COALESCE(s.spent, 0) >= 500),
    'big_spenders',  count(*) FILTER (WHERE COALESCE(s.spent, 0) >= 1000),
    'regulars',      count(*) FILTER (WHERE COALESCE(s.visits, 0) BETWEEN 2 AND 4),
    'new_customers', count(*) FILTER (WHERE COALESCE(s.visits, 0) <= 1),
    'dormant',       count(*) FILTER (WHERE s.last_at IS NOT NULL AND s.last_at < now() - interval '90 days'),
    'event_subscribers', CASE WHEN p_event_id IS NULL THEN 0 ELSE
      count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.event_id = p_event_id AND t.status = 'paid' AND LOWER(t.user_email) = s.addr)) END
  ) INTO v
  FROM subs s;
  RETURN COALESCE(v, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.count_organizer_audience_kinds(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_organizer_audience_kinds(uuid, uuid) TO authenticated, service_role;

-- ── 3. Règles de visibilité par bloc : les compléments ─────────────────────
CREATE OR REPLACE FUNCTION public.get_recipient_block_conds(
  p_campaign_id uuid,
  p_emails text[]
)
RETURNS TABLE(email text, cond text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'get_recipient_block_conds: service_role only';
  END IF;

  SELECT venue_id, organizer_user_id INTO c
    FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH addrs AS (
    SELECT DISTINCT lower(e2.addr) AS addr FROM unnest(p_emails) AS e2(addr)
  ), has_table AS (
    -- vip_table : a déjà réservé une table chez ce sender
    SELECT a.addr
      FROM addrs a
     WHERE EXISTS (
       SELECT 1 FROM public.table_reservations tr
         JOIN public.events ev ON ev.id = tr.event_id
        WHERE lower(tr.user_email) = a.addr
          AND tr.status IN ('paid', 'confirmed')
          AND ((c.venue_id IS NOT NULL AND (ev.venue_id = c.venue_id OR ev.partner_venue_id = c.venue_id))
            OR (c.organizer_user_id IS NOT NULL AND (ev.organizer_user_id = c.organizer_user_id OR ev.partner_organizer_id = c.organizer_user_id))))
  ), has_ticket AS (
    -- buyers : a déjà acheté un billet chez ce sender
    SELECT a.addr
      FROM addrs a
     WHERE EXISTS (
       SELECT 1 FROM public.tickets t
         JOIN public.events ev ON ev.id = t.event_id
        WHERE lower(t.user_email) = a.addr
          AND t.status = 'paid'
          AND ((c.venue_id IS NOT NULL AND (ev.venue_id = c.venue_id OR ev.partner_venue_id = c.venue_id))
            OR (c.organizer_user_id IS NOT NULL AND (ev.organizer_user_id = c.organizer_user_id OR ev.partner_organizer_id = c.organizer_user_id))))
  )
  SELECT h.addr::text, 'vip_table'::text FROM has_table h
  UNION ALL
  -- no_vip_table : le COMPLÉMENT exact sur le même lot — « le bloc Table VIP
  -- pour ceux qui en ont pris une, le bloc Liste invités pour les autres ».
  SELECT a.addr::text, 'no_vip_table'::text FROM addrs a
   WHERE NOT EXISTS (SELECT 1 FROM has_table h WHERE h.addr = a.addr)
  UNION ALL
  SELECT h.addr::text, 'buyers'::text FROM has_ticket h
  UNION ALL
  SELECT a.addr::text, 'no_buyers'::text FROM addrs a
   WHERE NOT EXISTS (SELECT 1 FROM has_ticket h WHERE h.addr = a.addr)
  UNION ALL
  -- new_subscribers : abonné newsletter depuis moins de 30 jours
  SELECT a.addr::text, 'new_subscribers'::text
    FROM addrs a
   WHERE EXISTS (
     SELECT 1 FROM public.newsletter_subscriptions ns
      WHERE lower(ns.email) = a.addr
        AND ns.created_at > now() - interval '30 days'
        AND ((c.venue_id IS NOT NULL AND ns.venue_id = c.venue_id)
          OR (c.organizer_user_id IS NOT NULL AND ns.organizer_user_id = c.organizer_user_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.get_recipient_block_conds(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recipient_block_conds(uuid, text[]) TO service_role;
