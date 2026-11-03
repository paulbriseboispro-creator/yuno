-- Envoi unique du 04/11 : WOH × REVIVAL ne part QU'AUX adresses Gmail actives.
--
-- Décision de Paul (04/11, nuit) : se servir de cet envoi pour faire remonter la
-- réputation de news.yunoapp.eu chez Gmail. On écrit seulement aux Gmail qui ont
-- ouvert ou cliqué un e-mail ces 90 derniers jours (953 au calcul du 04/11), aucune
-- autre messagerie, aucune adresse froide.
--
-- 1. La liste est calculée maintenant, en jouant la mise en file de la campagne dans
--    un bloc annulé : mêmes règles que l'envoi réel (accord, politique d'envoi,
--    reprise Gmail, exclusions de la campagne), puis on garde les Gmail retenues
--    qui ont ouvert ou cliqué depuis 90 jours. Elle est posée dans l'audience
--    (clé `emails` de _crm_filter_sql, en plus du filtre Paris d'origine). Le lien
--    au segment enregistré est retiré : sinon c'est lui qui fait foi, pas `def`.
-- 2. Rythme : 150 / h (« petit à petit », Paul), départ 10 h, les plus actifs d'abord, fin vers 16 h 30.
-- 3. Plafond : WOH CRM (venue:woh) passe au niveau 3 et à 1 000 / jour (sa montée en
--    charge l'aurait laissé à 300) de 9 h 55 à
--    23 h 30, heure de Paris, puis revient au niveau 1. Après le passage quotidien
--    des niveaux (6 h), pour qu'il ne le défasse pas. Les deux tâches cron
--    s'effacent seules.
SET lock_timeout = '3s';

DO $m$
DECLARE
  v_emails jsonb;
  v_aud jsonb;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM public.enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
    SELECT jsonb_agg(DISTINCT lower(r.email)) INTO v_emails
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d'
       AND r.status = 'pending'
       AND public._email_is_gmail(r.email)
       AND EXISTS (SELECT 1 FROM public.email_campaign_events e
                    WHERE lower(e.recipient_email) = lower(r.email)
                      AND e.event_type IN ('opened', 'clicked')
                      AND e.created_at > now() - interval '90 days');
    RAISE EXCEPTION 'woh_sim_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'woh_sim_rollback' THEN RAISE; END IF;
  END;

  IF v_emails IS NULL OR jsonb_array_length(v_emails) < 500 OR jsonb_array_length(v_emails) > 1200 THEN
    RAISE EXCEPTION 'woh_gmail_list_unexpected: %', COALESCE(jsonb_array_length(v_emails), 0);
  END IF;

  SELECT audiences_json INTO v_aud FROM public.email_campaigns
   WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d' AND status = 'scheduled' FOR UPDATE;
  IF v_aud IS NULL THEN RAISE EXCEPTION 'woh_campaign_not_scheduled'; END IF;

  UPDATE public.email_campaigns
     SET audiences_json = jsonb_build_array(jsonb_set(
           jsonb_set((v_aud->0) - 'segmentId', '{def,f,emails}', v_emails, true),
           '{label}', to_jsonb('Gmail actifs (90 jours), reprise Gmail'::text))),
         throttle_per_hour = 150
   WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d';

  -- Plafond relevé pour la journée seulement.
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('woh-revival-level-up', 'woh-revival-level-down');
  PERFORM cron.schedule('woh-revival-level-up', '55 8 4 11 *', $c$
    UPDATE public.email_sender_health SET level = 3, level_since = now() WHERE scope_key = 'venue:woh';
    INSERT INTO public.email_sender_state (scope_key, venue_id, daily_cap_override) VALUES ('venue:woh', 'woh', 1000)
    ON CONFLICT (scope_key) DO UPDATE SET daily_cap_override = 1000, updated_at = now();
    INSERT INTO public.email_sender_level_history (scope_key, from_level, to_level, reason)
    VALUES ('venue:woh', 1, 3, 'Envoi unique REVIVAL 04/11 : Gmail actifs seulement (décision de Paul)');
    SELECT cron.unschedule('woh-revival-level-up');
  $c$);
  PERFORM cron.schedule('woh-revival-level-down', '30 22 4 11 *', $c$
    UPDATE public.email_sender_health SET level = 1, level_since = now() WHERE scope_key = 'venue:woh';
    UPDATE public.email_sender_state SET daily_cap_override = NULL, updated_at = now() WHERE scope_key = 'venue:woh';
    INSERT INTO public.email_sender_level_history (scope_key, from_level, to_level, reason)
    VALUES ('venue:woh', 3, 1, 'Fin de l''envoi unique REVIVAL 04/11');
    SELECT cron.unschedule('woh-revival-level-down');
  $c$);
END $m$;
