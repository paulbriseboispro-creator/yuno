-- ============================================================================
-- Yuno CRM — /get-started connaît le produit choisi à l'inscription.
-- open_my_pro_signup rend `product` ('suite' | 'crm', pro_signups.product,
-- migration 20261002190000) : un compte CRM reçoit le plan « connecter la
-- billetterie », pas celui d'un compte qui vend.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.open_my_pro_signup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.pro_signups%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_row FROM public.pro_signups
   WHERE user_id = v_uid ORDER BY account_created_at DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_row.console_opened_at IS NULL AND NOT public.is_support_session() THEN
    UPDATE public.pro_signups
       SET console_opened_at = now(),
           steps = steps || jsonb_build_object('console', now()),
           last_step = 'console',
           updated_at = now()
     WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'kind', v_row.kind,
    'product', COALESCE(v_row.product, 'suite'),
    'first_name', v_row.first_name,
    'org_name', v_row.org_name,
    'city', v_row.city,
    'size_band', v_row.size_band,
    'frequency', v_row.frequency,
    'pillars', to_jsonb(v_row.pillars),
    'current_tool', v_row.current_tool,
    'next_night', v_row.next_night,
    'lang', v_row.lang,
    'venue_id', v_row.venue_id
  );
END $function$;
