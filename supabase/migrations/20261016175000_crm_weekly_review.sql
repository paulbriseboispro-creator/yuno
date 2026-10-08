-- ============================================================================
-- Yuno CRM — le « Bilan de la semaine » (agents, lot A3, 2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md § 7 (décisions 5 à 8 du 08/10).
--
-- Calculé à la LECTURE, en SQL, sans IA (décision 6) : la semaine écoulée
-- (lundi → dimanche, heure de Paris) d'un compte Yuno CRM.
--   • activité : e-mails et SMS envoyés, messages des scénarios et des recettes ;
--   • mesuré par le témoin : chaque envoi dont la soirée a eu lieu cette semaine
--     (crm_holdout_overview) et chaque scénario au verdict net
--     (_crm_scenario_holdout) — « ≈ N acheteurs en plus » seulement quand
--     l'écart est net (z ≥ 2), « moins d'achats » quand il l'est dans l'autre
--     sens, rien sinon ;
--   • ce qui dérive : rythme de la prochaine soirée contre l'édition précédente
--     au même moment, délivrabilité (bounces, plaintes), part protégée par les
--     règles d'envoi, écart du journal prévu / réel ;
--   • 1 à 3 actions, chacune avec l'écran qui la prépare.
-- Des agrégats seulement, jamais une personne ni un montant. Aucune écriture :
-- une lecture ordinaire (pas de table temporaire, aperçu démo compris).
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key      text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_to       timestamptz := (date_trunc('week', now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris';
  v_from     timestamptz := v_to - interval '7 days';
  v_mail     record;
  v_sms      record;
  v_scn_msgs integer;
  v_recipes  integer;
  v_hold     jsonb;
  v_measured jsonb;
  v_scns     jsonb;
  v_drift    jsonb := '[]'::jsonb;
  v_actions  jsonb := '[]'::jsonb;
  v_next     record;
  v_prev     record;
  v_sold     integer;
  v_same     integer;
  v_j        record;
  v_active   integer;
  v_recipes_on integer;
  v_loss     jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ── Activité de la semaine ────────────────────────────────────────────────
  SELECT count(*)::int AS campaigns,
         COALESCE(sum(COALESCE(c.recipients_count, c.total_recipients, 0)), 0)::int AS sent,
         COALESCE(sum(COALESCE(c.bounced_count, 0)), 0)::int AS bounced,
         COALESCE(sum(COALESCE(c.complained_count, 0)), 0)::int AS complained,
         COALESCE(sum(COALESCE(c.policy_skipped_count, 0)), 0)::int AS protected
    INTO v_mail
    FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)
     AND c.sent_at >= v_from AND c.sent_at < v_to AND c.status IN ('sent', 'sending')
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL AND c.child_kind IS NULL
     AND public.crm_campaign_is_crm(c.id);
  SELECT count(*)::int AS campaigns, COALESCE(sum(COALESCE(c.sent_count, 0)), 0)::int AS sent
    INTO v_sms
    FROM public.sms_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR c.organizer_id = p_organizer_user_id)
     AND c.sent_at >= v_from AND c.sent_at < v_to;
  SELECT count(*)::int INTO v_scn_msgs
    FROM public.crm_scenario_steps st JOIN public.crm_scenarios s ON s.id = st.scenario_id
   WHERE s.scope_key = v_key AND st.status = 'sent' AND st.done_at >= v_from AND st.done_at < v_to;
  SELECT count(*)::int INTO v_recipes
    FROM public.email_automation_sends l
   WHERE l.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR l.organizer_user_id = p_organizer_user_id)
     AND l.status = 'queued' AND l.created_at >= v_from AND l.created_at < v_to;

  -- ── Mesuré par le témoin ──────────────────────────────────────────────────
  -- Les envois dont la soirée a eu lieu cette semaine, avec une mesure (10
  -- personnes au moins de chaque côté).
  v_hold := public.crm_holdout_overview(p_venue_id, p_organizer_user_id, 60);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'channel', x->>'channel', 'id', x->>'id', 'label', x->>'label', 'event_id', x->>'event_id', 'event', e.title,
           'contacted', x->'contacted', 'control', x->'control', 'extra', x->'extra', 'z', x->'z',
           'verdict', CASE WHEN (x->>'z')::numeric >= 2 THEN 'gain' WHEN (x->>'z')::numeric <= -2 THEN 'loss' ELSE 'none' END)
           ORDER BY COALESCE((x->>'z')::numeric, 0) DESC), '[]'::jsonb)
    INTO v_measured
    FROM jsonb_array_elements(v_hold->'sends') x
    JOIN public.events e ON e.id = (x->>'event_id')::uuid
   WHERE x->>'event_id' IS NOT NULL AND x->'extra' IS NOT NULL AND jsonb_typeof(x->'extra') = 'number'
     AND e.start_at >= v_from AND e.start_at < v_to;
  -- Les scénarios en ligne ou en pause au verdict net (mesure cumulée).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'measure', m.j,
           'verdict', CASE WHEN (m.j->>'z')::numeric >= 2 THEN 'gain' ELSE 'loss' END)
           ORDER BY (m.j->>'z')::numeric DESC), '[]'::jsonb)
    INTO v_scns
    FROM public.crm_scenarios s
    CROSS JOIN LATERAL (SELECT public._crm_scenario_holdout(s.id) AS j) m
   WHERE s.scope_key = v_key AND s.status IN ('active', 'paused')
     AND COALESCE((m.j->>'done')::boolean, false) AND jsonb_typeof(m.j->'z') = 'number'
     AND abs((m.j->>'z')::numeric) >= 2;

  -- ── Ce qui dérive ─────────────────────────────────────────────────────────
  -- Rythme : la prochaine soirée (21 jours) contre l'édition précédente au même moment.
  SELECT ev.id, ev.title, ev.start_at INTO v_next FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
   ORDER BY ev.start_at LIMIT 1;
  IF v_next.id IS NOT NULL THEN
    SELECT ev.id, ev.title, ev.start_at INTO v_prev FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> v_next.id AND ev.start_at < now()
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
     ORDER BY (lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(v_next.title))) DESC, ev.start_at DESC
     LIMIT 1;
    SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_sold FROM public.external_tickets t
     WHERE t.event_id = v_next.id AND public._crm_ticket_is_sale(t.status, t.raw);
    IF v_prev.id IS NOT NULL THEN
      SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_same FROM public.external_tickets t
       WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.raw)
         AND COALESCE(t.purchased_at, t.first_seen_at) <= v_prev.start_at - (v_next.start_at - now());
      IF v_same >= 20 AND v_sold < 0.85 * v_same THEN
        v_drift := v_drift || jsonb_build_object('kind', 'pace', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at,
          'sold', v_sold, 'prev_title', v_prev.title, 'prev_sold', v_same);
      END IF;
    END IF;
  END IF;
  -- Délivrabilité de la semaine (200 envois au moins pour juger).
  IF v_mail.sent >= 200 AND (v_mail.bounced > 0.03 * v_mail.sent OR v_mail.complained > 0.001 * v_mail.sent) THEN
    v_drift := v_drift || jsonb_build_object('kind', 'deliverability', 'sent', v_mail.sent, 'bounced', v_mail.bounced, 'complained', v_mail.complained);
  END IF;
  -- Une part grandissante de la base protégée par les règles d'envoi (fatigue, pression).
  IF v_mail.sent + v_mail.protected >= 200 AND v_mail.protected > 0.15 * (v_mail.sent + v_mail.protected) THEN
    v_drift := v_drift || jsonb_build_object('kind', 'protected', 'protected', v_mail.protected, 'reached', v_mail.sent);
  END IF;
  -- Journal prévu / réel : la dernière soirée réglée cette semaine, écart > 15 %.
  SELECT r.title, r.start_at, (r.metrics->'projection'->>'predicted')::numeric AS predicted,
         (r.metrics->'projection'->>'actual')::numeric AS actual, (r.metrics->'projection'->>'err')::numeric AS err
    INTO v_j
    FROM public.crm_prediction_results r
   WHERE r.scope_key = v_key AND r.horizon = 'd7' AND r.settled_at >= v_from AND r.settled_at < v_to
     AND r.metrics->'projection'->>'err' IS NOT NULL
   ORDER BY r.start_at DESC LIMIT 1;
  IF v_j.title IS NOT NULL AND v_j.err > 0.15 THEN
    v_drift := v_drift || jsonb_build_object('kind', 'journal', 'title', v_j.title, 'start_at', v_j.start_at,
      'predicted', round(v_j.predicted), 'actual', round(v_j.actual), 'err_pct', round(v_j.err * 100));
  END IF;

  -- ── 1 à 3 actions, chacune avec l'écran qui la prépare ───────────────────
  SELECT count(*) FILTER (WHERE s.status = 'active')::int INTO v_active FROM public.crm_scenarios s WHERE s.scope_key = v_key;
  SELECT count(*)::int INTO v_recipes_on FROM public.email_automations a
   WHERE a.enabled AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND (p_venue_id IS NOT NULL OR a.organizer_user_id = p_organizer_user_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_drift) d WHERE d->>'kind' = 'pace') THEN
    v_actions := v_actions || jsonb_build_object('kind', 'targets', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at);
  END IF;
  IF v_next.id IS NOT NULL AND v_next.start_at < now() + interval '14 days' THEN
    v_actions := v_actions || jsonb_build_object('kind', 'plan', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at);
  END IF;
  SELECT x INTO v_loss FROM jsonb_array_elements(v_scns) x WHERE x->>'verdict' = 'loss' LIMIT 1;
  IF v_loss IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('kind', 'scenario', 'id', v_loss->>'id', 'name', v_loss->>'name');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_drift) d WHERE d->>'kind' IN ('deliverability', 'protected')) THEN
    v_actions := v_actions || jsonb_build_object('kind', 'base');
  END IF;
  IF v_active = 0 AND v_recipes_on = 0 THEN
    v_actions := v_actions || jsonb_build_object('kind', 'automate');
  END IF;
  SELECT COALESCE(jsonb_agg(a ORDER BY o), '[]'::jsonb) INTO v_actions
    FROM jsonb_array_elements(v_actions) WITH ORDINALITY AS z(a, o) WHERE o <= 3;

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_from, 'to', v_to - interval '1 second',
    'activity', jsonb_build_object('emails', v_mail.sent, 'email_campaigns', v_mail.campaigns, 'sms', v_sms.sent, 'sms_campaigns', v_sms.campaigns,
                                   'scenario_messages', v_scn_msgs, 'recipe_messages', v_recipes, 'protected', v_mail.protected),
    'measured', v_measured,
    'scenarios', v_scns,
    'drift', v_drift,
    'actions', v_actions,
    'holdout_pct', v_hold->'pct',
    'quiet', v_mail.sent + v_sms.sent + v_scn_msgs + v_recipes = 0 AND jsonb_array_length(v_measured) = 0 AND v_next.id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_weekly_review(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_weekly_review(text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
