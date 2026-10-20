-- Yuno CRM ⇄ Billetterie : la Billetterie ne cible plus un acheteur Shotgun par le registre de consentement.
--
-- Les acheteurs Shotgun qui ont donné leur accord à Shotgun entrent dans newsletter_subscriptions avec
-- source = 'connector:shotgun' (1 461 lignes chez Amoris). Une audience e-mail de la Billetterie qui lit
-- « tous les abonnés » les ciblait. Règle : les lecteurs côté Billetterie ignorent COALESCE(source, '') LIKE 'connector:%'.
--   • resolve_campaign_audience : drapeau v_conn_ok = crm_campaign_is_crm (une campagne CRM garde ces accords ;
--     les campagnes CRM, kind 'crm' ou pratiques, sortent d'ailleurs avant les branches Billetterie) ;
--   • collect_email_automations : v_conn_ok par recette = product 'crm', kinds CRM (click_no_buy, first_return) ou compte CRM pur ;
--   • count_campaign_recipients(_org), count_organizer_audience_kinds : ce que l'écran compte = ce que résout l'envoi ;
--   • export_venue_ad_audience, _resolve_meta_audience_rows, get_dj_lineup_email_targets, email_automation_suggestions_sweep,
--     get_community_period, get_event_community : même règle, sans appelant CRM.
-- Non traité (gestion du consentement, décision de Paul) : un acheteur Shotgun qui coche ensuite la case Yuno garde
-- source = 'connector:shotgun' (les ON CONFLICT n'écrivent pas source) : voir isolation-R1-registre.md, groupe O-A.
-- Edge : supabase/functions/_shared/email-compliance.ts (send-missed-you, send-next-event-recommendation) à redéployer.

DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('resolve_campaign_audience', 'b6f34464910b9c11471aba88c581972b'),
    ('count_campaign_recipients', '46f8dd4e99eac21de0ece903f1490224'),
    ('count_campaign_recipients_org', 'a6fd301bc0b0ba24d7d7becc113c80f4'),
    ('count_organizer_audience_kinds', 'b04ff3689264c32d41c324c912550192'),
    ('export_venue_ad_audience', '3ae1fa90d942a8b21b0cd0fc749fcff7'),
    ('_resolve_meta_audience_rows', '41b7ee87e8889427161879b145f855cc'),
    ('get_dj_lineup_email_targets', '75630c7115339a5cbb7d167171870575'),
    ('get_community_period', 'aa92c86fa65ef9ebd311c9e31f7ed2c9'),
    ('get_event_community', 'a8bc911c6786d332cef8d0e5f2884ae0'),
    ('collect_email_automations', 'd3955395a10a0c2ae335a3e7365f5ac2'),
    ('email_automation_suggestions_sweep', '2dfb97f8d03b3fafbe2ce17a497a4a3a')
  ) AS v(name, md5) LOOP
    IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.name) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'public.% a changé depuis l''audit du 20/10 : régénérer la migration depuis pg_get_functiondef', r.name;
    END IF;
  END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Isolation CRM ⇄ Billetterie : un accord rapporté par la billetterie connectée
  -- (newsletter_subscriptions.source = 'connector:%') ne vaut QUE pour une campagne du CRM.
  v_conn_ok boolean := false;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;
  v_conn_ok := COALESCE(public.crm_campaign_is_crm(p_campaign_id), false);

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := COALESCE((v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin(), false);
  ELSE
    -- Portée plateforme : super admin uniquement.
    v_is_authorized := public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  -- E-mail pratique (Yuno CRM) : l'équipe de l'espace le compose aussi.
  IF v_campaign.practical AND NOT v_is_authorized THEN
    v_is_authorized := public.crm_scope_allowed(v_campaign.venue_id, v_campaign.organizer_user_id);
  END IF;
  IF NOT COALESCE(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── E-mail pratique (Yuno CRM, 20261019150000) ───────────────────────────
  -- Les détenteurs d'un billet valide de la soirée, seuls, sans accord
  -- marketing : l'information d'un achat, jamais une audience combinable.
  IF v_campaign.practical THEN
    RETURN QUERY SELECT * FROM public._crm_practical_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Console Yuno CRM ─────────────────────────────────────────────────────
  -- Audiences {kind:'crm', segmentId?, def} : la base clients du CRM, filtrée
  -- par la même définition que l'écran Clients (_crm_filter_sql), et toujours
  -- passée par le registre de consentement de la portée (_crm_campaign_audience).
  IF jsonb_typeof(v_campaign.audiences_json) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_campaign.audiences_json) x WHERE x->>'kind' = 'crm') THEN
    RETURN QUERY SELECT * FROM public._crm_campaign_audience(p_campaign_id);
    RETURN;
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
    -- Les acheteurs d'une soirée ne sont joignables en informatif QUE par ses
    -- parties PRINCIPALES : un co-hôte n'a que les contacts qui l'ont nommé
    -- (case du checkout), jamais toute la liste des acheteurs.
    IF NOT public.campaign_scope_is_event_principal(v_campaign.venue_id, v_campaign.organizer_user_id, v_campaign.event_id) THEN
      RETURN;
    END IF;
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
           AND (v_conn_ok OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
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
         AND (v_conn_ok OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
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
      AND (v_conn_ok OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
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
      AND (v_conn_ok OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
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
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      AND (v_conn_ok OR COALESCE(ns.source, '') NOT LIKE 'connector:%');
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
        AND (v_conn_ok OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
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
      AND (v_conn_ok OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
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
$function$;
REVOKE ALL ON FUNCTION public.resolve_campaign_audience(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(p_campaign_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.count_campaign_recipients(p_venue_id text, p_type text, p_audience_type text, p_event_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Informational: acheteurs ticket d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.tickets
    WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: réservations table d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.table_reservations
    WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: tous les acheteurs (ticket + table)
  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  -- Marketing: filtrage commun = abonnés opt-in venue
  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE venue_id = p_venue_id AND opted_in = true
        AND COALESCE(source, '') NOT LIKE 'connector:%';
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.venue_id = p_venue_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true
        AND COALESCE(ns.source, '') NOT LIKE 'connector:%';
    ELSIF p_audience_type = 'custom_segment' AND p_segment_id IS NOT NULL THEN
      -- Segment sauvegardé ∩ opt-in : même intersection que resolve_campaign_audience.
      SELECT COUNT(DISTINCT LOWER(ns.email)) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.resolve_venue_segment(
             p_venue_id,
             (SELECT vs.definition FROM public.venue_segments vs
               WHERE vs.id = p_segment_id AND vs.venue_id = p_venue_id)
           ) seg ON LOWER(seg.email) = LOWER(ns.email)
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true
        AND COALESCE(ns.source, '') NOT LIKE 'connector:%';
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc
        ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = p_venue_id
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true
        AND COALESCE(ns.source, '') NOT LIKE 'connector:%'
        AND CASE p_audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.count_campaign_recipients(p_venue_id text, p_type text, p_audience_type text, p_event_id uuid, p_segment_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(p_venue_id text, p_type text, p_audience_type text, p_event_id uuid, p_segment_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.count_campaign_recipients_org(p_organizer_user_id uuid, p_type text, p_audience_type text, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer := 0;
BEGIN
  IF NOT COALESCE(p_organizer_user_id = auth.uid() OR public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND t.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(tr.user_email)) INTO v_count
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE tr.event_id = p_event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH allowed AS (
      SELECT id FROM public.events
      WHERE id = p_event_id
        AND (organizer_user_id = p_organizer_user_id OR partner_organizer_id = p_organizer_user_id)
    ), emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id IN (SELECT id FROM allowed) AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id IN (SELECT id FROM allowed) AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE organizer_user_id = p_organizer_user_id AND opted_in = true
        AND COALESCE(source, '') NOT LIKE 'connector:%';
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.organizer_user_id = p_organizer_user_id
      JOIN public.events e ON e.id = t.event_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true
        AND COALESCE(ns.source, '') NOT LIKE 'connector:%'
        AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      WITH agg AS (
        SELECT LOWER(t.user_email) AS email,
               SUM(t.total_price)::numeric AS spent,
               COUNT(DISTINCT t.event_id) AS visits,
               MAX(t.created_at) AS last_seen
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE t.status = 'paid' AND t.user_email IS NOT NULL
          AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)
        GROUP BY LOWER(t.user_email)
      )
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN agg a ON a.email = LOWER(ns.email)
      WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true
        AND COALESCE(ns.source, '') NOT LIKE 'connector:%'
        AND CASE p_audience_type
          WHEN 'vip' THEN a.spent >= 500
          WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
          WHEN 'new_customers' THEN a.visits = 1
          WHEN 'big_spenders' THEN a.spent >= 1000
          WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.count_campaign_recipients_org(p_organizer_user_id uuid, p_type text, p_audience_type text, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_campaign_recipients_org(p_organizer_user_id uuid, p_type text, p_audience_type text, p_event_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.count_organizer_audience_kinds(p_organizer_user_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       AND COALESCE(ns.source, '') NOT LIKE 'connector:%'
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
$function$;
REVOKE ALL ON FUNCTION public.count_organizer_audience_kinds(p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_organizer_audience_kinds(p_organizer_user_id uuid, p_event_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.export_venue_ad_audience(p_venue_id text)
 RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (is_super_admin() OR is_venue_owner(auth.uid(), p_venue_id)) THEN
    RAISE EXCEPTION 'Not authorized for venue %' , p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH sms AS (
    SELECT lower(COALESCE(vsc.email, '')) AS em, vsc.phone_e164, vsc.full_name
      FROM public.venue_sms_contacts vsc
     WHERE vsc.venue_id = p_venue_id AND vsc.unsubscribed = false AND vsc.phone_e164 IS NOT NULL
  ),
  news AS (
    SELECT lower(ns.email) AS em, ns.user_id
      FROM public.newsletter_subscriptions ns
     WHERE ns.venue_id = p_venue_id AND ns.opted_in = true
       AND COALESCE(ns.source, '') NOT LIKE 'connector:%'
  ),
  merged AS (
    -- Opt-in newsletter, enrichi du téléphone si le même email a aussi consenti au SMS
    SELECT n.em,
           (SELECT s.phone_e164 FROM sms s WHERE s.em = n.em LIMIT 1) AS phone_e164,
           pr.first_name, pr.last_name
      FROM news n
      LEFT JOIN public.profiles pr ON pr.id = n.user_id
    UNION
    -- Consentement SMS pur (pas d'opt-in newsletter au même email)
    SELECT s.em,
           s.phone_e164,
           NULLIF(split_part(COALESCE(s.full_name, ''), ' ', 1), ''),
           NULLIF(regexp_replace(COALESCE(s.full_name, ''), '^\S+\s*', ''), '')
      FROM sms s
     WHERE s.em = '' OR s.em NOT IN (SELECT n2.em FROM news n2)
  )
  SELECT
    NULLIF(m.em, '')::text,
    m.phone_e164::text,
    m.first_name::text,
    m.last_name::text,
    (CASE
      WHEN m.phone_e164 LIKE '+33%' THEN 'FR'
      WHEN m.phone_e164 LIKE '+34%' THEN 'ES'
      WHEN m.phone_e164 LIKE '+44%' THEN 'GB'
      WHEN m.phone_e164 LIKE '+49%' THEN 'DE'
      WHEN m.phone_e164 LIKE '+39%' THEN 'IT'
      WHEN m.phone_e164 LIKE '+32%' THEN 'BE'
      WHEN m.phone_e164 LIKE '+41%' THEN 'CH'
      WHEN m.phone_e164 LIKE '+351%' THEN 'PT'
      WHEN m.phone_e164 LIKE '+31%' THEN 'NL'
      WHEN m.phone_e164 LIKE '+352%' THEN 'LU'
      WHEN m.phone_e164 LIKE '+377%' THEN 'MC'
      WHEN m.phone_e164 LIKE '+1%' THEN 'US'
      ELSE ''
    END)::text AS country
  FROM merged m
  WHERE NULLIF(m.em, '') IS NOT NULL OR m.phone_e164 IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.export_venue_ad_audience(p_venue_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_venue_ad_audience(p_venue_id text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._resolve_meta_audience_rows(p_connection_id uuid, p_kind text, p_ref text)
 RETURNS TABLE(email text, phone text, first_name text, last_name text, country text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text;
  v_org   uuid;
BEGIN
  SELECT mc.venue_id, mc.organizer_user_id INTO v_venue, v_org
    FROM public.meta_connections mc WHERE mc.id = p_connection_id;
  IF NOT FOUND OR (v_venue IS NULL AND v_org IS NULL) THEN RETURN; END IF;

  RETURN QUERY
  WITH sms AS (
    SELECT lower(COALESCE(vsc.email, '')) AS em, vsc.phone_e164, vsc.full_name
      FROM public.venue_sms_contacts vsc
     WHERE ((v_venue IS NOT NULL AND vsc.venue_id = v_venue) OR (v_org IS NOT NULL AND vsc.organizer_user_id = v_org))
       AND vsc.unsubscribed = false AND vsc.phone_e164 IS NOT NULL
       AND vsc.sms_consent_at >= now() - interval '36 months'
  ),
  news AS (
    SELECT lower(ns.email) AS em, ns.user_id, ns.first_name, ns.last_name
      FROM public.newsletter_subscriptions ns
     WHERE ((v_venue IS NOT NULL AND ns.venue_id = v_venue) OR (v_org IS NOT NULL AND ns.organizer_user_id = v_org))
       AND ns.opted_in = true
       AND COALESCE(ns.source, '') NOT LIKE 'connector:%'
       AND NOT public.is_email_suppressed(ns.email)
  ),
  consenting AS (
    SELECT n.em,
           (SELECT s.phone_e164 FROM sms s WHERE s.em = n.em LIMIT 1) AS phone_e164,
           COALESCE(n.first_name, pr.first_name) AS fn,
           COALESCE(n.last_name, pr.last_name) AS ln
      FROM news n
      LEFT JOIN public.profiles pr ON pr.id = n.user_id
    UNION
    SELECT s.em, s.phone_e164,
           NULLIF(split_part(COALESCE(s.full_name, ''), ' ', 1), ''),
           NULLIF(regexp_replace(COALESCE(s.full_name, ''), '^\S+\s*', ''), '')
      FROM sms s
     WHERE s.em = '' OR s.em NOT IN (SELECT n2.em FROM news n2)
  ),
  scope_events AS (
    SELECT e.id FROM public.events e
     WHERE (v_venue IS NOT NULL AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue))
        OR (v_org IS NOT NULL AND (e.organizer_user_id = v_org OR e.partner_organizer_id = v_org))
  ),
  activity AS (
    SELECT lower(t.user_email) AS em, t.event_id, 'ticket'::text AS kind, t.created_at
      FROM public.tickets t WHERE t.paid_at IS NOT NULL AND t.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(tr.user_email), tr.event_id, 'table', tr.created_at
      FROM public.table_reservations tr WHERE tr.paid_at IS NOT NULL AND tr.event_id IN (SELECT id FROM scope_events)
    UNION ALL
    SELECT lower(o.user_email), o.event_id, 'order', o.created_at
      FROM public.orders o WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND ((v_venue IS NOT NULL AND o.venue_id = v_venue) OR o.event_id IN (SELECT id FROM scope_events))
    UNION ALL
    SELECT lower(gle.email), g.event_id, 'guest_list', gle.created_at
      FROM public.guest_list_entries gle JOIN public.guest_lists g ON g.id = gle.guest_list_id
     WHERE gle.status <> 'cancelled' AND g.event_id IN (SELECT id FROM scope_events)
  ),
  selected AS (
    SELECT c.* FROM consenting c
     WHERE CASE p_kind
       WHEN 'builtin' THEN
         CASE p_ref
           WHEN 'all_consenting' THEN true
           WHEN 'buyers_12m'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind IN ('ticket','table','order') AND a.created_at >= now() - interval '12 months')
           WHEN 'vip_tables'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'table')
           WHEN 'guest_list'    THEN EXISTS (SELECT 1 FROM activity a WHERE a.em = c.em AND a.kind = 'guest_list')
           WHEN 'regulars_3'    THEN (SELECT count(DISTINCT a.event_id) FROM activity a WHERE a.em = c.em) >= 3
           ELSE false
         END
       WHEN 'venue_segment' THEN
         v_venue IS NOT NULL AND c.em IN (
           SELECT lower(r.email) FROM public.venue_segments vs
             CROSS JOIN LATERAL public.resolve_venue_segment(v_venue, vs.definition) r
            WHERE vs.id::text = p_ref AND vs.venue_id = v_venue)
       WHEN 'contact_segment' THEN
         c.em IN (
           SELECT lower(r.email) FROM public.contact_segments cs
             CROSS JOIN LATERAL public.resolve_contact_segment_def(v_venue, v_org, cs.definition) r
            WHERE cs.id::text = p_ref
              AND cs.venue_id IS NOT DISTINCT FROM v_venue AND cs.organizer_user_id IS NOT DISTINCT FROM v_org
              AND r.email IS NOT NULL)
       ELSE false END
  )
  SELECT NULLIF(s.em, '')::text, s.phone_e164::text, s.fn::text, s.ln::text,
         (CASE
            WHEN s.phone_e164 LIKE '+33%' THEN 'FR' WHEN s.phone_e164 LIKE '+34%' THEN 'ES'
            WHEN s.phone_e164 LIKE '+44%' THEN 'GB' WHEN s.phone_e164 LIKE '+49%' THEN 'DE'
            WHEN s.phone_e164 LIKE '+39%' THEN 'IT' WHEN s.phone_e164 LIKE '+32%' THEN 'BE'
            WHEN s.phone_e164 LIKE '+41%' THEN 'CH' WHEN s.phone_e164 LIKE '+351%' THEN 'PT'
            WHEN s.phone_e164 LIKE '+31%' THEN 'NL' ELSE '' END)::text
    FROM selected s
   WHERE NULLIF(s.em, '') IS NOT NULL OR s.phone_e164 IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._resolve_meta_audience_rows(p_connection_id uuid, p_kind text, p_ref text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_dj_lineup_email_targets(p_event_id uuid, p_dj_id uuid)
 RETURNS TABLE(user_id uuid, email text, first_name text, preferred_language text, unsubscribe_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_city   text;
  v_venue  text;
  v_ok     boolean;
  v_person uuid;
BEGIN
  SELECT e.location_city, e.venue_id,
         (e.is_active AND e.end_at >= now() AND e.visibility = 'public')
    INTO v_city, v_venue, v_ok
  FROM public.events e WHERE e.id = p_event_id;

  IF NOT FOUND OR v_ok IS NOT TRUE OR v_city IS NULL OR v_venue IS NULL THEN RETURN; END IF;

  SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = p_dj_id;
  IF v_person IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT ON (f.user_id)
    f.user_id,
    p.email,
    p.first_name,
    p.preferred_language,
    ns.unsubscribe_token::text
  FROM public.favorites f
  JOIN public.profiles p ON p.id = f.user_id
  JOIN public.newsletter_subscriptions ns
    ON lower(ns.email) = lower(p.email) AND ns.venue_id = v_venue AND ns.opted_in = true
   AND COALESCE(ns.source, '') NOT LIKE 'connector:%'
  WHERE f.favorite_type = 'dj'
    AND f.dj_id IN (SELECT d2.id FROM public.djs d2 WHERE d2.user_id = v_person)
    AND p.email IS NOT NULL
    AND p.city IS NOT NULL
    AND (
      lower(btrim(p.city)) = lower(btrim(v_city))
      OR position(lower(btrim(v_city)) IN lower(btrim(p.city))) > 0
      OR position(lower(btrim(p.city)) IN lower(btrim(v_city))) > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.dj_lineup_notifications n
      WHERE n.user_id = f.user_id AND n.event_id = p_event_id AND n.dj_id = p_dj_id
    )
  ORDER BY f.user_id, f.created_at ASC;
END; $function$;
REVOKE ALL ON FUNCTION public.get_dj_lineup_email_targets(p_event_id uuid, p_dj_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dj_lineup_email_targets(p_event_id uuid, p_dj_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_community_period(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_hours integer DEFAULT 720)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g           record;
  v_now       timestamptz := now();
  v_from      timestamptz;
  v_prev_from timestamptz;
  v_win_from  timestamptz;
  v_me        text;
  v_stype     text;
  v_sid       text;
  v_result    jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;
  v_me := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue:' || g.scope_venue ELSE 'org:' || g.scope_org::text END;
  v_stype := CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END;
  v_sid := CASE WHEN g.scope_venue IS NOT NULL THEN g.scope_venue ELSE g.scope_org::text END;
  v_from := CASE WHEN p_hours IS NULL THEN '-infinity'::timestamptz ELSE v_now - make_interval(hours => p_hours) END;
  v_prev_from := CASE WHEN p_hours IS NULL THEN NULL ELSE v_from - make_interval(hours => p_hours) END;

  WITH
  scope_ev AS MATERIALIZED (
    SELECT x.id FROM public.events x WHERE x.id = ANY (g.scope_ids) AND x.cancelled_at IS NULL
  ),
  rows_all AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.event_id, lower(btrim(t.user_email)) AS email, t.user_id,
           COALESCE(t.paid_at, t.created_at) AS at_ts,
           greatest(COALESCE(t.quantity, 1), 1) AS heads,
           greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - least(greatest(COALESCE(t.refund_amount, 0), 0), greatest(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t WHERE t.event_id IN (SELECT id FROM scope_ev) AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT 'tables', r.event_id, lower(btrim(r.user_email)), r.user_id, COALESCE(r.paid_at, r.created_at),
           greatest(COALESCE(r.guest_count, 0), 1),
           greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(COALESCE(r.refund_amount, 0), 0),
                     greatest(r.total_price - COALESCE(r.service_fee, 0) - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r WHERE r.event_id IN (SELECT id FROM scope_ev) AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'guest_list', gl.event_id, lower(nullif(btrim(ge.email), '')), ge.user_id, ge.created_at, 1, 0::numeric
      FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scope_ev) AND ge.status <> 'cancelled'
  ),
  win_rows AS MATERIALIZED (SELECT * FROM rows_all WHERE at_ts >= v_from),
  people AS MATERIALIZED (
    SELECT r.email, min(r.at_ts) AS first_at,
           (array_agg(r.user_id) FILTER (WHERE r.user_id IS NOT NULL))[1] AS user_id,
           bool_or(r.pillar IN ('tickets', 'tables')) AS buyer, bool_or(r.pillar = 'guest_list') AS guest,
           sum(r.heads) FILTER (WHERE r.pillar <> 'guest_list') AS heads_paid, COALESCE(sum(r.amount), 0) AS amount
      FROM win_rows r WHERE r.email IS NOT NULL GROUP BY r.email
  ),
  no_email AS (SELECT count(*) AS n FROM win_rows WHERE email IS NULL),
  people_prev AS (
    SELECT count(DISTINCT email) AS n FROM rows_all
     WHERE email IS NOT NULL AND v_prev_from IS NOT NULL AND at_ts >= v_prev_from AND at_ts < v_from
  ),
  -- Déjà connus AVANT la période, et nombre de soirées faites (toute la vie de la portée).
  life AS (
    SELECT r.email, count(DISTINCT r.event_id) AS nights, min(r.at_ts) AS first_ever
      FROM rows_all r WHERE r.email IN (SELECT email FROM people) GROUP BY r.email
  ),
  ns AS MATERIALIZED (
    SELECT lower(n.email) AS email, n.opted_in, n.created_at
      FROM public.newsletter_subscriptions n
     WHERE ((g.scope_venue IS NOT NULL AND n.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND n.organizer_user_id = g.scope_org))
       AND COALESCE(n.source, '') NOT LIKE 'connector:%'
       AND lower(n.email) IN (SELECT email FROM people)
  ),
  sm AS MATERIALIZED (
    SELECT lower(c.email) AS email, c.phone_e164, c.sms_consent_at
      FROM public.venue_sms_contacts c
     WHERE ((g.scope_venue IS NOT NULL AND c.venue_id = g.scope_venue) OR (g.scope_org IS NOT NULL AND c.organizer_user_id = g.scope_org))
       AND COALESCE(c.unsubscribed, false) = false AND lower(c.email) IN (SELECT email FROM people)
  ),
  app AS (
    SELECT DISTINCT p.email FROM people p
     WHERE p.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p.user_id AND ps.platform = 'ios')
  ),
  acct AS (
    SELECT DISTINCT p.email FROM people p
     WHERE p.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.profiles pf WHERE lower(pf.email) = p.email)
  ),
  me_ns AS (SELECT DISTINCT email FROM ns WHERE opted_in),
  me_sm AS (SELECT DISTINCT email FROM sm WHERE email IS NOT NULL),
  fresh AS (SELECT p.email FROM people p JOIN life l ON l.email = p.email WHERE l.first_ever >= v_from),
  reach AS (
    SELECT count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns)) AS email_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_sm)) AS sms_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM app)) AS app,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM acct)) AS account,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM me_ns) OR p.email IN (SELECT email FROM me_sm) OR p.email IN (SELECT email FROM app)) AS any_ok,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh)) AS fresh_n,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh) AND p.email IN (SELECT email FROM me_ns)) AS fresh_email_ok,
           count(*) FILTER (WHERE p.buyer) AS buyers,
           count(*) FILTER (WHERE p.guest AND NOT p.buyer) AS guests_only,
           COALESCE(sum(p.heads_paid), 0) AS heads_paid, COALESCE(sum(p.amount), 0) AS amount
      FROM people p
  ),
  loyalty AS (
    SELECT count(*) FILTER (WHERE COALESCE(l.nights, 1) <= 1) AS first_time,
           count(*) FILTER (WHERE l.nights = 2) AS second_time, count(*) FILTER (WHERE l.nights >= 3) AS regulars
      FROM people p LEFT JOIN life l ON l.email = p.email
  ),
  fw AS MATERIALIZED (
    SELECT f.follower_user_id, f.action, f.source, f.created_at
      FROM public.audience_follow_events f
     WHERE f.subject_type = v_stype AND f.subject_id = v_sid
       AND f.created_at >= CASE WHEN p_hours IS NULL THEN '-infinity'::timestamptz ELSE v_from - interval '60 days' END
  ),
  fw_sum AS (
    SELECT count(*) FILTER (WHERE action = 'follow' AND created_at >= v_from) AS gained,
           count(*) FILTER (WHERE action = 'unfollow' AND created_at >= v_from) AS lost,
           count(*) FILTER (WHERE action = 'follow' AND created_at >= v_from AND source = 'event_page') AS from_event_page,
           count(DISTINCT follower_user_id) FILTER (WHERE action = 'follow' AND created_at >= v_from
              AND follower_user_id IN (SELECT user_id FROM people WHERE user_id IS NOT NULL)) AS from_attendees,
           count(*) FILTER (WHERE action = 'follow' AND created_at < v_from AND p_hours IS NOT NULL) AS before_follows,
           count(*) FILTER (WHERE action = 'follow' AND created_at >= COALESCE(v_prev_from, v_from) AND created_at < v_from AND p_hours IS NOT NULL) AS prev_gained
      FROM fw
  ),
  snap AS (
    SELECT s.followers_total FROM public.audience_daily_snapshots s
     WHERE s.subject_type = v_stype AND s.subject_id = v_sid ORDER BY s.snapshot_date DESC LIMIT 1
  ),
  win AS (SELECT CASE WHEN p_hours IS NULL THEN COALESCE((SELECT min(at_ts) FROM rows_all), v_now) ELSE v_from END AS from_ts),
  tl_people AS (
    SELECT to_char(p.first_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(*) AS people,
           count(*) FILTER (WHERE p.email IN (SELECT email FROM fresh)) AS fresh
      FROM people p GROUP BY 1
  ),
  tl_fw AS (
    SELECT to_char(created_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(*) AS followers
      FROM fw WHERE action = 'follow' AND created_at >= v_from GROUP BY 1
  ),
  tl_ns AS (
    SELECT to_char(created_at AT TIME ZONE g.tz, 'YYYY-MM-DD') AS date, count(DISTINCT email) AS optins
      FROM ns WHERE opted_in AND created_at >= v_from GROUP BY 1
  ),
  tl_days AS (SELECT date FROM tl_people UNION SELECT date FROM tl_fw UNION SELECT date FROM tl_ns),
  timeline AS (
    SELECT d.date, COALESCE(pp.people, 0) AS people, COALESCE(pp.fresh, 0) AS fresh,
           COALESCE(ff.followers, 0) AS followers, COALESCE(nn.optins, 0) AS optins
      FROM tl_days d LEFT JOIN tl_people pp ON pp.date = d.date LEFT JOIN tl_fw ff ON ff.date = d.date LEFT JOIN tl_ns nn ON nn.date = d.date
     ORDER BY d.date DESC LIMIT 366
  )
  SELECT jsonb_build_object(
    'ok', true, 'now', v_now, 'tz', g.tz, 'money', g.money,
    'scope', CASE WHEN g.scope_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END,
    'me', v_me, 'event', null,
    'period', jsonb_build_object('hours', p_hours, 'from', (SELECT from_ts FROM win), 'to', v_now),
    'window', jsonb_build_object('from', (SELECT from_ts FROM win), 'to', v_now),
    'people', (SELECT jsonb_build_object('total', people, 'buyers', buyers, 'guestsOnly', guests_only, 'headsPaid', heads_paid,
                 'noEmail', (SELECT n FROM no_email), 'spend', CASE WHEN g.money AND buyers > 0 THEN round(amount, 2) END) FROM reach),
    'crm', (SELECT jsonb_build_object('new', fresh_n, 'known', people - fresh_n, 'emailOk', email_ok, 'smsOk', sms_ok, 'app', app,
                 'account', account, 'anyReach', any_ok, 'newEmailOk', fresh_email_ok) FROM reach),
    'loyalty', (SELECT jsonb_build_object('first', first_time, 'second', second_time, 'regulars', regulars) FROM loyalty),
    'retention', null,
    'parties', '[]'::jsonb,
    'followers', (SELECT jsonb_build_object('gained', gained, 'lost', lost, 'eventPage', from_event_page, 'attendees', from_attendees,
                 'total', (SELECT followers_total FROM snap),
                 'baselinePerDay', CASE WHEN p_hours IS NULL THEN 0 ELSE round(before_follows::numeric / 60.0, 2) END) FROM fw_sum),
    'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'people', people, 'fresh', fresh,
                 'followers', followers, 'optins', optins) ORDER BY date) FROM timeline), '[]'::jsonb),
    'previous', CASE WHEN p_hours IS NULL THEN null
                     ELSE jsonb_build_object('people', (SELECT n FROM people_prev), 'followers', (SELECT prev_gained FROM fw_sum)) END
  ) INTO v_result;

  RETURN v_result || jsonb_build_object('takeaways', public.lens_community_takeaways(
    v_result, greatest(1, round(extract(epoch FROM (v_now - (v_result #>> '{period,from}')::timestamptz)) / 86400.0))));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_community_period(p_venue_id text, p_organizer_user_id uuid, p_hours integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_community_period(p_venue_id text, p_organizer_user_id uuid, p_hours integer) TO authenticated, service_role;

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
     WHERE p.kind = 'venue' AND COALESCE(n.source, '') NOT LIKE 'connector:%' AND lower(n.email) IN (SELECT email FROM people)
    UNION ALL
    SELECT p.party_key, lower(n.email), n.opted_in, n.created_at
      FROM parties p
      JOIN public.newsletter_subscriptions n ON n.organizer_user_id = p.organizer_user_id
     WHERE p.kind = 'org' AND COALESCE(n.source, '') NOT LIKE 'connector:%' AND lower(n.email) IN (SELECT email FROM people)
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

  RETURN v_result || jsonb_build_object('takeaways', public.lens_community_takeaways(v_result, greatest(1, round(extract(epoch FROM (v_win_end - v_win_start)) / 86400.0))));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_event_community(p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_event_community(p_event_id uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.collect_email_automations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_holdout integer := 0;
  a RECORD;
  tpl RECORD;
  grp RECORD;
  v_delay interval;
  v_next uuid;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_automations integer := 0;
  v_children uuid[] := '{}';
  v_blocks jsonb;
  v_name text;
  v_label text;
  v_platform boolean;
  -- Une recette « à toute la base » travaille par LOTS : une personne déjà
  -- inscrite au registre pour ce déclencheur n'est plus candidate, le passage
  -- suivant (5 min plus tard) prend le lot suivant. Avant, le LIMIT tombait
  -- AVANT ce filtre : les 5 000 premiers revenaient à chaque passage et le
  -- reste de la base ne recevait jamais rien.
  v_batch constant integer := 3000;
  -- L'appel passe par l'API (plafond de 8 s) : au-delà de ce budget, les
  -- recettes restantes attendent le passage suivant plutôt que de faire
  -- tomber TOUT le passage (et les recettes de tous les comptes avec lui).
  v_started timestamptz := clock_timestamp();
  v_budget_hit boolean := false;
  -- Compte Yuno CRM pur : les e-mails automatiques se paient en Yunits. Ce que
  -- le solde ne couvre pas n'est pas inscrit au registre (il reviendra).
  v_scope text;
  v_rate integer;
  v_room integer;
  v_held integer := 0;
  -- Isolation CRM ⇄ Billetterie : vrai pour une recette du CRM (email_automations.product = 'crm')
  -- ou d'un compte CRM pur ; ces recettes voient les accords du connecteur (connector:%),
  -- les recettes de la Billetterie jamais.
  v_conn_ok boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_email_automations: service_role only';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _auto_cand (
    em text,
    trigger_key text,
    trigger_event_id uuid,
    bind_event_id uuid,
    due_at timestamptz,
    optin boolean,
    user_id uuid,
    first_name text,
    last_name text,
    -- Ordre de priorité entre plusieurs soirées d'un même contact dans un
    -- même passage (la plus proche d'abord) : voir le cooldown intra-passage.
    ord timestamptz
  ) ON COMMIT DROP;

  -- Les pros d'abord, Yuno en dernier : à soirée égale, le pro passe avant (R5).
  -- Puis par PRIORITÉ de recette : un contact ne reçoit qu'une automatisation
  -- par passage (cooldown), c'est donc l'ordre ci-dessous qui décide laquelle —
  -- l'urgent (panier, tarif) avant la relation (merci, on t'a manqué), la vente
  -- (table, dernier appel, annonce) avant l'accueil (bienvenue, reconquête).
  FOR a IN
    SELECT x.*, (x.venue_id IS NULL AND x.organizer_user_id IS NULL) AS is_platform
      FROM public.email_automations x
     WHERE x.enabled AND x.template_id IS NOT NULL AND x.enabled_at IS NOT NULL
       -- Démo : une recette allumée s'affiche, elle n'envoie JAMAIS.
       AND NOT public.is_demo_marketing_scope(x.venue_id, x.organizer_user_id)
     ORDER BY (x.venue_id IS NULL AND x.organizer_user_id IS NULL),
              CASE x.kind
                WHEN 'abandoned_checkout' THEN 0 WHEN 'tier_closing' THEN 1 WHEN 'click_no_buy' THEN 1
                WHEN 'post_event_thanks' THEN 2 WHEN 'post_event_missed' THEN 3
                WHEN 'table_upsell' THEN 4 WHEN 'last_call' THEN 5 WHEN 'new_event' THEN 6
                WHEN 'regular_lapse' THEN 7 WHEN 'first_return' THEN 7 WHEN 'welcome' THEN 8 ELSE 9 END,
              x.created_at
  LOOP
    v_platform := a.is_platform;
    -- Les recettes de SOIRÉE n'ont pas de sens à l'échelle de Yuno : pas de
    -- dernier appel, d'annonce, de palier ni d'upsell à toute la base pour
    -- chaque soirée de chaque club.
    -- « L'habitué décroche » non plus : un rythme de sortie se lit chez UN
    -- club ou UN organisateur, pas sur toute la plateforme.
    IF v_platform AND a.kind IN ('last_call', 'new_event', 'tier_closing', 'table_upsell', 'regular_lapse', 'click_no_buy', 'first_return') THEN CONTINUE; END IF;
    IF clock_timestamp() - v_started > interval '4 seconds' THEN
      v_budget_hit := true;
      EXIT;
    END IF;
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    v_next := CASE WHEN v_platform THEN NULL ELSE public._email_automation_next_event(a.venue_id, a.organizer_user_id) END;
    TRUNCATE _auto_cand;
    v_room := NULL;
    v_holdout := 0;
    v_conn_ok := false;
    IF NOT v_platform THEN
      v_scope := public.crm_scope_key(a.venue_id, a.organizer_user_id);
      v_conn_ok := (a.product IS NOT DISTINCT FROM 'crm')
                   OR a.kind IN ('click_no_buy', 'first_return')
                   OR (v_scope IS NOT NULL AND COALESCE(public.crm_scope_is_crm(v_scope), false));
      IF v_scope IS NOT NULL AND public.crm_scope_is_crm(v_scope) THEN
        -- Témoin (20261013120000) : une part tirée au hasard ne reçoit pas la recette.
        v_holdout := public.crm_holdout_pct(v_scope);
        IF public.crm_effective_plan(v_scope) = 'paused' THEN
          v_room := 0;
        ELSE
          v_rate := GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1));
          v_room := GREATEST(0, COALESCE(public.crm_yunits_balance(v_scope), 0) / v_rate
                    - (SELECT count(*)::integer FROM public.email_automation_sends l
                        WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL));
        END IF;
      END IF;
    END IF;

    -- ── 5a. Candidats par recette ─────────────────────────────────────────
    IF a.kind = 'welcome' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'once', NULL, v_next, s.created_at + v_delay, true, s.user_id, s.first_name, s.last_name, s.created_at + v_delay
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.import_id IS NULL
         AND COALESCE(s.source, '') NOT LIKE 'import%'
         AND (v_platform OR COALESCE(s.source, '') NOT LIKE 'platform%')
         AND COALESCE(s.source, '') NOT LIKE 'checkout%'
         -- Yuno CRM : un accord rapporté par une billetterie connectée n'est pas
         -- une inscription : jamais de « bienvenue » à tout un historique importé.
         AND COALESCE(s.source, '') NOT LIKE 'connector%'
         AND COALESCE(s.source, '') NOT LIKE 'platform:checkout%'
         AND s.created_at >= a.enabled_at
         AND s.created_at >= now() - interval '14 days'
         AND s.created_at + v_delay <= now()
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email))
       LIMIT 500;

    ELSIF a.kind = 'abandoned_checkout' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(x.em), x.event_id)
             lower(x.em), x.event_id::text, x.event_id, x.event_id, x.created_at + v_delay,
             x.optin, x.user_id, x.first_name, x.last_name, x.created_at + v_delay
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at, COALESCE(t.newsletter_opt_in, false) AS optin, t.user_id,
                 COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS first_name,
                 COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS last_name
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND t.created_at >= a.enabled_at
             AND t.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at, COALESCE(r.newsletter_opt_in, false), r.user_id,
                 COALESCE(r.guest_first_name, NULLIF(split_part(btrim(COALESCE(r.full_name, '')), ' ', 1), '')),
                 COALESCE(r.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(r.full_name, ''), '^\S+\s*', '')), ''))
            FROM public.table_reservations r
            JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND r.created_at >= a.enabled_at
             AND r.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
        ) x
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = x.event_id::text AND lower(l.email) = lower(x.em))
       ORDER BY lower(x.em), x.event_id, x.optin DESC, x.created_at DESC
       LIMIT 500;

      -- L'accord coché au checkout est versé dans le registre du CLUB ou de
      -- l'ORGANISATEUR (c'est leur case, pas celle de Yuno).
      IF a.venue_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.venue_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      ELSIF a.organizer_user_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.organizer_user_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      END IF;

    ELSIF a.kind = 'last_call' THEN
      -- N h avant chaque soirée qui a encore quelque chose à vendre : toute la
      -- base opt-in (imports compris), les plus engagés d'abord, par lots
      -- (v_batch) : qui est déjà au registre pour cette soirée sort du lot.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
           AND (v_conn_ok OR COALESCE(s.source, '') NOT LIKE 'connector:%')
         WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.start_at > a.enabled_at
           AND e.start_at - v_delay <= now()
           AND e.start_at > now() + interval '2 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, now(), true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'new_event' THEN
      -- Annonce d'une soirée PUBLIÉE (published_at, jamais created_at, jamais
      -- une re-génération de modèle récurrent), N h après la mise en ligne, à
      -- toute la base opt-in — c'est LA recette qui met un fichier importé au
      -- travail. Le jugement écarte la rafale (une seule annonce par
      -- publication groupée sous 24 h) puis applique le cooldown.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, e.published_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
           AND (v_conn_ok OR COALESCE(s.source, '') NOT LIKE 'connector:%')
         WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
           AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.published_at IS NOT NULL
           AND e.published_at >= a.enabled_at
           AND e.published_at >= now() - interval '7 days'
           AND e.published_at + v_delay <= now()
           AND e.start_at > now() + interval '48 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND (e.recurring_template_id IS NULL OR NOT EXISTS (
                 SELECT 1 FROM public.events e2
                  WHERE e2.recurring_template_id = e.recurring_template_id
                    AND e2.id <> e.id AND e2.created_at < e.created_at))
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, p.published_at + v_delay, true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'table_upsell' THEN
      -- « Passe en table » : N h avant le début, aux détenteurs d'un billet
      -- payé, tant que la soirée ouvre des tables et qu'il en reste au moins
      -- une (même calcul que le bloc Table VIP de l'email : formules actives
      -- moins réservations, formules marquées complètes exclues).
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(t.user_email), e.id)
             lower(t.user_email), e.id::text, e.id, e.id, now(), true, t.user_id,
             COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')),
             COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')),
             e.start_at
        FROM public.events e
        JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
        JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
       WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
         AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
           OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
         AND e.tables_enabled AND NOT e.tables_sold_out
         AND COALESCE(tl.n, 0) > 0
         AND e.start_at > a.enabled_at
         AND e.start_at - v_delay <= now()
         AND e.start_at > now() + interval '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(t.user_email))
       ORDER BY lower(t.user_email), e.id, t.created_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'tier_closing' THEN
      -- « Le tarif monte » : le palier ouvert a dépassé le seuil, il reste au
      -- moins un billet et un palier suivant plus cher existe. Cible = ceux qui
      -- ont montré un intérêt sans acheter : clic sur la soirée dans un email
      -- de la portée, ou inscrit en liste d'attente. Un seul envoi par personne
      -- et par soirée, quel que soit le nombre de paliers.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (p.em, p.event_id)
             p.em, p.event_id::text, p.event_id, p.event_id, now(), true, NULL, NULL, NULL, p.start_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.slug, e.start_at
              FROM public.events e
              JOIN LATERAL (
                SELECT r.position, r.price
                  FROM public.ticket_rounds r
                 WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
                   AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
                   AND r.tickets_sold * 100 >= r.max_tickets * a.threshold_pct
                 ORDER BY r.position LIMIT 1
              ) cur ON true
             WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
               AND e.ticketing_enabled AND NOT e.tickets_sold_out
               AND e.start_at > a.enabled_at
               AND e.start_at > now() + interval '2 hours'
               AND EXISTS (
                 SELECT 1 FROM public.ticket_rounds n
                  WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                    AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
          )
          SELECT ev.id AS event_id, lower(x.recipient_email) AS em, ev.start_at
            FROM ev
            JOIN public.email_campaigns c
              ON public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
           WHERE x.created_at > now() - interval '60 days'
             AND x.recipient_email IS NOT NULL
             AND (
               (c.event_id = ev.id AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '')
                  ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)')
               OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || ev.id::text || '%'
               OR (ev.slug IS NOT NULL AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/events/%/' || ev.slug || '%')
             )
          UNION
          SELECT w.event_id, lower(w.email), ev.start_at
            FROM public.event_waitlist w JOIN ev ON ev.id = w.event_id
           WHERE w.email IS NOT NULL
        ) p
       WHERE p.em IS NOT NULL AND position('@' in p.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em)
       ORDER BY p.em, p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'click_no_buy' THEN
      -- « A cliqué sans acheter » : un clic NOMINATIF dans un e-mail de la
      -- portée vers la billetterie d'une soirée à venir, puis aucune place à
      -- la même adresse N h après le DERNIER clic (jugé plus bas, au moment
      -- où l'envoi est dû). Une visite venue d'ailleurs est anonyme : jamais
      -- ici. Une relance due depuis plus de 24 h ne part plus.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT k.em, k.eid::text, k.eid, k.eid, k.last_click + v_delay, true, NULL, NULL, NULL, k.start_at
        FROM (
          SELECT lower(x.recipient_email) AS em, e.id AS eid, e.start_at, max(x.created_at) AS last_click
            FROM public.email_campaigns c
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
            JOIN public.events e
              ON e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
             AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND e.start_at > now() + interval '2 hours'
             AND NOT e.tickets_sold_out
             AND (
               -- Bouton d'un e-mail CRM : la page de CETTE soirée sur la billetterie connectée.
               (e.external_ticket_url IS NOT NULL
                AND public._link_base(COALESCE(x.metadata->'click'->>'link', x.metadata->>'link')) = public._link_base(e.external_ticket_url))
               -- Lien Yuno (suivi /l/, page soirée) d'une campagne reliée à cette soirée.
               OR (c.event_id = e.id
                   AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/')
             )
           WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
             AND x.recipient_email IS NOT NULL
             AND x.created_at > now() - v_delay - interval '24 hours'
             -- Un vrai destinataire de la campagne : jamais l'envoi de test du pro.
             AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                          WHERE r.campaign_id = c.id AND lower(r.email) = lower(x.recipient_email))
           GROUP BY lower(x.recipient_email), e.id, e.start_at
        ) k
       WHERE k.last_click + v_delay <= now()
         AND k.last_click + v_delay > now() - interval '24 hours'
         AND position('@' in k.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = k.eid::text AND lower(l.email) = k.em)
       ORDER BY k.start_at, k.em
       LIMIT v_batch;

    ELSIF a.kind IN ('post_event_thanks', 'post_event_missed') THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(p.em), p.event_id)
             lower(p.em), p.event_id::text, p.event_id, v_next, now(), true, NULL, NULL, NULL, p.end_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.end_at
              FROM public.events e
             WHERE e.status = 'active' AND e.cancelled_at IS NULL
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
               AND e.end_at >= a.enabled_at
               AND e.end_at + v_delay <= now()
               AND e.end_at >= now() - interval '5 days'
          ),
          came AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND ge.entry_scanned
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          holders AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'confirmed', 'used')
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          -- « On t'a manqué » seulement sur une soirée à porte mesurée
          -- (_crm_door_measured : au moins 10 détenteurs scannés et 10 % d'entre
          -- eux, 20261020200000). Shotgun laisse le scan vide
          -- quand un AUTRE prestataire a scanné, et une porte qui a arrêté de
          -- scanner ferait écrire « on t'a manqué » à des gens venus.
          scanned_events AS (
            SELECT hc.event_id FROM (SELECT event_id, count(*) AS n FROM holders GROUP BY event_id) hc
              JOIN (SELECT event_id, count(*) AS n FROM came GROUP BY event_id) cc ON cc.event_id = hc.event_id
             WHERE public._crm_door_measured(hc.n, cc.n))
          SELECT c.event_id, c.em, ev.end_at FROM came c JOIN ev ON ev.id = c.event_id WHERE a.kind = 'post_event_thanks'
          UNION ALL
          SELECT h.event_id, h.em, ev.end_at FROM holders h
            JOIN ev ON ev.id = h.event_id
            JOIN scanned_events se ON se.event_id = h.event_id
           WHERE a.kind = 'post_event_missed'
             AND NOT EXISTS (SELECT 1 FROM came c WHERE c.event_id = h.event_id AND c.em = h.em)
        ) p
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = lower(p.em))
       ORDER BY lower(p.em), p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'win_back' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'wb-' || to_char(now(), 'YYYY-MM'), NULL, v_next, now(), true, s.user_id, s.first_name, s.last_name, now()
        FROM public.newsletter_subscriptions s
        JOIN (
          SELECT x.em, max(x.at) AS last_at FROM (
            SELECT lower(t.user_email) AS em, t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
             WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT lower(r.user_email), r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'confirmed', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT lower(ge.email), ge.entry_scanned_at FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
             WHERE ge.email IS NOT NULL AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT lower(xt.buyer_email), COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
             WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND xt.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND xt.organizer_user_id = a.organizer_user_id))
          ) x
         GROUP BY x.em
        ) act ON act.em = lower(s.email)
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND (v_conn_ok OR COALESCE(s.source, '') NOT LIKE 'connector:%')
         AND act.last_at IS NOT NULL
         AND act.last_at <= now() - v_delay
         AND act.last_at > now() - v_delay - interval '120 days'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '180 days'
         )
         -- L'habitué relancé par « il décroche » n'est pas reconquis trois
         -- semaines plus tard : la même personne, le même silence, un seul email.
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.kind = 'regular_lapse' AND l.status = 'queued' AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '60 days'
              AND l.venue_id IS NOT DISTINCT FROM a.venue_id
              AND l.organizer_user_id IS NOT DISTINCT FROM a.organizer_user_id
         )
      ORDER BY public._email_engagement_rank(lower(s.email), a.venue_id, a.organizer_user_id) ASC, act.last_at DESC
       LIMIT 300;

    ELSIF a.kind = 'regular_lapse' THEN
      -- « L'habitué décroche » : deux sorties par mois puis plus rien depuis
      -- N jours (six semaines par défaut). Détection et choix de la soirée
      -- par personne dans _regular_lapse_candidates (ses goûts : la série qu'il
      -- fréquentait, ses genres, son jour de sortie). Un épisode de silence =
      -- un email (trigger_key = date de la dernière venue), et pas plus d'un
      -- tous les 120 jours. Sans aucune soirée à venir, personne : une
      -- invitation sans soirée n'invite à rien — le prochain passage le reprend.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT r.em, 'rl-' || to_char(r.last_at, 'YYYY-MM-DD'), NULL, COALESCE(r.pick_event_id, v_next), now(), true,
             COALESCE(s.user_id, r.user_id), s.first_name, s.last_name, now()
        FROM public._regular_lapse_candidates(a.venue_id, a.organizer_user_id, v_delay) r
        JOIN LATERAL (
          SELECT s.user_id, s.first_name, s.last_name
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
             AND (v_conn_ok OR COALESCE(s.source, '') NOT LIKE 'connector:%')
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           LIMIT 1
        ) s ON true
       WHERE COALESCE(r.pick_event_id, v_next) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = r.em
              AND l.created_at > now() - interval '120 days'
         )
       ORDER BY public._email_engagement_rank(r.em, a.venue_id, a.organizer_user_id) ASC, r.last_at DESC
       LIMIT 300;

    ELSIF a.kind = 'first_return' THEN
      -- « Faire revenir après la 1re soirée » (20261011130000) : venus une seule
      -- fois, pas de passage, la 1re soirée finie depuis le délai médian de
      -- retour du compte ; la soirée choisie POUR la personne (concept, artiste
      -- déjà vu, genre, jour) dans _first_return_candidates. Une fois par
      -- personne (trigger_key 'fr'). Rien sans soirée à venir.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT r.em, 'fr', NULL, COALESCE(r.pick_event_id, v_next), r.due_at, true,
             s.user_id, s.first_name, s.last_name, r.due_at
        FROM public._first_return_candidates(a.venue_id, a.organizer_user_id, a.enabled_at - interval '7 days') r
        JOIN LATERAL (
          SELECT s.user_id, s.first_name, s.last_name
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
             AND (v_conn_ok OR COALESCE(s.source, '') NOT LIKE 'connector:%')
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           LIMIT 1
        ) s ON true
       WHERE COALESCE(r.pick_event_id, v_next) IS NOT NULL
       ORDER BY public._email_engagement_rank(r.em, a.venue_id, a.organizer_user_id) ASC, r.due_at ASC
       LIMIT 300;
    END IF;

    -- ── 5b. Jugement, au moment où l'envoi est dû ─────────────────────────
    WITH cand AS (
      SELECT DISTINCT ON (c.em, c.trigger_key) c.*
        FROM _auto_cand c
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = c.trigger_key AND lower(l.email) = c.em
       )
       ORDER BY c.em, c.trigger_key, c.optin DESC
    ),
    -- Règles Yuno (pression, fatigue, aversion) calculées en UNE passe sur
    -- tout le lot : appelées ligne à ligne, elles coûtaient ~1 ms par contact
    -- (14 s pour une base de 12 000), au-delà du plafond de l'API.
    pol AS (
      SELECT p.email, p.reason
        FROM public._email_send_policy_many(ARRAY(SELECT DISTINCT c.em FROM cand c), a.kind) p
    ),
    -- Rafale de publications : jugée une fois par SOIRÉE, pas par contact.
    burst AS (
      SELECT x.eid FROM (SELECT DISTINCT c.trigger_event_id AS eid FROM cand c
                          WHERE a.kind = 'new_event' AND c.trigger_event_id IS NOT NULL) x
       WHERE EXISTS (
         SELECT 1 FROM public.events e
           JOIN public.events e2 ON e2.id <> e.id
            AND e2.status = 'active' AND (e2.is_active OR e2.external_source IS NOT NULL) AND e2.cancelled_at IS NULL
            AND (e2.visibility = 'public' OR e2.external_source IS NOT NULL)
            AND e2.venue_id IS NOT DISTINCT FROM e.venue_id
            AND e2.organizer_user_id IS NOT DISTINCT FROM e.organizer_user_id
            AND e2.published_at IS NOT NULL AND e2.published_at >= a.enabled_at
            AND abs(extract(epoch FROM (e2.published_at - e.published_at))) <= 86400
            AND e2.start_at > now() + interval '48 hours'
            AND (e2.start_at < e.start_at OR (e2.start_at = e.start_at AND e2.id < e.id))
          WHERE e.id = x.eid)
    ),
    judged0 AS (
      SELECT c.*,
             CASE
               WHEN c.trigger_event_id IS NOT NULL
                    AND a.kind IN ('last_call', 'abandoned_checkout', 'table_upsell', 'tier_closing', 'new_event', 'click_no_buy')
                    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.trigger_event_id AND e.start_at <= now())
                 THEN 'event_over'
               -- R5 : quelqu'un d'autre (club, orga du co-event, Yuno) l'a déjà
               -- écrit pour cette soirée et cette recette.
               WHEN c.trigger_event_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.kind = a.kind AND l.trigger_event_id = c.trigger_event_id
                    AND lower(l.email) = c.em AND l.status = 'queued'
               ) THEN 'already_event'
               -- Rafale de publications : un club qui met 6 dates en ligne
               -- d'un coup n'annonce que la plus proche ; les autres sont
               -- tracées ici pour que le bilan l'explique.
               WHEN a.kind = 'new_event' AND c.trigger_event_id IN (SELECT b.eid FROM burst b) THEN 'already_event'
               WHEN public.is_email_suppressed(c.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND (v_conn_ok OR COALESCE(s.source, '') NOT LIKE 'connector:%')
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
               ) THEN CASE WHEN a.kind = 'abandoned_checkout' THEN 'no_consent' ELSE 'unsubscribed' END
               WHEN a.kind = 'table_upsell' AND EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = c.trigger_event_id AND lower(r.user_email) = c.em
                    AND r.status IN ('paid', 'used', 'confirmed', 'pending')
               ) THEN 'has_table'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE r.event_id = c.trigger_event_id AND r.status IN ('paid', 'confirmed', 'used') AND lower(r.user_email) = c.em)
                 -- Yuno CRM : déjà acheté sur la billetterie connectée.
                 OR EXISTS (SELECT 1 FROM public.external_tickets xt
                             WHERE xt.event_id = c.trigger_event_id AND xt.status IN ('valid', 'transferred')
                               AND (lower(xt.buyer_email) = c.em OR lower(xt.holder_email) = c.em))
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               -- Une automatisation par 48 h et par portée ; les trois recettes
               -- URGENTES (panier abandonné, tarif qui monte, clic sans achat)
               -- font exception : elles répondent à un geste du client.
               WHEN a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy') AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.status = 'queued' AND lower(l.email) = c.em
                    AND l.created_at > now() - interval '48 hours'
                    AND ((a.venue_id IS NOT NULL AND l.venue_id = a.venue_id)
                      OR (a.organizer_user_id IS NOT NULL AND l.organizer_user_id = a.organizer_user_id)
                      OR (v_platform AND l.venue_id IS NULL AND l.organizer_user_id IS NULL))
               ) THEN 'cooldown'
               -- Règles Yuno (pression, fatigue, aversion), tous expéditeurs.
               ELSE pol.reason
             END AS reason
        FROM cand c
        LEFT JOIN pol ON pol.email = c.em
    ),
    -- Cooldown INTRA-passage : plusieurs soirées dues en même temps pour un
    -- même contact (trois dates à J-3, six publications d'un coup) ne font
    -- qu'UN email — la plus proche ; les autres sont tracées « cooldown ».
    -- Les lignes insérées par une même instruction sont invisibles aux
    -- sous-requêtes du CASE ci-dessus, d'où ce second temps.
    judged AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE
               WHEN j.reason IS NULL AND a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy')
                    AND row_number() OVER (PARTITION BY j.em, (j.reason IS NULL) ORDER BY j.ord NULLS LAST, j.trigger_key) > 1
                 THEN 'cooldown'
               ELSE j.reason
             END AS reason
        FROM judged0 j
    ),
    -- Yunits : seuls les v_room premiers envois dus entrent au registre ; les
    -- autres reviennent au passage suivant (après une recharge).
    -- « 10 % non contactés, pour mesurer l'effet réel » (20261013120000) :
    -- parmi ceux qui allaient recevoir la recette, AVANT le compte des Yunits.
    judged1 AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE WHEN j.reason IS NULL AND v_holdout > 0
                       AND public._crm_holdout_pick(a.id::text || ':' || j.trigger_key, j.em, v_holdout)
                  THEN 'holdout' ELSE j.reason END AS reason
        FROM judged j
    ),
    judged2 AS (
      SELECT j.*,
             CASE WHEN j.reason IS NULL
                  THEN row_number() OVER (PARTITION BY (j.reason IS NULL) ORDER BY j.due_at, j.em, j.trigger_key) END AS qn
        FROM judged1 j
    ),
    held AS (
      SELECT count(*)::integer AS n FROM judged2 j
       WHERE j.reason IS NULL AND v_room IS NOT NULL AND j.qn > v_room
    ),
    ins AS (
      INSERT INTO public.email_automation_sends
        (automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
         email, status, skip_reason, due_at)
      SELECT a.id, a.venue_id, a.organizer_user_id, a.kind, j.trigger_key, j.trigger_event_id, j.bind_event_id,
             j.em, CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason, j.due_at
        FROM judged2 j
       WHERE j.reason IS NOT NULL OR v_room IS NULL OR j.qn <= v_room
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT v_queued + count(*) FILTER (WHERE status = 'queued'), v_skipped + count(*) FILTER (WHERE status = 'skipped'),
           v_held + (SELECT h.n FROM held h)
      INTO v_queued, v_skipped, v_held FROM ins;

    -- ── 5c. Campagnes enfants ─────────────────────────────────────────────
    SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = a.template_id;
    IF tpl.id IS NULL THEN CONTINUE; END IF;

    FOR grp IN
      SELECT l.bind_event_id, l.trigger_event_id, count(*) AS n
        FROM public.email_automation_sends l
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
       GROUP BY l.bind_event_id, l.trigger_event_id
    LOOP
      SELECT c.id INTO v_child
        FROM public.email_campaigns c
       WHERE c.automation_id = a.id
         AND c.event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND c.automation_trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
         AND (grp.bind_event_id IS NOT NULL OR grp.trigger_event_id IS NOT NULL
              OR c.created_at >= date_trunc('month', now()))
         AND c.status NOT IN ('cancelled', 'failed')
       ORDER BY c.created_at DESC
       LIMIT 1;

      IF v_child IS NULL THEN
        SELECT COALESCE(e.title, '') INTO v_label
          FROM public.events e WHERE e.id = COALESCE(grp.trigger_event_id, grp.bind_event_id);
        IF v_label IS NULL OR v_label = '' THEN v_label := to_char(now(), 'YYYY-MM'); END IF;
        v_name := left(COALESCE(NULLIF(tpl.name, ''), a.kind) || ' · ' || v_label, 80);
        v_blocks := CASE WHEN grp.bind_event_id IS NULL
                         THEN public._email_blocks_without_live(tpl.blocks_json)
                         ELSE COALESCE(tpl.blocks_json, '[]'::jsonb) END;
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
           theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
           quiet_hours, automation_id, automation_trigger_event_id, child_kind, total_recipients, created_by)
        VALUES
          (a.venue_id, a.organizer_user_id, v_name, 'promotional',
           COALESCE(NULLIF(a.subject, ''), NULLIF(tpl.subject, ''), tpl.name), COALESCE(tpl.preheader, ''),
           v_blocks, 2,
           COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
           grp.bind_event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
           true, a.id, grp.trigger_event_id, 'automation', 0, COALESCE(a.created_by, tpl.created_by))
        RETURNING id INTO v_child;
      END IF;

      WITH todo AS (
        SELECT l.id, lower(l.email) AS em
          FROM public.email_automation_sends l
         WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
           AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
           AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
      ),
      ins AS (
        INSERT INTO public.email_campaign_recipients
          (campaign_id, email, first_name, last_name, unsubscribe_token, status)
        SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
          FROM todo t
          LEFT JOIN LATERAL (
            SELECT s.first_name, s.last_name, s.unsubscribe_token
              FROM public.newsletter_subscriptions s
             WHERE lower(s.email) = t.em
               AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
             LIMIT 1
          ) s ON true
        ON CONFLICT (campaign_id, lower(email)) DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO v_new FROM ins;

      UPDATE public.email_automation_sends l
         SET campaign_id = v_child
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
         AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id;

      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

      v_enqueued := v_enqueued + v_new;
      v_children := array_append(v_children, v_child);
      v_child := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'automations', v_automations, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children),
    'budget_hit', v_budget_hit,
    'yunits_held', v_held
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.collect_email_automations() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.collect_email_automations() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_automation_suggestions_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s WHERE s.venue_id = ve.id AND s.opted_in AND s.opted_out_at IS NULL
                      AND COALESCE(s.source, '') NOT LIKE 'connector:%')
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
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s WHERE s.organizer_user_id = e.organizer_user_id AND s.opted_in AND s.opted_out_at IS NULL
                      AND COALESCE(s.source, '') NOT LIKE 'connector:%')
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
$function$;
REVOKE ALL ON FUNCTION public.email_automation_suggestions_sweep() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.email_automation_suggestions_sweep() TO service_role;
