-- Yuno en pause (2026-11-08) : les tâches planifiées du marketing, des
-- relances, du moteur d'analyse avancée du CRM (hypothèses, chances de venir,
-- scénarios, plans de soirée, pages d'inscription), de la délivrabilité et des
-- e-mails automatiques sont ÉTEINTES (active = false, rien de supprimé). Chaque
-- état d'avant est noté dans platform_pause_log ; relancer = réactiver la ligne.
-- Restent : vente (achats en attente, factures, porte, soirées récurrentes),
-- collabs et virements, push, purges RGPD, analyse descriptive du CRM (synchro
-- Shotgun ralentie à 30 min, cache Clients à 30 min).

DO $$
DECLARE
  r record;
  v_off text[] := ARRAY[
    -- CRM : moteur avancé et envois
    'crm-analysis-nightly', 'crm-analysis-refresh', 'crm-score-nightly',
    'crm-first-return-sms', 'crm-night-plan-sweep', 'crm-scenario-tick',
    'crm-signup-relance', 'crm-learning-publish', 'crm-segment-counts',
    'crm-admin-daily', 'crm-yunits-allowance', 'crm-customer-basis-nightly',
    'crm-incident-deadline',
    -- E-mail : engagement, suggestions, délivrabilité, Postmaster, profils d'envoi
    'contact-engagement-sweep', 'email-automation-suggestions',
    'email-deliverability-tick', 'gmail-postmaster-daily',
    'refresh-send-profiles-daily', 'audience-daily-snapshot',
    -- E-mails automatiques aux clients et aux pros
    'send-missed-you-weekly', 'send-next-event-recommendation',
    'send-pre-night-checklist', 'send-low-ticket-alert-hourly',
    'inactivity-reminder-weekly', 'weekly-digest', 'cart-abandonment-check',
    -- Promoteurs : résumé du soir
    'promoter-night-digest'
  ];
BEGIN
  FOR r IN SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = ANY (v_off) AND active LOOP
    INSERT INTO public.platform_pause_log (kind, ref, previous)
    VALUES ('cron', r.jobname, jsonb_build_object('active', r.active, 'schedule', r.schedule));
    PERFORM cron.alter_job(r.jobid, active := false);
  END LOOP;

  -- Ralentis.
  FOR r IN SELECT jobid, jobname, schedule, active FROM cron.job
            WHERE jobname IN ('ticketing-sync', 'contact-base-cache-refresh', 'email-events-minimize') LOOP
    INSERT INTO public.platform_pause_log (kind, ref, previous)
    VALUES ('cron', r.jobname, jsonb_build_object('active', r.active, 'schedule', r.schedule));
    PERFORM cron.alter_job(r.jobid, schedule := CASE r.jobname
      WHEN 'ticketing-sync' THEN '*/30 * * * *'
      WHEN 'contact-base-cache-refresh' THEN '9,39 * * * *'
      ELSE '13 * * * *' END);
  END LOOP;

  -- Historique des tâches : 7 jours au lieu de 30.
  FOR r IN SELECT jobid, schedule FROM cron.job WHERE jobname = 'cron-history-purge' LOOP
    INSERT INTO public.platform_pause_log (kind, ref, previous)
    VALUES ('cron', 'cron-history-purge', jsonb_build_object('command', 'DELETE … 30 days'));
    PERFORM cron.alter_job(r.jobid, command := $c$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';$c$);
  END LOOP;

  -- Veille ponctuelle du 04/11 (WOH), périmée.
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('woh-revival-watch', 'woh-revival-watch-end') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;
