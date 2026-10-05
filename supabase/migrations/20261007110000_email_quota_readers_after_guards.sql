-- ============================================================================
-- Lecteurs du quota email, réaffirmés après `20261005211000` (2026-10-05).
--
-- `20261005211000_email_push_guards_anon` (gardes `COALESCE(…, false)`, anon
-- retiré) a été jouée en production APRÈS `20261007100000`. Elle redéfinit
-- `get_email_quota_status` et `get_campaign_send_progress` depuis leur version
-- d'avant `paid_sent` : le « reste d'emails » aurait de nouveau compté les
-- emails payés comme de l'offert consommé. On remet les corps de
-- `20261007100000`, qui portent déjà les mêmes gardes et le même retrait d'anon.
-- Sur une base rejouée dans l'ordre, cette migration ne change rien.
-- ============================================================================

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
