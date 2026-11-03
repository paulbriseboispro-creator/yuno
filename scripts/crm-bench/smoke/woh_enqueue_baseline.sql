-- Mise en file WOH × REVIVAL telle qu'aujourd'hui (annulée), pour la durée.
DO $s$
DECLARE r jsonb; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  RAISE EXCEPTION 'SMOKE_OK ms=% %', round(extract(epoch FROM clock_timestamp() - t0) * 1000), r;
END $s$;
