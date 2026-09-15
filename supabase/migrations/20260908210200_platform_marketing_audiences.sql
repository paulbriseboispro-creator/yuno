-- ───────────────────────────────────────────────────────────────────────────
-- Marketing plateforme — la résolution d'audience.
--
-- Email : `resolve_campaign_audience` gagne une TROISIÈME branche, lue quand
-- la campagne n'a ni club ni organisateur. Elle ne va chercher personne
-- ailleurs que dans le registre plateforme : pas de lecture directe de
-- `profiles`, `launch_waitlist` ou `links_pro_leads` au moment de l'envoi.
-- La raison est le jeton de désinscription — il n'existe que sur une ligne
-- `newsletter_subscriptions`, et un email marketing sans porte de sortie ne
-- doit jamais partir. `sync_platform_marketing_contacts` est le seul pont.
--
-- Audience vide ⇒ PERSONNE. Le miroir v1 (`audience_type`) n'a aucun chemin
-- plateforme : une campagne plateforme dont `audiences_json` est vide ne part
-- à personne, jamais « à toute la base ».
--
-- SMS : même créneau (les deux colonnes de portée à NULL) et deux types de
-- segment nouveaux, `pros` et `clients`, qui lisent l'origine dans le registre
-- email plateforme — c'est le seul endroit qui la porte.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
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
      SELECT DISTINCT LOWER(r.email) AS addr
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.venue_id IS NULL AND cs.organizer_user_id IS NULL
        CROSS JOIN LATERAL public.resolve_contact_segment_def(NULL, NULL, cs.definition) r
       WHERE r.email IS NOT NULL
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(p.first_name, ns.first_name) AS fname,
             COALESCE(p.last_name,  ns.last_name)  AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(ns.source, '') AS src,
             EXISTS (SELECT 1 FROM public.tickets t
                      WHERE LOWER(t.user_email) = LOWER(ns.email) AND t.status = 'paid') AS bought
        FROM public.newsletter_subscriptions ns
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_audiences) a
          WHERE CASE a->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'clients'    THEN s.src = 'platform:clients'
            WHEN 'pros'       THEN s.src = 'platform:pros'
            WHEN 'waitlist'   THEN s.src = 'platform:waitlist'
            WHEN 'leads'      THEN s.src = 'platform:leads'
            WHEN 'app_users'  THEN s.uid IS NOT NULL
            WHEN 'no_account' THEN s.uid IS NULL
            WHEN 'buyers'     THEN s.bought
            WHEN 'contact_segment' THEN s.addr IN (SELECT ce.addr FROM cseg ce)
            WHEN 'import'     THEN s.imp IS NOT NULL
                                   AND s.imp::text = lower(COALESCE(a->>'importId',''))
            ELSE false
          END)
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
        SELECT DISTINCT LOWER(seg.email) AS addr
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
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
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_audiences) a
            WHERE CASE a->>'kind'
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
              WHEN 'segment' THEN s.addr IN (SELECT se.addr FROM seg_emails se)
              WHEN 'contact_segment' THEN s.addr IN (SELECT ce.addr FROM cseg ce)
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END)
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
      SELECT LOWER(t.user_email) AS addr,
             SUM(t.total_price)::numeric AS spent,
             COUNT(DISTINCT t.event_id) AS visits,
             MAX(t.created_at) AS last_seen,
             MAX(t.full_name) AS full_name
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
       WHERE t.status = 'paid' AND t.user_email IS NOT NULL
         AND (e.organizer_user_id = v_campaign.organizer_user_id
              OR e.partner_organizer_id = v_campaign.organizer_user_id)
       GROUP BY LOWER(t.user_email)
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(p.first_name, ns.first_name, SPLIT_PART(COALESCE(a.full_name,''), ' ', 1)) AS fname,
             COALESCE(p.last_name, ns.last_name,
                      NULLIF(REGEXP_REPLACE(COALESCE(a.full_name,''), '^\S+\s*', ''), '')) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_audiences) a2
          WHERE CASE a2->>'kind'
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
            WHEN 'contact_segment' THEN s.addr IN (SELECT ce.addr FROM cseg ce)
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END)
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
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
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
      SELECT LOWER(t.user_email) AS email,
             SUM(t.total_price)::numeric AS spent,
             COUNT(DISTINCT t.event_id) AS visits,
             MAX(t.created_at) AS last_seen,
             MAX(t.full_name) AS full_name
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      WHERE t.status = 'paid' AND t.user_email IS NOT NULL
        AND (e.organizer_user_id = v_campaign.organizer_user_id OR e.partner_organizer_id = v_campaign.organizer_user_id)
      GROUP BY LOWER(t.user_email)
    )
    SELECT a.email::text,
           SPLIT_PART(COALESCE(a.full_name,''), ' ', 1)::text,
           NULLIF(REGEXP_REPLACE(COALESCE(a.full_name,''), '^\S+\s*', ''), '')::text,
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_campaign_recipients(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_queued integer := 0;
  v_suppressed integer := 0;
  v_total integer := 0;
  v_sent integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: service_role only';
  END IF;

  -- Une seule instruction : pas de table temporaire (une RPC rejouée dans la
  -- même transaction la trouverait déjà créée). Les deux INSERT visent des
  -- sous-ensembles DISJOINTS (supprimées / non supprimées), donc aucun conflit
  -- croisé entre les deux CTE.
  WITH aud AS (
    SELECT DISTINCT ON (lower(a.email))
           lower(a.email) AS addr, a.first_name AS fname, a.last_name AS lname,
           a.unsubscribe_token AS tok
      FROM public.resolve_campaign_audience(p_campaign_id) a
     WHERE a.email IS NOT NULL AND position('@' in a.email) > 1
     ORDER BY lower(a.email)
  ), flagged AS (
    SELECT addr, fname, lname, tok, public.is_email_suppressed(addr) AS supp FROM aud
  ), ins AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, unsubscribe_token, status)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, f.tok, 'pending'
      FROM flagged f WHERE NOT f.supp
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  ), sup AS (
    -- Trace des adresses écartées : l'owner doit pouvoir expliquer l'écart
    -- entre « ma liste fait 5 000 » et « 4 812 envoyés ».
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, status, error_message)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, 'suppressed',
           'Adresse sur la liste de suppression (bounce ou plainte)'
      FROM flagged f WHERE f.supp
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins), (SELECT count(*) FROM flagged WHERE supp)
    INTO v_queued, v_suppressed;

  -- Personnalisation des contacts importés : resolve_campaign_audience lit les
  -- prénoms dans `profiles` via user_id, or un contact importé n'a pas de
  -- profil. On complète depuis la fiche d'abonnement, qui elle les porte.
  UPDATE public.email_campaign_recipients r
     SET first_name = COALESCE(r.first_name, ns.first_name),
         last_name  = COALESCE(r.last_name,  ns.last_name)
    FROM public.email_campaigns c
    JOIN public.newsletter_subscriptions ns
      ON public.marketing_scope_match(ns.venue_id, ns.organizer_user_id,
                                      c.venue_id, c.organizer_user_id)
   WHERE c.id = p_campaign_id
     AND r.campaign_id = p_campaign_id
     AND lower(ns.email) = lower(r.email)
     AND (r.first_name IS NULL OR r.last_name IS NULL)
     AND (ns.first_name IS NOT NULL OR ns.last_name IS NOT NULL);

  SELECT count(*), count(*) FILTER (WHERE status = 'sent')
    INTO v_total, v_sent
    FROM public.email_campaign_recipients
   WHERE campaign_id = p_campaign_id AND status <> 'suppressed';

  UPDATE public.email_campaigns
     SET total_recipients = v_total,
         suppressed_count = v_suppressed,
         recipients_count = v_sent,
         send_started_at = COALESCE(send_started_at, now()),
         status = CASE WHEN v_total > v_sent THEN 'sending' ELSE status END,
         paused_reason = NULL,
         error_message = NULL
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'queued', v_queued, 'suppressed', v_suppressed,
    'total', v_total, 'already_sent', v_sent, 'remaining', v_total - v_sent
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.resolve_sms_campaign_recipients(p_venue_id text, p_organizer_user_id uuid, p_segment_type text, p_event_id uuid DEFAULT NULL::uuid, p_import_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(contact_id uuid, phone_e164 text, full_name text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: service_role only';
  END IF;
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_sms_campaign_recipients: une seule portée à la fois';
  END IF;

  RETURN QUERY
  WITH cseg AS (
    SELECT r.phone_e164 AS ph
      FROM public.contact_segments cs
      CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
     WHERE p_segment_id IS NOT NULL AND cs.id = p_segment_id
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND r.phone_e164 IS NOT NULL
  )
  SELECT DISTINCT ON (c.phone_e164)
         c.id, c.phone_e164, c.full_name, c.user_id
    FROM public.venue_sms_contacts c
   WHERE NOT c.unsubscribed
     AND c.sms_consent_at > now() - interval '36 months'
     AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
     AND (
       public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     )
     AND CASE COALESCE(p_segment_type, 'all')
           WHEN 'event'  THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
           WHEN 'vip'    THEN c.is_vip
           WHEN 'import' THEN p_import_id IS NOT NULL AND c.import_id = p_import_id
           WHEN 'contact_segment' THEN p_segment_id IS NOT NULL AND c.phone_e164 IN (SELECT ph FROM cseg)
           -- Portée plateforme : pro ou client se lit dans le registre
           -- email plateforme, seul endroit qui porte l'origine.
           WHEN 'pros'    THEN EXISTS (
             SELECT 1 FROM public.newsletter_subscriptions ns
              WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                AND lower(ns.email) = lower(c.email)
                AND ns.source IN ('platform:pros','platform:leads'))
           WHEN 'clients' THEN EXISTS (
             SELECT 1 FROM public.newsletter_subscriptions ns
              WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                AND lower(ns.email) = lower(c.email)
                AND ns.source IN ('platform:clients','platform:waitlist'))
           WHEN 'not_event' THEN p_event_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM public.tickets t
                WHERE t.event_id = p_event_id
                  AND t.status <> 'refunded' AND t.cancelled_at IS NULL
                  AND public.normalize_phone_e164(COALESCE(t.phone, t.guest_phone)) = c.phone_e164
             )
             AND NOT EXISTS (
               SELECT 1 FROM public.table_reservations tr
                WHERE tr.event_id = p_event_id
                  AND tr.status <> 'refunded'
                  AND public.normalize_phone_e164(COALESCE(tr.phone, tr.guest_phone)) = c.phone_e164
             )
           ELSE true
         END
   ORDER BY c.phone_e164, c.sms_consent_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_sms_campaign_recipients(p_venue_id text, p_organizer_user_id uuid, p_segment_type text, p_event_id uuid DEFAULT NULL::uuid, p_import_id uuid DEFAULT NULL::uuid, p_segment_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  WITH cseg AS (
    SELECT r.phone_e164 AS ph
      FROM public.contact_segments cs
      CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
     WHERE p_segment_id IS NOT NULL AND cs.id = p_segment_id
       AND public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND r.phone_e164 IS NOT NULL
  )
  SELECT count(*) INTO v_count
    FROM (
      SELECT DISTINCT c.phone_e164
        FROM public.venue_sms_contacts c
       WHERE NOT c.unsubscribed
         AND c.sms_consent_at > now() - interval '36 months'
         AND c.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         AND (
           public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
         )
         AND CASE COALESCE(p_segment_type, 'all')
               WHEN 'event'  THEN p_event_id IS NOT NULL AND c.source_event_id = p_event_id
               WHEN 'vip'    THEN c.is_vip
               WHEN 'import' THEN p_import_id IS NOT NULL AND c.import_id = p_import_id
               WHEN 'contact_segment' THEN p_segment_id IS NOT NULL AND c.phone_e164 IN (SELECT ph FROM cseg)
               -- Portée plateforme : pro ou client se lit dans le registre
               -- email plateforme, seul endroit qui porte l'origine.
               WHEN 'pros'    THEN EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions ns
                  WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                    AND lower(ns.email) = lower(c.email)
                    AND ns.source IN ('platform:pros','platform:leads'))
               WHEN 'clients' THEN EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions ns
                  WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
                    AND lower(ns.email) = lower(c.email)
                    AND ns.source IN ('platform:clients','platform:waitlist'))
               WHEN 'not_event' THEN p_event_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = p_event_id
                      AND t.status <> 'refunded' AND t.cancelled_at IS NULL
                      AND public.normalize_phone_e164(COALESCE(t.phone, t.guest_phone)) = c.phone_e164
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM public.table_reservations tr
                    WHERE tr.event_id = p_event_id
                      AND tr.status <> 'refunded'
                      AND public.normalize_phone_e164(COALESCE(tr.phone, tr.guest_phone)) = c.phone_e164
                 )
               ELSE true
             END
    ) d;
  RETURN COALESCE(v_count, 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sms_contacts_overview(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  WITH base AS (
    SELECT c.*
      FROM public.venue_sms_contacts c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
  ),
  live AS (
    SELECT * FROM base
     WHERE NOT unsubscribed AND sms_consent_at > now() - interval '36 months'
  ),
  per_event AS (
    SELECT l.source_event_id AS event_id, e.title, e.start_at, count(DISTINCT l.phone_e164) AS n
      FROM live l JOIN public.events e ON e.id = l.source_event_id
     GROUP BY l.source_event_id, e.title, e.start_at
     ORDER BY e.start_at DESC
     LIMIT 12
  ),
  imports AS (
    SELECT li.id, li.list_name, li.filename, li.created_at,
           (SELECT count(DISTINCT l.phone_e164) FROM live l WHERE l.import_id = li.id) AS n
      FROM public.sms_list_imports li
     WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY li.created_at DESC
     LIMIT 24
  )
  SELECT jsonb_build_object(
    'active',       (SELECT count(DISTINCT phone_e164) FROM live),
    'vip',          (SELECT count(DISTINCT phone_e164) FROM live WHERE is_vip),
    'last_30d',     (SELECT count(DISTINCT phone_e164) FROM live WHERE sms_consent_at > now() - interval '30 days'),
    'imported',     (SELECT count(DISTINCT phone_e164) FROM live WHERE import_id IS NOT NULL),
    'unsubscribed', (SELECT count(*) FROM base WHERE unsubscribed),
    'events',       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'event_id', event_id, 'title', title, 'start_at', start_at, 'contacts', n
                      )) FROM per_event), '[]'::jsonb),
    'imports',      COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'id', id, 'list_name', list_name, 'filename', filename, 'created_at', created_at, 'contacts', n
                      )) FROM imports), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$function$;
