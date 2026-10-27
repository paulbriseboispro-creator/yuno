-- Yuno CRM › Trafic, lot C6 (TRAFFIC_TAB_PLAN.md, 27/10) : l'outil MCP
-- get_web_traffic d'un compte CRM rend aussi les CLICS (crm_ana_clicks : liens
-- /go/, e-mails, pages /j/, en personnes), à côté de l'attribution des ventes
-- (`traffic`, crm_ana_traffic, inchangée).
--
-- `_mcp_tool` est partagée avec d'autres chantiers (la Billetterie repointe la
-- même outil côté Yuno Tickets) : on ne la recopie PAS, on remplace UNE ligne
-- de la branche CRM dans la définition vivante. L'ordre d'application avec une
-- autre migration qui touche une autre branche ne compte donc pas. Si la ligne
-- n'est plus là (fonction réécrite), la migration échoue au lieu de deviner.
DO $mig$
DECLARE
  v_def text;
  v_old text := $o$        'traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL),
        'note', 'Yuno CRM account: where ticket buyers came from (utm_source reported by the ticketing, Yuno links /go/, signup pages). Page visits on the ticketing site are not reported by Shotgun.');$o$;
  v_new text := $n$        'traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL),
        'clicks', public._mcp_crm_clicks(v_venue, v_org, v_when),
        'note', 'Yuno CRM account. traffic = where ticket buyers came from (utm_source reported by the ticketing, Yuno links /go/, signup pages), with revenue. clicks = what goes through Yuno, in people (one visitor, one day, one link): clicks on Yuno links and CRM e-mails, signup page visits, hours, devices, countries, purchase platform, click to order. Page visits on the ticketing site are not reported by Shotgun.');$n$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_mcp_tool';
  IF v_def IS NULL THEN RAISE EXCEPTION '_mcp_tool introuvable'; END IF;
  IF position(v_new IN v_def) > 0 THEN RETURN; END IF;  -- déjà appliquée
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_web_traffic (CRM) : la ligne attendue n''est plus dans _mcp_tool, migration à reprendre';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $mig$;

-- Une brique qui échoue ne fait pas tomber l'outil (règle des outils composites).
CREATE OR REPLACE FUNCTION public._mcp_crm_clicks(p_venue_id text, p_organizer_user_id uuid, p_period text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r jsonb;
BEGIN
  r := public.crm_ana_clicks(p_venue_id, p_organizer_user_id, p_period, NULL, NULL);
  -- L'IA lit des agrégats : on retire la série case par case (le graphique).
  RETURN r - 'series' - 'heat';
EXCEPTION WHEN others THEN
  RETURN public._mcp_unavailable(SQLSTATE, SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public._mcp_crm_clicks(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mcp_crm_clicks(text, uuid, text) TO service_role;
