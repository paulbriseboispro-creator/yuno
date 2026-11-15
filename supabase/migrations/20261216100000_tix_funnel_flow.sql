-- Yuno Tickets › Analyses › Trafic : le tunnel d'achat en cinq étapes et les
-- billets choisis (demande de Paul du 15/11, analyse de House Of Love VOL.1).
--
-- Le tunnel existait (`funnel` de tix_ana_visits) mais fusionnait les
-- coordonnées et le paiement, comptait une session sur toutes les soirées de
-- la période, et ne disait que LE billet le plus abandonné. `funnel.flow`
-- (ajouté, rien n'est retiré : les clés d'avant restent servies) rend :
--
--   steps     : visite → choix → page « Vos infos » → infos validées →
--               paiement (page Stripe ouverte, ou gratuit) → commande validée.
--               Une visite = (soirée, onglet) ; elle compte à son étape la
--               plus avancée et à toutes celles d'avant.
--   by_pillar : le même tunnel pour les billets, les tables, la guest list
--               (la visite de la page reste commune).
--   prev      : le tunnel de la soirée comparée (mode soirée) ou de la
--               période d'avant ; l'écran n'en compare que les TAUX.
--   choices   : chaque billet / formule de table choisi pendant une visite,
--               acheté ou non : visites qui l'ont choisi, qui l'ont acheté
--               après l'avoir choisi, abandonnées sur lui (dernier choix, rien
--               acheté) et où elles se sont arrêtées, places restées dans ces
--               paniers, visites qui l'ont vu « Épuisé ».
--
-- Trafic se compte en personnes : aucun montant (le prix du billet n'est
-- qu'une étiquette). Modifie la définition VIVANTE de tix_ana_visits__core par
-- un repère exact (méthode de 20261214100000) : repère introuvable = erreur.

CREATE OR REPLACE FUNCTION public._tix_funnel_flow(
  p_ids uuid[], p_event uuid, p_cmp uuid,
  p_from timestamptz, p_to timestamptz, p_pfrom timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH f AS MATERIALIZED (
    SELECT x.event_id, x.session_id, x.step, x.pillar, x.ref_id, x.quantity, x.created_at,
           CASE x.step WHEN 'viewed' THEN 1 WHEN 'selected' THEN 2 WHEN 'checkout' THEN 3
                       WHEN 'details' THEN 4 WHEN 'payment' THEN 5 WHEN 'purchased' THEN 6 END AS rk,
           CASE WHEN p_event IS NOT NULL THEN CASE WHEN x.event_id = p_event THEN 'c' ELSE 'p' END
                WHEN x.created_at >= p_from THEN 'c' ELSE 'p' END AS grp
      FROM public.event_funnel_events x
     WHERE x.step IN ('viewed', 'selected', 'checkout', 'details', 'payment', 'purchased', 'soldout_seen')
       AND CASE WHEN p_event IS NOT NULL THEN x.event_id = p_event OR (p_cmp IS NOT NULL AND x.event_id = p_cmp)
                ELSE x.event_id = ANY (p_ids) AND x.created_at >= COALESCE(p_pfrom, p_from) AND x.created_at < p_to END
  ),
  -- Une visite = une soirée dans un onglet, à son étape la plus avancée.
  s AS MATERIALIZED (
    SELECT grp, event_id, session_id,
           max(rk) AS rk,
           COALESCE(max(rk) FILTER (WHERE pillar = 'tickets'), 0) AS rk_t,
           COALESCE(max(rk) FILTER (WHERE pillar = 'tables'), 0) AS rk_b,
           COALESCE(max(rk) FILTER (WHERE pillar = 'guest_list'), 0) AS rk_g,
           -- Le DERNIER billet / formule choisi par la visite (une visite qui change d'avis compte sous lui).
           (array_agg(pillar ORDER BY created_at DESC) FILTER (WHERE step = 'selected' AND pillar IN ('tickets', 'tables') AND ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))[1] AS l_pillar,
           (array_agg(ref_id ORDER BY created_at DESC) FILTER (WHERE step = 'selected' AND pillar IN ('tickets', 'tables') AND ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))[1] AS l_ref,
           (array_agg(quantity ORDER BY created_at DESC) FILTER (WHERE step = 'selected' AND pillar IN ('tickets', 'tables') AND ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))[1] AS l_qty
      FROM f WHERE rk IS NOT NULL GROUP BY 1, 2, 3
  ),
  st AS (
    SELECT grp, jsonb_build_object(
             'viewed', count(*), 'selected', count(*) FILTER (WHERE rk >= 2),
             'checkout', count(*) FILTER (WHERE rk >= 3), 'details', count(*) FILTER (WHERE rk >= 4),
             'payment', count(*) FILTER (WHERE rk >= 5), 'purchased', count(*) FILTER (WHERE rk >= 6)) AS j
      FROM s GROUP BY grp
  ),
  bp0 AS (
    SELECT p.k, count(*) FILTER (WHERE p.r >= 2) AS sel, count(*) FILTER (WHERE p.r >= 3) AS chk,
           count(*) FILTER (WHERE p.r >= 4) AS det, count(*) FILTER (WHERE p.r >= 5) AS pay,
           count(*) FILTER (WHERE p.r >= 6) AS pur
      FROM s CROSS JOIN LATERAL (VALUES ('tickets', s.rk_t), ('tables', s.rk_b), ('guest_list', s.rk_g)) p(k, r)
     WHERE s.grp = 'c' AND p.r > 0
     GROUP BY 1
  ),
  -- ── Les billets et formules choisis (période ou soirée courante) ─────────
  sel AS MATERIALIZED (
    SELECT f.event_id, f.session_id, f.pillar, f.ref_id, f.quantity, f.created_at
      FROM f
     WHERE f.grp = 'c' AND f.step = 'selected' AND f.pillar IN ('tickets', 'tables')
       AND f.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  -- Ce que la visite a réellement acheté (la vente relevée par la base porte '<sorte>:<id>').
  bought AS (
    SELECT DISTINCT f.event_id, f.session_id, 'tickets'::text AS pillar, t.ticket_round_id::text AS ref_id
      FROM f JOIN public.tickets t
        ON f.ref_id ~* '^ticket:[0-9a-f-]{36}$' AND t.id = substr(f.ref_id, 8)::uuid
     WHERE f.grp = 'c' AND f.step = 'purchased' AND t.ticket_round_id IS NOT NULL
    UNION
    SELECT DISTINCT f.event_id, f.session_id, 'tables', r.pack_id::text
      FROM f JOIN public.table_reservations r
        ON f.ref_id ~* '^table:[0-9a-f-]{36}$' AND r.id = substr(f.ref_id, 7)::uuid
     WHERE f.grp = 'c' AND f.step = 'purchased' AND r.pack_id IS NOT NULL
  ),
  seen_out AS (
    SELECT f.event_id, f.ref_id, count(DISTINCT f.session_id) AS n
      FROM f
     WHERE f.grp = 'c' AND f.step = 'soldout_seen' AND f.pillar = 'tickets'
       AND f.ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     GROUP BY 1, 2
  ),
  refs AS (
    SELECT DISTINCT event_id, pillar, ref_id FROM sel
    UNION
    SELECT event_id, 'tickets', ref_id FROM seen_out
  ),
  -- Une ligne par (visite, billet choisi), puis des agrégats groupés : jamais une sous-requête par billet.
  sel1 AS MATERIALIZED (SELECT DISTINCT event_id, session_id, pillar, ref_id FROM sel),
  c_chosen AS (
    SELECT x.event_id, x.pillar, x.ref_id, count(*) AS chosen, count(b.session_id) AS bought
      FROM sel1 x LEFT JOIN bought b
        ON b.event_id = x.event_id AND b.session_id = x.session_id AND b.pillar = x.pillar AND b.ref_id = x.ref_id
     GROUP BY 1, 2, 3
  ),
  -- Abandonnées sur ce choix : c'était le dernier, et la visite n'a rien acheté.
  c_left AS (
    SELECT s.event_id, s.l_pillar AS pillar, s.l_ref AS ref_id, count(*) AS left_n,
           count(*) FILTER (WHERE s.rk = 2) AS at_choice,
           count(*) FILTER (WHERE s.rk IN (3, 4)) AS at_info,
           count(*) FILTER (WHERE s.rk = 5) AS at_pay,
           sum(GREATEST(1, COALESCE(s.l_qty, 1))) AS seats
      FROM s
     WHERE s.grp = 'c' AND s.l_ref IS NOT NULL AND s.rk < 6
     GROUP BY 1, 2, 3
  ),
  ch AS (
    SELECT r.event_id, r.pillar, r.ref_id,
           COALESCE(c.chosen, 0) AS chosen, COALESCE(c.bought, 0) AS bought,
           COALESCE(a.left_n, 0) AS left_n, COALESCE(a.at_choice, 0) AS at_choice, COALESCE(a.at_info, 0) AS at_info,
           COALESCE(a.at_pay, 0) AS at_pay, COALESCE(a.seats, 0) AS seats,
           COALESCE(o.n, 0) AS soldout_seen
      FROM refs r
      LEFT JOIN c_chosen c ON c.event_id = r.event_id AND c.pillar = r.pillar AND c.ref_id = r.ref_id
      LEFT JOIN c_left a ON a.event_id = r.event_id AND a.pillar = r.pillar AND a.ref_id = r.ref_id
      LEFT JOIN seen_out o ON r.pillar = 'tickets' AND o.event_id = r.event_id AND o.ref_id = r.ref_id
  ),
  named AS (
    SELECT ch.*, e.title AS event_title, e.start_at AS event_start,
           CASE ch.pillar WHEN 'tickets' THEN tr.name ELSE tp.name END AS name,
           CASE ch.pillar WHEN 'tickets' THEN tr.group_label END AS pack,
           CASE ch.pillar WHEN 'tickets' THEN tr.price ELSE tp.base_price END AS price,
           CASE ch.pillar WHEN 'tickets' THEN tr.position END AS pos
      FROM ch
      JOIN public.events e ON e.id = ch.event_id
      LEFT JOIN public.ticket_rounds tr ON ch.pillar = 'tickets' AND tr.id = ch.ref_id::uuid
      LEFT JOIN public.table_packs tp ON ch.pillar = 'tables' AND tp.id = ch.ref_id::uuid
     WHERE (ch.pillar = 'tickets' AND tr.id IS NOT NULL) OR (ch.pillar = 'tables' AND tp.id IS NOT NULL)
  )
  SELECT jsonb_build_object('flow', jsonb_build_object(
    'steps', COALESCE((SELECT j FROM st WHERE grp = 'c'),
                      jsonb_build_object('viewed', 0, 'selected', 0, 'checkout', 0, 'details', 0, 'payment', 0, 'purchased', 0)),
    'prev', (SELECT j FROM st WHERE grp = 'p'),
    'prev_kind', CASE WHEN p_event IS NOT NULL THEN 'event' ELSE 'period' END,
    'by_pillar', COALESCE((SELECT jsonb_object_agg(k, jsonb_build_object(
                   'selected', sel, 'checkout', chk, 'details', det, 'payment', pay, 'purchased', pur)) FROM bp0), '{}'::jsonb),
    'choices', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'pillar', n.pillar, 'id', n.ref_id, 'name', n.name, 'pack', n.pack, 'price', n.price,
                   'event_id', n.event_id, 'event_title', n.event_title, 'event_start', n.event_start,
                   'chosen', n.chosen, 'bought', n.bought, 'left', COALESCE(n.left_n, 0),
                   'at_choice', COALESCE(n.at_choice, 0), 'at_info', COALESCE(n.at_info, 0), 'at_pay', COALESCE(n.at_pay, 0),
                   'seats', COALESCE(n.seats, 0), 'soldout_seen', n.soldout_seen)
                 ORDER BY n.chosen DESC, n.soldout_seen DESC, n.pos NULLS LAST, n.name)
                 FROM (SELECT * FROM named ORDER BY chosen DESC, soldout_seen DESC LIMIT 40) n), '[]'::jsonb)
  ));
$$;

REVOKE ALL ON FUNCTION public._tix_funnel_flow(uuid[], uuid, uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tix_funnel_flow(uuid[], uuid, uuid, timestamptz, timestamptz, timestamptz) TO service_role;

DO $mig$
DECLARE
  d text;
  a text := $r$'funnel', (SELECT jsonb_build_object($r$;
  b text := $r$'funnel', public._tix_funnel_flow(v_ids, CASE WHEN v_mode = 'event' THEN v_ev_id END, CASE WHEN v_mode = 'event' THEN v_cev_id END, v_from, v_to, v_pfrom) || (SELECT jsonb_build_object($r$;
BEGIN
  d := pg_get_functiondef('public.tix_ana_visits__core(text,uuid,text,uuid,uuid)'::regprocedure);
  IF position('_tix_funnel_flow' IN d) > 0 THEN RETURN; END IF;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION 'tix_funnel_flow: repère introuvable'; END IF;
  d := replace(d, a, b);
  EXECUTE d;
END
$mig$;

-- Un choix se relève dès le tap sur un billet (page de choix), puis encore au
-- « Continuer » s'il change de quantité : sans ça, la quantité finale du panier
-- se perdait derrière le dédoublonnage de 2 minutes.
DO $mig$
DECLARE
  d text;
  a text := $r$                WHERE f.event_id = p_event_id AND f.session_id = v_sid AND f.step = 'selected'
                  AND f.pillar IS NOT DISTINCT FROM v_pillar
                  AND f.ref_id IS NOT DISTINCT FROM left(p_ref, 80)
                  AND f.created_at > now() - interval '2 minutes') THEN$r$;
  b text := $r$                WHERE f.event_id = p_event_id AND f.session_id = v_sid AND f.step = 'selected'
                  AND f.pillar IS NOT DISTINCT FROM v_pillar
                  AND f.ref_id IS NOT DISTINCT FROM left(p_ref, 80)
                  AND f.quantity IS NOT DISTINCT FROM (CASE WHEN p_quantity BETWEEN 0 AND 1000 THEN p_quantity END)
                  AND f.created_at > now() - interval '2 minutes') THEN$r$;
BEGIN
  d := pg_get_functiondef('public.track_event_funnel(text,uuid,text,text,text,integer,integer,text,text,text,text)'::regprocedure);
  IF position('f.quantity IS NOT DISTINCT FROM' IN d) > 0 THEN RETURN; END IF;
  IF position(a IN d) = 0 THEN RAISE EXCEPTION 'track_event_funnel: repère introuvable'; END IF;
  EXECUTE replace(d, a, b);
END
$mig$;
