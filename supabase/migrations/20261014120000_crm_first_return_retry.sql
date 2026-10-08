-- ============================================================================
-- Yuno CRM — « Faire revenir après la 1re soirée » : un SMS bloqué faute de
-- Yunits attend, il ne se perd plus (2026-10-14). Plan :
-- docs/designs/CRM_ANALYSIS_OPTIMIZE_PLAN.md (lot 4). Décision de Paul (08/10) :
-- la carte dit « 12 SMS en attente de Yunits », et « 12 SMS non envoyés
-- (fenêtre passée) » pour ceux qui ne partiront plus.
--
-- Avant : le collecteur écrivait le registre crm_first_return_sms dès le
-- brouillon SMS ; quand send-sms-campaign trouvait un solde insuffisant, la
-- campagne retombait en brouillon (`crm_yunits_insufficient`) et le registre
-- empêchait toute nouvelle tentative : ces personnes ne recevaient jamais le
-- SMS, sans que personne ne le voie. La carte comptait les inscrits au
-- registre comme « envoyés ».
--
-- Désormais, à chaque passage (toutes les 30 min) :
--   • une campagne de la recette retombée faute de Yunits garde ceux dont la
--     fenêtre est encore ouverte (e-mail parti il y a moins de délai + 3
--     jours), soirée pas commencée, toujours sans place, numéro joignable ;
--     les autres sont marqués expired_at et retirés de la file ;
--   • elle repart (« programmée ») dès que crm_yunits_balance couvre ceux qui
--     restent (35 / 70 Yunits par segment, crm_sms_rates) ; vide, elle est
--     annulée ;
--   • la carte lit sent (partis vraiment), waiting, expired ;
--   • une recette en erreur (ex. sans auteur : repli sur l'organisateur ou le
--     propriétaire du club) ne fait plus tomber la collecte des autres comptes.
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs).
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.crm_first_return_sms ADD COLUMN IF NOT EXISTS expired_at timestamptz;

-- ── 1. Le collecteur : reprendre ce qui attend ───────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_first_return_sms_collect()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a        record;
  g        record;
  v_scope  text;
  v_cid    uuid;
  v_n      integer;
  v_total  integer := 0;
  v_camps  integer := 0;
  w        record;
  v_left   integer;
  v_fr     integer;
  v_rates  jsonb := public.crm_sms_rates();
  v_retried integer := 0;
  v_expired integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR a IN
    SELECT x.* FROM public.email_automations x
     WHERE x.kind = 'first_return' AND x.enabled AND x.sms_enabled
       AND NULLIF(btrim(COALESCE(x.sms_body, '')), '') IS NOT NULL
  LOOP
   -- Une recette en erreur ne fait jamais tomber la collecte des autres comptes.
   BEGIN
    CONTINUE WHEN public.is_demo_marketing_scope(a.venue_id, a.organizer_user_id);
    v_scope := public.crm_scope_key(a.venue_id, a.organizer_user_id);
    CONTINUE WHEN public.crm_effective_plan(v_scope) = 'paused';
    CONTINUE WHEN NOT COALESCE((public.get_sms_sender_readiness(a.venue_id, a.organizer_user_id)->>'identity_ok')::boolean, false);

    -- Étape SMS retombée en brouillon faute de Yunits (20261014120000) : rien
    -- n'est parti. Chaque personne attend tant que sa fenêtre est ouverte
    -- (e-mail parti il y a moins de « délai + 3 » jours), que la soirée n'a pas
    -- commencé, qu'elle n'a pas pris de place et que son numéro reste
    -- joignable ; sinon elle ne partira plus (expired_at, « non envoyés »). La
    -- campagne repart seule dès que le solde couvre ceux qui restent.
    FOR w IN
      SELECT c.id, c.event_id, c.segments_per_message FROM public.sms_campaigns c
       WHERE c.status = 'draft' AND c.error_message = 'crm_yunits_insufficient'
         AND c.segment_filters->>'automation_id' = a.id::text
    LOOP
      UPDATE public.crm_first_return_sms s SET expired_at = now()
       WHERE s.automation_id = a.id AND s.campaign_id = w.id AND s.expired_at IS NULL
         AND (NOT EXISTS (
                SELECT 1 FROM public.email_automation_sends l
                  JOIN public.email_campaign_recipients r ON r.campaign_id = l.campaign_id AND lower(r.email) = lower(l.email)
                 WHERE l.automation_id = a.id AND l.trigger_key = 'fr' AND lower(l.email) = s.email
                   AND r.sent_at > now() - make_interval(days => a.sms_delay_days + 3))
           OR NOT EXISTS (SELECT 1 FROM public.events e
                           WHERE e.id = w.event_id AND e.cancelled_at IS NULL AND e.start_at > now() + interval '3 hours')
           OR EXISTS (SELECT 1 FROM public.events ev
                       WHERE ev.start_at > now() AND ev.cancelled_at IS NULL
                         AND ((a.venue_id IS NOT NULL AND ev.venue_id = a.venue_id)
                           OR (a.organizer_user_id IS NOT NULL AND ev.organizer_user_id = a.organizer_user_id))
                         AND public._email_event_holder(ev.id, s.email))
           OR EXISTS (SELECT 1 FROM public.sms_stop_list st
                       WHERE st.phone_e164 = s.phone_e164 AND (st.scope_key IS NULL OR st.scope_key = v_scope)));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_expired := v_expired + v_n;
      DELETE FROM public.sms_campaign_recipients q
       WHERE q.campaign_id = w.id AND q.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM public.crm_first_return_sms s
                          WHERE s.campaign_id = w.id AND s.phone_e164 = q.phone_e164 AND s.expired_at IS NULL);
      SELECT count(*), count(*) FILTER (WHERE q.phone_e164 LIKE '+33%') INTO v_left, v_fr
        FROM public.sms_campaign_recipients q WHERE q.campaign_id = w.id AND q.status = 'pending';
      IF v_left = 0 THEN
        UPDATE public.sms_campaigns SET status = 'cancelled', error_message = 'first_return_window_closed'
         WHERE id = w.id AND status = 'draft';
      ELSIF public.crm_yunits_balance(v_scope) >= GREATEST(1, COALESCE(w.segments_per_message, 1))
              * (v_fr * (v_rates->>'fr')::integer + (v_left - v_fr) * (v_rates->>'intl')::integer) THEN
        UPDATE public.sms_campaigns SET status = 'scheduled', scheduled_at = now(), error_message = NULL,
               total_recipients = v_left, estimated_recipients = v_left, estimated_credits = v_left
         WHERE id = w.id AND status = 'draft';
        v_retried := v_retried + v_left;
      END IF;
    END LOOP;

    DROP TABLE IF EXISTS _frs;
    CREATE TEMP TABLE _frs ON COMMIT DROP AS
    WITH sent AS (
      -- L'e-mail est PARTI il y a N jours (fenêtre de 3 jours : rien en retard).
      SELECT DISTINCT ON (lower(l.email)) lower(l.email) AS em, c.event_id, r.first_name, r.last_name
        FROM public.email_automation_sends l
        JOIN public.email_campaigns c ON c.id = l.campaign_id
        JOIN public.email_campaign_recipients r ON r.campaign_id = c.id AND lower(r.email) = lower(l.email)
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.trigger_key = 'fr'
         AND r.sent_at IS NOT NULL
         AND r.sent_at <= now() - make_interval(days => a.sms_delay_days)
         AND r.sent_at > now() - make_interval(days => a.sms_delay_days + 3)
         AND c.event_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.crm_first_return_sms s WHERE s.automation_id = a.id AND s.email = lower(l.email))
       ORDER BY lower(l.email), r.sent_at DESC
    )
    SELECT s.em, s.event_id, s.first_name, s.last_name, ph.phone_e164
      FROM sent s
      JOIN public.events e ON e.id = s.event_id AND e.cancelled_at IS NULL AND e.start_at > now() + interval '3 hours'
      JOIN LATERAL (
        SELECT vc.phone_e164 FROM public.venue_sms_contacts vc
         WHERE lower(vc.email) = s.em
           AND ((a.venue_id IS NOT NULL AND vc.venue_id = a.venue_id)
             OR (a.organizer_user_id IS NOT NULL AND vc.organizer_user_id = a.organizer_user_id))
           AND NOT COALESCE(vc.unsubscribed, false)
           AND vc.sms_consent_at > now() - interval '36 months'
           AND vc.phone_e164 ~ '^\+[1-9][0-9]{6,14}$'
         ORDER BY vc.sms_consent_at DESC LIMIT 1
      ) ph ON true
     -- Toujours sans place : ni pour cette soirée, ni pour une autre à venir.
     WHERE NOT EXISTS (
             SELECT 1 FROM public.events ev
              WHERE ev.start_at > now() AND ev.cancelled_at IS NULL
                AND ((a.venue_id IS NOT NULL AND ev.venue_id = a.venue_id)
                  OR (a.organizer_user_id IS NOT NULL AND ev.organizer_user_id = a.organizer_user_id))
                AND public._email_event_holder(ev.id, s.em))
       AND NOT EXISTS (SELECT 1 FROM public.sms_stop_list st
                        WHERE st.phone_e164 = ph.phone_e164 AND (st.scope_key IS NULL OR st.scope_key = v_scope))
       AND public.sms_tariff_zone(ph.phone_e164) <> 'blocked';

    FOR g IN SELECT f.event_id, ev.title, count(*) AS n FROM _frs f JOIN public.events ev ON ev.id = f.event_id GROUP BY 1, 2 LOOP
      INSERT INTO public.sms_campaigns (venue_id, organizer_id, created_by, name, body_template, segment_filters, status,
                                        event_id, quiet_hours, estimated_recipients, segments_per_message, estimated_credits)
      VALUES (a.venue_id, CASE WHEN a.venue_id IS NULL THEN a.organizer_user_id END,
              COALESCE(a.created_by, a.organizer_user_id, (SELECT v.owner_id FROM public.venues v WHERE v.id = a.venue_id)),
              left('Faire revenir après la 1re soirée · ' || COALESCE(g.title, ''), 120),
              a.sms_body, jsonb_build_object('type', 'crm', 'automation', 'first_return', 'automation_id', a.id),
              'draft', g.event_id, true, g.n, 1, g.n)
      RETURNING id INTO v_cid;
      INSERT INTO public.sms_campaign_recipients (campaign_id, phone_e164, full_name, first_name)
      SELECT v_cid, f.phone_e164, NULLIF(btrim(COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')), ''), f.first_name
        FROM (SELECT DISTINCT ON (phone_e164) * FROM _frs WHERE event_id = g.event_id ORDER BY phone_e164, em) f
      ON CONFLICT (campaign_id, phone_e164) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      INSERT INTO public.crm_first_return_sms (automation_id, email, phone_e164, event_id, campaign_id)
      SELECT a.id, f.em, f.phone_e164, f.event_id, v_cid FROM _frs f WHERE f.event_id = g.event_id
      ON CONFLICT DO NOTHING;
      UPDATE public.sms_campaigns SET status = 'scheduled', scheduled_at = now(), total_recipients = v_n,
             estimated_recipients = v_n, estimated_credits = v_n
       WHERE id = v_cid;
      v_total := v_total + v_n;
      v_camps := v_camps + 1;
    END LOOP;
   EXCEPTION WHEN others THEN
    RAISE WARNING 'crm_first_return_sms_collect (%): %', a.id, SQLERRM;
   END;
  END LOOP;
  RETURN jsonb_build_object('campaigns', v_camps, 'recipients', v_total, 'retried', v_retried, 'expired', v_expired);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_first_return_sms_collect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_first_return_sms_collect() TO service_role;

-- ── 2. La carte de la recette : partis, en attente, non envoyés ──────────────
CREATE OR REPLACE FUNCTION public.crm_automations__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n int := CASE WHEN p_period = '90d' THEN 13 ELSE 5 END;
  v_now timestamptz := now();
  v_from timestamptz;
  v_pfrom timestamptz;
  v_kinds text[] := ARRAY['new_event', 'last_call', 'click_no_buy', 'post_event_thanks', 'post_event_missed', 'first_return', 'regular_lapse', 'win_back'];
  v_recipes jsonb; v_weeks jsonb; v_tot jsonb; v_prev jsonb; v_feed jsonb; v_sug jsonb;
  v_limit jsonb; v_base int; v_active int;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := v_now - make_interval(days => v_n * 7);
  v_pfrom := v_from - make_interval(days => v_n * 7);

  -- Clics et achats rattachés (règle des résultats d'e-mail : billet acheté
  -- sous 7 jours après un clic, rattaché au dernier clic).
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _xa;
  CREATE TEMP TABLE _xa ON COMMIT DROP AS
  SELECT a.* FROM public.email_automations a
   WHERE a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND a.kind = ANY (v_kinds);

  -- Campagnes enfants des recettes.
  DROP TABLE IF EXISTS _xc;
  CREATE TEMP TABLE _xc ON COMMIT DROP AS
  SELECT c.id, a.kind, c.subject FROM public.email_campaigns c JOIN _xa a ON a.id = c.automation_id;

  DROP TABLE IF EXISTS _xr;
  CREATE TEMP TABLE _xr ON COMMIT DROP AS
  SELECT r.campaign_id, c.kind, lower(r.email) AS email, r.sent_at, r.first_name, r.last_name
    FROM public.email_campaign_recipients r JOIN _xc c ON c.id = r.campaign_id
   WHERE r.status IN ('sent', 'complained') AND r.sent_at IS NOT NULL;
  CREATE INDEX ON _xr (kind, sent_at);

  DROP TABLE IF EXISTS _xk;
  CREATE TEMP TABLE _xk ON COMMIT DROP AS
  SELECT k.campaign_id, c.kind, k.email, k.at FROM _cmk k JOIN _xc c ON c.id = k.campaign_id;

  DROP TABLE IF EXISTS _xb;
  CREATE TEMP TABLE _xb ON COMMIT DROP AS
  SELECT m.id, m.email, m.amount, m.bought_at, c.kind FROM _cma m JOIN _xc c ON c.id = m.campaign_id;

  SELECT jsonb_agg(jsonb_build_object(
           'kind', k.kind, 'id', a.id, 'enabled', COALESCE(a.enabled, false), 'enabled_at', a.enabled_at,
           'updated_at', a.updated_at, 'delay_hours', a.delay_hours, 'subject', a.subject, 'template_id', a.template_id,
           'template_name', tpl.name, 'template_subject', tpl.subject,
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_from),
           'sent', (SELECT count(*) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.kind = k.kind AND x.at >= v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.kind = k.kind AND b.bought_at >= v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.kind = k.kind AND b.bought_at >= v_from),
           'all', jsonb_build_object(
             'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.kind = k.kind),
             'purchases', (SELECT count(*) FROM _xb b WHERE b.kind = k.kind),
             'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.kind = k.kind)),
           -- Envois des 13 dernières semaines (la plus ancienne d'abord).
           'weekly', (SELECT jsonb_agg((SELECT count(*) FROM _xr r WHERE r.kind = k.kind
                                         AND r.sent_at >= v_now - make_interval(days => (13 - g) * 7)
                                         AND r.sent_at < v_now - make_interval(days => (12 - g) * 7)) ORDER BY g)
                        FROM generate_series(0, 12) g),
           -- Rythme d'envoi des 4 dernières semaines : ce qu'elle consomme.
           'week_avg', (SELECT round(count(*) / 4.0, 1) FROM _xr r WHERE r.kind = k.kind AND r.sent_at >= v_now - interval '28 days'),
           'last_sent_at', (SELECT max(r.sent_at) FROM _xr r WHERE r.kind = k.kind),
           'pending', CASE WHEN a.id IS NULL THEN 0 ELSE
             (SELECT count(*) FROM public.email_automation_sends l WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL)
             + (SELECT count(*) FROM public.email_campaign_recipients q JOIN _xc c ON c.id = q.campaign_id WHERE c.kind = k.kind AND q.status = 'pending') END,
           'skipped', CASE WHEN a.id IS NULL THEN 0 ELSE
             (SELECT count(*) FROM public.email_automation_sends l WHERE l.automation_id = a.id AND l.status = 'skipped' AND l.created_at >= v_from) END,
           'preview', public._email_automation_preview(p_venue_id, p_organizer_user_id, k.kind),
           -- « Faire revenir après la 1re soirée » : délai calé sur le compte et étape SMS.
           'auto_delay_days', CASE WHEN k.kind = 'first_return' THEN public._first_return_delay_days(p_venue_id, p_organizer_user_id) END,
           'sms', CASE WHEN k.kind = 'first_return' THEN jsonb_build_object(
             'enabled', COALESCE(a.sms_enabled, false), 'body', a.sms_body, 'delay_days', COALESCE(a.sms_delay_days, 5),
             -- Partis vraiment (20261014120000) ; en attente de Yunits ; non
             -- envoyés, la fenêtre passée.
             'sent', (SELECT count(*) FROM public.crm_first_return_sms s
                        JOIN public.sms_campaign_recipients q ON q.campaign_id = s.campaign_id AND q.phone_e164 = s.phone_e164
                       WHERE s.automation_id = a.id AND s.created_at >= v_from
                         AND q.status IN ('sent', 'delivered', 'undelivered')),
             'waiting', (SELECT count(*) FROM public.crm_first_return_sms s
                           JOIN public.sms_campaigns c ON c.id = s.campaign_id
                          WHERE s.automation_id = a.id AND s.expired_at IS NULL
                            AND c.status = 'draft' AND c.error_message = 'crm_yunits_insufficient'),
             'expired', (SELECT count(*) FROM public.crm_first_return_sms s
                          WHERE s.automation_id = a.id AND s.expired_at >= v_from),
             'identity_ok', COALESCE((public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id)->>'identity_ok')::boolean, false)) END
         ) ORDER BY k.ord)
    INTO v_recipes
    FROM unnest(v_kinds) WITH ORDINALITY k(kind, ord)
    LEFT JOIN _xa a ON a.kind = k.kind
    LEFT JOIN public.email_campaign_templates tpl ON tpl.id = a.template_id;

  -- Une case par semaine, la plus ancienne d'abord (la dernière est en cours).
  SELECT jsonb_agg(jsonb_build_object(
           'start', v_now - make_interval(days => (v_n - g) * 7),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b
                        WHERE b.bought_at >= v_now - make_interval(days => (v_n - g) * 7)
                          AND b.bought_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'purchases', (SELECT count(*) FROM _xb b
                          WHERE b.bought_at >= v_now - make_interval(days => (v_n - g) * 7)
                            AND b.bought_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'sent', (SELECT count(*) FROM _xr r
                     WHERE r.sent_at >= v_now - make_interval(days => (v_n - g) * 7)
                       AND r.sent_at < v_now - make_interval(days => (v_n - g - 1) * 7)),
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r
                          WHERE r.sent_at >= v_now - make_interval(days => (v_n - g) * 7)
                            AND r.sent_at < v_now - make_interval(days => (v_n - g - 1) * 7))
         ) ORDER BY g)
    INTO v_weeks FROM generate_series(0, v_n - 1) g;

  SELECT jsonb_build_object(
           'sent', (SELECT count(*) FROM _xr r WHERE r.sent_at >= v_from),
           'contacted', (SELECT count(DISTINCT r.email) FROM _xr r WHERE r.sent_at >= v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.at >= v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.bought_at >= v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.bought_at >= v_from),
           'recipes', (SELECT count(DISTINCT r.kind) FROM _xr r WHERE r.sent_at >= v_from))
    INTO v_tot;
  SELECT jsonb_build_object(
           'sent', (SELECT count(*) FROM _xr r WHERE r.sent_at >= v_pfrom AND r.sent_at < v_from),
           'clicked', (SELECT count(DISTINCT (x.campaign_id, x.email)) FROM _xk x WHERE x.at >= v_pfrom AND x.at < v_from),
           'purchases', (SELECT count(*) FROM _xb b WHERE b.bought_at >= v_pfrom AND b.bought_at < v_from),
           'revenue', (SELECT round(COALESCE(sum(b.amount), 0), 2) FROM _xb b WHERE b.bought_at >= v_pfrom AND b.bought_at < v_from))
    INTO v_prev;

  -- Les derniers envois : prénom et initiale seulement.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'first_name', NULLIF(trim(f.first_name), ''),
           'last_initial', upper(left(NULLIF(trim(f.last_name), ''), 1)),
           'kind', f.kind, 'subject', f.subject, 'at', f.sent_at) ORDER BY f.sent_at DESC), '[]'::jsonb)
    INTO v_feed
    FROM (SELECT x.first_name, x.last_name, x.kind, x.sent_at, x.subject
            FROM (SELECT r.first_name, r.last_name, r.kind, r.sent_at, c.subject,
                         row_number() OVER (PARTITION BY r.campaign_id ORDER BY r.sent_at DESC) AS rn
                    FROM _xr r JOIN _xc c ON c.id = r.campaign_id) x
           -- Deux lignes par envoi au plus : un lot du matin ne cache pas les autres recettes.
           WHERE x.rn <= 2
           ORDER BY x.sent_at DESC LIMIT 8) f;

  -- Ce que le moteur propose d'allumer (recettes éteintes, faits des 30 j).
  SELECT COALESCE(jsonb_agg(s.value) FILTER (WHERE s.value->>'kind' = ANY (v_kinds)), '[]'::jsonb)
    INTO v_sug
    FROM jsonb_array_elements(public._email_automation_suggestions(p_venue_id, p_organizer_user_id)) s;

  v_limit := public.crm_scope_limits(public.crm_scope_key(p_venue_id, p_organizer_user_id))->'automations';
  SELECT count(*) INTO v_active FROM _xa WHERE enabled;
  SELECT count(*) INTO v_base FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  RETURN jsonb_build_object(
    'period', CASE WHEN p_period = '90d' THEN '90d' ELSE '30d' END, 'weeks_n', v_n, 'from', v_from, 'now', v_now,
    'recipes', COALESCE(v_recipes, '[]'::jsonb), 'weeks', COALESCE(v_weeks, '[]'::jsonb),
    'totals', v_tot, 'prev', v_prev, 'feed', v_feed, 'suggestions', v_sug,
    'limit', CASE WHEN v_limit IS NULL OR v_limit = 'null'::jsonb THEN NULL ELSE v_limit END, 'active', v_active, 'base', v_base,
    'has_connection', EXISTS (SELECT 1 FROM public.ticketing_connections tc
                               WHERE (p_venue_id IS NOT NULL AND tc.venue_id = p_venue_id)
                                  OR (p_organizer_user_id IS NOT NULL AND tc.organizer_user_id = p_organizer_user_id))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_automations__core(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_automations__core(text, uuid, text) TO service_role;
