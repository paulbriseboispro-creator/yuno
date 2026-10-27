-- MCP `get_web_traffic` d'un compte Yuno Tickets : les visites en personnes
-- (plan Trafic, lot T5). L'outil lit `tix_ana_visits` (migration
-- 20261110100000), la lecture de l'onglet Trafic : visites, visiteurs, temps
-- passé (médianes), défilement, sources, tunnel, heures, appareils, villes,
-- soirées, liens suivis. L'argent par source reste dans Ventes
-- (get_sales_overview).
--
-- `_mcp_tool` est une fonction de ~47 000 caractères que d'autres chantiers
-- réécrivent aussi (la branche Yuno CRM du même outil, notamment) : ce fichier
-- ne la recopie PAS. Il relit la définition vivante et n'y remplace que la
-- branche Billetterie de `get_web_traffic`, entre deux repères exacts ; si un
-- repère manque, la migration échoue au lieu d'écrire à l'aveugle.
DO $mig$
DECLARE
  d text;
  a int; b int; s int; e int;
  v_head text; v_tail text; v_branch text;
  v_new text := $new$v_when := public._mcp_crm_period(p_args, 30);
    RETURN jsonb_build_object('ok', true, 'source', 'yuno', 'period', v_when,
      'visits', public.tix_ana_visits(v_venue, v_org, v_when, NULL, NULL),
      'note', 'Yuno Tickets account: visits to the public page and the event pages, counted in people (visits, unique visitors, median time on page, scroll, funnel from a glance to a purchase). Revenue by source is in get_sales_overview.');$new$;
BEGIN
  SELECT pg_get_functiondef('public._mcp_tool(text,text,text,text,text,jsonb,text)'::regprocedure) INTO d;
  a := position('WHEN ''get_web_traffic'' THEN' IN d);
  b := position('WHEN ''count_contacts'' THEN' IN d);
  IF a = 0 OR b = 0 OR b < a THEN RAISE EXCEPTION 'mcp_tool_markers_missing'; END IF;
  v_branch := substr(d, a, b - a);
  -- Déjà réécrite (migration rejouée) : rien à faire.
  IF position('tix_ana_visits' IN v_branch) > 0 THEN RETURN; END IF;
  s := position('SELECT * INTO w FROM public._mcp_window(p_args, 30);' IN v_branch);
  e := position('RETURN v_out;' IN v_branch);
  IF s = 0 OR e = 0 OR e < s THEN RAISE EXCEPTION 'mcp_tool_web_traffic_suite_missing'; END IF;
  v_head := substr(d, 1, a - 1) || substr(v_branch, 1, s - 1);
  v_tail := substr(v_branch, e + length('RETURN v_out;')) || substr(d, b);
  EXECUTE v_head || v_new || v_tail;
END
$mig$;
