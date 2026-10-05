-- Panne de la prod du 05/10 (≈ 21:40 → 22:55 UTC) : base, API REST, connexion
-- et stockage UNHEALTHY. Récit, cause et marche à suivre :
-- docs/SUPABASE_PROD_HEALTH.md.
--
-- Cause : la prod tourne sur la plus petite machine Supabase (offre gratuite,
-- 426 Mo de RAM, dont 224 Mo réservés à shared_buffers par Supabase). À vide,
-- elle utilise déjà ~390 Mo de swap ; le moindre pic (tests SQL concurrents,
-- migrations qui rechargent le cache de schéma de PostgREST en 21 s, crons
-- lourds) la fait swapper jusqu'à ce que plus aucun service ne réponde.
--
-- Les deux crons de la base de contacts avaient été mis en pause pendant la
-- panne (cron.alter_job, active := false). On les rallume ici, plus espacés :
--   * contact-base-cache-refresh : chaque minute → toutes les 5 minutes. Il ne
--     reconstruit que les portées LUES dans les 15 dernières minutes et
--     périmées ; entre deux passages la Console sert la portée telle quelle
--     (consentement toujours lu en direct). 1 440 → 288 passages par jour,
--     autant d'écritures en moins dans cron.job_run_details.
--   * contact-engagement-sweep : toutes les 10 min → toutes les 30 min. Les
--     statuts sont de toute façon recalculés à la fin d'un envoi
--     (send-campaign) et par le bouton « Actualiser ».
-- Idempotent : rejouable sans effet de bord.

SELECT cron.alter_job(jobid, schedule := '*/5 * * * *', active := true)
  FROM cron.job
 WHERE jobname = 'contact-base-cache-refresh';

SELECT cron.alter_job(jobid, schedule := '*/30 * * * *', active := true)
  FROM cron.job
 WHERE jobname = 'contact-engagement-sweep';
