-- Surveillance renforcée d'un envoi test : WOH × REVIVAL du 04/11 (953 Gmail actifs).
--
-- Demande de Paul : « vérification accrue sur ce test d'envoi ». Toutes les 15 min
-- de 9 h 55 à 19 h (Paris), un relevé est écrit dans email_test_watch_log, et des
-- seuils PLUS STRICTS que le disjoncteur commun mettent l'envoi en pause :
--   · 2 % d'adresses invalides dès 100 envois (des adresses actives ne rebondissent pas) ;
--   · 2 plaintes (Gmail n'en transmet aucune : celles-ci viendraient d'ailleurs) ;
--   · 5 % d'échecs d'envoi ;
--   · moins de 3 % d'ouvertures sur les envois partis depuis plus d'une heure, dès
--     200 envois : Gmail les range en spam, inutile d'user la liste.
-- Une pause se lève à la main (relancer la campagne). Alertes super admin : départ,
-- première lecture des ouvertures, pause, fin. Les tâches cron s'effacent le soir.
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.email_test_watch_log (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  metrics jsonb NOT NULL,
  action text
);
ALTER TABLE public.email_test_watch_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.email_test_watch(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  c record;
  m jsonb;
  v_sent int; v_pending int; v_failed int; v_deliv int; v_bounced int; v_compl int;
  v_opened int; v_clicked int; v_old int; v_old_opened int;
  v_open_pct numeric; v_reason text; v_action text;
BEGIN
  SELECT id, name, status INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT count(*) FILTER (WHERE status = 'sent'),
         count(*) FILTER (WHERE status = 'pending'),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status = 'sent' AND sent_at < now() - interval '60 minutes')
    INTO v_sent, v_pending, v_failed, v_old
    FROM public.email_campaign_recipients WHERE campaign_id = p_campaign_id;

  WITH e AS (
    SELECT lower(recipient_email) em,
           bool_or(event_type = 'delivered') dl, bool_or(event_type = 'bounced') bo,
           bool_or(event_type = 'complained') co, bool_or(event_type = 'opened') op,
           bool_or(event_type = 'clicked') cl
      FROM public.email_campaign_events WHERE campaign_id = p_campaign_id GROUP BY 1)
  SELECT count(*) FILTER (WHERE dl), count(*) FILTER (WHERE bo), count(*) FILTER (WHERE co),
         count(*) FILTER (WHERE op OR cl), count(*) FILTER (WHERE cl)
    INTO v_deliv, v_bounced, v_compl, v_opened, v_clicked FROM e;

  SELECT count(DISTINCT lower(r.email)) INTO v_old_opened
    FROM public.email_campaign_recipients r
    JOIN public.email_campaign_events e ON e.campaign_id = r.campaign_id
         AND lower(e.recipient_email) = lower(r.email) AND e.event_type IN ('opened', 'clicked')
   WHERE r.campaign_id = p_campaign_id AND r.status = 'sent' AND r.sent_at < now() - interval '60 minutes';
  v_open_pct := CASE WHEN v_old > 0 THEN round(100.0 * v_old_opened / v_old, 1) END;

  m := jsonb_build_object('status', c.status, 'sent', v_sent, 'pending', v_pending, 'failed', v_failed,
    'delivered', v_deliv, 'bounced', v_bounced, 'complained', v_compl, 'opened', v_opened, 'clicked', v_clicked,
    'sent_over_1h', v_old, 'open_pct_over_1h', v_open_pct);

  IF c.status = 'sending' THEN
    v_reason := CASE
      WHEN v_sent >= 100 AND v_bounced * 100 >= v_sent * 2 THEN format('%s adresses invalides sur %s envois', v_bounced, v_sent)
      WHEN v_compl >= 2 THEN format('%s plaintes', v_compl)
      WHEN v_sent + v_failed >= 100 AND v_failed * 100 >= (v_sent + v_failed) * 5 THEN format('%s échecs d''envoi', v_failed)
      WHEN v_old >= 200 AND v_open_pct < 3 THEN format('%s %% d''ouvertures après une heure (%s sur %s) : Gmail range en spam', v_open_pct, v_old_opened, v_old)
    END;
    IF v_reason IS NOT NULL THEN
      UPDATE public.email_campaigns SET status = 'paused', paused_reason = 'test_watch',
             error_message = 'Pause de la surveillance renforcée : ' || v_reason
       WHERE id = p_campaign_id AND status = 'sending';
      v_action := 'paused';
      PERFORM public.emit_admin_notification('admin_email_test_watch', 'Envoi test mis en pause',
        format('%s : %s. Relevé : %s envoyés, %s ouverts, %s invalides.', c.name, v_reason, v_sent, v_opened, v_bounced),
        'high', 'email_campaign', p_campaign_id::text, m, 'test_watch_pause:' || p_campaign_id, NULL);
    END IF;
  END IF;

  IF v_action IS NULL THEN
    IF v_sent > 0 THEN
      PERFORM public.emit_admin_notification('admin_email_test_watch', 'Envoi test : c''est parti',
        format('%s : premiers envois partis (%s).', c.name, v_sent), 'low', 'email_campaign', p_campaign_id::text, m,
        'test_watch_start:' || p_campaign_id, NULL);
    END IF;
    IF v_old >= 200 THEN
      PERFORM public.emit_admin_notification('admin_email_test_watch',
        CASE WHEN v_open_pct >= 15 THEN 'Envoi test : Gmail ouvre bien' ELSE 'Envoi test : ouvertures faibles' END,
        format('%s : %s %% d''ouvertures sur les %s envois partis depuis plus d''une heure (autres messageries d''habitude : ~25 %%).', c.name, v_open_pct, v_old),
        CASE WHEN v_open_pct >= 15 THEN 'low' ELSE 'medium' END, 'email_campaign', p_campaign_id::text, m,
        'test_watch_first_read:' || p_campaign_id, NULL);
    END IF;
    IF c.status = 'sent' OR (v_pending = 0 AND v_sent > 0) THEN
      PERFORM public.emit_admin_notification('admin_email_test_watch', 'Envoi test terminé',
        format('%s : %s envoyés, %s ouverts (%s %% sur ceux partis depuis 1 h), %s clics, %s invalides, %s plaintes.',
               c.name, v_sent, v_opened, COALESCE(v_open_pct::text, '—'), v_clicked, v_bounced, v_compl),
        'medium', 'email_campaign', p_campaign_id::text, m, 'test_watch_done:' || p_campaign_id, NULL);
    END IF;
  END IF;

  INSERT INTO public.email_test_watch_log (campaign_id, metrics, action) VALUES (p_campaign_id, m, v_action);
  RETURN m || jsonb_build_object('action', v_action);
END $$;
REVOKE ALL ON FUNCTION public.email_test_watch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_test_watch(uuid) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('woh-revival-watch', 'woh-revival-watch-end');
  -- Toutes les 15 min, de 9 h à 18 h UTC (10 h → 19 h Paris), le 04/11 seulement.
  PERFORM cron.schedule('woh-revival-watch', '*/15 9-17 4 11 *',
    $c$SELECT public.email_test_watch('aa583e5c-0c52-45a6-a324-26f3d9d5952d')$c$);
  PERFORM cron.schedule('woh-revival-watch-end', '5 18 4 11 *', $c$
    SELECT public.email_test_watch('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
    SELECT cron.unschedule('woh-revival-watch');
    SELECT cron.unschedule('woh-revival-watch-end');
  $c$);
END $$;
