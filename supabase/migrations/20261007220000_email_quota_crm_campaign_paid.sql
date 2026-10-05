-- ============================================================================
-- Emails : la campagne CRM d'un compte à DEUX produits (Billetterie + CRM) est
-- payée en Yunits, elle ne consomme plus l'offert de la Billetterie.
--
-- Trouvé le 05/10 avant de brancher le premier client (WOH : compte Billetterie
-- qui envoie déjà, 12 194 contacts, CRM ajouté par extra_products). Les Yunits
-- d'une campagne CRM sont débités à la mise en file (crm_campaign_is_crm), mais
-- consume_email_send_quota ne connaissait que la portée : pour un compte à deux
-- produits (crm_scope_is_crm = faux), chaque envoi CRM entamait les 15 000
-- emails offerts du mois de la Billetterie, puis, l'offert épuisé, cherchait
-- des crédits Billetterie (0) : la campagne, déjà payée en Yunits, attendait le
-- 1er du mois. Elle comptait aussi dans la cagnotte offerte de la plateforme.
--
-- Les deux fonctions prennent la campagne (p_campaign_id, facultatif : un appel
-- à quatre arguments garde le comportement d'avant). DROP + CREATE : une
-- surcharge rendrait ambigus les appels à arguments nommés (erreur 300).
-- Corps repris de la base liée (pg_get_functiondef, 05/10) ; seul le choix
-- « payé en Yunits » change. send-campaign passe p_campaign_id (redéployer la
-- fonction APRÈS cette migration).
-- ============================================================================

DROP FUNCTION IF EXISTS public.consume_email_send_quota(text, integer, text, uuid);
DROP FUNCTION IF EXISTS public.refund_email_send_quota(text, integer);

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

REVOKE ALL ON FUNCTION public.consume_email_send_quota(text, integer, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_email_send_quota(text, integer, text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.refund_email_send_quota(text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_email_send_quota(text, integer, uuid) TO service_role;
