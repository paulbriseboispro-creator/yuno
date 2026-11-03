-- La santé d'envoi d'un compte, telle que le pro la voit (03/11).
--
-- Demande de Paul : chaque organisateur et chaque club doit savoir, sans
-- interpréter, ce que Yuno applique à ses e-mails et pourquoi, où il en est
-- face à chaque seuil, de quoi sa base est faite, et comment s'est passée
-- chacune de ses dernières campagnes. Une seule lecture, la même pour la
-- Console CRM et la Billetterie : email_sender_health_report.
--
-- Honnêteté, dans les mots comme dans les chiffres :
-- - les règles et seuils rendus sont ceux que le serveur applique
--   (email_deliverability_settings), jamais une copie au front ;
-- - Gmail ne transmet aucune plainte : son seul signal est l'ouverture,
--   comparée aux autres messageries — c'est dit à l'écran ;
-- - la reprise Gmail est une mesure de TOUTE la plateforme, pas une sanction
--   du compte — c'est dit aussi ;
-- - en dessous de 50 envois, aucun verdict (« pas encore assez d'envois »).
--
-- Les chiffres comptent les e-mails marketing ET pratiques (même expéditeur,
-- même boîte de réception) ; les règles d'envoi ne visent que le marketing.
-- Statut (règle unique, ici) :
--   paused  = tenu à l'écart des nouvelles adresses (email_sender_health) ;
--   limited = sur 30 jours (≥ 200 envois) : rebonds > seuil, ou plaintes >
--             seuil, ou Gmail < moitié des autres (≥ 100 Gmail, ≥ 50 autres) ;
--   watch   = rebonds > 2 %, ou ouvertures < 10 % (≥ 200 envois), ou Gmail <
--             75 % des autres ;
--   good    = le reste ; new = moins de 50 envois sur 30 jours.
-- p_product : 'crm' = campagnes Yuno CRM seulement, 'suite' = Billetterie,
-- NULL = tout. Les règles du compte valent pour les deux (même expéditeur).

CREATE OR REPLACE FUNCTION public.email_sender_health_report(
  p_venue_id text, p_organizer_user_id uuid, p_product text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  h public.email_sender_health;
  v_key text := public._email_sender_key(p_venue_id, p_organizer_user_id);
  m record;
  v_held jsonb;
  v_base jsonb;
  v_camps jsonb;
  v_status text;
  v_reasons text[] := '{}';
  v_bounce numeric;
  v_compl numeric;
  v_open numeric;
  v_rel numeric;
  v_crm boolean := p_product = 'crm';
  v_ids uuid[];
BEGIN
  IF NOT (public.is_super_admin()
          OR (COALESCE(p_venue_id, p_organizer_user_id::text) IS NOT NULL
              AND (COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false)
                   OR COALESCE(public.contact_scope_allowed(p_venue_id, p_organizer_user_id), false)))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT * INTO h FROM public.email_sender_health WHERE scope_key = v_key;

  -- Les campagnes de la portée (30 derniers jours), produit choisi — marketing
  -- ET pratiques : la boîte de réception ne fait pas la différence.
  -- (un tableau, pas une table temporaire : la page se lit aussi en aperçu,
  -- dont la transaction est en lecture seule)
  v_ids := ARRAY(
  SELECT ec.id FROM public.email_campaigns ec
   WHERE ec.venue_id IS NOT DISTINCT FROM p_venue_id
     AND ec.organizer_user_id IS NOT DISTINCT FROM (CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END)
     AND COALESCE(ec.send_started_at, ec.created_at) > now() - interval '45 days'
     AND (p_product IS NULL
          OR (v_crm AND COALESCE(public.crm_campaign_is_crm(ec.id), false))
          OR (NOT v_crm AND NOT COALESCE(public.crm_campaign_is_crm(ec.id), false))));

  WITH r AS (
    SELECT rr.campaign_id, lower(rr.email) AS em, rr.status, public._email_is_gmail(rr.email) AS gm
      FROM public.email_campaign_recipients rr
     WHERE rr.campaign_id = ANY (v_ids)
       AND rr.status IN ('sent', 'bounced', 'complained') AND rr.sent_at > now() - interval '30 days'
  ), o AS (
    SELECT DISTINCT ev.campaign_id, lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.campaign_id = ANY (v_ids) AND ev.event_type IN ('opened', 'clicked')
  )
  SELECT count(*) AS sent,
         count(*) FILTER (WHERE r.status = 'bounced') AS bounced,
         count(*) FILTER (WHERE r.status = 'complained') AS complained,
         count(o.em) AS opened,
         count(*) FILTER (WHERE r.gm) AS gmail_sent,
         count(o.em) FILTER (WHERE r.gm) AS gmail_opened,
         count(*) FILTER (WHERE NOT r.gm) AS other_sent,
         count(o.em) FILTER (WHERE NOT r.gm) AS other_opened
    INTO m
    FROM r LEFT JOIN o ON o.campaign_id = r.campaign_id AND o.em = r.em;

  -- Ce que les règles ont gardé de côté (30 jours), par motif.
  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_held FROM (
    SELECT replace(rr.error_message, 'policy:', '') AS k, count(*) AS n
      FROM public.email_campaign_recipients rr
     WHERE rr.campaign_id = ANY (v_ids) AND rr.status = 'skipped'
       AND rr.error_message LIKE 'policy:%' AND rr.created_at > now() - interval '30 days'
     GROUP BY 1) x;

  -- La base joignable du compte : chaude (a ouvert ou cliqué un e-mail Yuno
  -- dans la fenêtre de la reprise), déjà contactée par ce compte sous 365 jours
  -- sans ouvrir, jamais contactée par ce compte. Gmail compté à part.
  WITH b AS (
    SELECT DISTINCT lower(ns.email) AS em
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in AND ns.opted_out_at IS NULL
       AND public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND (p_product IS NULL OR ns.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END)
    UNION
    SELECT DISTINCT lower(cc.email)
      FROM public.crm_customer_contacts cc
     WHERE v_crm AND cc.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND cc.state = 'eligible'
  ), b2 AS (
    SELECT b.em FROM b WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = b.em)
  ), eng AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked')
       AND ev.created_at > now() - make_interval(days => COALESCE(s.gmail_engaged_days, 120))
       AND lower(ev.recipient_email) IN (SELECT em FROM b2)
  ), got AS (
    SELECT DISTINCT lower(rr.email) AS em FROM public.email_campaign_recipients rr
      JOIN public.email_campaigns ec ON ec.id = rr.campaign_id
     WHERE rr.status IN ('sent', 'bounced', 'complained') AND rr.sent_at > now() - interval '365 days'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM (CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END)
       AND lower(rr.email) IN (SELECT em FROM b2)
  )
  SELECT jsonb_build_object(
           'total', count(*),
           'engaged', count(*) FILTER (WHERE eng.em IS NOT NULL),
           'contacted', count(*) FILTER (WHERE eng.em IS NULL AND got.em IS NOT NULL),
           'never', count(*) FILTER (WHERE eng.em IS NULL AND got.em IS NULL),
           'gmail', count(*) FILTER (WHERE public._email_is_gmail(b2.em)),
           'gmail_engaged', count(*) FILTER (WHERE public._email_is_gmail(b2.em) AND eng.em IS NOT NULL))
    INTO v_base
    FROM b2 LEFT JOIN eng ON eng.em = b2.em LEFT JOIN got ON got.em = b2.em;

  -- Les dernières campagnes, une ligne chacune.
  SELECT coalesce(jsonb_agg(x ORDER BY x.at DESC), '[]'::jsonb) INTO v_camps FROM (
    SELECT ec.id, ec.name, COALESCE(ec.sent_at, ec.send_started_at) AS at, ec.status,
           CASE WHEN COALESCE(ec.type, 'promotional') = 'informational' OR COALESCE(ec.practical, false)
                THEN 'info' ELSE 'marketing' END AS kind,
           ec.wave_state, ec.wave_released, ec.wave_total, ec.spread_forced,
           CASE WHEN ec.throttle_per_hour IS NOT NULL
                THEN round(ec.throttle_per_hour * 60.0 / COALESCE(ec.throttle_window_minutes, 60)) END AS per_hour,
           (SELECT count(*) FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id AND rr.status IN ('sent', 'bounced', 'complained')) AS sent,
           (SELECT count(*) FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id AND rr.status = 'bounced') AS bounced,
           (SELECT count(*) FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id AND rr.status = 'complained') AS complained,
           (SELECT count(*) FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id AND rr.status = 'skipped' AND rr.error_message LIKE 'policy:%') AS held,
           (SELECT count(*) FROM public.email_campaign_recipients rr WHERE rr.campaign_id = ec.id AND rr.status IN ('sent', 'bounced', 'complained') AND public._email_is_gmail(rr.email)) AS gmail_sent,
           (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev WHERE ev.campaign_id = ec.id AND ev.event_type IN ('opened', 'clicked')) AS opened,
           (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev WHERE ev.campaign_id = ec.id AND ev.event_type IN ('opened', 'clicked') AND public._email_is_gmail(ev.recipient_email)) AS gmail_opened
      FROM public.email_campaigns ec
     WHERE ec.id = ANY (v_ids) AND ec.status IN ('sent', 'sending', 'paused', 'failed')
     ORDER BY COALESCE(ec.sent_at, ec.send_started_at) DESC NULLS LAST
     LIMIT 8) x;

  -- Le verdict.
  IF h.cold_frozen_until > now() THEN
    v_status := 'paused';
    v_reasons := array_append(v_reasons, 'frozen');
  END IF;
  IF m.sent >= 200 THEN
    v_bounce := m.bounced * 100.0 / m.sent;
    v_compl := m.complained * 1000.0 / m.sent;
    v_open := m.opened * 100.0 / m.sent;
    IF v_bounce > s.halt_bounce_pct THEN v_reasons := array_append(v_reasons, 'bounces_high'); END IF;
    IF v_compl > s.halt_complaint_permille THEN v_reasons := array_append(v_reasons, 'complaints_high'); END IF;
  END IF;
  IF m.gmail_sent >= 100 AND m.other_sent >= 50 AND m.other_opened > 0 THEN
    v_rel := (m.gmail_opened::numeric / m.gmail_sent) / (m.other_opened::numeric / m.other_sent);
    IF v_rel < s.halt_gmail_relative THEN v_reasons := array_append(v_reasons, 'gmail_spam'); END IF;
  END IF;
  IF v_status IS NULL THEN
    IF cardinality(v_reasons) > 0 THEN v_status := 'limited';
    ELSIF m.sent < 50 THEN v_status := 'new';
    ELSIF (v_bounce IS NOT NULL AND v_bounce > 2) OR (v_open IS NOT NULL AND v_open < 10) OR (v_rel IS NOT NULL AND v_rel < 0.75) THEN
      v_status := 'watch';
      IF v_bounce IS NOT NULL AND v_bounce > 2 THEN v_reasons := array_append(v_reasons, 'bounces_rising'); END IF;
      IF v_open IS NOT NULL AND v_open < 10 THEN v_reasons := array_append(v_reasons, 'opens_low'); END IF;
      IF v_rel IS NOT NULL AND v_rel < 0.75 THEN v_reasons := array_append(v_reasons, 'gmail_lagging'); END IF;
    ELSE v_status := 'good';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'reasons', to_jsonb(v_reasons),
    'metrics', to_jsonb(m),
    'held', v_held,
    'base', v_base,
    'campaigns', v_camps,
    'rules', jsonb_build_object(
      'force_spread', s.force_spread AND NOT COALESCE(h.burst_allowed, false),
      'burst_allowed', COALESCE(h.burst_allowed, false),
      'spread_min_audience', s.spread_min_audience,
      'spread_per_hour', s.spread_per_hour,
      'spread_max_per_hour', s.spread_max_per_hour,
      'waves_on', s.waves_on,
      'wave_first', s.wave_first, 'wave_max', s.wave_max, 'wave_wait_minutes', s.wave_wait_minutes,
      'cold_small_max', s.cold_small_max,
      'cold_daily_cap', s.cold_daily_cap, 'cold_gmail_daily_cap', s.cold_gmail_daily_cap,
      'gmail_recovery', s.gmail_recovery, 'gmail_recovery_since', CASE WHEN s.gmail_recovery THEN s.started_at END,
      'gmail_engaged_days', s.gmail_engaged_days,
      'cold_frozen_until', CASE WHEN h.cold_frozen_until > now() THEN h.cold_frozen_until END,
      'frozen_reason', CASE WHEN h.cold_frozen_until > now() THEN h.reason END,
      'frozen_metrics', CASE WHEN h.cold_frozen_until > now() THEN h.metrics END,
      'probation_days', s.probation_days),
    'thresholds', jsonb_build_object(
      'bounce_pct', s.halt_bounce_pct, 'complaint_permille', s.halt_complaint_permille,
      'open_pct', s.halt_open_pct, 'gmail_relative', s.halt_gmail_relative,
      'watch_bounce_pct', 2, 'watch_open_pct', 10, 'watch_gmail_relative', 0.75),
    'generated_at', now());
END $$;
REVOKE ALL ON FUNCTION public.email_sender_health_report(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sender_health_report(text, uuid, text) TO authenticated;
