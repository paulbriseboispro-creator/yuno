-- ============================================================================
-- Yuno CRM — « 10 % non contactés, pour mesurer l'effet réel » (2026-10-13)
-- Plan : docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md (lot 1, décision 1 de Paul).
--
-- Jusqu'ici on comptait qui achète APRÈS un envoi, jamais ce qui se serait
-- passé sans. Désormais une part de chaque audience (10 % par défaut, réglable
-- de 0 à 30 par compte, 0 = désactivé) est tirée au hasard et n'est PAS
-- contactée par cet envoi :
--   • e-mail « Qui cibler » (audience portant la clé `ntgt`, directement ou par
--     un segment enregistré depuis « Qui cibler ») relié à une soirée :
--     destinataire `skipped`, `error_message = 'holdout'` ;
--   • SMS « Qui cibler », même règle (`error_code = 'holdout'`) ;
--   • recettes d'automatisation d'un compte CRM : registre `skipped`,
--     `skip_reason = 'holdout'` (l'étape SMS d'une recette ne part qu'à qui a
--     reçu l'e-mail : le témoin ne la reçoit pas non plus).
-- Le tirage est déterministe (empreinte de l'envoi et de l'adresse), fait
-- APRÈS les règles d'envoi : le témoin est tiré parmi ceux qui auraient reçu
-- le message, c'est ce qui rend la comparaison juste. Jamais débité en Yunits.
-- Lecture : crm_holdout_overview (acheteurs du groupe contacté contre ceux du
-- témoin, acheteurs en plus, z) ; crm_holdout_settings (la part, le droit de
-- la changer). Réglage : crm_holdout_set.
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs).
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────
ALTER TABLE public.crm_settings ADD COLUMN IF NOT EXISTS holdout_pct smallint NOT NULL DEFAULT 10;
DO $$ BEGIN
  ALTER TABLE public.crm_settings ADD CONSTRAINT crm_settings_holdout_pct_chk CHECK (holdout_pct BETWEEN 0 AND 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.email_campaigns ADD COLUMN IF NOT EXISTS holdout_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.sms_campaigns ADD COLUMN IF NOT EXISTS holdout_count integer NOT NULL DEFAULT 0;
-- L'adresse d'un destinataire SMS du CRM : sans elle, on ne saurait pas s'il a
-- acheté. Effacée avec le contact (_crm_erase_contacts).
ALTER TABLE public.sms_campaign_recipients ADD COLUMN IF NOT EXISTS email text;

-- ── 2. Règles communes ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_holdout_pct(p_scope text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT s.holdout_pct::integer FROM public.crm_settings s WHERE s.scope_key = p_scope), 10);
$function$;
REVOKE ALL ON FUNCTION public.crm_holdout_pct(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_holdout_pct(text) TO service_role;

-- Tirage : même envoi + même adresse = même réponse ; p_pct % des adresses.
CREATE OR REPLACE FUNCTION public._crm_holdout_pick(p_key text, p_email text, p_pct integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(p_pct, 0) > 0
     AND abs(hashtext(COALESCE(p_key, '') || ':' || lower(COALESCE(p_email, '')))::bigint) % 1000 < p_pct * 10;
$function$;
REVOKE ALL ON FUNCTION public._crm_holdout_pick(text, text, integer) FROM PUBLIC, anon, authenticated;

-- Une audience de « Qui cibler » : la clé `ntgt` dans une définition, ou un
-- segment enregistré depuis « Qui cibler ».
CREATE OR REPLACE FUNCTION public._crm_audience_is_targeting(p_aud jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_aud) = 'array' THEN p_aud ELSE '[]'::jsonb END) a
     WHERE (jsonb_typeof(a->'def'->'f') = 'object' AND (a->'def'->'f') ? 'ntgt')
        OR EXISTS (SELECT 1 FROM public.crm_segments s
                    WHERE s.id::text = a->>'segmentId'
                      AND jsonb_typeof(s.definition->'f') = 'object' AND (s.definition->'f') ? 'ntgt'));
$function$;
REVOKE ALL ON FUNCTION public._crm_audience_is_targeting(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 3. Les envois gardent leur témoin ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_campaign_recipients(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
  v_scope text;
  v_name text;
  v_queued integer;
  v_debit jsonb;
  v_crm boolean;
  v_held integer := 0;
  v_event uuid;
  v_aud jsonb;
  v_pct integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: service_role only';
  END IF;

  SELECT public.crm_scope_key(c.venue_id, c.organizer_user_id), c.name
    INTO v_scope, v_name
    FROM public.email_campaigns c WHERE c.id = p_campaign_id;
  v_crm := public.crm_campaign_is_crm(p_campaign_id);
  IF v_crm AND public.crm_effective_plan(v_scope) = 'paused' THEN
    RAISE EXCEPTION 'crm_paused' USING ERRCODE = 'P0001',
      HINT = 'Yuno CRM : le compte est en pause, aucun envoi ne part.';
  END IF;

  v_res := public._enqueue_campaign_recipients_core(p_campaign_id);
  IF v_scope IS NULL OR NOT v_crm THEN
    RETURN v_res;
  END IF;

  -- « 10 % non contactés, pour mesurer l'effet réel » (20261013120000) : un
  -- envoi « Qui cibler » relié à une soirée garde de côté une part tirée au
  -- hasard PARMI ceux qui allaient le recevoir. Ni envoyés, ni débités.
  SELECT c.event_id, c.audiences_json INTO v_event, v_aud FROM public.email_campaigns c WHERE c.id = p_campaign_id;
  v_pct := public.crm_holdout_pct(v_scope);
  IF v_event IS NOT NULL AND v_pct > 0 AND public._crm_audience_is_targeting(v_aud) THEN
    UPDATE public.email_campaign_recipients r
       SET status = 'skipped', error_message = 'holdout'
     WHERE r.campaign_id = p_campaign_id AND r.status = 'pending'
       AND public._crm_holdout_pick(p_campaign_id::text, r.email, v_pct);
    GET DIAGNOSTICS v_held = ROW_COUNT;
    IF v_held > 0 THEN
      UPDATE public.email_campaigns c
         SET holdout_count = c.holdout_count + v_held,
             total_recipients = GREATEST(0, c.total_recipients - v_held)
       WHERE c.id = p_campaign_id;
      v_res := v_res || jsonb_build_object('holdout', v_held,
                 'queued', GREATEST(0, COALESCE((v_res->>'queued')::integer, 0) - v_held),
                 'total', GREATEST(0, COALESCE((v_res->>'total')::integer, 0) - v_held),
                 'remaining', GREATEST(0, COALESCE((v_res->>'remaining')::integer, 0) - v_held));
    END IF;
  END IF;

  v_queued := COALESCE((v_res->>'queued')::integer, 0);
  IF v_queued > 0 THEN
    v_debit := public.crm_yunits_debit(v_scope, v_queued, 'email', 'email_campaign', p_campaign_id::text, v_name, '{}'::jsonb);
    IF NOT COALESCE((v_debit->>'ok')::boolean, false) THEN
      -- Annule TOUTE la mise en file de cet appel : rien ne part, rien n'est débité.
      RAISE EXCEPTION 'crm_yunits_insufficient'
        USING ERRCODE = 'P0001', DETAIL = format('needed=%s balance=%s', v_queued, v_debit->>'balance');
    END IF;
    v_res := v_res || jsonb_build_object('yunits_debited', v_queued, 'yunits_balance', v_debit->'balance');
  END IF;
  RETURN v_res;
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
  v_pct    integer;
  v_held   integer := 0;
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
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name, lang, email)
      SELECT %6$L::uuid, s.phone,
             NULLIF(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
             NULLIF(btrim(s.first_name), ''), 'fr', s.email
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

    -- « 10 % non contactés, pour mesurer l'effet réel » (20261013120000).
    v_pct := public.crm_holdout_pct(v_scope);
    IF c.event_id IS NOT NULL AND v_pct > 0 AND public._crm_audience_is_targeting(c.segment_filters->'audiences') THEN
      UPDATE public.sms_campaign_recipients r
         SET status = 'skipped', error_code = 'holdout', error_message = 'holdout'
       WHERE r.campaign_id = p_campaign_id AND r.status = 'pending'
         AND public._crm_holdout_pick(p_campaign_id::text, COALESCE(r.email, r.phone_e164), v_pct);
      GET DIAGNOSTICS v_held = ROW_COUNT;
    END IF;
  END IF;

  SELECT count(*) FILTER (WHERE status <> 'skipped'), count(*) FILTER (WHERE status = 'pending')
    INTO v_total, v_pending
    FROM public.sms_campaign_recipients WHERE campaign_id = p_campaign_id;
  UPDATE public.sms_campaigns
     SET total_recipients = v_total, estimated_recipients = v_total,
         holdout_count = (SELECT count(*) FROM public.sms_campaign_recipients r
                           WHERE r.campaign_id = p_campaign_id AND r.status = 'skipped' AND r.error_code = 'holdout')
   WHERE id = p_campaign_id;
  RETURN jsonb_build_object('total', v_total, 'pending', v_pending, 'crm', true, 'holdout', v_held);
END;
$$;

CREATE OR REPLACE FUNCTION public.collect_email_automations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_holdout integer := 0;
  a RECORD;
  tpl RECORD;
  grp RECORD;
  v_delay interval;
  v_next uuid;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_automations integer := 0;
  v_children uuid[] := '{}';
  v_blocks jsonb;
  v_name text;
  v_label text;
  v_platform boolean;
  -- Une recette « à toute la base » travaille par LOTS : une personne déjà
  -- inscrite au registre pour ce déclencheur n'est plus candidate, le passage
  -- suivant (5 min plus tard) prend le lot suivant. Avant, le LIMIT tombait
  -- AVANT ce filtre : les 5 000 premiers revenaient à chaque passage et le
  -- reste de la base ne recevait jamais rien.
  v_batch constant integer := 3000;
  -- L'appel passe par l'API (plafond de 8 s) : au-delà de ce budget, les
  -- recettes restantes attendent le passage suivant plutôt que de faire
  -- tomber TOUT le passage (et les recettes de tous les comptes avec lui).
  v_started timestamptz := clock_timestamp();
  v_budget_hit boolean := false;
  -- Compte Yuno CRM pur : les e-mails automatiques se paient en Yunits. Ce que
  -- le solde ne couvre pas n'est pas inscrit au registre (il reviendra).
  v_scope text;
  v_rate integer;
  v_room integer;
  v_held integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_email_automations: service_role only';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _auto_cand (
    em text,
    trigger_key text,
    trigger_event_id uuid,
    bind_event_id uuid,
    due_at timestamptz,
    optin boolean,
    user_id uuid,
    first_name text,
    last_name text,
    -- Ordre de priorité entre plusieurs soirées d'un même contact dans un
    -- même passage (la plus proche d'abord) : voir le cooldown intra-passage.
    ord timestamptz
  ) ON COMMIT DROP;

  -- Les pros d'abord, Yuno en dernier : à soirée égale, le pro passe avant (R5).
  -- Puis par PRIORITÉ de recette : un contact ne reçoit qu'une automatisation
  -- par passage (cooldown), c'est donc l'ordre ci-dessous qui décide laquelle —
  -- l'urgent (panier, tarif) avant la relation (merci, on t'a manqué), la vente
  -- (table, dernier appel, annonce) avant l'accueil (bienvenue, reconquête).
  FOR a IN
    SELECT x.*, (x.venue_id IS NULL AND x.organizer_user_id IS NULL) AS is_platform
      FROM public.email_automations x
     WHERE x.enabled AND x.template_id IS NOT NULL AND x.enabled_at IS NOT NULL
       -- Démo : une recette allumée s'affiche, elle n'envoie JAMAIS.
       AND NOT public.is_demo_marketing_scope(x.venue_id, x.organizer_user_id)
     ORDER BY (x.venue_id IS NULL AND x.organizer_user_id IS NULL),
              CASE x.kind
                WHEN 'abandoned_checkout' THEN 0 WHEN 'tier_closing' THEN 1 WHEN 'click_no_buy' THEN 1
                WHEN 'post_event_thanks' THEN 2 WHEN 'post_event_missed' THEN 3
                WHEN 'table_upsell' THEN 4 WHEN 'last_call' THEN 5 WHEN 'new_event' THEN 6
                WHEN 'regular_lapse' THEN 7 WHEN 'first_return' THEN 7 WHEN 'welcome' THEN 8 ELSE 9 END,
              x.created_at
  LOOP
    v_platform := a.is_platform;
    -- Les recettes de SOIRÉE n'ont pas de sens à l'échelle de Yuno : pas de
    -- dernier appel, d'annonce, de palier ni d'upsell à toute la base pour
    -- chaque soirée de chaque club.
    -- « L'habitué décroche » non plus : un rythme de sortie se lit chez UN
    -- club ou UN organisateur, pas sur toute la plateforme.
    IF v_platform AND a.kind IN ('last_call', 'new_event', 'tier_closing', 'table_upsell', 'regular_lapse', 'click_no_buy', 'first_return') THEN CONTINUE; END IF;
    IF clock_timestamp() - v_started > interval '4 seconds' THEN
      v_budget_hit := true;
      EXIT;
    END IF;
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    v_next := CASE WHEN v_platform THEN NULL ELSE public._email_automation_next_event(a.venue_id, a.organizer_user_id) END;
    TRUNCATE _auto_cand;
    v_room := NULL;
    v_holdout := 0;
    IF NOT v_platform THEN
      v_scope := public.crm_scope_key(a.venue_id, a.organizer_user_id);
      IF v_scope IS NOT NULL AND public.crm_scope_is_crm(v_scope) THEN
        -- Témoin (20261013120000) : une part tirée au hasard ne reçoit pas la recette.
        v_holdout := public.crm_holdout_pct(v_scope);
        IF public.crm_effective_plan(v_scope) = 'paused' THEN
          v_room := 0;
        ELSE
          v_rate := GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1));
          v_room := GREATEST(0, COALESCE(public.crm_yunits_balance(v_scope), 0) / v_rate
                    - (SELECT count(*)::integer FROM public.email_automation_sends l
                        WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL));
        END IF;
      END IF;
    END IF;

    -- ── 5a. Candidats par recette ─────────────────────────────────────────
    IF a.kind = 'welcome' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'once', NULL, v_next, s.created_at + v_delay, true, s.user_id, s.first_name, s.last_name, s.created_at + v_delay
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.import_id IS NULL
         AND COALESCE(s.source, '') NOT LIKE 'import%'
         AND (v_platform OR COALESCE(s.source, '') NOT LIKE 'platform%')
         AND COALESCE(s.source, '') NOT LIKE 'checkout%'
         -- Yuno CRM : un accord rapporté par une billetterie connectée n'est pas
         -- une inscription : jamais de « bienvenue » à tout un historique importé.
         AND COALESCE(s.source, '') NOT LIKE 'connector%'
         AND COALESCE(s.source, '') NOT LIKE 'platform:checkout%'
         AND s.created_at >= a.enabled_at
         AND s.created_at >= now() - interval '14 days'
         AND s.created_at + v_delay <= now()
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email))
       LIMIT 500;

    ELSIF a.kind = 'abandoned_checkout' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(x.em), x.event_id)
             lower(x.em), x.event_id::text, x.event_id, x.event_id, x.created_at + v_delay,
             x.optin, x.user_id, x.first_name, x.last_name, x.created_at + v_delay
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at, COALESCE(t.newsletter_opt_in, false) AS optin, t.user_id,
                 COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS first_name,
                 COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS last_name
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND t.created_at >= a.enabled_at
             AND t.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at, COALESCE(r.newsletter_opt_in, false), r.user_id,
                 COALESCE(r.guest_first_name, NULLIF(split_part(btrim(COALESCE(r.full_name, '')), ' ', 1), '')),
                 COALESCE(r.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(r.full_name, ''), '^\S+\s*', '')), ''))
            FROM public.table_reservations r
            JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND (v_platform
               OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
             AND r.created_at >= a.enabled_at
             AND r.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
        ) x
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = x.event_id::text AND lower(l.email) = lower(x.em))
       ORDER BY lower(x.em), x.event_id, x.optin DESC, x.created_at DESC
       LIMIT 500;

      -- L'accord coché au checkout est versé dans le registre du CLUB ou de
      -- l'ORGANISATEUR (c'est leur case, pas celle de Yuno).
      IF a.venue_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.venue_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      ELSIF a.organizer_user_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.organizer_user_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      END IF;

    ELSIF a.kind = 'last_call' THEN
      -- N h avant chaque soirée qui a encore quelque chose à vendre : toute la
      -- base opt-in (imports compris), les plus engagés d'abord, par lots
      -- (v_batch) : qui est déjà au registre pour cette soirée sort du lot.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
         WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.start_at > a.enabled_at
           AND e.start_at - v_delay <= now()
           AND e.start_at > now() + interval '2 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, now(), true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'new_event' THEN
      -- Annonce d'une soirée PUBLIÉE (published_at, jamais created_at, jamais
      -- une re-génération de modèle récurrent), N h après la mise en ligne, à
      -- toute la base opt-in — c'est LA recette qui met un fichier importé au
      -- travail. Le jugement écarte la rafale (une seule annonce par
      -- publication groupée sous 24 h) puis applique le cooldown.
      WITH pool AS (
        SELECT lower(s.email) AS em, e.id AS eid, e.start_at, e.published_at, s.user_id, s.first_name, s.last_name, s.created_at AS sub_at
          FROM public.events e
          JOIN public.newsletter_subscriptions s
            ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           AND s.opted_in AND s.opted_out_at IS NULL
         WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
           AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
           AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id)
             -- Co-organisation : la portée annonce aussi les soirées qu'elle
             -- co-héberge (partenaire ou co-hôte qui partage son CRM).
             OR e.id IN (SELECT public.coorg_marketing_event_ids(a.venue_id, a.organizer_user_id)))
           AND e.published_at IS NOT NULL
           AND e.published_at >= a.enabled_at
           AND e.published_at >= now() - interval '7 days'
           AND e.published_at + v_delay <= now()
           AND e.start_at > now() + interval '48 hours'
           AND (
             ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
             OR (e.tables_enabled AND NOT e.tables_sold_out)
             OR (NOT e.guest_list_sold_out AND EXISTS (
                   SELECT 1 FROM public.guest_lists gl
                    WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
           )
           AND (e.recurring_template_id IS NULL OR NOT EXISTS (
                 SELECT 1 FROM public.events e2
                  WHERE e2.recurring_template_id = e.recurring_template_id
                    AND e2.id <> e.id AND e2.created_at < e.created_at))
           AND NOT EXISTS (
             SELECT 1 FROM public.email_automation_sends l
              WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(s.email))
      ),
      rk AS (
        SELECT r.email, r.rnk
          FROM public._email_engagement_ranks(ARRAY(SELECT DISTINCT p.em FROM pool p), a.venue_id, a.organizer_user_id) r
      )
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT p.em, p.eid::text, p.eid, p.eid, p.published_at + v_delay, true, p.user_id, p.first_name, p.last_name, p.start_at
        FROM pool p LEFT JOIN rk ON rk.email = p.em
       ORDER BY p.start_at ASC, COALESCE(rk.rnk, 3) ASC, p.sub_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'table_upsell' THEN
      -- « Passe en table » : N h avant le début, aux détenteurs d'un billet
      -- payé, tant que la soirée ouvre des tables et qu'il en reste au moins
      -- une (même calcul que le bloc Table VIP de l'email : formules actives
      -- moins réservations, formules marquées complètes exclues).
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(t.user_email), e.id)
             lower(t.user_email), e.id::text, e.id, e.id, now(), true, t.user_id,
             COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')),
             COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')),
             e.start_at
        FROM public.events e
        JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
        JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
       WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
         AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
           OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
         AND e.tables_enabled AND NOT e.tables_sold_out
         AND COALESCE(tl.n, 0) > 0
         AND e.start_at > a.enabled_at
         AND e.start_at - v_delay <= now()
         AND e.start_at > now() + interval '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = e.id::text AND lower(l.email) = lower(t.user_email))
       ORDER BY lower(t.user_email), e.id, t.created_at DESC
       LIMIT v_batch;

    ELSIF a.kind = 'tier_closing' THEN
      -- « Le tarif monte » : le palier ouvert a dépassé le seuil, il reste au
      -- moins un billet et un palier suivant plus cher existe. Cible = ceux qui
      -- ont montré un intérêt sans acheter : clic sur la soirée dans un email
      -- de la portée, ou inscrit en liste d'attente. Un seul envoi par personne
      -- et par soirée, quel que soit le nombre de paliers.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (p.em, p.event_id)
             p.em, p.event_id::text, p.event_id, p.event_id, now(), true, NULL, NULL, NULL, p.start_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.slug, e.start_at
              FROM public.events e
              JOIN LATERAL (
                SELECT r.position, r.price
                  FROM public.ticket_rounds r
                 WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
                   AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
                   AND r.tickets_sold * 100 >= r.max_tickets * a.threshold_pct
                 ORDER BY r.position LIMIT 1
              ) cur ON true
             WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
               AND e.ticketing_enabled AND NOT e.tickets_sold_out
               AND e.start_at > a.enabled_at
               AND e.start_at > now() + interval '2 hours'
               AND EXISTS (
                 SELECT 1 FROM public.ticket_rounds n
                  WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                    AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
          )
          SELECT ev.id AS event_id, lower(x.recipient_email) AS em, ev.start_at
            FROM ev
            JOIN public.email_campaigns c
              ON public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
           WHERE x.created_at > now() - interval '60 days'
             AND x.recipient_email IS NOT NULL
             AND (
               (c.event_id = ev.id AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '')
                  ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)')
               OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || ev.id::text || '%'
               OR (ev.slug IS NOT NULL AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/events/%/' || ev.slug || '%')
             )
          UNION
          SELECT w.event_id, lower(w.email), ev.start_at
            FROM public.event_waitlist w JOIN ev ON ev.id = w.event_id
           WHERE w.email IS NOT NULL
        ) p
       WHERE p.em IS NOT NULL AND position('@' in p.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em)
       ORDER BY p.em, p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'click_no_buy' THEN
      -- « A cliqué sans acheter » : un clic NOMINATIF dans un e-mail de la
      -- portée vers la billetterie d'une soirée à venir, puis aucune place à
      -- la même adresse N h après le DERNIER clic (jugé plus bas, au moment
      -- où l'envoi est dû). Une visite venue d'ailleurs est anonyme : jamais
      -- ici. Une relance due depuis plus de 24 h ne part plus.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT k.em, k.eid::text, k.eid, k.eid, k.last_click + v_delay, true, NULL, NULL, NULL, k.start_at
        FROM (
          SELECT lower(x.recipient_email) AS em, e.id AS eid, e.start_at, max(x.created_at) AS last_click
            FROM public.email_campaigns c
            JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
            JOIN public.events e
              ON e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
             AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND e.start_at > now() + interval '2 hours'
             AND NOT e.tickets_sold_out
             AND (
               -- Bouton d'un e-mail CRM : la page de CETTE soirée sur la billetterie connectée.
               (e.external_ticket_url IS NOT NULL
                AND public._link_base(COALESCE(x.metadata->'click'->>'link', x.metadata->>'link')) = public._link_base(e.external_ticket_url))
               -- Lien Yuno (suivi /l/, page soirée) d'une campagne reliée à cette soirée.
               OR (c.event_id = e.id
                   AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/')
             )
           WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, a.venue_id, a.organizer_user_id)
             AND x.recipient_email IS NOT NULL
             AND x.created_at > now() - v_delay - interval '24 hours'
             -- Un vrai destinataire de la campagne : jamais l'envoi de test du pro.
             AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                          WHERE r.campaign_id = c.id AND lower(r.email) = lower(x.recipient_email))
           GROUP BY lower(x.recipient_email), e.id, e.start_at
        ) k
       WHERE k.last_click + v_delay <= now()
         AND k.last_click + v_delay > now() - interval '24 hours'
         AND position('@' in k.em) > 1
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = k.eid::text AND lower(l.email) = k.em)
       ORDER BY k.start_at, k.em
       LIMIT v_batch;

    ELSIF a.kind IN ('post_event_thanks', 'post_event_missed') THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT DISTINCT ON (lower(p.em), p.event_id)
             lower(p.em), p.event_id::text, p.event_id, v_next, now(), true, NULL, NULL, NULL, p.end_at
        FROM (
          WITH ev AS (
            SELECT e.id, e.end_at
              FROM public.events e
             WHERE e.status = 'active' AND e.cancelled_at IS NULL
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND (NOT v_platform OR NOT (e.id = ANY (public.demo_event_ids())))
               AND e.end_at >= a.enabled_at
               AND e.end_at + v_delay <= now()
               AND e.end_at >= now() - interval '5 days'
          ),
          came AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND ge.entry_scanned
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          holders AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'confirmed', 'used')
            UNION
            SELECT xt.event_id, lower(xt.buyer_email) FROM public.external_tickets xt JOIN ev ON ev.id = xt.event_id
             WHERE xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
          ),
          -- « On t'a manqué » seulement sur une soirée scannée pour de bon : au
          -- moins la moitié des détenteurs scannés. Shotgun laisse le scan vide
          -- quand un AUTRE prestataire a scanné, et une porte qui a arrêté de
          -- scanner ferait écrire « on t'a manqué » à des gens venus.
          scanned_events AS (
            SELECT hc.event_id FROM (SELECT event_id, count(*) AS n FROM holders GROUP BY event_id) hc
              JOIN (SELECT event_id, count(*) AS n FROM came GROUP BY event_id) cc ON cc.event_id = hc.event_id
             WHERE cc.n >= 0.5 * hc.n)
          SELECT c.event_id, c.em, ev.end_at FROM came c JOIN ev ON ev.id = c.event_id WHERE a.kind = 'post_event_thanks'
          UNION ALL
          SELECT h.event_id, h.em, ev.end_at FROM holders h
            JOIN ev ON ev.id = h.event_id
            JOIN scanned_events se ON se.event_id = h.event_id
           WHERE a.kind = 'post_event_missed'
             AND NOT EXISTS (SELECT 1 FROM came c WHERE c.event_id = h.event_id AND c.em = h.em)
        ) p
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = lower(p.em))
       ORDER BY lower(p.em), p.event_id
       LIMIT v_batch;

    ELSIF a.kind = 'win_back' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT lower(s.email), 'wb-' || to_char(now(), 'YYYY-MM'), NULL, v_next, now(), true, s.user_id, s.first_name, s.last_name, now()
        FROM public.newsletter_subscriptions s
        JOIN LATERAL (
          SELECT max(x.at) AS last_at FROM (
            SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
             WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
             WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'confirmed', 'used')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT ge.entry_scanned_at FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
             WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
             WHERE lower(xt.buyer_email) = lower(s.email) AND xt.status IN ('valid', 'transferred')
               AND (v_platform
                 OR (a.venue_id IS NOT NULL AND xt.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND xt.organizer_user_id = a.organizer_user_id))
          ) x
        ) act ON true
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND act.last_at IS NOT NULL
         AND act.last_at <= now() - v_delay
         AND act.last_at > now() - v_delay - interval '120 days'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '180 days'
         )
         -- L'habitué relancé par « il décroche » n'est pas reconquis trois
         -- semaines plus tard : la même personne, le même silence, un seul email.
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.kind = 'regular_lapse' AND l.status = 'queued' AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '60 days'
              AND l.venue_id IS NOT DISTINCT FROM a.venue_id
              AND l.organizer_user_id IS NOT DISTINCT FROM a.organizer_user_id
         )
      ORDER BY public._email_engagement_rank(lower(s.email), a.venue_id, a.organizer_user_id) ASC, act.last_at DESC
       LIMIT 300;

    ELSIF a.kind = 'regular_lapse' THEN
      -- « L'habitué décroche » : deux sorties par mois puis plus rien depuis
      -- N jours (six semaines par défaut). Détection et choix de la soirée
      -- par personne dans _regular_lapse_candidates (ses goûts : la série qu'il
      -- fréquentait, ses genres, son jour de sortie). Un épisode de silence =
      -- un email (trigger_key = date de la dernière venue), et pas plus d'un
      -- tous les 120 jours. Sans aucune soirée à venir, personne : une
      -- invitation sans soirée n'invite à rien — le prochain passage le reprend.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT r.em, 'rl-' || to_char(r.last_at, 'YYYY-MM-DD'), NULL, COALESCE(r.pick_event_id, v_next), now(), true,
             COALESCE(s.user_id, r.user_id), s.first_name, s.last_name, now()
        FROM public._regular_lapse_candidates(a.venue_id, a.organizer_user_id, v_delay) r
        JOIN LATERAL (
          SELECT s.user_id, s.first_name, s.last_name
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           LIMIT 1
        ) s ON true
       WHERE COALESCE(r.pick_event_id, v_next) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = r.em
              AND l.created_at > now() - interval '120 days'
         )
       ORDER BY public._email_engagement_rank(r.em, a.venue_id, a.organizer_user_id) ASC, r.last_at DESC
       LIMIT 300;

    ELSIF a.kind = 'first_return' THEN
      -- « Faire revenir après la 1re soirée » (20261011130000) : venus une seule
      -- fois, pas de passage, la 1re soirée finie depuis le délai médian de
      -- retour du compte ; la soirée choisie POUR la personne (concept, artiste
      -- déjà vu, genre, jour) dans _first_return_candidates. Une fois par
      -- personne (trigger_key 'fr'). Rien sans soirée à venir.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name, ord)
      SELECT r.em, 'fr', NULL, COALESCE(r.pick_event_id, v_next), r.due_at, true,
             s.user_id, s.first_name, s.last_name, r.due_at
        FROM public._first_return_candidates(a.venue_id, a.organizer_user_id, a.enabled_at - interval '7 days') r
        JOIN LATERAL (
          SELECT s.user_id, s.first_name, s.last_name
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
           LIMIT 1
        ) s ON true
       WHERE COALESCE(r.pick_event_id, v_next) IS NOT NULL
       ORDER BY public._email_engagement_rank(r.em, a.venue_id, a.organizer_user_id) ASC, r.due_at ASC
       LIMIT 300;
    END IF;

    -- ── 5b. Jugement, au moment où l'envoi est dû ─────────────────────────
    WITH cand AS (
      SELECT DISTINCT ON (c.em, c.trigger_key) c.*
        FROM _auto_cand c
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = c.trigger_key AND lower(l.email) = c.em
       )
       ORDER BY c.em, c.trigger_key, c.optin DESC
    ),
    -- Règles Yuno (pression, fatigue, aversion) calculées en UNE passe sur
    -- tout le lot : appelées ligne à ligne, elles coûtaient ~1 ms par contact
    -- (14 s pour une base de 12 000), au-delà du plafond de l'API.
    pol AS (
      SELECT p.email, p.reason
        FROM public._email_send_policy_many(ARRAY(SELECT DISTINCT c.em FROM cand c), a.kind) p
    ),
    -- Rafale de publications : jugée une fois par SOIRÉE, pas par contact.
    burst AS (
      SELECT x.eid FROM (SELECT DISTINCT c.trigger_event_id AS eid FROM cand c
                          WHERE a.kind = 'new_event' AND c.trigger_event_id IS NOT NULL) x
       WHERE EXISTS (
         SELECT 1 FROM public.events e
           JOIN public.events e2 ON e2.id <> e.id
            AND e2.status = 'active' AND (e2.is_active OR e2.external_source IS NOT NULL) AND e2.cancelled_at IS NULL
            AND (e2.visibility = 'public' OR e2.external_source IS NOT NULL)
            AND e2.venue_id IS NOT DISTINCT FROM e.venue_id
            AND e2.organizer_user_id IS NOT DISTINCT FROM e.organizer_user_id
            AND e2.published_at IS NOT NULL AND e2.published_at >= a.enabled_at
            AND abs(extract(epoch FROM (e2.published_at - e.published_at))) <= 86400
            AND e2.start_at > now() + interval '48 hours'
            AND (e2.start_at < e.start_at OR (e2.start_at = e.start_at AND e2.id < e.id))
          WHERE e.id = x.eid)
    ),
    judged0 AS (
      SELECT c.*,
             CASE
               WHEN c.trigger_event_id IS NOT NULL
                    AND a.kind IN ('last_call', 'abandoned_checkout', 'table_upsell', 'tier_closing', 'new_event', 'click_no_buy')
                    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.trigger_event_id AND e.start_at <= now())
                 THEN 'event_over'
               -- R5 : quelqu'un d'autre (club, orga du co-event, Yuno) l'a déjà
               -- écrit pour cette soirée et cette recette.
               WHEN c.trigger_event_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.kind = a.kind AND l.trigger_event_id = c.trigger_event_id
                    AND lower(l.email) = c.em AND l.status = 'queued'
               ) THEN 'already_event'
               -- Rafale de publications : un club qui met 6 dates en ligne
               -- d'un coup n'annonce que la plus proche ; les autres sont
               -- tracées ici pour que le bilan l'explique.
               WHEN a.kind = 'new_event' AND c.trigger_event_id IN (SELECT b.eid FROM burst b) THEN 'already_event'
               WHEN public.is_email_suppressed(c.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
               ) THEN CASE WHEN a.kind = 'abandoned_checkout' THEN 'no_consent' ELSE 'unsubscribed' END
               WHEN a.kind = 'table_upsell' AND EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = c.trigger_event_id AND lower(r.user_email) = c.em
                    AND r.status IN ('paid', 'used', 'confirmed', 'pending')
               ) THEN 'has_table'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE r.event_id = c.trigger_event_id AND r.status IN ('paid', 'confirmed', 'used') AND lower(r.user_email) = c.em)
                 -- Yuno CRM : déjà acheté sur la billetterie connectée.
                 OR EXISTS (SELECT 1 FROM public.external_tickets xt
                             WHERE xt.event_id = c.trigger_event_id AND xt.status IN ('valid', 'transferred')
                               AND (lower(xt.buyer_email) = c.em OR lower(xt.holder_email) = c.em))
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event', 'click_no_buy') AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               -- Une automatisation par 48 h et par portée ; les trois recettes
               -- URGENTES (panier abandonné, tarif qui monte, clic sans achat)
               -- font exception : elles répondent à un geste du client.
               WHEN a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy') AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.status = 'queued' AND lower(l.email) = c.em
                    AND l.created_at > now() - interval '48 hours'
                    AND ((a.venue_id IS NOT NULL AND l.venue_id = a.venue_id)
                      OR (a.organizer_user_id IS NOT NULL AND l.organizer_user_id = a.organizer_user_id)
                      OR (v_platform AND l.venue_id IS NULL AND l.organizer_user_id IS NULL))
               ) THEN 'cooldown'
               -- Règles Yuno (pression, fatigue, aversion), tous expéditeurs.
               ELSE pol.reason
             END AS reason
        FROM cand c
        LEFT JOIN pol ON pol.email = c.em
    ),
    -- Cooldown INTRA-passage : plusieurs soirées dues en même temps pour un
    -- même contact (trois dates à J-3, six publications d'un coup) ne font
    -- qu'UN email — la plus proche ; les autres sont tracées « cooldown ».
    -- Les lignes insérées par une même instruction sont invisibles aux
    -- sous-requêtes du CASE ci-dessus, d'où ce second temps.
    judged AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE
               WHEN j.reason IS NULL AND a.kind NOT IN ('abandoned_checkout', 'tier_closing', 'click_no_buy')
                    AND row_number() OVER (PARTITION BY j.em, (j.reason IS NULL) ORDER BY j.ord NULLS LAST, j.trigger_key) > 1
                 THEN 'cooldown'
               ELSE j.reason
             END AS reason
        FROM judged0 j
    ),
    -- Yunits : seuls les v_room premiers envois dus entrent au registre ; les
    -- autres reviennent au passage suivant (après une recharge).
    -- « 10 % non contactés, pour mesurer l'effet réel » (20261013120000) :
    -- parmi ceux qui allaient recevoir la recette, AVANT le compte des Yunits.
    judged1 AS (
      SELECT j.em, j.trigger_key, j.trigger_event_id, j.bind_event_id, j.due_at,
             CASE WHEN j.reason IS NULL AND v_holdout > 0
                       AND public._crm_holdout_pick(a.id::text || ':' || j.trigger_key, j.em, v_holdout)
                  THEN 'holdout' ELSE j.reason END AS reason
        FROM judged j
    ),
    judged2 AS (
      SELECT j.*,
             CASE WHEN j.reason IS NULL
                  THEN row_number() OVER (PARTITION BY (j.reason IS NULL) ORDER BY j.due_at, j.em, j.trigger_key) END AS qn
        FROM judged1 j
    ),
    held AS (
      SELECT count(*)::integer AS n FROM judged2 j
       WHERE j.reason IS NULL AND v_room IS NOT NULL AND j.qn > v_room
    ),
    ins AS (
      INSERT INTO public.email_automation_sends
        (automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
         email, status, skip_reason, due_at)
      SELECT a.id, a.venue_id, a.organizer_user_id, a.kind, j.trigger_key, j.trigger_event_id, j.bind_event_id,
             j.em, CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason, j.due_at
        FROM judged2 j
       WHERE j.reason IS NOT NULL OR v_room IS NULL OR j.qn <= v_room
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT v_queued + count(*) FILTER (WHERE status = 'queued'), v_skipped + count(*) FILTER (WHERE status = 'skipped'),
           v_held + (SELECT h.n FROM held h)
      INTO v_queued, v_skipped, v_held FROM ins;

    -- ── 5c. Campagnes enfants ─────────────────────────────────────────────
    SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = a.template_id;
    IF tpl.id IS NULL THEN CONTINUE; END IF;

    FOR grp IN
      SELECT l.bind_event_id, l.trigger_event_id, count(*) AS n
        FROM public.email_automation_sends l
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
       GROUP BY l.bind_event_id, l.trigger_event_id
    LOOP
      SELECT c.id INTO v_child
        FROM public.email_campaigns c
       WHERE c.automation_id = a.id
         AND c.event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND c.automation_trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
         AND (grp.bind_event_id IS NOT NULL OR grp.trigger_event_id IS NOT NULL
              OR c.created_at >= date_trunc('month', now()))
         AND c.status NOT IN ('cancelled', 'failed')
       ORDER BY c.created_at DESC
       LIMIT 1;

      IF v_child IS NULL THEN
        SELECT COALESCE(e.title, '') INTO v_label
          FROM public.events e WHERE e.id = COALESCE(grp.trigger_event_id, grp.bind_event_id);
        IF v_label IS NULL OR v_label = '' THEN v_label := to_char(now(), 'YYYY-MM'); END IF;
        v_name := left(COALESCE(NULLIF(tpl.name, ''), a.kind) || ' · ' || v_label, 80);
        v_blocks := CASE WHEN grp.bind_event_id IS NULL
                         THEN public._email_blocks_without_live(tpl.blocks_json)
                         ELSE COALESCE(tpl.blocks_json, '[]'::jsonb) END;
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
           theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
           quiet_hours, automation_id, automation_trigger_event_id, child_kind, total_recipients, created_by)
        VALUES
          (a.venue_id, a.organizer_user_id, v_name, 'promotional',
           COALESCE(NULLIF(a.subject, ''), NULLIF(tpl.subject, ''), tpl.name), COALESCE(tpl.preheader, ''),
           v_blocks, 2,
           COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
           grp.bind_event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
           true, a.id, grp.trigger_event_id, 'automation', 0, COALESCE(a.created_by, tpl.created_by))
        RETURNING id INTO v_child;
      END IF;

      WITH todo AS (
        SELECT l.id, lower(l.email) AS em
          FROM public.email_automation_sends l
         WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
           AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
           AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
      ),
      ins AS (
        INSERT INTO public.email_campaign_recipients
          (campaign_id, email, first_name, last_name, unsubscribe_token, status)
        SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
          FROM todo t
          LEFT JOIN LATERAL (
            SELECT s.first_name, s.last_name, s.unsubscribe_token
              FROM public.newsletter_subscriptions s
             WHERE lower(s.email) = t.em
               AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
             LIMIT 1
          ) s ON true
        ON CONFLICT (campaign_id, lower(email)) DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO v_new FROM ins;

      UPDATE public.email_automation_sends l
         SET campaign_id = v_child
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
         AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id;

      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

      v_enqueued := v_enqueued + v_new;
      v_children := array_append(v_children, v_child);
      v_child := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'automations', v_automations, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children),
    'budget_hit', v_budget_hit,
    'yunits_held', v_held
  );
END;
$function$;

-- Effacement : l'adresse d'un destinataire SMS part avec le contact.
CREATE OR REPLACE FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emails text[];
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e))), '{}') INTO v_emails
    FROM unnest(p_emails) e WHERE e IS NOT NULL AND btrim(e) <> '';
  IF cardinality(v_emails) = 0 THEN RETURN 0; END IF;

  DELETE FROM public.crm_contact_notes WHERE scope_key = v_key AND lower(email) = ANY (v_emails);

  -- Analyse client (20261010110000) : profil et file de recalcul. L'exclusion
  -- du profilage (crm_profile_optouts), mémoire d'un refus, reste.
  DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_emails);
  -- « Chances de venir » (20261012100000, 20261013110000) : ses chances et
  -- leur journal partent avec lui.
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_emails);

  DELETE FROM public.crm_import_journal j
   USING public.crm_imports i
   WHERE i.list_import_id = j.list_import_id AND i.scope_key = v_key AND lower(j.email) = ANY (v_emails);

  DELETE FROM public.imported_contacts c
   WHERE ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
     AND lower(c.email) = ANY (v_emails);

  -- Un désabonnement reste : c'est la mémoire du refus.
  DELETE FROM public.newsletter_subscriptions ns
   WHERE ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
     AND lower(ns.email) = ANY (v_emails)
     AND ns.opted_in;

  DELETE FROM public.venue_sms_contacts vc
   WHERE ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
     AND lower(vc.email) = ANY (v_emails)
     AND NOT vc.unsubscribed;

  -- Les ventes de la billetterie connectée gardent leur montant, sans identité.
  UPDATE public.external_tickets t
     SET buyer_email = NULL, buyer_first_name = NULL, buyer_last_name = NULL, buyer_phone = NULL,
         buyer_ref = NULL, holder_email = NULL, holder_first_name = NULL, holder_last_name = NULL,
         raw = '{}'::jsonb
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND lower(t.buyer_email) = ANY (v_emails);

  DELETE FROM public.contact_engagement ce
   WHERE ((p_venue_id IS NOT NULL AND ce.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ce.organizer_user_id = p_organizer_user_id))
     AND lower(ce.email) = ANY (v_emails);

  -- L'adresse portée par un destinataire SMS (20261013120000) part aussi.
  UPDATE public.sms_campaign_recipients r
     SET email = NULL
    FROM public.sms_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
     AND lower(r.email) = ANY (v_emails);

  -- Les envois passés restent comptés, sous une adresse qui ne désigne plus personne.
  UPDATE public.email_campaign_recipients r
     SET email = 'erased-' || md5(lower(r.email)) || '@erased.invalid',
         first_name = NULL, last_name = NULL, user_id = NULL
    FROM public.email_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND r.status NOT IN ('pending', 'sending')
     AND lower(r.email) = ANY (v_emails);

  UPDATE public.email_campaign_events ev
     SET recipient_email = 'erased-' || md5(lower(ev.recipient_email)) || '@erased.invalid',
         metadata = ((COALESCE(ev.metadata, '{}'::jsonb) - 'to' - 'headers')
                     #- '{open,ipAddress}' #- '{open,userAgent}'
                     #- '{click,ipAddress}' #- '{click,userAgent}')
    FROM public.email_campaigns c
   WHERE c.id = ev.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND lower(ev.recipient_email) = ANY (v_emails);

  DELETE FROM public.contact_base_cache cb
   WHERE cb.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id)
     AND lower(cb.email) = ANY (v_emails);
  UPDATE public.contact_base_cache_state
     SET dirty_at = now()
   WHERE scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id);

  RETURN cardinality(v_emails);
END;
$$;

-- ── 4. Réglage et lecture ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_holdout_set(p_venue_id text, p_organizer_user_id uuid, p_pct integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_pct IS NULL OR p_pct < 0 OR p_pct > 30 THEN
    RAISE EXCEPTION 'invalid_pct' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.crm_settings (scope_key, venue_id, organizer_user_id, holdout_pct, updated_by, updated_at)
  VALUES (v_key, p_venue_id, p_organizer_user_id, p_pct, auth.uid(), now())
  ON CONFLICT (scope_key) DO UPDATE SET holdout_pct = EXCLUDED.holdout_pct, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('ok', true, 'pct', p_pct);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_holdout_set(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_holdout_set(text, uuid, integer) TO authenticated, service_role;

-- Le vrai gain des envois : acheteurs de la soirée visée dans le groupe
-- contacté contre le témoin, depuis le moment de l'envoi. Des NOMBRES ; le
-- front ne calcule un taux qu'à partir de 10 personnes par groupe.
CREATE OR REPLACE FUNCTION public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_from  timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 180), 1), 730));
  v_sends jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH grp AS (
    -- E-mails « Qui cibler »
    SELECT 'email'::text AS channel, c.id::text AS id, c.name AS label, c.event_id,
           min(r.created_at) AS t0, r.email,
           (r.status = 'skipped' AND r.error_message = 'holdout') AS ctl
      FROM public.email_campaigns c
      JOIN public.email_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.holdout_count > 0 AND c.event_id IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.created_at >= v_from
       AND (r.status NOT IN ('skipped', 'suppressed') OR r.error_message = 'holdout')
     GROUP BY c.id, c.name, c.event_id, r.email, r.status, r.error_message
    UNION ALL
    -- SMS « Qui cibler »
    SELECT 'sms', c.id::text, c.name, c.event_id, min(r.created_at), r.email,
           (r.status = 'skipped' AND r.error_code = 'holdout')
      FROM public.sms_campaigns c
      JOIN public.sms_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.holdout_count > 0 AND c.event_id IS NOT NULL AND r.email IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
       AND c.created_at >= v_from
       AND (r.status <> 'skipped' OR r.error_code = 'holdout')
     GROUP BY c.id, c.name, c.event_id, r.email, r.status, r.error_code
    UNION ALL
    -- Recettes
    SELECT 'recipe', a.kind, NULL, COALESCE(l.trigger_event_id, l.bind_event_id), l.created_at, lower(l.email),
           (l.status = 'skipped' AND l.skip_reason = 'holdout')
      FROM public.email_automation_sends l
      JOIN public.email_automations a ON a.id = l.automation_id
     WHERE l.venue_id IS NOT DISTINCT FROM p_venue_id AND l.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND l.created_at >= v_from AND COALESCE(l.trigger_event_id, l.bind_event_id) IS NOT NULL
       AND (l.status = 'queued' OR l.skip_reason = 'holdout')
       AND EXISTS (SELECT 1 FROM public.email_automation_sends h
                    WHERE h.automation_id = l.automation_id AND h.skip_reason = 'holdout')
  ), y AS (
    SELECT g.*, EXISTS (
             SELECT 1 FROM public.external_tickets t
              WHERE t.event_id = g.event_id AND lower(t.buyer_email) = lower(g.email)
                AND public._crm_ticket_is_sale(t.status, t.raw)
                AND COALESCE(t.purchased_at, t.first_seen_at) > g.t0) AS bought
      FROM grp g
  ), s AS (
    SELECT y.channel, y.id, max(y.label) AS label,
           CASE WHEN count(DISTINCT y.event_id) = 1 THEN (array_agg(y.event_id))[1] END AS event_id,
           count(*) FILTER (WHERE NOT y.ctl) AS n_c, count(*) FILTER (WHERE NOT y.ctl AND y.bought) AS b_c,
           count(*) FILTER (WHERE y.ctl) AS n_h, count(*) FILTER (WHERE y.ctl AND y.bought) AS b_h,
           min(y.t0) AS sent_at,
           bool_and(EXISTS (SELECT 1 FROM public.events e WHERE e.id = y.event_id AND e.start_at < now())) AS done,
           count(DISTINCT y.event_id) AS nights
      FROM y GROUP BY y.channel, y.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'channel', s.channel, 'id', s.id, 'label', s.label, 'event_id', s.event_id,
           'sent_at', s.sent_at, 'done', s.done, 'nights', s.nights,
           'contacted', jsonb_build_object('n', s.n_c, 'buyers', s.b_c),
           'control', jsonb_build_object('n', s.n_h, 'buyers', s.b_h),
           -- Acheteurs en plus = contactés × (taux contacté − taux témoin) ;
           -- z du test de deux proportions (≥ 2 : différence nette).
           'extra', CASE WHEN s.n_c >= 10 AND s.n_h >= 10
                         THEN round(s.n_c * (s.b_c::numeric / s.n_c - s.b_h::numeric / s.n_h), 1) END,
           'z', CASE WHEN s.n_c >= 10 AND s.n_h >= 10 AND (s.b_c + s.b_h) > 0 AND (s.b_c + s.b_h) < (s.n_c + s.n_h) THEN round((
                  (s.b_c::numeric / s.n_c - s.b_h::numeric / s.n_h)
                  / sqrt(((s.b_c + s.b_h)::numeric / (s.n_c + s.n_h)) * (1 - (s.b_c + s.b_h)::numeric / (s.n_c + s.n_h))
                         * (1.0 / s.n_c + 1.0 / s.n_h)))::numeric, 2) END)
         ORDER BY s.sent_at DESC), '[]'::jsonb)
    INTO v_sends FROM s;

  RETURN jsonb_build_object('pct', public.crm_holdout_pct(v_key), 'sends', v_sends);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_holdout_overview(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_holdout_overview(text, uuid, integer) TO authenticated, service_role;

-- Le réglage seul (Réglages, fenêtre « Écrire à… ») : sans la mesure.
CREATE OR REPLACE FUNCTION public.crm_holdout_settings(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'pct', public.crm_holdout_pct(public.crm_scope_key(p_venue_id, p_organizer_user_id)),
    'can_edit', COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_holdout_settings(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_holdout_settings(text, uuid) TO authenticated, service_role;
