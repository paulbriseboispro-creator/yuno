-- Serveur MCP — suite de 20261003100000 (docs/MCP.md).
--
-- 1. Un appel qui dépasse les 8 s de la base est annulé AVEC la ligne de
--    journal qu'il venait d'écrire : l'échec était invisible, pour le pro comme
--    pour Yuno. Le Worker le note après coup ici (hors de la transaction
--    annulée), sur un jeton encore valide uniquement.
-- 2. _mcp_redact parcourt du jsonb : STABLE, pas IMMUTABLE (db lint).

CREATE OR REPLACE FUNCTION public.mcp_log_failure(p_access_hash text, p_tool text, p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND OR p_tool IS NULL OR p_tool !~ '^[a-z_]{3,40}$' THEN RETURN; END IF;
  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, status, error)
  VALUES (a.grant_id, a.user_id, p_tool, 'error', left(coalesce(p_error, 'failed'), 120));
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_log_failure(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_log_failure(text, text, text) TO service_role;

ALTER FUNCTION public._mcp_redact(jsonb, boolean) STABLE;

NOTIFY pgrst, 'reload schema';
