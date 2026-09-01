-- ───────────────────────────────────────────────────────────────────────────
-- Correctif d'allocation : les crédits consommés étaient comptés DEUX fois.
--
-- 20260901190000 calculait l'autorisation mensuelle comme
--   (gratuit + crédits_restants) − envoyés_du_mois
-- or les envois au-delà du gratuit ont DÉJÀ décrémenté le solde de crédits :
-- ils figurent à la fois dans « envoyés » et en creux dans « crédits ». Attrapé
-- au smoke test : un compte à 15 450 envoyés / 15 000 gratuits avec 550 crédits
-- restants ne pouvait plus en dépenser que 100 au lieu de 550.
--
-- La formule juste :  GREATEST(0, gratuit − envoyés) + crédits_restants
-- (le reliquat gratuit, borné à zéro, plus tout le solde de crédits — chaque
-- crédit du solde est par définition non encore dépensé).
--
-- Même correctif dans les deux RPC de lecture, qui exposent désormais
-- `remaining` calculé serveur : le front ne refait JAMAIS cap − utilisé.
-- Corps restatés depuis 20260901190000 ; seule la formule change.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_email_send_quota(
  p_scope_key text,
  p_requested integer,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req integer := GREATEST(0, COALESCE(p_requested, 0));
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_platform integer;
  v_granted integer;
  v_day_sent integer;
  v_month_sent integer;
  v_day_cap integer;
  v_month_cap integer;
  v_free integer;
  v_credits integer;
  v_allowed_month integer;
  v_used_credits integer;
  v_pct_before numeric;
  v_pct_after numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'consume_email_send_quota: service_role only';
  END IF;
  IF v_req = 0 THEN RETURN 0; END IF;

  -- Étage 1 : plateforme, jour puis mois.
  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES ('platform', CURRENT_DATE, 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_day_sent;
  v_day_cap := public.email_sender_daily_cap('platform');

  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES ('platform', v_month, 0)
  ON CONFLICT (scope_key, month) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_month_sent;
  v_month_cap := public.email_sender_monthly_free('platform');

  v_platform := GREATEST(0, LEAST(v_req, v_day_cap - v_day_sent, v_month_cap - v_month_sent));
  IF v_platform = 0 THEN RETURN 0; END IF;

  UPDATE public.email_send_quota SET sent = sent + v_platform, updated_at = now()
   WHERE scope_key = 'platform' AND day = CURRENT_DATE;
  UPDATE public.email_send_quota_month SET sent = sent + v_platform, updated_at = now()
   WHERE scope_key = 'platform' AND month = v_month;

  -- Étage 2 : expéditeur.
  INSERT INTO public.email_sender_state (scope_key, venue_id, organizer_user_id)
  VALUES (p_scope_key, p_venue_id, p_organizer_user_id)
  ON CONFLICT (scope_key) DO NOTHING;

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = p_scope_key FOR UPDATE;

  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES (p_scope_key, CURRENT_DATE, 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_day_sent;
  v_day_cap := public.email_sender_daily_cap(p_scope_key);

  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES (p_scope_key, v_month, 0)
  ON CONFLICT (scope_key, month) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_month_sent;
  v_free := public.email_sender_monthly_free(p_scope_key);

  -- LA formule corrigée.
  v_allowed_month := GREATEST(0, v_free - v_month_sent) + v_credits;
  v_granted := GREATEST(0, LEAST(v_platform, v_day_cap - v_day_sent, v_allowed_month));

  IF v_granted < v_platform THEN
    UPDATE public.email_send_quota SET sent = sent - (v_platform - v_granted)
     WHERE scope_key = 'platform' AND day = CURRENT_DATE;
    UPDATE public.email_send_quota_month SET sent = sent - (v_platform - v_granted)
     WHERE scope_key = 'platform' AND month = v_month;
  END IF;
  IF v_granted = 0 THEN RETURN 0; END IF;

  UPDATE public.email_send_quota SET sent = sent + v_granted, updated_at = now()
   WHERE scope_key = p_scope_key AND day = CURRENT_DATE;
  UPDATE public.email_send_quota_month SET sent = sent + v_granted, updated_at = now()
   WHERE scope_key = p_scope_key AND month = v_month;

  v_used_credits := GREATEST(0, (v_month_sent + v_granted) - v_free)
                  - GREATEST(0, v_month_sent - v_free);

  UPDATE public.email_sender_state
     SET first_send_at = COALESCE(first_send_at, now()),
         lifetime_sent = lifetime_sent + v_granted,
         credit_balance = GREATEST(0, credit_balance - v_used_credits),
         updated_at = now()
   WHERE scope_key = p_scope_key;

  BEGIN
    v_pct_before := v_month_sent::numeric / NULLIF(v_free, 0);
    v_pct_after  := (v_month_sent + v_granted)::numeric / NULLIF(v_free, 0);
    IF v_pct_before < 1 AND v_pct_after >= 1 THEN
      PERFORM public.emit_admin_notification(
        'admin_email_quota_100',
        'Quota email du mois épuisé',
        p_scope_key || ' a consommé les ' || v_free || ' emails offerts du mois.',
        'high', 'email_sender', p_scope_key,
        jsonb_build_object('venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
                           'month', v_month, 'free', v_free, 'credits_left', GREATEST(0, v_credits - v_used_credits)),
        'email_quota_100_' || p_scope_key || '_' || to_char(v_month, 'YYYY-MM'));
    ELSIF v_pct_before < 0.8 AND v_pct_after >= 0.8 THEN
      PERFORM public.emit_admin_notification(
        'admin_email_quota_80',
        'Quota email du mois à 80 %',
        p_scope_key || ' a consommé 80 % de ses ' || v_free || ' emails offerts du mois.',
        'normal', 'email_sender', p_scope_key,
        jsonb_build_object('venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
                           'month', v_month, 'free', v_free),
        'email_quota_80_' || p_scope_key || '_' || to_char(v_month, 'YYYY-MM'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_granted;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_email_quota_status(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_used integer;
  v_free integer;
  v_credits integer;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'get_email_quota_status: fournir p_venue_id OU p_organizer_user_id';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'venue:' || p_venue_id;
  ELSE
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'org:' || p_organizer_user_id::text;
  END IF;

  SELECT COALESCE(sent, 0) INTO v_used
    FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = v_month;
  v_used := COALESCE(v_used, 0);

  v_free := public.email_sender_monthly_free(v_scope);

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = v_scope;
  v_credits := COALESCE(v_credits, 0);

  RETURN jsonb_build_object(
    'used', v_used,
    'free', v_free,
    'credits', v_credits,
    'remaining', GREATEST(0, v_free - v_used) + v_credits,
    'resets_on', (v_month + interval '1 month')::date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_campaign_send_progress(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_auth boolean := false;
  v_counts jsonb;
  v_cap integer;
  v_used integer;
  v_scope text;
  v_month_used integer;
  v_month_free integer;
  v_credits integer;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF c.venue_id IS NOT NULL THEN
    v_auth := public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin();
  ELSIF c.organizer_user_id IS NOT NULL THEN
    v_auth := (c.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN v_auth := true; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT jsonb_object_agg(status, n) INTO v_counts
    FROM (SELECT status, count(*) AS n
            FROM public.email_campaign_recipients
           WHERE campaign_id = p_campaign_id GROUP BY status) s;

  v_scope := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id
                  ELSE 'org:' || c.organizer_user_id::text END;

  SELECT public.email_sender_daily_cap(v_scope) INTO v_cap;
  SELECT COALESCE(sent, 0) INTO v_used FROM public.email_send_quota
   WHERE scope_key = v_scope AND day = CURRENT_DATE;

  SELECT COALESCE(sent, 0) INTO v_month_used FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = date_trunc('month', CURRENT_DATE)::date;
  v_month_free := public.email_sender_monthly_free(v_scope);
  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = v_scope;

  RETURN jsonb_build_object(
    'status', c.status,
    'paused_reason', c.paused_reason,
    'error_message', c.error_message,
    'total', c.total_recipients,
    'sent', c.recipients_count,
    'delivered', c.delivered_count,
    'bounced', c.bounced_count,
    'complained', c.complained_count,
    'failed', c.failed_count,
    'suppressed', c.suppressed_count,
    'opens', c.opens_count,
    'clicks', c.clicks_count,
    'by_status', COALESCE(v_counts, '{}'::jsonb),
    'daily_cap', v_cap,
    'daily_used', COALESCE(v_used, 0),
    'monthly_used', COALESCE(v_month_used, 0),
    'monthly_free', v_month_free,
    'monthly_credits', COALESCE(v_credits, 0),
    'monthly_remaining', GREATEST(0, v_month_free - COALESCE(v_month_used, 0)) + COALESCE(v_credits, 0),
    'send_started_at', c.send_started_at,
    'last_slice_at', c.last_slice_at
  );
END;
$$;
