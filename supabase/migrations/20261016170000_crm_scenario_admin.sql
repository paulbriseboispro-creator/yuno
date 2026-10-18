-- ============================================================================
-- Yuno CRM — Scénarios, lot J5 : l'Admin CRM (2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md.
--
-- crm_admin_scenarios : Admin CRM › Plateforme › Scénarios. Par compte (la
-- ligne de compte unique `_crm_admin_rows`, démo exclue sauf demande) :
-- scénarios en ligne / en pause / brouillons, personnes en route, entrées et
-- messages des 7 derniers jours, messages reportés MAINTENANT et leur raison
-- principale (Yunits, identité SMS, gel…), expirés, et les scénarios en ligne
-- dont la version publiée ne passerait plus les contrôles de contenu (modèle
-- d'e-mail supprimé, soirée passée, identité SMS retirée…). Des agrégats :
-- jamais une personne.
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.crm_admin_scenarios(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_ids  text[];
  v_acc  jsonb;
  v_tot  jsonb;
  v_held jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT coalesce(array_agg(r->>'id'), '{}') INTO v_ids FROM jsonb_array_elements(v_rows) r;

  WITH sc AS (
    SELECT s.* FROM public.crm_scenarios s WHERE s.scope_key = ANY (v_ids)
  ), st AS (
    SELECT st.scenario_id, st.status, st.reason, st.created_at, st.done_at
      FROM public.crm_scenario_steps st JOIN sc ON sc.id = st.scenario_id
     WHERE st.created_at > now() - interval '30 days'
  ), runs AS (
    SELECT r.scenario_id, r.status, r.entered_at FROM public.crm_scenario_runs r JOIN sc ON sc.id = r.scenario_id
  ), per AS (
    SELECT sc.scope_key,
           count(*) FILTER (WHERE sc.status = 'active') AS active,
           count(*) FILTER (WHERE sc.status = 'paused') AS paused,
           count(*) FILTER (WHERE sc.status = 'draft') AS drafts,
           count(*) FILTER (WHERE sc.ai_author IS NOT NULL) AS by_ai,
           -- Version en ligne qui ne passerait plus les contrôles de contenu.
           count(*) FILTER (WHERE sc.status = 'active' AND EXISTS (
             SELECT 1 FROM public.crm_scenario_versions v
              WHERE v.id = sc.live_version_id
                AND jsonb_array_length(public._crm_scenario_content(sc.venue_id, sc.organizer_user_id, v.graph)->'errors') > 0)) AS broken,
           max(sc.updated_at) AS last_change
      FROM sc GROUP BY sc.scope_key
  ), act AS (
    SELECT sc.scope_key,
           count(*) FILTER (WHERE runs.status = 'active') AS on_their_way,
           count(*) FILTER (WHERE runs.entered_at > now() - interval '7 days') AS entered7
      FROM runs JOIN sc ON sc.id = runs.scenario_id GROUP BY sc.scope_key
  ), msg AS (
    SELECT sc.scope_key,
           count(*) FILTER (WHERE st.status = 'sent' AND st.done_at > now() - interval '7 days') AS sent7,
           count(*) FILTER (WHERE st.status = 'would_send' AND st.done_at > now() - interval '7 days') AS would7,
           count(*) FILTER (WHERE st.status = 'expired' AND st.done_at > now() - interval '7 days') AS expired7,
           count(*) FILTER (WHERE st.status = 'held') AS held_now,
           (SELECT x.reason FROM st x JOIN public.crm_scenarios y ON y.id = x.scenario_id
             WHERE y.scope_key = sc.scope_key AND x.status = 'held' AND x.reason IS NOT NULL AND x.reason <> 'queued'
             GROUP BY x.reason ORDER BY count(*) DESC LIMIT 1) AS held_reason
      FROM st JOIN sc ON sc.id = st.scenario_id GROUP BY sc.scope_key
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r->>'id', 'name', r->>'name', 'city', r->>'city', 'kind', r->>'kind',
           'state', CASE WHEN EXISTS (SELECT 1 FROM public.crm_settings cs WHERE cs.scope_key = r->>'id' AND cs.sending_frozen_at IS NOT NULL) THEN 'frozen'
                         WHEN public.crm_effective_plan(r->>'id') = 'paused' THEN 'plan_paused' ELSE 'ok' END,
           'active', per.active, 'paused', per.paused, 'drafts', per.drafts, 'by_ai', per.by_ai, 'broken', per.broken,
           'on_their_way', coalesce(act.on_their_way, 0), 'entered7', coalesce(act.entered7, 0),
           'sent7', coalesce(msg.sent7, 0), 'would_send7', coalesce(msg.would7, 0), 'expired7', coalesce(msg.expired7, 0),
           'held_now', coalesce(msg.held_now, 0), 'held_reason', msg.held_reason, 'last_change', per.last_change)
         ORDER BY per.broken DESC, coalesce(msg.held_now, 0) DESC, per.active DESC, r->>'name'), '[]'::jsonb)
    INTO v_acc
    FROM jsonb_array_elements(v_rows) r
    JOIN per ON per.scope_key = r->>'id'
    LEFT JOIN act ON act.scope_key = r->>'id'
    LEFT JOIN msg ON msg.scope_key = r->>'id';

  SELECT jsonb_build_object(
           'accounts', count(*) FILTER (WHERE (x->>'active')::int > 0),
           'active', coalesce(sum((x->>'active')::int), 0), 'paused', coalesce(sum((x->>'paused')::int), 0),
           'drafts', coalesce(sum((x->>'drafts')::int), 0), 'by_ai', coalesce(sum((x->>'by_ai')::int), 0),
           'broken', coalesce(sum((x->>'broken')::int), 0), 'on_their_way', coalesce(sum((x->>'on_their_way')::int), 0),
           'entered7', coalesce(sum((x->>'entered7')::int), 0), 'sent7', coalesce(sum((x->>'sent7')::int), 0),
           'expired7', coalesce(sum((x->>'expired7')::int), 0), 'held_now', coalesce(sum((x->>'held_now')::int), 0))
    INTO v_tot FROM jsonb_array_elements(v_acc) x;

  -- Ce qui retient les messages en ce moment, toutes raisons (tous comptes).
  SELECT coalesce(jsonb_object_agg(z.reason, z.n), '{}'::jsonb) INTO v_held
    FROM (SELECT coalesce(st.reason, 'other') AS reason, count(*) AS n
            FROM public.crm_scenario_steps st JOIN public.crm_scenarios s ON s.id = st.scenario_id
           WHERE s.scope_key = ANY (v_ids) AND st.status = 'held' AND coalesce(st.reason, '') <> 'queued'
           GROUP BY 1) z;

  RETURN jsonb_build_object('at', now(), 'totals', v_tot, 'held', v_held, 'accounts', v_acc);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_admin_scenarios(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_scenarios(boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
