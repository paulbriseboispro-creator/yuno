-- Yuno CRM ⇄ Billetterie : la base de contacts a DEUX vues, une par produit.
--
-- Constaté le 19/10 : la base de contacts de la Billetterie (Clients, Audience, segments,
-- audiences e-mail, analyse) lisait aussi les billets Shotgun du CRM (`external_tickets`) et
-- les accords venus du connecteur (`newsletter_subscriptions.source = 'connector:shotgun'`).
-- Chez Amoris, 17 410 des 17 413 contacts de la « base Billetterie » sont des acheteurs
-- Shotgun, et 1 461 d'entre eux portent un accord e-mail que la Billetterie aurait ciblé.
--
-- Une seule fonction décide : contact_scope_customers(venue, organisateur, p_product).
--   • 'suite' (défaut, sûr) : ventes Yuno + registre, SANS billets Shotgun ni accords
--     `connector:%` — c'est ce que voit et cible la Billetterie ;
--   • 'crm'  : exactement la définition d'avant (billets Shotgun compris) — ce que lit la
--     Console CRM. Tous les appelants du CRM la demandent EXPLICITEMENT.
-- Le cache de contacts a une clé par produit : « v:club » / « o:uuid » pour la Billetterie,
-- « …|crm » pour le CRM (même plomberie : fraîcheur, cron, effacement, invalidation).
--
-- Données : la clé « |crm » est pré-semée avec le cache actuel (= la vue CRM d'aujourd'hui,
-- aucune reconstruction pour les clients CRM), puis le cache de la Billetterie des portées qui
-- ont une connexion billetterie est purgé (il contenait les acheteurs Shotgun) ; il se
-- reconstruit à la première lecture. Un cache est dérivé : rien d'une vente, d'un contact ni
-- d'un consentement n'est modifié.
--
-- Ce que le CRM lit toujours (décision à prendre ensuite) : les clients issus de ventes Yuno
-- d'un compte à deux produits restent dans sa base (WOH : 3 706 contacts « Yuno » sans
-- connexion Shotgun). Les en retirer changerait des audiences de vrais clients CRM.
--
-- Garde md5 : la migration s'arrête si l'une des fonctions a changé depuis l'audit.

DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('contact_scope_customers', '6f8481369a1c3fd0ec2b3bb7785716ec'),
    ('contact_rows', 'dc1aade7fb5fe919fa496d7bc0829a3d'),
    ('contact_build_rows', 'da253312caddbf06b948db182eddcb67'),
    ('count_contact_segment_def', 'd286ec5d93466d879ccf20c2acad1ef0'),
    ('_contact_base_cache_build', 'e680406c4731c7e1d802864b32dc44b0'),
    ('contact_base_cache_invalidate', '186e5444d143fd3d5e76c88ccf6a45e1'),
    ('_crm_erase_contacts', 'aa1633fcd02771103b22419c4f5c13b3'),
    ('ticketing_apply_erasures', '686b2ccb356621af277e67b07b6d696d'),
    ('_ticketing_drop_cohosted', '014c534d370a48f9a4426db653d8e0da'),
    ('ticketing_after_sync', 'a8038b03ba45434e0cd24175cd2d0cb9'),
    ('_crm_people_build', '19f65c1f3b16fecc21a674ff337bf9db'),
    ('_crm_ana_setup', '7308ab713f48d5b518530dd2ad88ba77'),
    ('crm_home__core', '136c2629cd55d3af78b902b58cfff353'),
    ('_crm_admin_rows', '1bb7387813d5f24b2053accc7610a4ee'),
    ('refresh_contact_engagement', '9f960dbbc753eb59fdef9d6161a11ed7'),
    ('_mcp_tool', 'a7612f482e7e7f4a00442bf4f73e366b')
  ) AS v(name, md5) LOOP
    IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.name) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'public.% a changé depuis l''audit du 19/10 : régénérer la migration depuis pg_get_functiondef', r.name;
    END IF;
  END LOOP;
END $guard$;

DROP FUNCTION public.contact_scope_customers(text, uuid);
DROP FUNCTION public.contact_rows(text, uuid);
DROP FUNCTION public.contact_build_rows(text, uuid);
DROP FUNCTION public.count_contact_segment_def(text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.contact_scope_customers(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT 'suite')
 RETURNS TABLE(email text, user_id uuid, first_name text, last_name text, phone text, spent numeric, event_count integer, paid_count integer, ticket_count integer, table_count integer, order_count integer, guest_list_count integer, first_at timestamp with time zone, last_at timestamp with time zone, last_paid_at timestamp with time zone, city text, age integer, gender text, subscribed boolean, sub_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id
      FROM public.events e
     WHERE (p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
        OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id))
  ), act AS (
    SELECT lower(btrim(t.user_email)) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind, t.user_id,
           COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS fn,
           COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS ln,
           NULLIF(btrim(COALESCE(t.phone, t.guest_phone, '')), '') AS ph
      FROM public.tickets t JOIN ev ON ev.id = t.event_id
     WHERE t.user_email IS NOT NULL AND btrim(t.user_email) <> '' AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(btrim(tr.user_email)),
           (tr.total_price - COALESCE(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END))::numeric,
           tr.created_at, tr.event_id, 'table', tr.user_id,
           COALESCE(tr.guest_first_name, NULLIF(split_part(btrim(COALESCE(tr.full_name, '')), ' ', 1), '')),
           COALESCE(tr.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(tr.full_name, ''), '^\S+\s*', '')), '')),
           NULLIF(btrim(COALESCE(tr.phone, tr.guest_phone, '')), '')
      FROM public.table_reservations tr JOIN ev ON ev.id = tr.event_id
     WHERE tr.user_email IS NOT NULL AND btrim(tr.user_email) <> ''
       AND (tr.paid_at IS NOT NULL OR tr.status IN ('paid', 'confirmed'))
    UNION ALL
    SELECT lower(btrim(o.user_email)),
           (o.total - COALESCE(o.service_fee, 0))::numeric,
           o.created_at, o.event_id, 'order', o.user_id,
           o.guest_first_name, o.guest_last_name,
           NULLIF(btrim(COALESCE(o.guest_phone, '')), '')
      FROM public.orders o
     WHERE p_venue_id IS NOT NULL AND o.venue_id = p_venue_id
       AND o.user_email IS NOT NULL AND btrim(o.user_email) <> '' AND o.status = 'paid'
    UNION ALL
    SELECT lower(btrim(gle.email)),
           0::numeric,
           gle.created_at, gl.event_id, 'guestlist', gle.user_id,
           NULLIF(split_part(btrim(COALESCE(gle.full_name, '')), ' ', 1), ''),
           NULLIF(btrim(regexp_replace(COALESCE(gle.full_name, ''), '^\S+\s*', '')), ''),
           NULLIF(btrim(COALESCE(gle.phone, '')), '')
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
      JOIN ev ON ev.id = gl.event_id
     WHERE gle.email IS NOT NULL AND btrim(gle.email) <> '' AND gle.status <> 'cancelled'
    UNION ALL
    -- Yuno CRM : billets d'une billetterie connectée (Shotgun), comptés comme
    -- des billets. Valeur faciale hors frais ; remboursés / annulés exclus.
    -- Dépense = les VENTES seulement (_crm_ticket_is_sale, audit 18/10,
    -- DATA-03) : un billet revendu compte chez son nouvel acheteur, une
    -- invitation et un duplicata ne sont jamais une dépense. Ils gardent la
    -- personne comme client (billet valide ou transféré).
    SELECT xt.buyer_email,
           (CASE WHEN public._crm_ticket_is_sale(xt.status, xt.deal_channel)
                 THEN COALESCE(xt.price, 0) * GREATEST(xt.quantity, 1) ELSE 0 END)::numeric,
           COALESCE(xt.purchased_at, xt.first_seen_at), xt.event_id, 'ticket', NULL::uuid,
           xt.buyer_first_name, xt.buyer_last_name, xt.buyer_phone
      FROM public.external_tickets xt
     WHERE p_product = 'crm'
       AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
       AND xt.buyer_email IS NOT NULL
       AND xt.status IN ('valid', 'transferred')
  ), agg AS (
    SELECT a.em,
           COALESCE(sum(a.amount), 0) AS spent,
           count(DISTINCT a.event_id) AS event_count,
           count(*) FILTER (WHERE a.kind <> 'guestlist') AS paid_count,
           count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
           count(*) FILTER (WHERE a.kind = 'table') AS table_count,
           count(*) FILTER (WHERE a.kind = 'order') AS order_count,
           count(*) FILTER (WHERE a.kind = 'guestlist') AS guest_list_count,
           min(a.created_at) AS first_at,
           max(a.created_at) AS last_at,
           max(a.created_at) FILTER (WHERE a.kind <> 'guestlist') AS last_paid_at,
           (array_agg(a.user_id ORDER BY a.created_at DESC) FILTER (WHERE a.user_id IS NOT NULL))[1] AS uid,
           (array_agg(a.fn ORDER BY a.created_at DESC) FILTER (WHERE a.fn IS NOT NULL))[1] AS fn,
           (array_agg(a.ln ORDER BY a.created_at DESC) FILTER (WHERE a.ln IS NOT NULL))[1] AS ln,
           (array_agg(a.ph ORDER BY a.created_at DESC) FILTER (WHERE a.ph IS NOT NULL))[1] AS ph
      FROM act a
     GROUP BY a.em
  ), subs AS (
    -- Abonnés entrés par une surface Yuno (jamais par un fichier importé).
    SELECT lower(ns.email) AS em,
           bool_or(ns.opted_in AND ns.opted_out_at IS NULL) AS subscribed,
           max(ns.source) AS src,
           (array_agg(ns.user_id) FILTER (WHERE ns.user_id IS NOT NULL))[1] AS uid,
           max(ns.first_name) AS fn, max(ns.last_name) AS ln
      FROM public.newsletter_subscriptions ns
     WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND ns.import_id IS NULL
       AND COALESCE(ns.source, '') NOT LIKE '%import%'
       -- Un accord donné chez Shotgun n'est pas un accord donné chez Yuno : la vue
       -- Billetterie ne le compte pas (p_product = 'suite', le défaut).
       AND (p_product = 'crm' OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
     GROUP BY lower(ns.email)
  ), merged AS (
    SELECT COALESCE(a.em, s.em) AS em,
           COALESCE(a.uid, s.uid) AS uid,
           a.spent, a.event_count, a.paid_count, a.ticket_count, a.table_count, a.order_count, a.guest_list_count,
           a.first_at, a.last_at, a.last_paid_at,
           COALESCE(a.fn, s.fn) AS fn, COALESCE(a.ln, s.ln) AS ln, a.ph,
           COALESCE(s.subscribed, false) AS subscribed, s.src
      FROM agg a
      FULL OUTER JOIN subs s ON s.em = a.em
  )
  SELECT m.em::text AS email,
         COALESCE(m.uid, p.id) AS user_id,
         COALESCE(p.first_name, m.fn)::text AS first_name,
         COALESCE(p.last_name, m.ln)::text AS last_name,
         COALESCE(m.ph, p.phone)::text AS phone,
         m.spent, m.event_count::int, m.paid_count::int, m.ticket_count::int, m.table_count::int,
         m.order_count::int, m.guest_list_count::int, m.first_at, m.last_at, m.last_paid_at,
         NULLIF(btrim(COALESCE(p.city, '')), '')::text AS city,
         CASE WHEN p.birth_date IS NOT NULL THEN date_part('year', age(p.birth_date))::int END AS age,
         CASE
           WHEN lower(COALESCE(p.gender, '')) IN ('female', 'f', 'femme', 'woman', 'mujer') THEN 'female'
           WHEN lower(COALESCE(p.gender, '')) IN ('male', 'm', 'homme', 'man', 'hombre') THEN 'male'
           WHEN lower(COALESCE(p.gender, '')) IN ('other', 'autre', 'otro', 'non-binary', 'nb') THEN 'other'
         END::text AS gender,
         m.subscribed, m.src::text AS sub_source
    FROM merged m
    LEFT JOIN public.profiles p ON p.id = m.uid AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.uid AND u.deleted_at IS NULL)
   WHERE m.em IS NOT NULL AND position('@' in m.em) > 1;
$function$;
REVOKE ALL ON FUNCTION public.contact_scope_customers(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_scope_customers(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.contact_rows(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT 'suite')
 RETURNS TABLE(id uuid, list_import_id uuid, venue_id text, organizer_user_id uuid, email text, phone_e164 text, first_name text, last_name text, country_code text, country text, region text, city text, postal_code text, zone text, age integer, gender text, newsletter_opt_in boolean, added_at timestamp with time zone, last_purchase_at timestamp with time zone, total_spent numeric, event_count integer, extra jsonb, created_at timestamp with time zone, origin text, user_id uuid, imported_spent numeric, imported_events integer, yuno_spent numeric, yuno_events integer, yuno_first_at timestamp with time zone, yuno_last_at timestamp with time zone, ticket_count integer, table_count integer, order_count integer, guest_list_count integer, last_seen_at timestamp with time zone, eng_status text, emails_sent integer, opens integer, clicks integer, last_opened_at timestamp with time zone, last_clicked_at timestamp with time zone, unsubscribed_at timestamp with time zone, bounced boolean, subscribed boolean, has_account boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
  WITH imp AS (
    SELECT DISTINCT ON (COALESCE(c.email, c.phone_e164)) c.*
      FROM public.imported_contacts c
     WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     ORDER BY COALESCE(c.email, c.phone_e164),
              c.created_at DESC,
              ((c.phone_e164 IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.event_count IS NOT NULL)::int
               + (c.last_purchase_at IS NOT NULL)::int + (c.zone IS NOT NULL)::int + (c.city IS NOT NULL)::int
               + (c.country_code IS NOT NULL)::int + (c.age IS NOT NULL)::int + (c.gender IS NOT NULL)::int) DESC,
              c.id
  ), yc AS (
    SELECT * FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id, p_product)
  ), eng AS (
    SELECT ce.* FROM public.contact_engagement ce
     WHERE public.marketing_scope_match(ce.venue_id, ce.organizer_user_id, p_venue_id, p_organizer_user_id)
  )
  SELECT
    COALESCE(i.id, md5('yuno:' || y.email)::uuid) AS id,
    i.list_import_id,
    COALESCE(i.venue_id, p_venue_id) AS venue_id,
    COALESCE(i.organizer_user_id, p_organizer_user_id) AS organizer_user_id,
    COALESCE(i.email, y.email) AS email,
    COALESCE(i.phone_e164, CASE WHEN y.phone ~ '^\+[1-9][0-9]{6,14}$' THEN y.phone END) AS phone_e164,
    COALESCE(y.first_name, i.first_name) AS first_name,
    COALESCE(y.last_name, i.last_name) AS last_name,
    i.country_code, i.country, i.region,
    COALESCE(i.city, y.city) AS city,
    i.postal_code, i.zone,
    COALESCE(i.age, y.age) AS age,
    COALESCE(i.gender, y.gender) AS gender,
    COALESCE(i.newsletter_opt_in, CASE WHEN y.subscribed THEN true END) AS newsletter_opt_in,
    LEAST(i.added_at, y.first_at) AS added_at,
    GREATEST(i.last_purchase_at, y.last_paid_at) AS last_purchase_at,
    CASE WHEN i.total_spent IS NULL AND y.spent IS NULL THEN NULL
         ELSE COALESCE(i.total_spent, 0) + COALESCE(y.spent, 0) END AS total_spent,
    CASE WHEN i.event_count IS NULL AND y.event_count IS NULL THEN NULL
         ELSE COALESCE(i.event_count, 0) + COALESCE(y.event_count, 0) END AS event_count,
    i.extra,
    COALESCE(i.created_at, y.first_at, now()) AS created_at,
    CASE WHEN i.id IS NOT NULL AND y.email IS NOT NULL THEN 'both'
         WHEN i.id IS NOT NULL THEN 'import'
         ELSE 'yuno' END AS origin,
    COALESCE(y.user_id, e.user_id) AS user_id,
    i.total_spent AS imported_spent,
    i.event_count AS imported_events,
    y.spent AS yuno_spent,
    y.event_count AS yuno_events,
    y.first_at AS yuno_first_at,
    y.last_at AS yuno_last_at,
    COALESCE(y.ticket_count, 0) AS ticket_count,
    COALESCE(y.table_count, 0) AS table_count,
    COALESCE(y.order_count, 0) AS order_count,
    COALESCE(y.guest_list_count, 0) AS guest_list_count,
    GREATEST(i.last_purchase_at, y.last_at, e.last_clicked_at, e.last_opened_at) AS last_seen_at,
    COALESCE(e.status, 'new') AS eng_status,
    COALESCE(e.emails_sent, 0) AS emails_sent,
    COALESCE(e.opens, 0) AS opens,
    COALESCE(e.clicks, 0) AS clicks,
    e.last_opened_at, e.last_clicked_at, e.unsubscribed_at,
    (e.bounced_at IS NOT NULL) AS bounced,
    COALESCE(e.subscribed, y.subscribed, false) AS subscribed,
    (COALESCE(y.user_id, e.user_id) IS NOT NULL) AS has_account
  FROM imp i
  FULL OUTER JOIN yc y ON y.email = i.email
  LEFT JOIN eng e ON e.email = COALESCE(i.email, y.email);
$function$;
REVOKE ALL ON FUNCTION public.contact_rows(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_rows(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT 'suite')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n integer;
  v_key text := public.contact_base_scope_key(p_venue_id, p_organizer_user_id)
                 || CASE WHEN p_product = 'crm' THEN '|crm' ELSE '' END;
  v_state public.contact_base_cache_state%ROWTYPE;
  v_have boolean;
  v_use_cache boolean;
  v_read_only boolean := COALESCE(current_setting('transaction_read_only', true), 'off') = 'on';
BEGIN
  DROP TABLE IF EXISTS _cr;

  SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
  v_have := FOUND;

  IF NOT v_read_only
     AND NOT (v_have AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at))
     AND (NOT v_have OR COALESCE(v_state.row_count, 0) <= 3000) THEN
    -- Première lecture, ou petite portée : on reconstruit tout de suite (un
    -- import de 200 contacts se voit à l'écran suivant). Un seul reconstructeur
    -- par portée : l'appel parallèle attend ici puis trouve le cache frais.
    PERFORM pg_advisory_xact_lock(hashtext('contact_base_cache:' || v_key));
    SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
    IF NOT (FOUND AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at)) THEN
      PERFORM public._contact_base_cache_build(v_key, p_venue_id, p_organizer_user_id, true);
    END IF;
    v_have := true;
  ELSIF v_have AND NOT v_read_only
        AND (v_state.last_read_at IS NULL OR v_state.last_read_at < now() - interval '1 minute') THEN
    -- Grande portée périmée : on sert le cache tel quel, et on signale la
    -- lecture — le cron la reconstruit dans la minute. SKIP LOCKED : une
    -- reconstruction en cours ne fait jamais attendre la page.
    UPDATE public.contact_base_cache_state s SET last_read_at = now()
     WHERE s.scope_key IN (SELECT s2.scope_key FROM public.contact_base_cache_state s2
                            WHERE s2.scope_key = v_key FOR UPDATE SKIP LOCKED);
  END IF;
  -- Aperçu démo (transaction en lecture seule) : le cache s'il existe, sinon
  -- le calcul en direct comme avant.
  v_use_cache := v_have;

  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  WITH base AS (
    SELECT c.id,
           c.list_import_id,
           c.venue_id,
           c.organizer_user_id,
           c.email,
           c.phone_e164,
           c.first_name,
           c.last_name,
           c.country_code,
           c.country,
           c.region,
           c.city,
           c.postal_code,
           c.zone,
           c.age,
           c.gender,
           c.newsletter_opt_in,
           c.added_at,
           c.last_purchase_at,
           c.total_spent,
           c.event_count,
           c.extra,
           c.created_at,
           c.origin,
           c.user_id,
           c.imported_spent,
           c.imported_events,
           c.yuno_spent,
           c.yuno_events,
           c.yuno_first_at,
           c.yuno_last_at,
           c.ticket_count,
           c.table_count,
           c.order_count,
           c.guest_list_count,
           c.last_seen_at,
           c.eng_status,
           c.emails_sent,
           c.opens,
           c.clicks,
           c.last_opened_at,
           c.last_clicked_at,
           c.unsubscribed_at,
           c.bounced,
           c.subscribed,
           c.has_account
      FROM public.contact_base_cache c
     WHERE v_use_cache AND c.scope_key = v_key
    UNION ALL
    SELECT r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id, p_product) r
     WHERE NOT v_use_cache
  ), ok_e AS (
    SELECT DISTINCT lower(ns.email) AS e
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in
       AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id))
       AND (p_product = 'crm' OR COALESCE(ns.source, '') NOT LIKE 'connector:%')
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS e FROM public.email_suppressions s
  ), ok_p AS (
    SELECT DISTINCT vc.phone_e164 AS p
      FROM public.venue_sms_contacts vc
     WHERE NOT vc.unsubscribed
       AND vc.sms_consent_at > now() - interval '36 months'
       AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id))
  )
  SELECT b.*,
         (b.email IS NOT NULL AND oe.e IS NOT NULL AND s.e IS NULL) AS email_ok,
         (b.phone_e164 IS NOT NULL AND op.p IS NOT NULL) AS phone_ok
    FROM base b
    LEFT JOIN ok_e oe ON oe.e = b.email
    LEFT JOIN sup s ON s.e = b.email
    LEFT JOIN ok_p op ON op.p = b.phone_e164;
  SELECT count(*) INTO v_n FROM _cr;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_build_rows(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_build_rows(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public._contact_base_cache_build(p_key text, p_venue_id text, p_organizer_user_id uuid, p_read boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_n integer;
  -- La clé porte le produit : « …|crm » = la vue du CRM, sinon celle de la Billetterie.
  v_product text := CASE WHEN p_key LIKE '%|crm' THEN 'crm' ELSE 'suite' END;
BEGIN
  -- Seules les lignes qui changent s'écrivent (20261018240000) : avant, toute
  -- la portée (jusqu'à 17 000 lignes) était effacée puis réécrite à chaque
  -- reconstruction, le plus souvent à l'identique. Même contenu à la fin.
  DROP TABLE IF EXISTS _cbn;
  CREATE TEMP TABLE _cbn ON COMMIT DROP AS
    SELECT p_key AS scope_key, r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id, v_product) r;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Mêmes colonnes, dans le même ordre (scope_key puis contact_rows) :
  -- comparaison champ à champ.
  DELETE FROM public.contact_base_cache c
   WHERE c.scope_key = p_key
     AND NOT EXISTS (SELECT 1 FROM _cbn n WHERE n.id = c.id AND ROW(c.*) IS NOT DISTINCT FROM ROW(n.*));
  INSERT INTO public.contact_base_cache
    SELECT n.* FROM _cbn n
     WHERE NOT EXISTS (SELECT 1 FROM public.contact_base_cache c WHERE c.scope_key = p_key AND c.id = n.id);
  INSERT INTO public.contact_base_cache_state AS s
         (scope_key, built_at, dirty_at, last_read_at, venue_id, organizer_user_id, row_count)
  VALUES (p_key, v_started, NULL, CASE WHEN p_read THEN now() END, p_venue_id, p_organizer_user_id, v_n)
  ON CONFLICT (scope_key) DO UPDATE SET
    built_at = EXCLUDED.built_at,
    -- Une écriture arrivée PENDANT la reconstruction reste à rattraper.
    dirty_at = CASE WHEN s.dirty_at > EXCLUDED.built_at THEN s.dirty_at END,
    last_read_at = COALESCE(EXCLUDED.last_read_at, s.last_read_at),
    venue_id = EXCLUDED.venue_id,
    organizer_user_id = EXCLUDED.organizer_user_id,
    row_count = EXCLUDED.row_count;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._contact_base_cache_build(text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._contact_base_cache_build(text, text, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.contact_base_cache_invalidate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
       WHERE s.scope_key IN (SELECT DISTINCT k FROM new_rows n CROSS JOIN LATERAL unnest(ARRAY[public.contact_base_scope_key(n.venue_id, n.organizer_user_id), public.contact_base_scope_key(n.venue_id, n.organizer_user_id) || '|crm']) k);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
       WHERE s.scope_key IN (SELECT DISTINCT k FROM old_rows o CROSS JOIN LATERAL unnest(ARRAY[public.contact_base_scope_key(o.venue_id, o.organizer_user_id), public.contact_base_scope_key(o.venue_id, o.organizer_user_id) || '|crm']) k);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emails text[];
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e))), '{}') INTO v_emails
    FROM unnest(p_emails) e WHERE e IS NOT NULL AND btrim(e) <> '';
  IF cardinality(v_emails) = 0 THEN RETURN 0; END IF;

  DELETE FROM public.crm_contact_notes WHERE scope_key = v_key AND lower(email) = ANY (v_emails);

  -- Analyse client (20261010110000) : profil et file de recalcul. L'exclusion
  -- du profilage (crm_profile_optouts), mémoire d'un refus, reste.
  DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_emails);
  -- « Chances de venir » (20261012100000, 20261013110000) : ses chances et
  -- leur journal partent avec lui.
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_emails);

  DELETE FROM public.crm_import_journal j
   USING public.crm_imports i
   WHERE i.list_import_id = j.list_import_id AND i.scope_key = v_key AND lower(j.email) = ANY (v_emails);

  DELETE FROM public.imported_contacts c
   WHERE ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
     AND lower(c.email) = ANY (v_emails);

  -- Un désabonnement reste : c'est la mémoire du refus.
  DELETE FROM public.newsletter_subscriptions ns
   WHERE ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
     AND lower(ns.email) = ANY (v_emails)
     AND ns.opted_in;

  DELETE FROM public.venue_sms_contacts vc
   WHERE ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
     AND lower(vc.email) = ANY (v_emails)
     AND NOT vc.unsubscribed;

  -- Les ventes de la billetterie connectée gardent leur montant, sans identité.
  -- Le billet est MARQUÉ (erased_at, audit 18/10, DATA-01) : si la billetterie
  -- le renvoie, il reste anonyme (trg_external_tickets_zz_keep_erased) ; un
  -- nouvel achat de la même personne est un autre billet.
  UPDATE public.external_tickets t
     SET buyer_email = NULL, buyer_first_name = NULL, buyer_last_name = NULL, buyer_phone = NULL,
         buyer_ref = NULL, holder_email = NULL, holder_first_name = NULL, holder_last_name = NULL, provider_contact_id = NULL, provider_user_id = NULL,
         newsletter_optin = NULL, raw = '{}'::jsonb, erased_at = COALESCE(t.erased_at, now())
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND lower(t.buyer_email) = ANY (v_emails);

  DELETE FROM public.contact_engagement ce
   WHERE ((p_venue_id IS NOT NULL AND ce.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ce.organizer_user_id = p_organizer_user_id))
     AND lower(ce.email) = ANY (v_emails);

  -- Scénarios (20261016130000) : les inscriptions passées restent comptées
  -- (chiffres du scénario, témoin), sous une adresse qui ne désigne plus
  -- personne ; une inscription en route sort (« contact effacé ») ; ses
  -- entrées en attente et la base d'un déclencheur « segment » partent.
  UPDATE public.crm_scenario_runs r
     SET email = 'erased-' || md5(r.email) || '@erased.invalid',
         status = CASE WHEN r.status = 'active' THEN 'exited' ELSE r.status END,
         exit_reason = CASE WHEN r.status = 'active' THEN 'erased' ELSE r.exit_reason END,
         updated_at = now()
   WHERE r.scope_key = v_key AND r.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_pending pd USING public.crm_scenarios s
   WHERE s.id = pd.scenario_id AND s.scope_key = v_key AND pd.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_seen sn USING public.crm_scenarios s
   WHERE s.id = sn.scenario_id AND s.scope_key = v_key AND sn.email = ANY (v_emails);

  -- L'adresse portée par un destinataire SMS (20261013120000) part aussi.
  UPDATE public.sms_campaign_recipients r
     SET email = NULL
    FROM public.sms_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
     AND lower(r.email) = ANY (v_emails);

  -- Les envois passés restent comptés, sous une adresse qui ne désigne plus personne.
  UPDATE public.email_campaign_recipients r
     SET email = 'erased-' || md5(lower(r.email)) || '@erased.invalid',
         first_name = NULL, last_name = NULL, user_id = NULL
    FROM public.email_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND r.status NOT IN ('pending', 'sending')
     AND lower(r.email) = ANY (v_emails);

  UPDATE public.email_campaign_events ev
     SET recipient_email = 'erased-' || md5(lower(ev.recipient_email)) || '@erased.invalid',
         metadata = ((COALESCE(ev.metadata, '{}'::jsonb) - 'to' - 'headers')
                     #- '{open,ipAddress}' #- '{open,userAgent}'
                     #- '{click,ipAddress}' #- '{click,userAgent}')
    FROM public.email_campaigns c
   WHERE c.id = ev.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND lower(ev.recipient_email) = ANY (v_emails);

  DELETE FROM public.contact_base_cache cb
   WHERE cb.scope_key IN (public.contact_base_scope_key(p_venue_id, p_organizer_user_id), public.contact_base_scope_key(p_venue_id, p_organizer_user_id) || '|crm')
     AND lower(cb.email) = ANY (v_emails);
  UPDATE public.contact_base_cache_state
     SET dirty_at = now()
   WHERE scope_key IN (public.contact_base_scope_key(p_venue_id, p_organizer_user_id), public.contact_base_scope_key(p_venue_id, p_organizer_user_id) || '|crm');

  RETURN cardinality(v_emails);
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_erase_contacts(text, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_erase_contacts(text, uuid, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.ticketing_apply_erasures(p_connection_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  v_t0 timestamptz := clock_timestamp();
  v_key text;
  v_queued text[];
  v_gone text[];
  v_org uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_apply_erasures: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(array_agg(DISTINCT e.email), '{}') INTO v_queued
    FROM public.ticketing_erasures e
   WHERE e.connection_id = p_connection_id AND e.at <= v_t0;
  IF cardinality(v_queued) = 0 THEN RETURN 0; END IF;

  -- Effacée = plus AUCUN billet nominatif à cette adresse dans la portée
  -- (toutes connexions confondues). Les adresses sont rangées en minuscules
  -- par le connecteur (`email()`), d'où l'égalité simple, indexée.
  SELECT COALESCE(array_agg(q.em), '{}') INTO v_gone
    FROM unnest(v_queued) q(em)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.external_tickets t
      WHERE t.buyer_email = q.em
        AND ((c.venue_id IS NOT NULL AND t.venue_id = c.venue_id)
          OR (c.venue_id IS NULL AND t.organizer_user_id = c.organizer_user_id)));

  IF cardinality(v_gone) > 0 THEN
    v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
    v_org := CASE WHEN c.venue_id IS NULL THEN c.organizer_user_id END;

    DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_gone);

    -- L'accord que la billetterie avait donné part avec la personne ; tracé.
    WITH off AS (
      DELETE FROM public.newsletter_subscriptions s
       WHERE ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
           OR (c.venue_id IS NULL AND s.organizer_user_id = c.organizer_user_id))
         AND lower(s.email) = ANY (v_gone)
         AND s.opted_in
         AND COALESCE(s.source, '') LIKE 'connector:%'
      RETURNING s.email, s.user_id
    )
    INSERT INTO public.marketing_consent_events
      (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
    SELECT o.user_id, lower(o.email), 'email', c.venue_id, v_org, 'withdrawn', 'connector_contact_erased',
           'Contact effacé chez la billetterie (' || c.provider || ') : accord retiré, adresse écartée de tout import',
           'connector:' || c.provider
      FROM off o;

    -- Une ligne désabonnée reste (mémoire du refus), sans le nom.
    UPDATE public.newsletter_subscriptions s
       SET first_name = NULL, last_name = NULL
     WHERE ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
         OR (c.venue_id IS NULL AND s.organizer_user_id = c.organizer_user_id))
       AND lower(s.email) = ANY (v_gone)
       AND COALESCE(s.source, '') LIKE 'connector:%'
       AND (s.first_name IS NOT NULL OR s.last_name IS NOT NULL);

    -- Repoussoir : jamais réinscrite par un import, la synchro ou une page.
    INSERT INTO public.email_opt_outs (venue_id, organizer_user_id, email, reason, opted_out_at)
    SELECT c.venue_id, v_org, g.em, 'erased', now() FROM unnest(v_gone) g(em)
    ON CONFLICT DO NOTHING;

    DELETE FROM public.contact_base_cache cb
     WHERE cb.scope_key IN (public.contact_base_scope_key(c.venue_id, c.organizer_user_id), public.contact_base_scope_key(c.venue_id, c.organizer_user_id) || '|crm')
       AND lower(cb.email) = ANY (v_gone);
    UPDATE public.contact_base_cache_state
       SET dirty_at = clock_timestamp()
     WHERE scope_key IN (public.contact_base_scope_key(c.venue_id, c.organizer_user_id), public.contact_base_scope_key(c.venue_id, c.organizer_user_id) || '|crm');
  END IF;

  DELETE FROM public.ticketing_erasures WHERE connection_id = p_connection_id AND at <= v_t0;
  RETURN cardinality(v_gone);
END;
$function$;
REVOKE ALL ON FUNCTION public.ticketing_apply_erasures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_apply_erasures(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._ticketing_drop_cohosted(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  v_key text;
  v_org uuid;
  v_emails text[];
  v_gone text[];
  v_tickets integer := 0;
  v_events integer := 0;
  v_kept integer := 0;
  v_withdrawn integer := 0;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  v_org := CASE WHEN c.venue_id IS NULL THEN c.organizer_user_id END;

  -- Les billets des soirées co-organisées, et les adresses qu'ils portaient.
  WITH gone AS (
    DELETE FROM public.external_tickets t
     USING public.external_events ee
     WHERE t.connection_id = p_connection_id
       AND ee.connection_id = p_connection_id
       AND ee.external_id = t.external_event_id
       AND public._ticketing_role_is_cohosted(ee.external_role)
    RETURNING lower(t.buyer_email) AS em
  )
  SELECT count(*)::int, COALESCE(array_agg(DISTINCT em) FILTER (WHERE em IS NOT NULL), '{}')
    INTO v_tickets, v_emails
    FROM gone;

  -- Leurs soirées miroirs (même règle que la suppression des données : une
  -- soirée encore citée ailleurs reste, inactive et privée).
  FOR v_id IN
    SELECT ee.event_id FROM public.external_events ee
      JOIN public.events e ON e.id = ee.event_id AND e.external_source IS NOT NULL
     WHERE ee.connection_id = p_connection_id
       AND public._ticketing_role_is_cohosted(ee.external_role)
  LOOP
    BEGIN
      DELETE FROM public.events WHERE id = v_id;
    EXCEPTION WHEN OTHERS THEN
      v_kept := v_kept + 1;
      RAISE WARNING 'mirror event % kept: %', v_id, SQLERRM;
    END;
  END LOOP;
  DELETE FROM public.external_events ee
   WHERE ee.connection_id = p_connection_id
     AND public._ticketing_role_is_cohosted(ee.external_role);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  IF cardinality(v_emails) > 0 THEN
    -- L'accord versé par la billetterie part quand la personne n'a plus aucun
    -- billet de cette connexion ; un refus ou un accord donné ailleurs reste.
    WITH off AS (
      DELETE FROM public.newsletter_subscriptions s
       WHERE ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
           OR (c.venue_id IS NULL AND s.organizer_user_id = c.organizer_user_id))
         AND lower(s.email) = ANY (v_emails)
         AND s.opted_in
         AND COALESCE(s.source, '') = 'connector:' || c.provider
         AND NOT EXISTS (SELECT 1 FROM public.external_tickets t
                          WHERE t.connection_id = p_connection_id AND t.buyer_email = lower(s.email))
      RETURNING s.email, s.user_id
    )
    INSERT INTO public.marketing_consent_events
      (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
    SELECT o.user_id, lower(o.email), 'email', c.venue_id, v_org, 'withdrawn', 'connector_cohosted_off',
           'Soirées co-organisées retirées par le pro (' || c.provider || ') : accord versé par la billetterie retiré',
           'connector:' || c.provider
      FROM off o;
    GET DIAGNOSTICS v_withdrawn = ROW_COUNT;

    -- Plus aucun billet dans l'espace (toutes connexions) : plus de profil
    -- d'analyse ; les autres sont recalculés.
    SELECT COALESCE(array_agg(q.em), '{}') INTO v_gone
      FROM unnest(v_emails) q(em)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.external_tickets t
        WHERE t.buyer_email = q.em
          AND ((c.venue_id IS NOT NULL AND t.venue_id = c.venue_id)
            OR (c.venue_id IS NULL AND t.organizer_user_id = c.organizer_user_id)));
    DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_gone);
    INSERT INTO public.crm_analysis_dirty (scope_key, email)
    SELECT v_key, q.em FROM unnest(v_emails) q(em)
     WHERE NOT (q.em = ANY (v_gone))
       AND NOT EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = v_key AND o.email = q.em)
    ON CONFLICT (scope_key, email) DO UPDATE SET marked_at = now();

    UPDATE public.contact_base_cache_state
       SET dirty_at = clock_timestamp()
     WHERE scope_key IN (public.contact_base_scope_key(c.venue_id, c.organizer_user_id), public.contact_base_scope_key(c.venue_id, c.organizer_user_id) || '|crm');
  END IF;

  RETURN jsonb_build_object('tickets', v_tickets, 'events', v_events, 'events_kept', v_kept,
                            'consents_withdrawn', v_withdrawn);
END;
$function$;
REVOKE ALL ON FUNCTION public._ticketing_drop_cohosted(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ticketing_drop_cohosted(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ticketing_after_sync(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  x RECORD;
  v_event uuid;
  v_end timestamptz;
  v_created integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_consent integer := 0;
  v_withdrawn integer := 0;
  v_n integer;
  v_an jsonb;
  -- Passe incrémentale (20261018220000) : seuls les billets synchronisés
  -- depuis la dernière passe (marge de 10 min sur l'horloge du connecteur) et
  -- les adresses qu'ils portent sont retraités. Une passe complète au moins
  -- toutes les 24 h, pendant l'import initial, et quand post_full_at est remis
  -- à NULL (TOUTE règle changée ici doit le remettre à NULL, sinon elle ne vaut
  -- que pour les billets qui bougent).
  v_t0 timestamptz := clock_timestamp();
  v_full boolean;
  v_since timestamptz;
  v_emails text[];
  v_new_ext text[] := '{}';
  v_erased integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_after_sync: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_connection'); END IF;

  v_full := c.post_synced_at IS NULL OR c.post_full_at IS NULL
            OR c.post_full_at < now() - interval '24 hours'
            OR c.initial_import_done_at IS NULL;
  v_since := c.post_synced_at - interval '10 minutes';
  IF NOT v_full THEN
    -- Adresses à revoir : celles des billets touchés, et celles qu'un billet a
    -- quittées (adresse changée chez la billetterie, ticketing_email_moves) —
    -- sans elles, un retrait d'accord porté par l'ancienne adresse attendrait
    -- la passe complète.
    SELECT COALESCE(array_agg(DISTINCT tch.em), '{}') INTO v_emails FROM (
      SELECT lower(t.buyer_email) AS em FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id AND t.synced_at > v_since AND t.buyer_email IS NOT NULL
      UNION
      SELECT m.email FROM public.ticketing_email_moves m WHERE m.connection_id = p_connection_id
    ) tch;
  END IF;

  -- Import initial : la table grossit de ~3 500 billets par passe, plus vite
  -- que l'autoanalyse. Sur des statistiques périmées, la même passe prenait
  -- 14 s au lieu de 0,3 s (mesuré le 14/10). Au plus une fois par 3 minutes.
  IF c.initial_import_done_at IS NULL
     AND COALESCE((SELECT GREATEST(st.last_analyze, st.last_autoanalyze)
                     FROM pg_stat_user_tables st
                    WHERE st.relid = 'public.external_tickets'::regclass), '-infinity'::timestamptz)
         < now() - interval '3 minutes' THEN
    ANALYZE public.external_tickets;
  END IF;

  -- 3a. Soirées miroir (création ou mise à jour de ce qui a changé).
  FOR x IN
    SELECT ee.*, ev.id AS mirror_id
      FROM public.external_events ee
      LEFT JOIN public.events ev ON ev.id = ee.event_id
     WHERE ee.connection_id = p_connection_id
       AND ee.start_at IS NOT NULL
  LOOP
    v_end := CASE WHEN x.end_at IS NOT NULL AND x.end_at > x.start_at THEN x.end_at
                  ELSE x.start_at + interval '6 hours' END;
    IF x.mirror_id IS NULL THEN
      INSERT INTO public.events (
        venue_id, organizer_user_id, title, start_at, end_at, description, image_url, poster_url,
        music_genres, music_genre, location_address, location_city, timezone, published_at,
        status, cancelled_at, tickets_sold_out, event_kind, external_source, external_ticket_url,
        is_active, visibility, ticketing_enabled, tables_enabled
      ) VALUES (
        c.venue_id, c.organizer_user_id, COALESCE(NULLIF(btrim(x.name), ''), 'Soirée'), x.start_at, v_end,
        x.description, x.cover_url, x.cover_url,
        x.genres, COALESCE(x.genres[1], 'Open Format'), x.street, x.city, x.timezone, x.published_at,
        CASE WHEN x.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'active' END, x.cancelled_at,
        COALESCE(x.left_tickets = 0, false),
        (CASE WHEN c.venue_id IS NOT NULL THEN 'club_event' ELSE 'organizer_event' END)::public.event_kind,
        x.provider, x.url, false, 'private', false, false
      ) RETURNING id INTO v_event;
      UPDATE public.external_events SET event_id = v_event WHERE id = x.id;
      v_new_ext := v_new_ext || x.external_id;
      -- Line-up : artistes sans compte Yuno, posés une fois (modèle invité).
      INSERT INTO public.event_guest_artists (event_id, name, photo_url, position)
      SELECT v_event, left(a->>'name', 120), NULLIF(a->>'avatar', ''), (ord - 1)::integer
        FROM jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) WITH ORDINALITY AS t(a, ord)
       WHERE NULLIF(btrim(a->>'name'), '') IS NOT NULL
       LIMIT 40;
      v_created := v_created + 1;
    ELSE
      UPDATE public.events e SET
        title = COALESCE(NULLIF(btrim(x.name), ''), e.title),
        start_at = x.start_at,
        end_at = v_end,
        description = COALESCE(x.description, e.description),
        image_url = COALESCE(x.cover_url, e.image_url),
        poster_url = COALESCE(x.cover_url, e.poster_url),
        music_genres = CASE WHEN cardinality(x.genres) > 0 THEN x.genres ELSE e.music_genres END,
        location_address = COALESCE(x.street, e.location_address),
        location_city = COALESCE(x.city, e.location_city),
        timezone = COALESCE(x.timezone, e.timezone),
        published_at = COALESCE(x.published_at, e.published_at),
        status = CASE WHEN x.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'active' END,
        cancelled_at = x.cancelled_at,
        tickets_sold_out = COALESCE(x.left_tickets = 0, false),
        external_ticket_url = COALESCE(x.url, e.external_ticket_url)
      WHERE e.id = x.mirror_id
        AND (e.title IS DISTINCT FROM COALESCE(NULLIF(btrim(x.name), ''), e.title)
          OR e.start_at IS DISTINCT FROM x.start_at OR e.end_at IS DISTINCT FROM v_end
          OR e.cancelled_at IS DISTINCT FROM x.cancelled_at
          OR e.tickets_sold_out IS DISTINCT FROM COALESCE(x.left_tickets = 0, false)
          OR e.published_at IS DISTINCT FROM COALESCE(x.published_at, e.published_at)
          OR e.image_url IS DISTINCT FROM COALESCE(x.cover_url, e.image_url)
          OR e.external_ticket_url IS DISTINCT FROM COALESCE(x.url, e.external_ticket_url));
          -- Les genres ne déclenchent pas de mise à jour : trg_canonical_genres
          -- les réécrit au vocabulaire Yuno, ils ne seraient jamais « égaux ».
          -- Ils suivent quand un autre champ change.
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_updated := v_updated + v_n;
    END IF;
  END LOOP;

  -- 3b. Billets → soirée miroir.
  UPDATE public.external_tickets t
     SET event_id = ee.event_id
    FROM public.external_events ee
   WHERE t.connection_id = p_connection_id
     AND ee.connection_id = p_connection_id
     AND ee.external_id = t.external_event_id
     AND ee.event_id IS NOT NULL
     AND t.event_id IS DISTINCT FROM ee.event_id
     -- Un billet ne change jamais de soirée chez la billetterie, et une soirée
     -- miroir supprimée remet ses billets à NULL (clé SET NULL) : hors passe
     -- complète, seuls les billets sans soirée, touchés, ou d'une soirée
     -- miroir créée à l'instant peuvent avoir à être reliés.
     AND (v_full OR t.event_id IS NULL OR t.synced_at > v_since OR t.external_event_id = ANY (v_new_ext));
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- 3b' Contact effacé chez la billetterie (20261019310000) : profil, accord
  --     versé par la billetterie et base de contacts suivent ; adresse écartée
  --     de tout import. Jamais bloquant : la file reste pour la passe suivante.
  BEGIN
    v_erased := public.ticketing_apply_erasures(p_connection_id);
  EXCEPTION WHEN others THEN
    v_erased := -1;
  END;

  -- 3c. Accord newsletter rapporté par la billetterie → registre de la portée.
  --     Jamais un désabonné (la ligne existe : on n'y touche pas), jamais une
  --     adresse purgée (email_opt_outs) ni supprimée (bounce, plainte), jamais
  --     un acheteur dont le DERNIER signal chez la billetterie est un retrait.
  --     Ensembliste depuis 20261016200000 : le dernier signal de chaque
  --     adresse se calcule UNE fois (DISTINCT ON), plus par billet. La
  --     sous-requête corrélée d'avant coûtait n² : vers 30 000 billets, la
  --     passe dépassait les 30 s du service_role et toute la fonction était
  --     annulée (ni soirées miroirs, ni billets reliés, ni contacts). Même
  --     règle qu'avant, mot pour mot.
  IF NOT v_full AND cardinality(v_emails) = 0 THEN
    NULL;  -- aucun billet touché : rien à verser au registre
  ELSIF c.venue_id IS NOT NULL THEN
    WITH last_sig AS (
      -- Dernier signal newsletter de chaque adresse, calculé UNE fois.
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, t.newsletter_optin AS opt
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.buyer_email IS NOT NULL
         AND t.newsletter_optin IS NOT NULL
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
    ),
    cand AS (
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, COALESCE(t.purchased_at, t.first_seen_at) AS at,
             t.buyer_first_name AS fn, t.buyer_last_name AS ln
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.newsletter_optin IS TRUE
         AND t.buyer_email IS NOT NULL
         AND t.status IN ('valid', 'transferred')
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    )
    INSERT INTO public.newsletter_subscriptions
      (venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT c.venue_id, cd.em, true, 'connector:' || c.provider, 'ticketing', cd.at, cd.fn, cd.ln
      FROM cand cd
      JOIN last_sig l ON l.em = cd.em AND l.opt IS TRUE
     WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = cd.em)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.venue_id = c.venue_id AND lower(o.email) = cd.em)
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  ELSIF c.organizer_user_id IS NOT NULL THEN
    WITH last_sig AS (
      -- Dernier signal newsletter de chaque adresse, calculé UNE fois.
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, t.newsletter_optin AS opt
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.buyer_email IS NOT NULL
         AND t.newsletter_optin IS NOT NULL
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
    ),
    cand AS (
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, COALESCE(t.purchased_at, t.first_seen_at) AS at,
             t.buyer_first_name AS fn, t.buyer_last_name AS ln
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.newsletter_optin IS TRUE
         AND t.buyer_email IS NOT NULL
         AND t.status IN ('valid', 'transferred')
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    )
    INSERT INTO public.newsletter_subscriptions
      (organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT c.organizer_user_id, cd.em, true, 'connector:' || c.provider, 'ticketing', cd.at, cd.fn, cd.ln
      FROM cand cd
      JOIN last_sig l ON l.em = cd.em AND l.opt IS TRUE
     WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = cd.em)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.organizer_user_id = c.organizer_user_id AND lower(o.email) = cd.em)
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  END IF;

  -- 3d. Désinscription rapportée par la billetterie : l'accord qu'ELLE avait
  --     donné (source connector:%) est retiré quand son DERNIER signal pour
  --     cette personne est un retrait postérieur à l'accord. Tracé.
  IF v_full OR cardinality(v_emails) > 0 THEN
  WITH g AS (
    SELECT DISTINCT ON (lower(t.buyer_email))
           lower(t.buyer_email) AS em, t.newsletter_optin AS opt,
           COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) AS at
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.buyer_email IS NOT NULL
       AND t.newsletter_optin IS NOT NULL
       AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
     ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
  ),
  off AS (
    UPDATE public.newsletter_subscriptions s
       SET opted_in = false, opted_out_at = now()
      FROM g
     WHERE g.opt IS FALSE
       AND lower(s.email) = g.em
       AND ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
         OR (c.venue_id IS NULL AND c.organizer_user_id IS NOT NULL AND s.organizer_user_id = c.organizer_user_id))
       AND s.opted_in AND s.opted_out_at IS NULL
       AND COALESCE(s.source, '') LIKE 'connector:%'
       AND (s.consent_recorded_at IS NULL OR g.at IS NULL OR g.at > s.consent_recorded_at)
    RETURNING s.email, s.user_id
  ),
  logged AS (
    INSERT INTO public.marketing_consent_events
      (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
    SELECT o.user_id, lower(o.email), 'email', c.venue_id, CASE WHEN c.venue_id IS NULL THEN c.organizer_user_id END,
           'withdrawn', 'connector_newsletter_optout',
           'Désinscription de la newsletter rapportée par la billetterie (' || c.provider || ')',
           'connector:' || c.provider
      FROM off o
    RETURNING 1
  )
  SELECT count(*) INTO v_withdrawn FROM logged;
  END IF;

  -- 3e. Analyse client (20261010110000) : mémoire des annonces de line-up et
  --     e-mails à recalculer. Jamais bloquant pour la synchro.
  BEGIN
    v_an := public._crm_analysis_mark_sync(p_connection_id);
  EXCEPTION WHEN others THEN
    v_an := jsonb_build_object('error', SQLSTATE);
  END;

  -- La base de contacts de la portée suit les billets (cache relu par la
  -- Console, contact_base_cache_refresh) : marquée dès qu'un billet a bougé.
  IF v_full OR cardinality(v_emails) > 0 OR v_linked > 0 OR v_created > 0 THEN
    UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
     WHERE s.scope_key IN (public.contact_base_scope_key(c.venue_id, c.organizer_user_id), public.contact_base_scope_key(c.venue_id, c.organizer_user_id) || '|crm');
  END IF;

  DELETE FROM public.ticketing_email_moves m WHERE m.connection_id = p_connection_id AND m.at <= v_t0;
  UPDATE public.ticketing_connections
     SET post_synced_at = v_t0,
         post_full_at = CASE WHEN v_full THEN v_t0 ELSE post_full_at END
   WHERE id = p_connection_id;

  RETURN jsonb_build_object('events_created', v_created, 'events_updated', v_updated,
                            'tickets_linked', v_linked, 'consents_added', v_consent,
                            'consents_withdrawn', v_withdrawn, 'contacts_erased', v_erased, 'analysis', v_an,
                            'mode', CASE WHEN v_full THEN 'full' ELSE 'incremental' END,
                            'emails_reviewed', CASE WHEN v_full THEN NULL ELSE cardinality(v_emails) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.ticketing_after_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_after_sync(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_light boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_at timestamptz := COALESCE(p_at, now());
  v_rules record;
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tonight uuid;
  v_n integer;
  -- Mémoire de transaction (20261016230000) : un appelant qui construit
  -- plusieurs bases de la MÊME portée dans la même transaction (fiche d'un
  -- segment, balayage nocturne) pose yuno.crm_cp_memo = sa portée ; ce qui ne
  -- dépend pas de la date (contacts, billets, premier billet, profil, zones)
  -- n'est alors lu qu'une fois. Sans ce réglage, rien n'est réutilisé.
  v_memo boolean := v_scope IS NOT NULL AND COALESCE(current_setting('yuno.crm_cp_memo', true), '') = v_scope;
  v_ready boolean;
  -- p_light (20261018250000) : base LÉGÈRE, pour un écran qui ne lit que le
  -- cycle de vie, la joignabilité, les soirées et la dépense (Communauté).
  -- Mêmes colonnes, mais source, utm_*, âge / genre / pays / lieu Shotgun,
  -- area_key, an_tags / an_dist_km, étiquettes, note et comportement face aux
  -- messages (msg_n, click_*), guest list (gl_*, gl_conv), tonight, upcoming
  -- ne sont pas calculés : NULL ou leur défaut ; _cpt n'a pas ses index.
  -- Tout le reste (soirées, dépense, cycle de vie, guest list…) est la même
  -- règle, mot pour mot. Ne JAMAIS la passer à un lecteur de ces colonnes.
BEGIN
  -- Portée de la base construite, lue par les clés de filtre qui interrogent
  -- une soirée (`ntgt`, 20261011110000) : jamais la soirée d'un autre compte.
  PERFORM set_config('yuno.crm_scope', COALESCE(v_scope, ''), true);
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  -- Une base légère réutilise la mémoire d'une base complète ou légère ; une
  -- base complète, seulement celle d'une base complète (tables pleines).
  v_ready := v_memo AND (COALESCE(current_setting('yuno.crm_cp_memo_ready', true), '') = v_scope
                         OR (p_light AND COALESCE(current_setting('yuno.crm_cp_memo_light', true), '') = v_scope))
             AND to_regclass('pg_temp._cr') IS NOT NULL AND to_regclass('pg_temp._cpx') IS NOT NULL;
  IF NOT v_ready THEN
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, 'crm');
  END IF;

  -- Les billets de la portée, lus UNE fois (20261018110000) : ventes, guest
  -- list, premier billet, profil et lieux en sortent. Avant, cinq lectures de
  -- external_tickets (dont une par l'index des adresses sur TOUTE la table)
  -- coûtaient ~0,9 s sur 48 000 billets. Le canal du tarif se lit dans sa
  -- colonne (20261018100000), plus dans le billet brut. Sans borne de date :
  -- chaque base filtre ensuite à sa date ; en mémoire de transaction, la
  -- lecture sert à toutes les bases de la portée.
  IF NOT v_ready THEN
    DROP TABLE IF EXISTS _cpx;
    CREATE TEMP TABLE _cpx ON COMMIT DROP AS
      SELECT t.id, lower(t.buyer_email) AS email, GREATEST(t.quantity, 1) AS qty,
             COALESCE(t.price, 0) * GREATEST(t.quantity, 1) AS amount,
             COALESCE(t.purchased_at, t.first_seen_at) AS bought_at,
             t.event_id, e.start_at AS event_start,
             COALESCE(e.end_at, e.start_at + interval '6 hours') AS event_end,
             t.scanned_at, t.deal_name, t.price,
             public._crm_ticket_is_sale(t.status, t.deal_channel) AS sale,
             public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) AS kind,
             t.utm->>'utm_source' AS utm_source, t.utm->>'utm_medium' AS utm_medium,
             t.age, t.gender, t.country_code, t.city
        FROM public.external_tickets t
        LEFT JOIN public.events e ON e.id = t.event_id
       WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id));
  END IF;

  -- Billets vendus (mêmes colonnes que _crm_tickets).
  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT x.id, x.email, x.qty, x.amount, x.bought_at, x.event_id, x.event_start, x.scanned_at, x.deal_name, x.price
      FROM _cpx x
     WHERE x.sale AND x.bought_at <= v_at;

  -- Guest list (invitations + billets à 0 €), migration 20261008100000.
  DROP TABLE IF EXISTS _cpg;
  CREATE TEMP TABLE _cpg ON COMMIT DROP AS
    SELECT x.email, x.event_id, x.event_start, x.event_end, x.kind,
           x.scanned_at, x.bought_at AS at, NULLIF(btrim(x.deal_name), '') AS deal
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.kind IS NOT NULL AND x.bought_at <= v_at;

  -- Soirées faites (audit 18/10, DATA-02, décision de Paul) : un billet vendu
  -- (même à 0 €) ou une invitation scannée, SAUF une entrée gratuite non
  -- scannée sur une porte mesurée (_crm_sale_counts_as_night) : là, on sait
  -- que la personne n'est pas venue. `came` = soirée faite ; les autres lignes
  -- disent seulement « avait une place » (provenance). Lue aussi par la fiche
  -- client et _crm_activity_build.
  DROP TABLE IF EXISTS _cpd;
  CREATE TEMP TABLE _cpd ON COMMIT DROP AS
    SELECT d.event_id FROM public._crm_measured_doors(p_venue_id, p_organizer_user_id, v_at) d;
  DROP TABLE IF EXISTS _cpa;
  CREATE TEMP TABLE _cpa ON COMMIT DROP AS
    SELECT t.email, t.event_id, t.event_start,
           public._crm_sale_counts_as_night(t.price, t.scanned_at IS NOT NULL, d.event_id IS NOT NULL) AS came
      FROM _cpt t LEFT JOIN _cpd d ON d.event_id = t.event_id
     WHERE t.email IS NOT NULL
    UNION ALL
    SELECT g.email, g.event_id, g.event_start, true
      FROM _cpg g
     WHERE g.kind = 'inv' AND g.scanned_at IS NOT NULL AND g.event_id IS NOT NULL;

  -- « Ce soir » : la prochaine soirée si elle a lieu aujourd'hui (ou est en cours).
  SELECT e.id INTO v_tonight
    FROM public.events e
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.external_source IS NOT NULL
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_at
     AND (e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
         <= (v_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
   ORDER BY e.start_at LIMIT 1;

  -- Premier billet, profil et zones : ne dépendent pas de la date de la base.
  IF NOT v_ready AND p_light THEN
    -- Base légère : mêmes tables, vides (la requête principale reste la même).
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
      SELECT x.email, x.utm_source, x.utm_medium FROM _cpx x WHERE false;
    DROP TABLE IF EXISTS _cpm_prof;
    CREATE TEMP TABLE _cpm_prof ON COMMIT DROP AS
      SELECT x.email, x.age, x.gender, x.country_code AS country, x.city FROM _cpx x WHERE false;
    DROP TABLE IF EXISTS _cpm_akey;
    CREATE TEMP TABLE _cpm_akey ON COMMIT DROP AS
      SELECT NULL::text AS a, NULL::text AS k WHERE false;
    IF v_memo THEN
      PERFORM set_config('yuno.crm_cp_memo_light', v_scope, true);
    END IF;
  ELSIF NOT v_ready THEN
    DROP TABLE IF EXISTS _cpm_futm;
    CREATE TEMP TABLE _cpm_futm ON COMMIT DROP AS
    -- Le 1er billet VENDU (ni invitation, ni remboursé, ni duplicata), par
    -- date d'achat (20261010110000).
    SELECT DISTINCT ON (x.email) x.email, x.utm_source, x.utm_medium
      FROM _cpx x
     WHERE x.email IS NOT NULL AND x.sale
     ORDER BY x.email, x.bought_at, x.id;
    DROP TABLE IF EXISTS _cpm_prof;
    CREATE TEMP TABLE _cpm_prof ON COMMIT DROP AS
    -- Profil rapporté par Shotgun (âge, genre, ville, pays) : la valeur connue
    -- la plus récente de chaque acheteur (catalogue de segments, 20261008200000).
    -- Entrée triée par (acheteur, date) : les quatre agrégats partagent le
    -- même ORDER BY et lisent ce tri une fois (agrégat pré-trié), au lieu de
    -- quatre tris par acheteur (20261016230000). Mêmes valeurs.
    SELECT t.email,
           (array_agg(t.age ORDER BY t.ts DESC) FILTER (WHERE t.age BETWEEN 12 AND 110))[1] AS age,
           (array_agg(t.gender ORDER BY t.ts DESC) FILTER (WHERE t.gender IN ('female', 'male', 'other')))[1] AS gender,
           (array_agg(upper(btrim(t.country_code)) ORDER BY t.ts DESC)
              FILTER (WHERE btrim(t.country_code) ~* '^[a-z]{2}$'))[1] AS country,
           (array_agg(btrim(t.city) ORDER BY t.ts DESC) FILTER (WHERE NULLIF(btrim(t.city), '') IS NOT NULL))[1] AS city
      FROM (SELECT x.email, x.bought_at AS ts, x.age, x.gender, x.country_code, x.city
              FROM _cpx x
             WHERE x.email IS NOT NULL
               AND (x.age IS NOT NULL OR x.gender IS NOT NULL OR x.country_code IS NOT NULL OR x.city IS NOT NULL)
             ORDER BY 1, 2 DESC) t
     GROUP BY t.email;
    DROP TABLE IF EXISTS _cpm_akey;
    CREATE TEMP TABLE _cpm_akey ON COMMIT DROP AS
    -- Clé de zone (_crm_area_key) calculée UNE fois par lieu distinct, pas par
    -- personne : la fonction n'est pas « inlinée » (SET search_path) et
    -- coûtait 0,2 s sur 14 000 contacts (20261016220000). Tous les lieux
    -- possibles (billets, fiches) : un sur-ensemble suffit à la jointure.
    SELECT x.a, public._crm_area_key(x.a) AS k
      FROM (SELECT NULLIF(btrim(t.city), '') FROM _cpx t
             WHERE NULLIF(btrim(t.city), '') IS NOT NULL
            UNION SELECT NULLIF(btrim(c.city), '') FROM _cr c WHERE NULLIF(btrim(c.city), '') IS NOT NULL
            UNION SELECT NULLIF(btrim(c.zone), '') FROM _cr c WHERE NULLIF(btrim(c.zone), '') IS NOT NULL) x(a);
    IF v_memo THEN
      PERFORM set_config('yuno.crm_cp_memo_ready', v_scope, true);
    END IF;
  END IF;

  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH att AS (
    -- Une soirée faite : voir _cpa plus haut (DATA-02).
    SELECT a.email, a.event_id, a.event_start, a.came FROM _cpa a
  ), agg AS (
    SELECT a.email,
           count(DISTINCT a.event_id) FILTER (WHERE a.came AND a.event_start <= v_at) AS nights,
           count(DISTINCT a.event_id) FILTER (WHERE a.came AND a.event_start <= v_at
                 AND a.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(a.event_start) FILTER (WHERE a.came AND a.event_start <= v_at) AS first_night,
           max(a.event_start) FILTER (WHERE a.came AND a.event_start <= v_at) AS last_night,
           -- Avait une place pour une soirée passée, venu ou non : la provenance.
           count(DISTINCT a.event_id) FILTER (WHERE a.event_start <= v_at) AS held
      FROM att a
     GROUP BY a.email
  ), buy AS (
    SELECT t.email,
           COALESCE(sum(t.amount), 0) AS spent,
           array_agg(DISTINCT t.event_id) FILTER (WHERE t.event_id IS NOT NULL) AS events,
           bool_or(t.event_id = v_tonight) AS tonight,
           min(t.bought_at) AS first_buy,
           count(DISTINCT COALESCE(t.event_id::text, t.id::text)) FILTER (WHERE t.amount > 0) AS paid_n,
           min(t.bought_at) FILTER (WHERE t.amount > 0) AS first_paid,
           bool_or(t.event_start > v_at) AS upcoming
      FROM _cpt t
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), cov AS (
    -- Soirées terminées dont la porte est mesurée (_crm_measured_doors, lue une fois dans _cpd).
    SELECT d.event_id FROM _cpd d
  ), gl AS (
    SELECT g.email,
           count(DISTINCT g.event_id) AS gl_n,
           count(DISTINCT g.event_id) FILTER (WHERE g.scanned_at IS NOT NULL) AS gl_came,
           min(g.event_start) AS gl_first,
           array_agg(DISTINCT g.event_id) FILTER (WHERE g.event_id IS NOT NULL) AS gl_events,
           count(*) FILTER (WHERE g.scanned_at IS NULL AND g.event_id IN (SELECT cov.event_id FROM cov)) AS gl_noshow,
           bool_or(g.event_id = v_tonight) AS gl_tonight,
           bool_or(g.event_start > v_at) AS gl_upcoming
      FROM _cpg g
     WHERE NOT p_light
     GROUP BY g.email
  ), first_utm AS (
    SELECT * FROM _cpm_futm
  ), prof AS (
    SELECT * FROM _cpm_prof
  ), page_first AS (
    -- Première inscription CONFIRMÉE par une page d'inscription de la portée.
    SELECT lower(e.email) AS email, min(e.created_at) AS at
      FROM public.crm_signup_entries e
      JOIN public.crm_signup_pages pg ON pg.id = e.page_id
     WHERE e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND e.created_at <= v_at
       AND NOT p_light
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id
       AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     GROUP BY 1
  ), fh AS (
    -- Historique d'un fichier importé (20261008210000).
    SELECT * FROM public._crm_file_history(p_venue_id, p_organizer_user_id, v_at)
  ), base AS (
    SELECT lower(c.email) AS email, c.first_name, c.last_name, c.phone_e164, c.email_ok, c.phone_ok,
           c.origin, COALESCE(c.added_at, c.created_at) AS added_at, c.eng_status, c.bounced,
           c.list_import_id,
           c.age AS f_age, c.gender AS f_gender, c.country_code AS f_country,
           NULLIF(btrim(c.city), '') AS f_city, NULLIF(btrim(c.zone), '') AS f_zone
      FROM _cr c
     WHERE c.email IS NOT NULL
       AND COALESCE(c.added_at, c.created_at, '-infinity'::timestamptz) <= v_at
  ), akey AS (
    SELECT * FROM _cpm_akey
  )
  SELECT b.email, b.first_name, b.last_name, b.phone_e164 AS phone, b.email_ok, b.phone_ok, b.origin,
         b.added_at, b.eng_status, COALESCE(b.bounced, false) AS bounced, b.list_import_id,
         -- Soirées, dépense, dates : billets Shotgun ET historique des fichiers (voir `h`).
         h.nights::int AS nights, COALESCE(a.nights_win, 0)::int AS nights_win,
         h.first_night, h.last_night, round(h.spent, 2) AS spent,
         COALESCE(y.events, '{}'::uuid[]) AS events,
         CASE WHEN NOT p_light THEN COALESCE(y.tonight, false) OR COALESCE(g.gl_tonight, false) END AS tonight,
         CASE WHEN p_light THEN NULL
              WHEN pf.at IS NOT NULL AND (y.first_buy IS NULL OR pf.at < y.first_buy) THEN 'page'
              WHEN COALESCE(a.held, 0) > 0 AND lower(u.utm_source) LIKE 'yuno%' THEN 'utm'
              WHEN COALESCE(a.held, 0) > 0 THEN 'shotgun'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         CASE WHEN NOT p_light THEN u.utm_source END AS utm_source,
         CASE WHEN NOT p_light THEN u.utm_medium END AS utm_medium,
         CASE
           -- A acheté pour une soirée à venir sans en avoir encore fait : nouveau
           -- client, pas un « contact connu » (import, inscription). Une entrée
           -- gratuite passée où il n'est pas venu (DATA-02) n'en fait pas un client.
           WHEN h.nights = 0 THEN CASE WHEN COALESCE(y.upcoming, false) THEN 'nou' ELSE 'none' END
           -- A repris une place : il n'a pas décroché.
           WHEN h.last_night < v_at - make_interval(months => v_rules.lapse_months)
                AND NOT COALESCE(y.upcoming, false) THEN 'end'
           -- « Habitué » se prouve par des soirées DATÉES (billets) : un total de
           -- fichier ne dit pas combien tombent dans la fenêtre.
           WHEN a.nights_win >= v_rules.regular_min_nights THEN 'hab'
           WHEN h.first_night >= v_at - interval '90 days' THEN 'nou'
           ELSE 'occ' END AS lifecycle,
         n.tags, n.note,
         h.paid_n::int AS paid_n,
         COALESCE(g.gl_n, 0)::int AS gl_n,
         COALESCE(g.gl_came, 0)::int AS gl_came,
         g.gl_first,
         COALESCE(g.gl_events, '{}'::uuid[]) AS gl_events,
         COALESCE(g.gl_noshow, 0)::int AS gl_noshow,
         -- Devenu client : premier billet PAYANT acheté après sa première soirée en guest list.
         CASE WHEN NOT p_light THEN (g.gl_first IS NOT NULL AND y.first_paid IS NOT NULL AND y.first_paid > g.gl_first) END AS gl_conv,
         -- Catalogue de segments (20261008200000) : profil (Shotgun d'abord, puis
         -- vos fichiers), place pour une soirée à venir, dépense par soirée payée.
         CASE WHEN NOT p_light THEN COALESCE(pr.age, CASE WHEN b.f_age BETWEEN 12 AND 110 THEN b.f_age END) END AS age,
         CASE WHEN NOT p_light THEN COALESCE(pr.gender, CASE WHEN b.f_gender IN ('female', 'male', 'other') THEN b.f_gender END) END AS gender,
         CASE WHEN NOT p_light THEN COALESCE(pr.country, CASE WHEN btrim(b.f_country) ~* '^[a-z]{2}$' THEN upper(btrim(b.f_country)) END) END AS country,
         CASE WHEN NOT p_light THEN COALESCE(pr.city, b.f_city, b.f_zone) END AS area,
         CASE WHEN NOT p_light THEN ak.k END AS area_key,
         CASE WHEN NOT p_light THEN (COALESCE(y.upcoming, false) OR COALESCE(g.gl_upcoming, false)) END AS upcoming,
         CASE WHEN h.paid_n > 0 THEN round(h.spent / h.paid_n, 2) END AS basket,
         -- Ce que dit le fichier, et comment il a compté (fiche client).
         f.f_nights AS hist_nights, f.f_spent AS hist_spent, f.f_last AS hist_last, m.mode AS hist_mode, f.f_list AS hist_list,
         -- Analyse client (20261010110000) : clés de filtre pré-calculées.
         COALESCE(ap.tags, '{}'::text[]) AS an_tags, ap.dist_km AS an_dist_km
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN buy y ON y.email = b.email
    LEFT JOIN gl g ON g.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN prof pr ON pr.email = b.email
    LEFT JOIN fh f ON f.email = b.email
    LEFT JOIN akey ak ON ak.a = COALESCE(pr.city, b.f_city, b.f_zone)
    LEFT JOIN public.crm_person_profile ap ON NOT p_light AND ap.scope_key = v_scope AND ap.email = b.email
    -- Comment l'historique d'un fichier compte :
    --   'added' — il précède le premier billet Shotgun (deux billetteries, ou
    --             pas encore de Shotgun) : les deux s'additionnent ;
    --   'file' / 'live' — les deux se recouvrent (un export de la même
    --             billetterie réimporté) : la source qui connaît le plus de
    --             soirées, JAMAIS la somme (pas de double compte).
    CROSS JOIN LATERAL (
      SELECT CASE WHEN f.email IS NULL THEN NULL
                  WHEN y.first_buy IS NULL OR f.f_asof < y.first_buy - interval '2 days' THEN 'added'
                  WHEN f.f_nights > COALESCE(a.nights, 0) THEN 'file'
                  ELSE 'live' END AS mode
    ) m
    CROSS JOIN LATERAL (
      SELECT CASE m.mode WHEN 'added' THEN COALESCE(a.nights, 0) + f.f_nights WHEN 'file' THEN f.f_nights ELSE COALESCE(a.nights, 0) END AS nights,
             CASE m.mode WHEN 'added' THEN COALESCE(y.spent, 0) + f.f_spent WHEN 'file' THEN f.f_spent ELSE COALESCE(y.spent, 0) END AS spent,
             CASE m.mode WHEN 'added' THEN COALESCE(y.paid_n, 0) + f.f_paid WHEN 'file' THEN f.f_paid ELSE COALESCE(y.paid_n, 0) END AS paid_n,
             CASE WHEN m.mode IS NULL THEN a.last_night ELSE GREATEST(a.last_night, f.f_last) END AS last_night,
             CASE WHEN m.mode IS NULL THEN a.first_night ELSE LEAST(a.first_night, f.f_first) END AS first_night
    ) h
    LEFT JOIN public.crm_contact_notes n ON NOT p_light AND n.scope_key = v_scope AND n.email = b.email;

  -- Lu par personne plus bas (« a cliqué sans acheter ») et par les écrans
  -- (Parcours, Analyses) : sans index, chaque recherche relisait tous les
  -- billets — quadratique sur un compte de 30 000 billets (20261016210000).
  -- Créés APRÈS la base : la requête principale lit tous les billets, un index
  -- déjà posé l'y faisait passer par des accès aléatoires (0,2 s).
  IF NOT p_light THEN
    CREATE INDEX ON _cpt (email, bought_at);
    CREATE INDEX ON _cpt (id);
  END IF;

  -- Comportement face aux messages (12 mois avant la date) : reçus, envois
  -- cliqués, et « a cliqué sans acheter » (dernier clic des 90 jours sans
  -- billet acheté dans les 7 jours qui suivent).
  ALTER TABLE _cp ADD COLUMN msg_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN click_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN last_click timestamptz,
                  ADD COLUMN click_nobuy boolean NOT NULL DEFAULT false;
  IF NOT p_light THEN
  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
       AND ec.sent_at <= v_at AND ec.sent_at > v_at - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), r AS (
    SELECT lower(x.email) AS em, count(*) AS n
      FROM public.email_campaign_recipients x JOIN c ON c.id = x.campaign_id
     WHERE x.status IN ('sent', 'complained')
     GROUP BY 1
  ), k AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id) AS n, max(ev.created_at) AS last
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.created_at <= v_at AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cp p
     SET msg_n = COALESCE(r.n, 0), click_n = COALESCE(k.n, 0), last_click = k.last
    FROM (SELECT DISTINCT em FROM (SELECT em FROM r UNION SELECT em FROM k) u) e
    LEFT JOIN r ON r.em = e.em
    LEFT JOIN k ON k.em = e.em
   WHERE p.email = e.em;
  UPDATE _cp p
     SET click_nobuy = true
   WHERE p.last_click > v_at - interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM _cpt t
                      WHERE t.email = p.email AND t.bought_at > p.last_click
                        AND t.bought_at <= LEAST(p.last_click + interval '7 days', v_at));

  END IF;

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_people_build(text, uuid, timestamp with time zone, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_people_build(text, uuid, timestamp with time zone, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_ana_setup(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid, p_seg text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text := 'Europe/Paris';
  v_rules record;
  v_eh integer;
  v_now timestamptz := now();
  v_today date;
  v_mode text;
  v_n integer;
  v_start timestamptz; v_end timestamptz;
  v_d0 date; v_m0 date;
  v_ev_id uuid; v_ev_title text; v_ev_start timestamptz; v_ev_night date; v_ev_upcoming boolean; v_ev_series text;
  v_pev_id uuid; v_pev_title text; v_pev_start timestamptz; v_pev_night date;
  v_seg text := CASE WHEN p_seg IN ('hab', 'occ', 'nou', 'end', 'none') THEN p_seg ELSE 'all' END;
  v_labels jsonb;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  v_eh := v_rules.night_end_hour;
  v_today := public._crm_night_date(v_now, v_tz, v_eh);

  -- La base des personnes (_cp, 1,8 s sur 48 000 billets) ne sert ici qu'à
  -- filtrer un segment : « toutes » ne construit que les contacts (_cr, lus
  -- par Trafic). Communauté, qui lit _cp, la construit elle-même
  -- (crm_ana_community__core).
  IF v_seg <> 'all' THEN
    PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);
  ELSE
    PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, 'crm');
  END IF;

  DROP TABLE IF EXISTS _aev;
  CREATE TEMP TABLE _aev ON COMMIT DROP AS
  SELECT e.id, e.title, COALESCE(public._crm_night_series(e.title), e.title) AS series, e.start_at,
         COALESCE(e.end_at, e.start_at + interval '6 hours') > v_now AS upcoming,
         public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), v_tz), v_eh) AS night,
         x.left_tickets, x.deals
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id));

  IF p_event IS NOT NULL THEN
    SELECT id, title, start_at, night, upcoming, series
      INTO v_ev_id, v_ev_title, v_ev_start, v_ev_night, v_ev_upcoming, v_ev_series
      FROM _aev WHERE id = p_event;
    IF v_ev_id IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = '22023'; END IF;
    SELECT id, title, start_at, night INTO v_pev_id, v_pev_title, v_pev_start, v_pev_night
      FROM _aev
     WHERE start_at < v_ev_start AND id <> v_ev_id
     ORDER BY (series = v_ev_series) DESC, start_at DESC LIMIT 1;
    v_mode := 'event'; v_n := 22;
  ELSIF p_period IN ('24h', '48h') THEN
    v_mode := 'hour'; v_n := CASE p_period WHEN '24h' THEN 24 ELSE 48 END;
    v_end := date_trunc('hour', v_now) + interval '1 hour';
    v_start := v_end - make_interval(hours => v_n);
  ELSIF p_period = '12m' THEN
    v_mode := 'month'; v_n := 12;
    v_m0 := (date_trunc('month', v_today) - interval '11 months')::date;
  ELSE
    v_mode := 'day'; v_n := CASE p_period WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
    v_d0 := v_today - (v_n - 1);
  END IF;

  DROP TABLE IF EXISTS _atk_all;
  CREATE TEMP TABLE _atk_all ON COMMIT DROP AS
  -- La source d'un billet ne dépend que de son utm_source (_crm_ticket_source) :
  -- calculée UNE fois par valeur distincte. Appelée par billet (fonction
  -- SECURITY DEFINER, jamais « inlinée »), elle coûtait 1,2 s sur 32 000
  -- billets (20261016220000). Même résultat, valeur pour valeur.
  WITH sm AS MATERIALIZED (
    SELECT s.k, public._crm_ticket_source(jsonb_build_object('utm_source', s.k)) AS src
      FROM (SELECT DISTINCT lower(btrim(COALESCE(CASE WHEN jsonb_typeof(t.utm) = 'object' THEN t.utm->>'utm_source' END, ''))) AS k
              FROM public.external_tickets t
             WHERE t.status IN ('valid', 'transferred', 'refunded')
               AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
                 OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))) s
  )
  SELECT q.*,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start AND q.bought_at < v_end
                                 THEN floor(extract(epoch FROM q.bought_at - v_start) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 AND v_today THEN q.nd - v_d0 END
           WHEN 'month' THEN CASE WHEN q.nd >= v_m0 AND q.nd <= v_today
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0)) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0))::int END
           ELSE CASE WHEN q.event_id = v_ev_id THEN 21 - LEAST(21, GREATEST(0, v_ev_night - q.nd)) END
         END AS ci,
         CASE v_mode
           WHEN 'hour' THEN CASE WHEN q.bought_at >= v_start - make_interval(hours => v_n) AND q.bought_at < v_start
                                 THEN floor(extract(epoch FROM q.bought_at - (v_start - make_interval(hours => v_n))) / 3600)::int END
           WHEN 'day' THEN CASE WHEN q.nd BETWEEN v_d0 - v_n AND v_d0 - 1 THEN q.nd - (v_d0 - v_n) END
           WHEN 'month' THEN CASE WHEN q.nd >= (v_m0 - interval '12 months')::date AND q.nd < v_m0
                                  THEN ((extract(year FROM q.nd) - extract(year FROM v_m0 - interval '12 months')) * 12
                                        + extract(month FROM q.nd) - extract(month FROM v_m0 - interval '12 months'))::int END
           ELSE CASE WHEN q.event_id = v_pev_id THEN 21 - LEAST(21, GREATEST(0, v_pev_night - q.nd)) END
         END AS pi
    FROM (
      SELECT t.id, lower(t.buyer_email) AS email, GREATEST(t.quantity, 1) AS qty,
             COALESCE(t.price, 0) * GREATEST(t.quantity, 1) AS amount,
             public._crm_ticket_is_sale(t.status, t.deal_channel) AS ok, t.status = 'refunded' AS refunded,
             COALESCE(t.purchased_at, t.first_seen_at) AS bought_at, t.event_id,
             NULLIF(btrim(t.deal_name), '') AS deal, COALESCE(t.external_order_id, t.id::text) AS ord, t.price, sm.src,
             t.scanned_at, t.age, NULLIF(btrim(t.city), '') AS city,
             public._crm_night_date(COALESCE(t.purchased_at, t.first_seen_at), v_tz, v_eh) AS nd,
             extract(hour FROM COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::int AS hr
        -- La clé est une colonne (OFFSET 0 : sous-requête non aplatie), jamais
        -- l'expression réévaluée à chaque comparaison de la jointure.
        FROM (SELECT t.*, lower(btrim(COALESCE(CASE WHEN jsonb_typeof(t.utm) = 'object' THEN t.utm->>'utm_source' END, ''))) AS sk
                FROM public.external_tickets t
               WHERE t.status IN ('valid', 'transferred', 'refunded')
                 AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
                   OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
              OFFSET 0) t
        LEFT JOIN sm ON sm.k = t.sk
    ) q;
  CREATE INDEX ON _atk_all (event_id);
  CREATE INDEX ON _atk_all (email);

  DROP TABLE IF EXISTS _atk;
  IF v_seg = 'all' THEN
    CREATE TEMP TABLE _atk ON COMMIT DROP AS SELECT * FROM _atk_all;
  ELSE
    CREATE TEMP TABLE _atk ON COMMIT DROP AS
    SELECT a.* FROM _atk_all a JOIN _cp p ON p.email = a.email AND p.lifecycle = v_seg;
  END IF;

  -- Libellés des cases : l'instant de début (heures), la date (jours, mois),
  -- J-k et la date de la nuit (soirée).
  SELECT jsonb_agg(CASE v_mode
           WHEN 'hour' THEN to_jsonb(v_start + make_interval(hours => g))
           WHEN 'day' THEN to_jsonb(v_d0 + g)
           WHEN 'month' THEN to_jsonb((v_m0 + make_interval(months => g))::date)
           ELSE to_jsonb(v_ev_night - (21 - g)) END ORDER BY g)
    INTO v_labels FROM generate_series(0, v_n - 1) g;

  RETURN jsonb_build_object(
    'mode', v_mode, 'n', v_n, 'period', p_period, 'seg', v_seg, 'tz', v_tz, 'night_end_hour', v_eh,
    'today', v_today, 'now', v_now, 'labels', v_labels,
    'start', CASE v_mode WHEN 'hour' THEN to_jsonb(v_start) WHEN 'day' THEN to_jsonb(v_d0)
                         WHEN 'month' THEN to_jsonb(v_m0) ELSE to_jsonb(v_ev_night - 21) END,
    'event', CASE WHEN v_mode = 'event' THEN jsonb_build_object(
        'id', v_ev_id, 'title', v_ev_title, 'start_at', v_ev_start, 'night', v_ev_night, 'upcoming', v_ev_upcoming,
        'days_left', GREATEST(0, v_ev_night - v_today)) END,
    'prev_event', CASE WHEN v_pev_id IS NOT NULL THEN jsonb_build_object(
        'id', v_pev_id, 'title', v_pev_title, 'start_at', v_pev_start, 'night', v_pev_night) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_ana_setup(text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_ana_setup(text, uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_home__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tz text := 'Europe/Paris';
  v_now timestamptz := now();
  v_hourly boolean := p_period IN ('24h', '48h');
  v_n integer := CASE p_period WHEN '24h' THEN 24 WHEN '48h' THEN 48 WHEN '7d' THEN 7 WHEN '90d' THEN 90 ELSE 30 END;
  v_step interval;
  v_end timestamptz;
  v_start timestamptz;
  v_pstart timestamptz;
  v_rules record;
  cfg jsonb := public.crm_pricing_config();
  v_series jsonb;
  v_sends jsonb;
  v_tot numeric; v_ptot numeric; v_tickets integer; v_ptickets integer;
  v_paid integer; v_ppaid integer; v_free integer; v_pfree integer;
  v_clients jsonb;
  v_regulars jsonb;
  v_conv jsonb;
  v_reach jsonb;
  v_mission jsonb;
  v_next jsonb;
  v_todo jsonb := '[]'::jsonb;
  v_conn record;
  v_has_conn boolean;
  v_ev record;
  v_prev record;
  v_balance integer;
  v_reserved integer;
  v_n_contacts integer;
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_relaunch integer;
  v_unreach integer;
  v_row record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);

  SELECT c.* INTO v_conn FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;
  v_has_conn := FOUND;

  -- ── Ventes par heure / par jour ──────────────────────────────────────────
  IF v_hourly THEN
    v_step := interval '1 hour';
    v_end := date_trunc('hour', v_now) + interval '1 hour';
  ELSE
    v_step := interval '1 day';
    v_end := (date_trunc('day', v_now AT TIME ZONE v_tz) + interval '1 day') AT TIME ZONE v_tz;
  END IF;
  v_start := v_end - v_n * v_step;
  v_pstart := v_start - v_n * v_step;

  DROP TABLE IF EXISTS _ht;
  CREATE TEMP TABLE _ht ON COMMIT DROP AS SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id);
  -- Les recherches par personne, par soirée et par période plus bas passent
  -- par un index : sans lui, chaque acheteur relisait tous les billets.
  CREATE INDEX ON _ht (email);
  CREATE INDEX ON _ht (event_id);
  CREATE INDEX ON _ht (bought_at);
  ANALYZE _ht;
  -- Soirées faites (DATA-02) : habitués et historique des acheteurs comptent
  -- comme la liste Clients ; une entrée gratuite non scannée sur une porte
  -- mesurée n'est pas une soirée faite. Les ventes restent lues dans _ht.
  DROP TABLE IF EXISTS _hta;
  CREATE TEMP TABLE _hta ON COMMIT DROP AS
    SELECT x.email, x.event_id, x.event_start
      FROM _ht x
      LEFT JOIN public._crm_measured_doors(p_venue_id, p_organizer_user_id, v_now) d ON d.event_id = x.event_id
     WHERE x.email IS NOT NULL
       AND public._crm_sale_counts_as_night(x.price, x.scanned_at IS NOT NULL, d.event_id IS NOT NULL);
  CREATE INDEX ON _hta (email);
  ANALYZE _hta;

  WITH b AS (
    SELECT g AS i,
           CASE WHEN v_hourly THEN v_start + g * v_step
                ELSE ((v_start AT TIME ZONE v_tz) + g * v_step) AT TIME ZONE v_tz END AS s,
           CASE WHEN v_hourly THEN v_start + (g + 1) * v_step
                ELSE ((v_start AT TIME ZONE v_tz) + (g + 1) * v_step) AT TIME ZONE v_tz END AS e
      FROM generate_series(0, v_n - 1) g
  ), pb AS (
    SELECT i, s - v_n * v_step AS s, e - v_n * v_step AS e FROM b
  )
  SELECT jsonb_agg(jsonb_build_object(
           't', b.s,
           'cur', COALESCE((SELECT round(sum(x.amount), 2) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e), 0),
           'prev', COALESCE((SELECT round(sum(x.amount), 2) FROM _ht x WHERE x.bought_at >= pb.s AND x.bought_at < pb.e), 0),
           'tickets', COALESCE((SELECT sum(x.qty) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e), 0),
           'paid', COALESCE((SELECT sum(x.qty) FROM _ht x WHERE x.bought_at >= b.s AND x.bought_at < b.e AND COALESCE(x.price, 0) > 0), 0)
         ) ORDER BY b.i)
    INTO v_series
    FROM b JOIN pb ON pb.i = b.i;

  SELECT COALESCE(round(sum(amount) FILTER (WHERE bought_at >= v_start AND bought_at < v_end), 2), 0),
         COALESCE(round(sum(amount) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start), 2), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_start AND bought_at < v_end), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_start AND bought_at < v_end AND COALESCE(price, 0) > 0), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start AND COALESCE(price, 0) > 0), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_start AND bought_at < v_end AND price = 0), 0),
         COALESCE(sum(qty) FILTER (WHERE bought_at >= v_pstart AND bought_at < v_start AND price = 0), 0)
    INTO v_tot, v_ptot, v_tickets, v_ptickets, v_paid, v_ppaid, v_free, v_pfree
    FROM _ht;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at'), '[]'::jsonb) INTO v_sends FROM (
    SELECT jsonb_build_object('at', c.sent_at, 'name', c.name, 'channel', 'email', 'id', c.id) AS x
      FROM public.email_campaigns c
     WHERE c.sent_at >= v_start AND c.sent_at < v_end AND c.status IN ('sent', 'sending')
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.automation_id IS NULL
    UNION ALL
    SELECT jsonb_build_object('at', s.sent_at, 'name', s.name, 'channel', 'sms', 'id', s.id)
      FROM public.sms_campaigns s
     WHERE s.sent_at >= v_start AND s.sent_at < v_end AND s.status IN ('sent', 'sending')
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
  ) q;

  -- ── Base vivante : clients et joignables ─────────────────────────────────
  v_n_contacts := public.contact_build_rows(p_venue_id, p_organizer_user_id, 'crm');

  SELECT jsonb_build_object(
           'total', count(*),
           'today', count(*) FILTER (WHERE COALESCE(added_at, created_at) >= v_today_start),
           'spark', (SELECT jsonb_agg(c ORDER BY d) FROM (
              SELECT d, (SELECT count(*) FROM _cr x
                          WHERE COALESCE(x.added_at, x.created_at) < ((date_trunc('day', v_now AT TIME ZONE v_tz) - (13 - d) * interval '1 day' + interval '1 day') AT TIME ZONE v_tz)) AS c
                FROM generate_series(0, 13) d) s)
         ),
         jsonb_build_object(
           'total', count(*),
           'reachable', count(*) FILTER (WHERE email_ok OR phone_ok),
           'both', count(*) FILTER (WHERE email_ok AND phone_ok),
           'email_only', count(*) FILTER (WHERE email_ok AND NOT phone_ok),
           'sms_only', count(*) FILTER (WHERE phone_ok AND NOT email_ok),
           'none', count(*) FILTER (WHERE NOT email_ok AND NOT phone_ok)
         ),
         count(*) FILTER (WHERE eng_status = 'unreachable' OR bounced)
    INTO v_clients, v_reach, v_unreach
    FROM _cr;

  -- ── Habitués : N soirées sur M mois (règle de l'espace) ─────────────────
  WITH snap AS (
    SELECT k,
           CASE WHEN k = 0 THEN v_now
                ELSE (date_trunc('month', v_now AT TIME ZONE v_tz) - (k - 1) * interval '1 month') AT TIME ZONE v_tz END AS at
      FROM generate_series(0, 6) k
  ), cnt AS (
    SELECT s.k, (
      SELECT count(*) FROM (
        SELECT x.email FROM _hta x
         WHERE x.email IS NOT NULL AND x.event_start IS NOT NULL
           AND x.event_start <= s.at AND x.event_start > s.at - make_interval(months => v_rules.regular_window_months)
         GROUP BY x.email HAVING count(DISTINCT x.event_id) >= v_rules.regular_min_nights) q) AS n
      FROM snap s
  )
  SELECT jsonb_build_object(
           'total', (SELECT n FROM cnt WHERE k = 0),
           'month_delta', (SELECT n FROM cnt WHERE k = 0) - (SELECT n FROM cnt WHERE k = 1),
           'bars', (SELECT jsonb_agg(n ORDER BY k DESC) FROM cnt WHERE k BETWEEN 0 AND 5),
           'min_nights', v_rules.regular_min_nights,
           'window_months', v_rules.regular_window_months)
    INTO v_regulars;

  -- ── Conversion des deux derniers envois e-mail (achat < 48 h) ───────────
  WITH last_sends AS (
    SELECT c.id, c.name, c.sent_at
      FROM public.email_campaigns c
     WHERE c.status = 'sent' AND c.sent_at IS NOT NULL AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY c.sent_at DESC LIMIT 2
  ), conv AS (
    SELECT l.id, l.name, l.sent_at,
           (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = l.id AND r.status = 'sent') AS recipients,
           (SELECT count(DISTINCT x.email) FROM _ht x
             WHERE x.bought_at >= l.sent_at AND x.bought_at < l.sent_at + interval '48 hours'
               AND x.email IN (SELECT lower(r.email) FROM public.email_campaign_recipients r WHERE r.campaign_id = l.id AND r.status = 'sent')) AS buyers
      FROM last_sends l
  )
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'sent_at', sent_at, 'recipients', recipients, 'buyers', buyers,
           'pct', CASE WHEN recipients > 0 THEN round(buyers::numeric * 100 / recipients, 1) END) ORDER BY sent_at DESC) END
    INTO v_conv
    FROM conv;

  -- ── Bilan du dernier envoi (14 jours) ────────────────────────────────────
  -- Acheteurs et CA = même règle que Résultats, Parcours et Segments
  -- (_crm_email_attrib : un clic dans les 7 jours avant l'achat, le dernier
  -- clic gagne), jamais une fenêtre à part.
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);
  SELECT jsonb_build_object(
           'id', c.id, 'name', c.name, 'sent_at', c.sent_at, 'channel', 'email',
           'recipients', (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent'),
           'clickers', (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev
                         WHERE ev.campaign_id = c.id AND ev.event_type = 'clicked'),
           'buyers', (SELECT count(DISTINCT a.email) FROM _cma a WHERE a.campaign_id = c.id),
           'revenue', (SELECT COALESCE(round(sum(a.amount), 2), 0) FROM _cma a WHERE a.campaign_id = c.id),
           'yunits', COALESCE((SELECT -sum(m.delta) FROM public.crm_yunit_moves m
                                WHERE m.scope_key = v_scope AND m.kind = 'debit' AND m.ref_type = 'email_campaign' AND m.ref_id = c.id::text),
                              (SELECT count(*) FROM public.email_campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') * (cfg->'rates'->>'email')::int))
    INTO v_mission
    FROM public.email_campaigns c
   WHERE c.status = 'sent' AND c.sent_at > v_now - interval '14 days' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   ORDER BY c.sent_at DESC LIMIT 1;

  -- ── Prochaine soirée ─────────────────────────────────────────────────────
  SELECT e.id, e.title, e.start_at, e.end_at, COALESCE(NULLIF(e.timezone, ''), v_tz) AS tz,
         x.left_tickets, x.city, x.cancelled_at
    INTO v_ev
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.external_source IS NOT NULL
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_now
     AND x.cancelled_at IS NULL
   ORDER BY e.start_at ASC LIMIT 1;

  IF v_ev.id IS NOT NULL THEN
    SELECT e.id, e.title, e.start_at INTO v_prev
      FROM public.events e
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.external_source IS NOT NULL
       AND e.start_at < v_ev.start_at
       AND COALESCE(e.end_at, e.start_at + interval '8 hours') <= v_now
       AND EXISTS (SELECT 1 FROM _ht x WHERE x.event_id = e.id)
     -- Même règle que le volet d'une soirée : la même série d'abord.
     ORDER BY (lower(COALESCE(public._crm_night_series(e.title), e.title))
               = lower(COALESCE(public._crm_night_series(v_ev.title), v_ev.title))) DESC,
              e.start_at DESC LIMIT 1;

    WITH ev_day AS (
      SELECT (v_ev.start_at AT TIME ZONE v_ev.tz)::date AS d0,
             (v_now AT TIME ZONE v_ev.tz)::date AS today
    ), pts AS (
      -- 8 points : de J-7 (par rapport à aujourd'hui) jusqu'à maintenant.
      SELECT k, ((SELECT today FROM ev_day) - (7 - k)) AS day
        FROM generate_series(0, 7) k
    ), cur AS (
      SELECT p.k, p.day,
             ((SELECT d0 FROM ev_day) - p.day) AS jn,
             (SELECT COALESCE(sum(x.qty), 0) FROM _ht x
               WHERE x.event_id = v_ev.id
                 AND x.bought_at < LEAST(v_now, ((p.day + 1)::timestamp AT TIME ZONE v_ev.tz))) AS sold
        FROM pts p
    )
    SELECT jsonb_build_object(
             'id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'end_at', v_ev.end_at, 'tz', v_ev.tz,
             'city', v_ev.city,
             'sold', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id),
             'paid', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id AND COALESCE(x.price, 0) > 0),
             'free', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id AND x.price = 0),
             'today', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_ev.id
                        AND x.bought_at >= (date_trunc('day', v_now AT TIME ZONE v_ev.tz) AT TIME ZONE v_ev.tz)),
             'left', v_ev.left_tickets,
             'days_to', (SELECT d0 - today FROM ev_day),
             'curve', (SELECT jsonb_agg(jsonb_build_object(
                        'day', c.day, 'jn', c.jn, 'cur', c.sold,
                        'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE
                          (SELECT COALESCE(sum(x.qty), 0) FROM _ht x
                            WHERE x.event_id = v_prev.id
                              AND x.bought_at < ((((v_prev.start_at AT TIME ZONE v_ev.tz)::date - c.jn) + 1)::timestamp AT TIME ZONE v_ev.tz)) END
                       ) ORDER BY c.k) FROM cur c),
             'prev', CASE WHEN v_prev.id IS NULL THEN NULL ELSE jsonb_build_object(
                        'id', v_prev.id, 'title', v_prev.title, 'start_at', v_prev.start_at,
                        'final', (SELECT COALESCE(sum(x.qty), 0) FROM _ht x WHERE x.event_id = v_prev.id)) END,
             'buyers', (
               WITH bb AS (
                 SELECT b.email,
                        (SELECT count(DISTINCT y.event_id) FROM _hta y
                          WHERE y.email = b.email AND y.event_start < v_ev.start_at
                            AND y.event_start > v_ev.start_at - make_interval(months => v_rules.regular_window_months)) AS prior_window,
                        (SELECT count(DISTINCT y.event_id) FROM _hta y WHERE y.email = b.email AND y.event_start < v_ev.start_at) AS prior_all,
                        -- Venu avant Shotgun d'après un fichier importé (même règle que _crm_people_build).
                        (f.email IS NOT NULL AND f.f_asof < (SELECT min(y.bought_at) FROM _ht y WHERE y.email = b.email) - interval '2 days') AS file_prior
                   FROM (SELECT DISTINCT x.email FROM _ht x WHERE x.event_id = v_ev.id AND x.email IS NOT NULL) b
                   LEFT JOIN public._crm_file_history(p_venue_id, p_organizer_user_id, NULL) f ON f.email = b.email
               )
               SELECT jsonb_build_object(
                        'total', count(*),
                        'regulars', count(*) FILTER (WHERE prior_window + 1 >= v_rules.regular_min_nights),
                        'new', count(*) FILTER (WHERE prior_all = 0 AND NOT file_prior),
                        'occasional', count(*) FILTER (WHERE (prior_all > 0 OR file_prior) AND prior_window + 1 < v_rules.regular_min_nights))
                 FROM bb)
           )
      INTO v_next;

    -- Habitués joignables qui n'ont pas encore leur place.
    SELECT count(*) INTO v_relaunch FROM (
      SELECT x.email FROM _hta x
       WHERE x.email IS NOT NULL AND x.event_start <= v_now
         AND x.event_start > v_now - make_interval(months => v_rules.regular_window_months)
       GROUP BY x.email HAVING count(DISTINCT x.event_id) >= v_rules.regular_min_nights
    ) reg
    WHERE NOT EXISTS (SELECT 1 FROM _ht y WHERE y.event_id = v_ev.id AND y.email = reg.email)
      AND EXISTS (SELECT 1 FROM _cr c WHERE c.email = reg.email AND c.email_ok);
  END IF;

  -- ── Que faut-il faire aujourd'hui ? ──────────────────────────────────────
  v_balance := public.crm_yunits_balance(v_scope);
  SELECT COALESCE(sum(GREATEST(COALESCE(c.total_recipients, c.recipients_count, 0), 0)), 0)::int
    INTO v_reserved
    FROM public.email_campaigns c
   WHERE c.status = 'scheduled' AND c.scheduled_at > v_now
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  IF NOT v_has_conn AND (SELECT count(*) FROM _cr) = 0 THEN
    v_todo := jsonb_build_array(
      jsonb_build_object('id', 'connect', 'kind', 'connect', 'tone', 'todo', 'params', '{}'::jsonb),
      jsonb_build_object('id', 'check', 'kind', 'check', 'tone', 'wait', 'params', '{}'::jsonb),
      jsonb_build_object('id', 'first_send', 'kind', 'first_send', 'tone', 'wait',
                         'params', jsonb_build_object('yunits', v_balance)));
  ELSE
    IF v_ev.id IS NOT NULL AND COALESCE(v_relaunch, 0) > 0 AND (v_next->>'days_to')::int BETWEEN 0 AND 3 THEN
      v_todo := v_todo || jsonb_build_object('id', 'relaunch:' || v_ev.id, 'kind', 'relaunch',
        'tone', CASE WHEN (v_next->>'days_to')::int <= 1 THEN 'todo' ELSE 'warn' END,
        'params', jsonb_build_object('n', v_relaunch, 'event_id', v_ev.id, 'title', v_ev.title,
                                     'days_to', (v_next->>'days_to')::int, 'start_at', v_ev.start_at));
    END IF;

    FOR v_row IN SELECT c.id, c.name, c.scheduled_at, COALESCE(c.total_recipients, c.recipients_count, 0) AS n
               FROM public.email_campaigns c
              WHERE c.status = 'scheduled' AND c.scheduled_at > v_now AND c.scheduled_at < v_now + interval '24 hours'
                AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
              ORDER BY c.scheduled_at LIMIT 2 LOOP
      v_todo := v_todo || jsonb_build_object('id', 'validate:' || v_row.id, 'kind', 'validate', 'tone', 'todo',
        'params', jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'at', v_row.scheduled_at, 'recipients', v_row.n));
    END LOOP;

    FOR v_row IN SELECT c.id, c.name, c.updated_at
               FROM public.email_campaigns c
              WHERE c.status = 'draft' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                AND c.updated_at > v_now - interval '14 days'
                AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
              ORDER BY c.updated_at DESC LIMIT 1 LOOP
      v_todo := v_todo || jsonb_build_object('id', 'draft:' || v_row.id, 'kind', 'draft', 'tone', 'wait',
        'params', jsonb_build_object('campaign_id', v_row.id, 'name', v_row.name, 'updated_at', v_row.updated_at));
    END LOOP;

    IF v_balance - v_reserved < (cfg->>'low_balance')::int THEN
      v_todo := v_todo || jsonb_build_object('id', 'yunits', 'kind', 'yunits', 'tone', 'warn',
        'params', jsonb_build_object('after', GREATEST(v_balance - v_reserved, 0), 'balance', v_balance,
                                     'reserved', v_reserved, 'sms_rate', (cfg->'rates'->>'sms')::int));
    END IF;

    IF COALESCE(v_unreach, 0) > 0 THEN
      v_todo := v_todo || jsonb_build_object('id', 'contacts', 'kind', 'contacts', 'tone', 'wait',
        'params', jsonb_build_object('n', v_unreach));
    END IF;

    -- Catalogue de segments (20261008200000) : une base d'au moins 10 personnes
    -- et aucun segment à soi → « Choisir vos segments » (la fenêtre du catalogue).
    IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.scope_key = v_scope)
       AND COALESCE(v_n_contacts, 0) >= 10 THEN
      v_todo := v_todo || jsonb_build_object('id', 'segments', 'kind', 'segments', 'tone', 'wait', 'params', '{}'::jsonb);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'now', v_now,
    'tz', v_tz,
    'connection', CASE WHEN v_has_conn THEN jsonb_build_object(
        'provider', v_conn.provider, 'status', v_conn.status, 'last_ok_at', v_conn.last_ok_at,
        'last_error_at', v_conn.last_error_at,
        'broken', v_conn.status = 'token_invalid'
                  OR (v_conn.last_error_at IS NOT NULL AND (v_conn.last_ok_at IS NULL OR v_conn.last_error_at > v_conn.last_ok_at) AND v_conn.fail_count >= 3),
        'broken_since', COALESCE(v_conn.last_ok_at, v_conn.last_error_at)) END,
    'sales', jsonb_build_object(
        'period', p_period, 'hourly', v_hourly, 'n', v_n, 'start', v_start, 'end', v_end,
        'series', COALESCE(v_series, '[]'::jsonb), 'total', v_tot, 'prev_total', v_ptot,
        'tickets', v_tickets, 'prev_tickets', v_ptickets,
        'paid_tickets', v_paid, 'prev_paid_tickets', v_ppaid,
        'free_tickets', v_free, 'prev_free_tickets', v_pfree, 'sends', v_sends,
        'has_any', EXISTS (SELECT 1 FROM _ht)),
    'kpi', jsonb_build_object('clients', v_clients, 'regulars', v_regulars, 'conversion', v_conv, 'reach', v_reach),
    'mission', v_mission,
    'next', v_next,
    'todo', v_todo,
    'wallet', jsonb_build_object('balance', v_balance, 'reserved', v_reserved)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_home__core(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_home__core(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_admin_rows(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_pricing_config();
  v_demo_v text[] := public.demo_venue_ids();
  v_out jsonb;
BEGIN
  WITH sc AS MATERIALIZED (
    SELECT 'venue:' || v.id AS scope_key, 'venue'::text AS kind, v.id AS venue_id, NULL::uuid AS org_id,
           v.name::text AS name, v.city::text AS city, v.owner_id AS owner_id, v.created_at,
           false AS association
      FROM public.venues v
     WHERE (v.product = 'crm' OR 'crm' = ANY(COALESCE(v.extra_products, '{}'::text[]))) AND v.decommissioned_at IS NULL
    UNION ALL
    SELECT 'org:' || o.user_id, 'org', NULL, o.user_id,
           COALESCE(NULLIF(o.display_name, ''), p.organization_name, 'Organisation')::text, o.city::text, o.user_id,
           o.created_at, COALESCE(o.bde_verified, false)
      FROM public.organizer_profiles o
      JOIN public.profiles p ON p.id = o.user_id
     WHERE (o.product = 'crm' OR 'crm' = ANY(COALESCE(o.extra_products, '{}'::text[])))
  ), base AS MATERIALIZED (
    SELECT sc.*, pr.email AS owner_email, NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), '') AS owner_name,
           pr.phone AS owner_phone, u.last_sign_in_at,
           (public.is_demo_email(pr.email) OR (sc.venue_id IS NOT NULL AND sc.venue_id = ANY(v_demo_v))) AS is_demo
      FROM sc
      LEFT JOIN public.profiles pr ON pr.id = sc.owner_id
      LEFT JOIN auth.users u ON u.id = sc.owner_id
  ), rows AS (
    SELECT b.*,
           s.status AS sub_status, s.billing_interval, COALESCE(s.founder, false) AS founder, s.trial_ends_at,
           s.current_period_end, COALESCE(s.cancel_at_period_end, false) AS cancel_at_end,
           s.stripe_subscription_id, s.created_at AS sub_created,
           st.business_type, st.sending_frozen_at, st.sending_frozen_reason, st.deletion_requested_at,
           cn.provider AS conn_provider, cn.status AS conn_status, cn.last_ok_at, cn.last_error_at, cn.last_error,
           cn.initial_import_done_at, cn.fail_count, (cn.id IS NOT NULL) AS has_conn,
           public.crm_yunits_balance(b.scope_key) AS balance,
           ct.n AS contacts, ct.reach,
           se.sends30, se.last_send_at,
           pu.n AS buys, pu.eur AS buys_eur, pu.last_at AS last_buy_at,
           ob.imports, ob.send_settings, ob.recipes, ob.team,
           ps.source AS signup_source, ps.utm_source, ps.created_at AS signup_at
      FROM base b
      LEFT JOIN public.crm_subscriptions s ON s.scope_key = b.scope_key
      LEFT JOIN public.crm_settings st ON st.scope_key = b.scope_key
      LEFT JOIN LATERAL (
        SELECT c.* FROM public.ticketing_connections c
         WHERE (b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id)
         ORDER BY c.created_at LIMIT 1) cn ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n, count(*) FILTER (WHERE r.subscribed AND r.email IS NOT NULL AND NOT COALESCE(r.bounced, false))::int AS reach
          FROM public.contact_rows(b.venue_id, b.org_id, 'crm') r) ct ON true
      LEFT JOIN LATERAL (
        SELECT (SELECT count(*) FROM public.email_campaigns c
                 WHERE c.automation_id IS NULL AND c.status IN ('sent', 'sending')
                   AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id)))::int
             + (SELECT count(*) FROM public.sms_campaigns c
                 WHERE c.status IN ('sent', 'sending') AND COALESCE(c.sent_at, c.send_started_at) >= now() - interval '30 days'
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_id = b.org_id)))::int AS sends30,
               (SELECT max(COALESCE(c.sent_at, c.send_started_at)) FROM public.email_campaigns c
                 WHERE c.automation_id IS NULL AND c.status IN ('sent', 'sending')
                   AND ((b.venue_id IS NOT NULL AND c.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND c.organizer_user_id = b.org_id))) AS last_send_at) se ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n,
               COALESCE(sum(CASE WHEN (m.meta->>'amount_total') ~ '^[0-9]+$'
                                 THEN (m.meta->>'amount_total')::numeric / 100 / (1 + COALESCE((cfg->>'vat_rate')::numeric, 20) / 100)
                                 ELSE l.amount::numeric / NULLIF((cfg->>'yunits_per_euro')::numeric, 0) END), 0) AS eur,
               max(l.created_at) AS last_at
          FROM public.crm_yunit_lots l
          LEFT JOIN public.crm_yunit_moves m ON m.ref_type = 'lot' AND m.ref_id = l.id::text AND m.kind = 'credit'
         WHERE l.scope_key = b.scope_key AND l.kind = 'purchase') pu ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS (SELECT 1 FROM public.crm_imports i WHERE i.scope_key = b.scope_key AND i.status <> 'undone' AND i.undone_at IS NULL) AS imports,
               EXISTS (SELECT 1 FROM public.crm_email_settings e WHERE e.scope_key = b.scope_key
                          AND COALESCE(e.sender_name, '') <> '' AND COALESCE(e.postal_address, '') <> '') AS send_settings,
               (SELECT count(*) FROM public.email_automations a WHERE a.enabled
                   AND ((b.venue_id IS NOT NULL AND a.venue_id = b.venue_id) OR (b.org_id IS NOT NULL AND a.organizer_user_id = b.org_id)))::int AS recipes,
               CASE WHEN b.org_id IS NOT NULL
                    THEN (SELECT count(*) FROM public.org_members m WHERE m.organizer_user_id = b.org_id AND m.invitation_status = 'accepted')::int
                    ELSE (SELECT count(*) FROM public.manager_permissions mp WHERE mp.venue_id = b.venue_id)::int END AS team) ob ON true
      LEFT JOIN LATERAL (
        SELECT p.source, p.utm_source, p.created_at FROM public.pro_signups p
         WHERE p.user_id = b.owner_id AND p.product = 'crm' ORDER BY p.created_at DESC LIMIT 1) ps ON true
     WHERE p_include_demo OR NOT b.is_demo
  ), calc AS (
    SELECT r.*,
           CASE
             WHEN r.sub_status IS NULL THEN 'paused'
             WHEN r.sub_status = 'trialing' AND r.trial_ends_at IS NOT NULL AND r.trial_ends_at > now() THEN 'trial'
             WHEN r.sub_status = 'active' AND (r.stripe_subscription_id IS NOT NULL OR r.current_period_end IS NULL OR r.current_period_end >= now()) THEN 'paid'
             WHEN r.sub_status = 'past_due' THEN 'late'
             WHEN r.sub_status IN ('canceled', 'cancelled', 'incomplete_expired') THEN 'churned'
             ELSE 'paused' END AS state,
           (r.has_conn AND r.last_ok_at IS NOT NULL AND r.last_ok_at > now() - interval '24 hours'
              AND (r.last_error_at IS NULL OR r.last_error_at < r.last_ok_at)) AS sync_ok
      FROM rows r
  ), scored AS (
    SELECT c.*,
           (c.has_conn)::int + (c.initial_import_done_at IS NOT NULL)::int + c.imports::int + c.send_settings::int
             + (c.sends30 > 0 OR c.last_send_at IS NOT NULL)::int + (c.recipes > 0)::int + (c.team > 0)::int AS ob_done,
           CASE WHEN c.sends30 >= 3 THEN 30 WHEN c.sends30 = 2 THEN 21 WHEN c.sends30 = 1 THEN 12 ELSE 0 END AS h_activity,
           CASE WHEN c.last_sign_in_at IS NULL THEN 0
                WHEN c.last_sign_in_at > now() - interval '3 days' THEN 15
                WHEN c.last_sign_in_at > now() - interval '7 days' THEN 11
                WHEN c.last_sign_in_at > now() - interval '14 days' THEN 6
                WHEN c.last_sign_in_at > now() - interval '30 days' THEN 2 ELSE 0 END AS h_presence,
           CASE WHEN c.sync_ok THEN 15 WHEN c.has_conn THEN 5 ELSE 0 END AS h_sync
      FROM calc c
  ), fin AS (
    SELECT s.*, round(40.0 * s.ob_done / 7)::int AS h_onboarding,
           CASE WHEN s.state = 'churned' THEN 0
                ELSE LEAST(100, round(40.0 * s.ob_done / 7)::int + s.h_activity + s.h_presence + s.h_sync) END AS health
      FROM scored s
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', f.scope_key, 'kind', f.kind, 'venue_id', f.venue_id, 'organizer_user_id', f.org_id,
      'name', f.name, 'city', f.city,
      'type', CASE WHEN f.business_type IN ('club', 'organizer', 'association') THEN f.business_type
                   WHEN f.association THEN 'association' WHEN f.kind = 'venue' THEN 'club' ELSE 'organizer' END,
      'contact', f.owner_name, 'email', f.owner_email, 'phone', f.owner_phone,
      'state', f.state, 'sub_status', f.sub_status, 'interval', f.billing_interval, 'founder', f.founder,
      'trial_ends_at', f.trial_ends_at,
      'trial_left', CASE WHEN f.state = 'trial' THEN GREATEST(0, ceil(extract(epoch FROM f.trial_ends_at - now()) / 86400))::int END,
      'period_end', f.current_period_end, 'cancel_at_end', f.cancel_at_end,
      'paid', f.stripe_subscription_id IS NOT NULL, 'granted', f.state = 'paid' AND f.stripe_subscription_id IS NULL,
      'signup_at', COALESCE(f.signup_at, f.created_at), 'sub_created', f.sub_created,
      'mrr', CASE WHEN f.state IN ('paid', 'late') AND f.stripe_subscription_id IS NOT NULL
                  THEN CASE WHEN f.billing_interval = 'year' THEN round((cfg->>'price_year')::numeric / 12, 2)
                            WHEN f.founder THEN (cfg->>'price_month')::numeric
                            ELSE (cfg->>'price_month_next')::numeric END
                  ELSE 0 END,
      'provider', f.conn_provider, 'conn_status', f.conn_status,
      'sync', CASE WHEN NOT f.has_conn THEN 'none' WHEN f.sync_ok THEN 'ok' ELSE 'error' END,
      'sync_at', f.last_ok_at, 'sync_error', f.last_error, 'sync_error_at', f.last_error_at,
      'contacts', f.contacts, 'reach', f.reach,
      'sends30', f.sends30, 'last_send_at', f.last_send_at,
      'balance', f.balance, 'buys', f.buys, 'buys_eur', round(f.buys_eur, 2), 'last_buy_at', f.last_buy_at,
      'last_login', f.last_sign_in_at,
      'source', COALESCE(NULLIF(f.signup_source, ''), NULLIF(f.utm_source, '')),
      'ob', jsonb_build_array(f.has_conn, f.initial_import_done_at IS NOT NULL, f.imports, f.send_settings,
                              (f.sends30 > 0 OR f.last_send_at IS NOT NULL), f.recipes > 0, f.team > 0),
      'recipes', f.recipes, 'team', f.team,
      'health', f.health,
      'h', jsonb_build_array(f.h_onboarding, f.h_activity, f.h_presence, f.h_sync),
      'frozen_at', f.sending_frozen_at, 'frozen_reason', f.sending_frozen_reason,
      'deletion_requested_at', f.deletion_requested_at,
      'is_demo', f.is_demo
    ) ORDER BY f.health, f.name), '[]'::jsonb)
    INTO v_out
    FROM fin f;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_admin_rows(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_admin_rows(boolean) TO service_role;

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
      FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id, 'crm') y
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
REVOKE ALL ON FUNCTION public.refresh_contact_engagement(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_contact_engagement(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.count_contact_segment_def(p_venue_id text, p_organizer_user_id uuid, p_definition jsonb, p_product text DEFAULT 'suite')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v_n integer; v_e integer; v_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id, p_product);
  EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                 public.contact_definition_predicate(p_definition, 'c'))
    INTO v_n, v_e, v_p;
  DROP TABLE IF EXISTS _cr;
  RETURN jsonb_build_object('contacts', COALESCE(v_n,0), 'emails', COALESCE(v_e,0), 'phones', COALESCE(v_p,0));
END;
$function$;
REVOKE ALL ON FUNCTION public.count_contact_segment_def(text, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_contact_segment_def(text, uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._mcp_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue  text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org    uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_crm    boolean := p_product = 'crm';
  gate     record;
  w        record;
  v_event  uuid;
  v_ref    text;
  v_limit  integer;
  v_offset integer;
  v        jsonb;
  v2       jsonb;
  v3       jsonb;
  v_when   text;
  v_search text;
  v_topic  text;
  v_ids    uuid[];
  v_out    jsonb;
  r        record;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;
  -- Compte Yuno CRM : ses soirées sont des soirées MIROIR, qu'analytics_scope_gate
  -- écarte depuis le 07/10 (la Billetterie ne doit pas les compter). Sans elles,
  -- l'IA d'un compte CRM voyait « 0 soirée » et ne trouvait aucun rapport.
  IF v_crm THEN
    gate.scope_ids := public._mcp_email_scope_events(v_venue, v_org);
  END IF;

  CASE p_tool

  -- ── Contexte ──────────────────────────────────────────────────────────────
  WHEN 'get_account_overview' THEN
    SELECT jsonb_build_object(
      'past_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') < now()),
      'upcoming_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') >= now()),
      'first_event_at', min(e.start_at), 'last_event_at', max(e.start_at) FILTER (WHERE e.start_at < now()))
      INTO v
      FROM public.events e
     WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
       AND (e.is_active OR e.external_source IS NOT NULL);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at), '[]'::jsonb)
      INTO v2
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
             ORDER BY e.start_at LIMIT 5) x;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at DESC), '[]'::jsonb)
      INTO v3
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
             ORDER BY e.start_at DESC LIMIT 5) x;
    v_out := jsonb_build_object(
      'ok', true, 'now', now(), 'timezone', coalesce(gate.tz, p_tz),
      'today_local', to_char(now() AT TIME ZONE coalesce(gate.tz, p_tz), 'YYYY-MM-DD (Dy)'),
      'currency', 'EUR', 'product', p_product, 'can_see_money', gate.money,
      'access_level', p_level, 'events', v, 'next_events', v2, 'last_events', v3);
    IF v_crm THEN
      -- Statut de la billetterie connectée, lu ici (la RPC de la Console est
      -- réservée au fondateur et rend l'indice du jeton et l'erreur brute).
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'provider', tc.provider, 'account', tc.external_org_name, 'status', tc.status,
               'last_sync_ok_at', tc.last_ok_at, 'first_import_done', tc.initial_import_done_at IS NOT NULL,
               'has_sync_error', tc.last_error_at IS NOT NULL AND (tc.last_ok_at IS NULL OR tc.last_error_at > tc.last_ok_at)))
             ORDER BY tc.created_at), '[]'::jsonb)
        INTO v
        FROM public.ticketing_connections tc
       WHERE (v_venue IS NOT NULL AND tc.venue_id = v_venue) OR (v_org IS NOT NULL AND tc.organizer_user_id = v_org);
      v_out := v_out || jsonb_build_object('ticketing', v);
    END IF;
    RETURN v_out;

  -- ── Soirées ───────────────────────────────────────────────────────────────
  WHEN 'list_events' THEN
    v_when := coalesce(nullif(p_args->>'when', ''), 'all');
    v_search := nullif(btrim(coalesce(p_args->>'search', '')), '');
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 20), 60));
    IF v_crm THEN
      v := public.get_crm_nights(v_venue, v_org, 200, 0);
      SELECT coalesce(jsonb_agg(n ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                                           (n->>'start_at')::timestamptz DESC), '[]'::jsonb)
        INTO v2
        FROM (SELECT n FROM jsonb_array_elements(v->'nights') n
               WHERE (v_when = 'all' OR (v_when = 'upcoming') = coalesce((n->>'upcoming')::boolean, false))
                 AND (v_search IS NULL OR lower(n->>'title') LIKE '%' || lower(v_search) || '%')
               ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                        (n->>'start_at')::timestamptz DESC
               LIMIT v_limit) q;
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'total', v->'total', 'events', v2);
    END IF;
    v := public.get_analytics_event_rail(v_venue, v_org, 400);
    SELECT coalesce(jsonb_agg(q.e), '[]'::jsonb) INTO v2
      FROM (SELECT e FROM jsonb_array_elements(v->'events') e
             WHERE (v_when = 'all' OR (v_when = 'upcoming' AND e->>'phase' <> 'after')
                    OR (v_when = 'past' AND e->>'phase' = 'after'))
               AND (v_search IS NULL OR lower(e->>'title') LIKE '%' || lower(v_search) || '%')
               AND (nullif(p_args->>'from', '') IS NULL OR (e->>'startAt')::timestamptz >= (p_args->>'from')::date)
               AND (nullif(p_args->>'to', '') IS NULL OR (e->>'startAt')::timestamptz < (p_args->>'to')::date + 1)
             ORDER BY CASE WHEN v_when = 'upcoming' THEN (e->>'startAt')::timestamptz END ASC,
                      (e->>'startAt')::timestamptz DESC
             LIMIT v_limit) q;
    v_out := jsonb_build_object('ok', true, 'money', v->'money', 'events', v2);
    IF v_when IN ('upcoming', 'all') THEN
      -- Jauges et ventes du jour des prochaines soirées (même source que
      -- « Vos prochaines soirées » de l'accueil).
      v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
    END IF;
    RETURN v_out;

  WHEN 'get_event_report' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'event_id', v_event, 'report', public.get_crm_night_report(v_event));
    END IF;
    RETURN public.get_event_report(v_event);

  WHEN 'get_event_details' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v_topic := coalesce(nullif(p_args->>'topic', ''), 'ticket_types');
    CASE v_topic
      WHEN 'ticket_types' THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'name', tr.name, 'price', tr.price, 'capacity', tr.max_tickets, 'sold', tr.tickets_sold,
                 'fill_pct', CASE WHEN coalesce(tr.max_tickets, 0) > 0 THEN round(100.0 * tr.tickets_sold / tr.max_tickets, 1) END,
                 'open', tr.is_active, 'sold_out_by_hand', tr.manually_sold_out, 'hidden', tr.hidden,
                 'type', tr.ticket_type, 'group_size', CASE WHEN tr.is_group THEN tr.group_size END,
                 'sale_starts_at', tr.sale_starts_at, 'sale_ends_at', tr.sale_ends_at,
                 'entry_deadline', tr.entry_deadline, 'includes_free_drink', tr.includes_drink)
               ORDER BY tr.position, tr.price), '[]'::jsonb)
          INTO v
          FROM public.ticket_rounds tr WHERE tr.event_id = v_event;
        SELECT jsonb_build_object('title', e.title, 'start_at', e.start_at, 'selling_mode', e.ticket_selling_mode,
                 'ticketing_enabled', e.ticketing_enabled, 'tables_enabled', e.tables_enabled,
                 'guest_list_parts', (SELECT count(*) FROM public.guest_lists gl WHERE gl.event_id = e.id),
                 'tickets_sold_out', e.tickets_sold_out,
                 'tables_sold_out', e.tables_sold_out, 'guest_list_sold_out', e.guest_list_sold_out,
                 'entry_target', e.entry_target)
          INTO v2 FROM public.events e WHERE e.id = v_event;
        RETURN jsonb_build_object('ok', true, 'event', v2, 'ticket_types', v);
      WHEN 'tables' THEN
        RETURN public.get_vip_table_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'guest_list' THEN
        RETURN public.get_guest_list_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'traffic' THEN
        RETURN public.get_event_traffic(v_event);
      WHEN 'pacing' THEN
        RETURN public.get_analytics_pacing(v_event, 'previous', greatest(7, least(coalesce(nullif(p_args->>'days', '')::integer, 30), 90)));
      WHEN 'door' THEN
        RETURN public.get_analytics_door(v_venue, v_org, v_event, NULL, NULL);
      WHEN 'partners' THEN
        RETURN public.get_collab_party_breakdown(v_event);
      WHEN 'promoters' THEN
        RETURN public.get_analytics_promoters(v_venue, v_org, v_event, NULL, NULL);
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'unknown topic');
    END CASE;

  WHEN 'compare_events' THEN
    v_ids := '{}';
    IF jsonb_typeof(p_args->'events') = 'array' THEN
      FOR v_ref IN SELECT x FROM jsonb_array_elements_text(p_args->'events') x LIMIT 6 LOOP
        v_event := public._mcp_resolve_event(v_ref, gate.scope_ids);
        IF v_event IS NOT NULL AND NOT v_event = ANY (v_ids) THEN v_ids := v_ids || v_event; END IF;
      END LOOP;
    END IF;
    IF cardinality(v_ids) = 0 THEN
      SELECT coalesce(array_agg(x.id ORDER BY x.start_at DESC), '{}') INTO v_ids
        FROM (SELECT e.id, e.start_at FROM public.events e
               WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
                 AND (e.is_active OR e.external_source IS NOT NULL)
                 AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
               ORDER BY e.start_at DESC
               LIMIT greatest(2, least(coalesce(nullif(p_args->>'last', '')::integer, 4), 6))) x;
    END IF;
    v := '[]'::jsonb;
    FOREACH v_event IN ARRAY v_ids LOOP
      IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
        v2 := public.get_crm_night_report(v_event);
        v := v || jsonb_build_array(jsonb_build_object('event_id', v_event, 'source', 'ticketing',
                 'report', v2 - 'curve' - 'buyers_list'));
      ELSE
        v2 := public.get_event_report(v_event);
        v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'event', v2->'event', 'totals', v2->'totals', 'audience', v2->'audience',
                 'channels', v2->'channels', 'visit_sources', v2->'visitSources',
                 'takeaways', v2->'takeaways', 'money', v2->'money')));
      END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'events', v);

  -- ── Ventes ────────────────────────────────────────────────────────────────
  WHEN 'get_sales_overview' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'totals', v->'totals', 'fill', v->'fill', 'tariffs', v->'tariffs', 'from_yuno_messages', v->'msg',
        'events', v->'events', 'events_other', v->'events_other',
        'account', public.get_crm_overview(v_venue, v_org),
        'note', 'Yuno CRM account: sales reported by the connected ticketing over the period (24h, 48h, 7d, 30d, 90d or 12m ending today), compared with the period just before.');
    END IF;
    RETURN public.get_sales_takeaways(v_venue, v_org,
      CASE WHEN p_args->>'period' IN ('last', 'last4', 'month', 'year', 'all') THEN p_args->>'period' ELSE 'last4' END);

  WHEN 'get_sales_trends' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'series', v->'series', 'yuno_sends_on_the_series', v->'sends', 'pace_vs_reference_nights', v->'goal',
        'note', 'series[i] = tickets and revenue of slot i of the window (window.mode: hour, day or month from window.start), prev_* = same slot of the previous period.');
      BEGIN v_out := v_out || jsonb_build_object('traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('traffic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    BEGIN v_out := v_out || jsonb_build_object('curve', public.get_sales_period_curve(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('curve', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('drivers', public.get_sales_period_drivers(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('drivers', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('audience', public.get_sales_period_audience(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('audience', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_purchase_behavior' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'purchases_by_weekday_and_hour', v->'heat', 'ticket_tiers', v->'tariffs', 'totals', v->'totals',
        'note', 'purchases_by_weekday_and_hour: cells[weekday][slot], weekday 0 = Monday, 8 two-hour slots starting at 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00, 00:00 (local time), outside = purchases outside these slots; n = tickets, amount = revenue. '
             || 'buying_habits: tested hypotheses on how customers buy (see get_customer_analysis), never a certainty.');
      BEGIN
        v2 := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('buying_habits', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'status', f->>'status',
                   'availability', f->>'availability', 'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v2->'families', '[]'::jsonb)) f
           WHERE f->>'family' IN ('launch', 'early', 'last_minute', 'door', 'group', 'table')));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('buying_habits', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 180);
    RETURN public.get_purchase_behavior(v_venue, v_org, w.w_from, w.w_to);

  WHEN 'get_promoters_performance' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    RETURN public.get_analytics_promoters(v_venue, v_org, NULL, w.w_from, w.w_to);

  WHEN 'get_live_now' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    RETURN public.get_live_view(v_venue, v_org);

  -- ── Public et trafic ──────────────────────────────────────────────────────
  WHEN 'get_audience_overview' THEN
    IF v_crm THEN
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing');
      BEGIN v_out := v_out || jsonb_build_object('clients', public.crm_clients_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('clients', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, public._mcp_crm_period(p_args, 365), NULL, 'all');
        v_out := v_out || jsonb_build_object('community', v - 'top' - 'spark' - 'series',
          'note', 'community: lifecycle (hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night), '
               || 'hist = people by number of nights, reach = reachable by email / SMS, wake = people to bring back, cohort = return of each recent night''s buyers.');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v2 := public.crm_artists_analysis(v_venue, v_org, 10);
        v_out := v_out || jsonb_build_object('artists', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                   'return_rate', x->'return_rate', 'resident', x->'resident'))), '[]'::jsonb)
                   FROM jsonb_array_elements(coalesce(v2->'artists', '[]'::jsonb)) x));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('artists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('community', public.get_community_overview(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('tastes', public.get_community_tastes(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('tastes', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('cohorts', public.get_analytics_cohorts(v_venue, v_org, 6));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('cohorts', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_web_traffic' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 30);
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL),
        'note', 'Yuno CRM account: where ticket buyers came from (utm_source reported by the ticketing, Yuno links /go/, signup pages). Page visits on the ticketing site are not reported by Shotgun.');
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 30);
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('page', public.get_page_traffic(v_venue, v_org, least(w.w_days, 365)));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('page', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('sources', public.get_analytics_sources(v_venue, v_org, NULL, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sources', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'count_contacts' THEN
    IF jsonb_typeof(p_args->'conditions') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'conditions[] required');
    END IF;
    RETURN jsonb_build_object('ok', true, 'definition', jsonb_build_object('conditions', p_args->'conditions'),
      'result', public.count_contact_segment_def(v_venue, v_org, jsonb_build_object('conditions', p_args->'conditions'), CASE WHEN v_crm THEN 'crm' ELSE 'suite' END));

  WHEN 'get_customer_segments' THEN
    IF v_crm THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
               'template', s.template, 'definition', s.definition) ORDER BY s.updated_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.crm_segments cs
               WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                  OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org AND cs.venue_id IS NULL)
               ORDER BY cs.updated_at DESC LIMIT 40) s;
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'saved_segments', v);
      BEGIN
        v2 := public.crm_segments_overview(v_venue, v_org, public._mcp_crm_period(p_args, 90));
        v_out := v_out || jsonb_build_object('lifecycle_segments', v2->'segments', 'rules', v2->'rules', 'messages_totals', v2->'totals',
          'note', 'lifecycle keys: hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night (rules: regulars = N nights over M months).');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('lifecycle_segments', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
             'definition', s.definition, 'origin', s.origin) ORDER BY s.updated_at DESC), '[]'::jsonb)
      INTO v
      FROM (SELECT * FROM public.contact_segments cs
             WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org)
             ORDER BY cs.updated_at DESC LIMIT 30) s;
    v_out := jsonb_build_object('ok', true, 'saved_segments', v);
    BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('imported_lists', public.get_email_lists_health(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('imported_lists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('basket_threshold', public.suggest_basket_threshold(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('basket_threshold', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Marketing ─────────────────────────────────────────────────────────────
  WHEN 'get_marketing_performance' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_topic := coalesce(nullif(p_args->>'channel', ''), 'all');
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    IF v_topic IN ('all', 'email') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', c.id, 'name', c.name, 'subject', c.subject, 'type', c.type, 'status', c.status,
               'sent_at', c.sent_at, 'event_id', c.event_id,
               'recipients', coalesce(c.total_recipients, c.recipients_count), 'delivered', c.delivered_count,
               'opens', c.opens_count, 'clicks', c.clicks_count, 'clickers', c.clickers_count,
               'unsubscribes', c.unsubscribes_count, 'bounced', c.bounced_count, 'complaints', c.complained_count,
               'protected_by_yuno_rules', c.policy_skipped_count, 'ab_test', c.ab_enabled, 'ab_winner', c.ab_winner,
               'open_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * c.opens_count / c.delivered_count, 1) END,
               'click_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * coalesce(c.clickers_count, c.clicks_count) / c.delivered_count, 1) END))
             ORDER BY c.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.email_campaigns c
               WHERE ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL))
                 AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                 AND c.sent_at >= w.w_from AND c.sent_at < w.w_to
               ORDER BY c.sent_at DESC LIMIT 20) c;
      v_out := v_out || jsonb_build_object('email_campaigns', v);
      BEGIN
        v_out := v_out || jsonb_build_object('email_revenue_attribution', public.get_email_campaign_attribution(
            CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_revenue_attribution', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('best_send_time', public.get_email_send_time_insights(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('best_send_time', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'automations') THEN
      BEGIN v_out := v_out || jsonb_build_object('email_automations', public.get_email_automation_stats(v_venue, v_org, least(w.w_days, 365)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'push') AND NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('push_campaigns', public.get_push_campaigns(v_venue, v_org, 'all', NULL, 15, 0));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_campaigns', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('push_automatic', public.get_push_center(v_venue, v_org, least(w.w_days, 365)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_automatic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'sms') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', s.id, 'name', s.name, 'status', s.status, 'sent_at', s.sent_at, 'event_id', s.event_id,
               'recipients', s.total_recipients, 'sent', s.sent_count, 'delivered', s.delivered_count,
               'failed', s.failed_count, 'credits_used', s.credits_consumed)) ORDER BY s.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.sms_campaigns s
               WHERE ((v_venue IS NOT NULL AND s.venue_id = v_venue) OR (v_org IS NOT NULL AND s.organizer_id = v_org))
                 AND s.sent_at >= w.w_from AND s.sent_at < w.w_to
               ORDER BY s.sent_at DESC LIMIT 15) s;
      v_out := v_out || jsonb_build_object('sms_campaigns', v);
    END IF;
    RETURN v_out;

  WHEN 'get_campaign_report' THEN
    SELECT * INTO r FROM public.email_campaigns c
     WHERE c.id::text = coalesce(p_args->>'campaign_id', '')
       AND ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL));
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;
    BEGIN
      SELECT x INTO v FROM jsonb_array_elements(public.get_email_campaign_attribution(
          CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text))->'campaigns') x
       WHERE x->>'campaign_id' = r.id::text OR x->>'id' = r.id::text LIMIT 1;
    EXCEPTION WHEN others THEN v := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v2 := CASE WHEN r.ab_enabled THEN public.get_campaign_ab_stats(r.id) END;
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v3 := CASE WHEN r.resend_enabled THEN public.get_campaign_resend_stats(r.id) END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v_out := CASE WHEN r.followup_enabled THEN public.get_campaign_followup_stats(r.id) END;
    EXCEPTION WHEN others THEN v_out := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true,
      'campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', r.id, 'name', r.name, 'subject', r.subject, 'subject_b', r.subject_b, 'preheader', r.preheader,
        'status', r.status, 'sent_at', r.sent_at, 'event_id', r.event_id,
        'recipients', coalesce(r.total_recipients, r.recipients_count), 'delivered', r.delivered_count,
        'opens', r.opens_count, 'clicks', r.clicks_count, 'clickers', r.clickers_count,
        'unsubscribes', r.unsubscribes_count, 'bounced', r.bounced_count, 'complaints', r.complained_count,
        'failed', r.failed_count, 'suppressed', r.suppressed_count,
        'protected_by_yuno_rules', r.policy_skipped_count, 'paused_reason', r.paused_reason,
        'audiences', r.audiences_json, 'exclusions', r.exclusions_json, 'resend_enabled', r.resend_enabled,
        'followup_enabled', r.followup_enabled)),
      'revenue_attribution', v,
      'ab_test', v2,
      'resend_to_non_openers', v3,
      'click_followup', v_out);

  -- ── Conseils ──────────────────────────────────────────────────────────────
  WHEN 'get_recommendations' THEN
    v_out := jsonb_build_object('ok', true, 'product', p_product);
    IF v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('overview', public.get_crm_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('overview', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, '90d', NULL, 'all');
        v_out := v_out || jsonb_build_object('people_to_bring_back', v->'wake', 'reachable', v->'reach', 'lifecycle', v->'lifecycle');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('people_to_bring_back', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('supported_hypotheses', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'variant', nullif(f->>'variant', ''),
                   'gain', f->'gain', 'direction', f->'direction'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f
           WHERE f->>'status' = 'supported' AND f->>'availability' IN ('ok', 'reduced')),
          'return_delay_days', v->'state'->'stats'->'median_days');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('supported_hypotheses', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    ELSE
      BEGIN
        v := public.get_sales_takeaways(v_venue, v_org, 'last4');
        v_out := v_out || jsonb_build_object(
          'sales_takeaways', v->'takeaways',
          'sales_last4_vs_previous4', jsonb_build_object('current', v->'current', 'previous', v->'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sales_takeaways', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('upcoming_pipeline', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v_out := v_out || jsonb_build_object('signals_30d',
          public.get_analytics_insights(v_venue, v_org, NULL, now() - interval '30 days', now(), 'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('signals_30d', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN
      v_out := v_out || jsonb_build_object('automations',
        (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a->>'kind', 'enabled', a->'enabled', 'sent', a->'sent')), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(public.get_email_automation_stats(v_venue, v_org, 30), '[]'::jsonb)) a));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Analyse client (« ce qui fait venir », 20261010150000) ────────────────
  -- Agrégats seulement (niveau analytics) : statut de chaque famille
  -- d'hypothèses testée sur le compte, hypothèses des nouveaux venus, venus
  -- une fois, délai de retour, couverture, artistes. Aucune identité.
  -- « Qui cibler » (20261011110000) : audiences sans place d'une soirée à venir.
  WHEN 'get_event_targets' THEN
    IF NOT v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_outside_crm'); END IF;
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL AND nullif(coalesce(p_args->>'event_id', p_args->>'event'), '') IS NULL THEN
      SELECT e.id INTO v_event FROM public.events e
       WHERE e.id = ANY (gate.scope_ids) AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
         AND coalesce(e.end_at, e.start_at + interval '6 hours') > now()
       ORDER BY e.start_at LIMIT 1;
    END IF;
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v := public.crm_night_targets(v_venue, v_org, v_event);
    RETURN v || jsonb_build_object('note',
      'Audiences are people WITHOUT a ticket for this event; one person can be in several. status = what the account data says about the hypothesis family '
      || '(supported, not_supported, untested, inconclusive), never a certainty about a person. send_at = suggested moment.');

  WHEN 'get_customer_analysis' THEN
    BEGIN
      v := public.crm_analysis_overview(v_venue, v_org);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'error', 'analysis_unavailable', 'detail', public._mcp_unavailable(SQLSTATE, SQLERRM));
    END;
    IF v->'state' IS NULL OR jsonb_typeof(v->'state') = 'null' THEN
      RETURN jsonb_build_object('ok', true, 'computed', false,
        'note', 'No customer analysis yet: it needs a connected ticketing (Shotgun) and runs the night after the first import.');
    END IF;
    BEGIN
      v2 := public.crm_artists_analysis(v_venue, v_org, 15);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'computed', true,
      'computed_at', v->'state'->'full_at', 'rules_version', v->'rules_version', 'min_sample', v->'min_sample',
      'families', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'family', f->>'family', 'variant', nullif(f->>'variant', ''), 'kind', f->>'kind',
                     'availability', f->>'availability', 'status', f->>'status',
                     'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain', 'z', f->'z',
                     'direction', f->'direction', 'return_rate_group', f->'detail'->'r1', 'return_rate_others', f->'detail'->'r0',
                     'confirmed_since', CASE WHEN f->>'status' = 'supported' THEN f->'since' END,
                     'seen_on_other_accounts', f->'prior'))), '[]'::jsonb)
                     FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f),
      'newcomers_12_months', v->'newcomers',
      'came_once', v->'once',
      'return_delay_days', jsonb_build_object('median', v->'state'->'stats'->'median_days', 'p25', v->'state'->'stats'->'p25_days',
                                              'p75', v->'state'->'stats'->'p75_days', 'returners', v->'state'->'stats'->'returners'),
      'newcomers_returned_6_months', jsonb_build_object('eligible', v->'state'->'stats'->'eligible', 'returned', v->'state'->'stats'->'returned'),
      'coverage', v->'state'->'coverage',
      'artists', CASE WHEN jsonb_typeof(v2) = 'object' AND v2 ? 'artists' THEN jsonb_build_object(
                   'baseline_return_rate', v2->'baseline'->'rate',
                   'top', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                             'newcomers_returned_6_months', x->'new_returned', 'newcomers_eligible', x->'new_eligible',
                             'return_rate', x->'return_rate', 'seen_twice_or_more', x->'fans', 'resident', x->'resident'))), '[]'::jsonb)
                             FROM jsonb_array_elements(v2->'artists') x)) ELSE v2 END);

  -- ── Fiches clients (niveau 'customers' seulement) ─────────────────────────
  WHEN 'list_customers' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_offset := greatest(0, least(coalesce(nullif(p_args->>'offset', '')::integer, 0), 500));
    -- Filtre de l'analyse client : clients qui portent une hypothèse (moyenne ou
    -- forte), ou « de passage » / habitant à proximité. Liste Clients du CRM.
    IF nullif(p_args->>'hypothesis', '') IS NOT NULL OR nullif(p_args->>'passing', '') IS NOT NULL THEN
      v := public.crm_clients_list(v_venue, v_org,
             jsonb_build_object('seg', 'all', 'f', jsonb_strip_nulls(jsonb_build_object(
               'hyp', CASE WHEN p_args->>'hypothesis' ~ '^[a-z_]{2,24}$' THEN jsonb_build_array(p_args->>'hypothesis') END,
               'pass', CASE WHEN p_args->>'passing' = 'true' THEN 'yes' WHEN p_args->>'passing' = 'false' THEN 'no' END))),
             CASE WHEN p_args->>'sort' = 'name' THEN 'name' WHEN p_args->>'sort' = 'events' THEN 'n'
                  WHEN p_args->>'sort' = 'spent' THEN 'sp' ELSE 'last' END, 1, v_limit, v_offset);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit,
                                'filter', jsonb_strip_nulls(jsonb_build_object('hypothesis', p_args->>'hypothesis', 'passing', p_args->'passing')),
                                'customers', v2);
    END IF;
    v := public.list_contact_base(v_venue, v_org,
           nullif(btrim(coalesce(p_args->>'search', '')), ''),
           CASE WHEN p_args->>'segment_id' ~* '^[0-9a-f-]{36}$' THEN (p_args->>'segment_id')::uuid END,
           CASE WHEN p_args->>'status' IN ('active', 'passive', 'silent', 'new', 'unsubscribed', 'unreachable') THEN p_args->>'status' END,
           CASE WHEN p_args->>'origin' IN ('import', 'yuno', 'both') THEN p_args->>'origin' END,
           NULL,
           CASE WHEN p_args->>'sort' IN ('recent', 'engaged', 'spent', 'events', 'name') THEN p_args->>'sort' ELSE 'spent' END,
           v_limit, v_offset);
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
             'phone', CASE WHEN coalesce((p_args->>'include_phone')::boolean, false) THEN x->>'phone_e164' END,
             'city', x->>'city', 'age', x->'age', 'gender', x->>'gender', 'status', x->>'status',
             'origin', x->>'origin', 'total_spent', x->'total_spent', 'events', x->'event_count',
             'tables', x->'table_count', 'tickets', x->'ticket_count', 'guest_lists', x->'guest_list_count',
             'last_seen_at', x->>'last_seen_at', 'emails_received', x->'emails_sent', 'opens', x->'opens',
             'clicks', x->'clicks', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
      INTO v2
      FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
    RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit, 'customers', v2);

  WHEN 'list_customers_by_segment' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_topic := nullif(p_args->>'segment', '');
    IF v_crm THEN
      v_ref := CASE WHEN v_topic IN ('champions', 'loyal') THEN 'hab' WHEN v_topic = 'promising' THEN 'occ'
                    WHEN v_topic = 'new' THEN 'nou' WHEN v_topic IN ('at_risk', 'dormant', 'lost', 'churn_risk') THEN 'end' END;
      v := public.crm_clients_list(v_venue, v_org, jsonb_build_object('seg', coalesce(v_ref, 'all'), 'f', '{}'::jsonb),
             'sp', 1, v_limit, 0);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'lifecycle', v_ref, 'total', v->'total', 'customers', v2,
        'note', 'Yuno CRM account: segment mapped to the CRM lifecycle (champions/loyal = regulars, promising = occasional, new = new, at_risk/dormant/lost/churn_risk = lapsed).');
    END IF;
    IF v_venue IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_venue_customer_segments(v_venue) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_organizer_customer_segments(v_org) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    END IF;
    RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'customers', v);

  WHEN 'get_customer_profile' THEN
    v_ref := lower(btrim(coalesce(p_args->>'email', '')));
    IF v_ref !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'email required');
    END IF;
    -- La base de contacts filtrée par l'adresse (350 ms), pas contact_rows()
    -- entier (jusqu'à 20 s sur un compte CRM : la fiche ne répondait jamais).
    v2 := public.list_contact_base(v_venue, v_org, v_ref, NULL, NULL, NULL, NULL, 'recent', 10, 0);
    SELECT x - 'id' - 'list_import_id' INTO v
      FROM jsonb_array_elements(coalesce(v2->'rows', '[]'::jsonb)) x
     WHERE lower(x->>'email') = v_ref LIMIT 1;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'customer_not_found'); END IF;
    BEGIN v2 := public.get_customer_automation_emails(v_venue, v_org, v_ref);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    -- Analyse client : ses hypothèses (des FAITS + le statut de leur famille
    -- sur le compte), jamais une affirmation de motif.
    BEGIN
      v3 := public.crm_client_analysis(v_venue, v_org, v_ref);
      v3 := CASE WHEN coalesce((v3->>'profile')::boolean, false) THEN jsonb_build_object(
              'excluded_from_profiling', v3->'excluded', 'nights', v3->'nights', 'distance_km', v3->'dist_km',
              'passing_through', v3->'passing',
              'hypotheses', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                               'family', h->>'f', 'strength', h->>'s', 'evidence_key', h->>'k', 'evidence', h->'p',
                               'family_status_on_account', h->>'status', 'family_availability', h->>'availability',
                               'direction', h->>'direction'))), '[]'::jsonb)
                               FROM jsonb_array_elements(coalesce(v3->'hyps', '[]'::jsonb)) h),
              'chances_to_come', CASE WHEN v3->>'score_status' = 'ok' THEN v3->'chances' END,
              'first_night', jsonb_strip_nulls(jsonb_build_object(
                'title', v3->'first'->>'title', 'date', v3->'first'->>'start_at', 'days_before', v3->'first'->'lead_days',
                'source', v3->'first'->>'src', 'order_size', v3->'first'->'order_size',
                'with_existing_customer', v3->'first'->'with_returning', 'invitation', v3->'first'->'invitation')))
            ELSE jsonb_build_object('excluded_from_profiling', v3->'excluded', 'hypotheses', '[]'::jsonb,
                                    'note', 'No analysis profile: no Shotgun ticket for this contact, or excluded at their request.') END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'customer', v, 'automation_emails', v2, 'analysis', v3);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$function$;
REVOKE ALL ON FUNCTION public._mcp_tool(text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── Données dérivées du cache (rien d'autre n'est touché) ─────────────────────
-- 1. La vue CRM démarre à l'identique : on recopie l'état et les lignes du cache actuel
--    (clé « …|crm ») pour tout compte qui a le CRM. Aucune reconstruction, aucune attente.
INSERT INTO public.contact_base_cache_state (scope_key, built_at, dirty_at, last_read_at, venue_id, organizer_user_id, row_count)
SELECT s.scope_key || '|crm', s.built_at, s.dirty_at, s.last_read_at, s.venue_id, s.organizer_user_id, s.row_count
  FROM public.contact_base_cache_state s
 WHERE s.scope_key NOT LIKE '%|crm'
   AND public.crm_scope_has_crm(public.crm_scope_key(s.venue_id, s.organizer_user_id))
ON CONFLICT (scope_key) DO NOTHING;

INSERT INTO public.contact_base_cache
SELECT (jsonb_populate_record(c, jsonb_build_object('scope_key', c.scope_key || '|crm'))).*
  FROM public.contact_base_cache c
 WHERE c.scope_key NOT LIKE '%|crm'
   AND EXISTS (SELECT 1 FROM public.contact_base_cache_state s WHERE s.scope_key = c.scope_key || '|crm')
   AND NOT EXISTS (SELECT 1 FROM public.contact_base_cache x WHERE x.scope_key = c.scope_key || '|crm' AND x.id = c.id);

-- 2. Le cache de la Billetterie d'une portée qui a (ou a eu) une connexion billetterie contenait
--    les acheteurs Shotgun : purge, reconstruction à la première lecture (sans Shotgun).
CREATE TEMP TABLE _ct_connected_keys ON COMMIT DROP AS
  SELECT public.contact_base_scope_key(tc.venue_id, tc.organizer_user_id) AS k FROM public.ticketing_connections tc
  UNION
  SELECT public.contact_base_scope_key(x.venue_id, x.organizer_user_id) FROM (SELECT DISTINCT venue_id, organizer_user_id FROM public.external_tickets) x;
DELETE FROM public.contact_base_cache c WHERE c.scope_key IN (SELECT k FROM _ct_connected_keys);
DELETE FROM public.contact_base_cache_state s WHERE s.scope_key IN (SELECT k FROM _ct_connected_keys);
