-- ─────────────────────────────────────────────────────────────────────────────
-- Politique d'envoi Yuno — les règles qu'aucun expéditeur ne peut désactiver.
--
-- Une adresse peut être dans la base de trois clubs, d'un organisateur et de
-- Yuno. Chacun envoie ses campagnes, ses recettes, et Yuno ses propres emails
-- automatiques (récap de soirée, on t'a manqué, upsell, recommandations).
-- Sans arbitre, la même personne reçoit six emails marketing en 24 h, se
-- désabonne partout et signale « indésirable » : la réputation du domaine
-- partagé tombe, et ce sont les confirmations de billets de TOUT LE MONDE
-- qui finissent en spam.
--
-- D'où une politique unique, en SQL, constante, appliquée à tout ce qui est
-- marketing (campagnes, renvois, recettes des pros, recettes de Yuno, emails
-- automatiques historiques de Yuno). Jamais au transactionnel.
--
--   R1 Suppression : une adresse morte ou plaignante ne reçoit plus rien
--      (liste globale existante).
--   R2 Pression : tous expéditeurs confondus, une automatisation attend
--      24 h après le dernier email marketing reçu et ne dépasse pas 3 par
--      7 jours ; une campagne manuelle ne dépasse pas 3 par 24 h et 8 par
--      7 jours ; le panier abandonné et l'upsell (urgents) 2 / 24 h, 5 / 7 j.
--   R3 Fatigue : 8 emails marketing sur 90 jours sans une seule ouverture ni
--      un clic → la personne « dort » : plus d'automatisation, plus de
--      campagne, jusqu'à ce qu'elle rouvre quelque chose (transactionnel
--      compris — une confirmation ouverte ne compte pas ici, seuls les
--      événements de campagne sont tracés ; le réveil vient d'une ouverture
--      de campagne, d'un achat ou d'une inscription, cf. engaged90).
--   R4 Aversion : deux désabonnements chez deux expéditeurs différents en
--      30 jours → plus aucune automatisation pendant 30 jours, chez personne.
--   R5 Une soirée, un message : un seul dernier appel, un seul panier
--      abandonné, un seul merci, un seul « on t'a manqué » par personne et par
--      soirée, quel que soit l'expéditeur (club, organisateur du co-event,
--      Yuno). Le pro passe avant Yuno.
--   R6 Nuit : jamais entre 23 h et 9 h (Paris) pour tout automatique.
--
-- La table marketing_email_log porte les emails automatiques de Yuno
-- (missed-you, recap, upsell, reco) : les campagnes et recettes sont déjà
-- dans email_campaign_recipients. email_marketing_pressure() les lit ensemble.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Journal des emails automatiques de Yuno ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  kind text NOT NULL,
  venue_id text,
  organizer_user_id uuid,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_email_log_email_sent
  ON public.marketing_email_log (lower(email), sent_at DESC);
ALTER TABLE public.marketing_email_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.marketing_email_log IS
  'Emails marketing envoyés HORS campagne (récap, on t''a manqué, upsell, reco de Yuno) : entrent dans la pression par contact. Purge à 120 j.';

CREATE OR REPLACE FUNCTION public.log_marketing_email(p_email text, p_kind text, p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.marketing_email_log (email, kind, venue_id, organizer_user_id)
  SELECT lower(p_email), p_kind, p_venue_id, p_organizer_user_id
   WHERE p_email IS NOT NULL AND position('@' in p_email) > 1;
$$;
REVOKE ALL ON FUNCTION public.log_marketing_email(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_marketing_email(text, text, text, uuid) TO service_role;

-- Index que la pression exige (lecture par adresse, pas par campagne).
CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_email_sent
  ON public.email_campaign_recipients (lower(email), sent_at DESC) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_email_campaign_events_recipient_engaged
  ON public.email_campaign_events (lower(recipient_email), created_at DESC)
  WHERE event_type IN ('opened', 'clicked');
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_optout_recent
  ON public.newsletter_subscriptions (lower(email), opted_out_at) WHERE opted_out_at IS NOT NULL;

-- ── 2. Les signaux d'une adresse ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_marketing_pressure(p_email text)
RETURNS TABLE (n24 integer, n7d integer, sent90 integer, engaged90 boolean, optouts30 integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH em AS (SELECT lower(p_email) AS e),
  sends AS (
    SELECT r.sent_at
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
      JOIN em ON lower(r.email) = em.e
     WHERE r.status = 'sent' AND r.sent_at > now() - interval '90 days'
       AND COALESCE(c.type, 'promotional') = 'promotional'
    UNION ALL
    SELECT l.sent_at FROM public.marketing_email_log l JOIN em ON lower(l.email) = em.e
     WHERE l.sent_at > now() - interval '90 days'
  )
  SELECT
    (SELECT count(*) FROM sends WHERE sent_at > now() - interval '24 hours')::integer,
    (SELECT count(*) FROM sends WHERE sent_at > now() - interval '7 days')::integer,
    (SELECT count(*) FROM sends)::integer,
    EXISTS (
      SELECT 1 FROM public.email_campaign_events ev JOIN em ON lower(ev.recipient_email) = em.e
       WHERE ev.event_type IN ('opened', 'clicked') AND ev.created_at > now() - interval '90 days'
    ),
    (SELECT count(*) FROM public.newsletter_subscriptions s JOIN em ON lower(s.email) = em.e
      WHERE s.opted_out_at > now() - interval '30 days')::integer;
$$;
REVOKE ALL ON FUNCTION public.email_marketing_pressure(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_marketing_pressure(text) TO service_role, authenticated;

-- ── 3. La décision ──────────────────────────────────────────────────────────
-- Rend NULL quand l'envoi est permis, sinon la raison :
--   suppressed | pressure_24h | pressure_7d | fatigue | averse
-- p_kind : 'campaign' | 'resend' (palier campagne) ;
--          'abandoned_checkout' | 'upsell' (urgent) ; tout le reste = automatisation.
CREATE OR REPLACE FUNCTION public.email_send_policy(p_email text, p_kind text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
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
    WHEN p_kind IN ('abandoned_checkout', 'upsell') THEN 'urgent'
    ELSE 'automation' END;
  v_cap24 := CASE v_tier WHEN 'campaign' THEN 3 WHEN 'urgent' THEN 2 ELSE 1 END;
  v_cap7  := CASE v_tier WHEN 'campaign' THEN 8 WHEN 'urgent' THEN 5 ELSE 3 END;

  SELECT * INTO s FROM public.email_marketing_pressure(p_email);

  -- R3 : huit emails sans un signe de vie → la personne dort.
  IF s.sent90 >= 8 AND NOT s.engaged90 THEN RETURN 'fatigue'; END IF;
  -- R4 : deux désabonnements récents → silence des automatisations.
  IF v_tier <> 'campaign' AND s.optouts30 >= 2 THEN RETURN 'averse'; END IF;
  -- R2 : pression.
  IF s.n24 >= v_cap24 THEN RETURN 'pressure_24h'; END IF;
  IF s.n7d >= v_cap7 THEN RETURN 'pressure_7d'; END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.email_send_policy(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_send_policy(text, text) TO service_role, authenticated;
COMMENT ON FUNCTION public.email_send_policy(text, text) IS
  'Règles Yuno non modifiables : suppression, pression (auto 1/24h·3/7j, urgent 2/24h·5/7j, campagne 3/24h·8/7j), fatigue (8 envois/90 j sans ouverture), aversion (2 désabonnements/30 j).';

-- ── 4. Recettes : portée plateforme (Yuno) + nouvelles raisons ──────────────
ALTER TABLE public.email_automations DROP CONSTRAINT IF EXISTS email_automations_owner_check;
ALTER TABLE public.email_automations ADD CONSTRAINT email_automations_owner_check
  CHECK (NOT (venue_id IS NOT NULL AND organizer_user_id IS NOT NULL));
-- Une seule recette Yuno par type (les deux colonnes de portée à NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automations_platform_kind
  ON public.email_automations (kind) WHERE venue_id IS NULL AND organizer_user_id IS NULL;

ALTER TABLE public.email_automation_sends DROP CONSTRAINT IF EXISTS email_automation_sends_skip_reason_check;
ALTER TABLE public.email_automation_sends ADD CONSTRAINT email_automation_sends_skip_reason_check
  CHECK (skip_reason IS NULL OR skip_reason IN (
    'bought', 'guest_list', 'unsubscribed', 'suppressed', 'no_consent', 'cooldown', 'event_over',
    'already_event', 'pressure_24h', 'pressure_7d', 'fatigue', 'averse'
  ));
-- R5 en dur : une soirée, un message par recette et par personne, tous expéditeurs.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automation_sends_event_kind_email
  ON public.email_automation_sends (kind, trigger_event_id, lower(email))
  WHERE status = 'queued' AND trigger_event_id IS NOT NULL;

-- Garde de lecture : la portée plateforme est réservée au super admin.
CREATE OR REPLACE FUNCTION public._email_scope_guard(p_venue_id text, p_organizer_user_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_email_automation_stats(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.kind), '[]'::jsonb) INTO result
    FROM (
      SELECT a.id, a.kind, a.enabled, a.enabled_at, a.delay_hours, a.template_id, a.subject,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL) AS pending,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued') AS queued,
             (SELECT COALESCE(jsonb_object_agg(x.skip_reason, x.n), '{}'::jsonb)
                FROM (SELECT l.skip_reason, count(*) AS n FROM public.email_automation_sends l
                       WHERE l.automation_id = a.id AND l.status = 'skipped' GROUP BY l.skip_reason) x) AS skipped,
             (SELECT max(l.created_at) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued') AS last_queued_at,
             (SELECT count(*) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS campaigns,
             (SELECT COALESCE(sum(c.recipients_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS sent,
             (SELECT COALESCE(sum(c.delivered_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS delivered,
             (SELECT COALESCE(sum(c.opens_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS opens,
             (SELECT COALESCE(sum(c.clickers_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS clickers,
             (SELECT COALESCE(sum(c.unsubscribes_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS unsubscribes,
             (SELECT COALESCE(jsonb_agg(c.id), '[]'::jsonb) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS campaign_ids
        FROM public.email_automations a
       WHERE (p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id)
          OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL AND a.venue_id IS NULL AND a.organizer_user_id IS NULL)
    ) s;

  RETURN result;
END;
$$;

-- Une recette d'après-soirée est-elle allumée pour cette soirée (chez le club,
-- l'organisateur, ou Yuno) ? Les emails historiques de Yuno s'effacent alors.
CREATE OR REPLACE FUNCTION public.email_automation_covers_event(p_event_id uuid, p_kind text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.email_automations a
      ON a.enabled AND a.template_id IS NOT NULL AND a.kind = p_kind
     AND ((a.venue_id IS NOT NULL AND a.venue_id = e.venue_id)
       OR (a.organizer_user_id IS NOT NULL AND a.organizer_user_id = e.organizer_user_id)
       OR (a.venue_id IS NULL AND a.organizer_user_id IS NULL))
    WHERE e.id = p_event_id
  );
$$;
REVOKE ALL ON FUNCTION public.email_automation_covers_event(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_automation_covers_event(uuid, text) TO service_role;

-- ── 5. Le moteur, avec la politique et la portée Yuno ───────────────────────
CREATE OR REPLACE FUNCTION public.collect_email_automations()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
    last_name text
  ) ON COMMIT DROP;

  -- Les pros d'abord, Yuno en dernier : à soirée égale, le pro passe avant (R5).
  FOR a IN
    SELECT x.*, (x.venue_id IS NULL AND x.organizer_user_id IS NULL) AS is_platform
      FROM public.email_automations x
     WHERE x.enabled AND x.template_id IS NOT NULL AND x.enabled_at IS NOT NULL
     ORDER BY (x.venue_id IS NULL AND x.organizer_user_id IS NULL), x.created_at
  LOOP
    v_platform := a.is_platform;
    -- Yuno ne fait pas de « dernier appel » à toute sa base pour chaque soirée.
    IF v_platform AND a.kind = 'last_call' THEN CONTINUE; END IF;
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    -- La « prochaine soirée » n'a pas de sens à l'échelle de Yuno : les
    -- recettes Yuno sans soirée déclencheuse partent sans blocs live.
    v_next := CASE WHEN v_platform THEN NULL ELSE public._email_automation_next_event(a.venue_id, a.organizer_user_id) END;
    TRUNCATE _auto_cand;

    -- ── 5a. Candidats par recette ─────────────────────────────────────────
    IF a.kind = 'welcome' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT lower(s.email), 'once', NULL, v_next, s.created_at + v_delay, true, s.user_id, s.first_name, s.last_name
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.import_id IS NULL
         AND COALESCE(s.source, '') NOT LIKE 'import%'
         AND (v_platform OR COALESCE(s.source, '') NOT LIKE 'platform%')
         AND COALESCE(s.source, '') NOT LIKE 'checkout%'
         AND COALESCE(s.source, '') NOT LIKE 'platform:checkout%'
         AND s.created_at >= a.enabled_at
         AND s.created_at >= now() - interval '14 days'
         AND s.created_at + v_delay <= now()
       LIMIT 500;

    ELSIF a.kind = 'abandoned_checkout' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT DISTINCT ON (lower(x.em), x.event_id)
             lower(x.em), x.event_id::text, x.event_id, x.event_id, x.created_at + v_delay,
             x.optin, x.user_id, x.first_name, x.last_name
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
       ORDER BY lower(x.em), x.event_id, x.optin DESC, x.created_at DESC
       LIMIT 500;

      -- L'accord coché au checkout est versé dans le registre du CLUB ou de
      -- l'ORGANISATEUR (c'est leur case, pas celle de Yuno). Yuno ne lit que
      -- son propre registre : pas de versement en portée plateforme.
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
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT lower(s.email), e.id::text, e.id, e.id, now(), true, s.user_id, s.first_name, s.last_name
        FROM public.events e
        JOIN public.newsletter_subscriptions s
          ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
       WHERE e.status IN ('published', 'featured') AND e.is_active AND e.cancelled_at IS NULL
         AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
           OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
         AND e.start_at > a.enabled_at
         AND e.start_at - v_delay <= now()
         AND e.start_at > now() + interval '2 hours'
         AND (
           (e.ticketing_enabled AND NOT e.tickets_sold_out)
           OR (e.tables_enabled AND NOT e.tables_sold_out)
           OR (NOT e.guest_list_sold_out AND EXISTS (
                 SELECT 1 FROM public.guest_lists gl
                  WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
         )
       LIMIT 5000;

    ELSIF a.kind IN ('post_event_thanks', 'post_event_missed') THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT DISTINCT ON (lower(p.em), p.event_id)
             lower(p.em), p.event_id::text, p.event_id, v_next, now(), true, NULL, NULL, NULL
        FROM (
          WITH ev AS (
            SELECT e.id
              FROM public.events e
             WHERE e.status IN ('published', 'featured') AND e.cancelled_at IS NULL
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
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
          ),
          scanned_events AS (SELECT DISTINCT event_id FROM came)
          SELECT c.event_id, c.em FROM came c WHERE a.kind = 'post_event_thanks'
          UNION ALL
          SELECT h.event_id, h.em FROM holders h
            JOIN scanned_events se ON se.event_id = h.event_id
           WHERE a.kind = 'post_event_missed'
             AND NOT EXISTS (SELECT 1 FROM came c WHERE c.event_id = h.event_id AND c.em = h.em)
        ) p
       ORDER BY lower(p.em), p.event_id
       LIMIT 5000;

    ELSIF a.kind = 'win_back' THEN
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT lower(s.email), 'wb-' || to_char(now(), 'YYYY-MM'), NULL, v_next, now(), true, s.user_id, s.first_name, s.last_name
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
             WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
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
    judged AS (
      SELECT c.*,
             CASE
               WHEN c.trigger_event_id IS NOT NULL AND a.kind IN ('last_call', 'abandoned_checkout') AND EXISTS (
                 SELECT 1 FROM public.events e WHERE e.id = c.trigger_event_id AND e.start_at <= now()
               ) THEN 'event_over'
               -- R5 : quelqu'un d'autre (club, orga du co-event, Yuno) l'a déjà
               -- écrit pour cette soirée et cette recette.
               WHEN c.trigger_event_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.kind = a.kind AND l.trigger_event_id = c.trigger_event_id
                    AND lower(l.email) = c.em AND l.status = 'queued'
               ) THEN 'already_event'
               WHEN public.is_email_suppressed(c.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
               ) THEN CASE WHEN a.kind = 'abandoned_checkout' THEN 'no_consent' ELSE 'unsubscribed' END
               WHEN a.kind IN ('last_call', 'abandoned_checkout') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE r.event_id = c.trigger_event_id AND r.status IN ('paid', 'used') AND lower(r.user_email) = c.em)
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout') AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               WHEN a.kind <> 'abandoned_checkout' AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.status = 'queued' AND lower(l.email) = c.em
                    AND l.created_at > now() - interval '48 hours'
                    AND ((a.venue_id IS NOT NULL AND l.venue_id = a.venue_id)
                      OR (a.organizer_user_id IS NOT NULL AND l.organizer_user_id = a.organizer_user_id)
                      OR (v_platform AND l.venue_id IS NULL AND l.organizer_user_id IS NULL))
               ) THEN 'cooldown'
               -- Règles Yuno (pression, fatigue, aversion), tous expéditeurs.
               ELSE public.email_send_policy(c.em, a.kind)
             END AS reason
        FROM cand c
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
    'enqueued', v_enqueued, 'children', to_jsonb(v_children)
  );
END;
$$;

-- ── 6. Renvoi aux non-ouvreurs : la politique aussi ─────────────────────────
CREATE OR REPLACE FUNCTION public.collect_campaign_resends()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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

    WITH ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, user_id, status)
      SELECT v_child, r.email, r.first_name, r.last_name, r.unsubscribe_token, r.user_id, 'pending'
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
                       WHERE tr.event_id = p.event_id AND tr.status IN ('paid', 'used') AND lower(tr.user_email) = lower(r.email))
           OR EXISTS (SELECT 1 FROM public.guest_list_entries ge
                        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                       WHERE gl.event_id = p.event_id AND lower(ge.email) = lower(r.email)
                         AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected'))
         ))
         -- Règles Yuno : suppression, pression du palier campagne, fatigue.
         AND public.email_send_policy(r.email, 'resend') IS NULL
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
$$;

-- ── 7. Campagnes manuelles : la politique à la constitution de la file ──────
-- Palier campagne (3 / 24 h, 8 / 7 j, fatigue). Les écartés sont tracés en
-- 'skipped' avec la règle en clair, comptés dans policy_skipped_count : le pro
-- lit « 4 812 envoyés, 63 protégés par les règles Yuno », jamais un trou.
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS policy_skipped_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.email_campaigns.policy_skipped_count IS
  'Destinataires écartés par les règles Yuno (pression, fatigue) à la constitution de la file.';

CREATE OR REPLACE FUNCTION public.enqueue_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
  ), flagged AS (
    SELECT addr, fname, lname, tok,
           public.is_email_suppressed(addr) AS supp,
           CASE WHEN v_kind IS NULL THEN NULL ELSE public.email_send_policy(addr, v_kind) END AS pol
      FROM aud
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
$$;

-- ── 8. Registre super admin : les emails automatiques de Yuno ───────────────
-- Même registre que les push (/admin/notifications) : chaque email automatique
-- historique devient coupable, et s'efface devant une recette qui le couvre.
INSERT INTO public.platform_notification_settings (notification_key, enabled, category)
VALUES
  ('email_missed_you',     true, 'marketing'),
  ('email_next_event_rec', true, 'marketing')
ON CONFLICT (notification_key) DO NOTHING;

-- Deux emails automatiques de Yuno retirés (2026-09-15) : « ta soirée en
-- chiffres » (récap statistique, pas assez premium ; le « merci d'être venu »
-- est désormais une recette, dans le design du pro ou de Yuno) et l'upsell
-- post-achat (redondant : la confirmation de billet porte déjà la commande de
-- boissons). Les fonctions sont supprimées, leurs crons aussi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('send-event-recap-hourly', 'send-upsell-email', 'send-event-recap', 'send-upsell-email-30min');
  END IF;
END $$;

-- ── 9. Purge ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marketing_email_log_purge()
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (DELETE FROM public.marketing_email_log WHERE sent_at < now() - interval '120 days' RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;
REVOKE ALL ON FUNCTION public.marketing_email_log_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketing_email_log_purge() TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'marketing-email-log-purge';
    PERFORM cron.schedule('marketing-email-log-purge', '30 4 * * *', 'SELECT public.marketing_email_log_purge();');
  END IF;
END $$;
