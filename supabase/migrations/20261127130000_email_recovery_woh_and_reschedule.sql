-- Reprise Gmail : mesures propres à WOH et reprogrammation des envois du 04/11.
--
-- Décision de Paul (03/11) : les envois en bloc du fichier importé du compte
-- Yuno Tickets de WOH (org:617d01cb…, 01/09, 09-10/09, 08/10) ont fait classer
-- news.yunoapp.eu en spam par Gmail. L'espace Yuno CRM de WOH (venue:woh) a la
-- même base. Les deux comptes :
--   - n'écrivent à AUCUNE adresse jamais contactée pendant 21 jours ;
--   - le compte Tickets est plafonné à 800 e-mails par jour (l'espace CRM, qui
--     n'a jamais envoyé, suit la montée en charge : 300 le premier jour).
-- Puis les deux campagnes du 04/11 sont reprogrammées, réparties :
--   - WOH × REVIVAL (venue:woh) : 10 h, 200 e-mails par heure — la soirée est à
--     23 h ; ce qui n'est pas parti à 23 h ne part plus (email_skip_after_event_start) ;
--   - 3AM Act III (org:10764c3b…) : 18 h, 250 e-mails par heure.
-- Cette migration passe APRÈS 20261127100000 → 120000 : les règles sont en place
-- avant que la moindre campagne soit reprogrammée.

INSERT INTO public.email_sender_health (scope_key, cold_frozen_until, reason, metrics, updated_at)
SELECT k, now() + interval '21 days', 'incident',
       jsonb_build_object('note', 'Envois en bloc d''un fichier importé (01/09, 09-10/09, 08/10) : Gmail range news.yunoapp.eu en spam.'),
       now()
  FROM unnest(ARRAY['org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8', 'venue:woh']) AS k
ON CONFLICT (scope_key) DO UPDATE
  SET cold_frozen_until = GREATEST(COALESCE(email_sender_health.cold_frozen_until, now()), EXCLUDED.cold_frozen_until),
      reason = EXCLUDED.reason, metrics = EXCLUDED.metrics, burst_allowed = false, updated_at = now();

UPDATE public.email_sender_state
   SET daily_cap_override = 800, updated_at = now()
 WHERE scope_key = 'org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8';

-- WOH × REVIVAL : brouillon depuis le 03/11 au soir (déprogrammé par l'accès
-- assisté), reprogrammé ici seulement s'il n'a pas bougé entre-temps.
UPDATE public.email_campaigns
   SET status = 'scheduled',
       scheduled_at = timestamptz '2026-11-04 10:00:00 Europe/Paris',
       throttle_per_hour = 200, throttle_window_minutes = 60,
       throttle_plan = jsonb_build_object('mode', 'hour', 'days', 2, 'custom', true),
       quiet_hours = true
 WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d' AND status = 'draft'
   AND now() < timestamptz '2026-11-04 10:00:00 Europe/Paris';

-- 3AM Act III : brouillon prêt (audience, relance après clic), programmé à 18 h.
UPDATE public.email_campaigns
   SET status = 'scheduled',
       scheduled_at = timestamptz '2026-11-04 18:00:00 Europe/Paris',
       throttle_per_hour = 250, throttle_window_minutes = 60,
       throttle_plan = jsonb_build_object('mode', 'hour', 'days', 2, 'custom', true),
       quiet_hours = true
 WHERE id = 'ec6daa79-91b3-4c79-ad08-b8c58c7704db' AND status = 'draft'
   AND now() < timestamptz '2026-11-04 18:00:00 Europe/Paris';
