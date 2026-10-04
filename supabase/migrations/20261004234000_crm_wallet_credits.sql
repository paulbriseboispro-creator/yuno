-- Yuno CRM — écran « Recharger mes Yunits ».
--
-- 1. get_crm_wallet rend aussi `credits` : les 20 derniers crédits (recharges,
--    Yunits du mois, bonus annuel, essai, gestes de Yuno). Les 30 derniers
--    mouvements mélangent débits et crédits ; un compte qui envoie beaucoup n'y
--    voyait plus ses recharges. La méta d'une recharge porte la session Stripe :
--    c'est elle que l'écran attend au retour du paiement pour fêter le crédit.
--    Le coût d'un envoi programmé s'estime par son audience nette
--    (count_campaign_audience) tant que sa file n'est pas constituée : la
--    fonction n'est donc plus STABLE.
-- 2. La recharge automatique est « à venir » : on peut demander à être prévenu
--    (crm_feature_waitlist, fonction `auto_recharge`). Aucune carte n'est
--    débitée sans action de la personne tant qu'elle n'existe pas.

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

  -- Envois programmés (e-mail et SMS) : ce qu'ils vont consommer.
  WITH sched AS (
    -- Une campagne programmée n'a pas encore compté ses destinataires (la file
    -- se constitue à l'envoi) : on estime par son audience nette du moment.
    SELECT c.id::text AS id, c.name, 'email'::text AS channel, c.scheduled_at AS at,
           GREATEST(COALESCE(NULLIF(c.total_recipients, 0), NULLIF(c.recipients_count, 0),
                             (public.count_campaign_audience(c.id)->>'net')::int, 0), 0)
             * (cfg->'rates'->>'email')::int AS cost
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
    'balance', v_balance,
    'lots', v_lots,
    'moves', v_moves,
    'credits', v_credits,
    'reserved', v_reserved,
    'reserved_total', v_reserved_total,
    'spent_month', v_spent_month,
    'low_balance', (cfg->>'low_balance')::int,
    'rates', cfg->'rates',
    'channels_live', cfg->'channels_live'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_wallet(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_wallet(text, uuid) TO authenticated, service_role;

ALTER TABLE public.crm_feature_waitlist DROP CONSTRAINT IF EXISTS crm_feature_waitlist_feature_check;
ALTER TABLE public.crm_feature_waitlist ADD CONSTRAINT crm_feature_waitlist_feature_check
  CHECK (feature = ANY (ARRAY['instagram'::text, 'signup_pages'::text, 'brand_domain'::text, 'auto_recharge'::text]));

CREATE OR REPLACE FUNCTION public.crm_feature_waitlist_set(p_venue_id text, p_organizer_user_id uuid, p_feature text, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_feature NOT IN ('instagram', 'signup_pages', 'brand_domain', 'auto_recharge') THEN
    RAISE EXCEPTION 'unknown_feature' USING ERRCODE = '22023';
  END IF;
  IF p_on THEN
    INSERT INTO public.crm_feature_waitlist (scope_key, venue_id, organizer_user_id, feature, user_id)
    VALUES (public.crm_scope_key(p_venue_id, p_organizer_user_id), p_venue_id, p_organizer_user_id, p_feature, auth.uid())
    ON CONFLICT (scope_key, feature, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.crm_feature_waitlist
     WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND feature = p_feature AND user_id = auth.uid();
  END IF;
  RETURN p_on;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_feature_waitlist_set(text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_feature_waitlist_set(text, uuid, text, boolean) TO authenticated, service_role;
