-- ============================================================================
-- Console Yuno CRM — Connecteurs : « Inclure les soirées que je co-organise »
-- se règle depuis la page de gestion, sans recoller le jeton (la maquette
-- « Connecteurs » le propose en interrupteur). Même porte que la lecture et
-- les actions de l'edge (ticketing_scope_allowed : titulaire du compte ou
-- organisateur lui-même). La prochaine lecture de Shotgun est avancée pour
-- que le changement se voie vite ; rien n'est écrit chez Shotgun.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_ticketing_set_cohosted(
  p_venue_id text, p_organizer_user_id uuid, p_on boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.ticketing_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ticketing_connections c
     SET include_cohosted = COALESCE(p_on, true),
         next_sync_at = CASE WHEN c.status = 'active' THEN LEAST(COALESCE(c.next_sync_at, now()), now() + interval '1 minute') ELSE c.next_sync_at END,
         updated_at = now()
   WHERE c.provider = 'shotgun'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
  RETURNING c.id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('error', 'not_connected'); END IF;
  RETURN jsonb_build_object('ok', true, 'include_cohosted', COALESCE(p_on, true));
END;
$$;

REVOKE ALL ON FUNCTION public.crm_ticketing_set_cohosted(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ticketing_set_cohosted(text, uuid, boolean) TO authenticated, service_role;
