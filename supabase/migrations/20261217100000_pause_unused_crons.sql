-- Suite de la pause du 08/11 (20261208110000), après la panne du 16/11 (machine
-- Micro saturée en mémoire). On éteint les tâches planifiées des fonctions
-- retirées de Yuno Tickets et qui n'ont plus aucune donnée vivante au 16/11 :
--   - DJ : retirés de la Console (libération auto des bookings) ;
--   - promoteurs : retirés, 9 règlements tous payés ;
--   - bar : pilier en pause, 0 commande ;
--   - imports de contacts : fermés depuis le 08/11.
-- La minimisation des événements e-mail (RGPD) passe d'horaire à quotidienne :
-- plus aucune campagne n'en produit.
-- Rien n'est supprimé : chaque état d'avant est noté dans platform_pause_log ;
-- relancer = réactiver la ligne (cron.alter_job … active := true).
-- Restent allumés : achats en attente, factures, porte, rappels, moteur de push,
-- soirées récurrentes, collabs et co-organisation (3 contrats et 1 virement en
-- cours), abonnements CRM (3), synchro Shotgun (2), Madrid, purges RGPD.

DO $$
DECLARE
  r record;
  v_off text[] := ARRAY[
    'dj-booking-auto-release',
    'promoter-payout-reminders', 'promoter-payout-watchdog', 'promoter-push-queue-purge',
    'archive-stale-orders',
    'crm-imports-close-stale'
  ];
BEGIN
  FOR r IN SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = ANY (v_off) AND active LOOP
    INSERT INTO public.platform_pause_log (kind, ref, previous)
    VALUES ('cron', r.jobname, jsonb_build_object('active', r.active, 'schedule', r.schedule));
    PERFORM cron.alter_job(r.jobid, active := false);
  END LOOP;

  FOR r IN SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'email-events-minimize' LOOP
    INSERT INTO public.platform_pause_log (kind, ref, previous)
    VALUES ('cron', r.jobname, jsonb_build_object('active', r.active, 'schedule', r.schedule));
    PERFORM cron.alter_job(r.jobid, schedule := '13 3 * * *');
  END LOOP;
END $$;
