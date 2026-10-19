-- ============================================================================
-- Yuno CRM — Premiers pas : le guide des premiers pas d'un compte (19/10/2026).
-- Plan : docs/designs/CRM_FIRST_STEPS_PLAN.md.
--
-- Les étapes se cochent SEULES, relues à chaque appel dans les vraies tables
-- (connexion Shotgun, identité de l'expéditeur, campagnes, recettes, scénarios,
-- connexions MCP, segments, équipe) : une étape faite ailleurs, ou par un membre
-- de l'équipe, est cochée pour tout l'espace. Rien ne se coche sur un clic.
--
-- · crm_first_steps (table)      préférence d'AFFICHAGE par personne et par espace
--                                (masqué, reporté, terminé vu). Aucune étape n'y
--                                est écrite. RLS sans policy : tout passe par les RPC.
-- · crm_first_steps(venue, orga) l'état du guide (porte crm_scope_allowed),
--                                lecture seule, sans table temporaire (passe dans
--                                la transaction en lecture seule d'un aperçu démo).
-- · crm_first_steps_set(…, act)  dismiss | snooze | resume | finish. Sans effet en
--                                accès assisté : Yuno ne masque jamais le guide à
--                                la place du pro.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_first_steps (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  dismissed_at timestamptz,
  snoozed_until timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_key)
);
ALTER TABLE public.crm_first_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_first_steps FROM PUBLIC, anon, authenticated;

-- ── L'état du guide ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_first_steps(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope    text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_now      timestamptz := now();
  v_crm_only boolean;
  v_holder   uuid;
  v_conn     record;
  v_ident    jsonb;
  v_sent     record;
  v_draft    record;
  v_recipes  integer;
  v_scen     integer;
  v_claude   boolean;
  v_segments integer;
  v_team     integer;
  v_buyers   integer;
  v_ev       record;
  v_sub      record;
  v_pref     record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Un compte au seul produit CRM : toutes ses campagnes et recettes sont du CRM.
  -- Un compte Billetterie + CRM : seulement celles marquées `product = 'crm'`.
  v_crm_only := public.crm_scope_is_crm(v_scope);
  v_holder := CASE WHEN p_venue_id IS NOT NULL
                   THEN (SELECT v.owner_id FROM public.venues v WHERE v.id = p_venue_id)
                   ELSE p_organizer_user_id END;

  -- 1. Shotgun : la connexion de la portée (la plus récente).
  SELECT c.status, c.external_org_name, c.initial_import_done_at, c.last_ok_at,
         NULLIF(c.stats->>'tickets', '')::bigint AS tickets,
         NULLIF(c.stats->>'events', '')::bigint AS events,
         NULLIF(c.stats->>'buyers', '')::bigint AS buyers
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE c.provider = 'shotgun'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND c.organizer_user_id = p_organizer_user_id))
   ORDER BY c.created_at DESC
   LIMIT 1;

  -- 2. Identité de l'expéditeur : la même porte que l'envoi.
  v_ident := public._crm_email_identity(p_venue_id, p_organizer_user_id);

  -- 3. Premier e-mail : une campagne manuelle partie, en cours ou programmée.
  SELECT count(*)::int AS n, min(COALESCE(c.sent_at, c.scheduled_at, c.updated_at)) AS first_at
    INTO v_sent
    FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.status IN ('sent', 'sending', 'scheduled')
     AND (v_crm_only OR c.product = 'crm');

  SELECT c.id, c.name, c.updated_at
    INTO v_draft
    FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
     AND c.status = 'draft'
     AND (v_crm_only OR c.product = 'crm')
   ORDER BY c.updated_at DESC
   LIMIT 1;

  -- 4. Automatisation : une recette allumée, ou un scénario en ligne.
  SELECT count(*)::int INTO v_recipes
    FROM public.email_automations a
   WHERE a.enabled
     AND ((p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND a.organizer_user_id = p_organizer_user_id))
     AND (v_crm_only OR a.product = 'crm');
  SELECT count(*)::int INTO v_scen
    FROM public.crm_scenarios s
   WHERE s.scope_key = v_scope AND s.status = 'active';

  -- 5. Claude (ou toute IA branchée par le MCP) : une connexion vivante sur l'espace,
  --    la sienne ou celle d'un membre de l'équipe.
  SELECT EXISTS (SELECT 1 FROM public.mcp_grants g WHERE g.revoked_at IS NULL AND v_scope = ANY (g.spaces))
    INTO v_claude;

  -- Pour aller plus loin : segments et équipe (même règle que l'Admin CRM).
  SELECT count(*)::int INTO v_segments FROM public.crm_segments s WHERE s.scope_key = v_scope;
  v_team := CASE WHEN p_venue_id IS NULL
                 THEN (SELECT count(*) FROM public.org_members m
                        WHERE m.organizer_user_id = p_organizer_user_id AND m.invitation_status = 'accepted')
                 ELSE (SELECT count(*) FROM public.manager_permissions mp WHERE mp.venue_id = p_venue_id) END;

  -- Le vrai résultat, une fois un e-mail parti : des acheteurs dont le billet
  -- porte la source d'un e-mail Yuno (`utm_source` yuno-m-…, famille « em »).
  IF COALESCE(v_sent.n, 0) > 0 THEN
    SELECT count(DISTINCT lower(t.buyer_email))::int INTO v_buyers
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.utm IS NOT NULL
       AND lower(t.utm->>'utm_source') LIKE 'yuno-m-%'
       AND t.status IN ('valid', 'transferred')
       AND t.buyer_email IS NOT NULL;
  END IF;

  -- La prochaine soirée (même règle que l'Accueil) : le premier e-mail s'y relie.
  SELECT e.id, e.title, e.start_at,
         ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
           - (v_now AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date) AS days_to
    INTO v_ev
    FROM public.events e
    LEFT JOIN public.external_events x ON x.event_id = e.id
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.external_source IS NOT NULL
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_now
     AND x.cancelled_at IS NULL
   ORDER BY e.start_at ASC
   LIMIT 1;

  SELECT s.status, s.offer, s.offer_until, s.trial_ends_at, s.created_at
    INTO v_sub
    FROM public.crm_subscriptions s
   WHERE s.scope_key = v_scope;

  SELECT f.dismissed_at, f.snoozed_until, f.finished_at
    INTO v_pref
    FROM public.crm_first_steps f
   WHERE f.user_id = auth.uid() AND f.scope_key = v_scope;

  RETURN jsonb_build_object(
    'now', v_now,
    'steps', jsonb_build_object(
      'shotgun', jsonb_build_object(
        'done', COALESCE(v_conn.status = 'active', false),
        'state', CASE WHEN v_conn.status IS NULL THEN 'off'
                      WHEN v_conn.status IN ('token_invalid', 'error') THEN 'broken'
                      WHEN v_conn.status = 'active' AND v_conn.initial_import_done_at IS NULL THEN 'importing'
                      WHEN v_conn.status = 'active' THEN 'on'
                      ELSE 'off' END,
        'org', v_conn.external_org_name,
        'tickets', v_conn.tickets, 'events', v_conn.events, 'buyers', v_conn.buyers),
      'identity', jsonb_build_object(
        'done', COALESCE((v_ident->>'ready')::boolean, false),
        'missing', COALESCE(v_ident->'missing', '[]'::jsonb)),
      'email', jsonb_build_object(
        'done', COALESCE(v_sent.n, 0) > 0,
        'n', COALESCE(v_sent.n, 0),
        'draft', CASE WHEN v_draft.id IS NOT NULL
                      THEN jsonb_build_object('id', v_draft.id, 'name', v_draft.name, 'updated_at', v_draft.updated_at) END),
      'automation', jsonb_build_object(
        'done', COALESCE(v_recipes, 0) + COALESCE(v_scen, 0) > 0,
        'recipes', COALESCE(v_recipes, 0), 'scenarios', COALESCE(v_scen, 0)),
      'claude', jsonb_build_object('done', COALESCE(v_claude, false)),
      'segments', jsonb_build_object('done', COALESCE(v_segments, 0) > 0, 'n', COALESCE(v_segments, 0)),
      'team', jsonb_build_object('done', COALESCE(v_team, 0) > 0, 'n', COALESCE(v_team, 0))),
    'outcome', CASE WHEN COALESCE(v_sent.n, 0) > 0 THEN jsonb_build_object('buyers', COALESCE(v_buyers, 0)) END,
    'next_night', CASE WHEN v_ev.id IS NOT NULL
                       THEN jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'days_to', v_ev.days_to) END,
    'offer', CASE WHEN v_sub.status IS NOT NULL THEN jsonb_build_object(
                    'status', v_sub.status, 'offer', v_sub.offer, 'offer_until', v_sub.offer_until,
                    'trial_ends_at', v_sub.trial_ends_at) END,
    'opened_at', v_sub.created_at,
    'yunits', public.crm_yunits_balance(v_scope),
    'holder', jsonb_build_object(
      'is_me', v_holder IS NOT DISTINCT FROM auth.uid(),
      'first_name', (SELECT NULLIF(btrim(p.first_name), '') FROM public.profiles p WHERE p.id = v_holder)),
    'pref', jsonb_build_object(
      'dismissed_at', v_pref.dismissed_at, 'snoozed_until', v_pref.snoozed_until, 'finished_at', v_pref.finished_at)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_first_steps(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_first_steps(text, uuid) TO authenticated, service_role;

-- ── Masquer, reporter, reprendre, terminer ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_first_steps_set(p_venue_id text, p_organizer_user_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_uid   uuid := auth.uid();
  v_tomorrow timestamptz := (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '1 day 6 hours') AT TIME ZONE 'Europe/Paris';
  r record;
BEGIN
  IF v_uid IS NULL OR NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('dismiss', 'snooze', 'resume', 'finish') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  -- Accès assisté : la session est celle du pro, mais c'est Yuno qui clique.
  -- On n'écrit rien, on rend l'état tel qu'il est.
  IF NOT COALESCE(public.is_support_session(), false) THEN
    INSERT INTO public.crm_first_steps AS f (user_id, scope_key, dismissed_at, snoozed_until, finished_at)
    VALUES (v_uid, v_scope,
            CASE WHEN p_action = 'dismiss' THEN now() END,
            CASE WHEN p_action = 'snooze' THEN v_tomorrow END,
            CASE WHEN p_action = 'finish' THEN now() END)
    ON CONFLICT (user_id, scope_key) DO UPDATE SET
      dismissed_at  = CASE p_action WHEN 'dismiss' THEN now() WHEN 'resume' THEN NULL ELSE f.dismissed_at END,
      snoozed_until = CASE p_action WHEN 'snooze' THEN v_tomorrow WHEN 'finish' THEN f.snoozed_until ELSE NULL END,
      finished_at   = CASE p_action WHEN 'finish' THEN now() WHEN 'resume' THEN NULL ELSE f.finished_at END,
      updated_at    = now();
  END IF;

  SELECT f.dismissed_at, f.snoozed_until, f.finished_at INTO r
    FROM public.crm_first_steps f
   WHERE f.user_id = v_uid AND f.scope_key = v_scope;
  RETURN jsonb_build_object('dismissed_at', r.dismissed_at, 'snoozed_until', r.snoozed_until, 'finished_at', r.finished_at);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_first_steps_set(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_first_steps_set(text, uuid, text) TO authenticated, service_role;
