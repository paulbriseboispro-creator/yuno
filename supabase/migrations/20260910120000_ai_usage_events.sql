-- ─── Suivi de consommation IA (super admin) ─────────────────────────────────
-- Une ligne par appel OpenAI émis par les edge functions (assistants client /
-- owner / agence, traduction, embeddings). Écrit par service_role seulement
-- (`_shared/ai-usage.ts`), lu par le super admin via `admin_ai_usage()`.
-- RLS totale, aucune policy : la table est invisible côté client.

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  assistant text NOT NULL,
  model text NOT NULL,
  user_id uuid,
  user_email text,
  venue_id text,
  agency_id uuid,
  language text,
  status text NOT NULL DEFAULT 'ok',
  error text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  latency_ms integer,
  rounds integer,
  tool_calls text[],
  turn_count integer,
  prompt_chars integer,
  completion_chars integer,
  prompt_preview text,
  CONSTRAINT ai_usage_events_status_check CHECK (status IN ('ok', 'error', 'rate_limited', 'unavailable'))
);

CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx ON public.ai_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_assistant_created_idx ON public.ai_usage_events (assistant, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_idx ON public.ai_usage_events (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_events FROM anon, authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_usage_events_id_seq TO service_role;

COMMENT ON TABLE public.ai_usage_events IS
  'Journal de consommation IA (tokens, coût estimé, latence, question tronquée). Service_role écrit, admin_ai_usage() lit. Purgé à 13 mois.';

-- ─── Purge (13 mois, comme le trafic plateforme) ────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_ai_usage_events()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.ai_usage_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.purge_ai_usage_events() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ai-usage-purge';
    PERFORM cron.schedule('ai-usage-purge', '45 3 * * *', $cron$ SELECT public.purge_ai_usage_events(); $cron$);
  END IF;
END $$;

-- ─── Lecture super admin ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_ai_usage(
  p_from timestamptz,
  p_to timestamptz,
  p_include_demo boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH ev AS (
    SELECT e.*
    FROM public.ai_usage_events e
    WHERE e.created_at >= p_from AND e.created_at <= p_to
      AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
  ),
  prev AS (
    SELECT count(*) AS n, COALESCE(sum(cost_usd), 0) AS cost_usd, COALESCE(sum(total_tokens), 0) AS tokens
    FROM public.ai_usage_events e
    WHERE e.created_at >= p_from - (p_to - p_from) AND e.created_at < p_from
      AND (p_include_demo OR NOT public.is_demo_email(e.user_email))
  ),
  days AS (
    SELECT gs.d::date AS d
    FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to), interval '1 day') gs(d)
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'events', count(*),
        'chats', count(*) FILTER (WHERE assistant IN ('client', 'owner', 'agency')),
        'users', count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL),
        'prompt_tokens', COALESCE(sum(prompt_tokens), 0),
        'completion_tokens', COALESCE(sum(completion_tokens), 0),
        'tokens', COALESCE(sum(total_tokens), 0),
        'cost_usd', round(COALESCE(sum(cost_usd), 0), 4),
        'errors', count(*) FILTER (WHERE status <> 'ok'),
        'error_rate', CASE WHEN count(*) > 0
          THEN round(count(*) FILTER (WHERE status <> 'ok')::numeric / count(*) * 100, 1) ELSE 0 END,
        'avg_latency_ms', round(COALESCE(avg(latency_ms), 0)),
        'p95_latency_ms', COALESCE((SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM ev WHERE latency_ms IS NOT NULL), 0),
        'avg_turns', round(COALESCE(avg(turn_count) FILTER (WHERE assistant IN ('client', 'owner', 'agency')), 0), 1),
        'tool_events', count(*) FILTER (WHERE tool_calls IS NOT NULL AND cardinality(tool_calls) > 0),
        'prev_events', (SELECT n FROM prev),
        'prev_cost_usd', round((SELECT cost_usd FROM prev), 4),
        'prev_tokens', (SELECT tokens FROM prev)
      ) FROM ev
    ),
    'by_assistant', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'assistant', assistant, 'n', n, 'users', users, 'tokens', tokens,
        'cost_usd', round(cost_usd, 4), 'errors', errors, 'avg_latency_ms', avg_latency_ms,
        'avg_turns', avg_turns
      ) ORDER BY n DESC)
      FROM (
        SELECT assistant, count(*) AS n,
          count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS users,
          COALESCE(sum(total_tokens), 0) AS tokens, COALESCE(sum(cost_usd), 0) AS cost_usd,
          count(*) FILTER (WHERE status <> 'ok') AS errors,
          round(COALESCE(avg(latency_ms), 0)) AS avg_latency_ms,
          round(COALESCE(avg(turn_count), 0), 1) AS avg_turns
        FROM ev GROUP BY assistant
      ) s
    ), '[]'::jsonb),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'd', to_char(days.d, 'YYYY-MM-DD'),
        'n', count(ev.id),
        'client', count(ev.id) FILTER (WHERE ev.assistant IN ('client', 'client_search')),
        'owner', count(ev.id) FILTER (WHERE ev.assistant LIKE 'owner%'),
        'agency', count(ev.id) FILTER (WHERE ev.assistant = 'agency'),
        'other', count(ev.id) FILTER (WHERE ev.assistant IN ('translate', 'embeddings')),
        'tokens', COALESCE(sum(ev.total_tokens), 0),
        'cost_usd', round(COALESCE(sum(ev.cost_usd), 0), 4),
        'errors', count(ev.id) FILTER (WHERE ev.status <> 'ok')
      ) ORDER BY days.d)
      FROM days LEFT JOIN ev ON date(ev.created_at) = days.d
      GROUP BY days.d
    ), '[]'::jsonb),
    'by_hour', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('h', h, 'n', n) ORDER BY h)
      FROM (
        SELECT extract(hour FROM created_at AT TIME ZONE 'Europe/Paris')::int AS h, count(*) AS n
        FROM ev WHERE assistant IN ('client', 'owner', 'agency') GROUP BY 1
      ) s
    ), '[]'::jsonb),
    'by_model', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('model', model, 'n', n, 'tokens', tokens, 'cost_usd', round(cost_usd, 4)) ORDER BY cost_usd DESC)
      FROM (SELECT model, count(*) AS n, COALESCE(sum(total_tokens), 0) AS tokens, COALESCE(sum(cost_usd), 0) AS cost_usd FROM ev GROUP BY model) s
    ), '[]'::jsonb),
    'by_language', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('language', COALESCE(language, '?'), 'n', n) ORDER BY n DESC)
      FROM (SELECT language, count(*) AS n FROM ev WHERE assistant IN ('client', 'owner', 'agency') GROUP BY language) s
    ), '[]'::jsonb),
    'top_users', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.user_id, 'email', s.user_email,
        'name', COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.display_name),
        'n', s.n, 'tokens', s.tokens, 'cost_usd', round(s.cost_usd, 4),
        'assistants', s.assistants, 'last_at', s.last_at
      ) ORDER BY s.n DESC)
      FROM (
        SELECT user_id, max(user_email) AS user_email, count(*) AS n,
          COALESCE(sum(total_tokens), 0) AS tokens, COALESCE(sum(cost_usd), 0) AS cost_usd,
          array_agg(DISTINCT assistant) AS assistants, max(created_at) AS last_at
        FROM ev WHERE user_id IS NOT NULL
        GROUP BY user_id ORDER BY count(*) DESC LIMIT 12
      ) s LEFT JOIN public.profiles p ON p.id = s.user_id
    ), '[]'::jsonb),
    'top_tools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tool', tool, 'n', n, 'assistant', assistant) ORDER BY n DESC)
      FROM (
        SELECT u.tool, ev.assistant, count(*) AS n
        FROM ev, unnest(ev.tool_calls) AS u(tool)
        GROUP BY u.tool, ev.assistant ORDER BY count(*) DESC LIMIT 20
      ) s
    ), '[]'::jsonb),
    'recent', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'assistant', assistant, 'model', model,
        'email', user_email, 'status', status, 'error', error,
        'tokens', total_tokens, 'cost_usd', round(cost_usd, 5), 'latency_ms', latency_ms,
        'turns', turn_count, 'tools', tool_calls, 'language', language,
        'prompt', prompt_preview, 'venue_id', venue_id
      ) ORDER BY created_at DESC)
      FROM (SELECT * FROM ev WHERE assistant IN ('client', 'owner', 'agency', 'client_search') ORDER BY created_at DESC LIMIT 60) r
    ), '[]'::jsonb),
    'recent_errors', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'assistant', assistant, 'status', status, 'error', error, 'email', user_email
      ) ORDER BY created_at DESC)
      FROM (SELECT * FROM ev WHERE status <> 'ok' ORDER BY created_at DESC LIMIT 20) r
    ), '[]'::jsonb),
    'legacy_tool_audit', jsonb_build_object(
      'owner', (SELECT count(*) FROM public.owner_ai_audit_log a WHERE a.created_at >= p_from AND a.created_at <= p_to),
      'agency', (SELECT count(*) FROM public.agency_ai_audit_log a WHERE a.created_at >= p_from AND a.created_at <= p_to)
    )
  ) INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_ai_usage(timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_usage(timestamptz, timestamptz, boolean) TO authenticated, service_role;
