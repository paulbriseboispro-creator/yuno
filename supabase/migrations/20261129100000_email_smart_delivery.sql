-- L'envoi intelligent, sur le modèle de Shopify Messaging (03/11, demande de Paul :
-- « développe tout le système intelligent de Shopify, adapté à notre taille »).
-- Plan et règles : docs/designs/EMAIL_SENDER_DOMAINS_PLAN.md, sections 6 et 7.
--
-- Shopify tient sur un domaine commun parce qu'il retire d'office ceux qui
-- n'ouvrent plus (« Smart delivery »), plafonne chaque boutique, met en pause sur
-- de mauvais signaux et nettoie la liste avant chaque envoi. Notre domaine commun
-- est bien plus petit : un seul pro y pèse lourd, donc les mêmes règles, plus
-- strictes. Ce qui arrive ici :
--
-- 1. ENVOI INTELLIGENT, à la mise en file d'une campagne marketing :
--    · toujours : adresses qui ne peuvent pas être une personne (noreply@,
--      postmaster@, boîtes jetables…) écartées (`junk_address`) ;
--    · audience d'au moins `smart_min_audience` (300) : un contact qui a reçu au
--      moins `smart_min_received` (3) e-mails marketing de CE compte en
--      `smart_days` (180) jours sans en ouvrir ni cliquer un seul est écarté
--      (`unengaged`). Jamais un contact inscrit récemment. Yunits rendus.
--      Le super admin peut le couper pour un compte (email_sender_health.smart_off).
-- 2. GARDE DE CAMPAGNE (toutes les 15 min, pendant l'envoi) : 2 h après le
--    départ et dès 300 envois, si moins de 5 % ont ouvert, Yuno recentre la
--    campagne sur les contacts engagés (le reste est écarté, `refocus_low_opens`) ;
--    si Gmail ouvre moins du tiers des autres messageries, il recentre les Gmail
--    (`refocus_gmail`). Comme Shopify qui met en pause sur peu d'ouvertures, mais
--    les engagés reçoivent quand même leur e-mail.
-- 3. DISJONCTEUR plus strict : plaintes > 0,1 % (au moins 2) ou rebonds > 3 %
--    (avant : 0,2 % et 5 %) ⇒ campagne en pause.
-- 4. Vagues d'adresses jamais écrites : arrêt dès 2 % de rebonds ou 0,5 ‰ de
--    plaintes (avant 3 % et 1 ‰) ; au plus 3 000 adresses jamais écrites PAR MOIS
--    et par compte sur le domaine commun.
-- 5. RÉCIDIVE : deux incidents en 60 jours (vague arrêtée, campagne en pause,
--    compte mis à l'écart, campagne recentrée faute d'ouvertures) ⇒ plus aucune
--    adresse jamais écrite pour ce compte jusqu'à décision de Yuno
--    (`admin_lift_sender_freeze`). Ses contacts engagés continuent de recevoir.
-- 6. Domaine commun : niveau 3 au plus (`shared_max_level`), jamais 4 ni 5.
-- 7. BILAN QUOTIDIEN (8 h, Paris) : une photo par jour dans
--    email_deliverability_snapshots et une alerte super admin `admin_email_daily`.
-- 8. Lecture des schémas de la page Santé : email_sender_health_visual.
--
-- Tous les seuils sont des colonnes de email_deliverability_settings.

-- ── Réglages ────────────────────────────────────────────────────────────────
ALTER TABLE public.email_deliverability_settings
  ADD COLUMN IF NOT EXISTS smart_on boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS smart_min_audience integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS smart_min_received integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS smart_days integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS guard_on boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guard_min_sent integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS guard_wait_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS guard_open_pct numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS guard_gmail_relative numeric NOT NULL DEFAULT 0.33,
  ADD COLUMN IF NOT EXISTS breaker_complaint_pct numeric NOT NULL DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS breaker_bounce_pct numeric NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS cold_monthly_cap integer NOT NULL DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS shared_max_level smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS recidive_window_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS recidive_count integer NOT NULL DEFAULT 2;

-- Domaine commun = règles plus strictes (plan, section 7).
UPDATE public.email_deliverability_settings
   SET halt_bounce_pct = LEAST(halt_bounce_pct, 2),
       halt_complaint_permille = LEAST(halt_complaint_permille, 0.5),
       updated_at = now()
 WHERE id;

ALTER TABLE public.email_sender_health
  ADD COLUMN IF NOT EXISTS smart_off boolean NOT NULL DEFAULT false;

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS smart_skipped integer,
  ADD COLUMN IF NOT EXISTS guard_state text,
  ADD COLUMN IF NOT EXISTS guard_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS guard_note jsonb;
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_guard_state_check;
ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_guard_state_check
  CHECK (guard_state IS NULL OR guard_state IN ('ok', 'gmail_refocused', 'refocused'));
CREATE INDEX IF NOT EXISTS idx_email_campaigns_guard_sending
  ON public.email_campaigns (guard_checked_at NULLS FIRST) WHERE status = 'sending';

-- ── Incidents d'un compte (la récidive se compte ici) ──────────────────────
CREATE TABLE IF NOT EXISTS public.email_sender_incidents (
  id bigserial PRIMARY KEY,
  scope_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('wave_halt', 'breaker', 'probation', 'low_opens')),
  campaign_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_sender_incidents_scope ON public.email_sender_incidents (scope_key, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_sender_incidents_campaign
  ON public.email_sender_incidents (scope_key, kind, campaign_id) WHERE campaign_id IS NOT NULL;
ALTER TABLE public.email_sender_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_sender_incidents FROM PUBLIC, anon, authenticated;

-- Une photo par jour de la santé de la plateforme (lue par le super admin et
-- par l'agent qui surveille).
CREATE TABLE IF NOT EXISTS public.email_deliverability_snapshots (
  day date PRIMARY KEY,
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_deliverability_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_deliverability_snapshots FROM PUBLIC, anon, authenticated;

-- ── Adresses qui ne peuvent pas être une personne ──────────────────────────
CREATE OR REPLACE FUNCTION public._email_is_junk_address(p_email text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT split_part(lower(p_email), '@', 1) IN (
           'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
           'postmaster', 'abuse', 'mailer-daemon', 'bounce', 'bounces', 'hostmaster', 'spam', 'root')
      OR split_part(lower(p_email), '@', 2) IN (
           'mailinator.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net', 'guerrillamail.com',
           'guerrillamail.net', 'sharklasers.com', '10minutemail.com', '10minutemail.net',
           'temp-mail.org', 'tempmail.com', 'trashmail.com', 'trashmail.fr', 'throwawaymail.com',
           'getnada.com', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'jetable.org',
           'spamgourmet.com', 'mintemail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com')
$$;
REVOKE ALL ON FUNCTION public._email_is_junk_address(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_is_junk_address(text) TO service_role;

-- ── 1. Envoi intelligent, à la mise en file ────────────────────────────────
-- Rend le résultat de la mise en file, compteurs diminués de ce qui est écarté.
CREATE OR REPLACE FUNCTION public._email_smart_delivery(p_campaign_id uuid, p_res jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  v_key text;
  v_audience integer;
  v_junk uuid[];
  v_cold uuid[];
  n_junk integer := 0;
  n_cold integer := 0;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  IF NOT FOUND OR NOT s.smart_on THEN RETURN p_res; END IF;
  SELECT ec.venue_id, ec.organizer_user_id INTO c FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  IF NOT FOUND THEN RETURN p_res; END IF;
  v_key := public._email_sender_key(c.venue_id, c.organizer_user_id);

  SELECT array_agg(r.id) INTO v_junk
    FROM public.email_campaign_recipients r
   WHERE r.campaign_id = p_campaign_id AND r.status = 'pending' AND public._email_is_junk_address(r.email);
  n_junk := public._email_skip_rows(p_campaign_id, v_junk, 'junk_address');

  SELECT count(*) INTO v_audience FROM public.email_campaign_recipients r
   WHERE r.campaign_id = p_campaign_id AND r.status = 'pending';

  IF v_audience >= s.smart_min_audience
     AND NOT EXISTS (SELECT 1 FROM public.email_sender_health h WHERE h.scope_key = v_key AND h.smart_off) THEN
    WITH camps AS (
      SELECT ec.id FROM public.email_campaigns ec
       WHERE public._email_sender_key(ec.venue_id, ec.organizer_user_id) = v_key
         AND ec.id <> p_campaign_id
         AND COALESCE(ec.type, 'promotional') = 'promotional' AND NOT COALESCE(ec.practical, false)
         AND COALESCE(ec.send_started_at, ec.created_at) > now() - make_interval(days => s.smart_days)
    ), p AS (
      SELECT r.id, lower(r.email) AS em FROM public.email_campaign_recipients r
       WHERE r.campaign_id = p_campaign_id AND r.status = 'pending'
    ), got AS (
      SELECT lower(x.email) AS em FROM public.email_campaign_recipients x
       WHERE x.campaign_id IN (SELECT id FROM camps) AND x.status = 'sent'
         AND x.sent_at > now() - make_interval(days => s.smart_days)
       GROUP BY 1 HAVING count(*) >= s.smart_min_received
    ), eng AS (
      SELECT DISTINCT lower(ev.recipient_email) AS em FROM public.email_campaign_events ev
       WHERE ev.campaign_id IN (SELECT id FROM camps) AND ev.event_type IN ('opened', 'clicked')
    ), fr AS (SELECT f.em FROM public._email_fresh_optins(ARRAY(SELECT em FROM p)) f)
    SELECT array_agg(p.id) INTO v_cold
      FROM p JOIN got ON got.em = p.em
     WHERE NOT EXISTS (SELECT 1 FROM eng WHERE eng.em = p.em)
       AND NOT EXISTS (SELECT 1 FROM fr WHERE fr.em = p.em);
    n_cold := public._email_skip_rows(p_campaign_id, v_cold, 'unengaged');
  END IF;

  IF n_junk + n_cold = 0 THEN RETURN p_res; END IF;
  UPDATE public.email_campaigns SET smart_skipped = COALESCE(smart_skipped, 0) + n_junk + n_cold WHERE id = p_campaign_id;
  RETURN p_res || jsonb_build_object('smart_unengaged', n_cold, 'smart_junk', n_junk,
    'queued', GREATEST(0, COALESCE((p_res->>'queued')::int, 0) - n_junk - n_cold),
    'total', GREATEST(0, COALESCE((p_res->>'total')::int, 0) - n_junk - n_cold),
    'remaining', GREATEST(0, COALESCE((p_res->>'remaining')::int, 0) - n_junk - n_cold));
END $$;
REVOKE ALL ON FUNCTION public._email_smart_delivery(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_smart_delivery(uuid, jsonb) TO service_role;

-- Branché dans _email_assign_waves juste après l'envoi réparti : les vagues ne
-- se calculent que sur ce qui reste.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public._email_assign_waves(uuid, jsonb)'::regprocedure);
  a text := E'  IF public._email_enforce_spread(p_campaign_id) THEN\n    p_res := p_res || jsonb_build_object(''spread_forced'', true);\n  END IF;';
BEGIN
  IF position('_email_smart_delivery' in v_def) > 0 THEN RETURN; END IF;
  IF position(a in v_def) = 0 THEN RAISE EXCEPTION '_email_assign_waves : point d''ancrage introuvable'; END IF;
  v_def := replace(v_def, a, a || E'\n  -- Envoi intelligent (20261129100000) : adresses impossibles et contacts qui n''ouvrent plus.\n  p_res := public._email_smart_delivery(p_campaign_id, p_res);');
  EXECUTE v_def;
END $do$;

-- ── 4. Plafond MENSUEL d'adresses jamais écrites ───────────────────────────
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public._email_release_waves(uuid)'::regprocedure);
  a1 text := E'  v_groom integer;';
  a2 text := E'  IF v_room = 0 THEN RETURN 0; END IF;';
BEGIN
  IF position('cold_monthly_cap' in v_def) > 0 THEN RETURN; END IF;
  IF position(a1 in v_def) = 0 OR position(a2 in v_def) = 0 THEN
    RAISE EXCEPTION '_email_release_waves : points d''ancrage introuvables';
  END IF;
  v_def := replace(v_def, a1, a1 || E'\n  v_mused integer;');
  v_def := replace(v_def, a2, E'  -- Plafond mensuel (20261129100000) : 3 000 adresses jamais écrites par mois et par compte.\n'
    || E'  SELECT count(*) INTO v_mused FROM public.email_campaign_recipients r\n'
    || E'    JOIN public.email_campaigns ec ON ec.id = r.campaign_id\n'
    || E'   WHERE r.wave >= 1 AND r.wave_released_at IS NOT NULL\n'
    || E'     AND r.wave_released_at >= (date_trunc(''month'', now() AT TIME ZONE ''Europe/Paris'') AT TIME ZONE ''Europe/Paris'')\n'
    || E'     AND public._email_sender_key(ec.venue_id, ec.organizer_user_id) = v_key\n'
    || E'     AND ec.wave_state IS NOT NULL;\n'
    || E'  v_room := LEAST(v_room, GREATEST(0, s.cold_monthly_cap - v_mused));\n' || a2);
  EXECUTE v_def;
END $do$;

-- ── 6. Domaine commun : niveau 3 au plus ───────────────────────────────────
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public._email_sender_level_check(text)'::regprocedure);
  a text := E'  IF v_rel IS NULL THEN v_max := LEAST(v_max, 2); END IF;';
BEGIN
  IF position('shared_max_level' in v_def) > 0 THEN RETURN; END IF;
  IF position(a in v_def) = 0 THEN RAISE EXCEPTION '_email_sender_level_check : point d''ancrage introuvable'; END IF;
  v_def := replace(v_def, a, E'  -- Domaine commun (20261129100000) : jamais au-delà du niveau 3.\n  v_max := LEAST(v_max, COALESCE(s.shared_max_level, 3));\n' || a);
  EXECUTE v_def;
END $do$;
-- Un compte déjà plus haut redescend au plafond du domaine commun.
UPDATE public.email_sender_health h
   SET level = (SELECT shared_max_level FROM public.email_deliverability_settings WHERE id), level_since = now(), updated_at = now()
 WHERE h.level > (SELECT shared_max_level FROM public.email_deliverability_settings WHERE id)
   AND NOT h.burst_allowed;

-- ── 5. Incidents et récidive ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._email_sender_incident(p_key text, p_kind text, p_campaign_id uuid, p_detail jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  n integer;
BEGIN
  IF p_key IS NULL OR p_key = 'yuno' THEN RETURN false; END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  INSERT INTO public.email_sender_incidents (scope_key, kind, campaign_id, detail)
  VALUES (p_key, p_kind, p_campaign_id, COALESCE(p_detail, '{}'::jsonb))
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM public.email_sender_incidents i
   WHERE i.scope_key = p_key AND i.at > now() - make_interval(days => s.recidive_window_days);
  IF n < s.recidive_count THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.email_sender_health h WHERE h.scope_key = p_key AND h.reason = 'recidive'
               AND h.cold_frozen_until > now()) THEN
    RETURN false;
  END IF;
  INSERT INTO public.email_sender_health (scope_key, cold_frozen_until, reason, metrics, level, level_since, updated_at)
  VALUES (p_key, now() + interval '3650 days', 'recidive', jsonb_build_object('incidents', n, 'last', p_kind), 1, now(), now())
  ON CONFLICT (scope_key) DO UPDATE
    SET cold_frozen_until = now() + interval '3650 days', reason = 'recidive',
        metrics = EXCLUDED.metrics, level = 1, level_since = now(), updated_at = now();
  INSERT INTO public.email_sender_level_history (scope_key, from_level, to_level, reason, metrics)
  SELECT p_key, NULL, 1, 'recidive', jsonb_build_object('incidents', n);
  PERFORM public.emit_admin_notification(
    'admin_email_sender_recidive', 'Compte expéditeur bloqué pour récidive : ' || p_key,
    format('%s incidents en %s jours (dernier : %s). Plus aucune adresse jamais écrite jusqu''à votre décision (Admin › Santé technique). Ses contacts engagés continuent de recevoir.',
           n, s.recidive_window_days, p_kind),
    'urgent', 'email_sender', p_key, jsonb_build_object('scope_key', p_key, 'incidents', n),
    'email_sender_recidive:' || p_key || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  -- La surveillance ne fait jamais tomber l'envoi qu'elle observe.
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._email_sender_incident(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_sender_incident(text, text, uuid, jsonb) TO service_role;

-- Une vague arrêtée est un incident.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.email_waves_tick()'::regprocedure);
  a text := E'        v_out := v_out || jsonb_build_object(''campaign'', c.id, ''halted'', v_reason, ''skipped'', v_skipped);';
BEGIN
  IF position('_email_sender_incident' in v_def) > 0 THEN RETURN; END IF;
  IF position(a in v_def) = 0 THEN RAISE EXCEPTION 'email_waves_tick : point d''ancrage introuvable'; END IF;
  v_def := replace(v_def, a, E'        PERFORM public._email_sender_incident(v_key, ''wave_halt'', c.id, jsonb_build_object(''reason'', v_reason));\n' || a);
  EXECUTE v_def;
END $do$;

-- Un compte mis à l'écart sur 7 jours est un incident.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.email_deliverability_watch()'::regprocedure);
  a text := E'      v_flagged := v_flagged || jsonb_build_object(''scope'', r.k, ''reason'', v_reason);';
BEGIN
  IF position('_email_sender_incident' in v_def) > 0 THEN RETURN; END IF;
  IF position(a in v_def) = 0 THEN RAISE EXCEPTION 'email_deliverability_watch : point d''ancrage introuvable'; END IF;
  v_def := replace(v_def, a, E'      PERFORM public._email_sender_incident(r.k, ''probation'', NULL, jsonb_build_object(''reason'', v_reason, ''sent'', r.n));\n' || a);
  EXECUTE v_def;
END $do$;

-- ── 3. Disjoncteur plus strict (réglable), et compté comme incident ────────
CREATE OR REPLACE FUNCTION public.campaign_circuit_breaker(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  s public.email_deliverability_settings;
  v_signals integer;
  v_bounce_rate numeric := 0;
  v_complaint_rate numeric := 0;
  v_reason text := NULL;
BEGIN
  SELECT id, status, recipients_count, bounced_count, complained_count, venue_id, organizer_user_id
    INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;

  v_signals := GREATEST(c.recipients_count, 0);
  IF v_signals >= 200 THEN
    v_bounce_rate    := ROUND((c.bounced_count::numeric    / v_signals) * 100, 3);
    v_complaint_rate := ROUND((c.complained_count::numeric / v_signals) * 100, 3);
    IF v_complaint_rate > COALESCE(s.breaker_complaint_pct, 0.2) AND c.complained_count >= 2 THEN
      v_reason := 'complaint_rate';
    ELSIF v_bounce_rate > COALESCE(s.breaker_bounce_pct, 5) THEN
      v_reason := 'bounce_rate';
    END IF;
  END IF;

  IF v_reason IS NOT NULL AND c.status = 'sending' THEN
    UPDATE public.email_campaigns
       SET status = 'paused',
           paused_reason = v_reason,
           error_message = CASE v_reason
             WHEN 'complaint_rate' THEN 'Pause automatique : ' || v_complaint_rate || ' % de plaintes'
             ELSE 'Pause automatique : ' || v_bounce_rate || ' % d''adresses invalides'
           END
     WHERE id = p_campaign_id AND status = 'sending';
    PERFORM public._email_sender_incident(public._email_sender_key(c.venue_id, c.organizer_user_id), 'breaker', p_campaign_id,
      jsonb_build_object('reason', v_reason, 'bounce_rate', v_bounce_rate, 'complaint_rate', v_complaint_rate));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'signals', v_signals,
    'bounce_rate', v_bounce_rate,
    'complaint_rate', v_complaint_rate,
    'paused', v_reason IS NOT NULL,
    'reason', v_reason
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.campaign_circuit_breaker(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_circuit_breaker(uuid) TO service_role;

-- ── 2. Garde de campagne pendant l'envoi ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_campaign_guard_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  st record;
  v_key text;
  v_ids uuid[];
  v_skipped integer;
  v_out jsonb := '[]'::jsonb;
  v_cut timestamptz;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  IF NOT FOUND OR NOT s.guard_on THEN RETURN jsonb_build_object('off', true); END IF;
  v_cut := now() - make_interval(mins => s.guard_wait_minutes);
  FOR c IN
    SELECT ec.id, ec.name, ec.venue_id, ec.organizer_user_id, ec.guard_state
      FROM public.email_campaigns ec
     WHERE ec.status = 'sending'
       AND COALESCE(ec.type, 'promotional') = 'promotional' AND NOT COALESCE(ec.practical, false)
       AND ec.send_started_at IS NOT NULL AND ec.send_started_at < v_cut
       AND COALESCE(ec.guard_state, 'ok') <> 'refocused'
       AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id)
     ORDER BY ec.guard_checked_at NULLS FIRST
     LIMIT 20
  LOOP
    BEGIN
      v_key := public._email_sender_key(c.venue_id, c.organizer_user_id);
      WITH r AS (
        SELECT lower(rr.email) AS em, public._email_is_gmail(rr.email) AS gm
          FROM public.email_campaign_recipients rr
         WHERE rr.campaign_id = c.id AND rr.status IN ('sent', 'bounced', 'complained') AND rr.sent_at < v_cut
      ), o AS (
        SELECT DISTINCT lower(ev.recipient_email) AS em FROM public.email_campaign_events ev
         WHERE ev.campaign_id = c.id AND ev.event_type IN ('opened', 'clicked')
      )
      SELECT count(*) AS n, count(o.em) AS opened,
             count(*) FILTER (WHERE r.gm) AS g_n, count(o.em) FILTER (WHERE r.gm) AS g_o,
             count(*) FILTER (WHERE NOT r.gm) AS o_n, count(o.em) FILTER (WHERE NOT r.gm) AS o_o,
             (SELECT count(*) FROM public.email_campaign_recipients p WHERE p.campaign_id = c.id AND p.status = 'pending') AS pending
        INTO st FROM r LEFT JOIN o ON o.em = r.em;

      UPDATE public.email_campaigns SET guard_checked_at = now(),
             guard_note = COALESCE(guard_note, '{}'::jsonb) || jsonb_build_object(
               'sent', st.n, 'opened', st.opened, 'gmail_sent', st.g_n, 'gmail_opened', st.g_o,
               'other_sent', st.o_n, 'other_opened', st.o_o, 'at', now())
       WHERE id = c.id;
      IF st.pending = 0 OR st.n < s.guard_min_sent THEN CONTINUE; END IF;

      IF st.opened * 100.0 / st.n < s.guard_open_pct THEN
        -- Très peu d'ouvertures : on ne garde que les contacts engagés.
        WITH p AS (
          SELECT r.id, lower(r.email) AS em FROM public.email_campaign_recipients r
           WHERE r.campaign_id = c.id AND r.status = 'pending'
        ), fr AS (SELECT f.em FROM public._email_fresh_optins(ARRAY(SELECT em FROM p)) f)
        SELECT array_agg(p.id) INTO v_ids FROM p
         WHERE NOT EXISTS (SELECT 1 FROM public.email_campaign_events ev
                            WHERE ev.event_type IN ('opened', 'clicked')
                              AND lower(ev.recipient_email) = p.em
                              AND ev.created_at > now() - make_interval(days => s.smart_days))
           AND NOT EXISTS (SELECT 1 FROM fr WHERE fr.em = p.em);
        v_skipped := public._email_skip_rows(c.id, v_ids, 'refocus_low_opens');
        UPDATE public.email_campaigns SET guard_state = 'refocused',
               smart_skipped = COALESCE(smart_skipped, 0) + v_skipped,
               guard_note = guard_note || jsonb_build_object('refocus', 'low_opens', 'skipped', v_skipped)
         WHERE id = c.id;
        PERFORM public._email_sender_incident(v_key, 'low_opens', c.id,
          jsonb_build_object('sent', st.n, 'opened', st.opened, 'skipped', v_skipped));
        PERFORM public.emit_admin_notification(
          'admin_email_campaign_refocused', 'Campagne recentrée : ' || COALESCE(c.name, 'campagne'),
          format('« %s » (%s) : %s ouvertures sur %s envois après %s minutes. Yuno n''envoie plus qu''aux contacts engagés ; %s contacts écartés (Yunits rendus).',
                 c.name, v_key, st.opened, st.n, s.guard_wait_minutes, v_skipped),
          'high', 'email_campaign', c.id::text, jsonb_build_object('campaign_id', c.id, 'scope_key', v_key, 'reason', 'low_opens'),
          'email_campaign_refocused:' || c.id::text, NULL);
        v_out := v_out || jsonb_build_object('campaign', c.id, 'refocused', 'low_opens', 'skipped', v_skipped);
      ELSIF COALESCE(c.guard_state, 'ok') <> 'gmail_refocused'
            AND st.g_n >= 150 AND st.o_n >= 150 AND st.o_o > 0
            AND (st.g_o::numeric / st.g_n) < s.guard_gmail_relative * (st.o_o::numeric / st.o_n) THEN
        -- Gmail range la campagne en spam : seuls les Gmail engagés continuent.
        WITH p AS (
          SELECT r.id, lower(r.email) AS em FROM public.email_campaign_recipients r
           WHERE r.campaign_id = c.id AND r.status = 'pending' AND public._email_is_gmail(r.email)
        ), fr AS (SELECT f.em FROM public._email_fresh_optins(ARRAY(SELECT em FROM p)) f)
        SELECT array_agg(p.id) INTO v_ids FROM p
         WHERE NOT EXISTS (SELECT 1 FROM public.email_campaign_events ev
                            WHERE ev.event_type IN ('opened', 'clicked')
                              AND lower(ev.recipient_email) = p.em
                              AND ev.created_at > now() - make_interval(days => s.gmail_engaged_days))
           AND NOT EXISTS (SELECT 1 FROM fr WHERE fr.em = p.em);
        v_skipped := public._email_skip_rows(c.id, v_ids, 'refocus_gmail');
        UPDATE public.email_campaigns SET guard_state = 'gmail_refocused',
               smart_skipped = COALESCE(smart_skipped, 0) + v_skipped,
               guard_note = guard_note || jsonb_build_object('refocus', 'gmail', 'gmail_skipped', v_skipped)
         WHERE id = c.id;
        PERFORM public.emit_admin_notification(
          'admin_email_campaign_refocused', 'Campagne recentrée chez Gmail : ' || COALESCE(c.name, 'campagne'),
          format('« %s » (%s) : Gmail %s ouvertures sur %s, autres messageries %s sur %s. Seuls les Gmail engagés continuent ; %s écartés.',
                 c.name, v_key, st.g_o, st.g_n, st.o_o, st.o_n, v_skipped),
          'high', 'email_campaign', c.id::text, jsonb_build_object('campaign_id', c.id, 'scope_key', v_key, 'reason', 'gmail'),
          'email_campaign_refocused_gmail:' || c.id::text, NULL);
        v_out := v_out || jsonb_build_object('campaign', c.id, 'refocused', 'gmail', 'skipped', v_skipped);
      ELSE
        UPDATE public.email_campaigns SET guard_state = COALESCE(guard_state, 'ok') WHERE id = c.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('campaign', c.id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('campaigns', v_out);
END $$;
REVOKE ALL ON FUNCTION public.email_campaign_guard_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_guard_tick() TO service_role;

-- ── 7. Bilan quotidien ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_deliverability_daily()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  g record;
  d record;
  v_frozen integer;
  v_recid integer;
  v_pm jsonb;
  v_m jsonb;
  v_bad text[] := '{}';
  v_day date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  -- Ouvertures des envois de 6 h à 3 jours (le temps que les ouvertures arrivent).
  WITH x AS (
    SELECT lower(rr.email) AS em, rr.campaign_id, public._email_is_gmail(rr.email) AS gm
      FROM public.email_campaign_recipients rr
      JOIN public.email_campaigns ec ON ec.id = rr.campaign_id
     WHERE rr.status = 'sent' AND rr.sent_at BETWEEN now() - interval '3 days' AND now() - interval '6 hours'
       AND COALESCE(ec.type, 'promotional') = 'promotional'
       AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id)
  ), o AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em, ev.campaign_id
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.campaign_id IN (SELECT campaign_id FROM x)
  )
  SELECT count(*) FILTER (WHERE x.gm) AS gn, count(o.em) FILTER (WHERE x.gm) AS go,
         count(*) FILTER (WHERE NOT x.gm) AS on_, count(o.em) FILTER (WHERE NOT x.gm) AS oo
    INTO g FROM x LEFT JOIN o ON o.em = x.em AND o.campaign_id = x.campaign_id;

  -- Les dernières 24 h : envois, rebonds, plaintes, ce que les règles ont écarté.
  SELECT count(*) FILTER (WHERE rr.status IN ('sent', 'bounced', 'complained') AND rr.sent_at > now() - interval '24 hours') AS sent,
         count(*) FILTER (WHERE rr.status = 'bounced' AND rr.sent_at > now() - interval '24 hours') AS bounced,
         count(*) FILTER (WHERE rr.status = 'complained' AND rr.sent_at > now() - interval '24 hours') AS complained
    INTO d
    FROM public.email_campaign_recipients rr
    JOIN public.email_campaigns ec ON ec.id = rr.campaign_id
   WHERE rr.sent_at > now() - interval '24 hours'
     AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id);

  SELECT count(*) FILTER (WHERE h.cold_frozen_until > now()),
         count(*) FILTER (WHERE h.cold_frozen_until > now() AND h.reason = 'recidive')
    INTO v_frozen, v_recid FROM public.email_sender_health h;

  SELECT to_jsonb(p) INTO v_pm FROM (
    SELECT domain, day, spam_ratio, delivery_error_ratio FROM public.gmail_postmaster_daily
     ORDER BY day DESC, domain LIMIT 1) p;

  v_m := jsonb_build_object(
    'gmail_sent', g.gn, 'gmail_opened', g.go, 'other_sent', g.on_, 'other_opened', g.oo,
    'gmail_open_pct', CASE WHEN g.gn > 0 THEN round(g.go * 100.0 / g.gn, 1) END,
    'other_open_pct', CASE WHEN g.on_ > 0 THEN round(g.oo * 100.0 / g.on_, 1) END,
    'sent_24h', d.sent, 'bounced_24h', d.bounced, 'complained_24h', d.complained,
    'skipped_24h', (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
        SELECT replace(rr.error_message, 'policy:', '') AS k, count(*) AS n
          FROM public.email_campaign_recipients rr
         WHERE rr.status = 'skipped' AND rr.error_message LIKE 'policy:%' AND rr.created_at > now() - interval '24 hours'
         GROUP BY 1) z),
    'incidents_24h', (SELECT count(*) FROM public.email_sender_incidents i WHERE i.at > now() - interval '24 hours'),
    'paused_campaigns', (SELECT count(*) FROM public.email_campaigns ec WHERE ec.status = 'paused'
                          AND ec.paused_reason IN ('complaint_rate', 'bounce_rate') AND ec.updated_at > now() - interval '24 hours'),
    'refocused_24h', (SELECT count(*) FROM public.email_campaigns ec WHERE ec.guard_state IN ('refocused', 'gmail_refocused')
                       AND ec.guard_checked_at > now() - interval '24 hours'),
    'frozen_accounts', v_frozen, 'recidive_accounts', v_recid,
    'gmail_recovery', s.gmail_recovery, 'postmaster', v_pm);

  INSERT INTO public.email_deliverability_snapshots (day, metrics) VALUES (v_day, v_m)
  ON CONFLICT (day) DO UPDATE SET metrics = EXCLUDED.metrics, created_at = now();

  IF g.gn >= 100 AND g.on_ >= 100 AND g.oo > 0 AND (g.go::numeric / g.gn) < 0.5 * (g.oo::numeric / g.on_) THEN
    v_bad := array_append(v_bad, format('Gmail ouvre %s %% contre %s %% ailleurs', round(g.go * 100.0 / g.gn, 1), round(g.oo * 100.0 / g.on_, 1)));
  END IF;
  IF d.sent >= 200 AND d.bounced * 100.0 / d.sent > 2 THEN
    v_bad := array_append(v_bad, format('%s rebonds sur %s envois', d.bounced, d.sent));
  END IF;
  IF d.complained > 0 THEN v_bad := array_append(v_bad, format('%s plainte(s)', d.complained)); END IF;
  IF (v_pm->>'spam_ratio')::numeric > s.google_spam_watch THEN
    v_bad := array_append(v_bad, format('Postmaster : %s %% de spam signalé', round((v_pm->>'spam_ratio')::numeric * 100, 2)));
  END IF;

  PERFORM public.emit_admin_notification(
    'admin_email_daily',
    CASE WHEN cardinality(v_bad) > 0 THEN 'E-mails : à regarder aujourd''hui' ELSE 'E-mails : bilan du jour, tout va bien' END,
    format('Gmail %s %% d''ouvertures (%s envois), autres %s %% (%s). 24 h : %s envois, %s rebonds, %s plaintes. Comptes à l''écart : %s (dont %s en récidive). Reprise Gmail : %s.%s',
           COALESCE((v_m->>'gmail_open_pct'), '—'), g.gn, COALESCE((v_m->>'other_open_pct'), '—'), g.on_,
           d.sent, d.bounced, d.complained, v_frozen, v_recid,
           CASE WHEN s.gmail_recovery THEN 'allumée' ELSE 'éteinte' END,
           CASE WHEN cardinality(v_bad) > 0 THEN ' À regarder : ' || array_to_string(v_bad, ' ; ') || '.' ELSE '' END),
    CASE WHEN cardinality(v_bad) > 0 THEN 'high' ELSE 'low' END,
    'email_deliverability', 'daily', v_m, 'email_daily:' || v_day::text, NULL);
  RETURN v_m;
END $$;
REVOKE ALL ON FUNCTION public.email_deliverability_daily() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_deliverability_daily() TO service_role;

-- La surveillance quart d'heure par quart d'heure : vagues, soirées commencées,
-- garde de campagne ; chaque heure la surveillance des comptes ; à 6 h les
-- niveaux ; à 8 h le bilan du jour.
CREATE OR REPLACE FUNCTION public.email_deliverability_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_w jsonb;
  v_g jsonb := NULL;
  v_m jsonb := NULL;
  v_late jsonb := NULL;
  v_h integer := extract(hour FROM (now() AT TIME ZONE 'Europe/Paris'))::int;
BEGIN
  v_w := public.email_waves_tick();
  -- La soirée a commencé : le marketing qui reste en file ne part plus.
  BEGIN
    v_late := public.email_skip_after_event_start();
  EXCEPTION WHEN OTHERS THEN
    v_late := jsonb_build_object('error', SQLERRM);
  END;
  BEGIN
    v_g := public.email_campaign_guard_tick();
  EXCEPTION WHEN OTHERS THEN
    v_g := jsonb_build_object('error', SQLERRM);
  END;
  IF extract(minute FROM now()) < 15 THEN
    BEGIN
      v_m := public.email_deliverability_watch();
    EXCEPTION WHEN OTHERS THEN
      v_m := jsonb_build_object('error', SQLERRM);
    END;
  END IF;
  IF v_h = 6 AND extract(minute FROM now()) < 15 THEN
    BEGIN
      v_m := COALESCE(v_m, '{}'::jsonb) || jsonb_build_object('levels', public.email_sender_levels_tick());
    EXCEPTION WHEN OTHERS THEN
      v_m := COALESCE(v_m, '{}'::jsonb) || jsonb_build_object('levels_error', SQLERRM);
    END;
  END IF;
  IF v_h = 8 AND extract(minute FROM now()) < 15 THEN
    BEGIN
      v_m := COALESCE(v_m, '{}'::jsonb) || jsonb_build_object('daily', public.email_deliverability_daily());
    EXCEPTION WHEN OTHERS THEN
      v_m := COALESCE(v_m, '{}'::jsonb) || jsonb_build_object('daily_error', SQLERRM);
    END;
  END IF;
  RETURN jsonb_build_object('waves', v_w, 'late', v_late, 'guard', v_g, 'watch', v_m);
END $function$;
REVOKE ALL ON FUNCTION public.email_deliverability_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_deliverability_tick() TO service_role;

-- ── Lever un blocage (super admin, audité) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_lift_sender_freeze(p_scope_key text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  h public.email_sender_health;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO h FROM public.email_sender_health WHERE scope_key = p_scope_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  UPDATE public.email_sender_health
     SET cold_frozen_until = NULL, reason = 'lifted', updated_at = now()
   WHERE scope_key = p_scope_key;
  -- Les incidents passés ne comptent plus pour une nouvelle récidive.
  DELETE FROM public.email_sender_incidents WHERE scope_key = p_scope_key;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'email_sender_freeze_lifted', 'email_sender', p_scope_key,
          jsonb_build_object('reason', p_reason, 'was_until', h.cold_frozen_until, 'was_reason', h.reason));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.admin_lift_sender_freeze(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lift_sender_freeze(text, text) TO authenticated, service_role;

-- ── 8. Les schémas de la page Santé ────────────────────────────────────────
-- Ce que le compte peut envoyer AUJOURD'HUI (et ce qu'il a déjà utilisé), la
-- courbe de ses 30 derniers jours, ce que l'envoi intelligent a écarté, ses
-- incidents. Mêmes portes que email_sender_health_report.
CREATE OR REPLACE FUNCTION public.email_sender_health_visual(p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  v_key text := public._email_sender_key(p_venue_id, p_organizer_user_id);
  v_crm boolean := p_product = 'crm';
  v_ids uuid[];
  v_all uuid[];
  lv public.email_sender_levels;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_t0 timestamptz;
  v_m0 timestamptz;
  v_series jsonb;
  v_today_j jsonb;
  v_smart jsonb;
  v_inc jsonb;
BEGIN
  IF NOT (public.is_super_admin()
          OR (COALESCE(p_venue_id, p_organizer_user_id::text) IS NOT NULL
              AND (COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false)
                   OR COALESCE(public.contact_scope_allowed(p_venue_id, p_organizer_user_id), false)))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  lv := public._email_sender_level(v_key);
  v_t0 := v_today::timestamp AT TIME ZONE 'Europe/Paris';
  v_m0 := date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';

  -- Toutes les campagnes du compte (plafonds) et celles du produit (courbe).
  v_all := ARRAY(
    SELECT ec.id FROM public.email_campaigns ec
     WHERE public._email_sender_key(ec.venue_id, ec.organizer_user_id) = v_key
       AND COALESCE(ec.send_started_at, ec.created_at) > now() - interval '45 days');
  v_ids := ARRAY(
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.id = ANY (v_all)
       AND (p_product IS NULL
            OR (v_crm AND COALESCE(public.crm_campaign_is_crm(ec.id), false))
            OR (NOT v_crm AND NOT COALESCE(public.crm_campaign_is_crm(ec.id), false))));

  -- Aujourd'hui, face aux plafonds du niveau.
  SELECT jsonb_build_object(
           'sent', count(*) FILTER (WHERE rr.status IN ('sent', 'bounced', 'complained') AND rr.sent_at >= v_t0
                                      AND COALESCE(ec.type, 'promotional') = 'promotional' AND NOT COALESCE(ec.practical, false)),
           'daily_cap', lv.daily_cap,
           'cold', count(*) FILTER (WHERE rr.wave >= 1 AND rr.wave_released_at >= v_t0),
           'cold_cap', LEAST(s.cold_daily_cap, lv.cold_daily),
           'cold_gmail', count(*) FILTER (WHERE rr.wave >= 1 AND rr.wave_released_at >= v_t0 AND public._email_is_gmail(rr.email)),
           'cold_gmail_cap', LEAST(s.cold_gmail_daily_cap, lv.cold_gmail_daily),
           'cold_month', count(*) FILTER (WHERE rr.wave >= 1 AND rr.wave_released_at >= v_m0),
           'cold_month_cap', s.cold_monthly_cap,
           'per_hour', lv.per_hour,
           'level', lv.level, 'shared_max_level', s.shared_max_level)
    INTO v_today_j
    FROM public.email_campaign_recipients rr
    JOIN public.email_campaigns ec ON ec.id = rr.campaign_id
   WHERE rr.campaign_id = ANY (v_all)
     AND (rr.sent_at >= v_m0 OR rr.wave_released_at >= v_m0);

  -- Les 30 derniers jours, jour par jour (heure de Paris).
  WITH r AS (
    SELECT rr.campaign_id, lower(rr.email) AS em, rr.status, public._email_is_gmail(rr.email) AS gm,
           (rr.sent_at AT TIME ZONE 'Europe/Paris')::date AS d
      FROM public.email_campaign_recipients rr
     WHERE rr.campaign_id = ANY (v_ids)
       AND rr.status IN ('sent', 'bounced', 'complained') AND rr.sent_at > now() - interval '30 days'
  ), o AS (
    SELECT DISTINCT ev.campaign_id, lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.campaign_id = ANY (v_ids) AND ev.event_type IN ('opened', 'clicked')
  ), k AS (
    SELECT (rr.created_at AT TIME ZONE 'Europe/Paris')::date AS d, count(*) AS n
      FROM public.email_campaign_recipients rr
     WHERE rr.campaign_id = ANY (v_ids) AND rr.status = 'skipped' AND rr.error_message LIKE 'policy:%'
       AND rr.created_at > now() - interval '30 days'
     GROUP BY 1
  ), days AS (
    SELECT generate_series(v_today - 29, v_today, interval '1 day')::date AS d
  ), agg AS (
    SELECT r.d, count(*) AS sent,
           count(*) FILTER (WHERE r.status = 'bounced') AS bounced,
           count(*) FILTER (WHERE r.status = 'complained') AS complained,
           count(*) FILTER (WHERE r.gm) AS g_n, count(o.em) FILTER (WHERE r.gm) AS g_o,
           count(*) FILTER (WHERE NOT r.gm) AS o_n, count(o.em) FILTER (WHERE NOT r.gm) AS o_o
      FROM r LEFT JOIN o ON o.campaign_id = r.campaign_id AND o.em = r.em
     GROUP BY r.d
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'd', days.d, 'sent', COALESCE(agg.sent, 0), 'bounced', COALESCE(agg.bounced, 0),
           'complained', COALESCE(agg.complained, 0),
           'gmail_sent', COALESCE(agg.g_n, 0), 'gmail_opened', COALESCE(agg.g_o, 0),
           'other_sent', COALESCE(agg.o_n, 0), 'other_opened', COALESCE(agg.o_o, 0),
           'held', COALESCE(k.n, 0)) ORDER BY days.d), '[]'::jsonb)
    INTO v_series
    FROM days LEFT JOIN agg ON agg.d = days.d LEFT JOIN k ON k.d = days.d;

  -- Ce que l'envoi intelligent et la garde ont écarté (30 jours).
  SELECT jsonb_build_object(
           'unengaged', count(*) FILTER (WHERE rr.error_message = 'policy:unengaged'),
           'junk', count(*) FILTER (WHERE rr.error_message = 'policy:junk_address'),
           'refocus', count(*) FILTER (WHERE rr.error_message IN ('policy:refocus_low_opens', 'policy:refocus_gmail')),
           'on', s.smart_on AND NOT COALESCE((SELECT h.smart_off FROM public.email_sender_health h WHERE h.scope_key = v_key), false),
           'min_audience', s.smart_min_audience, 'min_received', s.smart_min_received, 'days', s.smart_days)
    INTO v_smart
    FROM public.email_campaign_recipients rr
   WHERE rr.campaign_id = ANY (v_ids) AND rr.status = 'skipped' AND rr.created_at > now() - interval '30 days';

  SELECT coalesce(jsonb_agg(jsonb_build_object('at', i.at, 'kind', i.kind, 'campaign_id', i.campaign_id,
           'campaign', (SELECT ec.name FROM public.email_campaigns ec WHERE ec.id = i.campaign_id)) ORDER BY i.at DESC), '[]'::jsonb)
    INTO v_inc
    FROM public.email_sender_incidents i
   WHERE i.scope_key = v_key AND i.at > now() - make_interval(days => s.recidive_window_days);

  RETURN jsonb_build_object(
    'today', v_today_j, 'series', v_series, 'smart', v_smart,
    'incidents', v_inc, 'recidive_count', s.recidive_count, 'recidive_window_days', s.recidive_window_days,
    'thresholds', jsonb_build_object('bounce_pct', s.halt_bounce_pct, 'complaint_permille', s.halt_complaint_permille,
                                     'gmail_relative', s.halt_gmail_relative, 'guard_open_pct', s.guard_open_pct),
    'generated_at', now());
END $$;
REVOKE ALL ON FUNCTION public.email_sender_health_visual(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sender_health_visual(text, uuid, text) TO authenticated, service_role;

-- La bannière d'une campagne dit aussi ce que l'envoi intelligent a écarté.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.email_campaign_send_rules(uuid)'::regprocedure);
  a1 text := E'         ec.spread_forced, ec.throttle_per_hour, ec.throttle_window_minutes';
  a2 text := E'    ''gmail_recovery'', s.gmail_recovery);';
BEGIN
  IF position('smart_skipped' in v_def) > 0 THEN RETURN; END IF;
  IF position(a1 in v_def) = 0 OR position(a2 in v_def) = 0 THEN
    RAISE EXCEPTION 'email_campaign_send_rules : points d''ancrage introuvables';
  END IF;
  v_def := replace(v_def, a1, a1 || E', ec.smart_skipped, ec.guard_state');
  v_def := replace(v_def, a2, E'    ''gmail_recovery'', s.gmail_recovery,\n    ''smart_skipped'', COALESCE(c.smart_skipped, 0), ''guard_state'', c.guard_state);');
  EXECUTE v_def;
END $do$;
