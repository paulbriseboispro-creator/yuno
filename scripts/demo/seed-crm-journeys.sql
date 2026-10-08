-- ============================================================================
-- Démo Yuno CRM — les Scénarios (crm@womber.fr). Plan : docs/designs/
-- CRM_JOURNEYS_PLAN.md. À jouer APRÈS seed-crm-demo.sql (soirées, billets),
-- seed-crm-automations (modèles des recettes) et seed-crm-extras.sql.
-- Rejouable : efface les scénarios du compte démo (tout suit en cascade) et
-- les modèles d'e-mail qu'il a posés (theme_json.seed = 'crm-journeys'), puis
-- recrée :
--   • « Fidèles sans place : J-10, J-3, J-1 » EN LIGNE, avec son historique sur
--     les soirées du dernier mois et des personnes en route pour les suivantes ;
--   • « Acheteurs absents → prochaine soirée » EN LIGNE, dont le SMS des
--     dernières entrées est RETENU faute de Yunits (l'attente avant le SMS, de 1
--     à 5 jours, est réglée sur le calendrier pour que ce SMS soit dû au semis) ;
--   • « Reconquête en 2 temps » EN PAUSE (des personnes attendent la reprise) ;
--   • « Invités en guest list → payants » en BROUILLON.
-- Les chiffres rejouent le moteur sur les vraies soirées et les vrais billets de
-- la démo : entrée (habitués sans place à J-10, acheteurs non scannés quand la
-- porte a scanné, absents depuis 120 jours), étapes, objectif (un achat après
-- l'entrée), témoin. La démo n'envoie jamais rien : les messages sont
-- « would_send », comme ceux du moteur pour un compte démo. Aucune donnée réelle.
--   supabase db query --linked -f scripts/demo/seed-crm-journeys.sql
-- ============================================================================

DO $seed$
DECLARE
  v_uid   uuid;
  v_key   text;
  v_conn  uuid;
  v_hp    numeric;
  v_tpl   jsonb := '{}'::jsonb;
  v_c     record;
  v_id    uuid;
  v_g     jsonb;
  v_scn   uuid;
  v_ver   uuid;
  v_pub   timestamptz;
  v_pause timestamptz;
  v_n     integer;
  v_last  timestamptz;
  v_days  integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM setseed(0.41);

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'crm@womber.fr';
  IF v_uid IS NULL THEN RAISE EXCEPTION 'crm@womber.fr absent : lancer create-crm-account.mjs'; END IF;
  -- Garde : ce semis n'écrit QUE dans un compte démo.
  IF NOT public.is_demo_marketing_scope(NULL, v_uid) THEN RAISE EXCEPTION 'crm@womber.fr n''est pas reconnu comme démo : arrêt'; END IF;
  v_key := public.crm_scope_key(NULL, v_uid);
  SELECT id INTO v_conn FROM public.ticketing_connections
   WHERE organizer_user_id = v_uid AND provider = 'shotgun' AND external_org_id = 'demo-crm';
  IF v_conn IS NULL THEN RAISE EXCEPTION 'connexion démo absente : jouer seed-crm-demo.sql d''abord'; END IF;
  v_hp := COALESCE(public.crm_holdout_pct(v_key), 10);

  -- ── Rejouable ──────────────────────────────────────────────────────────────
  DELETE FROM public.crm_scenarios WHERE scope_key = v_key;
  DELETE FROM public.crm_scenario_scope_state WHERE scope_key = v_key;
  DELETE FROM public.email_campaign_templates
   WHERE organizer_user_id = v_uid AND venue_id IS NULL AND theme_json->>'seed' = 'crm-journeys';

  -- ── Les e-mails : copies des modèles des recettes (seed-crm-automations), pour
  --    qu'un nouveau semis des recettes ne casse pas les scénarios. ─────────────
  FOR v_c IN SELECT * FROM (VALUES
      ('new_event', 'Fidèles : la soirée arrive'),
      ('last_call', 'Fidèles : dernières places'),
      ('win_back', 'Vous nous avez manqué'),
      ('post_event_thanks', 'Merci d''être venu')) AS c(kind, name) LOOP
    v_id := NULL;
    INSERT INTO public.email_campaign_templates (organizer_user_id, created_by, name, description, subject, preheader,
           blocks_json, blocks_version, theme_json, social_links_json, logo_url, type)
    SELECT v_uid, v_uid, v_c.name, 'Scénarios', tp.subject, tp.preheader, tp.blocks_json, tp.blocks_version,
           tp.theme_json || '{"seed":"crm-journeys"}'::jsonb, tp.social_links_json, tp.logo_url, tp.type
      FROM public.email_automations a JOIN public.email_campaign_templates tp ON tp.id = a.template_id
     WHERE a.organizer_user_id = v_uid AND a.venue_id IS NULL AND a.kind = v_c.kind
     LIMIT 1
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'modèle de la recette % absent : jouer seed-crm-automations d''abord', v_c.kind; END IF;
    v_tpl := v_tpl || jsonb_build_object(v_c.kind, v_id);
  END LOOP;

  -- ── Faits de la démo : soirées miroirs et achats par personne et par soirée ─
  CREATE TEMP TABLE _jn ON COMMIT DROP AS
  SELECT x.event_id AS eid, x.start_at, COALESCE(x.end_at, x.start_at + interval '6 hours') AS end_at
    FROM public.external_events x
   WHERE x.connection_id = v_conn AND x.event_id IS NOT NULL;
  CREATE TEMP TABLE _jt ON COMMIT DROP AS
  SELECT lower(t.buyer_email) AS email, x.event_id AS eid, x.start_at,
         min(COALESCE(t.purchased_at, t.first_seen_at)) AS bought_at,
         bool_or(t.scanned_at IS NOT NULL) AS came
    FROM public.external_tickets t
    JOIN public.external_events x ON x.connection_id = t.connection_id AND x.external_id = t.external_event_id
   WHERE t.connection_id = v_conn AND t.buyer_email IS NOT NULL AND x.event_id IS NOT NULL
     AND public._crm_ticket_is_sale(t.status, t.raw)
   GROUP BY 1, 2, 3;
  CREATE INDEX ON _jt (email);
  -- Joignables : un accord e-mail dans le registre du compte.
  CREATE TEMP TABLE _jok ON COMMIT DROP AS
  SELECT DISTINCT lower(ns.email) AS email FROM public.newsletter_subscriptions ns
   WHERE ns.organizer_user_id = v_uid AND ns.venue_id IS NULL AND ns.opted_in;

  -- Le plan : une ligne par entrée, puis la frise de ses étapes.
  CREATE TEMP TABLE _jr (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scn uuid, ver uuid, email text, eid uuid, tk text,
                         entered_at timestamptz, holdout boolean, goal_at timestamptz, cutoff timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE _jl (run uuid, ord integer, node text, at timestamptz, msg boolean, win timestamptz,
                         held boolean NOT NULL DEFAULT false) ON COMMIT DROP;

  -- ── 1. « Fidèles sans place : J-10, J-3, J-1 », en ligne depuis 41 jours ────
  v_pub := date_trunc('day', now()) - interval '41 days' + interval '11 hours';
  v_g := replace(replace($g${"v":1,"trigger":{"type":"before_event","days":10},"entry":{"filter":{"op":"and","items":[{"k":"seg","v":"hab"},{"op":"and","not":true,"items":[{"k":"ev","v":["$event"]}]}]},"reentry":{"mode":"per_event"},"holdout":true},"goal":{"type":"bought_event"},"start":"e1","nodes":{"e1":{"type":"email","template_id":"@ANNONCE@","event":"scenario","next":"w1"},"w1":{"type":"wait","mode":"until_event","anchor":"start","days":-3,"at":"18:00","next":"e2"},"e2":{"type":"email","template_id":"@LASTCALL@","event":"scenario","next":"w2"},"w2":{"type":"wait","mode":"until_event","anchor":"start","days":-1,"at":"18:00","next":"s1"},"s1":{"type":"sms","body":"Demain chez {{nom_club}} : {{soirée}}. Dernières places : {{lien}}","event":"scenario","next":"x"},"x":{"type":"end"}}}$g$, '@ANNONCE@', v_tpl->>'new_event'), '@LASTCALL@', v_tpl->>'last_call')::jsonb;
  INSERT INTO public.crm_scenarios (scope_key, organizer_user_id, name, status, draft, draft_updated_at, version_no,
         template, created_by, created_at, updated_at, published_at)
  VALUES (v_key, v_uid, 'Fidèles sans place : J-10, J-3, J-1', 'active', v_g, v_pub, 1, 'loyal_no_ticket', v_uid,
          v_pub - interval '40 minutes', v_pub, v_pub)
  RETURNING id INTO v_scn;
  INSERT INTO public.crm_scenario_versions (scenario_id, scope_key, version, graph, stats, published_by, published_at)
  VALUES (v_scn, v_key, 1, v_g, COALESCE(public._crm_scenario_graph_errors(v_g)->'stats', '{}'::jsonb), v_uid, v_pub)
  RETURNING id INTO v_ver;
  UPDATE public.crm_scenarios SET live_version_id = v_ver WHERE id = v_scn;

  -- Entrée à J-10 (matin) : habitués (3 soirées ou plus avant l'entrée), joignables,
  -- sans place pour la soirée à ce moment-là. Soirées dont le J-10 tombe depuis la mise en ligne.
  INSERT INTO _jr (scn, ver, email, eid, tk, entered_at, holdout, goal_at, cutoff)
  SELECT v_scn, v_ver, c.email, c.eid, c.eid::text, c.ent, random() * 100 < v_hp, c.goal, now()
    FROM (
      SELECT p.email, n.eid, ent.at AS ent,
             (SELECT min(t.bought_at) FROM _jt t WHERE t.email = p.email AND t.eid = n.eid AND t.bought_at > ent.at) AS goal,
             row_number() OVER (PARTITION BY n.eid ORDER BY random()) AS rk
        FROM _jn n
        CROSS JOIN LATERAL (SELECT (((n.start_at AT TIME ZONE 'Europe/Paris')::date - 10) + time '09:12')
                                   AT TIME ZONE 'Europe/Paris' + make_interval(mins => (random() * 40)::integer) AS at) ent
        JOIN (SELECT DISTINCT email FROM _jt) p ON true
       WHERE ent.at >= v_pub AND ent.at <= now()
         AND EXISTS (SELECT 1 FROM _jok o WHERE o.email = p.email)
         AND (SELECT count(DISTINCT t.eid) FROM _jt t WHERE t.email = p.email AND t.start_at < ent.at) >= 3
         AND NOT EXISTS (SELECT 1 FROM _jt t WHERE t.email = p.email AND t.eid = n.eid AND t.bought_at <= ent.at)
    ) c
   WHERE c.rk <= 140;
  INSERT INTO _jl (run, ord, node, at, msg, win)
  SELECT r.id, x.ord, x.node, x.at, x.msg, CASE WHEN x.msg THEN LEAST(x.at + interval '48 hours', n.start_at - interval '2 hours') END
    FROM _jr r JOIN _jn n ON n.eid = r.eid
    CROSS JOIN LATERAL (SELECT (((n.start_at AT TIME ZONE 'Europe/Paris')::date - 3) + time '18:00') AT TIME ZONE 'Europe/Paris' AS j3,
                               (((n.start_at AT TIME ZONE 'Europe/Paris')::date - 1) + time '18:00') AT TIME ZONE 'Europe/Paris' AS j1) w
    CROSS JOIN LATERAL (VALUES (1, 'e1', r.entered_at + interval '1 minute', true),
                               (2, 'w1', w.j3, false), (3, 'e2', w.j3 + interval '1 minute', true),
                               (4, 'w2', w.j1, false), (5, 's1', w.j1 + interval '1 minute', true),
                               (6, 'x', w.j1 + interval '1 minute', false)) AS x(ord, node, at, msg)
   WHERE r.scn = v_scn;

  -- ── 2. « Acheteurs absents → prochaine soirée », en ligne depuis 30 jours ───
  v_pub := date_trunc('day', now()) - interval '30 days' + interval '15 hours';
  -- L'attente avant le SMS (1 à 5 jours) : celle qui rend dû, aujourd'hui, le SMS des absents de la dernière soirée.
  SELECT max(n.end_at + interval '24 hours') INTO v_last FROM _jn n
   WHERE n.end_at + interval '24 hours' BETWEEN v_pub AND now() AND public._crm_event_scan_known(n.eid)
     AND EXISTS (SELECT 1 FROM _jt t JOIN _jok o ON o.email = t.email WHERE t.eid = n.eid AND NOT t.came);
  v_days := LEAST(5, GREATEST(1, COALESCE(floor(extract(epoch FROM now() - v_last - interval '1 hour') / 86400)::integer, 5)));
  v_g := replace($g${"v":1,"trigger":{"type":"after_event","hours":24,"who":"absent_buyers"},"entry":{"filter":null,"reentry":{"mode":"per_event"},"holdout":true},"goal":{"type":"bought_any"},"start":"e1","nodes":{"e1":{"type":"email","template_id":"@MANQUE@","event":"for_person","next":"w1"},"w1":{"type":"wait","mode":"duration","hours":120,"next":"s1"},"s1":{"type":"sms","body":"Vous nous avez manqué, {{prénom}}. La prochaine chez {{nom_club}} : {{soirée}}. {{lien}}","event":"for_person","next":"x"},"x":{"type":"end"}}}$g$, '@MANQUE@', v_tpl->>'win_back')::jsonb;
  v_g := jsonb_set(v_g, '{nodes,w1,hours}', to_jsonb(v_days * 24));
  INSERT INTO public.crm_scenarios (scope_key, organizer_user_id, name, status, draft, draft_updated_at, version_no,
         template, created_by, created_at, updated_at, published_at)
  VALUES (v_key, v_uid, 'Acheteurs absents → prochaine soirée', 'active', v_g, v_pub, 1, 'absent_buyers', v_uid,
          v_pub - interval '25 minutes', v_pub, v_pub)
  RETURNING id INTO v_scn;
  INSERT INTO public.crm_scenario_versions (scenario_id, scope_key, version, graph, stats, published_by, published_at)
  VALUES (v_scn, v_key, 1, v_g, COALESCE(public._crm_scenario_graph_errors(v_g)->'stats', '{}'::jsonb), v_uid, v_pub)
  RETURNING id INTO v_ver;
  UPDATE public.crm_scenarios SET live_version_id = v_ver WHERE id = v_scn;

  -- Entrée 24 h après la fin : a acheté, n'a pas été scanné, sur une soirée où la porte a scanné.
  INSERT INTO _jr (scn, ver, email, eid, tk, entered_at, holdout, goal_at, cutoff)
  SELECT v_scn, v_ver, t.email, n.eid, n.eid::text, ent.at, random() * 100 < v_hp,
         (SELECT min(t2.bought_at) FROM _jt t2 WHERE t2.email = t.email AND t2.bought_at > ent.at), now()
    FROM _jn n
    CROSS JOIN LATERAL (SELECT n.end_at + interval '24 hours' + make_interval(mins => 3 + (random() * 30)::integer) AS at) ent
    JOIN _jt t ON t.eid = n.eid AND NOT t.came
   WHERE ent.at >= v_pub AND ent.at <= now()
     AND public._crm_event_scan_known(n.eid)
     AND EXISTS (SELECT 1 FROM _jok o WHERE o.email = t.email);
  INSERT INTO _jl (run, ord, node, at, msg, win, held)
  SELECT r.id, x.ord, x.node, x.at, x.msg, CASE WHEN x.msg THEN x.at + interval '48 hours' END,
         -- Le SMS des entrées les plus récentes attend des Yunits.
         x.node = 's1' AND NOT r.holdout AND x.at > now() - interval '48 hours' AND x.at <= now()
    FROM _jr r
    CROSS JOIN LATERAL (VALUES (1, 'e1', r.entered_at + interval '1 minute', true),
                               (2, 'w1', r.entered_at + make_interval(days => v_days), false),
                               (3, 's1', r.entered_at + make_interval(days => v_days, mins => 1), true),
                               (4, 'x', r.entered_at + make_interval(days => v_days, mins => 1), false)) AS x(ord, node, at, msg)
   WHERE r.scn = v_scn;

  -- ── 3. « Reconquête en 2 temps », en ligne 50 jours, en pause depuis 6 ──────
  v_pub := date_trunc('day', now()) - interval '50 days' + interval '10 hours';
  v_pause := date_trunc('day', now()) - interval '6 days' + interval '17 hours 20 minutes';
  v_g := replace($g${"v":1,"trigger":{"type":"absence","days":120},"entry":{"filter":{"op":"and","items":[{"k":"nb_min","v":2}]},"reentry":{"mode":"every_days","days":180},"holdout":true},"goal":{"type":"bought_any"},"start":"e1","nodes":{"e1":{"type":"email","template_id":"@MANQUE@","event":"for_person","next":"w1"},"w1":{"type":"wait","mode":"duration","hours":168,"next":"s1"},"s1":{"type":"sms","body":"{{prénom}}, ca fait un moment ! {{soirée}} chez {{nom_club}} : {{lien}}","event":"for_person","next":"x"},"x":{"type":"end"}}}$g$, '@MANQUE@', v_tpl->>'win_back')::jsonb;
  INSERT INTO public.crm_scenarios (scope_key, organizer_user_id, name, status, draft, draft_updated_at, version_no,
         template, created_by, created_at, updated_at, published_at, paused_at)
  VALUES (v_key, v_uid, 'Reconquête en 2 temps', 'paused', v_g, v_pub, 1, 'winback_2', v_uid,
          v_pub - interval '1 hour', v_pause, v_pub, v_pause)
  RETURNING id INTO v_scn;
  INSERT INTO public.crm_scenario_versions (scenario_id, scope_key, version, graph, stats, published_by, published_at)
  VALUES (v_scn, v_key, 1, v_g, COALESCE(public._crm_scenario_graph_errors(v_g)->'stats', '{}'::jsonb), v_uid, v_pub)
  RETURNING id INTO v_ver;
  UPDATE public.crm_scenarios SET live_version_id = v_ver WHERE id = v_scn;

  -- Entrée le jour où la dernière soirée a 120 jours (2 soirées au moins). Rien n'avance après la pause.
  INSERT INTO _jr (scn, ver, email, eid, tk, entered_at, holdout, goal_at, cutoff)
  SELECT v_scn, v_ver, p.email, NULL, 'p:' || floor(extract(epoch FROM ent.at) / (86400.0 * 180))::bigint, ent.at,
         random() * 100 < v_hp,
         (SELECT min(t2.bought_at) FROM _jt t2 WHERE t2.email = p.email AND t2.bought_at > ent.at), v_pause
    FROM (SELECT t.email, max(t.start_at) AS last_at, count(DISTINCT t.eid) AS nights FROM _jt t GROUP BY t.email) p
    CROSS JOIN LATERAL (SELECT p.last_at + interval '120 days' + interval '9 hours' + make_interval(mins => (random() * 50)::integer) AS at) ent
   WHERE p.nights >= 2 AND ent.at >= v_pub AND ent.at <= v_pause
     AND EXISTS (SELECT 1 FROM _jok o WHERE o.email = p.email);
  INSERT INTO _jl (run, ord, node, at, msg, win)
  SELECT r.id, x.ord, x.node, x.at, x.msg, CASE WHEN x.msg THEN x.at + interval '48 hours' END
    FROM _jr r
    CROSS JOIN LATERAL (VALUES (1, 'e1', r.entered_at + interval '1 minute', true),
                               (2, 'w1', r.entered_at + interval '168 hours', false),
                               (3, 's1', r.entered_at + interval '168 hours 1 minute', true),
                               (4, 'x', r.entered_at + interval '168 hours 1 minute', false)) AS x(ord, node, at, msg)
   WHERE r.scn = v_scn;

  -- ── 4. « Invités en guest list → payants », brouillon ───────────────────────
  v_g := replace(replace($g${"v":1,"trigger":{"type":"after_event","hours":24,"who":"entered"},"entry":{"filter":{"op":"and","items":[{"k":"gl","v":"only"}]},"reentry":{"mode":"every_days","days":60},"holdout":true},"goal":{"type":"bought_any"},"start":"e1","nodes":{"e1":{"type":"email","template_id":"@MERCI@","event":"for_person","next":"w1"},"w1":{"type":"wait","mode":"duration","hours":96,"next":"e2"},"e2":{"type":"email","template_id":"@ANNONCE@","event":"for_person","next":"x"},"x":{"type":"end"}}}$g$, '@MERCI@', v_tpl->>'post_event_thanks'), '@ANNONCE@', v_tpl->>'new_event')::jsonb;
  INSERT INTO public.crm_scenarios (scope_key, organizer_user_id, name, status, draft, draft_updated_at, template,
         created_by, created_at, updated_at)
  VALUES (v_key, v_uid, 'Invités en guest list → payants', 'draft', v_g, now() - interval '2 days 3 hours', 'gl_to_paid',
          v_uid, now() - interval '2 days 4 hours', now() - interval '2 days 3 hours');

  -- ── Écriture : l'objectif ne compte que s'il tombe avant l'arrêt (maintenant, ou la pause) ─
  UPDATE _jr SET goal_at = NULL WHERE goal_at > cutoff;
  CREATE TEMP TABLE _jv ON COMMIT DROP AS
  SELECT l.*, r.scn, r.ver, r.holdout
    FROM _jl l JOIN _jr r ON r.id = l.run
   WHERE l.at <= r.cutoff AND (r.goal_at IS NULL OR l.at < r.goal_at);
  -- Après une étape retenue, rien n'avance.
  DELETE FROM _jv v USING (SELECT run, min(ord) AS o FROM _jv WHERE held GROUP BY run) h
   WHERE v.run = h.run AND v.ord > h.o;

  INSERT INTO public.crm_scenario_runs (id, scenario_id, version_id, scope_key, email, event_id, trigger_key, entered_at,
         status, exit_reason, node_id, node_since, due_at, holdout, last_message_at, goal_at, updated_at)
  SELECT r.id, r.scn, r.ver, v_key, r.email, r.eid, r.tk, r.entered_at,
         CASE WHEN r.goal_at IS NOT NULL THEN 'exited' WHEN h.node IS NOT NULL THEN 'active'
              WHEN nx.node IS NULL THEN 'done' ELSE 'active' END,
         CASE WHEN r.goal_at IS NOT NULL THEN 'goal' WHEN h.node IS NULL AND nx.node IS NULL THEN 'end' END,
         COALESCE(h.node, nx.node, 'x'),
         COALESCE(lv.at, r.entered_at),
         CASE WHEN h.node IS NOT NULL THEN h.win WHEN r.goal_at IS NOT NULL THEN r.goal_at ELSE COALESCE(nx.at, lv.at, r.entered_at) END,
         r.holdout, lm.at, r.goal_at, COALESCE(r.goal_at, lv.at, r.entered_at)
    FROM _jr r
    LEFT JOIN LATERAL (SELECT v.node, v.win FROM _jv v WHERE v.run = r.id AND v.held) h ON true
    LEFT JOIN LATERAL (SELECT max(v.at) AS at FROM _jv v WHERE v.run = r.id) lv ON true
    LEFT JOIN LATERAL (SELECT max(v.at) AS at FROM _jv v WHERE v.run = r.id AND v.msg AND NOT v.held AND NOT r.holdout) lm ON true
    LEFT JOIN LATERAL (SELECT l.node, l.at FROM _jl l WHERE l.run = r.id AND NOT EXISTS (SELECT 1 FROM _jv v WHERE v.run = l.run AND v.ord = l.ord)
                        ORDER BY l.ord LIMIT 1) nx ON true;

  INSERT INTO public.crm_scenario_steps (run_id, node_id, pass, scenario_id, version_id, status, reason, due_at, window_end, created_at, done_at)
  SELECT v.run, v.node, 1, v.scn, v.ver,
         CASE WHEN v.held THEN 'held' WHEN v.msg AND v.holdout THEN 'holdout' WHEN v.msg THEN 'would_send' ELSE 'passed' END,
         CASE WHEN v.held THEN 'yunits' END,
         v.at, v.win, v.at, CASE WHEN v.held THEN NULL ELSE v.at END
    FROM _jv v;

  SELECT count(*) INTO v_n FROM _jr;
  RAISE NOTICE 'scénarios démo : 4 (2 en ligne, 1 en pause, 1 brouillon), % entrées, % étapes, % retenues faute de Yunits',
    v_n, (SELECT count(*) FROM _jv), (SELECT count(*) FROM _jv WHERE held);
END;
$seed$;
