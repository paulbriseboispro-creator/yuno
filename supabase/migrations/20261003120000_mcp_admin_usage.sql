-- Serveur MCP — l'adoption vue par le super admin (/admin/ai, docs/MCP.md).
-- Combien de pros ont branché une IA, laquelle, sur quels espaces, quelles
-- analyses ils demandent, et ce qui échoue. Jamais le contenu des réponses (il
-- n'est stocké nulle part). Démo exclue par défaut, comme tout le dashboard.

CREATE OR REPLACE FUNCTION public.admin_mcp_usage(p_from timestamptz, p_to timestamptz, p_include_demo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_len interval := p_to - p_from;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN (
    WITH g AS MATERIALIZED (
      SELECT gr.*, u.email
        FROM public.mcp_grants gr
        JOIN auth.users u ON u.id = gr.user_id
       WHERE p_include_demo OR NOT public.is_demo_email(u.email)
    ),
    c AS MATERIALIZED (
      SELECT tc.* FROM public.mcp_tool_calls tc
       WHERE tc.grant_id IN (SELECT id FROM g)
         AND tc.created_at >= p_from - v_len AND tc.created_at < p_to
    ),
    cur AS (SELECT * FROM c WHERE created_at >= p_from)
    SELECT jsonb_build_object(
      'totals', jsonb_build_object(
        'active_connections', (SELECT count(*) FROM g WHERE revoked_at IS NULL),
        'connected_users', (SELECT count(DISTINCT user_id) FROM g WHERE revoked_at IS NULL),
        'customers_level', (SELECT count(*) FROM g WHERE revoked_at IS NULL AND level = 'customers'),
        'new_connections', (SELECT count(*) FROM g WHERE created_at >= p_from AND created_at < p_to),
        'revoked', (SELECT count(*) FROM g WHERE revoked_at >= p_from AND revoked_at < p_to),
        'security_revocations', (SELECT count(*) FROM g WHERE revoked_at >= p_from AND revoked_at < p_to
                                   AND revoked_reason IN ('refresh_reuse', 'code_replay')),
        'calls', (SELECT count(*) FROM cur),
        'prev_calls', (SELECT count(*) FROM c WHERE created_at < p_from),
        'errors', (SELECT count(*) FROM cur WHERE status <> 'ok'),
        'active_users', (SELECT count(DISTINCT user_id) FROM cur),
        'avg_ms', (SELECT round(avg(duration_ms)) FROM cur WHERE duration_ms IS NOT NULL)),
      'by_day', coalesce((SELECT jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d)
                            FROM (SELECT date_trunc('day', created_at AT TIME ZONE 'Europe/Paris')::date AS d, count(*) AS n
                                    FROM cur GROUP BY 1) x), '[]'::jsonb),
      'by_client', coalesce((SELECT jsonb_agg(jsonb_build_object('client', client_name, 'connections', n, 'calls', calls) ORDER BY n DESC)
                               FROM (SELECT g.client_name, count(*) FILTER (WHERE g.revoked_at IS NULL) AS n,
                                            (SELECT count(*) FROM cur WHERE cur.grant_id = ANY (array_agg(g.id))) AS calls
                                       FROM g GROUP BY g.client_name ORDER BY 2 DESC LIMIT 12) x), '[]'::jsonb),
      'by_tool', coalesce((SELECT jsonb_agg(jsonb_build_object('tool', tool, 'n', n, 'errors', e, 'avg_ms', ms) ORDER BY n DESC)
                             FROM (SELECT tool, count(*) AS n, count(*) FILTER (WHERE status <> 'ok') AS e,
                                          round(avg(duration_ms)) AS ms
                                     FROM cur GROUP BY tool) x), '[]'::jsonb),
      'by_space', coalesce((SELECT jsonb_agg(jsonb_build_object('space', space_key, 'name', name, 'calls', n) ORDER BY n DESC)
                              FROM (SELECT cur.space_key, count(*) AS n,
                                           coalesce((SELECT v.name FROM public.venues v WHERE 'venue:' || v.id = cur.space_key),
                                                    (SELECT op.display_name FROM public.organizer_profiles op WHERE 'org:' || op.user_id = cur.space_key),
                                                    cur.space_key) AS name
                                      FROM cur WHERE cur.space_key IS NOT NULL GROUP BY cur.space_key ORDER BY 2 DESC LIMIT 15) x), '[]'::jsonb),
      'recent_errors', coalesce((SELECT jsonb_agg(jsonb_build_object('tool', tool, 'error', error, 'status', status, 'at', created_at) ORDER BY created_at DESC)
                                   FROM (SELECT * FROM cur WHERE status <> 'ok' ORDER BY created_at DESC LIMIT 15) x), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mcp_usage(timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mcp_usage(timestamptz, timestamptz, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
