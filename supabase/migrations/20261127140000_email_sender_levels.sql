-- Les droits d'envoi d'un compte : cinq niveaux, gérés par des règles (03/11).
--
-- Demande de Paul : « que les clients suivent l'évolution de leurs droits
-- d'envoi, que tu gères toi en fonction de règles ; sois prudent ». Un niveau
-- fixe le plafond par jour, le rythme par heure et les nouvelles adresses par
-- jour (dont Gmail). Il ne remplace rien : chaque plafond reste le PLUS BAS de
-- la montée en charge, de la reprise Gmail et du niveau.
--
--   1 Départ           300 / jour · 150 / h · 200 nouvelles, 0 Gmail
--   2 Confiance        800 / jour · 250 / h · 500 nouvelles, 100 Gmail
--   3 Établi         1 500 / jour · 400 / h · 1 000 nouvelles, 200 Gmail
--   4 Solide         5 000 / jour · 800 / h · 2 000 nouvelles, 500 Gmail
--   5 Pleine confiance : « tout d'un coup » — accordé par le super admin SEUL.
--
-- Règles (email_sender_levels_tick, une fois par jour vers 6 h, Paris) :
--   MONTÉE d'un niveau au plus tous les 7 jours (jusqu'au 4), si les 7 derniers
--   jours ont au moins 200 envois et : rebonds < 2 %, plaintes ≤ 0,5 ‰, Gmail
--   ouvre au moins aux 3/4 des autres messageries (≥ 100 Gmail et ≥ 50 autres,
--   sinon pas au-delà du niveau 2), aucune vague arrêtée, compte pas à l'écart.
--   Pendant la reprise Gmail, personne ne dépasse le niveau 3.
--   DESCENTE immédiate : compte à l'écart ⇒ niveau 1 ; rebonds > 3 % ou
--   plaintes > 1 ‰ sur 7 jours (≥ 100 envois) ⇒ un niveau de moins.
-- Chaque changement entre dans email_sender_level_history, que le pro voit.
-- Départ : WOH (deux comptes, à l'origine de l'incident) niveau 1, Amoris
-- niveau 2, tout autre compte niveau 1.

CREATE TABLE IF NOT EXISTS public.email_sender_levels (
  level smallint PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
  daily_cap integer NOT NULL,
  per_hour integer NOT NULL,
  cold_daily integer NOT NULL,
  cold_gmail_daily integer NOT NULL,
  burst boolean NOT NULL DEFAULT false
);
ALTER TABLE public.email_sender_levels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_sender_levels FROM PUBLIC, anon, authenticated;
INSERT INTO public.email_sender_levels VALUES
  (1, 300, 150, 200, 0, false),
  (2, 800, 250, 500, 100, false),
  (3, 1500, 400, 1000, 200, false),
  (4, 5000, 800, 2000, 500, false),
  (5, 25000, 2000, 5000, 1000, true)
ON CONFLICT (level) DO UPDATE SET daily_cap = EXCLUDED.daily_cap, per_hour = EXCLUDED.per_hour,
  cold_daily = EXCLUDED.cold_daily, cold_gmail_daily = EXCLUDED.cold_gmail_daily, burst = EXCLUDED.burst;

ALTER TABLE public.email_sender_health
  ADD COLUMN IF NOT EXISTS level smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS level_since timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS level_checked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.email_sender_level_history (
  id bigserial PRIMARY KEY,
  scope_key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  from_level smallint,
  to_level smallint NOT NULL,
  reason text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_email_sender_level_history_scope ON public.email_sender_level_history (scope_key, at DESC);
ALTER TABLE public.email_sender_level_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_sender_level_history FROM PUBLIC, anon, authenticated;

-- Le niveau en vigueur d'un compte (5 si le super admin a ouvert « tout d'un coup »).
CREATE OR REPLACE FUNCTION public._email_sender_level(p_scope_key text)
RETURNS public.email_sender_levels LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.* FROM public.email_sender_levels l
   WHERE l.level = COALESCE((SELECT CASE WHEN h.burst_allowed THEN 5 ELSE h.level END
                               FROM public.email_sender_health h WHERE h.scope_key = p_scope_key), 1)
$$;
REVOKE ALL ON FUNCTION public._email_sender_level(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_sender_level(text) TO service_role;

-- Les chiffres d'un compte sur 7 jours, et ce qu'il lui manque pour monter.
CREATE OR REPLACE FUNCTION public._email_sender_level_check(p_scope_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  m record;
  h public.email_sender_health;
  s public.email_deliverability_settings;
  v_level smallint;
  v_rel numeric;
  v_halted boolean;
  v_frozen boolean;
  v_max smallint;
  v_next_at timestamptz;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT * INTO h FROM public.email_sender_health WHERE scope_key = p_scope_key;
  v_level := COALESCE(h.level, 1);
  v_frozen := COALESCE(h.cold_frozen_until > now(), false);
  WITH r AS (
    SELECT rr.campaign_id, lower(rr.email) AS em, rr.status, public._email_is_gmail(rr.email) AS gm
      FROM public.email_campaign_recipients rr
      JOIN public.email_campaigns ec ON ec.id = rr.campaign_id
     WHERE public._email_sender_key(ec.venue_id, ec.organizer_user_id) = p_scope_key
       AND rr.status IN ('sent', 'bounced', 'complained') AND rr.sent_at > now() - interval '7 days'
  ), o AS (
    SELECT DISTINCT ev.campaign_id, lower(ev.recipient_email) AS em FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.campaign_id IN (SELECT DISTINCT campaign_id FROM r)
  )
  SELECT count(*) AS n, count(*) FILTER (WHERE r.status = 'bounced') AS bounced,
         count(*) FILTER (WHERE r.status = 'complained') AS complained,
         count(*) FILTER (WHERE r.gm) AS g_n, count(o.em) FILTER (WHERE r.gm) AS g_o,
         count(*) FILTER (WHERE NOT r.gm) AS o_n, count(o.em) FILTER (WHERE NOT r.gm) AS o_o
    INTO m FROM r LEFT JOIN o ON o.campaign_id = r.campaign_id AND o.em = r.em;
  v_rel := CASE WHEN m.g_n >= 100 AND m.o_n >= 50 AND m.o_o > 0
                THEN (m.g_o::numeric / m.g_n) / (m.o_o::numeric / m.o_n) END;
  v_halted := EXISTS (SELECT 1 FROM public.email_campaigns ec
                       WHERE public._email_sender_key(ec.venue_id, ec.organizer_user_id) = p_scope_key
                         AND ec.wave_state = 'halted' AND ec.wave_checked_at > now() - interval '7 days');
  v_max := CASE WHEN s.gmail_recovery THEN 3 ELSE 4 END;
  IF v_rel IS NULL THEN v_max := LEAST(v_max, 2); END IF;
  v_next_at := COALESCE(h.level_since, now()) + interval '7 days';
  RETURN jsonb_build_object(
    'level', v_level, 'since', COALESCE(h.level_since, now()), 'max_auto', v_max,
    'next_check_at', v_next_at,
    'sent', m.n, 'bounced', m.bounced, 'complained', m.complained,
    'gmail_sent', m.g_n, 'gmail_opened', m.g_o, 'other_sent', m.o_n, 'other_opened', m.o_o,
    'gmail_relative', v_rel,
    'checks', jsonb_build_object(
      'days', COALESCE(h.level_since, now()) <= now() - interval '7 days',
      'volume', m.n >= 200,
      'bounces', m.n >= 50 AND m.bounced * 100.0 / GREATEST(m.n, 1) < 2,
      'complaints', m.n >= 50 AND m.complained * 1000.0 / GREATEST(m.n, 1) <= 0.5,
      'gmail', v_rel IS NOT NULL AND v_rel >= 0.75,
      'no_halt', NOT v_halted,
      'not_frozen', NOT v_frozen,
      'cap', v_level < v_max),
    'demote', CASE
      WHEN v_frozen AND v_level > 1 THEN 'frozen'
      WHEN m.n >= 100 AND (m.bounced * 100.0 / m.n > s.halt_bounce_pct
                           OR m.complained * 1000.0 / m.n > s.halt_complaint_permille) THEN 'quality' END);
END $$;
REVOKE ALL ON FUNCTION public._email_sender_level_check(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_sender_level_check(text) TO service_role;

-- Une fois par jour : monte ou descend chaque compte qui a envoyé (ou qui a un niveau).
CREATE OR REPLACE FUNCTION public.email_sender_levels_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  k text;
  c jsonb;
  v_from smallint;
  v_to smallint;
  v_reason text;
  v_out jsonb := '[]'::jsonb;
  ok boolean;
BEGIN
  FOR k IN
    SELECT scope_key FROM public.email_sender_health
    UNION
    SELECT DISTINCT public._email_sender_key(ec.venue_id, ec.organizer_user_id)
      FROM public.email_campaigns ec
     WHERE ec.send_started_at > now() - interval '30 days'
       AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id)
  LOOP
    BEGIN
      c := public._email_sender_level_check(k);
      v_from := (c->>'level')::smallint;
      v_to := v_from;
      v_reason := NULL;
      IF c->>'demote' = 'frozen' THEN
        v_to := 1; v_reason := 'demote_frozen';
      ELSIF c->>'demote' = 'quality' AND v_from > 1 THEN
        v_to := v_from - 1; v_reason := 'demote_quality';
      ELSE
        SELECT bool_and(value::boolean) INTO ok FROM jsonb_each_text(c->'checks');
        IF ok AND v_from < 4 THEN v_to := v_from + 1; v_reason := 'promote'; END IF;
      END IF;
      INSERT INTO public.email_sender_health (scope_key, level, level_since, level_checked_at, updated_at)
      VALUES (k, v_to, now(), now(), now())
      ON CONFLICT (scope_key) DO UPDATE
        SET level = EXCLUDED.level,
            level_since = CASE WHEN email_sender_health.level <> EXCLUDED.level THEN now() ELSE email_sender_health.level_since END,
            level_checked_at = now(), updated_at = now();
      IF v_to <> v_from THEN
        INSERT INTO public.email_sender_level_history (scope_key, from_level, to_level, reason, metrics)
        VALUES (k, v_from, v_to, v_reason, c - 'checks');
        v_out := v_out || jsonb_build_object('scope', k, 'from', v_from, 'to', v_to, 'reason', v_reason);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('scope', k, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.email_sender_levels_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_sender_levels_tick() TO service_role;

-- Ce que le pro voit : son niveau, ses droits, le niveau suivant et ce qu'il
-- lui manque, l'historique.
CREATE OR REPLACE FUNCTION public._email_sender_rights(p_scope_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  cur public.email_sender_levels;
  nxt public.email_sender_levels;
  c jsonb;
  v_hist jsonb;
  v_ladder jsonb;
BEGIN
  cur := public._email_sender_level(p_scope_key);
  SELECT * INTO nxt FROM public.email_sender_levels WHERE level = LEAST(cur.level + 1, 5);
  c := public._email_sender_level_check(p_scope_key);
  SELECT coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'from', x.from_level, 'to', x.to_level, 'reason', x.reason) ORDER BY x.at DESC), '[]'::jsonb)
    INTO v_hist FROM (SELECT * FROM public.email_sender_level_history WHERE scope_key = p_scope_key ORDER BY at DESC LIMIT 10) x;
  SELECT jsonb_agg(to_jsonb(l) ORDER BY l.level) INTO v_ladder FROM public.email_sender_levels l;
  RETURN jsonb_build_object(
    'current', to_jsonb(cur),
    'next', CASE WHEN cur.level < 5 THEN to_jsonb(nxt) END,
    'ladder', v_ladder,
    'check', c,
    'history', v_hist);
END $$;
REVOKE ALL ON FUNCTION public._email_sender_rights(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_sender_rights(text) TO service_role;

-- Les règles d'envoi lisent désormais le niveau du compte.

CREATE OR REPLACE FUNCTION public._email_enforce_spread(p_campaign_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  v_win integer;
  v_cap integer;
  lv public.email_sender_levels;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  IF NOT FOUND OR NOT s.force_spread THEN RETURN false; END IF;
  SELECT ec.venue_id, ec.organizer_user_id, ec.total_recipients, ec.throttle_per_hour, ec.throttle_window_minutes
    INTO c FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  IF NOT FOUND OR COALESCE(c.total_recipients, 0) < s.spread_min_audience THEN RETURN false; END IF;
  lv := public._email_sender_level(public._email_sender_key(c.venue_id, c.organizer_user_id));
  IF lv.burst THEN RETURN false; END IF;
  v_win := COALESCE(c.throttle_window_minutes, 60);
  IF c.throttle_per_hour IS NULL THEN
    UPDATE public.email_campaigns
       SET throttle_per_hour = lv.per_hour, throttle_window_minutes = 60, spread_forced = true
     WHERE id = p_campaign_id;
    RETURN true;
  END IF;
  v_cap := GREATEST(10, floor(lv.per_hour * v_win / 60.0)::int);
  IF c.throttle_per_hour > v_cap THEN
    UPDATE public.email_campaigns SET throttle_per_hour = v_cap, spread_forced = true WHERE id = p_campaign_id;
    RETURN true;
  END IF;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._email_release_waves(p_campaign_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  c record;
  v_key text;
  v_used integer;
  v_gused integer;
  v_room integer;
  v_groom integer;
  n integer := 0;
  lv public.email_sender_levels;
  v_today date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT ec.venue_id, ec.organizer_user_id, ec.wave_released INTO c FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  v_key := public._email_sender_key(c.venue_id, c.organizer_user_id);
  SELECT count(*), count(*) FILTER (WHERE public._email_is_gmail(r.email)) INTO v_used, v_gused
    FROM public.email_campaign_recipients r
    JOIN public.email_campaigns ec ON ec.id = r.campaign_id
   WHERE r.wave >= 1 AND r.wave_released_at IS NOT NULL
     AND (r.wave_released_at AT TIME ZONE 'Europe/Paris')::date = v_today
     AND public._email_sender_key(ec.venue_id, ec.organizer_user_id) = v_key
     AND ec.wave_state IS NOT NULL;
  lv := public._email_sender_level(v_key);
  v_room := GREATEST(0, LEAST(s.cold_daily_cap, lv.cold_daily) - v_used);
  v_groom := GREATEST(0, LEAST(s.cold_gmail_daily_cap, lv.cold_gmail_daily) - v_gused);
  IF v_room = 0 THEN RETURN 0; END IF;
  WITH cand AS (
    SELECT r.id, r.wave, public._email_is_gmail(r.email) AS gm,
           row_number() OVER (PARTITION BY public._email_is_gmail(r.email) ORDER BY r.wave, r.id) AS rk
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id AND r.status = 'pending'
       AND r.wave BETWEEN 1 AND COALESCE(c.wave_released, 0)
       AND r.wave_released_at IS NULL
  ), pick AS (
    SELECT cand.id FROM cand
     WHERE NOT cand.gm OR cand.rk <= v_groom
     ORDER BY cand.wave, cand.id
     LIMIT v_room
  )
  UPDATE public.email_campaign_recipients r
     SET next_attempt_at = GREATEST(now(), COALESCE(r.wave_due_at, now())),
         wave_released_at = now()
    FROM pick WHERE r.id = pick.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.email_sender_daily_cap(p_scope_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v RECORD;
  v_days integer;
  v_cap integer;
  s public.email_deliverability_settings;
BEGIN
  SELECT * INTO v FROM public.email_sender_state WHERE scope_key = p_scope_key;

  -- Plateforme : plafond global, généreux mais fini.
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v.daily_cap_override, 25000);
  END IF;

  IF v IS NULL THEN
    v_cap := 300;                       -- tout premier envoi
  ELSIF v.daily_cap_override IS NOT NULL THEN
    v_cap := GREATEST(0, v.daily_cap_override);
  ELSIF v.trust_level = 'restricted' THEN
    v_cap := 0;
  ELSIF v.trust_level = 'trusted' THEN
    v_cap := 50000;
  ELSIF v.first_send_at IS NULL THEN
    v_cap := 300;
  ELSE
    v_days := GREATEST(0, (public.paris_today() - (v.first_send_at AT TIME ZONE 'Europe/Paris')::date));
    v_cap := CASE
      WHEN v_days = 0 THEN 300
      WHEN v_days = 1 THEN 600
      WHEN v_days = 2 THEN 1200
      WHEN v_days = 3 THEN 2500
      WHEN v_days = 4 THEN 5000
      WHEN v_days = 5 THEN 10000
      ELSE 25000
    END;
  END IF;

  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  IF FOUND AND s.gmail_recovery THEN
    v_cap := LEAST(v_cap, s.recovery_daily_cap);
  END IF;
  -- Droits d'envoi du compte (niveau, 20261127140000) : jamais au-dessus.
  v_cap := LEAST(v_cap, (public._email_sender_level(p_scope_key)).daily_cap);
  RETURN v_cap;
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_sender_send_mode(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s public.email_deliverability_settings;
  h public.email_sender_health;
  lv public.email_sender_levels;
BEGIN
  IF NOT (public.is_super_admin()
          OR (COALESCE(p_venue_id, p_organizer_user_id::text) IS NOT NULL
              AND (COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false)
                   OR COALESCE(public.contact_scope_allowed(p_venue_id, p_organizer_user_id), false)))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.email_deliverability_settings WHERE id;
  SELECT * INTO h FROM public.email_sender_health WHERE scope_key = public._email_sender_key(p_venue_id, p_organizer_user_id);
  lv := public._email_sender_level(public._email_sender_key(p_venue_id, p_organizer_user_id));
  RETURN jsonb_build_object(
    'force_spread', COALESCE(s.force_spread, false) AND NOT lv.burst,
    'burst_allowed', lv.burst,
    'min_audience', s.spread_min_audience,
    'per_hour', lv.per_hour,
    'max_per_hour', lv.per_hour,
    'level', lv.level,
    'cold_frozen_until', CASE WHEN h.cold_frozen_until > now() THEN h.cold_frozen_until END);
END $$;

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
  v_rights jsonb;
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

  v_rights := public._email_sender_rights(v_key);
  RETURN jsonb_build_object(
    'rights', v_rights,
    'status', v_status,
    'reasons', to_jsonb(v_reasons),
    'metrics', to_jsonb(m),
    'held', v_held,
    'base', v_base,
    'campaigns', v_camps,
    'rules', jsonb_build_object(
      'force_spread', s.force_spread AND NOT COALESCE((v_rights->'current'->>'burst')::boolean, false),
      'burst_allowed', COALESCE((v_rights->'current'->>'burst')::boolean, false),
      'spread_min_audience', s.spread_min_audience,
      'spread_per_hour', (v_rights->'current'->>'per_hour')::int,
      'spread_max_per_hour', (v_rights->'current'->>'per_hour')::int,
      'waves_on', s.waves_on,
      'wave_first', s.wave_first, 'wave_max', s.wave_max, 'wave_wait_minutes', s.wave_wait_minutes,
      'cold_small_max', s.cold_small_max,
      'cold_daily_cap', LEAST(s.cold_daily_cap, (v_rights->'current'->>'cold_daily')::int),
      'cold_gmail_daily_cap', LEAST(s.cold_gmail_daily_cap, (v_rights->'current'->>'cold_gmail_daily')::int),
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

REVOKE ALL ON FUNCTION public._email_enforce_spread(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_enforce_spread(uuid) TO service_role;
REVOKE ALL ON FUNCTION public._email_release_waves(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_release_waves(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.email_sender_send_mode(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sender_send_mode(text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sender_health_report(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sender_health_report(text, uuid, text) TO authenticated;

-- Le cron : les niveaux une fois par jour, vers 6 h à Paris.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.email_deliverability_tick()'::regprocedure);
  a text := E'  RETURN jsonb_build_object(''waves'', v_w, ''late'', v_late, ''watch'', v_m);';
BEGIN
  IF position('email_sender_levels_tick' in v_def) > 0 THEN RETURN; END IF;
  IF position(a in v_def) = 0 THEN RAISE EXCEPTION 'email_deliverability_tick: ancrage introuvable'; END IF;
  v_def := replace(v_def, a, E'  IF extract(hour FROM (now() AT TIME ZONE ''Europe/Paris'')) = 6 AND extract(minute FROM now()) < 15 THEN\n    BEGIN\n      v_m := COALESCE(v_m, ''{}''::jsonb) || jsonb_build_object(''levels'', public.email_sender_levels_tick());\n    EXCEPTION WHEN OTHERS THEN\n      v_m := COALESCE(v_m, ''{}''::jsonb) || jsonb_build_object(''levels_error'', SQLERRM);\n    END;\n  END IF;\n' || a);
  EXECUTE v_def;
END $do$;

-- Départ prudent.
INSERT INTO public.email_sender_health (scope_key, level, level_since, updated_at)
VALUES ('org:06ce47f8-66a5-42d5-a7bf-56253619ff96', 2, now(), now())
ON CONFLICT (scope_key) DO UPDATE SET level = 2, level_since = now(), updated_at = now();
UPDATE public.email_sender_health SET level = 1, level_since = now(), updated_at = now()
 WHERE scope_key IN ('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8', 'venue:woh');
INSERT INTO public.email_sender_level_history (scope_key, from_level, to_level, reason)
SELECT scope_key, NULL, level, 'start' FROM public.email_sender_health
 WHERE scope_key IN ('org:06ce47f8-66a5-42d5-a7bf-56253619ff96', 'org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8', 'venue:woh');

-- « Tout d'un coup » = niveau 5 : le geste du super admin écrit aussi l'historique.
CREATE OR REPLACE FUNCTION public.admin_set_sender_burst(p_scope_key text, p_allowed boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_from smallint;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_scope_key IS NULL OR p_scope_key !~ '^(venue:.+|org:[0-9a-f-]{36}|yuno)$' THEN RAISE EXCEPTION 'invalid_scope'; END IF;
  v_from := (public._email_sender_level(p_scope_key)).level;
  INSERT INTO public.email_sender_health (scope_key, burst_allowed, burst_set_by, burst_set_at, burst_reason, updated_at)
  VALUES (p_scope_key, p_allowed, auth.uid(), now(), trim(p_reason), now())
  ON CONFLICT (scope_key) DO UPDATE
    SET burst_allowed = EXCLUDED.burst_allowed, burst_set_by = EXCLUDED.burst_set_by,
        burst_set_at = EXCLUDED.burst_set_at, burst_reason = EXCLUDED.burst_reason, updated_at = now();
  IF (public._email_sender_level(p_scope_key)).level <> v_from THEN
    INSERT INTO public.email_sender_level_history (scope_key, from_level, to_level, reason)
    VALUES (p_scope_key, v_from, (public._email_sender_level(p_scope_key)).level, CASE WHEN p_allowed THEN 'admin_burst' ELSE 'admin_burst_off' END);
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'email_sender_burst_set', 'email_sender', p_scope_key,
          jsonb_build_object('allowed', p_allowed, 'reason', trim(p_reason)));
  RETURN public.admin_email_senders();
END $$;
REVOKE ALL ON FUNCTION public.admin_set_sender_burst(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_sender_burst(text, boolean, text) TO authenticated;

-- L'admin voit, pour chaque compte, son niveau, ses droits et ses conditions.
CREATE OR REPLACE FUNCTION public.admin_email_senders()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  WITH x AS (
    SELECT public._email_sender_key(ec.venue_id, ec.organizer_user_id) AS k, ec.id AS cid,
           lower(r.email) AS em, r.status, public._email_is_gmail(r.email) AS gm
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns ec ON ec.id = r.campaign_id
     WHERE r.status IN ('sent', 'bounced', 'complained') AND r.sent_at > now() - interval '30 days'
       AND NOT public.is_demo_marketing_scope(ec.venue_id, ec.organizer_user_id)
  ), o AS (
    SELECT DISTINCT ev.campaign_id, lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '31 days'
  ), agg AS (
    SELECT x.k, count(*) AS sent,
           count(*) FILTER (WHERE x.status = 'bounced') AS bounced,
           count(*) FILTER (WHERE x.status = 'complained') AS complained,
           count(o.em) AS opened,
           count(*) FILTER (WHERE x.gm) AS gmail_sent,
           count(o.em) FILTER (WHERE x.gm) AS gmail_opened
      FROM x LEFT JOIN o ON o.campaign_id = x.cid AND o.em = x.em
     GROUP BY x.k
  ), keys AS (
    SELECT k FROM agg UNION SELECT scope_key FROM public.email_sender_health
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'scope_key', keys.k,
           'name', COALESCE(v.name, op.organization_name, CASE WHEN keys.k = 'yuno' THEN 'Yuno' END, keys.k),
           'sent', COALESCE(a.sent, 0), 'bounced', COALESCE(a.bounced, 0), 'complained', COALESCE(a.complained, 0),
           'opened', COALESCE(a.opened, 0), 'gmail_sent', COALESCE(a.gmail_sent, 0), 'gmail_opened', COALESCE(a.gmail_opened, 0),
           'burst_allowed', COALESCE(h.burst_allowed, false), 'burst_set_at', h.burst_set_at,
           'cold_frozen_until', CASE WHEN h.cold_frozen_until > now() THEN h.cold_frozen_until END,
           'reason', h.reason,
           'level', (public._email_sender_level(keys.k)).level,
           'rights', to_jsonb(public._email_sender_level(keys.k)),
           'level_since', h.level_since,
           'checks', public._email_sender_level_check(keys.k)->'checks')
         ORDER BY COALESCE(a.sent, 0) DESC), '[]'::jsonb)
    INTO v
    FROM keys
    LEFT JOIN agg a ON a.k = keys.k
    LEFT JOIN public.email_sender_health h ON h.scope_key = keys.k
    LEFT JOIN public.venues v ON keys.k = 'venue:' || v.id
    LEFT JOIN public.profiles op ON keys.k = 'org:' || op.id::text;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_email_senders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_senders() TO authenticated;
