-- ─────────────────────────────────────────────────────────────────────────────
-- Attribution email : le CA ne suffit pas, il faut dire CE QUI a été réservé.
--
-- Avant, `get_email_campaign_attribution` ne rendait que `revenue` + `buyers`.
-- Un pro qui envoyait une campagne bâtie sur les blocs natifs Yuno (Soirée,
-- Billetterie, Table VIP, Entrée) lisait « 420 € » sans savoir si c'était huit
-- billets ou une table — et une campagne de liste invités, qui ne produit
-- aucun euro, affichait 0 comme si l'email n'avait rien fait.
--
-- Cette version ajoute, PAR CAMPAGNE, la ventilation par pilier :
--   • billets   : commandes, billets (quantity), net
--   • tables    : réservations, convives (guest_count), net
--   • liste inv.: inscriptions, personnes            ← nouveau, jamais compté
--   • boissons  : commandes, net
--
-- Trois choses ne bougent PAS (des écrans les lisent déjà) :
--   • `revenue` et `total_90d` gardent exactement la même formule nette
--     (fees.ts) — la liste invités entre avec un montant 0, elle ne peut donc
--     rien diluer.
--   • `buyers` reste le nombre d'ACHETEURS : une inscription guest list n'est
--     pas un achat, elle est comptée à part (`guestlist.people`).
--   • fenêtre 1er clic → action sous 72 h, revenu par campagne = influence
--     (une vente peut créditer deux campagnes), total_90d dédupliqué.
--
-- Perf : les ventes sont bornées à 90 jours. Un clic vient forcément d'une
-- campagne créée dans les 90 jours, et l'action suit le clic : aucune ligne
-- attribuable ne vit avant cette borne, on cesse juste de scanner l'historique.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_email_campaign_attribution(p_subject_type text, p_subject_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type NOT IN ('venue', 'organizer') THEN
    RETURN jsonb_build_object('ok', true, 'supported', false);
  END IF;

  WITH scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id)
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id)
           END
  ),
  -- 1er clic par (campagne, email) sur les campagnes email du sujet (90 j)
  clicks AS (
    SELECT ece.campaign_id, lower(ece.recipient_email) AS em, min(ece.created_at) AS click_at
      FROM public.email_campaign_events ece
      JOIN public.email_campaigns ec ON ec.id = ece.campaign_id
     WHERE ece.event_type = 'clicked'
       AND ece.recipient_email IS NOT NULL
       AND ec.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN ec.venue_id = p_subject_id
                ELSE ec.organizer_user_id::text = p_subject_id
           END
     GROUP BY ece.campaign_id, lower(ece.recipient_email)
  ),
  -- Actions du sujet avec NET (fees.ts), matchées par email. `units` = ce que
  -- le pilier compte vraiment : billets vendus, convives attablés, 1 inscrit.
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, 'ticket'::text AS kind,
           lower(t.user_email) AS em, t.created_at,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)
              - coalesce(t.refund_amount, 0) - (t.total_price * 0.015 + 0.25)) AS net,
           GREATEST(coalesce(t.quantity, 1), 1)::int AS units
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= now() - interval '90 days'
    UNION ALL
    SELECT 'table:' || r.id::text, 'table', lower(r.user_email), r.created_at,
           (r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)
              - coalesce(r.refund_amount, 0) - (r.total_price * 0.015 + 0.25)),
           GREATEST(coalesce(r.guest_count, 0), 0)::int
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= now() - interval '90 days'
    UNION ALL
    -- Boissons : périmètre venue = tout le bar du club ; périmètre organizer =
    -- les commandes rattachées à ses soirées.
    SELECT 'order:' || o.id::text, 'order', lower(o.user_email), o.created_at,
           (o.total - coalesce(o.service_fee, 0) - coalesce(o.refund_amount, 0) - (o.total * 0.015 + 0.25)),
           0
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL
       AND o.created_at >= now() - interval '90 days'
       AND CASE WHEN p_subject_type = 'venue'
                THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events)
           END
    UNION ALL
    -- Liste invités : zéro euro, mais c'est une entrée gagnée. Sur une soirée
    -- sans billetterie c'est la SEULE chose que l'email peut produire — la
    -- taire revenait à afficher « 0 € » sur une campagne qui a rempli la porte.
    SELECT 'guestlist:' || gle.id::text, 'guestlist', lower(gle.email), gle.created_at,
           0::numeric, 1
      FROM public.guest_list_entries gle
      JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
     WHERE gl.event_id IN (SELECT id FROM scoped_events)
       AND gle.status <> 'cancelled'
       AND gle.email IS NOT NULL AND btrim(gle.email) <> ''
       AND gle.created_at >= now() - interval '90 days'
  ),
  attributed AS (
    SELECT c.campaign_id, s.sale_key, s.kind, s.em, s.net, s.units
      FROM clicks c
      JOIN sales s
        ON s.em = c.em
       AND s.created_at >= c.click_at
       AND s.created_at <  c.click_at + interval '72 hours'
  ),
  per_campaign AS (
    SELECT campaign_id,
           round(sum(net)::numeric, 2)                                   AS revenue,
           count(DISTINCT em) FILTER (WHERE kind <> 'guestlist')         AS buyers,
           count(*)           FILTER (WHERE kind = 'ticket')             AS ticket_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'ticket'), 0)        AS ticket_units,
           round(coalesce(sum(net) FILTER (WHERE kind = 'ticket'), 0)::numeric, 2)    AS ticket_revenue,
           count(*)           FILTER (WHERE kind = 'table')              AS table_orders,
           coalesce(sum(units) FILTER (WHERE kind = 'table'), 0)         AS table_guests,
           round(coalesce(sum(net) FILTER (WHERE kind = 'table'), 0)::numeric, 2)     AS table_revenue,
           count(*)           FILTER (WHERE kind = 'guestlist')          AS gl_entries,
           count(DISTINCT em) FILTER (WHERE kind = 'guestlist')          AS gl_people,
           count(*)           FILTER (WHERE kind = 'order')              AS drink_orders,
           round(coalesce(sum(net) FILTER (WHERE kind = 'order'), 0)::numeric, 2)     AS drink_revenue
      FROM attributed
     GROUP BY campaign_id
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', campaign_id,
        'revenue', revenue,
        'buyers', buyers,
        'tickets',   jsonb_build_object('orders', ticket_orders, 'units', ticket_units, 'revenue', ticket_revenue),
        'tables',    jsonb_build_object('orders', table_orders,  'guests', table_guests, 'revenue', table_revenue),
        'guestlist', jsonb_build_object('entries', gl_entries,   'people', gl_people),
        'drinks',    jsonb_build_object('orders', drink_orders,  'revenue', drink_revenue)
      ))
      FROM per_campaign
    ), '[]'::jsonb),
    'total_90d', COALESCE((
      SELECT round(sum(net)::numeric, 2)
      FROM (SELECT DISTINCT sale_key, net FROM attributed) d
    ), 0)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_campaign_attribution(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_email_campaign_attribution(text, text) TO authenticated;
