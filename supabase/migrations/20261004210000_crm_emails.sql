-- ============================================================================
-- Console Yuno CRM — suite E-mails (maquettes « Emails », « Email Campagnes »,
-- « Email Resultats », « Email Analyse », « Email Reglages »).
--
--   1. Le moteur d'envoi sait viser la base clients du CRM : audiences
--      {kind:'crm', segmentId?, def} (convention de la Console), résolues par
--      la même définition que l'écran Clients (_crm_filter_sql) et toujours
--      passées par le registre de consentement de la portée
--      (newsletter_subscriptions opt-in, jeton de désinscription). Un segment
--      enregistré est relu à l'envoi ; supprimé, il ne vise plus personne.
--   2. Les chiffres d'un envoi (_crm_email_stats) : destinataires, reçus,
--      ouverts, cliqués, achats attribués (billet acheté dans les 7 jours
--      après un clic, dernier clic gagnant — _crm_msg_build), CA, erreurs,
--      plaintes, désinscriptions. Une seule définition pour la vue
--      d'ensemble, la liste, l'analyse et les résultats.
--   3. Les réglages d'envoi d'un compte CRM (crm_email_settings).
-- Seules les campagnes MANUELLES sont listées (ni automatisation, ni relance
-- enfant) : les automatisations ont leur écran.
-- ============================================================================

ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS template_kind text;
COMMENT ON COLUMN public.email_campaigns.template_kind IS
  'Modèle de départ choisi dans la Console CRM (annonce, lineup, lastcall, bienvenue, manque, merci, mois, vide) : regroupe les résultats par type d''e-mail.';

-- ── 1. Audience CRM ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_campaign_audience(p_campaign_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.email_campaigns%ROWTYPE;
  a jsonb;
  v_def jsonb;
  v_preds text[] := '{}';
  v_recent integer;
  v_excl_buyers boolean;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR (c.venue_id IS NULL AND c.organizer_user_id IS NULL) THEN RETURN; END IF;

  FOR a IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.audiences_json) = 'array' THEN c.audiences_json ELSE '[]'::jsonb END) x LOOP
    CONTINUE WHEN a->>'kind' IS DISTINCT FROM 'crm';
    v_def := NULL;
    IF COALESCE(a->>'segmentId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT s.definition INTO v_def FROM public.crm_segments s
       WHERE s.id = (a->>'segmentId')::uuid
         AND ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
           OR (c.organizer_user_id IS NOT NULL AND s.organizer_user_id = c.organizer_user_id));
      CONTINUE WHEN v_def IS NULL;           -- segment supprimé : il ne vise plus personne
    ELSE
      v_def := COALESCE(a->'def', '{}'::jsonb);
    END IF;
    v_preds := array_append(v_preds, '(' || public._crm_filter_sql(v_def, 'p') || ')');
  END LOOP;
  IF cardinality(v_preds) = 0 THEN RETURN; END IF;   -- audience vide ⇒ personne

  v_recent := CASE WHEN COALESCE(c.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
                   THEN (c.exclusions_json->>'recentDays')::integer END;
  v_excl_buyers := COALESCE(c.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1') AND c.event_id IS NOT NULL;

  PERFORM public._crm_people_build(c.venue_id, c.organizer_user_id, NULL);

  RETURN QUERY EXECUTE format($q$
    SELECT DISTINCT ON (p.email) p.email::text, COALESCE(p.first_name, ns.first_name)::text,
           COALESCE(p.last_name, ns.last_name)::text, ns.user_id, ns.unsubscribe_token
      FROM _cp p
      JOIN public.newsletter_subscriptions ns
        ON lower(ns.email) = p.email AND ns.opted_in
       AND ((%1$L::text IS NOT NULL AND ns.venue_id = %1$L::text)
         OR (%2$L::uuid IS NOT NULL AND ns.organizer_user_id = %2$L::uuid))
     WHERE p.email_ok AND (%3$s)
       AND (%4$L::integer IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.id <> %5$L::uuid
                AND c2.venue_id IS NOT DISTINCT FROM %1$L::text
                AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %4$L::integer)
                AND lower(r.email) = p.email))
       AND (NOT %6$L::boolean OR NOT (%7$L::uuid = ANY (p.events)))
     ORDER BY p.email, ns.created_at DESC
  $q$, c.venue_id, c.organizer_user_id, array_to_string(v_preds, ' OR '), v_recent, c.id, v_excl_buyers, c.event_id);
END;
$$;

REVOKE ALL ON FUNCTION public._crm_campaign_audience(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_campaign_audience(uuid) TO service_role;

-- Le résolveur d'audience des campagnes : branche CRM en tête (reprise de
-- la définition en base, rien d'autre ne change). Volatile : la branche CRM
-- construit une table temporaire.
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
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
$function$;

-- Le décompte appelle le résolveur, qui construit une table temporaire.
ALTER FUNCTION public.count_campaign_audience(uuid) VOLATILE;

-- ── 2. Les chiffres des envois ────────────────────────────────────────────
-- Remplit _ces : une ligne par campagne manuelle envoyée dans [p_from, p_to).
CREATE OR REPLACE FUNCTION public._crm_email_stats(p_venue_id text, p_organizer_user_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF to_regclass('pg_temp._cp') IS NULL THEN
    PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  END IF;
  PERFORM public._crm_msg_build(p_venue_id, p_organizer_user_id, p_from, p_to);

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

REVOKE ALL ON FUNCTION public._crm_email_stats(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_email_stats(text, uuid, timestamptz, timestamptz) TO service_role;

-- Une campagne manuelle telle que les listes la montrent.
CREATE OR REPLACE FUNCTION public._crm_email_row(ec public.email_campaigns)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', ec.id, 'name', ec.name, 'subject', ec.subject, 'status', ec.status,
    'scheduled_at', ec.scheduled_at, 'sent_at', ec.sent_at, 'updated_at', ec.updated_at, 'created_at', ec.created_at,
    'audiences', COALESCE(ec.audiences_json, '[]'::jsonb), 'event_id', ec.event_id, 'template_kind', ec.template_kind,
    'total_recipients', ec.total_recipients,
    'has_content', jsonb_typeof(ec.blocks_json) = 'array' AND jsonb_array_length(ec.blocks_json) > 0,
    'paused_reason', ec.paused_reason);
$$;

-- ── Vue d'ensemble ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_email_overview(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := CASE WHEN p_days IN (30, 90) THEN p_days ELSE 30 END;
  v_to timestamptz := now();
  v_from timestamptz := now() - make_interval(days => v_days);
  v_pfrom timestamptz := now() - make_interval(days => 2 * v_days);
  v_cur jsonb; v_prev jsonb; v_list jsonb; v_up jsonb; v_last jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, v_pfrom, v_to);

  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'received', COALESCE(sum(received), 0),
           'opened', COALESCE(sum(opened), 0), 'clicked', COALESCE(sum(clicked), 0), 'ticketing', COALESCE(sum(ticketing), 0),
           'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0))
    INTO v_cur FROM _ces WHERE sent_at >= v_from;
  SELECT jsonb_build_object('campaigns', count(*), 'sent', COALESCE(sum(n), 0), 'received', COALESCE(sum(received), 0),
           'opened', COALESCE(sum(opened), 0), 'clicked', COALESCE(sum(clicked), 0), 'ticketing', COALESCE(sum(ticketing), 0),
           'purchases', COALESCE(sum(purchases), 0), 'revenue', COALESCE(round(sum(revenue), 2), 0))
    INTO v_prev FROM _ces WHERE sent_at < v_from;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at, 'n', n,
           'purchases', purchases, 'revenue', round(revenue, 2)) ORDER BY sent_at), '[]'::jsonb)
    INTO v_list FROM _ces WHERE sent_at >= v_from;

  -- Prochains envois et brouillons.
  SELECT COALESCE(jsonb_agg(public._crm_email_row(ec) ORDER BY ec.status = 'draft', COALESCE(ec.scheduled_at, ec.updated_at)), '[]'::jsonb)
    INTO v_up
    FROM public.email_campaigns ec
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND (ec.status = 'draft' OR (ec.status = 'scheduled' AND ec.scheduled_at > now() - interval '1 hour'));

  -- Les dernières campagnes envoyées.
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
    SELECT jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'n', n, 'received', received,
             'opened', opened, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
      FROM _ces ORDER BY sent_at DESC LIMIT 3) z;
  -- Assez d'historique : les 3 dernières tout temps, pas seulement la période.
  IF jsonb_array_length(v_last) < 3 THEN
    PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', v_to);
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_last FROM (
      SELECT jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'n', n, 'received', received,
               'opened', opened, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2)) AS x
        FROM _ces ORDER BY sent_at DESC LIMIT 3) z;
  END IF;

  RETURN jsonb_build_object('days', v_days, 'from', v_from, 'to', v_to, 'current', v_cur, 'previous', v_prev,
    'campaigns', v_list, 'upcoming', v_up, 'last', v_last,
    'ever_sent', EXISTS (SELECT 1 FROM public.email_campaigns ec
                          WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
                            AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL AND ec.status IN ('sent', 'sending')));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_overview(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_overview(text, uuid, integer) TO authenticated, service_role;

-- ── Toutes les campagnes ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_email_campaigns(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');
  SELECT COALESCE(jsonb_agg(public._crm_email_row(ec) || CASE WHEN s.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
           'stats', jsonb_build_object('n', s.n, 'received', s.received, 'opened', s.opened, 'clicked', s.clicked,
                     'ticketing', s.ticketing, 'purchases', s.purchases, 'revenue', round(s.revenue, 2),
                     'bounced', s.bounced, 'complained', s.complained, 'unsub', s.unsub)) END
           ORDER BY COALESCE(ec.sent_at, ec.scheduled_at, ec.updated_at) DESC), '[]'::jsonb)
    INTO v
    FROM public.email_campaigns ec
    LEFT JOIN _ces s ON s.id = ec.id
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND ec.automation_id IS NULL AND ec.parent_campaign_id IS NULL
     AND ec.status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'failed');
  RETURN jsonb_build_object('campaigns', v);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_campaigns(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_campaigns(text, uuid) TO authenticated, service_role;

-- ── Résultats d'une campagne ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_email_result(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ec public.email_campaigns%ROWTYPE;
  v_me record;
  v_avg record;
  v_rank integer; v_total integer;
  v_tl jsonb; v_links jsonb; v_list jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ec FROM public.email_campaigns c
   WHERE c.id = p_campaign_id AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');
  SELECT * INTO v_me FROM _ces WHERE id = p_campaign_id;
  SELECT count(*) AS n_campaigns,
         CASE WHEN sum(received) > 0 THEN sum(opened)::numeric / sum(received) END AS open_rate,
         CASE WHEN sum(received) > 0 THEN sum(clicked)::numeric / sum(received) END AS click_rate,
         CASE WHEN sum(n) > 0 THEN sum(purchases)::numeric * 1000 / sum(n) END AS per_k
    INTO v_avg FROM _ces;
  SELECT count(*) INTO v_total FROM _ces;
  SELECT r INTO v_rank FROM (
    SELECT id, rank() OVER (ORDER BY CASE WHEN n > 0 THEN purchases::numeric / n ELSE 0 END DESC) AS r FROM _ces) z
   WHERE z.id = p_campaign_id;

  -- Réactions heure par heure sur 72 h (première ouverture / premier clic par personne).
  IF ec.sent_at IS NOT NULL THEN
    WITH firsts AS (
      SELECT e.event_type, lower(e.recipient_email) AS em, min(e.created_at) AS at
        FROM public.email_campaign_events e
       WHERE e.campaign_id = p_campaign_id AND e.event_type IN ('opened', 'clicked')
       GROUP BY 1, 2
    )
    SELECT jsonb_agg(jsonb_build_object('h', g.h,
             'opens', (SELECT count(*) FROM firsts f WHERE f.event_type = 'opened' AND f.at < ec.sent_at + make_interval(hours => g.h)),
             'clicks', (SELECT count(*) FROM firsts f WHERE f.event_type = 'clicked' AND f.at < ec.sent_at + make_interval(hours => g.h)))
           ORDER BY g.h)
      INTO v_tl FROM generate_series(0, 72, 3) g(h);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('link', l.link, 'clicks', l.clicks, 'people', l.people) ORDER BY l.people DESC), '[]'::jsonb)
      INTO v_links FROM (
        SELECT regexp_replace(e.metadata->'click'->>'link', '([?&])yc=[^&]*&?', '\1', 'g') AS link,
               count(*) AS clicks, count(DISTINCT lower(e.recipient_email)) AS people
          FROM public.email_campaign_events e
         WHERE e.campaign_id = p_campaign_id AND e.event_type = 'clicked' AND e.metadata->'click'->>'link' IS NOT NULL
         GROUP BY 1 ORDER BY 3 DESC LIMIT 12) l;
  END IF;

  -- Les autres campagnes envoyées (pour passer de l'une à l'autre).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sent_at', sent_at) ORDER BY sent_at DESC), '[]'::jsonb)
    INTO v_list FROM (SELECT id, name, sent_at FROM _ces ORDER BY sent_at DESC LIMIT 24) z;

  RETURN public._crm_email_row(ec) || jsonb_build_object(
    'stats', CASE WHEN v_me.id IS NULL THEN NULL ELSE jsonb_build_object(
      'n', v_me.n, 'received', v_me.received, 'opened', v_me.opened, 'clicked', v_me.clicked, 'ticketing', v_me.ticketing,
      'purchases', v_me.purchases, 'revenue', round(v_me.revenue, 2), 'bounced', v_me.bounced, 'complained', v_me.complained,
      'unsub', v_me.unsub, 'non_openers', GREATEST(v_me.received - v_me.opened - v_me.complained, 0)) END,
    'avg', jsonb_build_object('campaigns', v_avg.n_campaigns, 'open_rate', round(v_avg.open_rate, 4), 'click_rate', round(v_avg.click_rate, 4), 'per_k', round(v_avg.per_k, 2)),
    'rank', v_rank, 'rank_of', v_total,
    'timeline', COALESCE(v_tl, '[]'::jsonb), 'links', COALESCE(v_links, '[]'::jsonb), 'others', v_list,
    'resend', jsonb_build_object('enabled', ec.resend_enabled, 'subject', ec.resend_subject, 'done_at', ec.resend_done_at, 'campaign_id', ec.resend_campaign_id),
    'blocks_version', ec.blocks_version);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_result(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_result(text, uuid, uuid) TO authenticated, service_role;

-- Les destinataires d'une campagne (onglet « Destinataires »), 50 par page.
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
  PERFORM public._crm_msg_build(p_venue_id, p_organizer_user_id, now() - interval '25 months', now() + interval '1 day');

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

REVOKE ALL ON FUNCTION public.crm_email_recipients(text, uuid, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_recipients(text, uuid, uuid, text, text, integer) TO authenticated, service_role;

-- ── Analyse (12 mois) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_email_analysis(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c jsonb; v_grid jsonb; v_subj jsonb; v_seg jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  PERFORM public._crm_email_stats(p_venue_id, p_organizer_user_id, now() - interval '12 months', now() + interval '1 day');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'subject', subject, 'sent_at', sent_at, 'kind', template_kind,
           'n', n, 'received', received, 'opened', opened, 'clicked', clicked, 'purchases', purchases, 'revenue', round(revenue, 2),
           'bounced', bounced, 'complained', complained, 'unsub', unsub) ORDER BY sent_at), '[]'::jsonb)
    INTO v_c FROM _ces;

  -- Taux de clic par créneau d'envoi (jour de la semaine × tranche de 2 h, heure de Paris).
  WITH rec AS (
    SELECT s.id, r.email,
           (extract(isodow FROM (s.sent_at AT TIME ZONE 'Europe/Paris'))::int - 1) AS d,
           LEAST(7, GREATEST(0, (extract(hour FROM (s.sent_at AT TIME ZONE 'Europe/Paris'))::int - 8) / 2)) AS h
      FROM _ces s JOIN public.email_campaign_recipients r ON r.campaign_id = s.id AND r.status IN ('sent', 'complained')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'h', h, 'n', n, 'clicked', clicked) ORDER BY d, h), '[]'::jsonb)
    INTO v_grid FROM (
      SELECT rec.d, rec.h, count(*) AS n,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = rec.id AND k.email = lower(rec.email))) AS clicked
        FROM rec GROUP BY 1, 2) z;

  -- Ouvertures selon la longueur de l'objet.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('b', b, 'campaigns', c, 'received', rcv, 'opened', op) ORDER BY b), '[]'::jsonb)
    INTO v_subj FROM (
      SELECT CASE WHEN char_length(COALESCE(subject, '')) < 30 THEN 0 WHEN char_length(subject) <= 45 THEN 1
                  WHEN char_length(subject) <= 62 THEN 2 ELSE 3 END AS b,
             count(*) AS c, sum(received) AS rcv, sum(opened) AS op
        FROM _ces GROUP BY 1) z;

  -- Réponse par cycle de vie (au jour d'aujourd'hui).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('seg', lifecycle, 'people', people, 'received', received, 'opened', opened,
           'clicked', clicked, 'purchases', purchases)), '[]'::jsonb)
    INTO v_seg FROM (
      SELECT p.lifecycle, count(DISTINCT p.email) AS people, count(*) AS received,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_campaign_events e WHERE e.campaign_id = s.id AND e.event_type = 'opened' AND lower(e.recipient_email) = p.email)) AS opened,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _cmk k WHERE k.campaign_id = s.id AND k.email = p.email)) AS clicked,
             (SELECT count(*) FROM _cma a JOIN _ces s2 ON s2.id = a.campaign_id JOIN _cp p2 ON p2.email = a.email WHERE p2.lifecycle = p.lifecycle) AS purchases
        FROM _ces s
        JOIN public.email_campaign_recipients r ON r.campaign_id = s.id AND r.status IN ('sent', 'complained')
        JOIN _cp p ON p.email = lower(r.email)
       GROUP BY p.lifecycle) z;

  RETURN jsonb_build_object('campaigns', v_c, 'grid', v_grid, 'subjects', v_subj, 'segments', v_seg);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_analysis(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_analysis(text, uuid) TO authenticated, service_role;

-- ── 3. Réglages d'envoi ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_email_settings (
  scope_key text PRIMARY KEY,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text CHECK (sender_name IS NULL OR char_length(sender_name) BETWEEN 1 AND 60),
  reply_to text CHECK (reply_to IS NULL OR (char_length(reply_to) <= 254 AND reply_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  postal_address text CHECK (postal_address IS NULL OR char_length(postal_address) <= 240),
  quiet_hours boolean NOT NULL DEFAULT true,
  waves boolean NOT NULL DEFAULT false,
  notify_done boolean NOT NULL DEFAULT true,
  test_emails text[] NOT NULL DEFAULT '{}',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
ALTER TABLE public.crm_email_settings ENABLE ROW LEVEL SECURITY;  -- aucune policy : tout passe par les fonctions

CREATE OR REPLACE FUNCTION public.crm_email_settings_get(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.crm_email_settings%ROWTYPE;
  v_name text; v_reply text; v_city text; v_addr text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_email_settings WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  IF p_venue_id IS NOT NULL THEN
    SELECT v.name, p.email, v.city, v.address INTO v_name, v_reply, v_city, v_addr
      FROM public.venues v LEFT JOIN public.profiles p ON p.id = v.owner_id WHERE v.id = p_venue_id;
  ELSE
    SELECT COALESCE(NULLIF(btrim(p.organization_name), ''), NULLIF(btrim(op.display_name), ''), btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))),
           p.email, COALESCE(op.city, p.city), NULL
      INTO v_name, v_reply, v_city, v_addr
      FROM public.profiles p LEFT JOIN public.organizer_profiles op ON op.user_id = p.id WHERE p.id = p_organizer_user_id;
  END IF;
  RETURN jsonb_build_object(
    'sender_name', s.sender_name, 'reply_to', s.reply_to, 'postal_address', s.postal_address,
    'quiet_hours', COALESCE(s.quiet_hours, true), 'waves', COALESCE(s.waves, false), 'notify_done', COALESCE(s.notify_done, true),
    'test_emails', COALESCE(to_jsonb(s.test_emails), '[]'::jsonb), 'updated_at', s.updated_at,
    'defaults', jsonb_build_object('sender_name', v_name, 'reply_to', v_reply, 'city', v_city, 'address', v_addr));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_email_settings_set(p_venue_id text, p_organizer_user_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tests text[];
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_patch ? 'test_emails' THEN
    SELECT COALESCE(array_agg(DISTINCT lower(btrim(x))), '{}') INTO v_tests
      FROM jsonb_array_elements_text(COALESCE(p_patch->'test_emails', '[]'::jsonb)) x
     WHERE btrim(x) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    IF cardinality(v_tests) > 5 THEN RAISE EXCEPTION 'too_many_test_emails' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO public.crm_email_settings (scope_key, venue_id, organizer_user_id, updated_by, updated_at)
  VALUES (v_key, p_venue_id, p_organizer_user_id, auth.uid(), now())
  ON CONFLICT (scope_key) DO NOTHING;
  UPDATE public.crm_email_settings SET
    sender_name = CASE WHEN p_patch ? 'sender_name' THEN NULLIF(btrim(p_patch->>'sender_name'), '') ELSE sender_name END,
    reply_to = CASE WHEN p_patch ? 'reply_to' THEN NULLIF(lower(btrim(p_patch->>'reply_to')), '') ELSE reply_to END,
    postal_address = CASE WHEN p_patch ? 'postal_address' THEN NULLIF(btrim(p_patch->>'postal_address'), '') ELSE postal_address END,
    quiet_hours = CASE WHEN p_patch ? 'quiet_hours' THEN (p_patch->>'quiet_hours')::boolean ELSE quiet_hours END,
    waves = CASE WHEN p_patch ? 'waves' THEN (p_patch->>'waves')::boolean ELSE waves END,
    notify_done = CASE WHEN p_patch ? 'notify_done' THEN (p_patch->>'notify_done')::boolean ELSE notify_done END,
    test_emails = CASE WHEN p_patch ? 'test_emails' THEN v_tests ELSE test_emails END,
    updated_by = auth.uid(), updated_at = now()
  WHERE scope_key = v_key;
  RETURN public.crm_email_settings_get(p_venue_id, p_organizer_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_email_settings_get(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_settings_get(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_email_settings_set(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_email_settings_set(text, uuid, jsonb) TO authenticated, service_role;
