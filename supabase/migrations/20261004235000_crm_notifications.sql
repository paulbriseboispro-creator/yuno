-- Yuno CRM — le centre de notifications (cloche, page /crm/notifications).
--
-- Les notifications ne sont pas écrites par des déclencheurs : elles se
-- DÉDUISENT à la lecture des tables qui font foi (campagnes, imports,
-- recharges, équipe, connexion Shotgun, abonnement), sur 30 jours. Rien à
-- rattraper, rien qui diverge. Chaque élément a un identifiant stable
-- (`send_done:<campagne>`, `sync_broken:<connexion>:<jour>`…) sur lequel la
-- personne pose SON état : lu, archivé, reporté (crm_notification_states).
--
--   _crm_campaign_estimate  destinataires probables d'une campagne programmée
--                           (sa file n'existe pas encore), en cache 30 min ;
--                           remplace l'appel à count_campaign_audience du
--                           portefeuille, qui refusait les membres d'équipe.
--   _crm_notif_list         la liste d'une personne : préférences « dans Yuno »
--                           (crm_notification_prefs), états, achats du bilan
--                           calculés une fois puis gardés (crm_notif_report_cache).
--   get_crm_notifications   l'écran ; crm_notifications_mark les gestes ;
--   get_crm_shell           compte désormais ces notifications-là.
--
-- Une session d'aperçu démo est en lecture seule : toute écriture de cache est
-- protégée, la lecture ne tombe jamais pour elle.

CREATE TABLE IF NOT EXISTS public.crm_notification_states (
  scope_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  read_at timestamptz,
  archived_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, user_id, item_id)
);
ALTER TABLE public.crm_notification_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_notification_states FROM anon, authenticated;
COMMENT ON TABLE public.crm_notification_states IS
  'Yuno CRM : lu / archivé / reporté, par personne et par notification. RLS sans policy : get_crm_notifications, crm_notifications_mark.';

CREATE TABLE IF NOT EXISTS public.crm_notif_report_cache (
  campaign_id uuid PRIMARY KEY REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  buyers integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_notif_report_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_notif_report_cache FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_campaign_estimates (
  campaign_id uuid PRIMARY KEY REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  recipients integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_campaign_estimates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_campaign_estimates FROM anon, authenticated;

-- Destinataires probables d'une campagne : sa file si elle existe, sinon son
-- audience CRM du moment (cache 30 min). Jamais d'exception : 0 au pire.
CREATE OR REPLACE FUNCTION public._crm_campaign_estimate(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.email_campaigns%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_n := COALESCE(NULLIF(c.total_recipients, 0), NULLIF(c.recipients_count, 0));
  IF v_n IS NOT NULL THEN RETURN v_n; END IF;

  SELECT recipients INTO v_n FROM public.crm_campaign_estimates
   WHERE campaign_id = p_campaign_id AND computed_at > now() - interval '30 minutes';
  IF v_n IS NOT NULL THEN RETURN v_n; END IF;

  BEGIN
    SELECT count(DISTINCT lower(a.email))::int INTO v_n
      FROM public._crm_campaign_audience(p_campaign_id) a
     WHERE a.email IS NOT NULL AND NOT public.is_email_suppressed(lower(a.email));
  EXCEPTION WHEN others THEN
    RETURN 0;
  END;
  BEGIN
    INSERT INTO public.crm_campaign_estimates (campaign_id, recipients, computed_at)
    VALUES (p_campaign_id, COALESCE(v_n, 0), now())
    ON CONFLICT (campaign_id) DO UPDATE SET recipients = EXCLUDED.recipients, computed_at = now();
  EXCEPTION WHEN others THEN NULL;   -- aperçu en lecture seule : on garde le calcul
  END;
  RETURN COALESCE(v_n, 0);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_campaign_estimate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_campaign_estimate(uuid) TO service_role;

-- Le portefeuille : même calcul, estimation par l'aide interne.
CREATE OR REPLACE FUNCTION public.get_crm_wallet(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  cfg jsonb := public.crm_pricing_config();
  v_balance integer;
  v_lots jsonb;
  v_moves jsonb;
  v_credits jsonb;
  v_reserved jsonb;
  v_reserved_total integer;
  v_spent_month integer;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_balance := public.crm_yunits_balance(v_scope);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', k, 'remaining', rem, 'expires_at', exp) ORDER BY exp NULLS LAST), '[]'::jsonb)
    INTO v_lots
    FROM (
      SELECT CASE WHEN kind IN ('purchase', 'refund') THEN 'purchase'
                  WHEN kind IN ('grant', 'annual_bonus') THEN 'bonus'
                  ELSE kind END AS k,
             sum(remaining)::int AS rem, min(expires_at) AS exp
        FROM public.crm_yunit_lots
       WHERE scope_key = v_scope AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())
       GROUP BY 1
    ) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', at, 'delta', delta, 'kind', kind, 'lot_kind', lot_kind,
                                               'channel', channel, 'label', label, 'ref_type', ref_type, 'ref_id', ref_id,
                                               'meta', meta) ORDER BY at DESC), '[]'::jsonb)
    INTO v_moves
    FROM (SELECT * FROM public.crm_yunit_moves WHERE scope_key = v_scope ORDER BY at DESC LIMIT 30) m;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', at, 'delta', delta, 'lot_kind', lot_kind, 'label', label, 'meta', meta)
                            ORDER BY at DESC), '[]'::jsonb)
    INTO v_credits
    FROM (SELECT * FROM public.crm_yunit_moves
           WHERE scope_key = v_scope AND kind = 'credit' ORDER BY at DESC LIMIT 20) c;

  WITH sched AS (
    SELECT c.id::text AS id, c.name, 'email'::text AS channel, c.scheduled_at AS at,
           public._crm_campaign_estimate(c.id) * (cfg->'rates'->>'email')::int AS cost
      FROM public.email_campaigns c
     WHERE c.status = 'scheduled' AND c.scheduled_at > now()
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
    UNION ALL
    SELECT s.id::text, s.name, 'sms', s.scheduled_at,
           GREATEST(COALESCE(s.estimated_recipients, 0), 0) * GREATEST(COALESCE(s.segments_per_message, 1), 1) * (cfg->'rates'->>'sms')::int
      FROM public.sms_campaigns s
     WHERE s.status = 'scheduled' AND s.scheduled_at > now()
       AND s.venue_id IS NOT DISTINCT FROM p_venue_id AND s.organizer_id IS NOT DISTINCT FROM p_organizer_user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'channel', channel, 'at', at, 'cost', cost) ORDER BY at), '[]'::jsonb),
         COALESCE(sum(cost), 0)::int
    INTO v_reserved, v_reserved_total
    FROM sched;

  SELECT COALESCE(-sum(delta), 0)::int INTO v_spent_month
    FROM public.crm_yunit_moves
   WHERE scope_key = v_scope AND kind = 'debit'
     AND at >= date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';

  RETURN jsonb_build_object(
    'balance', v_balance, 'lots', v_lots, 'moves', v_moves, 'credits', v_credits,
    'reserved', v_reserved, 'reserved_total', v_reserved_total, 'spent_month', v_spent_month,
    'low_balance', (cfg->>'low_balance')::int, 'rates', cfg->'rates', 'channels_live', cfg->'channels_live');
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_wallet(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_wallet(text, uuid) TO authenticated, service_role;

-- La liste d'une personne. p_enrich : calcule les achats d'au plus deux bilans
-- encore inconnus (lent : ~0,8 s chacun), seulement pour l'écran.
CREATE OR REPLACE FUNCTION public._crm_notif_list(p_venue_id text, p_organizer_user_id uuid, p_user uuid, p_enrich boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  FOR r IN SELECT count(*)::int AS n FROM public.contact_engagement e WHERE e.scope_key = v_scope AND e.status = 'unreachable' LOOP
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
$$;
REVOKE ALL ON FUNCTION public._crm_notif_list(text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_notif_list(text, uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_crm_notifications(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public._crm_notif_list(p_venue_id, p_organizer_user_id, auth.uid(), true);
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_notifications(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_notifications(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_notifications_mark(p_venue_id text, p_organizer_user_id uuid, p_ids text[], p_action text, p_until timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_id text;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('read', 'unread', 'archive', 'unarchive', 'snooze', 'keep') THEN
    RAISE EXCEPTION 'bad_action' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'snooze' AND (p_until IS NULL OR p_until <= now() OR p_until > now() + interval '30 days') THEN
    RAISE EXCEPTION 'bad_until' USING ERRCODE = '22023';
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_ids, '{}'::text[]) LOOP
    CONTINUE WHEN v_id IS NULL OR length(v_id) > 200;
    INSERT INTO public.crm_notification_states AS s (scope_key, user_id, item_id, read_at, archived_at, snoozed_until)
    VALUES (v_scope, auth.uid(), v_id,
            CASE WHEN p_action IN ('read', 'archive') THEN now() END,
            CASE WHEN p_action = 'archive' THEN now() END,
            CASE WHEN p_action = 'snooze' THEN p_until END)
    ON CONFLICT (scope_key, user_id, item_id) DO UPDATE SET
      read_at = CASE p_action WHEN 'read' THEN COALESCE(s.read_at, now()) WHEN 'archive' THEN COALESCE(s.read_at, now())
                              WHEN 'unread' THEN NULL ELSE s.read_at END,
      archived_at = CASE p_action WHEN 'archive' THEN now() WHEN 'unarchive' THEN NULL WHEN 'keep' THEN NULL ELSE s.archived_at END,
      snoozed_until = CASE p_action WHEN 'snooze' THEN p_until WHEN 'keep' THEN NULL ELSE s.snoozed_until END,
      updated_at = now();
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_notifications_mark(text, uuid, text[], text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_notifications_mark(text, uuid, text[], text, timestamptz) TO authenticated, service_role;

-- La barre du haut : la cloche compte ces notifications-là (et non plus le flux
-- de la Suite), l'argent réservé suit la même estimation que le portefeuille.
CREATE OR REPLACE FUNCTION public.get_crm_shell(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
   WHERE e.scope_key = v_scope AND e.status = 'unreachable';

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
$$;
REVOKE ALL ON FUNCTION public.get_crm_shell(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_shell(text, uuid) TO authenticated, service_role;
