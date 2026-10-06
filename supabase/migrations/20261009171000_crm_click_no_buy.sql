-- Yuno CRM : la recette « A cliqué sans acheter » (2026-10-06, décision de Paul).
--
-- Un clic dans un e-mail est NOMINATIF : on sait quelle adresse a cliqué, et
-- vers quelle soirée (le bouton d'un e-mail CRM part sur la page Shotgun de la
-- soirée, `…?utm_source=yuno-m-<campagne>`). Shotgun rend l'e-mail de chaque
-- acheteur. « A cliqué, et aucune place à la même adresse N h après » est donc
-- une MESURE Yuno, pas une estimation. Une visite venue d'ailleurs (Instagram,
-- bio, lien de partage /go/) reste anonyme et n'entre jamais ici : c'est ce
-- qui distingue cette recette de la carte « Page visitée » (« Bientôt », elle
-- attend l'intégration partenaire Shotgun).
--
-- Règles : délai 6 / 12 / 24 / 48 h après le DERNIER clic (24 h par défaut :
-- la billetterie est relue toutes les 5 à 10 min) ; une relance par personne
-- et par soirée ; jamais à qui a une place à la même adresse (billet Shotgun,
-- billet Yuno, table, guest list), jugé au moment où l'envoi est dû ; jamais
-- dans les 2 h avant la soirée ; une relance due depuis plus de 24 h ne part
-- plus. À l'allumage, les clics des dernières (délai + 24 h) sont repris —
-- c'est ce que l'aperçu annonce, et une intention si fraîche n'est pas « toute
-- la base existante » que `enabled_at` protège ailleurs. Famille URGENTE,
-- comme le panier abandonné : palier de pression 2 / 24 h · 5 / 7 j, hors
-- cooldown de 48 h entre recettes — c'est une réponse à un geste du client.
-- Aussi : _email_event_holder compte une table « confirmed » (comme le moteur).

ALTER TABLE public.email_automations DROP CONSTRAINT email_automations_kind_check;
ALTER TABLE public.email_automations ADD CONSTRAINT email_automations_kind_check CHECK ((kind = ANY (ARRAY[
  'welcome'::text, 'abandoned_checkout'::text, 'last_call'::text, 'post_event_thanks'::text, 'post_event_missed'::text,
  'win_back'::text, 'table_upsell'::text, 'tier_closing'::text, 'new_event'::text, 'regular_lapse'::text, 'click_no_buy'::text])));

-- Base d'une URL de billetterie, pour comparer un lien cliqué à la page d'une
-- soirée : minuscules, sans schéma ni « www. », sans paramètres ni ancre, sans
-- « / » final. « …/events/nuit-1 » ≠ « …/events/nuit-19 ».
CREATE OR REPLACE FUNCTION public._link_base(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT NULLIF(rtrim(regexp_replace(regexp_replace(lower(btrim(COALESCE(p_url, ''))), '^https?://(www\.)?', ''), '[?#].*$', ''), '/'), '');
$function$;
REVOKE ALL ON FUNCTION public._link_base(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._link_base(text) TO service_role;

-- ── Règles d'envoi : « A cliqué sans acheter » est URGENTE (les deux formes) ─
CREATE OR REPLACE FUNCTION public.email_send_policy(p_email text, p_kind text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  v_tier text;
  v_cap24 integer;
  v_cap7 integer;
BEGIN
  IF p_email IS NULL OR position('@' in p_email) <= 1 THEN RETURN 'suppressed'; END IF;
  IF public.is_email_suppressed(p_email) THEN RETURN 'suppressed'; END IF;

  v_tier := CASE
    WHEN p_kind IN ('campaign', 'resend') THEN 'campaign'
    WHEN p_kind IN ('abandoned_checkout', 'upsell', 'tier_closing', 'click_no_buy') THEN 'urgent'
    ELSE 'automation' END;
  v_cap24 := CASE v_tier WHEN 'campaign' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END;
  v_cap7  := CASE v_tier WHEN 'campaign' THEN 8 WHEN 'urgent' THEN 5 ELSE 3 END;

  SELECT * INTO s FROM public.email_marketing_pressure(p_email);

  IF s.sent90 >= 8 AND NOT s.engaged90 THEN RETURN 'fatigue'; END IF;
  IF v_tier <> 'campaign' AND s.optouts30 >= 2 THEN RETURN 'averse'; END IF;
  IF s.n24 >= v_cap24 THEN RETURN 'pressure_24h'; END IF;
  IF s.n7d >= v_cap7 THEN RETURN 'pressure_7d'; END IF;
  RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public._email_send_policy_many(p_emails text[], p_kind text)
 RETURNS TABLE(email text, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) AS x WHERE x IS NOT NULL
  ),
  cfg AS (
    SELECT k.tier,
           CASE k.tier WHEN 'campaign' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END AS cap24,
           CASE k.tier WHEN 'campaign' THEN 8 WHEN 'urgent' THEN 5 ELSE 3 END AS cap7
      FROM (SELECT CASE
              WHEN p_kind IN ('campaign', 'resend') THEN 'campaign'
              WHEN p_kind IN ('abandoned_checkout', 'upsell', 'tier_closing', 'click_no_buy') THEN 'urgent'
              ELSE 'automation' END AS tier) k
  ),
  sends AS (
    SELECT lower(r.email) AS em, r.sent_at
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
     WHERE r.status = 'sent' AND r.sent_at > now() - interval '90 days'
       AND COALESCE(c.type, 'promotional') = 'promotional'
       AND lower(r.email) IN (SELECT em FROM e)
    UNION ALL
    SELECT lower(l.email), l.sent_at
      FROM public.marketing_email_log l
     WHERE l.sent_at > now() - interval '90 days'
       AND lower(l.email) IN (SELECT em FROM e)
  ),
  agg AS (
    SELECT s.em,
           count(*) FILTER (WHERE s.sent_at > now() - interval '24 hours') AS n24,
           count(*) FILTER (WHERE s.sent_at > now() - interval '7 days') AS n7d,
           count(*) AS sent90
      FROM sends s
     GROUP BY s.em
  ),
  eng AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM e)
  ),
  oo AS (
    SELECT lower(s.email) AS em, count(*) AS n
      FROM public.newsletter_subscriptions s
     WHERE s.opted_out_at > now() - interval '30 days'
       AND lower(s.email) IN (SELECT em FROM e)
     GROUP BY lower(s.email)
  ),
  sup AS (
    SELECT DISTINCT lower(s.email) AS em
      FROM public.email_suppressions s
     WHERE lower(s.email) IN (SELECT em FROM e)
  )
  SELECT e.em,
         CASE
           WHEN position('@' in e.em) <= 1 THEN 'suppressed'
           WHEN sup.em IS NOT NULL THEN 'suppressed'
           WHEN COALESCE(a.sent90, 0) >= 8 AND eng.em IS NULL THEN 'fatigue'
           WHEN cfg.tier <> 'campaign' AND COALESCE(oo.n, 0) >= 2 THEN 'averse'
           WHEN COALESCE(a.n24, 0) >= cfg.cap24 THEN 'pressure_24h'
           WHEN COALESCE(a.n7d, 0) >= cfg.cap7 THEN 'pressure_7d'
         END
    FROM e
    CROSS JOIN cfg
    LEFT JOIN agg a ON a.em = e.em
    LEFT JOIN eng ON eng.em = e.em
    LEFT JOIN oo ON oo.em = e.em
    LEFT JOIN sup ON sup.em = e.em;
$function$;

CREATE OR REPLACE FUNCTION public._email_event_holder(p_event_id uuid, p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tickets t
                  WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(p_email))
      OR EXISTS (SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = p_event_id AND r.status IN ('paid', 'confirmed', 'used') AND lower(r.user_email) = lower(p_email))
      OR EXISTS (SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = p_event_id AND lower(ge.email) = lower(p_email)
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected'))
      OR EXISTS (SELECT 1 FROM public.external_tickets xt
                  WHERE xt.event_id = p_event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = lower(p_email));
$function$;

-- ── Réglage d'une recette CRM ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_automation_save(p_venue_id text, p_organizer_user_id uuid, p_kind text, p_enabled boolean DEFAULT NULL::boolean, p_delay_hours integer DEFAULT NULL::integer, p_subject text DEFAULT NULL::text, p_template_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.email_automations%ROWTYPE;
  v_allowed int[];
  v_default int;
BEGIN
  IF NOT public.crm_scope_writable(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Les délais proposés par l'écran (AUTOMATION_META, en heures).
  CASE p_kind
    WHEN 'new_event' THEN v_allowed := ARRAY[2, 6, 24]; v_default := 6;
    WHEN 'last_call' THEN v_allowed := ARRAY[12, 24, 48, 72]; v_default := 24;
    WHEN 'click_no_buy' THEN v_allowed := ARRAY[6, 12, 24, 48]; v_default := 24;
    WHEN 'post_event_thanks' THEN v_allowed := ARRAY[6, 12, 24, 48]; v_default := 12;
    WHEN 'post_event_missed' THEN v_allowed := ARRAY[12, 24, 48, 72]; v_default := 24;
    WHEN 'regular_lapse' THEN v_allowed := ARRAY[672, 1008, 1344]; v_default := 1008;
    WHEN 'win_back' THEN v_allowed := ARRAY[1080, 1440, 2160, 2880]; v_default := 2160;
    ELSE RAISE EXCEPTION 'bad_kind' USING ERRCODE = '22023';
  END CASE;
  IF p_delay_hours IS NOT NULL AND NOT (p_delay_hours = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'bad_delay' USING ERRCODE = '22023';
  END IF;
  IF p_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.email_campaign_templates t
     WHERE t.id = p_template_id
       AND t.venue_id IS NOT DISTINCT FROM p_venue_id AND t.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ) THEN
    RAISE EXCEPTION 'bad_template' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.email_automations a
   WHERE a.kind = p_kind
     AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    INSERT INTO public.email_automations (venue_id, organizer_user_id, kind, enabled, delay_hours, subject, template_id, created_by)
    VALUES (p_venue_id, p_organizer_user_id, p_kind, false, COALESCE(p_delay_hours, v_default),
            NULLIF(trim(p_subject), ''), p_template_id, auth.uid())
    RETURNING * INTO v_row;
  END IF;

  UPDATE public.email_automations a
     SET delay_hours = COALESCE(p_delay_hours, a.delay_hours),
         subject = CASE WHEN p_subject IS NULL THEN a.subject ELSE NULLIF(trim(p_subject), '') END,
         template_id = COALESCE(p_template_id, a.template_id),
         enabled = COALESCE(p_enabled, a.enabled)
   WHERE a.id = v_row.id
  RETURNING * INTO v_row;
  IF v_row.enabled AND v_row.template_id IS NULL THEN
    RAISE EXCEPTION 'template_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN to_jsonb(v_row) - 'created_by';
END;
$function$;

-- ── Écran Automatisations du CRM ─────────────────────────────────────────
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
  v_kinds text[] := ARRAY['new_event', 'last_call', 'click_no_buy', 'post_event_thanks', 'post_event_missed', 'regular_lapse', 'win_back'];
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
           'preview', public._email_automation_preview(p_venue_id, p_organizer_user_id, k.kind)
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

-- ── Moteur : la recette « A cliqué sans acheter » ─────────────────────────
CREATE OR REPLACE FUNCTION public.collect_email_automations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
                WHEN 'regular_lapse' THEN 7 WHEN 'welcome' THEN 8 ELSE 9 END,
              x.created_at
  LOOP
    v_platform := a.is_platform;
    -- Les recettes de SOIRÉE n'ont pas de sens à l'échelle de Yuno : pas de
    -- dernier appel, d'annonce, de palier ni d'upsell à toute la base pour
    -- chaque soirée de chaque club.
    -- « L'habitué décroche » non plus : un rythme de sortie se lit chez UN
    -- club ou UN organisateur, pas sur toute la plateforme.
    IF v_platform AND a.kind IN ('last_call', 'new_event', 'tier_closing', 'table_upsell', 'regular_lapse', 'click_no_buy') THEN CONTINUE; END IF;
    IF clock_timestamp() - v_started > interval '4 seconds' THEN
      v_budget_hit := true;
      EXIT;
    END IF;
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    v_next := CASE WHEN v_platform THEN NULL ELSE public._email_automation_next_event(a.venue_id, a.organizer_user_id) END;
    TRUNCATE _auto_cand;

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
    ins AS (
      INSERT INTO public.email_automation_sends
        (automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
         email, status, skip_reason, due_at)
      SELECT a.id, a.venue_id, a.organizer_user_id, a.kind, j.trigger_key, j.trigger_event_id, j.bind_event_id,
             j.em, CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason, j.due_at
        FROM judged j
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT v_queued + count(*) FILTER (WHERE status = 'queued'), v_skipped + count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

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
    'budget_hit', v_budget_hit
  );
END;
$function$;

-- ── Aperçu (éligibles, prochaine relance) ────────────────────────────────
CREATE OR REPLACE FUNCTION public._email_automation_preview(p_venue_id text, p_organizer_user_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a RECORD;
  v_delay interval;
  v_threshold integer;
  v_enabled_at timestamptz;
  v_eligible integer := 0;
  v_base integer := 0;
  v_event_id uuid;
  v_event_title text;
  v_due timestamptz;
  v_start timestamptz;
  v_pub timestamptz;
  v_next uuid;
BEGIN
  IF (p_venue_id IS NULL AND p_organizer_user_id IS NULL) OR p_kind IS NULL THEN
    RETURN jsonb_build_object('eligible', 0, 'base', 0, 'next_event_id', NULL, 'next_event_title', NULL, 'next_due_at', NULL);
  END IF;

  SELECT x.* INTO a FROM public.email_automations x
   WHERE x.kind = p_kind
     AND ((p_venue_id IS NOT NULL AND x.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND x.organizer_user_id = p_organizer_user_id))
   LIMIT 1;
  v_delay := make_interval(hours => COALESCE(a.delay_hours, CASE p_kind
    WHEN 'abandoned_checkout' THEN 2 WHEN 'last_call' THEN 24 WHEN 'post_event_thanks' THEN 12
    WHEN 'post_event_missed' THEN 24 WHEN 'welcome' THEN 24 WHEN 'win_back' THEN 2160
    WHEN 'table_upsell' THEN 72 WHEN 'new_event' THEN 6 WHEN 'regular_lapse' THEN 1008 WHEN 'click_no_buy' THEN 24 ELSE 24 END));
  v_threshold := COALESCE(a.threshold_pct, 85);
  v_enabled_at := COALESCE(a.enabled_at, now());
  v_next := public._email_automation_next_event(p_venue_id, p_organizer_user_id);

  SELECT count(*) INTO v_base
    FROM public.newsletter_subscriptions s
   WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND s.opted_in AND s.opted_out_at IS NULL;

  IF p_kind IN ('last_call', 'new_event') THEN
    SELECT e.id, e.title, e.start_at, e.published_at INTO v_event_id, v_event_title, v_start, v_pub
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '2 hours'
       AND (p_kind = 'last_call' OR (
             (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
             AND e.published_at IS NOT NULL AND e.start_at > now() + interval '48 hours'))
       AND (
         ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
         OR (e.tables_enabled AND NOT e.tables_sold_out)
         OR (NOT e.guest_list_sold_out AND EXISTS (
               SELECT 1 FROM public.guest_lists gl
                WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
       )
     ORDER BY (CASE WHEN p_kind = 'new_event' THEN e.published_at END) DESC NULLS LAST, e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := CASE WHEN p_kind = 'last_call' THEN v_start - v_delay ELSE v_pub + v_delay END;
      SELECT count(*) INTO v_eligible
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND NOT public._email_event_holder(v_event_id, s.email)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(s.email)));
    ELSE
      v_eligible := CASE WHEN p_kind = 'new_event' THEN v_base ELSE 0 END;
    END IF;

  ELSIF p_kind = 'table_upsell' THEN
    SELECT e.id, e.title, e.start_at INTO v_event_id, v_event_title, v_start
      FROM public.events e
      JOIN LATERAL (SELECT public._event_tables_left(e.id) AS n) tl ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.tables_enabled AND NOT e.tables_sold_out AND COALESCE(tl.n, 0) > 0
       AND e.start_at > now() + interval '2 hours'
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      v_due := v_start - v_delay;
      SELECT count(DISTINCT lower(t.user_email)) INTO v_eligible
        FROM public.tickets t
       WHERE t.event_id = v_event_id AND t.status IN ('paid', 'used') AND t.user_email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.table_reservations r
                          WHERE r.event_id = v_event_id AND lower(r.user_email) = lower(t.user_email)
                            AND r.status IN ('paid', 'used', 'confirmed', 'pending'))
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = lower(t.user_email) AND s.opted_in AND s.opted_out_at IS NULL
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = lower(t.user_email)));
    END IF;

  ELSIF p_kind = 'tier_closing' THEN
    SELECT e.id, e.title INTO v_event_id, v_event_title
      FROM public.events e
      JOIN LATERAL (
        SELECT r.position, r.price
          FROM public.ticket_rounds r
         WHERE r.event_id = e.id AND r.is_active AND NOT r.manually_sold_out
           AND r.max_tickets > 0 AND r.tickets_sold < r.max_tickets
           AND r.tickets_sold * 100 >= r.max_tickets * v_threshold
         ORDER BY r.position LIMIT 1
      ) cur ON true
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND COALESCE(e.ticket_selling_mode, 'rounds') = 'rounds'
       AND e.ticketing_enabled AND NOT e.tickets_sold_out
       AND e.start_at > now() + interval '2 hours'
       AND EXISTS (SELECT 1 FROM public.ticket_rounds n
                    WHERE n.event_id = e.id AND n.position > cur.position AND n.price > cur.price
                      AND NOT n.manually_sold_out AND n.tickets_sold < n.max_tickets)
     ORDER BY e.start_at ASC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      SELECT count(*) INTO v_eligible FROM (
        SELECT lower(x.recipient_email) AS em
          FROM public.email_campaigns c
          JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
         WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
           AND x.created_at > now() - interval '60 days' AND x.recipient_email IS NOT NULL
           AND (c.event_id = v_event_id
                OR COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') LIKE '%/event/' || v_event_id::text || '%')
        UNION
        SELECT lower(w.email) FROM public.event_waitlist w WHERE w.event_id = v_event_id AND w.email IS NOT NULL
      ) i
      WHERE NOT public._email_event_holder(v_event_id, i.em)
        AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                     WHERE lower(s.email) = i.em AND s.opted_in AND s.opted_out_at IS NULL
                       AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
        AND (a.id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.email_automation_sends l
           WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = i.em));
    END IF;

  ELSIF p_kind = 'abandoned_checkout' THEN
    WITH pend AS (
      SELECT DISTINCT ON (lower(x.em), x.event_id) lower(x.em) AS em, x.event_id, x.created_at
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at
            FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND t.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at
            FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
             AND r.created_at >= now() - interval '48 hours' AND e.start_at > now() + interval '1 hour'
        ) x
       ORDER BY lower(x.em), x.event_id, x.created_at DESC
    ),
    open AS (
      SELECT p.* FROM pend p
       WHERE NOT public._email_event_holder(p.event_id, p.em)
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = p.event_id::text AND lower(l.email) = p.em))
    )
    SELECT count(*),
           min(o.created_at + v_delay) FILTER (WHERE o.created_at + v_delay > now()),
           (SELECT o2.event_id FROM open o2 WHERE o2.created_at + v_delay > now() ORDER BY o2.created_at LIMIT 1)
      INTO v_eligible, v_due, v_event_id
      FROM open o;
    IF v_event_id IS NOT NULL THEN
      SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
    END IF;

  ELSIF p_kind = 'welcome' THEN
    SELECT count(*), min(s.created_at + v_delay) FILTER (WHERE s.created_at + v_delay > now())
      INTO v_eligible, v_due
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND s.import_id IS NULL
       AND COALESCE(s.source, '') NOT LIKE 'import%'
       AND COALESCE(s.source, '') NOT LIKE 'platform%'
       AND COALESCE(s.source, '') NOT LIKE 'checkout%'
       AND COALESCE(s.source, '') NOT LIKE 'connector%'
       AND s.created_at >= LEAST(v_enabled_at, now())
       AND s.created_at >= now() - interval '14 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = 'once' AND lower(l.email) = lower(s.email)));
    v_event_id := v_next;

  ELSIF p_kind IN ('post_event_thanks', 'post_event_missed') THEN
    -- Éligibles = la dernière soirée finie et scannée (5 j) ; prochain départ
    -- = la fin de la prochaine soirée + délai.
    SELECT e.id INTO v_event_id
      FROM public.events e
     WHERE e.status = 'active' AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.end_at <= now() AND e.end_at >= now() - interval '5 days'
       AND (EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false)))
         OR EXISTS (SELECT 1 FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id WHERE gl.event_id = e.id AND ge.entry_scanned)
         OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = e.id AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.external_tickets xt WHERE xt.event_id = e.id AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')))
     ORDER BY e.end_at DESC
     LIMIT 1;
    IF v_event_id IS NOT NULL THEN
      WITH came AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND ge.entry_scanned
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.scanned_at IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      holders AS (
        SELECT lower(t.user_email) AS em FROM public.tickets t
         WHERE t.event_id = v_event_id AND t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
        UNION
        SELECT lower(ge.email) FROM public.guest_list_entries ge JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
         WHERE gl.event_id = v_event_id AND ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
        UNION
        SELECT lower(r.user_email) FROM public.table_reservations r
         WHERE r.event_id = v_event_id AND r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
        UNION
        SELECT lower(xt.buyer_email) FROM public.external_tickets xt
         WHERE xt.event_id = v_event_id AND xt.buyer_email IS NOT NULL AND xt.status IN ('valid', 'transferred')
      ),
      pop AS (
        SELECT em FROM came WHERE p_kind = 'post_event_thanks'
        UNION ALL
        SELECT h.em FROM holders h WHERE p_kind = 'post_event_missed' AND NOT EXISTS (SELECT 1 FROM came c WHERE c.em = h.em)
          -- Même règle que le moteur : au moins la moitié des détenteurs scannés.
          AND (SELECT count(*) FROM came) >= 0.5 * (SELECT count(*) FROM holders)
      )
      SELECT count(*) INTO v_eligible
        FROM pop
       WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = pop.em AND s.opted_in AND s.opted_out_at IS NULL
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = v_event_id::text AND lower(l.email) = pop.em));
    END IF;
    SELECT e.id, e.title, e.end_at + v_delay INTO v_event_id, v_event_title, v_due
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now()
     ORDER BY e.start_at ASC
     LIMIT 1;

  ELSIF p_kind = 'click_no_buy' THEN
    -- Même porte que le moteur : clics nominatifs vers la billetterie d'une
    -- soirée à venir, sans place à la même adresse, encore à relancer.
    -- Fenêtre = délai + 24 h, la même que le moteur : ce que l'aperçu compte
    -- est exactement ce que la recette relance si on l'allume maintenant.
    WITH k AS (
      SELECT lower(x.recipient_email) AS em, e.id AS eid, e.start_at, max(x.created_at) AS last_click
        FROM public.email_campaigns c
        JOIN public.email_campaign_events x ON x.campaign_id = c.id AND x.event_type = 'clicked'
        JOIN public.events e
          ON e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
         AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
         AND e.start_at > now() + interval '2 hours'
         AND NOT e.tickets_sold_out
         AND (
           (e.external_ticket_url IS NOT NULL
            AND public._link_base(COALESCE(x.metadata->'click'->>'link', x.metadata->>'link')) = public._link_base(e.external_ticket_url))
           OR (c.event_id = e.id
               AND COALESCE(x.metadata->'click'->>'link', x.metadata->>'link', '') ~* '^https?://(www\.)?yunoapp\.eu/(l|event|events|e)/')
         )
       WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
         AND x.recipient_email IS NOT NULL
         AND x.created_at > now() - v_delay - interval '24 hours'
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                      WHERE r.campaign_id = c.id AND lower(r.email) = lower(x.recipient_email))
       GROUP BY lower(x.recipient_email), e.id, e.start_at
    ),
    open AS (
      SELECT k.* FROM k
       WHERE k.last_click + v_delay > now() - interval '24 hours'
         AND position('@' in k.em) > 1
         AND NOT public._email_event_holder(k.eid, k.em)
         AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                      WHERE lower(s.email) = k.em AND s.opted_in AND s.opted_out_at IS NULL
                        AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
         AND (a.id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND l.trigger_key = k.eid::text AND lower(l.email) = k.em))
    )
    SELECT count(*),
           min(o.last_click + v_delay) FILTER (WHERE o.last_click + v_delay > now()),
           (SELECT o2.eid FROM open o2 ORDER BY o2.start_at LIMIT 1)
      INTO v_eligible, v_due, v_event_id
      FROM open o;

  ELSIF p_kind = 'win_back' THEN
    SELECT count(*) INTO v_eligible
      FROM public.newsletter_subscriptions s
      JOIN LATERAL (
        SELECT max(x.at) AS last_at FROM (
          SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
           WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
           WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT ge.entry_scanned_at FROM public.guest_list_entries ge
            JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
           WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
             AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
          UNION ALL
          SELECT COALESCE(xt.purchased_at, xt.first_seen_at) FROM public.external_tickets xt
           WHERE lower(xt.buyer_email) = lower(s.email) AND xt.status IN ('valid', 'transferred')
             AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
        ) x
      ) act ON true
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.opted_in AND s.opted_out_at IS NULL
       AND act.last_at IS NOT NULL
       AND act.last_at <= now() - v_delay
       AND act.last_at > now() - v_delay - interval '120 days'
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
            AND l.created_at > now() - interval '180 days'));
    v_event_id := v_next;

  ELSIF p_kind = 'regular_lapse' THEN
    -- Même porte que le moteur. La soirée affichée est celle que Yuno a
    -- choisie pour le plus récent d'entre eux (chacun reçoit la sienne).
    SELECT count(*), (array_agg(r.pick_event_id ORDER BY r.last_at DESC) FILTER (WHERE r.pick_event_id IS NOT NULL))[1]
      INTO v_eligible, v_event_id
      FROM public._regular_lapse_candidates(p_venue_id, p_organizer_user_id, v_delay) r
     WHERE EXISTS (SELECT 1 FROM public.newsletter_subscriptions s
                    WHERE lower(s.email) = r.em AND s.opted_in AND s.opted_out_at IS NULL
                      AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id))
       AND (a.id IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND lower(l.email) = r.em
            AND l.created_at > now() - interval '120 days'));
    v_event_id := COALESCE(v_event_id, v_next);
  END IF;

  IF v_event_id IS NOT NULL AND v_event_title IS NULL THEN
    SELECT e.title INTO v_event_title FROM public.events e WHERE e.id = v_event_id;
  END IF;

  RETURN jsonb_build_object(
    'eligible', COALESCE(v_eligible, 0),
    'base', COALESCE(v_base, 0),
    'next_event_id', v_event_id,
    'next_event_title', v_event_title,
    'next_due_at', CASE WHEN v_due > now() THEN v_due END
  );
END;
$function$;
