-- Google Postmaster : les chiffres que Gmail publie sur nos domaines, chaque jour.
--
-- Gmail ne transmet AUCUN signalement « spam » un par un (Resend ne voit que Yahoo,
-- Microsoft…). Le seul chiffre Gmail est celui de Google Postmaster : taux de
-- signalements, erreurs de livraison, authentification, par domaine et par jour,
-- publié avec 1 à 2 jours de retard et seulement au-delà d'un certain volume.
--
-- La lecture se fait côté edge (process-scheduled-campaigns, tâche
-- `gmail_postmaster`, jeton OAuth en lecture seule de Paul : secrets
-- POSTMASTER_*), qui écrit ici par record_gmail_postmaster. Cron quotidien.
--
-- Attribution : un domaine est partagé par tous les comptes. Pour un jour donné, on
-- rapproche le taux Google des comptes qui ont écrit à Gmail CE jour-là (part des
-- envois Gmail). C'est une estimation, et l'écran le dit.

CREATE TABLE IF NOT EXISTS public.gmail_postmaster_daily (
  domain text NOT NULL,
  day date NOT NULL,
  spam_ratio numeric,            -- tel que rendu par Google (SPAM_RATE)
  delivery_error_ratio numeric,  -- DELIVERY_ERROR_RATE
  auth_ratio numeric,            -- AUTH_SUCCESS_RATE
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, day)
);
ALTER TABLE public.gmail_postmaster_daily ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.gmail_postmaster_domains (
  domain text PRIMARY KEY,
  compliance jsonb,
  last_error text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gmail_postmaster_domains ENABLE ROW LEVEL SECURITY;

-- Seuils (ratio, pas pourcentage) : 0,1 % = recommandé par Google, 0,3 % = limite.
ALTER TABLE public.email_deliverability_settings
  ADD COLUMN IF NOT EXISTS google_spam_watch numeric NOT NULL DEFAULT 0.001,
  ADD COLUMN IF NOT EXISTS google_spam_limit numeric NOT NULL DEFAULT 0.003;

-- Les comptes qui ont écrit à Gmail un jour donné (UTC), du plus gros au plus petit.
CREATE OR REPLACE FUNCTION public._gmail_senders_on(p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH s AS (
    SELECT c.venue_id, c.organizer_user_id, count(*) AS n
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
     WHERE r.status = 'sent'
       AND r.sent_at >= p_day::timestamp AT TIME ZONE 'UTC'
       AND r.sent_at <  (p_day + 1)::timestamp AT TIME ZONE 'UTC'
       AND public._email_is_gmail(r.email)
     GROUP BY 1, 2),
  t AS (SELECT sum(n) AS tot FROM s)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', public._email_sender_key(s.venue_id, s.organizer_user_id),
           'name', COALESCE(public.crm_space_display_name(s.venue_id, s.organizer_user_id), 'Yuno'),
           'gmail_sent', s.n,
           'share', round(s.n::numeric / NULLIF(t.tot, 0), 3)) ORDER BY s.n DESC), '[]'::jsonb)
    FROM s, t;
$$;
REVOKE ALL ON FUNCTION public._gmail_senders_on(date) FROM PUBLIC, anon, authenticated;

-- Écrit ce que la lecture a rapporté, puis alerte (une fois par domaine et par jour).
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
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
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
  RETURN jsonb_build_object('domain', p_domain, 'days', n, 'alerts', alerts);
END $$;
REVOKE ALL ON FUNCTION public.record_gmail_postmaster(text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gmail_postmaster(text, jsonb, jsonb, text) TO service_role;

-- Lecture super admin : la courbe par domaine, et qui a écrit à Gmail les jours à signalements.
CREATE OR REPLACE FUNCTION public.admin_gmail_postmaster(p_days integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT jsonb_build_object(
    'watch', s.google_spam_watch, 'limit', s.google_spam_limit,
    'connected', EXISTS (SELECT 1 FROM public.gmail_postmaster_domains),
    'domains', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'domain', g.domain, 'fetched_at', g.fetched_at, 'last_error', g.last_error, 'compliance', g.compliance,
        'days', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'day', p.day, 'spam', p.spam_ratio, 'delivery_error', p.delivery_error_ratio, 'auth', p.auth_ratio,
            'senders', CASE WHEN p.spam_ratio >= s.google_spam_watch
                            THEN (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(public._gmail_senders_on(p.day)) x LIMIT 3) t) END)
            ORDER BY p.day)
            FROM public.gmail_postmaster_daily p
           WHERE p.domain = g.domain AND p.day >= current_date - GREATEST(7, LEAST(p_days, 180))), '[]'::jsonb))
        ORDER BY g.domain)
        FROM public.gmail_postmaster_domains g), '[]'::jsonb)) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_gmail_postmaster(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_gmail_postmaster(integer) TO authenticated;

-- Lecture quotidienne à 9 h 20 UTC (Google publie la veille dans la nuit, Pacifique).
DO $$
BEGIN
  PERFORM cron.unschedule('gmail-postmaster-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gmail-postmaster-daily');
  PERFORM cron.schedule('gmail-postmaster-daily', '20 9 * * *', $c$
    SELECT net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/process-scheduled-campaigns',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.get_cron_secret()),
      body := jsonb_build_object('task', 'gmail_postmaster'),
      timeout_milliseconds := 10000)
  $c$);
END $$;
