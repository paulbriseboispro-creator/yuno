-- Lot 6 de la refonte de l'admin : Système › Interrupteurs.
-- Maintenance et Paiements s'écrivaient par un UPDATE direct de app_settings,
-- sans motif ni trace. Une seule porte, avec motif obligatoire, au journal.
-- Rien d'autre ne change : le trigger notify_admin_platform_switch alerte
-- toujours, la RLS de app_settings reste la même.

CREATE OR REPLACE FUNCTION public.admin_set_platform_switch(
  p_key text, p_enabled boolean, p_reason text, p_message text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.app_settings;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_key NOT IN ('maintenance_mode', 'payments_disabled') THEN RAISE EXCEPTION 'unknown_switch'; END IF;
  SELECT * INTO s FROM public.app_settings WHERE id = 'global' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings_missing'; END IF;
  IF p_key = 'maintenance_mode' THEN
    UPDATE public.app_settings
       SET maintenance_mode = p_enabled,
           maintenance_message = COALESCE(NULLIF(btrim(p_message), ''), maintenance_message),
           updated_at = now(), updated_by = auth.uid()
     WHERE id = 'global';
  ELSE
    UPDATE public.app_settings
       SET payments_disabled = p_enabled, updated_at = now(), updated_by = auth.uid()
     WHERE id = 'global';
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'platform_switch_set', 'platform_switch', p_key,
          jsonb_build_object('reason', p_reason, 'enabled', p_enabled,
            'was', CASE WHEN p_key = 'maintenance_mode' THEN s.maintenance_mode ELSE s.payments_disabled END));
  RETURN jsonb_build_object('ok', true, 'key', p_key, 'enabled', p_enabled);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_platform_switch(text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_switch(text, boolean, text, text) TO authenticated;
