-- 3AM Act III : départ demain 10 h (Paris), comme WOH × REVIVAL, demande de Paul du 03/11.
-- Rien ne part d'un coup : envoi réparti imposé, vagues pour les adresses froides,
-- Gmail froides retenues, plafond du niveau 1 (300 / jour, 150 / h).
SET lock_timeout = '3s';
UPDATE public.email_campaigns
   SET scheduled_at = timestamp '2026-11-04 10:00:00' AT TIME ZONE 'Europe/Paris',
       throttle_per_hour = 150
 WHERE id = 'ec6daa79-91b3-4c79-ad08-b8c58c7704db' AND status = 'scheduled';
UPDATE public.email_campaigns
   SET throttle_per_hour = 150
 WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d' AND status = 'scheduled';
