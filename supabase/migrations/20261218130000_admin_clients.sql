-- Rubrique « Clients » de l'admin unique (refonte, lot 3,
-- docs/designs/ADMIN_REBUILD_PLAN.md). Deux lectures, aucune n'écrit, aucune
-- n'utilise de table temporaire, super admin seul (42501 sinon).
--
--  1. admin_clients_period(p_days) : les cinq chiffres de la vue d'ensemble
--     comparés à la période précédente, et la courbe des nouveaux clients.
--     N'ASSEMBLE QUE `_admin_customer_activity()` : même définition d'un
--     client (quelqu'un qui est VENU : billet, table payée, guest list) et
--     même exclusion de la démo que `admin_segmentation_overview`. La démo
--     n'entre donc jamais dans ces chiffres (les fonctions de base ne
--     prennent pas de paramètre) : l'écran le dit quand l'interrupteur démo
--     est allumé.
--
--  2. admin_person(p_email, p_user_id) : LA fiche d'une personne, qui réunit
--     l'ancienne fiche CRM (`admin_customer_detail`, par e-mail) et l'ancienne
--     fiche de compte (`AdminUserDetail`, par id). Clé = l'e-mail (sept clients
--     sur neuf n'ont pas de compte) ; un id de compte est accepté et résolu en
--     e-mail par le profil. Elle assemble : le détail existant, les achats un
--     par un (billets, tables, guest list ; jamais les boissons, pilier en
--     pause), les consentements, les derniers messages reçus (e-mails de
--     campagne et push) et le compte (profil, rôles, clubs possédés).

CREATE OR REPLACE FUNCTION public.admin_clients_period(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 400);
  v_e1 timestamptz := now();
  v_s1 timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 400));
  v_s0 timestamptz := now() - make_interval(days => 2 * LEAST(GREATEST(COALESCE(p_days, 30), 1), 400));
  v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH a AS MATERIALIZED (
    SELECT em, created_at FROM public._admin_customer_activity()
  ),
  per AS (
    SELECT em, min(created_at) AS first_at FROM a GROUP BY em
  ),
  act_cur AS (SELECT DISTINCT em FROM a WHERE created_at > v_s1),
  act_prev AS (SELECT DISTINCT em FROM a WHERE created_at > v_s0 AND created_at <= v_s1),
  days AS (
    SELECT i, (v_e1::date - (v_days - 1 - i)) AS d
    FROM generate_series(0, v_days - 1) i
  ),
  newc AS (SELECT first_at::date AS d, count(*) AS n FROM per GROUP BY 1)
  SELECT jsonb_build_object(
    'days', v_days,
    'clients',      jsonb_build_object(
      'current',  (SELECT count(*) FROM per WHERE first_at <= v_e1),
      'previous', (SELECT count(*) FROM per WHERE first_at <= v_s1)),
    'new',          jsonb_build_object(
      'current',  (SELECT count(*) FROM per WHERE first_at > v_s1 AND first_at <= v_e1),
      'previous', (SELECT count(*) FROM per WHERE first_at > v_s0 AND first_at <= v_s1)),
    'active',       jsonb_build_object(
      'current',  (SELECT count(*) FROM act_cur),
      'previous', (SELECT count(*) FROM act_prev)),
    -- Taux de retour : parmi les clients actifs sur la période, la part qui
    -- était déjà cliente avant son début.
    'returning',    jsonb_build_object(
      'current',  (SELECT CASE WHEN count(*) = 0 THEN NULL
                     ELSE round(100.0 * count(*) FILTER (WHERE p.first_at <= v_s1) / count(*), 1) END
                   FROM act_cur c JOIN per p USING (em)),
      'previous', (SELECT CASE WHEN count(*) = 0 THEN NULL
                     ELSE round(100.0 * count(*) FILTER (WHERE p.first_at <= v_s0) / count(*), 1) END
                   FROM act_prev c JOIN per p USING (em))),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', to_char(dd.d, 'YYYY-MM-DD'),
        'new', COALESCE(n1.n, 0),
        'prev', COALESCE(n0.n, 0)) ORDER BY dd.i)
      FROM days dd
      LEFT JOIN newc n1 ON n1.d = dd.d
      LEFT JOIN newc n0 ON n0.d = dd.d - v_days
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_person(p_email text DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_uid   uuid;
  v_out   jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Un id de compte devient l'e-mail de son profil.
  IF v_email = '' AND p_user_id IS NOT NULL THEN
    SELECT lower(p.email) INTO v_email FROM public.profiles p WHERE p.id = p_user_id;
  END IF;
  IF COALESCE(v_email, '') = '' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- Le compte VIVANT de cet e-mail (un profil orphelin n'est pas un compte).
  SELECT p.id INTO v_uid
  FROM public.profiles p
  WHERE lower(p.email) = v_email
  ORDER BY (EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)) DESC, p.created_at DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'found', true,
    'email', v_email,
    'user_id', v_uid,
    'detail', public.admin_customer_detail(v_email),

    'purchases', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.at DESC) FROM (
        SELECT * FROM (
          SELECT 'ticket'::text AS kind, t.id::text AS id, t.reference_code AS ref,
                 t.event_id, e.title AS event_title, e.start_at AS event_at,
                 COALESCE(e.venue_id, e.partner_venue_id) AS venue_id,
                 v.name AS venue_name, op.display_name AS organizer_name,
                 t.total_price::numeric AS amount, t.status,
                 COALESCE(t.paid_at, t.created_at) AS at, t.quantity::int AS qty
          FROM public.tickets t
          LEFT JOIN public.events e ON e.id = t.event_id
          LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
          LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
          WHERE lower(t.user_email) = v_email
            AND (t.paid_at IS NOT NULL OR t.status IN ('refunded', 'cancelled'))
          UNION ALL
          SELECT 'table', r.id::text, r.reference_code,
                 r.event_id, e.title, e.start_at,
                 COALESCE(e.venue_id, e.partner_venue_id), v.name, op.display_name,
                 r.total_price::numeric, r.status,
                 COALESCE(r.paid_at, r.created_at), r.guest_count::int
          FROM public.table_reservations r
          LEFT JOIN public.events e ON e.id = r.event_id
          LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
          LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
          WHERE lower(r.user_email) = v_email
            AND (r.paid_at IS NOT NULL OR r.status IN ('refunded', 'cancelled'))
          UNION ALL
          SELECT 'guestlist', g.id::text, g.reservation_code,
                 e.id, e.title, e.start_at,
                 COALESCE(e.venue_id, e.partner_venue_id), v.name, op.display_name,
                 0::numeric, g.status, g.created_at, 1
          FROM public.guest_list_entries g
          JOIN public.guest_lists gl ON gl.id = g.guest_list_id
          LEFT JOIN public.events e ON e.id = gl.event_id
          LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
          LEFT JOIN public.organizer_profiles op ON op.user_id = e.organizer_user_id
          WHERE lower(g.email) = v_email
        ) u
        ORDER BY u.at DESC
        LIMIT 200
      ) x
    ), '[]'::jsonb),

    'consents', jsonb_build_object(
      'subscriptions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'scope_kind', CASE WHEN ns.venue_id IS NOT NULL THEN 'venue'
                             WHEN ns.organizer_user_id IS NOT NULL THEN 'organizer' ELSE 'platform' END,
          'scope_name', COALESCE(v.name, op.display_name),
          'product', ns.product, 'opted_in', ns.opted_in, 'opted_out_at', ns.opted_out_at,
          'source', ns.source, 'consent_source', ns.consent_source,
          'recorded_at', COALESCE(ns.consent_recorded_at, ns.created_at)
        ) ORDER BY ns.created_at DESC)
        FROM public.newsletter_subscriptions ns
        LEFT JOIN public.venues v ON v.id = ns.venue_id
        LEFT JOIN public.organizer_profiles op ON op.user_id = ns.organizer_user_id
        WHERE lower(ns.email) = v_email
      ), '[]'::jsonb),
      'opt_outs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'scope_name', COALESCE(v.name, op.display_name), 'reason', eo.reason,
          'product', eo.product, 'at', COALESCE(eo.opted_out_at, eo.purged_at)
        ) ORDER BY eo.purged_at DESC)
        FROM public.email_opt_outs eo
        LEFT JOIN public.venues v ON v.id = eo.venue_id
        LEFT JOIN public.organizer_profiles op ON op.user_id = eo.organizer_user_id
        WHERE lower(eo.email) = v_email
      ), '[]'::jsonb),
      'suppressions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'reason', es.reason, 'source', es.source, 'at', es.created_at
        ) ORDER BY es.created_at DESC)
        FROM public.email_suppressions es
        WHERE lower(es.email) = v_email
      ), '[]'::jsonb)
    ),

    'messages', jsonb_build_object(
      'emails', COALESCE((
        SELECT jsonb_agg(m ORDER BY m.at DESC) FROM (
          SELECT c.subject, c.name AS campaign, r.sent_at AS at, c.product,
                 COALESCE(v.name, op.display_name) AS sender
          FROM public.email_campaign_recipients r
          JOIN public.email_campaigns c ON c.id = r.campaign_id
          LEFT JOIN public.venues v ON v.id = c.venue_id
          LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id
          WHERE lower(r.email) = v_email AND r.status = 'sent' AND r.sent_at IS NOT NULL
          ORDER BY r.sent_at DESC
          LIMIT 50
        ) m
      ), '[]'::jsonb),
      'push', CASE WHEN v_uid IS NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(m ORDER BY m.at DESC) FROM (
          SELECT pc.title, pe.event_type, pe.created_at AS at,
                 COALESCE(v.name, op.display_name) AS sender
          FROM public.push_campaign_events pe
          JOIN public.push_campaigns pc ON pc.id = pe.campaign_id
          LEFT JOIN public.venues v ON v.id = pc.venue_id
          LEFT JOIN public.organizer_profiles op ON op.user_id = pc.organizer_user_id
          WHERE pe.user_id = v_uid
          ORDER BY pe.created_at DESC
          LIMIT 50
        ) m
      ), '[]'::jsonb) END
    ),

    'account', CASE WHEN v_uid IS NULL THEN NULL ELSE jsonb_build_object(
      'profile', (SELECT jsonb_build_object(
          'id', p.id, 'email', p.email, 'first_name', p.first_name, 'last_name', p.last_name,
          'city', p.city, 'venue_id', p.venue_id, 'created_at', p.created_at,
          'mfa_enabled', COALESCE(p.mfa_enabled, false), 'is_suspended', COALESCE(p.is_suspended, false),
          'suspension_reason', p.suspension_reason,
          'alive', EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id))
        FROM public.profiles p WHERE p.id = v_uid),
      'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', ur.role, 'created_at', ur.created_at)
                                          ORDER BY ur.created_at)
                         FROM public.user_roles ur WHERE ur.user_id = v_uid), '[]'::jsonb),
      'owned_venues', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ve.id, 'name', ve.name))
                                FROM public.venues ve WHERE ve.owner_id = v_uid), '[]'::jsonb)
    ) END
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_clients_period(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_clients_period(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_person(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_person(text, uuid) TO authenticated;
