-- ============================================================================
-- Yuno CRM : pas de pack de Yunits pré-créé, la recharge se fait au curseur
-- (décision de Paul, 2026-10-05).
--
-- Le client choisit son montant sur un curseur (`crm_pricing_config()` :
-- recharge_min 5 000, recharge_max 300 000, recharge_step 5 000,
-- yunits_per_euro 500, bonus_tiers +10 % dès 25 000 et +15 % dès 50 000) ; le
-- serveur recalcule le devis (`crmRechargeQuote`, `_shared/crm-billing.ts`) et la
-- recharge part en `price_data`. La liste `packs` (5 000 / 12 500 / 27 500 /
-- 57 500) restait dans les réglages sans qu'aucun écran ni aucune fonction ne la
-- lise : elle est retirée, et l'Admin CRM ne peut plus la recréer. Les quatre
-- produits « packs » de Stripe ont été archivés le même jour.
-- Corps de `crm_admin_pricing_set` repris de la base liée (pg_get_functiondef,
-- 05/10) ; seul 'packs' quitte la liste des clés acceptées.
-- ============================================================================

UPDATE public.crm_pricing
   SET config = config - 'packs', updated_at = now()
 WHERE id AND config ? 'packs';

CREATE OR REPLACE FUNCTION public.crm_admin_pricing_set(p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_before jsonb := public.crm_pricing_config();
  v_after jsonb;
  k text;
  v_num constant text[] := ARRAY['price_month', 'price_month_next', 'price_year', 'trial_days', 'trial_yunits', 'monthly_yunits', 'annual_bonus_yunits',
                                  'price_switch_at', 'trial_extensions', 'low_balance'];
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k = ANY(v_num) THEN
      IF jsonb_typeof(p_patch->k) <> 'number' OR (p_patch->>k)::numeric < 0 OR (p_patch->>k)::numeric > 1000000 THEN
        RAISE EXCEPTION 'bad_value' USING ERRCODE = '22023';
      END IF;
    ELSIF k IN ('rates', 'costs', 'channels_live', 'bonus_tiers') THEN
      IF jsonb_typeof(p_patch->k) NOT IN ('object', 'array') THEN RAISE EXCEPTION 'bad_value' USING ERRCODE = '22023'; END IF;
    ELSE
      RAISE EXCEPTION 'unknown_key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_after := v_before || p_patch;
  IF (v_after->>'price_month')::numeric <= 0 OR (v_after->>'price_year')::numeric <= 0 THEN RAISE EXCEPTION 'bad_value' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_pricing SET config = v_after, updated_by = auth.uid(), updated_at = now() WHERE id;
  INSERT INTO public.crm_pricing_history (by_user, reason, before, after) VALUES (auth.uid(), left(trim(p_reason), 300), v_before, v_after);
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'crm_pricing_set', 'crm_pricing', 'config', jsonb_build_object('reason', left(trim(p_reason), 300), 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)));
  RETURN v_after;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_admin_pricing_set(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_pricing_set(jsonb, text) TO authenticated, service_role;
