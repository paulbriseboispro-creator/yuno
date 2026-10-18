-- Envoi email à l'échelle d'une vraie base (2026-10-06, base WOH, 12 194 contacts).
--
-- Mesuré sur la prod (transactions annulées) avant cette migration :
--   · mise en file d'une campagne « toute la base » : 17,5 s ;
--   · moteur d'automatisations avec « Dernier appel » + « Annonce » allumés :
--     29,8 s, et le dernier appel ne touchait que 5 000 personnes sur 12 194.
-- Ces deux appels passent par l'API, plafonnée à 8 s (service_role hérite du
-- statement_timeout d'authenticator) : la campagne échouait, et une seule
-- recette allumée sur une grosse base faisait tomber le passage ENTIER du
-- moteur, donc les automatisations de tous les comptes.
--
-- Causes et corrections :
--   1. email_send_policy() et _email_engagement_rank() étaient appelées ligne
--      à ligne (~1 ms et ~0,25 ms par contact). Leurs miroirs ensemblistes
--      _email_send_policy_many() et _email_engagement_ranks() rendent la même
--      réponse pour tout un lot en une passe (équivalence vérifiée contact par
--      contact sur la base WOH). Les fonctions unitaires restent : toute
--      évolution des règles se fait dans les DEUX.
--   2. Le LIMIT des candidats tombait AVANT le filtre « déjà au registre » :
--      les mêmes 5 000 revenaient à chaque passage, le reste de la base ne
--      recevait jamais rien. Le filtre passe dans la sélection : le LIMIT
--      devient une taille de LOT (3 000), le passage suivant prend la suite.
--   3. Budget de 4 s par passage du moteur : les recettes restantes attendent
--      le passage suivant (5 min) au lieu de faire tout échouer.
--   4. La rafale de publications se juge une fois par soirée, plus par contact.
--   5. Une table « confirmed » compte comme achetée partout (comme en compta) ;
--      le renvoi aux non-ouvreurs écarte aussi les acheteurs Shotgun (CRM).
-- Aucune règle d'envoi ne change de sens.

-- ── 1. Les règles Yuno en UNE passe ────────────────────────────────────────
-- Miroir EXACT de email_send_policy(email, kind) (et de
-- email_marketing_pressure / is_email_suppressed qu'elle appelle), mais pour
-- tout un lot d'adresses : une ligne par adresse distincte (en minuscules),
-- reason NULL = permis. email_send_policy reste la porte unitaire (emails
-- Yuno historiques, _shared/email-policy.ts) ; toute évolution des règles se
-- fait dans les DEUX fonctions.
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
              WHEN p_kind IN ('abandoned_checkout', 'upsell', 'tier_closing') THEN 'urgent'
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

REVOKE ALL ON FUNCTION public._email_send_policy_many(text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_send_policy_many(text[], text) TO service_role;

-- ── 2. La priorité d'engagement en UNE passe ───────────────────────────────
-- Miroir EXACT de _email_engagement_rank(email, venue, orga) pour un lot :
-- 0 a ouvert / cliqué un email marketing sous 90 j, 1 est venu sous 180 j
-- dans la portée, 2 inscrit au registre de la portée sous 30 j, 3 le reste.
CREATE OR REPLACE FUNCTION public._email_engagement_ranks(p_emails text[], p_venue_id text, p_organizer_user_id uuid)
RETURNS TABLE(email text, rnk integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH e AS (
    SELECT DISTINCT lower(x) AS em FROM unnest(p_emails) AS x WHERE x IS NOT NULL
  ),
  r0 AS (
    SELECT DISTINCT lower(ev.recipient_email) AS em
      FROM public.email_campaign_events ev
     WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
       AND lower(ev.recipient_email) IN (SELECT em FROM e)
  ),
  r1 AS (
    SELECT lower(t.user_email) AS em
      FROM public.tickets t JOIN public.events ev ON ev.id = t.event_id
     WHERE t.status IN ('paid', 'used') AND t.created_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(t.user_email) IN (SELECT em FROM e)
    UNION
    SELECT lower(r.user_email)
      FROM public.table_reservations r JOIN public.events ev ON ev.id = r.event_id
     WHERE r.status IN ('paid', 'used') AND r.created_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(r.user_email) IN (SELECT em FROM e)
    UNION
    SELECT lower(ge.email)
      FROM public.guest_list_entries ge
      JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
      JOIN public.events ev ON ev.id = gl.event_id
     WHERE ge.entry_scanned AND ge.entry_scanned_at > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND lower(ge.email) IN (SELECT em FROM e)
    UNION
    SELECT lower(xt.buyer_email)
      FROM public.external_tickets xt
     WHERE xt.status IN ('valid', 'transferred')
       AND COALESCE(xt.purchased_at, xt.first_seen_at) > now() - interval '180 days'
       AND ((p_venue_id IS NOT NULL AND xt.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND xt.organizer_user_id = p_organizer_user_id))
       AND lower(xt.buyer_email) IN (SELECT em FROM e)
  ),
  r2 AS (
    SELECT DISTINCT lower(s.email) AS em
      FROM public.newsletter_subscriptions s
     WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND s.created_at > now() - interval '30 days'
       AND lower(s.email) IN (SELECT em FROM e)
  )
  SELECT e.em,
         CASE WHEN r0.em IS NOT NULL THEN 0
              WHEN r1.em IS NOT NULL THEN 1
              WHEN r2.em IS NOT NULL THEN 2
              ELSE 3 END
    FROM e
    LEFT JOIN r0 ON r0.em = e.em
    LEFT JOIN (SELECT DISTINCT em FROM r1) r1 ON r1.em = e.em
    LEFT JOIN r2 ON r2.em = e.em;
$function$;

REVOKE ALL ON FUNCTION public._email_engagement_ranks(text[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_engagement_ranks(text[], text, uuid) TO service_role;

-- ── 3. Mise en file d' une campagne ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public._enqueue_campaign_recipients_core(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_queued integer := 0;
  v_suppressed integer := 0;
  v_policy integer := 0;
  v_total integer := 0;
  v_sent integer := 0;
  v_kind text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: service_role only';
  END IF;

  -- Un email de service (informational) n'est pas du marketing : pas de règle
  -- de pression, seule la liste de suppression s'applique.
  SELECT CASE WHEN COALESCE(c.type, 'promotional') = 'promotional' THEN 'campaign' ELSE NULL END
    INTO v_kind FROM public.email_campaigns c WHERE c.id = p_campaign_id;

  WITH aud AS (
    SELECT DISTINCT ON (lower(a.email))
           lower(a.email) AS addr, a.first_name AS fname, a.last_name AS lname,
           a.unsubscribe_token AS tok
      FROM public.resolve_campaign_audience(p_campaign_id) a
     WHERE a.email IS NOT NULL AND position('@' in a.email) > 1
     ORDER BY lower(a.email)
  ), rules AS (
    -- Les règles Yuno en UNE passe sur toute l'audience : ligne à ligne,
    -- elles coûtaient ~1 ms par adresse (17 s pour 12 000, au-delà du
    -- plafond de 8 s de l'API : la campagne ne partait pas).
    SELECT p.email, p.reason
      FROM public._email_send_policy_many(ARRAY(SELECT addr FROM aud), COALESCE(v_kind, 'campaign')) p
     WHERE v_kind IS NOT NULL
  ), flagged AS (
    SELECT a.addr, a.fname, a.lname, a.tok,
           (sx.em IS NOT NULL) AS supp,
           CASE WHEN v_kind IS NULL THEN NULL ELSE p.reason END AS pol
      FROM aud a
      LEFT JOIN rules p ON p.email = a.addr
      -- Liste de suppression lue en une jointure (= is_email_suppressed).
      LEFT JOIN (SELECT DISTINCT lower(s.email) AS em FROM public.email_suppressions s
                  WHERE lower(s.email) IN (SELECT addr FROM aud)) sx ON sx.em = a.addr
  ), ins AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, unsubscribe_token, status)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, f.tok, 'pending'
      FROM flagged f WHERE NOT f.supp AND (f.pol IS NULL OR f.pol = 'suppressed')
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  ), sup AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, status, error_message)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, 'suppressed',
           'Adresse sur la liste de suppression (bounce ou plainte)'
      FROM flagged f WHERE f.supp
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  ), pol AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, status, error_message)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, 'skipped', 'policy:' || f.pol
      FROM flagged f WHERE NOT f.supp AND f.pol IS NOT NULL AND f.pol <> 'suppressed'
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins),
         (SELECT count(*) FROM flagged WHERE supp),
         (SELECT count(*) FROM flagged WHERE NOT supp AND pol IS NOT NULL AND pol <> 'suppressed')
    INTO v_queued, v_suppressed, v_policy;

  UPDATE public.email_campaign_recipients r
     SET first_name = COALESCE(r.first_name, ns.first_name),
         last_name  = COALESCE(r.last_name,  ns.last_name)
    FROM public.email_campaigns c
    JOIN public.newsletter_subscriptions ns
      ON public.marketing_scope_match(ns.venue_id, ns.organizer_user_id,
                                      c.venue_id, c.organizer_user_id)
   WHERE c.id = p_campaign_id
     AND r.campaign_id = p_campaign_id
     AND lower(ns.email) = lower(r.email)
     AND (r.first_name IS NULL OR r.last_name IS NULL)
     AND (ns.first_name IS NOT NULL OR ns.last_name IS NOT NULL);

  SELECT count(*), count(*) FILTER (WHERE status = 'sent')
    INTO v_total, v_sent
    FROM public.email_campaign_recipients
   WHERE campaign_id = p_campaign_id AND status NOT IN ('suppressed', 'skipped');

  UPDATE public.email_campaigns
     SET total_recipients = v_total,
         suppressed_count = v_suppressed,
         policy_skipped_count = v_policy,
         recipients_count = v_sent,
         send_started_at = COALESCE(send_started_at, now()),
         status = CASE WHEN v_total > v_sent THEN 'sending' ELSE status END,
         paused_reason = NULL,
         error_message = NULL
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'queued', v_queued, 'suppressed', v_suppressed, 'policy_skipped', v_policy,
    'total', v_total, 'already_sent', v_sent, 'remaining', v_total - v_sent
  );
END;
$function$;

-- ── 4. Moteur d' automatisations ──────────────────────────────────────────
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
                WHEN 'abandoned_checkout' THEN 0 WHEN 'tier_closing' THEN 1
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
    IF v_platform AND a.kind IN ('last_call', 'new_event', 'tier_closing', 'table_upsell', 'regular_lapse') THEN CONTINUE; END IF;
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
                    AND a.kind IN ('last_call', 'abandoned_checkout', 'table_upsell', 'tier_closing', 'new_event')
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
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE r.event_id = c.trigger_event_id AND r.status IN ('paid', 'confirmed', 'used') AND lower(r.user_email) = c.em)
                 -- Yuno CRM : déjà acheté sur la billetterie connectée.
                 OR EXISTS (SELECT 1 FROM public.external_tickets xt
                             WHERE xt.event_id = c.trigger_event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = c.em)
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout', 'tier_closing', 'new_event') AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               -- Une automatisation par 48 h et par portée ; les deux recettes
               -- URGENTES (panier abandonné, tarif qui monte) font exception.
               WHEN a.kind NOT IN ('abandoned_checkout', 'tier_closing') AND EXISTS (
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
               WHEN j.reason IS NULL AND a.kind NOT IN ('abandoned_checkout', 'tier_closing')
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

-- ── 5. Renvoi aux non-ouvreurs ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collect_campaign_resends()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_child uuid;
  v_new integer;
  v_parents integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_resends: service_role only';
  END IF;

  FOR p IN
    SELECT c.*, e.start_at AS event_start_at
      FROM public.email_campaigns c
      LEFT JOIN public.events e ON e.id = c.event_id
     WHERE c.resend_enabled
       AND c.resend_done_at IS NULL
       AND c.resend_campaign_id IS NULL
       AND c.child_kind IS NULL
       AND c.parent_campaign_id IS NULL
       AND c.automation_id IS NULL
       AND c.status = 'sent'
       AND c.type = 'promotional'
       AND c.sent_at IS NOT NULL
       AND c.sent_at + make_interval(hours => c.resend_delay_hours) <= now()
       AND c.sent_at > now() - interval '10 days'
     ORDER BY c.sent_at
     LIMIT 20
  LOOP
    v_parents := v_parents + 1;

    IF p.event_start_at IS NOT NULL AND p.event_start_at <= now() + interval '2 hours' THEN
      UPDATE public.email_campaigns SET resend_done_at = now() WHERE id = p.id;
      CONTINUE;
    END IF;

    INSERT INTO public.email_campaigns
      (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
       theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
       quiet_hours, throttle_per_hour, throttle_window_minutes, parent_campaign_id, child_kind,
       total_recipients, created_by)
    VALUES
      (p.venue_id, p.organizer_user_id, left('Renvoi · ' || p.name, 80), 'promotional',
       COALESCE(NULLIF(p.resend_subject, ''), p.subject), COALESCE(p.preheader, ''),
       COALESCE(p.blocks_json, '[]'::jsonb), COALESCE(p.blocks_version, 1),
       COALESCE(p.theme_json, '{}'::jsonb), COALESCE(p.social_links_json, '{}'::jsonb), p.logo_url,
       p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
       true, p.throttle_per_hour, COALESCE(p.throttle_window_minutes, 60), p.id, 'resend',
       0, p.created_by)
    RETURNING id INTO v_child;

    WITH base AS (
      SELECT r.email, r.first_name, r.last_name, r.unsubscribe_token, r.user_id
        FROM public.email_campaign_recipients r
       WHERE r.campaign_id = p.id
         AND r.status = 'sent'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_campaign_events ev
            WHERE ev.campaign_id = p.id AND lower(ev.recipient_email) = lower(r.email)
              AND ev.event_type IN ('opened', 'clicked', 'bounced', 'complained', 'unsubscribed')
         )
         AND EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions s
            WHERE lower(s.email) = lower(r.email) AND s.opted_in AND s.opted_out_at IS NULL
              AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
         )
         AND (p.event_id IS NULL OR NOT (
           EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.event_id = p.event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(r.email))
           OR EXISTS (SELECT 1 FROM public.table_reservations tr
                       WHERE tr.event_id = p.event_id AND tr.status IN ('paid', 'confirmed', 'used') AND lower(tr.user_email) = lower(r.email))
           -- Yuno CRM : déjà acheté sur la billetterie connectée.
           OR EXISTS (SELECT 1 FROM public.external_tickets xt
                       WHERE xt.event_id = p.event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = lower(r.email))
           OR EXISTS (SELECT 1 FROM public.guest_list_entries ge
                        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                       WHERE gl.event_id = p.event_id AND lower(ge.email) = lower(r.email)
                         AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected'))
         ))
    ),
    -- Règles Yuno : suppression, pression du palier campagne, fatigue — en
    -- UNE passe sur tout le lot (ligne à ligne, un renvoi à 9 000 non-ouvreurs
    -- dépassait le plafond de 8 s de l'API).
    pol AS (
      SELECT x.email, x.reason
        FROM public._email_send_policy_many(ARRAY(SELECT lower(b.email) FROM base b), 'resend') x
    ),
    ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, user_id, status)
      SELECT v_child, b.email, b.first_name, b.last_name, b.unsubscribe_token, b.user_id, 'pending'
        FROM base b
        JOIN pol ON pol.email = lower(b.email) AND pol.reason IS NULL
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    IF v_new = 0 THEN
      DELETE FROM public.email_campaigns WHERE id = v_child;
      UPDATE public.email_campaigns SET resend_done_at = now() WHERE id = p.id;
      CONTINUE;
    END IF;

    UPDATE public.email_campaigns SET total_recipients = v_new WHERE id = v_child;
    UPDATE public.email_campaigns SET resend_campaign_id = v_child, resend_done_at = now() WHERE id = p.id;
    v_enqueued := v_enqueued + v_new;
    v_children := array_append(v_children, v_child);
  END LOOP;

  RETURN jsonb_build_object('parents', v_parents, 'enqueued', v_enqueued, 'children', to_jsonb(v_children));
END;
$function$;

-- ── 6. Relance après clic ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collect_campaign_followups()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  tpl RECORD;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
  v_parents integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_followups: service_role only';
  END IF;

  FOR p IN
    SELECT c.id, c.name, c.venue_id, c.organizer_user_id, c.event_id, c.quiet_hours,
           c.followup_delay_hours AS delay_h, c.followup_template_id, c.followup_campaign_id,
           c.resend_campaign_id,
           e.start_at
      FROM public.email_campaigns c
      JOIN public.events e ON e.id = c.event_id
     WHERE c.followup_enabled
       AND c.parent_campaign_id IS NULL
       AND c.followup_template_id IS NOT NULL
       AND c.event_id IS NOT NULL
       AND c.status IN ('sent', 'sending', 'paused')
       AND c.type = 'promotional'
       AND e.start_at > now() - interval '7 days'
  LOOP
    v_parents := v_parents + 1;

    WITH clicks AS (
      SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS first_click
        FROM public.email_campaign_events ev
       WHERE ev.campaign_id IN (p.id, p.resend_campaign_id)
         AND ev.event_type = 'clicked'
         AND COALESCE(ev.metadata->'click'->>'link', ev.metadata->>'link', '')
             ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)'
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                      WHERE r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email))
       GROUP BY lower(ev.recipient_email)
    ),
    due AS (
      SELECT c.em, c.first_click, c.first_click + make_interval(hours => p.delay_h) AS due_at
        FROM clicks c
       WHERE c.first_click + make_interval(hours => p.delay_h) <= now()
         AND NOT EXISTS (SELECT 1 FROM public.email_campaign_followups f
                          WHERE f.parent_campaign_id = p.id AND lower(f.email) = c.em)
    ),
    judged AS (
      SELECT d.em, d.first_click, d.due_at,
             CASE
               WHEN d.due_at >= p.start_at THEN 'event_over'
               WHEN public.is_email_suppressed(d.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = d.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
               ) THEN 'unsubscribed'
               WHEN EXISTS (
                 SELECT 1 FROM public.tickets t
                  WHERE t.event_id = p.event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = d.em
               ) OR EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = p.event_id AND r.status IN ('paid', 'confirmed') AND lower(r.user_email) = d.em
               ) THEN 'bought'
               WHEN EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                  JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = p.event_id AND lower(ge.email) = d.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               WHEN EXISTS (
                 SELECT 1 FROM public.email_campaign_followups f2
                  WHERE f2.event_id = p.event_id AND lower(f2.email) = d.em AND f2.status = 'queued'
               ) THEN 'already_event'
               ELSE NULL
             END AS reason
        FROM due d
    ),
    ins AS (
      INSERT INTO public.email_campaign_followups
        (parent_campaign_id, event_id, email, clicked_at, due_at, status, skip_reason)
      SELECT p.id, p.event_id, j.em, j.first_click, j.due_at,
             CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason
        FROM judged j
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

    SELECT count(*) INTO v_new
      FROM public.email_campaign_followups f
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;
    IF v_new = 0 THEN CONTINUE; END IF;

    v_child := p.followup_campaign_id;
    IF v_child IS NULL THEN
      SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = p.followup_template_id;
      IF tpl.id IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.email_campaigns
        (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
         theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
         quiet_hours, parent_campaign_id, child_kind, total_recipients, created_by)
      VALUES
        (p.venue_id, p.organizer_user_id, 'Relance · ' || p.name, 'promotional',
         COALESCE(NULLIF(tpl.subject, ''), 'Relance'), COALESCE(tpl.preheader, ''),
         COALESCE(tpl.blocks_json, '[]'::jsonb), 2,
         COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
         p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
         p.quiet_hours, p.id, 'followup', 0, tpl.created_by)
      RETURNING id INTO v_child;
      UPDATE public.email_campaigns SET followup_campaign_id = v_child WHERE id = p.id;
    END IF;

    WITH todo AS (
      SELECT f.id, lower(f.email) AS em
        FROM public.email_campaign_followups f
       WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL
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
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
           LIMIT 1
        ) s ON true
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    UPDATE public.email_campaign_followups f
       SET followup_campaign_id = v_child
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;

    UPDATE public.email_campaigns
       SET status = 'sending', paused_reason = NULL, error_message = NULL,
           total_recipients = COALESCE(total_recipients, 0) + v_new
     WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

    v_enqueued := v_enqueued + v_new;
    v_children := array_append(v_children, v_child);
  END LOOP;

  RETURN jsonb_build_object(
    'parents', v_parents, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children)
  );
END;
$function$;

-- ── 7. Plafond des appels SERVEUR : 30 s ─────────────────────────────────
-- service_role n'avait pas de réglage propre et héritait des 8 s
-- d'authenticator : la mise en file d'une campagne vers une base de 30 000
-- contacts (un import Shotgun complet) dépasserait encore ce plafond malgré
-- les corrections ci-dessus. service_role ne sert qu'aux fonctions edge et
-- aux crons (jamais à un écran : anon 3 s et authenticated 8 s ne bougent
-- pas). Le moteur d'automatisations garde son propre budget de 4 s.
-- Réglage prévu par Supabase (guides/database/postgres/timeouts).
ALTER ROLE service_role SET statement_timeout = '30s';
NOTIFY pgrst, 'reload config';
