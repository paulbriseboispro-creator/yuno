-- ============================================================================
-- Un email PAYÉ n'attend jamais la cagnotte plateforme (2026-10-05).
--
-- `consume_email_send_quota` contrôlait l'étage 1 (cagnotte marketing de la
-- plateforme, 40 000 / mois) AVANT les crédits de l'expéditeur. Cagnotte vide :
-- une campagne payée en crédits (packs de la Suite) ou en Yunits (Yuno CRM)
-- attendait le 1er du mois, alors que Resend l'aurait envoyée — le dépassement
-- payant est activé sur le compte (0,90 $ / 1 000 au-delà des 50 000 de l'offre
-- Pro, plafond dur à 5 × le quota, où Resend met TOUT en pause, billets compris).
--
-- Désormais :
--   * la cagnotte ne compte que les emails OFFERTS (ce que Yuno paie seul) ;
--   * un email payé (crédits Suite, Yunits CRM) passe au-delà ;
--   * un plafond absolu de la plateforme, `email_platform_monthly_ceiling()`,
--     reste sous le plafond dur de Resend pour qu'une campagne ne coupe jamais
--     les confirmations de billets ;
--   * le plafond JOURNALIER de la plateforme (anti-emballement) et le rodage de
--     l'expéditeur valent pour tout, payé ou non.
--
-- `email_send_quota_month.sent` garde son sens (TOUS les emails comptés ce
-- mois) ; `paid_sent` en est la part payée. Offert consommé = sent − paid_sent,
-- pour l'expéditeur comme pour la plateforme.
--
-- Ordre d'attribution : l'offert d'abord (dans la limite de la cagnotte), puis
-- le payé. Quand la cagnotte est vide, un expéditeur qui a encore de l'offert
-- ET des crédits envoie sur ses crédits : il a payé pour ça.
-- Remboursement (lot rendu par le worker) : le payé d'abord, puis l'offert.
--
-- Yuno CRM : `email_sender_monthly_free` rend 1e9 (offre active) ou 0 (en
-- pause), et les Yunits sont débités à la mise en file. Tout email d'un compte
-- CRM est donc payé : il ne touche ni la cagnotte ni `credit_balance`.
--
-- Lecteurs : `get_email_quota_status` et `get_campaign_send_progress` calculent
-- le reste sur l'offert réellement consommé. Corps repris de la base liée
-- (pg_get_functiondef, 05/10), avec les gardes `COALESCE(…, false)` et le
-- retrait d'anon de `20261005211000` (pas encore jouée en production).
-- ⚠️ Si `20261005211000` est jouée APRÈS celle-ci, reprendre ces deux corps-ci :
-- elle redéfinit les deux lecteurs depuis leur version précédente.
-- ============================================================================

ALTER TABLE public.email_send_quota_month
  ADD COLUMN IF NOT EXISTS paid_sent integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.email_send_quota_month.paid_sent IS
  'Part payée (crédits Suite, Yunits CRM) de sent. Offert consommé = sent - paid_sent. La cagnotte plateforme ne compte que l''offert.';

-- Mois en cours : la part déjà payée se déduit de la règle précédente
-- (dépassement de l'offert = crédits), sinon un remboursement de ce mois ne
-- rendrait pas les crédits déjà débités.
UPDATE public.email_send_quota_month q
   SET paid_sent = CASE
         WHEN public.crm_scope_is_crm(q.scope_key) THEN q.sent
         ELSE GREATEST(0, q.sent - public.email_sender_monthly_free(q.scope_key))
       END
 WHERE q.month = date_trunc('month', CURRENT_DATE)::date
   AND (q.scope_key LIKE 'venue:%' OR q.scope_key LIKE 'org:%');

UPDATE public.email_send_quota_month p
   SET paid_sent = LEAST(p.sent, (
         SELECT COALESCE(sum(s.paid_sent), 0)::integer
           FROM public.email_send_quota_month s
          WHERE s.month = p.month
            AND (s.scope_key LIKE 'venue:%' OR s.scope_key LIKE 'org:%')))
 WHERE p.scope_key = 'platform'
   AND p.month = date_trunc('month', CURRENT_DATE)::date;

-- ── Plafond absolu de la plateforme ─────────────────────────────────────────
-- Resend Pro : 50 000 / mois, plafond dur à 5 × = 250 000 (TOUT s'arrête, billets
-- compris). On garde 20 000 de réserve au transactionnel. Changer d'offre
-- Resend = changer ce chiffre (Scale 100 000 → 480 000, etc.).
CREATE OR REPLACE FUNCTION public.email_platform_monthly_ceiling()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT 230000 $$;

REVOKE ALL ON FUNCTION public.email_platform_monthly_ceiling() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_platform_monthly_ceiling() TO service_role;

-- ── Consommation ────────────────────────────────────────────────────────────
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
  -- plateforme
  v_p_day_sent integer;
  v_p_day_cap integer;
  v_p_month_sent integer;
  v_p_month_paid integer;
  v_pool_cap integer;
  v_ceiling integer;
  -- expéditeur
  v_is_crm boolean;
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
  v_is_crm := COALESCE(public.crm_scope_is_crm(p_scope_key), false);

  IF v_is_crm THEN
    -- Yuno CRM : tout est payé en Yunits (débités à la mise en file). La seule
    -- borne est l'offre (1e9 active, 0 en pause).
    v_free_left := 0;
    v_paid_cap := GREATEST(0, v_free - v_month_sent);
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
$$;

REVOKE ALL ON FUNCTION public.consume_email_send_quota(text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_email_send_quota(text, integer, text, uuid) TO service_role;

-- ── Remboursement (lot accordé mais non envoyé) ─────────────────────────────
-- Le payé d'abord (crédits rendus), puis l'offert.
CREATE OR REPLACE FUNCTION public.refund_email_send_quota(p_scope_key text, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer := GREATEST(0, COALESCE(p_amount, 0));
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_paid integer;
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

  SELECT paid_sent INTO v_paid FROM public.email_send_quota_month
   WHERE scope_key = p_scope_key AND month = v_month FOR UPDATE;
  IF FOUND THEN
    v_paid_back := LEAST(v_amount, COALESCE(v_paid, 0));
  END IF;
  v_is_crm := COALESCE(public.crm_scope_is_crm(p_scope_key), false);

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
$$;

REVOKE ALL ON FUNCTION public.refund_email_send_quota(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_email_send_quota(text, integer) TO service_role;

-- ── Lecteurs : le reste se calcule sur l'offert réellement consommé ─────────
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

REVOKE ALL ON FUNCTION public.get_email_quota_status(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_email_quota_status(text, uuid) TO authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.get_campaign_send_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_campaign_send_progress(uuid) TO authenticated, service_role;
