-- Console : trois pages comptaient des lignes PostgREST côté navigateur.
--
-- PostgREST rend au plus 1 000 lignes par requête. Avec un vrai volume (club
-- démo resemé le 20/10 : 6 798 factures, 1 510 clics promoteur, 5 598 clients),
-- trois écrans de la Console Club affichaient des totaux faux sans le dire :
--
--   1. Compta : `invoices` lu par mois tombait à 1 000 factures, et la lecture
--      des billets par `.in('id', …)` avec des centaines d'ids dépassait la
--      taille d'URL de l'API (le tarif devenait « Billet », les frais Yuno
--      estimés au lieu d'être lus).
--   2. Promoteurs : clics et conversions comptés en JS sur 1 000 lignes.
--   3. Clients : « 1000 clients / 1000 actifs / 0 à risque ».
--
-- Ce fichier pose les lectures qui rendent des chiffres complets :
--
--   * get_accounting_invoices : TOUTES les factures de la portée et de la
--     période, enrichies de la vente qu'elles facturent (frais Yuno stockés,
--     remboursement, nom du tarif ou de la formule), en UNE valeur jsonb (ni
--     plafond de lignes, ni URL géante). SECURITY INVOKER : la RLS de
--     l'appelant s'applique exactement comme avant (factures, billets,
--     tables, commandes). Le partage d'une co-soirée reste calculé par
--     `utils/coEventSplit.ts`, le même module que la facture PDF d'une
--     soirée : la compta et la facture tombent juste au centime.
--   * get_promoter_overview_stats : clics, ventes attribuées, commissions par
--     promoteur, agrégés en SQL. SECURITY INVOKER (RLS des clics et des
--     conversions de l'appelant, comme avant).
--   * get_venue_customer_base : chiffres de la base clients (total, actifs,
--     à risque, dépense, segments RFM, catégories) calculés en SQL, plus la
--     liste COMPLÈTE en une valeur jsonb, à partir d'un seul calcul de
--     `_venue_customer_rfm`. Même porte que get_venue_customer_segments.
--   * get_organizer_customer_base : la liste complète côté organisateur (pour
--     la zone fidélité d'Analytics), sous la porte de
--     get_organizer_customer_segments.

-- ─── 1. Compta ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_event_id ON public.invoices (event_id);

CREATE OR REPLACE FUNCTION public.get_accounting_invoices(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, e.event_mode, e.revenue_split_rules,
           e.venue_id, e.partner_venue_id, e.organizer_user_id,
           e.partner_organizer_id, e.is_bde
    FROM events e
    WHERE (p_venue_id IS NOT NULL
           AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
       OR (p_organizer_user_id IS NOT NULL
           AND (e.organizer_user_id = p_organizer_user_id
                OR e.partner_organizer_id = p_organizer_user_id))
  ),
  inv AS MATERIALIZED (
    SELECT i.id, i.type, i.amount, i.event_id, i.event_name, i.customer_name,
           i.customer_email, i.invoice_number, i.created_at, i.items,
           i.ticket_id, i.table_reservation_id, i.order_id
    FROM invoices i
    WHERE i.event_id IN (SELECT ev.id FROM ev)
      AND (p_from IS NULL OR i.created_at >= p_from)
      AND (p_to IS NULL OR i.created_at <= p_to)
  ),
  rows AS (
    -- Clés nulles retirées : la page lit une clé absente comme null.
    SELECT i.created_at, i.id,
      jsonb_strip_nulls(jsonb_build_object(
        'id', i.id,
        'type', i.type,
        'amount', i.amount,
        'event_id', i.event_id,
        'event_name', i.event_name,
        'customer_name', i.customer_name,
        'customer_email', i.customer_email,
        'invoice_number', i.invoice_number,
        'created_at', i.created_at,
        -- Seule une commande garde le détail de ses lignes (une boisson par
        -- ligne) ; billets et tables se rangent sous le nom du tarif.
        'items', CASE WHEN i.type = 'order' THEN i.items END,
        'ticket_id', i.ticket_id,
        'table_reservation_id', i.table_reservation_id,
        'order_id', i.order_id,
        -- La vente facturée, dans l'ordre billet › table › commande (même
        -- ordre que txnId côté front). NULL quand la RLS de l'appelant ne la
        -- montre pas : le front retombe alors sur l'estimation, comme avant.
        'sale', CASE
          WHEN t.id IS NOT NULL THEN jsonb_build_object(
            'refund_amount', t.refund_amount,
            'service_fee', t.service_fee,
            'insurance_fee', t.insurance_fee,
            'label', COALESCE(NULLIF(r.name, ''), NULLIF(t.ticket_type, '')),
            'qty', t.quantity)
          WHEN tr.id IS NOT NULL THEN jsonb_build_object(
            'refund_amount', tr.refund_amount,
            'service_fee', tr.service_fee,
            'management_fee', tr.management_fee,
            'fee_absorbed', tr.fee_absorbed,
            'label', NULLIF(tp.name, ''),
            'qty', 1)
          WHEN o.id IS NOT NULL THEN jsonb_build_object(
            'refund_amount', o.refund_amount,
            'service_fee', o.service_fee)
        END
      )) AS j
    FROM inv i
    LEFT JOIN tickets t ON t.id = i.ticket_id
    LEFT JOIN ticket_rounds r ON r.id = t.ticket_round_id
    LEFT JOIN table_reservations tr ON tr.id = i.table_reservation_id
    LEFT JOIN table_packs tp ON tp.id = tr.pack_id
    LEFT JOIN orders o ON o.id = i.order_id
  )
  SELECT jsonb_build_object(
    'events', COALESCE((
      SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.start_at DESC NULLS LAST)
      FROM ev
      WHERE ev.id IN (SELECT inv.event_id FROM inv)
    ), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(rows.j ORDER BY rows.created_at DESC, rows.id)
      FROM rows
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_accounting_invoices(text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accounting_invoices(text, uuid, timestamptz, timestamptz) TO authenticated;

-- ─── 2. Promoteurs ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_promoter_overview_stats(
  p_promoter_ids uuid[],
  p_from timestamptz DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  promoter_id uuid,
  clicks bigint,
  conversions bigint,
  revenue numeric,
  commission numeric,
  tickets bigint,
  tables bigint,
  pending_commission numeric,
  approved_commission numeric,
  paid_commission numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH ids AS (
    SELECT DISTINCT x AS id FROM unnest(COALESCE(p_promoter_ids, '{}'::uuid[])) AS x
  ),
  c AS (
    SELECT pc.promoter_id AS pid, count(*) AS n
    FROM promoter_clicks pc
    WHERE pc.promoter_id IN (SELECT ids.id FROM ids)
      AND (p_from IS NULL OR pc.clicked_at >= p_from)
      AND (p_event_id IS NULL OR pc.event_id = p_event_id)
    GROUP BY pc.promoter_id
  ),
  v AS (
    -- Les lignes « cancelled » (ventes remboursées) ne comptent ni dans les
    -- ventes attribuées ni dans les commissions dues. Les lignes « override »
    -- (part du chef d'équipe) portent de l'argent mais ne sont pas des ventes.
    SELECT cv.promoter_id AS pid,
      count(*) FILTER (WHERE cv.conversion_type IS DISTINCT FROM 'override') AS conversions,
      COALESCE(sum(cv.amount), 0) AS revenue,
      COALESCE(sum(cv.commission), 0) AS commission,
      count(*) FILTER (WHERE cv.conversion_type = 'ticket' AND COALESCE(cv.amount, 0) > 0) AS tickets,
      count(*) FILTER (WHERE cv.conversion_type = 'table' AND COALESCE(cv.amount, 0) > 0) AS tables,
      COALESCE(sum(cv.commission) FILTER (WHERE cv.status = 'pending'), 0) AS pending_commission,
      COALESCE(sum(cv.commission) FILTER (WHERE cv.status = 'approved'), 0) AS approved_commission,
      COALESCE(sum(cv.commission) FILTER (WHERE cv.status = 'paid'), 0) AS paid_commission
    FROM promoter_conversions cv
    WHERE cv.promoter_id IN (SELECT ids.id FROM ids)
      AND cv.status <> 'cancelled'
      AND (p_from IS NULL OR cv.created_at >= p_from)
      AND (p_event_id IS NULL OR cv.event_id = p_event_id)
    GROUP BY cv.promoter_id
  )
  SELECT ids.id,
         COALESCE(c.n, 0),
         COALESCE(v.conversions, 0),
         COALESCE(v.revenue, 0),
         COALESCE(v.commission, 0),
         COALESCE(v.tickets, 0),
         COALESCE(v.tables, 0),
         COALESCE(v.pending_commission, 0),
         COALESCE(v.approved_commission, 0),
         COALESCE(v.paid_commission, 0)
  FROM ids
  LEFT JOIN c ON c.pid = ids.id
  LEFT JOIN v ON v.pid = ids.id;
$function$;

REVOKE ALL ON FUNCTION public.get_promoter_overview_stats(uuid[], timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promoter_overview_stats(uuid[], timestamptz, uuid) TO authenticated;

-- ─── 3. Clients ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_venue_customer_base(p_venue_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  -- Même porte que get_venue_customer_segments.
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR is_super_admin()
          OR is_venue_owner(auth.uid(), p_venue_id)
          OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  WITH r AS MATERIALIZED (
    SELECT x.*,
      -- Catégorie préférée : même règle que preferredCategory() de la page
      -- (le plus grand des trois compteurs ; à égalité, tables puis billets).
      CASE
        WHEN GREATEST(COALESCE(x.ticket_count, 0), COALESCE(x.order_count, 0), COALESCE(x.table_count, 0)) = 0 THEN 'mixed'
        WHEN COALESCE(x.table_count, 0) = GREATEST(COALESCE(x.ticket_count, 0), COALESCE(x.order_count, 0), COALESCE(x.table_count, 0)) THEN 'tables'
        WHEN COALESCE(x.ticket_count, 0) = GREATEST(COALESCE(x.ticket_count, 0), COALESCE(x.order_count, 0), COALESCE(x.table_count, 0)) THEN 'tickets'
        ELSE 'drinks'
      END AS pref_category
    FROM public._venue_customer_rfm(p_venue_id) x
  )
  SELECT jsonb_build_object(
    'stats', jsonb_build_object(
      'total', count(*),
      'active_30d', count(*) FILTER (WHERE COALESCE(r.recency_days, 9999) <= 30),
      'churn', count(*) FILTER (WHERE r.churn_risk),
      'total_spent', COALESCE(sum(r.total_spent), 0),
      'revenue_30d', COALESCE(sum(r.revenue_30d), 0),
      'avg_spent', CASE WHEN count(*) > 0 THEN COALESCE(sum(r.total_spent), 0) / count(*) ELSE 0 END,
      'segments', jsonb_build_object(
        'champions', count(*) FILTER (WHERE r.rfm_segment = 'champions'),
        'loyal',     count(*) FILTER (WHERE r.rfm_segment = 'loyal'),
        'promising', count(*) FILTER (WHERE r.rfm_segment = 'promising'),
        'new',       count(*) FILTER (WHERE r.rfm_segment = 'new'),
        'at_risk',   count(*) FILTER (WHERE r.rfm_segment = 'at_risk'),
        'dormant',   count(*) FILTER (WHERE r.rfm_segment = 'dormant'),
        'lost',      count(*) FILTER (WHERE COALESCE(r.rfm_segment, 'lost') = 'lost')
      ),
      'categories', jsonb_build_object(
        'tickets', count(*) FILTER (WHERE r.pref_category = 'tickets'),
        'drinks',  count(*) FILTER (WHERE r.pref_category = 'drinks'),
        'tables',  count(*) FILTER (WHERE r.pref_category = 'tables'),
        'mixed',   count(*) FILTER (WHERE r.pref_category = 'mixed')
      )
    ),
    'customers', COALESCE(
      jsonb_agg(jsonb_strip_nulls(to_jsonb(r) - 'pref_category') ORDER BY r.last_visit_at DESC NULLS LAST, r.id),
      '[]'::jsonb)
  )
  INTO v_out
  FROM r;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_venue_customer_base(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_venue_customer_base(text) TO authenticated, service_role;

-- Côté organisateur : la liste complète en une valeur, sous la porte de
-- get_organizer_customer_segments (appelée telle quelle, droits de l'appelant).
-- Les lignes gardent la forme exacte de cette fonction (clés nulles comprises).
CREATE OR REPLACE FUNCTION public.get_organizer_customer_base(p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'customers', COALESCE(
      jsonb_agg(to_jsonb(s) ORDER BY s.last_visit_at DESC NULLS LAST, s.id),
      '[]'::jsonb)
  )
  FROM public.get_organizer_customer_segments(p_organizer_user_id) s;
$function$;

REVOKE ALL ON FUNCTION public.get_organizer_customer_base(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organizer_customer_base(uuid) TO authenticated;
