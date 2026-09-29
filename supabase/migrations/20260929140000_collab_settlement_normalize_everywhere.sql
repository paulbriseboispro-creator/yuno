-- Règlement par virement : la forme canonique s'applique PARTOUT, pas seulement
-- au contrat. apply_collab_amendment recopie les règles brutes de l'avenant sur
-- la soirée : un avenant « barème + encaisseur organisateur » y arrivait tel quel.
--  • collab_settlement_collector force le club sur un barème ou des tables au
--    total dépensé (miroir de readSettlement / collabSettlement) ;
--  • les avenants sont normalisés à l'écriture, comme les contrats ;
--  • le décompte lit des règles normalisées (délai de paiement borné à 7/15/30).

CREATE OR REPLACE FUNCTION public.collab_settlement_collector(p_rules jsonb)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.is_tiered_collab(p_rules) OR p_rules->'tables'->>'basis' = 'total_spend' THEN 'venue'
    WHEN p_rules->'settlement'->>'collector' = 'organizer' THEN 'organizer'
    ELSE 'venue' END
$$;

DROP TRIGGER IF EXISTS a_normalize_collab_settlement ON public.event_collab_amendments;
CREATE TRIGGER a_normalize_collab_settlement BEFORE INSERT OR UPDATE OF split_rules ON public.event_collab_amendments
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_collab_settlement();

CREATE OR REPLACE FUNCTION public._collab_transfer_compute(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e record; v_rules jsonb; v_venue text; v_org uuid; v_collector text;
  v_tbl_basis text; v_pillars jsonb := '{}'::jsonb;
  v_venue_key text; v_org_key text; v_collector_key text;
  r record;
  v_org_owed_by_collector numeric := 0;   -- part orga de ce qu'a encaissé l'encaisseur
  v_venue_owed_by_collector numeric := 0; -- part club de ce qu'a encaissé l'encaisseur
  v_org_owed_by_venue_drinks numeric := 0;
  v_t_n int := 0; v_t_net numeric := 0; v_t_org numeric := 0;
  v_b_n int := 0; v_b_net numeric := 0; v_b_org numeric := 0;
  v_d_n int := 0; v_d_net numeric := 0; v_d_org numeric := 0;
  v_pct numeric; v_net numeric; v_direct numeric; v_org_part numeric;
  v_from text; v_to text; v_amount numeric;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  -- Normalisé à la lecture : un avenant écrit ses règles brutes sur la soirée.
  v_rules := public.normalize_collab_settlement(e.revenue_split_rules);
  IF v_rules IS NULL OR public.collab_settlement_mode(v_rules) <> 'transfer' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_transfer_mode');
  END IF;
  v_venue := COALESCE(e.venue_id, e.partner_venue_id);
  v_org := COALESCE(e.organizer_user_id, e.partner_organizer_id);
  IF v_venue IS NULL OR v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_a_collab'); END IF;
  v_collector := public.collab_settlement_collector(v_rules);
  v_venue_key := 'venue:' || v_venue; v_org_key := 'org:' || v_org::text;
  v_collector_key := CASE v_collector WHEN 'organizer' THEN v_org_key ELSE v_venue_key END;
  v_tbl_basis := COALESCE(v_rules->'tables'->>'basis', 'deposit');

  -- Billets
  FOR r IN
    SELECT t.total_price, t.service_fee, t.insurance_fee, t.refund_amount, t.collab_split
      FROM public.tickets t
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
  LOOP
    v_net := GREATEST(COALESCE(r.total_price, 0) - COALESCE(r.service_fee, 0) - COALESCE(r.insurance_fee, 0), 0);
    v_net := v_net - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0), v_net)
             - CASE WHEN COALESCE(r.total_price, 0) > 0 THEN round(r.total_price * 0.015 + 0.25, 2) ELSE 0 END;
    v_net := GREATEST(v_net, 0);
    v_direct := LEAST(GREATEST(COALESCE((r.collab_split->>'venue_direct')::numeric, 0), 0), v_net);
    v_pct := COALESCE((r.collab_split->>'organizer_pct')::numeric,
                      public.collab_rules_org_pct(v_rules, 'tickets', e.event_mode::text));
    v_org_part := round((v_net - v_direct) * v_pct / 100, 2);
    v_t_n := v_t_n + 1; v_t_net := v_t_net + v_net; v_t_org := v_t_org + v_org_part;
  END LOOP;

  -- Tables (acompte en ligne)
  IF v_tbl_basis <> 'total_spend' THEN
    FOR r IN
      SELECT tr.deposit, tr.service_fee, tr.management_fee, tr.fee_absorbed, tr.refund_amount, tr.collab_split
        FROM public.table_reservations tr
       WHERE tr.event_id = p_event_id AND tr.status IN ('paid', 'confirmed')
         AND COALESCE(tr.payment_mode, 'online') = 'online'
    LOOP
      v_net := GREATEST(COALESCE(r.deposit, 0) - COALESCE(r.service_fee, 0)
                        - CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END, 0);
      v_net := v_net - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0), v_net)
               - CASE WHEN COALESCE(r.deposit, 0) > 0
                      THEN round((r.deposit + CASE WHEN COALESCE(r.fee_absorbed, false) THEN 0 ELSE COALESCE(r.management_fee, 0) END) * 0.015 + 0.25, 2)
                      ELSE 0 END;
      v_net := GREATEST(v_net, 0);
      v_pct := COALESCE((r.collab_split->>'organizer_pct')::numeric,
                        public.collab_rules_org_pct(v_rules, 'tables', e.event_mode::text));
      v_org_part := round(v_net * v_pct / 100, 2);
      v_b_n := v_b_n + 1; v_b_net := v_b_net + v_net; v_b_org := v_b_org + v_org_part;
    END LOOP;
  END IF;

  -- Boissons via Yuno : toujours encaissées par le club ; part orga seulement si
  -- le contrat lui en donne une (licence alcool attestée).
  v_pct := public.collab_rules_org_pct(v_rules, 'drinks', e.event_mode::text);
  IF v_pct > 0 THEN
    FOR r IN
      SELECT o.total, o.service_fee, o.refund_amount FROM public.orders o
       WHERE o.event_id = p_event_id AND o.status IN ('paid', 'served')
    LOOP
      v_net := GREATEST(COALESCE(r.total, 0) - COALESCE(r.service_fee, 0), 0);
      v_net := GREATEST(v_net - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0), v_net)
               - CASE WHEN COALESCE(r.total, 0) > 0 THEN round(r.total * 0.015 + 0.25, 2) ELSE 0 END, 0);
      v_d_n := v_d_n + 1; v_d_net := v_d_net + v_net; v_d_org := v_d_org + round(v_net * v_pct / 100, 2);
    END LOOP;
  END IF;

  IF v_collector = 'venue' THEN
    v_org_owed_by_collector := v_t_org + v_b_org;
  ELSE
    v_venue_owed_by_collector := (v_t_net - v_t_org) + (v_b_net - v_b_org);
  END IF;
  v_org_owed_by_venue_drinks := v_d_org;

  -- Solde net : qui doit combien à qui.
  v_amount := (v_org_owed_by_collector + v_org_owed_by_venue_drinks) - v_venue_owed_by_collector;
  IF v_amount >= 0 THEN v_from := v_venue_key; v_to := v_org_key;
  ELSE v_from := v_org_key; v_to := v_venue_key; v_amount := -v_amount; END IF;
  v_amount := round(v_amount, 2);

  RETURN jsonb_build_object(
    'ok', true,
    'collector', v_collector, 'collector_key', v_collector_key,
    'venue_key', v_venue_key, 'org_key', v_org_key,
    'payment_terms_days', COALESCE((v_rules->'settlement'->>'payment_terms_days')::int, 15),
    'tables_basis', v_tbl_basis,
    'pillars', jsonb_build_object(
      'tickets', jsonb_build_object('count', v_t_n, 'net', round(v_t_net, 2), 'organizer', round(v_t_org, 2), 'venue', round(v_t_net - v_t_org, 2)),
      'tables',  jsonb_build_object('count', v_b_n, 'net', round(v_b_net, 2), 'organizer', round(v_b_org, 2), 'venue', round(v_b_net - v_b_org, 2)),
      'drinks',  jsonb_build_object('count', v_d_n, 'net', round(v_d_net, 2), 'organizer', round(v_d_org, 2), 'venue', round(v_d_net - v_d_org, 2))),
    'organizer_total', round(v_t_org + v_b_org + v_d_org, 2),
    'venue_total', round((v_t_net - v_t_org) + (v_b_net - v_b_org) + (v_d_net - v_d_org), 2),
    'transfer', CASE WHEN v_amount >= 0.01 THEN jsonb_build_object('from', v_from, 'to', v_to, 'amount', v_amount) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._collab_transfer_compute(uuid) FROM PUBLIC, anon, authenticated;
