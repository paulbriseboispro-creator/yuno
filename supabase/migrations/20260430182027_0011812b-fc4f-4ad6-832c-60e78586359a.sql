
DO $$
BEGIN
  PERFORM cron.unschedule('send-low-ticket-alert');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  PERFORM cron.unschedule('send-missed-you');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  PERFORM cron.unschedule('weekly-digest-thursday');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

-- Reprogrammer send-upsell-email (toutes les 30 min, comme avant)
SELECT private.reschedule_edge_cron('send-upsell-email', '*/30 * * * *', 'send-upsell-email');
