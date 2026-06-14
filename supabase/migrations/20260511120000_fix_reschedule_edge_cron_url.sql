-- Fix private.reschedule_edge_cron() — was pointing to old project URL.
-- All cron functions have verify_jwt = false, so the anon key value is
-- not validated; we keep a placeholder to satisfy the header format.
CREATE OR REPLACE FUNCTION private.reschedule_edge_cron(
  p_job_name text,
  p_schedule text,
  p_function_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_url text := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/' || p_function_path;
  v_command text;
BEGIN
  BEGIN
    PERFORM cron.unschedule(p_job_name);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_command := format($cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('triggered_at', now())
    );
  $cmd$, v_url);

  PERFORM cron.schedule(p_job_name, p_schedule, v_command);
END;
$$;

REVOKE ALL ON FUNCTION private.reschedule_edge_cron(text, text, text) FROM PUBLIC, anon, authenticated;
