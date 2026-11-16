-- Refonte de l'admin, lot 2 : la rubrique « Pros » (docs/designs/ADMIN_REBUILD_PLAN.md).
--
-- Une ligne par compte pro, tous produits (clé `venue:<id>` | `org:<uuid>` |
-- `agency:<id>`), une fiche complète par compte, des notes et étiquettes pour
-- tous les produits, et les lectures qui réunissent prospects et accès assisté.
--
-- Les calculs ne changent pas : le CA club suit la formule de
-- admin_venue_overview (fees.ts : billets total − frais de service − assurance,
-- tables total − frais de service − frais de gestion absorbés, statuts de la
-- compta), l'état CRM vient de _crm_admin_rows (santé, MRR, Yunits), rien n'est
-- recalculé. Le bar (pilier en pause) n'entre nulle part.
--
-- Statuts de cycle de vie d'un compte (une seule définition, ici ; l'écran les
-- dit dans une info-bulle, adm.pros.st.*.def) :
--   closed     club décommissionné, agence désactivée ou titulaire suspendu ;
--   selling    une vente Yuno dans les 30 derniers jours, ou un abonnement
--              Yuno CRM payant en bonne santé (40/100 ou plus) ;
--   at_risk    a déjà vendu mais rien depuis 30 jours et aucune soirée à venir,
--              ou CRM en retard de paiement, en essai qui finit sous 3 jours,
--              ou en dessous de 40/100 ;
--   paused     compte Yuno CRM seul dont l'abonnement est en pause ou résilié ;
--   configured paiements Stripe prêts, connexion billetterie posée ou une
--              soirée à venir, sans vente encore ;
--   signed_up  le titulaire s'est connecté, rien n'est configuré ;
--   invited    personne ne s'est encore connecté (invitation pas acceptée).
-- L'ordre ci-dessus est l'ordre d'évaluation.

-- ── Notes et étiquettes, tous produits ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_account_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL CHECK (account_key ~ '^(venue|org|agency):.+$'),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  pinned boolean NOT NULL DEFAULT false,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_account_notes_key_idx ON public.admin_account_notes (account_key, created_at DESC);
ALTER TABLE public.admin_account_notes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_account_tags (
  account_key text PRIMARY KEY CHECK (account_key ~ '^(venue|org|agency):.+$'),
  tags text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_account_tags ENABLE ROW LEVEL SECURITY;
-- RLS sans policy : tout passe par les RPC ci-dessous.

-- ── admin_accounts : la liste ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_accounts(p_include_demo boolean DEFAULT false, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := GREATEST(1, LEAST(COALESCE(p_days, 30), 400));
  v_from timestamptz := now() - make_interval(days => v_days);
  v_prev timestamptz := now() - make_interval(days => 2 * v_days);
  v_crm jsonb;
  v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_crm := public._crm_admin_rows(p_include_demo);

  WITH d AS MATERIALIZED (
    SELECT public.demo_venue_ids() AS dv
  ),
  acc AS MATERIALIZED (
    SELECT 'venue:' || v.id AS k, 'club'::text AS type, v.id::text AS ref, v.name::text AS name, v.city::text AS city,
           v.owner_id, v.created_at,
           (v.product IS NULL OR v.product = 'suite' OR 'suite' = ANY(COALESCE(v.extra_products, '{}'::text[]))) AS has_tickets,
           (v.product = 'crm' OR 'crm' = ANY(COALESCE(v.extra_products, '{}'::text[]))) AS has_crm,
           COALESCE(v.stripe_charges_enabled, false) AS stripe_ready,
           (v.decommissioned_at IS NOT NULL) AS closed_flag, COALESCE(v.is_hidden, false) AS hidden,
           (v.id = ANY(d.dv) OR public.is_demo_email(p.email)) AS is_demo
      FROM public.venues v CROSS JOIN d
      LEFT JOIN public.profiles p ON p.id = v.owner_id
    UNION ALL
    SELECT 'org:' || o.user_id, CASE WHEN COALESCE(o.bde_verified, false) THEN 'association' ELSE 'organizer' END,
           o.user_id::text, COALESCE(NULLIF(o.display_name, ''), p.organization_name, p.email)::text, o.city::text,
           o.user_id, o.created_at,
           (o.product IS NULL OR o.product = 'suite' OR 'suite' = ANY(COALESCE(o.extra_products, '{}'::text[]))),
           (o.product = 'crm' OR 'crm' = ANY(COALESCE(o.extra_products, '{}'::text[]))),
           COALESCE(p.stripe_connect_charges_enabled, false),
           false, NOT COALESCE(o.is_public, true),
           public.is_demo_email(p.email)
      FROM public.organizer_profiles o
      LEFT JOIN public.profiles p ON p.id = o.user_id
    UNION ALL
    SELECT 'agency:' || a.id, 'agency', a.id::text, a.name::text, a.city::text,
           a.owner_user_id, a.created_at, true, false,
           COALESCE(p.stripe_connect_charges_enabled, false),
           NOT COALESCE(a.is_active, true), false,
           public.is_demo_email(p.email)
      FROM public.agencies a
      LEFT JOIN public.profiles p ON p.id = a.owner_user_id
  ),
  keep AS MATERIALIZED (
    SELECT acc.*, p.email AS owner_email, NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '') AS owner_name,
           p.phone AS owner_phone, COALESCE(p.is_suspended, false) AS suspended, u.last_sign_in_at
      FROM acc
      LEFT JOIN public.profiles p ON p.id = acc.owner_id
      LEFT JOIN auth.users u ON u.id = acc.owner_id
     WHERE p_include_demo OR NOT acc.is_demo
  ),
  ev AS MATERIALIZED (
    SELECT e.id, e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id,
           e.start_at, e.end_at, e.created_at, e.cancelled_at
      FROM public.events e
     WHERE e.external_source IS NULL
  ),
  ev_scope AS MATERIALIZED (
    SELECT id AS event_id, 'venue:' || venue_id AS k FROM ev WHERE venue_id IS NOT NULL
    UNION SELECT id, 'venue:' || partner_venue_id FROM ev WHERE partner_venue_id IS NOT NULL
    UNION SELECT id, 'org:' || organizer_user_id FROM ev WHERE organizer_user_id IS NOT NULL
    UNION SELECT id, 'org:' || partner_organizer_id FROM ev WHERE partner_organizer_id IS NOT NULL
  ),
  sale AS MATERIALIZED (
    SELECT t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS rev
      FROM public.tickets t
     WHERE t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT tr.event_id, COALESCE(tr.paid_at, tr.created_at),
           (tr.total_price - COALESCE(tr.service_fee, 0)
             - CASE WHEN COALESCE(tr.fee_absorbed, false) THEN COALESCE(tr.management_fee, 0) ELSE 0 END)::numeric
      FROM public.table_reservations tr
     WHERE tr.status IN ('paid', 'confirmed')
  ),
  sales_by AS (
    SELECT es.k,
           count(*) FILTER (WHERE s.at >= v_from) AS n_period,
           count(*) FILTER (WHERE s.at >= v_prev AND s.at < v_from) AS n_prev,
           count(*) FILTER (WHERE s.at >= now() - interval '30 days') AS n30,
           count(*) AS n_total,
           round(COALESCE(sum(s.rev) FILTER (WHERE s.at >= v_from), 0), 2) AS rev_period,
           round(COALESCE(sum(s.rev) FILTER (WHERE s.at >= v_prev AND s.at < v_from), 0), 2) AS rev_prev,
           round(COALESCE(sum(s.rev), 0), 2) AS rev_total,
           max(s.at) AS last_sale_at
      FROM sale s JOIN ev_scope es ON es.event_id = s.event_id
     GROUP BY es.k
  ),
  agency_sales AS (
    SELECT 'agency:' || c.agency_id AS k,
           count(*) FILTER (WHERE c.created_at >= v_from) AS n_period,
           count(*) FILTER (WHERE c.created_at >= v_prev AND c.created_at < v_from) AS n_prev,
           count(*) FILTER (WHERE c.created_at >= now() - interval '30 days') AS n30,
           count(*) AS n_total, max(c.created_at) AS last_sale_at
      FROM public.agency_conversions c
     WHERE c.club_status IS DISTINCT FROM 'cancelled'
     GROUP BY c.agency_id
  ),
  events_by AS (
    SELECT es.k,
           count(*) FILTER (WHERE e.cancelled_at IS NULL AND COALESCE(e.end_at, e.start_at + interval '8 hours') >= now()) AS upcoming,
           count(*) AS total, max(e.created_at) AS last_event_created
      FROM ev e JOIN ev_scope es ON es.event_id = e.id
     GROUP BY es.k
  ),
  crm AS MATERIALIZED (
    SELECT r->>'id' AS k, r FROM jsonb_array_elements(COALESCE(v_crm, '[]'::jsonb)) r
  ),
  grants AS (
    SELECT DISTINCT ON (g.target_user_id) g.target_user_id, g.status, g.created_at
      FROM public.admin_support_grants g
     WHERE g.status IN ('pending', 'active') AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
     ORDER BY g.target_user_id, g.created_at DESC
  ),
  pins AS (
    SELECT DISTINCT ON (n.account_key) n.account_key, n.body
      FROM public.admin_account_notes n WHERE n.pinned
     ORDER BY n.account_key, n.updated_at DESC
  ),
  rows AS (
    SELECT k.*,
           COALESCE(sb.n_period, ag.n_period, 0) AS n_period, COALESCE(sb.n_prev, ag.n_prev, 0) AS n_prev,
           COALESCE(sb.n30, ag.n30, 0) AS n30, COALESCE(sb.n_total, ag.n_total, 0) AS n_total,
           CASE WHEN k.type = 'agency' THEN NULL ELSE COALESCE(sb.rev_period, 0) END AS rev_period,
           CASE WHEN k.type = 'agency' THEN NULL ELSE COALESCE(sb.rev_prev, 0) END AS rev_prev,
           CASE WHEN k.type = 'agency' THEN NULL ELSE COALESCE(sb.rev_total, 0) END AS rev_total,
           COALESCE(sb.last_sale_at, ag.last_sale_at) AS last_sale_at,
           COALESCE(eb.upcoming, 0) AS upcoming, COALESCE(eb.total, 0) AS events_total, eb.last_event_created,
           c.r AS crm_row,
           g.status AS grant_status,
           COALESCE(pn.body, NULLIF(cn.body, '')) AS pinned_note,
           COALESCE(tg.tags, '{}'::text[]) AS tags
      FROM keep k
      LEFT JOIN sales_by sb ON sb.k = k.k
      LEFT JOIN agency_sales ag ON ag.k = k.k
      LEFT JOIN events_by eb ON eb.k = k.k
      LEFT JOIN crm c ON c.k = k.k
      LEFT JOIN grants g ON g.target_user_id = k.owner_id
      LEFT JOIN pins pn ON pn.account_key = k.k
      LEFT JOIN public.crm_admin_notes cn ON cn.scope_key = k.k
      LEFT JOIN public.admin_account_tags tg ON tg.account_key = k.k
  ),
  lc AS (
    SELECT r.*,
           CASE
             WHEN r.closed_flag OR r.suspended THEN 'closed'
             WHEN r.n30 > 0 OR (r.crm_row->>'state' = 'paid' AND COALESCE((r.crm_row->>'health')::int, 0) >= 40) THEN 'selling'
             WHEN (r.n_total > 0 AND r.upcoming = 0)
               OR r.crm_row->>'state' = 'late'
               OR (r.crm_row->>'state' = 'trial' AND COALESCE((r.crm_row->>'trial_left')::int, 99) <= 3)
               OR (r.crm_row->>'state' IN ('trial', 'paid') AND COALESCE((r.crm_row->>'health')::int, 100) < 40) THEN 'at_risk'
             WHEN NOT r.has_tickets AND r.crm_row->>'state' IN ('paused', 'churned') THEN 'paused'
             WHEN r.stripe_ready OR r.upcoming > 0 OR r.n_total > 0 OR COALESCE(r.crm_row->>'sync', 'none') <> 'none' THEN 'configured'
             WHEN r.last_sign_in_at IS NOT NULL THEN 'signed_up'
             ELSE 'invited'
           END AS status,
           NULLIF(GREATEST(
             COALESCE(r.last_sign_in_at, '-infinity'::timestamptz),
             COALESCE(r.last_sale_at, '-infinity'::timestamptz),
             COALESCE(r.last_event_created, '-infinity'::timestamptz),
             COALESCE((r.crm_row->>'last_send_at')::timestamptz, '-infinity'::timestamptz),
             COALESCE((r.crm_row->>'sync_at')::timestamptz, '-infinity'::timestamptz)
           ), '-infinity'::timestamptz) AS last_seen
      FROM rows r
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', l.k, 'type', l.type, 'ref', l.ref, 'name', l.name, 'city', l.city,
      'products', to_jsonb(array_remove(ARRAY[CASE WHEN l.has_tickets THEN 'tickets' END, CASE WHEN l.has_crm THEN 'crm' END], NULL)),
      'status', l.status, 'hidden', l.hidden, 'is_demo', l.is_demo,
      'owner_id', l.owner_id, 'owner_name', l.owner_name, 'owner_email', l.owner_email, 'owner_phone', l.owner_phone,
      'created_at', l.created_at, 'last_login', l.last_sign_in_at, 'last_seen', l.last_seen,
      'stripe_ready', l.stripe_ready,
      'sales_period', l.n_period, 'sales_prev', l.n_prev, 'sales_30d', l.n30, 'sales_total', l.n_total,
      'revenue_period', l.rev_period, 'revenue_prev', l.rev_prev, 'revenue_total', l.rev_total,
      'last_sale_at', l.last_sale_at,
      'upcoming', l.upcoming, 'events_total', l.events_total,
      'crm', CASE WHEN l.crm_row IS NULL THEN NULL ELSE jsonb_build_object(
          'state', l.crm_row->>'state', 'mrr', l.crm_row->'mrr', 'health', l.crm_row->'health',
          'balance', l.crm_row->'balance', 'trial_left', l.crm_row->'trial_left', 'sync', l.crm_row->>'sync',
          'paid', l.crm_row->'paid', 'granted', l.crm_row->'granted', 'frozen', COALESCE(l.crm_row->>'frozen_at', '') <> '') END,
      'support', l.grant_status,
      'note', left(l.pinned_note, 280), 'tags', to_jsonb(l.tags)
    ) ORDER BY l.last_seen DESC NULLS LAST, l.name), '[]'::jsonb)
    INTO v_out
    FROM lc l;

  RETURN jsonb_build_object('at', now(), 'days', v_days, 'from', v_from, 'prev_from', v_prev, 'accounts', v_out);
END;
$function$;

-- ── Clés d'un compte ────────────────────────────────────────────────────────
-- (type, référence, titulaire) d'une clé `venue:` | `org:` | `agency:`, NULL si inconnue.
CREATE OR REPLACE FUNCTION public._admin_account_parts(p_key text, OUT kind text, OUT ref text, OUT owner_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  kind := split_part(p_key, ':', 1);
  ref := substr(p_key, length(kind) + 2);
  IF kind = 'venue' THEN
    SELECT v.owner_id INTO owner_id FROM public.venues v WHERE v.id = ref;
    IF NOT FOUND THEN kind := NULL; END IF;
  ELSIF kind = 'org' THEN
    BEGIN
      SELECT o.user_id INTO owner_id FROM public.organizer_profiles o WHERE o.user_id = ref::uuid;
      IF NOT FOUND THEN kind := NULL; END IF;
    EXCEPTION WHEN invalid_text_representation THEN kind := NULL;
    END;
  ELSIF kind = 'agency' THEN
    BEGIN
      SELECT a.owner_user_id INTO owner_id FROM public.agencies a WHERE a.id = ref::uuid;
      IF NOT FOUND THEN kind := NULL; END IF;
    EXCEPTION WHEN invalid_text_representation THEN kind := NULL;
    END;
  ELSE
    kind := NULL;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._admin_account_parts(text) FROM PUBLIC, anon, authenticated;

-- ── admin_account : la fiche ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_account(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text; v_ref text; v_owner uuid;
  v_identity jsonb; v_legal jsonb := NULL; v_team jsonb := '[]'::jsonb; v_overview jsonb := NULL;
  v_crm jsonb := NULL; v_row jsonb; v_has_crm boolean := false;
  v_entity_ids text[];
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT x.kind, x.ref, x.owner_id INTO v_kind, v_ref, v_owner FROM public._admin_account_parts(p_key) x;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;

  -- La ligne de la liste (statut, ventes, CRM) : une seule définition.
  SELECT r INTO v_row FROM jsonb_array_elements(public.admin_accounts(true, 30)->'accounts') r WHERE r->>'key' = p_key LIMIT 1;
  v_has_crm := COALESCE(v_row->'products' ? 'crm', false);

  IF v_kind = 'venue' THEN
    v_overview := public.admin_venue_overview(v_ref);
    v_identity := (SELECT jsonb_build_object('name', vn.name, 'slug', vn.slug, 'city', vn.city, 'address', vn.address,
                     'logo_url', vn.logo_url, 'instagram_url', vn.instagram_url, 'whatsapp', vn.whatsapp_number,
                     'timezone', vn.timezone, 'created_at', vn.created_at, 'is_hidden', vn.is_hidden,
                     'decommissioned_at', vn.decommissioned_at, 'purge_at', vn.purge_at,
                     'product', vn.product, 'extra_products', to_jsonb(COALESCE(vn.extra_products, '{}'::text[])),
                     'public_url', CASE WHEN vn.slug IS NOT NULL THEN '/club/' || vn.slug END,
                     'stripe', jsonb_build_object('account', vn.stripe_account_id IS NOT NULL, 'onboarded', vn.stripe_onboarding_complete,
                        'charges', vn.stripe_charges_enabled, 'payouts', vn.stripe_payouts_enabled))
                     FROM public.venues vn WHERE vn.id = v_ref);
    v_legal := (SELECT jsonb_build_object('legal_name', vn.legal_name, 'siret', vn.siret, 'vat_number', vn.vat_number,
                  'legal_address', vn.legal_address) FROM public.venues vn WHERE vn.id = v_ref);
    v_team := COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
               'email', p.email, 'role', 'manager', 'mfa', COALESCE(p.mfa_enabled, false), 'since', mp.created_at) ORDER BY mp.created_at)
        FROM public.manager_permissions mp JOIN public.profiles p ON p.id = mp.user_id WHERE mp.venue_id = v_ref), '[]'::jsonb);
  ELSIF v_kind = 'org' THEN
    v_identity := (SELECT jsonb_build_object('name', COALESCE(NULLIF(o.display_name, ''), p.organization_name), 'slug', o.slug,
                     'city', o.city, 'logo_url', o.avatar_url, 'instagram_url', o.instagram_url, 'website_url', o.website_url,
                     'created_at', o.created_at, 'is_public', o.is_public, 'association', COALESCE(o.bde_verified, false),
                     'association_at', o.bde_verified_at, 'showcase', COALESCE(o.is_showcase_shadow, false),
                     'product', o.product, 'extra_products', to_jsonb(COALESCE(o.extra_products, '{}'::text[])),
                     'public_url', CASE WHEN o.slug IS NOT NULL THEN '/o/' || o.slug END,
                     'stripe', jsonb_build_object('account', p.stripe_connect_account_id IS NOT NULL,
                        'onboarded', p.stripe_connect_onboarded_at IS NOT NULL, 'status', p.stripe_connect_status,
                        'charges', p.stripe_connect_charges_enabled, 'payouts', p.stripe_connect_payouts_enabled))
                     FROM public.organizer_profiles o LEFT JOIN public.profiles p ON p.id = o.user_id WHERE o.user_id = v_ref::uuid);
    v_legal := (SELECT to_jsonb(l) FROM public.get_organizer_legal_identity(v_ref::uuid) l LIMIT 1);
    v_team := COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.member_user_id, 'name', NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
               'email', COALESCE(p.email, m.member_email), 'role', m.role, 'status', m.invitation_status,
               'mfa', COALESCE(p.mfa_enabled, false), 'since', COALESCE(m.accepted_at, m.created_at)) ORDER BY m.created_at)
        FROM public.org_members m LEFT JOIN public.profiles p ON p.id = m.member_user_id
       WHERE m.organizer_user_id = v_ref::uuid AND m.invitation_status IN ('accepted', 'pending')), '[]'::jsonb);
  ELSE
    v_identity := (SELECT jsonb_build_object('name', a.name, 'slug', a.slug, 'city', a.city, 'logo_url', a.logo_url,
                     'instagram_url', a.instagram_url, 'website_url', a.website_url, 'contact_email', a.contact_email,
                     'created_at', a.created_at, 'is_active', a.is_active,
                     'public_url', CASE WHEN a.slug IS NOT NULL THEN '/p/' || a.slug END,
                     'promoters', (SELECT count(*) FROM public.promoters pr WHERE pr.agency_id = a.id),
                     'stripe', jsonb_build_object('account', p.stripe_connect_account_id IS NOT NULL,
                        'charges', p.stripe_connect_charges_enabled, 'payouts', p.stripe_connect_payouts_enabled))
                     FROM public.agencies a LEFT JOIN public.profiles p ON p.id = a.owner_user_id WHERE a.id = v_ref::uuid);
  END IF;

  IF v_has_crm THEN
    BEGIN
      v_crm := public.crm_admin_account(p_key);
    EXCEPTION WHEN others THEN
      v_crm := jsonb_build_object('error', SQLSTATE);
    END;
  END IF;

  v_entity_ids := ARRAY[p_key, v_ref];

  RETURN jsonb_build_object(
    'key', p_key, 'kind', v_kind, 'ref', v_ref,
    'row', v_row,
    'identity', v_identity,
    'legal', v_legal,
    'owner', (SELECT jsonb_build_object('id', p.id, 'email', p.email, 'name', NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
                'phone', p.phone, 'mfa', COALESCE(p.mfa_enabled, false), 'suspended', COALESCE(p.is_suspended, false),
                'created_at', p.created_at, 'last_login', u.last_sign_in_at)
                FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id WHERE p.id = v_owner),
    'team', v_team,
    'venue_overview', CASE WHEN v_overview IS NULL THEN NULL ELSE v_overview - 'venue' - 'owner' END,
    'products_history', COALESCE((SELECT jsonb_agg(jsonb_build_object('product', e.product, 'action', e.action, 'via', e.via,
                            'email', e.email, 'at', e.created_at) ORDER BY e.created_at DESC)
                          FROM public.account_product_events e WHERE e.scope_key = p_key), '[]'::jsonb),
    -- Ventes par pilier et par mois (12 mois), formule de admin_venue_overview.
    'monthly', (
      WITH sc AS (
        SELECT e.id FROM public.events e
         WHERE e.external_source IS NULL AND (
               (v_kind = 'venue' AND (e.venue_id = v_ref OR e.partner_venue_id = v_ref))
            OR (v_kind = 'org' AND (e.organizer_user_id = v_ref::uuid OR e.partner_organizer_id = v_ref::uuid)))
      ), m AS (
        SELECT generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS mo
      ), t AS (
        SELECT date_trunc('month', COALESCE(t.paid_at, t.created_at)) AS mo, sum(t.quantity) AS n,
               sum(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0)) AS rev
          FROM public.tickets t WHERE t.event_id IN (SELECT id FROM sc) AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')
         GROUP BY 1
      ), tb AS (
        SELECT date_trunc('month', COALESCE(tr.paid_at, tr.created_at)) AS mo, count(*) AS n,
               sum(tr.total_price - COALESCE(tr.service_fee, 0) - CASE WHEN COALESCE(tr.fee_absorbed, false) THEN COALESCE(tr.management_fee, 0) ELSE 0 END) AS rev
          FROM public.table_reservations tr WHERE tr.event_id IN (SELECT id FROM sc) AND tr.status IN ('paid', 'confirmed')
         GROUP BY 1
      ), gl AS (
        SELECT date_trunc('month', ge.created_at) AS mo, count(*) AS n
          FROM public.guest_list_entries ge JOIN public.guest_lists g ON g.id = ge.guest_list_id
         WHERE g.event_id IN (SELECT id FROM sc) AND ge.status IS DISTINCT FROM 'cancelled'
         GROUP BY 1
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object('month', to_char(m.mo, 'YYYY-MM'),
               'tickets', COALESCE(t.n, 0), 'tickets_rev', round(COALESCE(t.rev, 0), 2),
               'tables', COALESCE(tb.n, 0), 'tables_rev', round(COALESCE(tb.rev, 0), 2),
               'guestlist', COALESCE(gl.n, 0)) ORDER BY m.mo), '[]'::jsonb)
        FROM m LEFT JOIN t ON t.mo = m.mo LEFT JOIN tb ON tb.mo = m.mo LEFT JOIN gl ON gl.mo = m.mo
       WHERE v_kind <> 'agency'),
    'events', (
      SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'start_at') DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
                 'is_active', e.is_active, 'cancelled', e.cancelled_at IS NOT NULL, 'slug', e.slug,
                 'role', CASE WHEN (v_kind = 'venue' AND e.venue_id = v_ref) OR (v_kind = 'org' AND e.organizer_user_id = v_ref::uuid) THEN 'lead' ELSE 'partner' END,
                 'tickets', (SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t WHERE t.event_id = e.id AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')),
                 'tables', (SELECT count(*) FROM public.table_reservations tr WHERE tr.event_id = e.id AND tr.status IN ('paid', 'confirmed')),
                 'guestlist', (SELECT count(*) FROM public.guest_list_entries ge JOIN public.guest_lists g ON g.id = ge.guest_list_id
                                WHERE g.event_id = e.id AND ge.status IS DISTINCT FROM 'cancelled'),
                 'revenue', (SELECT round(COALESCE(sum(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0)), 0), 2)
                               FROM public.tickets t WHERE t.event_id = e.id AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used'))
                          + (SELECT round(COALESCE(sum(tr.total_price - COALESCE(tr.service_fee, 0) - CASE WHEN COALESCE(tr.fee_absorbed, false) THEN COALESCE(tr.management_fee, 0) ELSE 0 END), 0), 2)
                               FROM public.table_reservations tr WHERE tr.event_id = e.id AND tr.status IN ('paid', 'confirmed'))) AS x
          FROM public.events e
         WHERE e.external_source IS NULL AND (
               (v_kind = 'venue' AND (e.venue_id = v_ref OR e.partner_venue_id = v_ref))
            OR (v_kind = 'org' AND (e.organizer_user_id = v_ref::uuid OR e.partner_organizer_id = v_ref::uuid)))
         ORDER BY e.start_at DESC LIMIT 30) q),
    'collabs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'start_at', e.start_at, 'status', c.status,
               'with', CASE WHEN v_kind = 'venue' THEN (SELECT o.display_name FROM public.organizer_profiles o WHERE o.user_id = c.organizer_user_id)
                            ELSE (SELECT vn.name FROM public.venues vn WHERE vn.id = c.venue_id) END) ORDER BY e.start_at)
        FROM public.event_collab_contracts c JOIN public.events e ON e.id = c.event_id
       WHERE c.status IN ('pending_signatures', 'active', 'locked') AND e.start_at >= now() - interval '2 days'
         AND ((v_kind = 'venue' AND c.venue_id = v_ref) OR (v_kind = 'org' AND c.organizer_user_id = v_ref::uuid))), '[]'::jsonb),
    'cohosts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'start_at', e.start_at, 'role', ch.role, 'access', ch.access) ORDER BY e.start_at)
        FROM public.event_cohosts ch JOIN public.events e ON e.id = ch.event_id
       WHERE ch.status = 'accepted' AND e.start_at >= now() - interval '2 days'
         AND ((v_kind = 'venue' AND ch.venue_id = v_ref) OR (v_kind = 'org' AND ch.organizer_user_id = v_ref::uuid))), '[]'::jsonb),
    'crm', v_crm,
    'sending', (SELECT jsonb_build_object('level', h.level, 'level_since', h.level_since, 'reason', h.reason,
                  'cold_frozen_until', h.cold_frozen_until, 'burst_allowed', h.burst_allowed, 'smart_off', h.smart_off,
                  'incidents', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', i.at, 'kind', i.kind, 'detail', i.detail) ORDER BY i.at DESC)
                                FROM (SELECT * FROM public.email_sender_incidents WHERE scope_key = p_key ORDER BY at DESC LIMIT 10) i), '[]'::jsonb))
                  FROM public.email_sender_health h WHERE h.scope_key = p_key),
    'feedback', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'category', f.category, 'status', f.status,
               'priority', f.priority, 'at', f.created_at) ORDER BY f.created_at DESC)
        FROM (SELECT * FROM public.feedback_issues fi
               WHERE (v_kind = 'venue' AND fi.venue_id = v_ref) OR (v_owner IS NOT NULL AND fi.reported_by = v_owner)
               ORDER BY fi.created_at DESC LIMIT 20) f), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'status', r.status, 'at', r.created_at) ORDER BY r.created_at DESC)
        FROM (SELECT * FROM public.crm_feature_requests WHERE scope_key = p_key ORDER BY created_at DESC LIMIT 20) r), '[]'::jsonb),
    'nps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('score', n.score, 'comment', n.comment, 'at', n.created_at) ORDER BY n.created_at DESC)
        FROM (SELECT * FROM public.crm_nps_responses WHERE scope_key = p_key ORDER BY created_at DESC LIMIT 10) n), '[]'::jsonb),
    'legal_acceptances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('doc', a.doc_type, 'version', a.doc_version, 'context', a.context, 'at', a.accepted_at) ORDER BY a.accepted_at DESC)
        FROM (SELECT * FROM public.legal_acceptances la WHERE v_owner IS NOT NULL AND la.user_id = v_owner ORDER BY la.accepted_at DESC LIMIT 30) a), '[]'::jsonb),
    'support', jsonb_build_object(
      'grants', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', g.id, 'status', g.status, 'reason', g.reason, 'initiated_by', g.initiated_by,
                 'created_at', g.created_at, 'approved_at', g.approved_at, 'revoked_at', g.revoked_at, 'expires_at', g.expires_at) ORDER BY g.created_at DESC)
          FROM (SELECT * FROM public.admin_support_grants x WHERE v_owner IS NOT NULL AND x.target_user_id = v_owner ORDER BY x.created_at DESC LIMIT 10) g), '[]'::jsonb),
      'sessions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'via', s.opened_via, 'created_at', s.created_at,
                 'ended_at', s.ended_at, 'expires_at', s.expires_at,
                 'admin', (SELECT COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) FROM public.profiles p WHERE p.id = s.admin_id)) ORDER BY s.created_at DESC)
          FROM (SELECT * FROM public.admin_support_sessions x WHERE v_owner IS NOT NULL AND x.target_user_id = v_owner ORDER BY x.created_at DESC LIMIT 10) s), '[]'::jsonb)),
    'audit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'entity_type', a.entity_type, 'meta', a.metadata,
               'admin', (SELECT COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) FROM public.profiles p WHERE p.id = a.admin_id)) ORDER BY a.created_at DESC)
        FROM (SELECT * FROM public.admin_audit_log x
               WHERE x.entity_id = ANY(v_entity_ids) OR (v_owner IS NOT NULL AND x.entity_id = v_owner::text)
               ORDER BY x.created_at DESC LIMIT 50) a), '[]'::jsonb),
    'notes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'pinned', n.pinned, 'at', n.created_at, 'updated_at', n.updated_at,
               'author', (SELECT COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) FROM public.profiles p WHERE p.id = n.author_id))
               ORDER BY n.pinned DESC, n.created_at DESC)
        FROM public.admin_account_notes n WHERE n.account_key = p_key), '[]'::jsonb),
    'crm_note', (SELECT NULLIF(body, '') FROM public.crm_admin_notes WHERE scope_key = p_key),
    'tags', COALESCE((SELECT to_jsonb(t.tags) FROM public.admin_account_tags t WHERE t.account_key = p_key), '[]'::jsonb));
END;
$function$;

-- ── Notes, étiquettes ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_account_note_add(p_key text, p_body text, p_pinned boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF (SELECT kind FROM public._admin_account_parts(p_key)) IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(btrim(p_body), '') = '' THEN RAISE EXCEPTION 'empty_note' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.admin_account_notes (account_key, body, pinned, author_id)
  VALUES (p_key, left(btrim(p_body), 4000), COALESCE(p_pinned, false), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_account_note_update(p_id uuid, p_pinned boolean DEFAULT NULL, p_body text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.admin_account_notes
     SET pinned = COALESCE(p_pinned, pinned),
         body = CASE WHEN COALESCE(btrim(p_body), '') = '' THEN body ELSE left(btrim(p_body), 4000) END,
         updated_at = now()
   WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_account_note_delete(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.admin_account_notes WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_account_set_tags(p_key text, p_tags text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tags text[];
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF (SELECT kind FROM public._admin_account_parts(p_key)) IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), '{}') INTO v_tags
    FROM (SELECT left(lower(btrim(x)), 40) AS t FROM unnest(COALESCE(p_tags, '{}'::text[])) x) q
   WHERE t <> '';
  v_tags := v_tags[1:20];
  INSERT INTO public.admin_account_tags (account_key, tags, updated_by, updated_at)
  VALUES (p_key, v_tags, auth.uid(), now())
  ON CONFLICT (account_key) DO UPDATE SET tags = EXCLUDED.tags, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN v_tags;
END;
$function$;

-- ── Gestes de la fiche qui n'avaient ni motif ni journal ───────────────────
-- Visibilité d'un club (is_hidden) et activité d'une agence (is_active) : avant,
-- un UPDATE direct depuis la page, sans trace. Désormais motif + journal.
CREATE OR REPLACE FUNCTION public.admin_account_set_flag(p_key text, p_flag text, p_value boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_kind text; v_ref text;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 4 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  SELECT x.kind, x.ref INTO v_kind, v_ref FROM public._admin_account_parts(p_key) x;
  IF v_kind = 'venue' AND p_flag = 'hidden' THEN
    UPDATE public.venues SET is_hidden = p_value WHERE id = v_ref;
  ELSIF v_kind = 'agency' AND p_flag = 'active' THEN
    UPDATE public.agencies SET is_active = p_value, updated_at = now() WHERE id = v_ref::uuid;
  ELSE
    RAISE EXCEPTION 'unsupported' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'pro_account_' || p_flag, 'pro_account', p_key, jsonb_build_object('value', p_value, 'reason', btrim(p_reason)));
END;
$function$;

-- Journal d'un geste fait par une RPC existante sans motif (décommission,
-- restauration) : le motif saisi dans la fenêtre entre au journal du compte.
CREATE OR REPLACE FUNCTION public.admin_account_log(p_key text, p_action text, p_reason text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 4 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF p_action !~ '^[a-z_]{3,60}$' THEN RAISE EXCEPTION 'bad_action' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'pro_account_' || p_action, 'pro_account', p_key,
          COALESCE(p_meta, '{}'::jsonb) || jsonb_build_object('reason', btrim(p_reason)));
END;
$function$;

-- ── Prospects : leads de la page Links + pipeline CRM ──────────────────────
-- Les inscriptions (pro_signups) restent lues par admin_pro_signups, qui
-- regroupe les parcours par personne ; l'écran réunit les trois.
CREATE OR REPLACE FUNCTION public.admin_prospects(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'links', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'at', l.created_at, 'name', l.name, 'org_name', l.org_name,
               'org_type', l.org_type, 'city', l.city, 'phone', l.phone, 'email', l.email, 'message', l.message,
               'lang', l.lang, 'contacted_at', l.contacted_at, 'notes', l.notes) ORDER BY l.created_at DESC)
        FROM (SELECT * FROM public.links_pro_leads x
               WHERE p_include_demo OR NOT public.is_demo_email(x.email)
               ORDER BY x.created_at DESC LIMIT 300) l), '[]'::jsonb),
    'crm', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'at', p.created_at, 'name', p.name, 'contact', p.contact,
               'phone', p.phone, 'email', p.email, 'city', p.city, 'kind', p.kind, 'source', p.source, 'stage', p.stage,
               'next_action', p.next_action, 'next_at', p.next_at, 'note', p.note, 'opposed', p.opposed,
               'stage_changed_at', p.stage_changed_at) ORDER BY p.updated_at DESC)
        FROM public.crm_prospects p), '[]'::jsonb));
END;
$function$;

-- « Contacté » : un seul geste, qui écrit dans la bonne table.
CREATE OR REPLACE FUNCTION public.admin_prospect_contacted(p_source text, p_ids text[], p_contacted boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_source = 'links' THEN
    UPDATE public.links_pro_leads SET contacted_at = CASE WHEN p_contacted THEN COALESCE(contacted_at, now()) END
     WHERE id::text = ANY(p_ids);
  ELSIF p_source = 'signup' THEN
    UPDATE public.pro_signups SET contacted_at = CASE WHEN p_contacted THEN COALESCE(contacted_at, now()) END, updated_at = now()
     WHERE id::text = ANY(p_ids);
  ELSIF p_source = 'crm' THEN
    -- Le pipeline garde son historique d'étapes (crm_admin_prospect_save).
    PERFORM public.crm_admin_prospect_save(x::uuid, jsonb_build_object('stage', CASE WHEN p_contacted THEN 'contacted' ELSE 'prospect' END))
       FROM unnest(p_ids) x;
  ELSE
    RAISE EXCEPTION 'unsupported' USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- ── Accès assisté, tous produits ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_support_overview(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_acc jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_acc := public.admin_accounts(p_include_demo, 30)->'accounts';
  RETURN (
    WITH acc AS MATERIALIZED (
      SELECT r->>'key' AS key, r->>'name' AS name, r->>'type' AS type, r->'products' AS products,
             NULLIF(r->>'owner_id', '')::uuid AS owner_id, r->>'owner_name' AS owner_name, r->>'owner_email' AS owner_email
        FROM jsonb_array_elements(COALESCE(v_acc, '[]'::jsonb)) r WHERE r->>'owner_id' IS NOT NULL
    ), own AS MATERIALIZED (
      -- Un titulaire peut avoir plusieurs comptes : on garde le premier pour le nommer.
      SELECT DISTINCT ON (owner_id) * FROM acc ORDER BY owner_id, key
    )
    SELECT jsonb_build_object(
      'at', now(),
      'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', a.key, 'name', a.name, 'type', a.type,
                     'products', a.products, 'owner_id', a.owner_id, 'owner_name', a.owner_name, 'owner_email', a.owner_email) ORDER BY a.name)
                     FROM acc a), '[]'::jsonb),
      'grants', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'status', g.status, 'reason', g.reason,
                     'initiated_by', g.initiated_by, 'created_at', g.created_at, 'approved_at', g.approved_at,
                     'revoked_at', g.revoked_at, 'expires_at', g.expires_at,
                     'owner_id', g.target_user_id, 'key', o.key, 'name', o.name, 'type', o.type, 'products', o.products,
                     'live_until', (SELECT max(s.expires_at) FROM public.admin_support_sessions s
                                     WHERE s.grant_id = g.id AND s.status = 'active' AND s.expires_at > now()),
                     'sessions', (SELECT count(*) FROM public.admin_support_sessions s WHERE s.grant_id = g.id),
                     'last_session_at', (SELECT max(s.created_at) FROM public.admin_support_sessions s WHERE s.grant_id = g.id))
                     ORDER BY g.created_at DESC)
                     FROM (SELECT * FROM public.admin_support_grants x
                            WHERE x.target_user_id IN (SELECT owner_id FROM own)
                            ORDER BY x.created_at DESC LIMIT 200) g
                     JOIN own o ON o.owner_id = g.target_user_id), '[]'::jsonb),
      'log', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', l.created_at, 'action', l.action, 'table', l.table_name,
                     'key', o.key, 'name', o.name, 'by_admin', l.actor_id IS DISTINCT FROM l.target_user_id) ORDER BY l.created_at DESC)
                     FROM (SELECT * FROM public.admin_support_audit x
                            WHERE x.target_user_id IN (SELECT owner_id FROM own)
                            ORDER BY x.created_at DESC LIMIT 80) l
                     JOIN own o ON o.owner_id = l.target_user_id), '[]'::jsonb)));
END;
$function$;

-- ── Invitations en cours, toutes portes ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_pending_invitations()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'created_at') DESC) FROM (
    SELECT jsonb_build_object('id', i.id, 'source', 'owner', 'type', 'club', 'product', 'tickets', 'email', i.email,
             'name', v.name, 'account_key', 'venue:' || i.venue_id, 'created_at', i.created_at, 'expires_at', i.expires_at,
             'state', CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.expires_at < now() THEN 'expired' ELSE 'pending' END) AS x
      FROM public.owner_invitations i LEFT JOIN public.venues v ON v.id = i.venue_id
     WHERE i.created_at > now() - interval '120 days'
    UNION ALL
    SELECT jsonb_build_object('id', i.id, 'source', 'platform', 'type', CASE WHEN i.profile_type = 'affiliate' THEN 'agency' ELSE 'organizer' END,
             'product', 'tickets', 'email', i.email, 'name', i.organization_name, 'account_key', NULL,
             'created_at', i.created_at, 'expires_at', i.expires_at,
             'state', CASE WHEN i.status = 'accepted' OR i.accepted_at IS NOT NULL THEN 'accepted'
                           WHEN i.status = 'revoked' THEN 'revoked' WHEN i.expires_at < now() THEN 'expired' ELSE 'pending' END)
      FROM public.platform_invitations i
     WHERE i.created_at > now() - interval '120 days'
    UNION ALL
    SELECT jsonb_build_object('id', i.id, 'source', 'crm', 'type', COALESCE(i.kind, 'organizer'),
             'product', CASE WHEN i.offer = 'founder' THEN 'founder' ELSE 'crm' END,
             'email', i.email, 'name', i.org_name, 'account_key', i.scope_key, 'created_at', i.created_at, 'expires_at', i.expires_at,
             'state', CASE WHEN i.claimed_at IS NOT NULL THEN 'accepted' WHEN i.revoked_at IS NOT NULL THEN 'revoked'
                           WHEN i.expires_at < now() THEN 'expired' ELSE 'pending' END)
      FROM public.crm_offer_invites i
     WHERE i.created_at > now() - interval '120 days'
    UNION ALL
    SELECT jsonb_build_object('id', i.id, 'source', 'product', 'type', CASE WHEN i.venue_id IS NOT NULL THEN 'club' ELSE 'organizer' END,
             'product', CASE WHEN i.product = 'crm' THEN 'crm' ELSE 'tickets' END, 'email', i.email, 'name', NULL,
             'account_key', i.scope_key, 'created_at', i.created_at, 'expires_at', i.expires_at,
             'state', CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.canceled_at IS NOT NULL THEN 'revoked'
                           WHEN i.expires_at < now() THEN 'expired' ELSE 'pending' END)
      FROM public.account_product_invites i
     WHERE i.created_at > now() - interval '120 days'
  ) q), '[]'::jsonb);
END;
$function$;

-- ── Droits ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_accounts(boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_note_add(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_note_update(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_note_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_set_tags(text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_set_flag(text, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_log(text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_prospects(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_prospect_contacted(text, text[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_support_overview(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_pending_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_accounts(boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_note_add(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_note_update(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_note_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_set_tags(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_set_flag(text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_log(text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prospects(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prospect_contacted(text, text[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_support_overview(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pending_invitations() TO authenticated;
