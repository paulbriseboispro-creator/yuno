-- ============================================================================
-- admin_log_action — journalisation des actions admin pilotées côté front
-- (ex. attribution / retrait du rôle admin, qui passe par une écriture directe
-- user_roles + RLS et ne peut donc pas être journalisée côté serveur).
--
-- RPC self-gated par is_super_admin() : un non-admin reçoit une exception et
-- n'écrit rien. Complète log_admin_action (interne) qui reste hors d'atteinte
-- des clients.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_log_action(
  _action      text,
  _entity_type text DEFAULT NULL,
  _entity_id   text DEFAULT NULL,
  _metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), _action, _entity_type, _entity_id, COALESCE(_metadata, '{}'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_log_action(text, text, text, jsonb) TO authenticated;
