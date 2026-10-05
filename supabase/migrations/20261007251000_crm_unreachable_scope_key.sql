-- ============================================================================
-- Yuno CRM : « contacts à corriger » lisait contact_engagement avec la mauvaise
-- clé de portée.
--
-- contact_engagement est clé par contact_base_scope_key ('o:<uuid>' / 'v:<id>'),
-- get_crm_shell et _crm_notif_list cherchaient crm_scope_key ('org:…' /
-- 'venue:…') : 0 ligne trouvée, toujours. La pastille du menu Clients restait à
-- 0 pendant que l'Accueil en comptait 69 (WOH) et la notification
-- « contacts injoignables » ne partait jamais. Corps repris de la base liée
-- (pg_get_functiondef, 05/10) ; seule la clé change.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_crm_shell(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_profile jsonb;
  v_conn jsonb;
  v_sub jsonb;
  v_drafts integer;
  v_unreachable integer;
  v_unread integer;
  v_balance integer;
  v_reserved integer;
  cfg jsonb := public.crm_pricing_config();
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'email', p.email,
                            'avatar_url', p.avatar_url, 'language', p.preferred_language)
    INTO v_profile
    FROM public.profiles p WHERE p.id = auth.uid();

  SELECT jsonb_build_object(
           'provider', c.provider, 'status', c.status, 'external_org_name', c.external_org_name,
           'last_ok_at', c.last_ok_at, 'last_error_at', c.last_error_at, 'last_error', c.last_error,
           'fail_count', c.fail_count, 'initial_import_done_at', c.initial_import_done_at,
           'running', c.locked_until IS NOT NULL AND c.locked_until > now(),
           'state', CASE
             WHEN c.status = 'token_invalid' THEN 'broken'
             WHEN c.last_error_at IS NOT NULL AND (c.last_ok_at IS NULL OR c.last_error_at > c.last_ok_at) AND c.fail_count >= 3 THEN 'broken'
             WHEN c.locked_until IS NOT NULL AND c.locked_until > now() THEN 'running'
             WHEN c.status = 'paused' THEN 'paused'
             ELSE 'ok' END,
           'broken_since', CASE WHEN c.status = 'token_invalid' OR (c.last_error_at IS NOT NULL AND (c.last_ok_at IS NULL OR c.last_error_at > c.last_ok_at))
                                THEN COALESCE(c.last_ok_at, c.last_error_at) END)
    INTO v_conn
    FROM public.ticketing_connections c
   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
   ORDER BY c.created_at LIMIT 1;

  SELECT jsonb_build_object(
           'status', s.status,
           'state', CASE
             WHEN s.status = 'trialing' AND s.trial_ends_at > now() THEN 'trial'
             WHEN s.status IN ('active', 'past_due')
                  AND NOT (s.stripe_subscription_id IS NULL AND s.current_period_end IS NOT NULL AND s.current_period_end < now())
               THEN s.status
             ELSE 'paused' END,
           'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end,
           'cancel_at_period_end', s.cancel_at_period_end, 'interval', s.billing_interval,
           'has_stripe', s.stripe_subscription_id IS NOT NULL)
    INTO v_sub
    FROM public.crm_subscriptions s WHERE s.scope_key = v_scope;

  -- Campagnes à traiter : brouillons manuels touchés depuis 30 jours (e-mail
  -- hors automatisations et renvois, SMS).
  SELECT (SELECT count(*) FROM public.email_campaigns c
           WHERE c.status = 'draft' AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
             AND c.updated_at > now() - interval '30 days'
             AND c.venue_id IS NOT DISTINCT FROM p_venue_id
             AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id)
       + (SELECT count(*) FROM public.sms_campaigns s
           WHERE s.status = 'draft' AND s.updated_at > now() - interval '30 days'
             AND s.venue_id IS NOT DISTINCT FROM p_venue_id
             AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id)
    INTO v_drafts;

  -- Contacts à corriger : adresse qui rebondit ou injoignable.
  SELECT count(*) INTO v_unreachable
    FROM public.contact_engagement e
   WHERE e.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id) AND e.status = 'unreachable';

  -- Notifications CRM de la personne : à faire non reportées + non lues.
  SELECT count(*) INTO v_unread
    FROM jsonb_array_elements(public._crm_notif_list(p_venue_id, p_organizer_user_id, auth.uid(), false)) x
   WHERE NOT (x->>'archived')::boolean AND x->>'snoozed_until' IS NULL
     AND ((x->>'need')::boolean OR NOT (x->>'read')::boolean);

  v_balance := public.crm_yunits_balance(v_scope);
  SELECT COALESCE(sum(public._crm_campaign_estimate(c.id)), 0)::int * (cfg->'rates'->>'email')::int
    INTO v_reserved
    FROM public.email_campaigns c
   WHERE c.status = 'scheduled' AND c.scheduled_at > now()
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'connection', v_conn,
    'subscription', v_sub,
    'wallet', jsonb_build_object('balance', v_balance, 'reserved', v_reserved, 'low_balance', (cfg->>'low_balance')::int,
                                 'rates', cfg->'rates'),
    'badges', jsonb_build_object('campaigns', COALESCE(v_drafts, 0), 'clients', COALESCE(v_unreachable, 0)),
    'notifications_unread', COALESCE(v_unread, 0),
    'is_super_admin', public.is_super_admin()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_notif_list(p_venue_id text, p_organizer_user_id uuid, p_user uuid, p_enrich boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  cfg jsonb := public.crm_pricing_config();
  v_def jsonb := public.crm_notif_defaults();
  v_pref public.crm_notification_prefs%ROWTYPE;
  v_kinds jsonb := '{}'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_balance integer := public.crm_yunits_balance(v_scope);
  v_threshold integer;
  v_short boolean := false;
  v_cum integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_left integer := 2;
  k text;
  r record;
  it jsonb;
  st public.crm_notification_states%ROWTYPE;
  v_buyers integer;
BEGIN
  -- Préférences « dans Yuno » de la personne (défauts complétés).
  SELECT * INTO v_pref FROM public.crm_notification_prefs WHERE scope_key = v_scope AND user_id = p_user;
  FOR k IN SELECT jsonb_object_keys(v_def) LOOP
    v_kinds := v_kinds || jsonb_build_object(k,
      CASE WHEN COALESCE((v_def->k->>'lock')::boolean, false) THEN v_def->k
           ELSE (v_def->k) || COALESCE(v_pref.prefs->k, '{}'::jsonb) END);
  END LOOP;
  v_threshold := COALESCE(v_pref.low_balance, (cfg->>'low_balance')::int, 2000);

  -- ── À faire ───────────────────────────────────────────────────────────────
  -- Un envoi programmé dans l'heure.
  FOR r IN SELECT c.id, c.name, c.scheduled_at FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now() AND c.scheduled_at <= now() + interval '1 hour'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_soon:' || r.id, 'kind', 'send_soon', 'cat', 'envois', 'tone', 'todo',
      'need', true, 'lock', false, 'pref', 'prog', 'at', LEAST(now(), r.scheduled_at - interval '1 hour'), 'due_at', r.scheduled_at,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.scheduled_at,
                                   'recipients', public._crm_campaign_estimate(r.id)));
  END LOOP;

  -- Des Yunits qui manquent pour les envois programmés (le premier qui casse).
  FOR r IN SELECT c.id, c.name, c.scheduled_at,
                  public._crm_campaign_estimate(c.id) * (cfg->'rates'->>'email')::int AS cost
             FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now()
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
            ORDER BY c.scheduled_at LOOP
    v_cum := v_cum + COALESCE(r.cost, 0);
    IF v_cum > v_balance THEN
      v_short := true;
      v_items := v_items || jsonb_build_object('id', 'yunits_short:' || r.id, 'kind', 'yunits_short', 'cat', 'envois', 'tone', 'todo',
        'need', true, 'lock', false, 'pref', 'bloque', 'at', now(), 'due_at', r.scheduled_at,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'missing', v_cum - v_balance, 'cost', r.cost, 'balance', v_balance));
      EXIT;
    END IF;
  END LOOP;

  -- La synchro Shotgun interrompue (verrouillée), puis reprise.
  FOR r IN SELECT c.id, c.status, c.last_ok_at, c.last_error_at, c.fail_count FROM public.ticketing_connections c
            WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id) LOOP
    IF r.status = 'token_invalid'
       OR (r.last_error_at IS NOT NULL AND (r.last_ok_at IS NULL OR r.last_error_at > r.last_ok_at) AND COALESCE(r.fail_count, 0) >= 3) THEN
      v_items := v_items || jsonb_build_object('id', 'sync_broken:' || r.id || ':' || to_char(COALESCE(r.last_ok_at, r.last_error_at, now()), 'YYYYMMDD'),
        'kind', 'sync_broken', 'cat', 'donnees', 'tone', 'todo', 'need', true, 'lock', true, 'pref', 'sync',
        'at', COALESCE(r.last_error_at, now()), 'due_at', NULL, 'params', jsonb_build_object('since_at', COALESCE(r.last_ok_at, r.last_error_at)));
    ELSIF r.last_error_at IS NOT NULL AND r.last_error_at > now() - interval '7 days' AND r.last_ok_at > r.last_error_at THEN
      v_items := v_items || jsonb_build_object('id', 'sync_resolved:' || r.id || ':' || to_char(r.last_ok_at, 'YYYYMMDD'),
        'kind', 'sync_resolved', 'cat', 'donnees', 'tone', 'ok', 'need', false, 'lock', false, 'pref', 'sync',
        'at', r.last_ok_at, 'due_at', NULL, 'params', '{}'::jsonb);
    END IF;
  END LOOP;

  -- L'abonnement : essai qui finit, compte en pause.
  FOR r IN SELECT s.status, s.trial_ends_at, s.stripe_subscription_id FROM public.crm_subscriptions s WHERE s.scope_key = v_scope LOOP
    IF r.status = 'trialing' AND r.stripe_subscription_id IS NULL AND r.trial_ends_at > now() AND r.trial_ends_at <= now() + interval '3 days' THEN
      v_items := v_items || jsonb_build_object('id', 'trial_ending:' || to_char(r.trial_ends_at, 'YYYYMMDD'),
        'kind', 'trial_ending', 'cat', 'compte', 'tone', 'warn', 'need', true, 'lock', false, 'pref', NULL,
        'at', r.trial_ends_at - interval '3 days', 'due_at', NULL,
        'params', jsonb_build_object('days', GREATEST(1, ceil(extract(epoch FROM r.trial_ends_at - now()) / 86400))::int));
    END IF;
  END LOOP;
  IF public.crm_effective_plan(v_scope) = 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'account_paused', 'kind', 'account_paused', 'cat', 'compte', 'tone', 'todo',
      'need', true, 'lock', true, 'pref', NULL, 'at', now(), 'due_at', NULL, 'params', '{}'::jsonb);
  END IF;

  -- ── Historique (30 jours) ─────────────────────────────────────────────────
  FOR r IN SELECT c.id, c.name, c.sent_at, COALESCE(NULLIF(c.recipients_count, 0), c.total_recipients, 0) AS n,
                  COALESCE(c.clickers_count, 0) AS clickers, COALESCE(c.policy_skipped_count, 0) + COALESCE(c.suppressed_count, 0) AS excluded
             FROM public.email_campaigns c
            WHERE c.status = 'sent' AND c.sent_at > now() - interval '30 days'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_done:' || r.id, 'kind', 'send_done', 'cat', 'envois', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'prog', 'at', r.sent_at, 'due_at', NULL,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.sent_at, 'recipients', r.n));
    IF r.sent_at < now() - interval '20 hours' THEN
      SELECT buyers INTO v_buyers FROM public.crm_notif_report_cache WHERE campaign_id = r.id;
      IF v_buyers IS NULL AND p_enrich AND v_left > 0 THEN
        v_left := v_left - 1;
        BEGIN
          v_buyers := COALESCE((public.crm_email_result__core(p_venue_id, p_organizer_user_id, r.id)->'stats'->>'purchases')::int, 0);
          BEGIN
            INSERT INTO public.crm_notif_report_cache (campaign_id, buyers) VALUES (r.id, v_buyers)
            ON CONFLICT (campaign_id) DO UPDATE SET buyers = EXCLUDED.buyers, computed_at = now();
          EXCEPTION WHEN others THEN NULL;
          END;
        EXCEPTION WHEN others THEN v_buyers := NULL;
        END;
      END IF;
      v_items := v_items || jsonb_build_object('id', 'send_report:' || r.id, 'kind', 'send_report', 'cat', 'envois', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'rapport', 'at', r.sent_at + interval '20 hours', 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'clickers', r.clickers, 'buyers', v_buyers));
    END IF;
    IF r.excluded > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'send_blocked:' || r.id, 'kind', 'send_blocked', 'cat', 'envois', 'tone', 'warn',
        'need', false, 'lock', false, 'pref', 'bloque', 'at', r.sent_at, 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'excluded', r.excluded));
    END IF;
  END LOOP;

  FOR r IN SELECT i.list_import_id, i.finished_at, i.new_count, i.existing_count, i.file_dup_count FROM public.crm_imports i
            WHERE i.scope_key = v_scope AND i.status = 'done' AND i.finished_at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'import_done:' || r.list_import_id, 'kind', 'import_done', 'cat', 'donnees', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'import', 'at', r.finished_at, 'due_at', NULL,
      'params', jsonb_build_object('added', COALESCE(r.new_count, 0), 'merged', COALESCE(r.existing_count, 0) + COALESCE(r.file_dup_count, 0)));
  END LOOP;

  FOR r IN SELECT count(*)::int AS n FROM public.contact_engagement e WHERE e.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id) AND e.status = 'unreachable' LOOP
    IF r.n > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'contacts_unreadable:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
        'kind', 'contacts_unreadable', 'cat', 'donnees', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'import',
        'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
        'params', jsonb_build_object('n', r.n));
    END IF;
  END LOOP;

  FOR r IN SELECT m.id, m.at, m.delta FROM public.crm_yunit_moves m
            WHERE m.scope_key = v_scope AND m.kind = 'credit' AND m.lot_kind = 'purchase' AND m.at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'recharge_done:' || r.id, 'kind', 'recharge_done', 'cat', 'compte', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'facture', 'at', r.at, 'due_at', NULL,
      'params', jsonb_build_object('amount', r.delta, 'balance', v_balance));
  END LOOP;

  IF NOT v_short AND v_balance < v_threshold AND public.crm_effective_plan(v_scope) <> 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'yunits_low:' || v_threshold || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
      'kind', 'yunits_low', 'cat', 'envois', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'solde',
      'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
      'params', jsonb_build_object('balance', v_balance, 'threshold', v_threshold));
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    FOR r IN SELECT om.id, om.accepted_at, om.member_user_id,
                    COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), om.member_email) AS name
               FROM public.org_members om LEFT JOIN public.profiles p ON p.id = om.member_user_id
              WHERE om.organizer_user_id = p_organizer_user_id AND om.invitation_status = 'accepted'
                AND om.accepted_at > now() - interval '30 days' AND om.member_user_id IS DISTINCT FROM p_user LOOP
      v_items := v_items || jsonb_build_object('id', 'team_joined:' || r.id, 'kind', 'team_joined', 'cat', 'compte', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'equipe', 'at', r.accepted_at, 'due_at', NULL,
        'params', jsonb_build_object('name', r.name));
    END LOOP;
  END IF;

  -- ── Préférences et état de la personne ────────────────────────────────────
  FOR it IN SELECT x FROM jsonb_array_elements(v_items) x LOOP
    k := it->>'pref';
    -- Coupée « dans Yuno » : on ne la montre pas (sauf alerte verrouillée).
    CONTINUE WHEN k IS NOT NULL AND NOT COALESCE((it->>'lock')::boolean, false)
                  AND COALESCE((v_kinds->k->>'app')::boolean, true)
                  AND NOT COALESCE((v_kinds->k->>'a')::boolean, true);
    SELECT * INTO st FROM public.crm_notification_states
     WHERE scope_key = v_scope AND user_id = p_user AND item_id = it->>'id';
    v_out := v_out || jsonb_build_array((it - 'pref') || jsonb_build_object(
      'icon', it->>'kind', 'resolved', false, 'href', NULL,
      'read', st.read_at IS NOT NULL, 'archived', st.archived_at IS NOT NULL,
      'snoozed_until', CASE WHEN st.snoozed_until > now() THEN st.snoozed_until END));
  END LOOP;

  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'need')::boolean DESC, (x->>'at')::timestamptz DESC)
                     FROM jsonb_array_elements(v_out) x), '[]'::jsonb);
END;
$function$;
