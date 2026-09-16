-- ───────────────────────────────────────────────────────────────────────────
-- « Panier moyen élevé » : la valeur Yuno est DYNAMIQUE (2026-09-16).
--
-- La plaquette promet « une dépense au-dessus d'un seuil que vous fixez ».
-- Un seuil unique (60 € / soirée, celui de l'analyseur) ne veut rien dire
-- pour un club à 900 € la table ET pour un bar à 15 € l'entrée. Yuno établit
-- donc SA valeur par portée, et le pro la remplace s'il veut :
--
--   1. Historique : s'il y a assez de paniers payés (≥ 20 clients payeurs),
--      le seuil est le 3e quartile de la dépense par soirée — le quart des
--      clients qui dépensent le plus. Arrondi aux 5 € supérieurs.
--   2. Sinon, l'offre : le prix par convive de la formule de table la moins
--      chère (base_price ou minimum de consommation ÷ couverts) ; à défaut,
--      1,5 × le billet le plus cher (« plus qu'un billet » = profil table).
--   3. Sinon, 60 € (le seuil de l'analyseur).
--
-- La réponse porte la BASE du calcul (history / offer_tables / offer_tickets
-- / default) et les chiffres : l'écran dit d'où vient la valeur.
-- Lecture seule, même garde que les segments contacts (contact_scope_allowed).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.suggest_basket_threshold(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payers integer := 0;
  v_p75 numeric;
  v_median numeric;
  v_max_ticket numeric;
  v_min_table_pp numeric;
  v_threshold integer;
  v_basis text;
BEGIN
  IF p_venue_id IS NULL AND p_organizer_user_id IS NULL THEN
    RETURN jsonb_build_object('threshold', 60, 'basis', 'default');
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. Historique : dépense par soirée des clients payeurs (billets, tables,
  --    boissons — net des frais Yuno, comme la base de contacts).
  SELECT count(*),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY c.spent / c.event_count),
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY c.spent / c.event_count)
    INTO v_payers, v_p75, v_median
    FROM public.contact_scope_customers(p_venue_id, p_organizer_user_id) c
   WHERE COALESCE(c.spent, 0) > 0 AND COALESCE(c.event_count, 0) > 0;

  -- 2. L'offre, sur les soirées des 12 derniers mois et à venir.
  WITH ev AS (
    SELECT e.id, COALESCE(e.venue_id, e.partner_venue_id) AS vid
      FROM public.events e
     WHERE e.start_at > now() - interval '12 months'
       AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id))
         OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)))
  )
  SELECT (SELECT max(r.price) FROM public.ticket_rounds r JOIN ev ON ev.id = r.event_id WHERE COALESCE(r.price, 0) > 0),
         (SELECT min(COALESCE(NULLIF(p.base_price, 0), NULLIF(p.minimum_spend, 0)) / GREATEST(COALESCE(p.base_capacity, 1), 1))
            FROM public.table_packs p
           WHERE p.is_active
             AND COALESCE(NULLIF(p.base_price, 0), NULLIF(p.minimum_spend, 0)) IS NOT NULL
             AND (p.event_id IN (SELECT id FROM ev)
               OR (p.event_id IS NULL AND p.venue_id IN (SELECT vid FROM ev WHERE vid IS NOT NULL))))
    INTO v_max_ticket, v_min_table_pp;

  IF v_payers >= 20 AND COALESCE(v_p75, 0) > 0 THEN
    v_threshold := GREATEST(5, ceil(v_p75 / 5.0)::integer * 5);
    v_basis := 'history';
  ELSIF COALESCE(v_min_table_pp, 0) > 0 THEN
    v_threshold := GREATEST(5, ceil(v_min_table_pp / 5.0)::integer * 5);
    v_basis := 'offer_tables';
  ELSIF COALESCE(v_max_ticket, 0) > 0 THEN
    v_threshold := GREATEST(5, ceil(v_max_ticket * 1.5 / 5.0)::integer * 5);
    v_basis := 'offer_tickets';
  ELSE
    v_threshold := 60;
    v_basis := 'default';
  END IF;

  RETURN jsonb_build_object(
    'threshold', v_threshold,
    'basis', v_basis,
    'payers', COALESCE(v_payers, 0),
    'p75', round(COALESCE(v_p75, 0), 2),
    'median', round(COALESCE(v_median, 0), 2),
    'max_ticket', round(COALESCE(v_max_ticket, 0), 2),
    'min_table_pp', round(COALESCE(v_min_table_pp, 0), 2)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.suggest_basket_threshold(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_basket_threshold(text, uuid) TO authenticated, service_role;
