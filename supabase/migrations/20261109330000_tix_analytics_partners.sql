-- Yuno Tickets › Analyses › Partenaires, lot 3 du plan combiné
-- (docs/designs/TICKETS_ANALYTICS_COMBINED_PLAN.md) : « Qui vend pour moi ? ».
--
--   1. Les promoteurs de la portée : ventes attribuées (conversions non
--      annulées, valeur faciale hors frais Yuno, jamais « CA »), commissions,
--      clics, clic → vente (règle unique de promoterConversionRate : ventes
--      PAYANTES billets + tables / clics, plafonné à 100 %), rendement (ventes
--      attribuées par euro de commission), classement et écart à la période
--      précédente. Mêmes cases que les autres onglets (_tix_ana_setup,
--      _tix_bucket) : période, ou J-21 → J d'une soirée choisie.
--   2. Les liens de la portée sur ses soirées qui portent un partenaire : liens
--      partenaires (une personne, page /stats/), liens d'un invité (espace
--      invité) et liens de partie d'une co-soirée. Ventes de la période lues
--      sur la vente (tracked_link_id), CA club de _tix_sales.
--   3. Les soirées PARTAGÉES (club partenaire, organisateur partenaire,
--      co-hôtes acceptés, invités) de la période : l'écran ouvre leur « Qui
--      fait vendre ? » (get_collab_party_breakdown, déjà gardée).
--
-- Montants : `revenue`, `prev_revenue`, `amount` (commission) : l'enveloppe de
-- l'argent les efface pour qui ne voit pas l'argent ; le rendement aussi.

CREATE OR REPLACE FUNCTION public.tix_ana_partners__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_money boolean;
  v_ev uuid;
  v_series jsonb; v_tot jsonb; v_promoters jsonb; v_links jsonb; v_shared jsonb;
  v_has_promoters boolean;
BEGIN
  IF NOT public._tix_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._tix_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;
  v_money := COALESCE((m->>'money')::boolean, false);
  v_ev := (m->'event'->>'id')::uuid;

  -- Les promoteurs de la portée.
  DROP TABLE IF EXISTS _apr;
  CREATE TEMP TABLE _apr ON COMMIT DROP AS
  SELECT pr.id, NULLIF(btrim(concat_ws(' ', NULLIF(btrim(pr.first_name), ''), NULLIF(btrim(pr.last_name), ''))), '') AS name,
         NULLIF(btrim(pr.promo_code), '') AS code, pr.profile_image_url AS avatar, COALESCE(pr.is_active, true) AS active
    FROM public.promoters pr
   WHERE (p_venue_id IS NOT NULL AND pr.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND pr.organizer_user_id = p_organizer_user_id);
  v_has_promoters := EXISTS (SELECT 1 FROM _apr);

  -- Leurs ventes attribuées : soirées de la portée (ou sans soirée, hors vue d'une soirée).
  DROP TABLE IF EXISTS _acv;
  CREATE TEMP TABLE _acv ON COMMIT DROP AS
  SELECT c.promoter_id, c.conversion_type AS kind,
         CASE WHEN c.conversion_type = 'ticket'
              THEN GREATEST(COALESCE((SELECT t.quantity FROM public.tickets t WHERE t.id = c.ticket_id), 1), 1) ELSE 0 END AS qty,
         COALESCE(c.amount, 0) AS amount, COALESCE(c.commission, 0) AS commission,
         -- Ventes PAYANTES (billets + tables) : numérateur du clic → vente.
         (c.conversion_type IN ('ticket', 'table') AND COALESCE(c.amount, 0) > 0 AND c.parent_conversion_id IS NULL) AS paid,
         public._tix_bucket(c.created_at, c.event_id, m, false) AS ci,
         public._tix_bucket(c.created_at, c.event_id, m, true) AS pi
    FROM public.promoter_conversions c
    JOIN _apr p ON p.id = c.promoter_id
   WHERE COALESCE(c.status, '') <> 'cancelled'
     AND c.parent_conversion_id IS NULL
     AND (c.event_id IN (SELECT id FROM _aev) OR (c.event_id IS NULL AND v_ev IS NULL));
  DELETE FROM _acv WHERE ci IS NULL AND pi IS NULL;

  -- Leurs clics.
  DROP TABLE IF EXISTS _acl;
  CREATE TEMP TABLE _acl ON COMMIT DROP AS
  SELECT k.promoter_id,
         public._tix_bucket(k.clicked_at, k.event_id, m, false) AS ci,
         public._tix_bucket(k.clicked_at, k.event_id, m, true) AS pi
    FROM public.promoter_clicks k
    JOIN _apr p ON p.id = k.promoter_id
   WHERE k.event_id IN (SELECT id FROM _aev) OR (k.event_id IS NULL AND v_ev IS NULL);
  DELETE FROM _acl WHERE ci IS NULL AND pi IS NULL;

  WITH cur AS (SELECT ci AS g, count(*) AS n, sum(amount) AS a, sum(commission) AS c FROM _acv WHERE ci IS NOT NULL GROUP BY 1),
       prv AS (SELECT pi AS g, count(*) AS n, sum(amount) AS a FROM _acv WHERE pi IS NOT NULL GROUP BY 1),
       clk AS (SELECT ci AS g, count(*) AS n FROM _acl WHERE ci IS NOT NULL GROUP BY 1),
       pclk AS (SELECT pi AS g, count(*) AS n FROM _acl WHERE pi IS NOT NULL GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object(
           'sales', COALESCE(c.n, 0), 'revenue', COALESCE(round(c.a, 2), 0),
           'commission', jsonb_build_object('amount', COALESCE(round(c.c, 2), 0)),
           'clicks', COALESCE(k.n, 0),
           'prev_sales', COALESCE(p.n, 0), 'prev_revenue', COALESCE(round(p.a, 2), 0), 'prev_clicks', COALESCE(pk.n, 0)) ORDER BY g.g)
    INTO v_series
    FROM generate_series(0, v_n - 1) g(g)
    LEFT JOIN cur c ON c.g = g.g LEFT JOIN prv p ON p.g = g.g
    LEFT JOIN clk k ON k.g = g.g LEFT JOIN pclk pk ON pk.g = g.g;

  WITH s AS (
    SELECT count(*) FILTER (WHERE ci IS NOT NULL) AS sales,
           count(*) FILTER (WHERE pi IS NOT NULL) AS prev_sales,
           COALESCE(sum(qty) FILTER (WHERE ci IS NOT NULL AND kind = 'ticket'), 0) AS tickets,
           count(*) FILTER (WHERE ci IS NOT NULL AND kind = 'table') AS tables,
           count(*) FILTER (WHERE ci IS NOT NULL AND kind NOT IN ('ticket', 'table')) AS guests,
           COALESCE(sum(amount) FILTER (WHERE ci IS NOT NULL), 0) AS revenue,
           COALESCE(sum(amount) FILTER (WHERE pi IS NOT NULL), 0) AS prev_revenue,
           COALESCE(sum(commission) FILTER (WHERE ci IS NOT NULL), 0) AS commission,
           COALESCE(sum(commission) FILTER (WHERE pi IS NOT NULL), 0) AS prev_commission,
           count(*) FILTER (WHERE ci IS NOT NULL AND paid) AS paid,
           count(*) FILTER (WHERE pi IS NOT NULL AND paid) AS prev_paid,
           count(DISTINCT promoter_id) FILTER (WHERE ci IS NOT NULL) AS sellers
      FROM _acv
  ), k AS (
    SELECT count(*) FILTER (WHERE ci IS NOT NULL) AS clicks, count(*) FILTER (WHERE pi IS NOT NULL) AS prev_clicks FROM _acl
  )
  SELECT jsonb_build_object(
           'sales', s.sales, 'prev_sales', s.prev_sales,
           'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests, 'sellers', s.sellers,
           'promoters', (SELECT count(*) FROM _apr WHERE active),
           'revenue', round(s.revenue, 2), 'prev_revenue', round(s.prev_revenue, 2),
           'commission', jsonb_build_object('amount', round(s.commission, 2), 'prev', jsonb_build_object('amount', round(s.prev_commission, 2))),
           'clicks', k.clicks, 'prev_clicks', k.prev_clicks,
           'paid', s.paid, 'prev_paid', s.prev_paid,
           'rate', CASE WHEN k.clicks > 0 THEN LEAST(100, round(s.paid * 100.0 / k.clicks, 1)) END,
           'prev_rate', CASE WHEN k.prev_clicks > 0 THEN LEAST(100, round(s.prev_paid * 100.0 / k.prev_clicks, 1)) END,
           -- Ventes attribuées par euro de commission.
           'yield', jsonb_build_object('revenue', CASE WHEN s.commission > 0 THEN round(s.revenue / s.commission, 2) END,
                                       'prev_revenue', CASE WHEN s.prev_commission > 0 THEN round(s.prev_revenue / s.prev_commission, 2) END))
    INTO v_tot FROM s, k;

  WITH cv AS (
    SELECT promoter_id,
           count(*) FILTER (WHERE ci IS NOT NULL) AS sales,
           count(*) FILTER (WHERE pi IS NOT NULL) AS prev_sales,
           COALESCE(sum(qty) FILTER (WHERE ci IS NOT NULL AND kind = 'ticket'), 0) AS tickets,
           count(*) FILTER (WHERE ci IS NOT NULL AND kind = 'table') AS tables,
           count(*) FILTER (WHERE ci IS NOT NULL AND kind NOT IN ('ticket', 'table')) AS guests,
           COALESCE(sum(amount) FILTER (WHERE ci IS NOT NULL), 0) AS revenue,
           COALESCE(sum(amount) FILTER (WHERE pi IS NOT NULL), 0) AS prev_revenue,
           COALESCE(sum(commission) FILTER (WHERE ci IS NOT NULL), 0) AS commission,
           count(*) FILTER (WHERE ci IS NOT NULL AND paid) AS paid
      FROM _acv GROUP BY 1
  ), ck AS (
    SELECT promoter_id, count(*) FILTER (WHERE ci IS NOT NULL) AS clicks FROM _acl GROUP BY 1
  ), rows AS (
    SELECT p.id, p.name, p.code, p.avatar, p.active,
           COALESCE(cv.sales, 0) AS sales, COALESCE(cv.prev_sales, 0) AS prev_sales,
           COALESCE(cv.tickets, 0) AS tickets, COALESCE(cv.tables, 0) AS tables, COALESCE(cv.guests, 0) AS guests,
           COALESCE(cv.revenue, 0) AS revenue, COALESCE(cv.prev_revenue, 0) AS prev_revenue,
           COALESCE(cv.commission, 0) AS commission, COALESCE(cv.paid, 0) AS paid, COALESCE(ck.clicks, 0) AS clicks
      FROM _apr p LEFT JOIN cv ON cv.promoter_id = p.id LEFT JOIN ck ON ck.promoter_id = p.id
     WHERE COALESCE(cv.sales, 0) > 0 OR COALESCE(cv.prev_sales, 0) > 0 OR COALESCE(ck.clicks, 0) > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'code', r.code, 'avatar_url', r.avatar, 'active', r.active,
           'sales', r.sales, 'prev_sales', r.prev_sales, 'tickets', r.tickets, 'tables', r.tables, 'guests', r.guests,
           'revenue', round(r.revenue, 2), 'prev_revenue', round(r.prev_revenue, 2),
           'commission', jsonb_build_object('amount', round(r.commission, 2)),
           'clicks', r.clicks,
           'rate', CASE WHEN r.clicks > 0 THEN LEAST(100, round(r.paid * 100.0 / r.clicks, 1)) END,
           'yield', jsonb_build_object('revenue', CASE WHEN r.commission > 0 THEN round(r.revenue / r.commission, 2) END))
         ORDER BY CASE WHEN v_money THEN r.revenue ELSE r.sales END DESC, r.sales DESC, r.clicks DESC, r.name), '[]'::jsonb)
    INTO v_promoters FROM rows r;

  -- Les liens de la portée qui portent un partenaire, sur ses soirées.
  DROP TABLE IF EXISTS _alk;
  CREATE TEMP TABLE _alk ON COMMIT DROP AS
  SELECT tl.id, tl.event_id, tl.created_at,
         CASE WHEN tl.partner_name IS NOT NULL THEN 'partner'
              WHEN tl.guest_pass_id IS NOT NULL THEN 'guest'
              ELSE 'party' END AS kind,
         COALESCE(NULLIF(btrim(tl.partner_name), ''),
                  (SELECT NULLIF(btrim(h.guest_name), '') FROM public.event_guest_passes h WHERE h.id = tl.guest_pass_id)) AS name,
         NULLIF(btrim(tl.partner_role), '') AS role, tl.code, tl.archived_at IS NOT NULL AS archived
    FROM public.tracked_links tl
   WHERE tl.event_id IN (SELECT id FROM _aev)
     AND (v_ev IS NULL OR tl.event_id = v_ev)
     AND ((p_venue_id IS NOT NULL AND tl.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND tl.organizer_user_id = p_organizer_user_id))
     AND (tl.partner_name IS NOT NULL OR tl.guest_pass_id IS NOT NULL OR tl.utm_medium = 'party_link');

  WITH sl AS (
    SELECT x.link_id, a.ci, a.pi, a.qty, a.amount, a.pillar, a.ok
      FROM (
        SELECT t.id, t.tracked_link_id AS link_id FROM public.tickets t WHERE t.tracked_link_id IN (SELECT id FROM _alk)
        UNION ALL
        SELECT r.id, r.tracked_link_id FROM public.table_reservations r WHERE r.tracked_link_id IN (SELECT id FROM _alk)
        UNION ALL
        SELECT g.id, g.tracked_link_id FROM public.guest_list_entries g WHERE g.tracked_link_id IN (SELECT id FROM _alk)
      ) x
      JOIN _atk_all a ON a.id = x.id
     WHERE a.ok
  ), agg AS (
    SELECT link_id,
           COALESCE(sum(qty) FILTER (WHERE ci IS NOT NULL AND pillar = 'tickets'), 0) AS tickets,
           count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'tables') AS tables,
           count(*) FILTER (WHERE ci IS NOT NULL AND pillar = 'guestlist') AS guests,
           count(*) FILTER (WHERE ci IS NOT NULL) AS sales,
           count(*) FILTER (WHERE pi IS NOT NULL) AS prev_sales,
           COALESCE(sum(amount) FILTER (WHERE ci IS NOT NULL), 0) AS revenue
      FROM sl GROUP BY 1
  ), clk AS (
    SELECT c.tracked_link_id AS link_id, count(*) AS clicks
      FROM public.tracked_link_clicks c
      JOIN _alk l ON l.id = c.tracked_link_id
     WHERE public._tix_bucket(c.clicked_at, l.event_id, m, false) IS NOT NULL
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', l.id, 'kind', l.kind, 'name', l.name, 'role', l.role, 'code', l.code, 'archived', l.archived,
           'event_id', l.event_id, 'event_title', e.title, 'event_start', e.start_at,
           'clicks', COALESCE(k.clicks, 0), 'sales', COALESCE(a.sales, 0), 'prev_sales', COALESCE(a.prev_sales, 0),
           'tickets', COALESCE(a.tickets, 0), 'tables', COALESCE(a.tables, 0), 'guests', COALESCE(a.guests, 0),
           'revenue', round(COALESCE(a.revenue, 0), 2))
         ORDER BY CASE WHEN v_money THEN COALESCE(a.revenue, 0) ELSE COALESCE(a.sales, 0) END DESC,
                  COALESCE(a.sales, 0) DESC, COALESCE(k.clicks, 0) DESC, e.start_at DESC, l.name), '[]'::jsonb)
    INTO v_links
    FROM _alk l
    JOIN _aev e ON e.id = l.event_id
    LEFT JOIN agg a ON a.link_id = l.id
    LEFT JOIN clk k ON k.link_id = l.id
   WHERE COALESCE(a.sales, 0) > 0 OR COALESCE(a.prev_sales, 0) > 0 OR COALESCE(k.clicks, 0) > 0
      OR (NOT l.archived AND e.upcoming);

  -- Les soirées partagées de la période (ou la soirée choisie, si elle l'est).
  WITH sh AS (
    SELECT e.id, e.title, e.start_at, e.upcoming,
           (ev.partner_venue_id IS NOT NULL OR ev.partner_organizer_id IS NOT NULL) AS collab,
           (SELECT count(*) FROM public.event_cohosts c WHERE c.event_id = e.id AND c.status = 'accepted') AS cohosts,
           (SELECT count(*) FROM public.event_guest_passes h WHERE h.event_id = e.id AND h.revoked_at IS NULL) AS guests
      FROM _aev e JOIN public.events ev ON ev.id = e.id
     WHERE v_ev IS NULL OR e.id = v_ev
  ), act AS (
    -- Ventes (billets et tables) : une inscription en guest list n'en est pas une.
    SELECT event_id, count(*) FILTER (WHERE ok AND pillar <> 'guestlist') AS sales FROM _atk_all WHERE ci IS NOT NULL GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title, 'start_at', s.start_at, 'upcoming', s.upcoming,
           'parties', 1 + (CASE WHEN s.collab THEN 1 ELSE 0 END) + s.cohosts, 'guests', s.guests,
           'sales', COALESCE(a.sales, 0)) ORDER BY s.start_at DESC), '[]'::jsonb)
    INTO v_shared
    FROM (SELECT * FROM sh WHERE collab OR cohosts > 0 OR guests > 0) s
    LEFT JOIN act a ON a.event_id = s.id
   WHERE v_ev IS NOT NULL OR COALESCE(a.sales, 0) > 0 OR s.upcoming;

  RETURN jsonb_build_object(
    'meta', m || jsonb_build_object('has_promoters', v_has_promoters),
    'series', COALESCE(v_series, '[]'::jsonb),
    'totals', v_tot,
    'promoters', v_promoters,
    'links', v_links,
    'shared', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_shared) x LIMIT 12) q)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tix_ana_partners(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._tix_money_gate(public.tix_ana_partners__core(p_venue_id, p_organizer_user_id, p_period, p_event), p_venue_id, p_organizer_user_id);
$function$;

-- ── Droits ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('tix_ana_partners__core', 'tix_ana_partners') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = 'tix_ana_partners' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- ── Aperçu démo : la lecture crée des tables temporaires ───────────────────
-- Ajoutée à la liste vivante (d'autres sessions l'étendent aussi) : on relit
-- la définition en base et on n'y insère que ce nom.
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.demo_preview_writable_rpc(text)'::regprocedure);
  IF position('''tix_ana_partners''' IN v_def) = 0 THEN
    IF position('''tix_ana_sales''' IN v_def) = 0 THEN
      RAISE EXCEPTION 'demo_preview_writable_rpc: tix_ana_sales introuvable, insertion impossible';
    END IF;
    v_def := replace(v_def, '''tix_ana_sales''', '''tix_ana_sales'', ''tix_ana_partners''');
    EXECUTE v_def;
  END IF;
END $$;
