-- Suite de l'audit Yuno CRM du 18/10 — MAIL-13 (P3) : les quotas d'envoi
-- journaliers et mensuels tournent à minuit de PARIS, plus à minuit UTC.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- AVANT : `CURRENT_DATE` (jour de la session = UTC en prod). Le plafond du
-- jour, le rodage du domaine et le compteur du mois se remettaient à zéro à
-- 2 h du matin à Paris l'été (1 h l'hiver), en pleine nuit de soirée : une
-- campagne bloquée « plafond du jour atteint » repartait au milieu de la nuit,
-- et l'écran « reste aujourd'hui » parlait d'un autre jour que le pro.
--
-- MAINTENANT : une source unique, `paris_today()`, dans les six fonctions qui
-- lisent ou écrivent `email_send_quota` / `email_send_quota_month`, et dans les
-- valeurs par défaut des deux tables. Le jour de la première campagne d'un
-- expéditeur (rodage) se lit aussi à Paris. À la mise en ligne, les compteurs
-- du jour UTC en cours restent (jour de Paris = jour UTC sauf entre 22 h et
-- minuit UTC l'été) : au pire un compteur repart à zéro une heure ou deux plus
-- tôt, une fois.
--
-- Corps réécrits depuis pg_get_functiondef de la prod (18/10) ; seule la
-- lecture du jour change. Les droits (proacl) ne changent pas ici :
-- CREATE OR REPLACE les garde (SEC-04 les resserre à part).

CREATE OR REPLACE FUNCTION public.paris_today()
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$
  SELECT (now() AT TIME ZONE 'Europe/Paris')::date
$function$;

COMMENT ON FUNCTION public.paris_today() IS
  'Jour civil à Paris : la journée des quotas d''envoi (audit 18/10, MAIL-13).';
REVOKE ALL ON FUNCTION public.paris_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paris_today() TO authenticated, service_role;

ALTER TABLE public.email_send_quota ALTER COLUMN day SET DEFAULT public.paris_today();
ALTER TABLE public.email_send_quota_month ALTER COLUMN month SET DEFAULT (date_trunc('month', public.paris_today()::timestamp))::date;

-- consume_email_send_quota
CREATE OR REPLACE FUNCTION public.consume_email_send_quota(p_scope_key text, p_requested integer, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req integer := GREATEST(0, COALESCE(p_requested, 0));
  v_month date := (date_trunc('month', public.paris_today()::timestamp))::date;
  -- plateforme
  v_p_day_sent integer;
  v_p_day_cap integer;
  v_p_month_sent integer;
  v_p_month_paid integer;
  v_pool_cap integer;
  v_ceiling integer;
  -- expéditeur
  v_is_crm boolean;
  v_crm_scope boolean;
  v_credits integer;
  v_day_sent integer;
  v_day_cap integer;
  v_month_sent integer;
  v_month_paid integer;
  v_free integer;
  v_free_left integer;
  v_paid_cap integer;
  -- attribution
  v_room integer;
  v_free_grant integer;
  v_paid_grant integer;
  v_granted integer;
  v_pool_before integer;
  v_pct_before numeric;
  v_pct_after numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'consume_email_send_quota: service_role only';
  END IF;
  IF v_req = 0 THEN RETURN 0; END IF;

  -- Étage 1 : plateforme. Les lignes sont verrouillées jusqu'à la fin de la
  -- transaction, et TOUJOURS avant celles de l'expéditeur (même ordre pour
  -- tous les workers, pas d'interblocage).
  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES ('platform', public.paris_today(), 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_p_day_sent;
  v_p_day_cap := public.email_sender_daily_cap('platform');

  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES ('platform', v_month, 0)
  ON CONFLICT (scope_key, month) DO UPDATE SET updated_at = now()
  RETURNING sent, paid_sent INTO v_p_month_sent, v_p_month_paid;
  v_pool_cap := public.email_sender_monthly_free('platform');
  v_ceiling := public.email_platform_monthly_ceiling();

  -- Étage 2 : expéditeur.
  INSERT INTO public.email_sender_state (scope_key, venue_id, organizer_user_id)
  VALUES (p_scope_key, p_venue_id, p_organizer_user_id)
  ON CONFLICT (scope_key) DO NOTHING;

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = p_scope_key FOR UPDATE;

  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES (p_scope_key, public.paris_today(), 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_day_sent;
  v_day_cap := public.email_sender_daily_cap(p_scope_key);

  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES (p_scope_key, v_month, 0)
  ON CONFLICT (scope_key, month) DO UPDATE SET updated_at = now()
  RETURNING sent, paid_sent INTO v_month_sent, v_month_paid;
  v_free := public.email_sender_monthly_free(p_scope_key);
  v_crm_scope := COALESCE(public.crm_scope_is_crm(p_scope_key), false);
  -- Payé en Yunits : tout envoi d'un compte CRM pur, et la campagne CRM d'un
  -- compte à deux produits (Billetterie + CRM, crm_campaign_is_crm). Une telle
  -- campagne ne touche ni l'offert de la Billetterie ni ses crédits.
  v_is_crm := v_crm_scope
    OR (p_campaign_id IS NOT NULL AND COALESCE(public.crm_campaign_is_crm(p_campaign_id), false));

  IF v_crm_scope THEN
    -- Yuno CRM : tout est payé en Yunits (débités à la mise en file). La seule
    -- borne est l'offre (1e9 active, 0 en pause).
    v_free_left := 0;
    v_paid_cap := GREATEST(0, v_free - v_month_sent);
  ELSIF v_is_crm THEN
    -- Campagne CRM d'un compte à deux produits : même règle, l'offre CRM borne.
    v_free_left := 0;
    v_paid_cap := CASE WHEN public.crm_effective_plan(p_scope_key) = 'base' THEN 1000000000 ELSE 0 END;
  ELSE
    v_free_left := GREATEST(0, v_free - (v_month_sent - v_month_paid));
    v_paid_cap := GREATEST(0, v_credits);
  END IF;

  -- Ce qui peut partir maintenant : rodage du jour de l'expéditeur, plafond du
  -- jour de la plateforme, plafond absolu du mois.
  v_room := GREATEST(0, LEAST(v_req,
                              v_day_cap - v_day_sent,
                              v_p_day_cap - v_p_day_sent,
                              v_ceiling - v_p_month_sent));

  -- L'offert d'abord, dans la limite de la cagnotte (ce que Yuno paie seul) ;
  -- le reste sur ce que l'expéditeur a payé, sans attendre la cagnotte.
  v_pool_before := v_p_month_sent - v_p_month_paid;
  v_free_grant := GREATEST(0, LEAST(v_room, v_free_left, v_pool_cap - v_pool_before));
  v_paid_grant := GREATEST(0, LEAST(v_room - v_free_grant, v_paid_cap));
  v_granted := v_free_grant + v_paid_grant;

  IF v_granted > 0 THEN
    UPDATE public.email_send_quota SET sent = sent + v_granted, updated_at = now()
     WHERE scope_key = 'platform' AND day = public.paris_today();
    UPDATE public.email_send_quota_month
       SET sent = sent + v_granted, paid_sent = paid_sent + v_paid_grant, updated_at = now()
     WHERE scope_key = 'platform' AND month = v_month;

    UPDATE public.email_send_quota SET sent = sent + v_granted, updated_at = now()
     WHERE scope_key = p_scope_key AND day = public.paris_today();
    UPDATE public.email_send_quota_month
       SET sent = sent + v_granted, paid_sent = paid_sent + v_paid_grant, updated_at = now()
     WHERE scope_key = p_scope_key AND month = v_month;

    UPDATE public.email_sender_state
       SET first_send_at = COALESCE(first_send_at, now()),
           lifetime_sent = lifetime_sent + v_granted,
           credit_balance = GREATEST(0, credit_balance - CASE WHEN v_is_crm THEN 0 ELSE v_paid_grant END),
           updated_at = now()
     WHERE scope_key = p_scope_key;
  END IF;

  -- Alertes super admin : jamais bloquantes.
  BEGIN
    -- L'offert de l'expéditeur (sans objet pour un compte CRM).
    IF NOT v_is_crm AND v_granted > 0 THEN
      v_pct_before := (v_month_sent - v_month_paid)::numeric / NULLIF(v_free, 0);
      v_pct_after  := (v_month_sent - v_month_paid + v_free_grant)::numeric / NULLIF(v_free, 0);
      IF v_pct_before < 1 AND v_pct_after >= 1 THEN
        PERFORM public.emit_admin_notification(
          'admin_email_quota_100',
          'Quota email du mois épuisé',
          p_scope_key || ' a consommé les ' || v_free || ' emails offerts du mois.',
          'high', 'email_sender', p_scope_key,
          jsonb_build_object('venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
                             'month', v_month, 'free', v_free,
                             'credits_left', GREATEST(0, v_credits - v_paid_grant)),
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
    END IF;

    -- La cagnotte plateforme : à sec, l'offert de tous les comptes attend le
    -- 1er du mois (le payé, lui, part).
    IF v_free_left > 0 AND v_free_grant < LEAST(v_room, v_free_left)
       AND v_pool_before + v_free_grant >= v_pool_cap THEN
      PERFORM public.emit_admin_notification(
        'admin_email_quota_100',
        'Cagnotte email plateforme épuisée',
        'Les ' || v_pool_cap || ' emails offerts du mois sont partis : les envois offerts attendent le 1er, les envois payés continuent. Monter la cagnotte (email_sender_state platform, monthly_cap_override) si le dépassement Resend est acceptable.',
        'high', 'email_sender', 'platform',
        jsonb_build_object('month', v_month, 'pool_cap', v_pool_cap),
        'email_pool_100_' || to_char(v_month, 'YYYY-MM'));
    END IF;

    -- Le plafond absolu : plus rien ne part, payé compris.
    IF v_p_month_sent + v_granted >= v_ceiling AND v_granted < v_req THEN
      PERFORM public.emit_admin_notification(
        'admin_email_quota_100',
        'Plafond email absolu atteint',
        v_ceiling || ' emails marketing ce mois : tout envoi attend le 1er, même payé. Passer à l''offre Resend supérieure puis relever email_platform_monthly_ceiling().',
        'high', 'email_sender', 'platform',
        jsonb_build_object('month', v_month, 'ceiling', v_ceiling),
        'email_ceiling_' || to_char(v_month, 'YYYY-MM'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_granted;
END;
$function$;

-- refund_email_send_quota
CREATE OR REPLACE FUNCTION public.refund_email_send_quota(p_scope_key text, p_amount integer, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_amount integer := GREATEST(0, COALESCE(p_amount, 0));
  v_month date := (date_trunc('month', public.paris_today()::timestamp))::date;
  v_paid integer;
  v_sent integer;
  v_found boolean;
  v_paid_back integer := 0;
  v_is_crm boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'refund_email_send_quota: service_role only';
  END IF;
  IF v_amount = 0 THEN RETURN; END IF;

  -- Même ordre de verrous que la consommation : plateforme, puis expéditeur.
  PERFORM 1 FROM public.email_send_quota_month
   WHERE scope_key = 'platform' AND month = v_month FOR UPDATE;

  SELECT sent, paid_sent INTO v_sent, v_paid FROM public.email_send_quota_month
   WHERE scope_key = p_scope_key AND month = v_month FOR UPDATE;
  v_found := FOUND;
  v_is_crm := COALESCE(public.crm_scope_is_crm(p_scope_key), false)
    OR (p_campaign_id IS NOT NULL AND COALESCE(public.crm_campaign_is_crm(p_campaign_id), false));
  IF v_found THEN
    IF NOT v_is_crm AND COALESCE(public.crm_scope_has_crm(p_scope_key), false) THEN
      -- Campagne Billetterie d'un compte à deux produits : le payé du mois peut
      -- être des Yunits (campagnes CRM) ; on rend d'abord l'offert, pour ne
      -- jamais transformer des Yunits en crédits Billetterie.
      v_paid_back := LEAST(COALESCE(v_paid, 0),
                           GREATEST(0, v_amount - GREATEST(0, COALESCE(v_sent, 0) - COALESCE(v_paid, 0))));
    ELSE
      v_paid_back := LEAST(v_amount, COALESCE(v_paid, 0));
    END IF;
  END IF;

  UPDATE public.email_send_quota
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = 'platform' AND day = public.paris_today();
  UPDATE public.email_send_quota_month
     SET sent = GREATEST(0, sent - v_amount),
         paid_sent = GREATEST(0, paid_sent - v_paid_back),
         updated_at = now()
   WHERE scope_key = 'platform' AND month = v_month;

  UPDATE public.email_send_quota
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = p_scope_key AND day = public.paris_today();
  UPDATE public.email_send_quota_month
     SET sent = GREATEST(0, sent - v_amount),
         paid_sent = GREATEST(0, paid_sent - v_paid_back),
         updated_at = now()
   WHERE scope_key = p_scope_key AND month = v_month;

  UPDATE public.email_sender_state
     SET lifetime_sent = GREATEST(0, lifetime_sent - v_amount),
         credit_balance = credit_balance + CASE WHEN v_is_crm THEN 0 ELSE v_paid_back END
   WHERE scope_key = p_scope_key;
END;
$function$;

-- email_sender_daily_cap
CREATE OR REPLACE FUNCTION public.email_sender_daily_cap(p_scope_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  v_days integer;
BEGIN
  SELECT * INTO v FROM public.email_sender_state WHERE scope_key = p_scope_key;

  -- Plateforme : plafond global, généreux mais fini.
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v.daily_cap_override, 25000);
  END IF;

  IF v IS NULL THEN
    RETURN 300;                       -- tout premier envoi
  END IF;
  IF v.daily_cap_override IS NOT NULL THEN
    RETURN GREATEST(0, v.daily_cap_override);
  END IF;
  IF v.trust_level = 'restricted' THEN
    RETURN 0;
  END IF;
  IF v.trust_level = 'trusted' THEN
    RETURN 50000;
  END IF;
  IF v.first_send_at IS NULL THEN
    RETURN 300;
  END IF;

  v_days := GREATEST(0, (public.paris_today() - (v.first_send_at AT TIME ZONE 'Europe/Paris')::date));
  RETURN CASE
    WHEN v_days = 0 THEN 300
    WHEN v_days = 1 THEN 600
    WHEN v_days = 2 THEN 1200
    WHEN v_days = 3 THEN 2500
    WHEN v_days = 4 THEN 5000
    WHEN v_days = 5 THEN 10000
    ELSE 25000
  END;
END;
$function$;

-- count_transactional_email
CREATE OR REPLACE FUNCTION public.count_transactional_email()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'count_transactional_email: service_role only';
  END IF;
  INSERT INTO public.email_send_quota_month (scope_key, month, sent)
  VALUES ('transactional', (date_trunc('month', public.paris_today()::timestamp))::date, 1)
  ON CONFLICT (scope_key, month) DO UPDATE
    SET sent = public.email_send_quota_month.sent + 1, updated_at = now();
END;
$function$;

-- get_email_quota_status
CREATE OR REPLACE FUNCTION public.get_email_quota_status(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text;
  v_month date := (date_trunc('month', public.paris_today()::timestamp))::date;
  v_used integer;
  v_paid integer;
  v_free integer;
  v_credits integer;
  v_pool_sent integer;
  v_pool_paid integer;
  v_pool_cap integer;
  v_day_used integer;
  v_day_cap integer;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_email_quota_status: une seule portée à la fois';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF NOT (COALESCE(public.is_venue_owner(auth.uid(), p_venue_id), false) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'venue:' || p_venue_id;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (COALESCE(p_organizer_user_id = auth.uid(), false)
            OR COALESCE(public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin'), false)
            OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'org:' || p_organizer_user_id::text;
  ELSE
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'yuno';
  END IF;

  SELECT COALESCE(sent, 0), COALESCE(paid_sent, 0) INTO v_used, v_paid
    FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = v_month;
  v_used := COALESCE(v_used, 0);
  v_paid := COALESCE(v_paid, 0);

  v_free := public.email_sender_monthly_free(v_scope);

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = v_scope;
  v_credits := COALESCE(v_credits, 0);

  SELECT COALESCE(sent, 0), COALESCE(paid_sent, 0) INTO v_pool_sent, v_pool_paid
    FROM public.email_send_quota_month WHERE scope_key = 'platform' AND month = v_month;
  v_pool_sent := COALESCE(v_pool_sent, 0);
  v_pool_paid := COALESCE(v_pool_paid, 0);
  v_pool_cap := public.email_sender_monthly_free('platform');

  SELECT COALESCE(sent, 0) INTO v_day_used
    FROM public.email_send_quota WHERE scope_key = v_scope AND day = public.paris_today();
  v_day_cap := public.email_sender_daily_cap(v_scope);

  RETURN jsonb_build_object(
    'used', v_used,
    'paid', v_paid,
    'free', v_free,
    'credits', v_credits,
    'remaining', GREATEST(0, v_free - (v_used - v_paid)) + v_credits,
    'resets_on', (v_month + interval '1 month')::date,
    'day_used', COALESCE(v_day_used, 0),
    'day_cap', COALESCE(v_day_cap, 0),
    -- La cagnotte ne compte que l'offert ; le plafond absolu compte tout.
    'pool_used', v_pool_sent - v_pool_paid,
    'pool_cap', COALESCE(v_pool_cap, 0),
    'platform_sent', v_pool_sent,
    'platform_ceiling', public.email_platform_monthly_ceiling()
  );
END;
$function$;

-- get_campaign_send_progress
CREATE OR REPLACE FUNCTION public.get_campaign_send_progress(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
  v_auth boolean := false;
  v_counts jsonb;
  v_cap integer;
  v_used integer;
  v_scope text;
  v_month_used integer;
  v_month_paid integer;
  v_month_free integer;
  v_credits integer;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF c.venue_id IS NOT NULL THEN
    v_auth := COALESCE(public.is_venue_owner(auth.uid(), c.venue_id), false) OR public.is_super_admin();
  ELSIF c.organizer_user_id IS NOT NULL THEN
    v_auth := COALESCE(c.organizer_user_id = auth.uid(), false) OR public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN v_auth := true; END IF;
  IF NOT COALESCE(v_auth, false) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT jsonb_object_agg(status, n) INTO v_counts
    FROM (SELECT status, count(*) AS n
            FROM public.email_campaign_recipients
           WHERE campaign_id = p_campaign_id GROUP BY status) s;

  v_scope := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id
                  ELSE 'org:' || c.organizer_user_id::text END;

  SELECT public.email_sender_daily_cap(v_scope) INTO v_cap;
  SELECT COALESCE(sent, 0) INTO v_used FROM public.email_send_quota
   WHERE scope_key = v_scope AND day = public.paris_today();

  SELECT COALESCE(sent, 0), COALESCE(paid_sent, 0) INTO v_month_used, v_month_paid
    FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = (date_trunc('month', public.paris_today()::timestamp))::date;
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
    'monthly_remaining', GREATEST(0, v_month_free - (COALESCE(v_month_used, 0) - COALESCE(v_month_paid, 0)))
                         + COALESCE(v_credits, 0),
    'send_started_at', c.send_started_at,
    'last_slice_at', c.last_slice_at
  );
END;
$function$;
