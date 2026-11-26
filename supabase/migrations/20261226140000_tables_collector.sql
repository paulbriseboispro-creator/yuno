-- Tables VIP, vague C1 — P2.9 (D9) QUI encaisse les tables d'une soirée, selon le contrat.
--
-- Le bandeau « paiements prêts » de l'atelier (vague B) ne lisait que « club hôte / organisateur ». Sur une soirée d'organisateur
-- chez un club Yuno dont les tables sont celles du club (« réglé entre vous », tables 100 % club), c'est le CLUB qui encaisse les
-- acomptes (charge directe sur SON compte Connect) : lui seul a besoin d'un compte Stripe actif pour les tables, pas l'organisateur.
--
-- `get_event_tables_collector(event)` rend la même décision que `resolvePaymentSplit` (edge, pilier `table`) :
--   • soirée solo : le club hôte, sinon l'organisateur ;
--   • co-soirée : les règles de la soirée (`revenue_split_rules`) — contrat réglé par virement : l'encaisseur du contrat ; barème :
--     le club ; sinon la part de l'organisateur sur les tables (0 → club, 100 → organisateur, entre les deux → partage Stripe) ;
--   • blocages : `no_contract` (co-soirée sans contrat signé : rien ne se vend), `pillar_disabled` (pilier sorti du contrat, quel que soit le pilier demandé),
--     `stripe_split_unavailable` (partage Stripe ou barème retenu : charges indirectes éteintes, miroir de charge-policy.ts).
-- `event_pillar_payments_ready(event, 'tables' | 'tickets')` : la porte « paiements prêts » PAR PILIER (celle de `event_payments_ready`
-- exige les deux piliers : tables au club + billets à l'organisateur sans Stripe cachaient les tables, que le checkout vendait).

-- Miroir SQL de STRIPE_INDIRECT_CHARGES_ENABLED (_shared/charge-policy.ts) : à changer ENSEMBLE.
CREATE OR REPLACE FUNCTION public._stripe_indirect_charges_enabled()
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$ SELECT false $$;

-- Cœur : décision d'encaissement d'un pilier (sans droits : appelé par les deux fonctions publiques ci-dessous).
CREATE OR REPLACE FUNCTION public._event_pillar_collector(p_event_id uuid, p_pillar text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e record;
  v_venue text; v_org uuid;
  v_rules jsonb;
  v_co boolean;
  v_mode text; v_collector text; v_blocked text; v_pct numeric; v_agreement text;
  v_vok boolean := false; v_ook boolean := false;
  v_ready boolean; v_ready_party text;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_venue := COALESCE(e.venue_id, e.partner_venue_id);
  v_org := COALESCE(e.organizer_user_id, e.partner_organizer_id);

  SELECT v.stripe_account_id IS NOT NULL AND v.stripe_account_id NOT LIKE 'acct\_demo%' AND COALESCE(v.stripe_charges_enabled, false)
    INTO v_vok FROM public.venues v WHERE v.id = v_venue;
  SELECT pr.stripe_connect_account_id IS NOT NULL AND pr.stripe_connect_account_id NOT LIKE 'acct\_demo%' AND COALESCE(pr.stripe_connect_charges_enabled, false)
    INTO v_ook FROM public.profiles pr WHERE pr.id = v_org;
  v_vok := COALESCE(v_vok, false); v_ook := COALESCE(v_ook, false);

  -- Même définition qu'isCoEvent côté edge.
  v_co := e.event_mode::text IN ('co_event', 'venue_rental', 'org_hosted')
       OR (e.venue_id IS NOT NULL AND e.partner_organizer_id IS NOT NULL)
       OR (e.organizer_user_id IS NOT NULL AND e.partner_venue_id IS NOT NULL);
  v_rules := e.revenue_split_rules;
  v_agreement := CASE WHEN public.collab_agreement_is_external(v_rules) THEN 'external' WHEN v_co THEN 'yuno' END;

  IF NOT v_co THEN
    v_mode := 'solo';
    v_collector := CASE WHEN e.venue_id IS NOT NULL THEN 'venue' WHEN e.organizer_user_id IS NOT NULL THEN 'organizer' END;
    v_pct := CASE v_collector WHEN 'organizer' THEN 100 ELSE 0 END;
  ELSIF v_rules IS NULL THEN
    v_mode := 'contract'; v_blocked := 'no_contract';
    v_collector := NULL; v_pct := NULL;
  ELSIF NOT public.split_pillar_enabled(v_rules, p_pillar) THEN
    v_mode := 'contract'; v_blocked := 'pillar_disabled';
    v_collector := NULL; v_pct := NULL;
  ELSIF public.collab_settlement_mode(v_rules) = 'transfer' THEN
    v_mode := 'transfer';
    v_collector := public.collab_settlement_collector(v_rules);
    v_pct := public.collab_rules_org_pct(v_rules, p_pillar, e.event_mode::text);
  ELSIF public.is_tiered_collab(v_rules) THEN
    v_mode := 'tiered'; v_collector := 'venue'; v_pct := 0;
    IF NOT public._stripe_indirect_charges_enabled() THEN v_blocked := 'stripe_split_unavailable'; END IF;
  ELSE
    v_pct := public.collab_rules_org_pct(v_rules, p_pillar, e.event_mode::text);
    IF v_pct <= 0 THEN v_mode := 'direct'; v_collector := 'venue';
    ELSIF v_pct >= 100 THEN v_mode := 'direct'; v_collector := 'organizer';
    ELSE
      v_mode := 'stripe_split'; v_collector := 'both';
      IF NOT public._stripe_indirect_charges_enabled() THEN v_blocked := 'stripe_split_unavailable'; END IF;
    END IF;
  END IF;

  -- « Prêt » = le compte que la charge utilisera encaisse (le seul requis, jamais l'autre partie).
  IF v_collector = 'venue' THEN v_ready := v_vok; v_ready_party := CASE WHEN v_vok THEN NULL ELSE 'venue' END;
  ELSIF v_collector = 'organizer' THEN v_ready := v_ook; v_ready_party := CASE WHEN v_ook THEN NULL ELSE 'organizer' END;
  ELSIF v_collector = 'both' THEN v_ready := v_vok AND v_ook; v_ready_party := CASE WHEN NOT v_vok THEN 'venue' WHEN NOT v_ook THEN 'organizer' END;
  ELSE v_ready := false; v_ready_party := NULL;
  END IF;

  RETURN jsonb_build_object(
    'pillar', p_pillar,
    'collector', v_collector,
    'mode', v_mode,
    'agreement', v_agreement,
    'blocked', v_blocked,
    'organizer_pct', v_pct,
    'ready', COALESCE(v_ready, false) AND v_blocked IS NULL,
    'ready_party', v_ready_party,
    'venue_id', v_venue,
    'organizer_user_id', v_org,
    'venue_name', (SELECT v.name FROM public.venues v WHERE v.id = v_venue),
    'organizer_name', (SELECT COALESCE(NULLIF(o.display_name, ''), NULLIF(o.legal_name, '')) FROM public.organizer_profiles o WHERE o.user_id = v_org)
  );
END;
$$;

-- Pour l'atelier : qui encaisse les tables de cette soirée (gestion des tables de la soirée, ou super admin).
CREATE OR REPLACE FUNCTION public.get_event_tables_collector(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_event_vip_tables(auth.uid(), p_event_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public._event_pillar_collector(p_event_id, 'tables');
END;
$$;

-- Porte publique par pilier (page de la soirée, checkout) : un booléen, rien de plus.
CREATE OR REPLACE FUNCTION public.event_pillar_payments_ready(p_event_id uuid, p_pillar text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_pillar IN ('tables', 'tickets')
              THEN COALESCE((public._event_pillar_collector(p_event_id, CASE p_pillar WHEN 'tickets' THEN 'tickets' ELSE 'tables' END)->>'ready')::boolean, false)
              ELSE false END;
$$;

REVOKE ALL ON FUNCTION public._stripe_indirect_charges_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._event_pillar_collector(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_event_tables_collector(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.event_pillar_payments_ready(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._stripe_indirect_charges_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public._event_pillar_collector(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_tables_collector(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.event_pillar_payments_ready(uuid, text) TO anon, authenticated, service_role;
