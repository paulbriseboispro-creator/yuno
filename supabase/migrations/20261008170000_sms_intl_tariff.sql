-- ───────────────────────────────────────────────────────────────────────────
-- SMS Yuno CRM : deux tarifs (décision de Paul du 08/10) et STOP rattaché à
-- son club.
--
--   • France (+33) = 35 Yunits par SMS ; étranger (tout autre indicatif, y
--     compris l'outre-mer tant que la grille Octopush n'est pas lue) = 70.
--     La zone se lit sur le numéro AVANT l'envoi (sms_tariff_zone, miroir de
--     smsTariffZone dans _shared/sms-text.ts) ; le coût est calculé SMS par SMS.
--   • +1 (États-Unis, Canada) : jamais mis en file — un nom d'expéditeur n'y
--     est pas accepté.
--   • Un STOP garde le club (et le SMS) qui l'a provoqué : base du STOP par
--     club, quand les sous-comptes Octopush seront ouverts.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE public.crm_pricing
   SET config = jsonb_set(jsonb_set(config, '{rates,sms_intl}', '70'::jsonb), '{costs,sms_intl}', '0.09'::jsonb)
 WHERE id;

CREATE OR REPLACE FUNCTION public.sms_tariff_zone(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_phone ~ '^\+33' THEN 'fr'
    WHEN p_phone ~ '^\+1' THEN 'blocked'
    ELSE 'intl'
  END;
$$;

-- Yunits par SMS selon la zone (lus dans crm_pricing, jamais en dur au front).
CREATE OR REPLACE FUNCTION public.crm_sms_rates()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'fr', GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'sms')::integer, 35)),
    'intl', GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'sms_intl')::integer, 70)));
$$;

ALTER TABLE public.sms_stop_list ADD COLUMN IF NOT EXISTS scope_key text;
ALTER TABLE public.sms_stop_list ADD COLUMN IF NOT EXISTS campaign_id uuid;
ALTER TABLE public.sms_stop_list ADD COLUMN IF NOT EXISTS provider_message_id text;

DROP FUNCTION IF EXISTS public.sms_stop_unsubscribe(text);
CREATE FUNCTION public.sms_stop_unsubscribe(_phone text, _message_id text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text := public.normalize_phone_e164(_phone);
  v_count integer := 0;
  v_log public.sms_logs%ROWTYPE;
BEGIN
  IF v_norm IS NULL THEN
    RETURN 0;
  END IF;

  -- De quel club vient ce STOP ? Le SMS qui l'a provoqué (ticket Octopush du
  -- webhook), sinon le dernier SMS reçu par ce numéro sous 7 jours. Le STOP
  -- vaut encore pour tous les clubs (liste noire Octopush commune au compte) ;
  -- ce rattachement est ce qui permettra le STOP par club (sous-comptes).
  SELECT * INTO v_log FROM public.sms_logs l
   WHERE l.to_phone = v_norm
     AND (_message_id IS NULL OR l.provider_message_id = _message_id)
     AND l.status IN ('sent', 'delivered', 'undelivered')
     AND l.created_at > now() - interval '7 days'
   ORDER BY (l.provider_message_id IS NOT DISTINCT FROM _message_id) DESC, l.created_at DESC
   LIMIT 1;

  INSERT INTO public.sms_stop_list (phone_e164, source, scope_key, campaign_id, provider_message_id)
  VALUES (v_norm, 'stop',
          CASE WHEN v_log.id IS NULL THEN NULL
               WHEN v_log.venue_id IS NULL AND v_log.organizer_id IS NULL THEN 'platform'
               ELSE public.crm_scope_key(v_log.venue_id, v_log.organizer_id) END,
          v_log.campaign_id, COALESCE(_message_id, v_log.provider_message_id))
  ON CONFLICT (phone_e164) DO NOTHING;

  UPDATE public.venue_sms_contacts sc
  SET unsubscribed = true, unsubscribed_at = now()
  WHERE public.normalize_phone_e164(sc.phone_e164) = v_norm
    AND NOT sc.unsubscribed;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.profiles p
  SET phone_sms_opt_in = false
  WHERE public.normalize_phone_e164(p.phone) = v_norm
    AND p.phone_sms_opt_in;

  -- Les envois encore en file pour ce numéro ne partent plus.
  UPDATE public.sms_campaign_recipients r
     SET status = 'skipped', error_code = 'stop', error_message = 'STOP reçu'
   WHERE r.phone_e164 = v_norm AND r.status = 'pending';

  -- Trace de preuve, une ligne par club ou organisateur quitté (art. 7(1) RGPD).
  INSERT INTO public.marketing_consent_events (
    user_id, phone_e164, channel, venue_id, organizer_user_id, action, wording_text, source
  )
  SELECT DISTINCT sc.user_id, v_norm, 'sms', sc.venue_id, sc.organizer_user_id, 'withdrawn',
         'STOP par SMS entrant', 'sms_stop'
  FROM public.venue_sms_contacts sc
  WHERE public.normalize_phone_e164(sc.phone_e164) = v_norm
    AND (sc.venue_id IS NOT NULL OR sc.organizer_user_id IS NOT NULL);

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public._enqueue_crm_sms_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_scope  text;
  v_pred   text;
  v_days   integer;
  v_excl   boolean;
  v_cap    integer;
  v_total  integer;
  v_pending integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION '_enqueue_crm_sms_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;
  v_scope := public.crm_scope_key(c.venue_id, c.organizer_id);
  IF public.crm_effective_plan(v_scope) = 'paused' THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le compte est en pause, aucun envoi ne part.';
  END IF;

  v_pred := public._crm_audience_pred(c.segment_filters->'audiences', c.venue_id, c.organizer_id);
  IF v_pred IS NOT NULL THEN
    v_days := CASE WHEN (c.segment_filters->>'recent_days') ~ '^[0-9]+$'
                    AND (c.segment_filters->>'recent_days')::int BETWEEN 1 AND 90
                   THEN (c.segment_filters->>'recent_days')::int END;
    v_excl := COALESCE((c.segment_filters->>'exclude_buyers')::boolean, false) AND c.event_id IS NOT NULL;
    SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s WHERE s.scope_key = v_scope;
    v_cap := COALESCE(v_cap, 1);
    PERFORM public._crm_people_build(c.venue_id, c.organizer_id, NULL);

    EXECUTE format($q$
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name, lang)
      SELECT %6$L::uuid, s.phone,
             NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
             NULLIF(btrim(s.first_name), ''), 'fr'
        FROM (
          SELECT DISTINCT ON (p.phone) p.phone, p.first_name, p.last_name, p.email, p.events
            FROM _cp p
           WHERE p.phone_ok AND p.phone ~ '^\+[1-9][0-9]{6,14}$' AND (%3$s)
           ORDER BY p.phone, p.first_name NULLS LAST
        ) s
       WHERE NOT (%7$L::boolean AND %4$L::uuid = ANY (s.events))
         AND NOT (%5$L::integer IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.sms_campaign_recipients r
                          JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
                         WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                           AND c2.id <> %6$L::uuid AND r.phone_e164 = s.phone
                           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - make_interval(days => %5$L::integer))
                OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                             JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                            WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                              AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                              AND lower(r.email) = s.email)))
         AND (SELECT count(*) FROM public.sms_campaign_recipients r
                JOIN public.sms_campaigns c2 ON c2.id = r.campaign_id
               WHERE c2.venue_id IS NOT DISTINCT FROM %1$L::text AND c2.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                 AND c2.id <> %6$L::uuid AND r.phone_e164 = s.phone
                 AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days') < %8$L::integer
         AND NOT EXISTS (SELECT 1 FROM public.sms_stop_list x WHERE x.phone_e164 = s.phone)
         AND public.sms_tariff_zone(s.phone) <> 'blocked'
      ON CONFLICT (campaign_id, phone_e164) DO NOTHING
    $q$, c.venue_id, c.organizer_id, v_pred, c.event_id, v_days, p_campaign_id, v_excl, v_cap);
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;
  UPDATE public.sms_campaigns SET total_recipients = v_total, estimated_recipients = v_total WHERE id = p_campaign_id;
  RETURN jsonb_build_object('total', v_total, 'pending', v_pending, 'crm', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_sms_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  c        public.sms_campaigns%ROWTYPE;
  v_seg    text;
  v_event  uuid;
  v_import uuid;
  v_segid  uuid;
  v_ids    uuid[];
  v_match  text;
  v_total  integer;
  v_pending integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_sms_campaign_recipients: service_role only';
  END IF;
  SELECT * INTO c FROM public.sms_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found'; END IF;
  -- Yuno CRM : son audience (type « crm ») n'est JAMAIS lue par l'ancien
  -- moteur, qui la prendrait pour « tous les contacts ».
  IF public.sms_campaign_is_crm(p_campaign_id) THEN
    RETURN public._enqueue_crm_sms_recipients(p_campaign_id);
  END IF;

  v_seg    := COALESCE(c.segment_filters->>'type', 'all');
  v_event  := COALESCE(c.event_id, NULLIF(c.segment_filters->>'event_id', '')::uuid);
  v_import := NULLIF(c.segment_filters->>'import_id', '')::uuid;
  v_segid  := CASE WHEN COALESCE(c.segment_filters->>'segment_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN (c.segment_filters->>'segment_id')::uuid END;
  v_ids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(c.segment_filters->'segment_ids') = 'array' THEN c.segment_filters->'segment_ids' ELSE '[]'::jsonb END) x
           WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  IF cardinality(v_ids) = 0 AND v_segid IS NOT NULL THEN v_ids := ARRAY[v_segid]; END IF;
  v_match := CASE WHEN c.segment_filters->>'match' = 'all' THEN 'all' ELSE 'any' END;

  INSERT INTO public.sms_campaign_recipients (campaign_id, contact_id, user_id, phone_e164, full_name, first_name, lang)
  SELECT p_campaign_id, r.contact_id, r.user_id, r.phone_e164, r.full_name,
         NULLIF(split_part(btrim(COALESCE(r.full_name, '')), ' ', 1), ''),
         COALESCE(pr.preferred_language, 'fr')
    FROM public.resolve_sms_campaign_recipients(c.venue_id, c.organizer_id, v_seg, v_event, v_import, v_segid, v_ids, v_match) r
    LEFT JOIN public.profiles pr ON pr.id = r.user_id
   WHERE NOT EXISTS (SELECT 1 FROM public.sms_stop_list x WHERE x.phone_e164 = r.phone_e164)
     AND public.sms_tariff_zone(r.phone_e164) <> 'blocked'
  ON CONFLICT (campaign_id, phone_e164) DO NOTHING;

  SELECT count(*), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;

  UPDATE public.sms_campaigns
     SET total_recipients = v_total, estimated_recipients = v_total
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object('total', v_total, 'pending', v_pending);
END;
$function$;

-- Aperçu d'audience : la même règle, plus le nombre de numéros étrangers.
CREATE OR REPLACE FUNCTION public.crm_sms_audience_preview(p_venue_id text, p_organizer_user_id uuid, p_audiences jsonb, p_event_id uuid DEFAULT NULL::uuid, p_recent_days integer DEFAULT NULL::integer, p_exclude_buyers boolean DEFAULT false, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred text;
  v_days integer := CASE WHEN p_recent_days BETWEEN 1 AND 90 THEN p_recent_days END;
  v_cap integer;
  v jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_pred := public._crm_audience_pred(p_audiences, p_venue_id, p_organizer_user_id);
  IF v_pred IS NULL THEN
    RETURN jsonb_build_object('reach', 0, 'x_buyers', 0, 'x_recent', 0, 'x_cap', 0, 'net', 0, 'net_intl', 0);
  END IF;
  SELECT COALESCE(s.weekly_cap, 1) INTO v_cap FROM public.crm_sms_settings s
   WHERE s.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cap := COALESCE(v_cap, 1);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);

  EXECUTE format($q$
    WITH sel AS (
      SELECT p.email, p.phone, p.events FROM _cp p WHERE p.phone_ok AND public.sms_tariff_zone(p.phone) <> 'blocked' AND (%3$s)
    ), sms7 AS (
      SELECT r.phone_e164 AS phone, count(*) AS n
        FROM public.sms_campaign_recipients r
        JOIN public.sms_campaigns c ON c.id = r.campaign_id
       WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_id IS NOT DISTINCT FROM %2$L::uuid
         AND c.id IS DISTINCT FROM %6$L::uuid
         AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - interval '7 days'
       GROUP BY 1
    ), f AS (
      SELECT s.email, s.phone,
             (%4$L::uuid IS NOT NULL AND %4$L::uuid = ANY (s.events)) AS buyer,
             (%5$L::integer IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.sms_campaign_recipients r
                          JOIN public.sms_campaigns c ON c.id = r.campaign_id
                         WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_id IS NOT DISTINCT FROM %2$L::uuid
                           AND c.id IS DISTINCT FROM %6$L::uuid AND r.phone_e164 = s.phone
                           AND r.status IN ('sent', 'delivered') AND r.sent_at > now() - make_interval(days => %5$L::integer))
                OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                             JOIN public.email_campaigns c ON c.id = r.campaign_id
                            WHERE c.venue_id IS NOT DISTINCT FROM %1$L::text AND c.organizer_user_id IS NOT DISTINCT FROM %2$L::uuid
                              AND r.status = 'sent' AND r.sent_at > now() - make_interval(days => %5$L::integer)
                              AND lower(r.email) = s.email))) AS recent,
             COALESCE((SELECT m.n FROM sms7 m WHERE m.phone = s.phone), 0) >= %8$L::integer AS capped
        FROM sel s
    )
    SELECT jsonb_build_object(
      'reach', count(*),
      'x_buyers', count(*) FILTER (WHERE buyer AND %7$L::boolean),
      'x_recent', count(*) FILTER (WHERE recent AND NOT (buyer AND %7$L::boolean)),
      'x_cap', count(*) FILTER (WHERE capped AND NOT recent AND NOT (buyer AND %7$L::boolean)),
      'net', count(*) FILTER (WHERE NOT (buyer AND %7$L::boolean) AND NOT recent AND NOT capped),
      'net_intl', count(*) FILTER (WHERE NOT (buyer AND %7$L::boolean) AND NOT recent AND NOT capped
                                     AND public.sms_tariff_zone(phone) = 'intl'))
      FROM f
  $q$, p_venue_id, p_organizer_user_id, v_pred, p_event_id, v_days, p_campaign_id, COALESCE(p_exclude_buyers, false), v_cap)
  INTO v;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.sms_stop_unsubscribe(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_stop_unsubscribe(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.crm_sms_rates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_sms_rates() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sms_tariff_zone(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
