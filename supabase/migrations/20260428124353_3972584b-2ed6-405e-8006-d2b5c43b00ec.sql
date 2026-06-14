-- Wrapper RPC to refresh the analytics_daily_rollup materialized view via cron
CREATE OR REPLACE FUNCTION public.refresh_analytics_daily_rollup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.analytics_daily_rollup;
END;
$$;

-- Cleanup old visitor events / pings periodically to keep table light
CREATE OR REPLACE FUNCTION public.cleanup_old_visitor_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Keep 90 days of granular events
  DELETE FROM public.visitor_events WHERE ts < now() - interval '90 days';
END;
$$;