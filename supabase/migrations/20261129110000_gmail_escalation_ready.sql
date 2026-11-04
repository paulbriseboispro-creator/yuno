-- Prévenir le super admin le jour où Google rouvre le droit au signalement.
--
-- Google n'examine un « Signaler un problème de distribution » (Postmaster Tools) que
-- d'un expéditeur conforme à TOUTES ses exigences, et n'accorde de correction qu'après
-- 7 jours consécutifs sous 0,3 % de signalements spam (support.google.com/mail/answer/
-- 14229414). Au 04/11, yunoapp.eu a 0 % chaque jour depuis le 09/10 mais reste « à
-- améliorer » : le tableau de conformité suit une moyenne glissante, encore tirée par
-- le 08/10 (0,8 %). Déposer avant serait refusé.
--
-- La lecture quotidienne (record_gmail_postmaster) compare désormais l'état de
-- l'exigence USER_REPORTED_SPAM_RATE du domaine PRINCIPAL (Google ne juge que lui,
-- sous-domaines compris) à celui de la veille, et alerte au changement :
--   · conforme + 7 derniers jours mesurés sous la limite ⇒ admin_gmail_escalation_ready
--     (« tu peux déposer le signalement », dossier dans docs/EMAIL_GMAIL_RECOVERY.md) ;
--   · retour « à améliorer » ⇒ même type, priorité haute (le dossier attend).
-- Le corps de la fonction repart de la définition vivante (identique à 20261127160000).
SET lock_timeout = '3s';

ALTER TABLE public.gmail_postmaster_domains
  ADD COLUMN IF NOT EXISTS spam_status text,
  ADD COLUMN IF NOT EXISTS spam_status_since timestamptz;

CREATE OR REPLACE FUNCTION public.record_gmail_postmaster(p_domain text, p_days jsonb, p_compliance jsonb, p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  d jsonb;
  n integer := 0;
  alerts integer := 0;
  v_senders jsonb;
  v_top text;
  v_prev text;
  v_status text;
  v_last7 integer;
  v_over7 integer;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT spam_status INTO v_prev FROM public.gmail_postmaster_domains WHERE domain = p_domain;

  INSERT INTO public.gmail_postmaster_domains (domain, compliance, last_error, fetched_at)
  VALUES (p_domain, p_compliance, p_error, now())
  ON CONFLICT (domain) DO UPDATE
    SET compliance = COALESCE(EXCLUDED.compliance, gmail_postmaster_domains.compliance),
        last_error = EXCLUDED.last_error, fetched_at = now();

  FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_days, '[]'::jsonb)) LOOP
    INSERT INTO public.gmail_postmaster_daily (domain, day, spam_ratio, delivery_error_ratio, auth_ratio, raw, fetched_at)
    VALUES (p_domain, (d->>'day')::date, (d->>'spam')::numeric, (d->>'delivery_error')::numeric,
            (d->>'auth')::numeric, COALESCE(d->'raw', '{}'::jsonb), now())
    ON CONFLICT (domain, day) DO UPDATE
      SET spam_ratio = EXCLUDED.spam_ratio, delivery_error_ratio = EXCLUDED.delivery_error_ratio,
          auth_ratio = EXCLUDED.auth_ratio, raw = EXCLUDED.raw, fetched_at = now();
    n := n + 1;

    IF (d->>'spam')::numeric >= s.google_spam_watch AND (d->>'day')::date >= current_date - 7 THEN
      v_senders := public._gmail_senders_on((d->>'day')::date);
      SELECT string_agg(format('%s (%s %%)', x->>'name', round((x->>'share')::numeric * 100)), ', ')
        INTO v_top FROM (SELECT x FROM jsonb_array_elements(v_senders) x LIMIT 3) t;
      PERFORM public.emit_admin_notification(
        'admin_email_google_spam',
        CASE WHEN (d->>'spam')::numeric >= s.google_spam_limit THEN 'Google : signalements spam au-dessus de la limite'
             ELSE 'Google : signalements spam en hausse' END,
        format('%s, le %s : %s %% de signalements chez Gmail (limite Google 0,3 %%). Comptes qui ont écrit à Gmail ce jour-là : %s.',
               p_domain, to_char((d->>'day')::date, 'DD/MM'), replace(round((d->>'spam')::numeric * 100, 2)::text, '.', ','),
               COALESCE(v_top, 'aucun envoi de campagne')),
        CASE WHEN (d->>'spam')::numeric >= s.google_spam_limit THEN 'high' ELSE 'medium' END,
        'email_deliverability', p_domain,
        jsonb_build_object('domain', p_domain, 'day', d->>'day', 'spam', (d->>'spam')::numeric, 'senders', v_senders),
        'google_spam:' || p_domain || ':' || (d->>'day'), NULL);
      alerts := alerts + 1;
    END IF;
  END LOOP;

  -- Droit au signalement : seulement pour le domaine principal (celui que Google juge).
  IF p_compliance IS NOT NULL AND p_compliance #>> '{complianceData,domainId}' = p_domain THEN
    SELECT r #>> '{status,status}' INTO v_status
      FROM jsonb_array_elements(COALESCE(p_compliance #> '{complianceData,rowData}', '[]'::jsonb)) r
     WHERE r->>'requirement' = 'USER_REPORTED_SPAM_RATE'
     LIMIT 1;

    IF v_status IS NOT NULL THEN
      SELECT count(*), count(*) FILTER (WHERE spam_ratio >= s.google_spam_limit)
        INTO v_last7, v_over7
        FROM public.gmail_postmaster_daily
       WHERE domain = p_domain AND day >= current_date - 7 AND spam_ratio IS NOT NULL;

      -- « prêt » = conforme pour Google ET aucun jour mesuré au-dessus de la limite sur 7 jours.
      v_status := CASE WHEN v_status = 'COMPLIANT' AND v_over7 = 0 THEN 'ready' ELSE 'needs_work' END;

      IF v_status IS DISTINCT FROM v_prev THEN
        UPDATE public.gmail_postmaster_domains
           SET spam_status = v_status, spam_status_since = now()
         WHERE domain = p_domain;

        -- Le premier relevé fixe l'état sans alerter (on le connaît déjà : « à améliorer »).
        IF v_prev IS NOT NULL OR v_status = 'ready' THEN
          PERFORM public.emit_admin_notification(
            'admin_gmail_escalation_ready',
            CASE WHEN v_status = 'ready' THEN 'Gmail : tu peux déposer le signalement'
                 ELSE 'Gmail : signalement à mettre en attente' END,
            CASE WHEN v_status = 'ready'
              THEN format('%s est de nouveau conforme pour Google (signalements spam sous 0,3 %% sur %s jours mesurés). Postmaster Tools › Signaler un problème de distribution › Créer un rapport, avec l''original d''un e-mail légitime arrivé en spam. Dossier : docs/EMAIL_GMAIL_RECOVERY.md.',
                          p_domain, v_last7)
              ELSE format('%s repasse « à améliorer » chez Google : un signalement déposé maintenant serait refusé. Attendre 7 jours consécutifs sous 0,3 %%.', p_domain) END,
            CASE WHEN v_status = 'ready' THEN 'high' ELSE 'medium' END,
            'email_deliverability', p_domain,
            jsonb_build_object('domain', p_domain, 'status', v_status, 'days_measured', v_last7),
            'gmail_escalation:' || p_domain || ':' || v_status || ':' || to_char(current_date, 'YYYY-MM-DD'), NULL);
          alerts := alerts + 1;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('domain', p_domain, 'days', n, 'alerts', alerts, 'spam_status', v_status);
END $$;
REVOKE ALL ON FUNCTION public.record_gmail_postmaster(text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gmail_postmaster(text, jsonb, jsonb, text) TO service_role;
