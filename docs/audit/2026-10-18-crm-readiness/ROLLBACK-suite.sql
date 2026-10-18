-- Retour arrière des migrations de la SUITE de l'audit du 18/10
-- (20261023100000 → 170000). Définitions lues en prod le 18/10 (pg_get_functiondef),
-- sauf claim_campaign_recipients : celle de 20261021110000 (audit, pas encore en prod).
-- À ne jouer que si une correction casse quelque chose, bloc par bloc, dans une
-- transaction, du plus récent au plus ancien, puis supabase db lint --linked.
-- Fonctions edge : redéployer depuis le commit précédent AVANT de jouer un bloc
-- dont elles dépendent (send-campaign appelle email_test_send_allow,
-- email_scope_event_ids, email_sender_local_claim et lit batch_key).

-- ── 170000 (MAIL-15, registre des adresses) ──
CREATE OR REPLACE FUNCTION public.crm_email_settings_get(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.crm_email_settings%ROWTYPE;
  v_name text; v_reply text; v_city text; v_addr text; v_from text;
  v_legal text; v_legal_addr text;
  v_writer boolean;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_writer := public.crm_scope_writable(p_venue_id, p_organizer_user_id);
  SELECT * INTO s FROM public.crm_email_settings WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  IF p_venue_id IS NOT NULL THEN
    SELECT v.name, p.email, v.city, v.address, v.legal_name, v.legal_address
      INTO v_name, v_reply, v_city, v_addr, v_legal, v_legal_addr
      FROM public.venues v LEFT JOIN public.profiles p ON p.id = v.owner_id WHERE v.id = p_venue_id;
  ELSE
    SELECT COALESCE(NULLIF(btrim(p.organization_name), ''), NULLIF(btrim(op.display_name), ''), btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))),
           p.email, COALESCE(op.city, p.city), NULL, op.legal_name, op.legal_address
      INTO v_name, v_reply, v_city, v_addr, v_legal, v_legal_addr
      FROM public.profiles p LEFT JOIN public.organizer_profiles op ON op.user_id = p.id WHERE p.id = p_organizer_user_id;
  END IF;
  -- Nom dont l'adresse d'envoi est tirée : celui que lit send-campaign
  -- (resolveSender : nom du club, sinon nom de l'organisation du profil,
  -- sinon prénom nom), passé au même slug que slugifyVenueName.
  IF p_venue_id IS NOT NULL THEN
    v_from := v_name;
  ELSE
    SELECT COALESCE(NULLIF(p.organization_name, ''), NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), 'Organisateur')
      INTO v_from FROM public.profiles p WHERE p.id = p_organizer_user_id;
  END IF;
  v_from := COALESCE(NULLIF(left(btrim(regexp_replace(regexp_replace(
              regexp_replace(normalize(lower(COALESCE(v_from, '')), NFD), '[̀-ͯ]', '', 'g'),
              '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'), '-'), 64), ''), 'club');

  RETURN jsonb_build_object(
    'from_local', v_from,
    'sender_name', s.sender_name, 'legal_name', s.legal_name, 'reply_to', s.reply_to, 'postal_address', s.postal_address,
    'quiet_hours', COALESCE(s.quiet_hours, true), 'waves', COALESCE(s.waves, false), 'notify_done', COALESCE(s.notify_done, true),
    'test_emails', COALESCE(to_jsonb(s.test_emails), '[]'::jsonb), 'updated_at', s.updated_at,
    'readiness', public._crm_email_identity(p_venue_id, p_organizer_user_id),
    'defaults', jsonb_build_object('sender_name', v_name, 'reply_to', v_reply, 'city', v_city, 'address', v_addr,
      'legal_name', CASE WHEN v_writer THEN NULLIF(btrim(v_legal), '') END,
      'legal_address', CASE WHEN v_writer THEN NULLIF(btrim(v_legal_addr), '') END));
END;
$function$;
DROP FUNCTION IF EXISTS public.email_sender_local_claim(text, text);
DROP FUNCTION IF EXISTS public.email_sender_local_preview(text, text);
DROP FUNCTION IF EXISTS public._email_local_slug(text);
DROP TABLE IF EXISTS public.email_sender_locals;

-- ── 160000 (MAIL-14, soirées de l'espace) ──
DROP FUNCTION IF EXISTS public.email_scope_event_ids(text, uuid, uuid[]);

-- ── 150000 (SEC-04, droits rendus comme en prod le 18/10) ──
GRANT EXECUTE ON FUNCTION public.campaign_scope_is_event_principal(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_org_role(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_user_manages_team(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.email_sender_daily_cap(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_sender_monthly_free(text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_transactional_email() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_base_scope_key(text, uuid) TO PUBLIC, anon;

-- ── 140000 (MAIL-13, jour de Paris) ──
ALTER TABLE public.email_send_quota ALTER COLUMN day SET DEFAULT CURRENT_DATE;
ALTER TABLE public.email_send_quota_month ALTER COLUMN month SET DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date;
CREATE OR REPLACE FUNCTION public.consume_email_send_quota(p_scope_key text, p_requested integer, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req integer := GREATEST(0, COALESCE(p_requested, 0));
  v_month date := date_trunc('month', CURRENT_DATE)::date;
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
  VALUES ('platform', CURRENT_DATE, 0)
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
  VALUES (p_scope_key, CURRENT_DATE, 0)
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
     WHERE scope_key = 'platform' AND day = CURRENT_DATE;
    UPDATE public.email_send_quota_month
       SET sent = sent + v_granted, paid_sent = paid_sent + v_paid_grant, updated_at = now()
     WHERE scope_key = 'platform' AND month = v_month;

    UPDATE public.email_send_quota SET sent = sent + v_granted, updated_at = now()
     WHERE scope_key = p_scope_key AND day = CURRENT_DATE;
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
CREATE OR REPLACE FUNCTION public.refund_email_send_quota(p_scope_key text, p_amount integer, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_amount integer := GREATEST(0, COALESCE(p_amount, 0));
  v_month date := date_trunc('month', CURRENT_DATE)::date;
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
   WHERE scope_key = 'platform' AND day = CURRENT_DATE;
  UPDATE public.email_send_quota_month
     SET sent = GREATEST(0, sent - v_amount),
         paid_sent = GREATEST(0, paid_sent - v_paid_back),
         updated_at = now()
   WHERE scope_key = 'platform' AND month = v_month;

  UPDATE public.email_send_quota
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = p_scope_key AND day = CURRENT_DATE;
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

  v_days := GREATEST(0, (CURRENT_DATE - v.first_send_at::date));
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
  VALUES ('transactional', date_trunc('month', CURRENT_DATE)::date, 1)
  ON CONFLICT (scope_key, month) DO UPDATE
    SET sent = public.email_send_quota_month.sent + 1, updated_at = now();
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_email_quota_status(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text;
  v_month date := date_trunc('month', CURRENT_DATE)::date;
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
    FROM public.email_send_quota WHERE scope_key = v_scope AND day = CURRENT_DATE;
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
   WHERE scope_key = v_scope AND day = CURRENT_DATE;

  SELECT COALESCE(sent, 0), COALESCE(paid_sent, 0) INTO v_month_used, v_month_paid
    FROM public.email_send_quota_month
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
    'monthly_remaining', GREATEST(0, v_month_free - (COALESCE(v_month_used, 0) - COALESCE(v_month_paid, 0)))
                         + COALESCE(v_credits, 0),
    'send_started_at', c.send_started_at,
    'last_slice_at', c.last_slice_at
  );
END;
$function$;
-- paris_today() peut rester (aucune lecture ne la lit plus) ; sinon :
-- DROP FUNCTION IF EXISTS public.paris_today();

-- ── 130000 (MAIL-07, produit d'une campagne) ──
DROP TRIGGER IF EXISTS trg_0_guard_email_campaign_product ON public.email_campaigns;
DROP FUNCTION IF EXISTS public.guard_email_campaign_product();

-- ── 120000 (MAIL-08, e-mails de test) ──
DROP FUNCTION IF EXISTS public.email_test_send_allow(text, uuid, uuid, text[], integer);
DROP FUNCTION IF EXISTS public.email_scope_team_emails(text, uuid);
DROP TABLE IF EXISTS public.email_test_sends;

-- ── 110000 (MAIL-09, clé de filtre inconnue) ──
CREATE OR REPLACE FUNCTION public._crm_filter_sql(p_def jsonb, p_alias text DEFAULT 'p'::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  a text := quote_ident(COALESCE(p_alias, 'p'));
  parts text[] := '{}';
  d jsonb := COALESCE(p_def, '{}'::jsonb);
  f jsonb := COALESCE(p_def->'f', '{}'::jsonb);
  v text;
  lst text;
  ors text[];
  q text;
  dig text;
BEGIN
  v := d->>'seg';
  IF v IS NOT NULL AND v <> 'all' THEN
    IF v IN ('hab', 'occ', 'nou', 'end', 'none') THEN parts := array_append(parts, format('%s.lifecycle = %L', a, v));
    ELSE parts := array_append(parts, 'false'); END IF;
  END IF;

  IF jsonb_typeof(f->'ev') = 'array' AND jsonb_array_length(f->'ev') > 0 THEN
    ors := '{}';
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'ev') x WHERE x ~ '^[0-9a-f-]{36}$';
    IF lst IS NOT NULL THEN ors := array_append(ors, format('%s.events && ARRAY[%s]::uuid[]', a, lst)); END IF;
    IF f->'ev' ? 'T' THEN ors := array_append(ors, format('%s.tonight', a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  v := f->>'last';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0-30' THEN format('%s.last_night >= now() - interval ''30 days''', a)
      WHEN '30-90' THEN format('(%s.last_night < now() - interval ''30 days'' AND %s.last_night >= now() - interval ''90 days'')', a, a)
      WHEN '90-180' THEN format('(%s.last_night < now() - interval ''90 days'' AND %s.last_night >= now() - interval ''180 days'')', a, a)
      WHEN '180+' THEN format('%s.last_night < now() - interval ''180 days''', a)
      ELSE 'false' END);
  END IF;

  -- Un nombre illisible ne retire plus la condition (le segment devenait
  -- « tout le monde ») : il ne garde personne.
  v := f->>'last_gt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night < now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;

  v := f->>'nb';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0' THEN format('%s.nights = 0', a)
      WHEN '1' THEN format('%s.nights = 1', a)
      WHEN '2' THEN format('%s.nights = 2', a)
      WHEN '3-5' THEN format('%s.nights BETWEEN 3 AND 5', a)
      WHEN '6+' THEN format('%s.nights >= 6', a)
      ELSE 'false' END);
  END IF;

  v := f->>'sp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '<50' THEN format('%s.spent < 50', a)
      WHEN '50-200' THEN format('%s.spent BETWEEN 50 AND 200', a)
      WHEN '200+' THEN format('%s.spent > 200', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'rc') = 'array' AND jsonb_array_length(f->'rc') > 0 THEN
    ors := '{}';
    IF f->'rc' ? 'mail' THEN ors := array_append(ors, format('%s.email_ok', a)); END IF;
    IF f->'rc' ? 'sms' THEN ors := array_append(ors, format('%s.phone_ok', a)); END IF;
    IF f->'rc' ? 'none' THEN ors := array_append(ors, format('(NOT %s.email_ok AND NOT %s.phone_ok)', a, a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  IF jsonb_typeof(f->'src') = 'array' AND jsonb_array_length(f->'src') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'src') x WHERE x IN ('shotgun', 'utm', 'import', 'page', 'other');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.source IN (%s)', a, lst) END);
  END IF;

  IF jsonb_typeof(f->'tags') = 'array' AND jsonb_array_length(f->'tags') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst FROM jsonb_array_elements_text(f->'tags') x;
    parts := array_append(parts, format('COALESCE(%s.tags, ''{}'') && ARRAY[%s]::text[]', a, lst));
  END IF;

  v := f->>'msg';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'never_clicked' THEN format('(%s.msg_n >= 3 AND %s.click_n = 0)', a, a)
      WHEN 'clicked_no_buy' THEN format('%s.click_nobuy', a)
      WHEN 'never_sent' THEN format('%s.msg_n = 0', a)
      ELSE 'false' END);
  END IF;

  -- Guest list (20261008100000). Valeur inconnue ⇒ personne.
  v := f->>'gl';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'any' THEN format('%s.gl_n > 0', a)
      WHEN 'only' THEN format('(%s.gl_n > 0 AND %s.paid_n = 0)', a, a)
      WHEN 'loyal' THEN format('(%s.gl_n >= 3 AND %s.paid_n = 0)', a, a)
      WHEN 'conv' THEN format('%s.gl_conv', a)
      WHEN 'noshow' THEN format('%s.gl_noshow >= 2', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'glev') = 'array' AND jsonb_array_length(f->'glev') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'glev') x WHERE x ~ '^[0-9a-f-]{36}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.gl_events && ARRAY[%s]::uuid[]', a, lst) END);
  END IF;

  -- ── Catalogue de segments (20261008200000). Valeur illisible ⇒ personne. ──
  v := f->>'nb_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'nb_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights <= %s', a, v) ELSE 'false' END);
  END IF;
  -- Venu il y a moins de N jours.
  v := f->>'last_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  v := f->>'sp_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.spent >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Dépense par soirée payée (personne sans billet payant : aucune valeur, jamais retenue).
  v := f->>'basket_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.basket >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'paid_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.paid_n >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Âge et genre : une personne dont on ne connaît pas l'âge n'entre dans aucune tranche.
  v := f->>'age_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'age_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'gender';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('female', 'male', 'other') THEN format('%s.gender = %L', a, v) ELSE 'false' END);
  END IF;
  -- Ville (clé de _crm_area_key) et pays (ISO 2).
  IF jsonb_typeof(f->'area') = 'array' AND jsonb_array_length(f->'area') > 0 THEN
    SELECT string_agg(format('%L', public._crm_area_key(x)), ',') INTO lst
      FROM jsonb_array_elements_text(f->'area') x WHERE public._crm_area_key(x) IS NOT NULL;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.area_key IN (%s)', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'country') = 'array' AND jsonb_array_length(f->'country') > 0 THEN
    SELECT string_agg(format('%L', upper(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'country') x WHERE btrim(x) ~* '^[a-z]{2}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.country IN (%s)', a, lst) END);
  END IF;
  v := f->>'country_not';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN btrim(v) ~* '^[a-z]{2}$'
      THEN format('(%s.country IS NOT NULL AND %s.country <> %L)', a, a, upper(btrim(v))) ELSE 'false' END);
  END IF;
  -- Place (billet ou invitation) pour une soirée qui n'a pas encore commencé.
  v := f->>'up';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('%s.upcoming', a)
      WHEN 'no' THEN format('NOT %s.upcoming', a)
      ELSE 'false' END);
  END IF;
  -- A cliqué sur un lien d'un e-mail il y a moins de N jours.
  v := f->>'click_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_click >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  -- Canaux joignables ensemble ou seuls.
  v := f->>'ch';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'both' THEN format('(%s.email_ok AND %s.phone_ok)', a, a)
      WHEN 'email_only' THEN format('(%s.email_ok AND NOT %s.phone_ok)', a, a)
      WHEN 'sms_only' THEN format('(%s.phone_ok AND NOT %s.email_ok)', a, a)
      ELSE 'false' END);
  END IF;

  -- ── Analyse client (20261010110000) : clés pré-calculées (crm_person_profile.tags).
  --    Valeur illisible ⇒ personne. Un contact sans profil (fichier seul) n'a
  --    aucune clé : il n'entre dans aucun de ces filtres.
  IF jsonb_typeof(f->'hyp') = 'array' AND jsonb_array_length(f->'hyp') > 0 THEN
    SELECT string_agg(format('%L', 'h:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'hyp') x WHERE x ~ '^[a-z_]{2,24}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'artist') = 'array' AND jsonb_array_length(f->'artist') > 0 THEN
    SELECT string_agg(format('%L', 'a:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'artist') x WHERE x ~ '^(id|slug|name):.{1,160}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'genre') = 'array' AND jsonb_array_length(f->'genre') > 0 THEN
    SELECT string_agg(format('%L', 'g:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'genre') x WHERE length(btrim(x)) BETWEEN 1 AND 60;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'fmt') = 'array' AND jsonb_array_length(f->'fmt') > 0 THEN
    SELECT string_agg(format('%L', 'fmt:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'fmt') x WHERE length(btrim(x)) BETWEEN 1 AND 40;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'series') = 'array' AND jsonb_array_length(f->'series') > 0 THEN
    SELECT string_agg(format('%L', 's:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'series') x WHERE length(btrim(x)) BETWEEN 1 AND 300;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'buy') = 'array' AND jsonb_array_length(f->'buy') > 0 THEN
    SELECT string_agg(format('%L', 'b:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'buy') x WHERE x IN ('early', 'launch', 'last_minute', 'door');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'grp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('group', 'solo', 'brought')
      THEN format('%L = ANY (%s.an_tags)', 'grp:' || v, a) ELSE 'false' END);
  END IF;
  IF jsonb_typeof(f->'arr') = 'array' AND jsonb_array_length(f->'arr') > 0 THEN
    SELECT string_agg(format('%L', 'ch:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'arr') x
     WHERE x IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of', 'gl');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'dist_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'dist_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'pass';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('''pass'' = ANY (%s.an_tags)', a)
      WHEN 'no' THEN format('''loc'' = ANY (%s.an_tags)', a)
      ELSE 'false' END);
  END IF;

  -- « Qui cibler » (20261011110000) : une audience d'une soirée à venir, lue par
  -- la même porte que la RPC crm_night_targets. La portée vient de
  -- _crm_people_build ; une soirée hors de la portée rend personne.
  IF jsonb_typeof(f->'ntgt') = 'object' THEN
    parts := array_append(parts, CASE
      WHEN f->'ntgt'->>'e' ~* '^[0-9a-f-]{36}$'
       AND f->'ntgt'->>'a' IN ('concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local', 'likely')
      THEN format('%s.email IN (SELECT tg.email FROM public._crm_night_target_set(current_setting(''yuno.crm_scope'', true), %L::uuid, %L) tg)',
                  a, f->'ntgt'->>'e', f->'ntgt'->>'a')
      ELSE 'false' END);
  END IF;

  -- Liste fixe (une sélection enregistrée en segment) : 5 000 adresses au plus.
  IF jsonb_typeof(f->'emails') = 'array' AND jsonb_array_length(f->'emails') > 0 THEN
    SELECT string_agg(format('%L', lower(btrim(x))), ',') INTO lst
      FROM (SELECT x FROM jsonb_array_elements_text(f->'emails') x LIMIT 5000) z WHERE x ~ '@';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.email = ANY (ARRAY[%s]::text[])', a, lst) END);
  END IF;

  q := btrim(COALESCE(d->>'q', ''));
  IF q <> '' THEN
    dig := regexp_replace(q, '\D', '', 'g');
    parts := array_append(parts, format(
      '(lower(public.unaccent_safe(COALESCE(%s.first_name, '''') || '' '' || COALESCE(%s.last_name, '''') || '' '' || %s.email)) LIKE %L%s)',
      a, a, a, '%' || replace(replace(lower(public.unaccent_safe(q)), '%', ''), '_', '') || '%',
      CASE WHEN length(dig) >= 3 THEN format(' OR regexp_replace(COALESCE(%s.phone, ''''), ''\D'', '''', ''g'') LIKE %L', a, '%' || dig || '%') ELSE '' END));
  END IF;

  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$function$;

-- ── 100000 (MAIL-03, clé de lot) — la colonne batch_key peut rester ──
DROP FUNCTION IF EXISTS public.claim_campaign_recipients(uuid, integer);
CREATE FUNCTION public.claim_campaign_recipients(p_campaign_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(email text, first_name text, last_name text, unsubscribe_token uuid, attempts integer, ab_variant text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gate boolean := false;
  -- audit 18/10
  c record;
  v_marketing boolean := true;
  v_ids uuid[];
  v_skipped integer := 0;
  v_scope text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_campaign_recipients: service_role only';
  END IF;

  -- Phase de test A/B en cours : seules les lignes avec variante sont
  -- réclamables. Le reste attend le gagnant.
  SELECT ec.venue_id, ec.organizer_user_id, ec.name,
         (ec.ab_enabled AND COALESCE(ec.subject_b, '') <> '' AND ec.ab_winner IS NULL) AS gate,
         -- audit 18/10 : marketing = tout sauf l'e-mail de service et l'e-mail pratique.
         (COALESCE(ec.type, 'promotional') <> 'informational' AND NOT COALESCE(ec.practical, false)) AS marketing
    INTO c
    FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  v_gate := COALESCE(c.gate, false);
  v_marketing := COALESCE(c.marketing, true);

  -- audit 18/10 : on verrouille d'abord le lot, on trie ensuite.
  SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
    FROM (
      SELECT r.id
        FROM public.email_campaign_recipients r
       WHERE r.campaign_id = p_campaign_id
         AND r.status = 'pending'
         AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
         AND (NOT v_gate OR r.ab_variant IS NOT NULL)
       ORDER BY r.id
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100))
       FOR UPDATE SKIP LOCKED
    ) x;
  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  -- audit 18/10 : l'accord se relit au moment de l'envoi, pas seulement à la
  -- mise en file.
  IF v_marketing THEN
    WITH bad AS (
      SELECT r.id,
             CASE WHEN EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = lower(r.email))
                  THEN 'policy:suppressed_after_queue'
                  ELSE 'policy:opted_out_after_queue' END AS reason
        FROM public.email_campaign_recipients r
       WHERE r.id = ANY (v_ids)
         AND (EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = lower(r.email))
              OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                          WHERE lower(ns.email) = lower(r.email) AND ns.opted_in = false
                            AND ns.venue_id IS NOT DISTINCT FROM c.venue_id
                            AND ns.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id)
              OR EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = lower(r.email)
                            AND o.venue_id IS NOT DISTINCT FROM c.venue_id
                            AND o.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id))
    ), upd AS (
      UPDATE public.email_campaign_recipients q
         SET status = 'skipped', error_message = bad.reason, claimed_at = NULL
        FROM bad
       WHERE q.id = bad.id
      RETURNING 1
    )
    SELECT count(*) INTO v_skipped FROM upd;

    IF v_skipped > 0 THEN
      UPDATE public.email_campaigns
         SET policy_skipped_count = COALESCE(policy_skipped_count, 0) + v_skipped
       WHERE id = p_campaign_id;
      v_scope := public.crm_scope_key(c.venue_id, c.organizer_user_id);
      IF v_scope IS NOT NULL AND public.crm_campaign_is_crm(p_campaign_id) THEN
        -- Débité à la mise en file, jamais parti : le Yunit revient.
        PERFORM public.crm_yunits_refund(v_scope, v_skipped, 'email', 'email_campaign', p_campaign_id::text, c.name);
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  UPDATE public.email_campaign_recipients r
     SET status = 'sending',
         claimed_at = now(),
         attempts = r.attempts + 1
   WHERE r.id = ANY (v_ids)
     AND r.status = 'pending'
  RETURNING r.email, r.first_name, r.last_name, r.unsubscribe_token, r.attempts, r.ab_variant;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, integer) TO service_role;
