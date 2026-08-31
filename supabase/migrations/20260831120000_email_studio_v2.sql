-- ───────────────────────────────────────────────────────────────────────────
-- Email Studio v2 — audiences multi-segments + exclusions, A/B d'objet,
-- throttling & quiet hours, versionnage du modèle de blocs.
--
-- Ce qui NE change PAS : la file SKIP LOCKED, le marquage en lot, la
-- suppression list à l'enqueue, le disjoncteur. On étend, on ne réécrit pas.
--
-- • email_campaigns : blocks_version (1 = ancien modèle, 2 = Studio),
--   subject_b / ab_* (A/B d'objet), audiences_json / exclusions_json
--   (écran Audience v2), throttle_per_hour / quiet_hours (écran Planification).
-- • email_campaign_recipients.ab_variant : 'a' / 'b' pour la phase de test,
--   NULL = attend le gagnant.
-- • resolve_campaign_audience : corps INTÉGRALEMENT restaté (pattern
--   20260827110200) + chemin multi-audiences. RÈGLE ABSOLUE inchangée : toute
--   audience promotionnelle passe par le JOIN opt-in newsletter ; une
--   condition inconnue ⇒ FAUX (l'audience rétrécit, jamais l'inverse).
-- • count_campaign_audience : net réel (dédoublonné + exclusions + liste de
--   suppression) pour l'affichage live de l'écran Audience.
-- • claim_campaign_recipients : DROP + CREATE (type de retour étendu avec
--   ab_variant) ; pendant la phase de test A/B, les lignes sans variante ne
--   sont pas réclamables tant que le gagnant n'est pas déclaré.
-- • resolve_campaign_ab_winner : déclare le gagnant à l'ouverture, appelé par
--   le cron une fois la fenêtre écoulée.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS blocks_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subject_b text,
  ADD COLUMN IF NOT EXISTS ab_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ab_split_pct integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS ab_window_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS ab_winner text,
  ADD COLUMN IF NOT EXISTS audiences_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exclusions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS throttle_per_hour integer,
  ADD COLUMN IF NOT EXISTS quiet_hours boolean NOT NULL DEFAULT false;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_ab_split_pct_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_ab_split_pct_check
  CHECK (ab_split_pct BETWEEN 10 AND 50);

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_ab_winner_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_ab_winner_check
  CHECK (ab_winner IS NULL OR ab_winner IN ('a','b'));

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_throttle_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_throttle_check
  CHECK (throttle_per_hour IS NULL OR throttle_per_hour >= 50);

ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS ab_variant text;

ALTER TABLE public.email_campaign_recipients
  DROP CONSTRAINT IF EXISTS email_campaign_recipients_ab_variant_check;
ALTER TABLE public.email_campaign_recipients
  ADD CONSTRAINT email_campaign_recipients_ab_variant_check
  CHECK (ab_variant IS NULL OR ab_variant IN ('a','b'));

-- Throttle horaire + fenêtre A/B : les deux comptent les envois récents.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_sent_at
  ON public.email_campaign_recipients (campaign_id, sent_at)
  WHERE status = 'sent';

-- ── 2. resolve_campaign_audience v2 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := (v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- INFORMATIONAL : acheteurs / tables / tous (inchangé — audience unique)
  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  -- PROMOTIONAL : opt-in newsletter requis, TOUJOURS
  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  -- ── Chemin v2 : multi-audiences + exclusions (audiences_json non vide) ────
  IF jsonb_typeof(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) > 0 THEN

    v_audiences := v_campaign.audiences_json;
    -- Casts défensifs : une valeur malformée ne doit jamais faire échouer la
    -- résolution d'audience — elle est simplement ignorée.
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        -- Pré-matérialise l'union des segments sauvegardés sélectionnés.
        SELECT DISTINCT LOWER(seg.email) AS addr
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
               COALESCE(p.first_name, vc.first_name) AS fname,
               COALESCE(p.last_name,  vc.last_name)  AS lname,
               ns.user_id AS uid, ns.unsubscribe_token AS tok,
               COALESCE(vc.total_spent, 0) AS spent,
               (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) AS visits,
               vc.last_visit_at AS last_visit
          FROM public.newsletter_subscriptions ns
          LEFT JOIN public.venue_customers vc
            ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_audiences) a
            WHERE CASE a->>'kind'
              WHEN 'all_subscribers' THEN true
              WHEN 'vip'           THEN s.spent >= 500
              WHEN 'big_spenders'  THEN s.spent >= 1000
              WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
              WHEN 'new_customers' THEN s.visits <= 1
              WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
              WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.tickets t
                      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                        AND LOWER(t.user_email) = s.addr)
              WHEN 'segment' THEN s.addr IN (SELECT se.addr FROM seg_emails se)
              ELSE false
            END)
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id
                  AND r.status = 'sent'
                  AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                  AND LOWER(r.email) = m.addr))
         AND (NOT v_excl_buyers OR (
               NOT EXISTS (SELECT 1 FROM public.tickets t
                            WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                              AND LOWER(t.user_email) = m.addr)
               AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                            WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                              AND LOWER(tr.user_email) = m.addr)));
      RETURN;
    END IF;

    -- Branche organisateur : agrégation billets de ses soirées (les segments
    -- sauvegardés sont venue-only → 'segment' ⇒ FAUX ici).
    RETURN QUERY
    WITH agg AS (
      SELECT LOWER(t.user_email) AS addr,
             SUM(t.total_price)::numeric AS spent,
             COUNT(DISTINCT t.event_id) AS visits,
             MAX(t.created_at) AS last_seen,
             MAX(t.full_name) AS full_name
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
       WHERE t.status = 'paid' AND t.user_email IS NOT NULL
         AND (e.organizer_user_id = v_campaign.organizer_user_id
              OR e.partner_organizer_id = v_campaign.organizer_user_id)
       GROUP BY LOWER(t.user_email)
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(p.first_name, SPLIT_PART(COALESCE(a.full_name,''), ' ', 1)) AS fname,
             COALESCE(p.last_name,
                      NULLIF(REGEXP_REPLACE(COALESCE(a.full_name,''), '^\S+\s*', ''), '')) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_audiences) a2
          WHERE CASE a2->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'vip'           THEN s.spent >= 500
            WHEN 'big_spenders'  THEN s.spent >= 1000
            WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
            WHEN 'new_customers' THEN s.visits <= 1
            WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
            WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                      AND LOWER(t.user_email) = s.addr)
            ELSE false
          END)
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
    RETURN;
  END IF;

  -- ── Chemins hérités (audience unique, inchangés depuis 20260827110200) ────
  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  -- SEGMENT SAUVEGARDÉ (clubs uniquement) : resolve_venue_segment ∩ opt-in.
  -- Le JOIN sur newsletter_subscriptions est la porte de consentement — ne
  -- JAMAIS le retirer ni le remplacer par un LEFT JOIN.
  IF v_campaign.audience_type = 'custom_segment' THEN
    IF v_campaign.venue_id IS NULL OR v_campaign.segment_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text,
      COALESCE(p.first_name, vc.first_name)::text,
      COALESCE(p.last_name, vc.last_name)::text,
      ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.resolve_venue_segment(
           v_campaign.venue_id,
           (SELECT vs.definition FROM public.venue_segments vs
             WHERE vs.id = v_campaign.segment_id AND vs.venue_id = v_campaign.venue_id)
         ) seg ON LOWER(seg.email) = LOWER(ns.email)
    LEFT JOIN public.venue_customers vc
      ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true;
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT LOWER(t.user_email) AS email,
             SUM(t.total_price)::numeric AS spent,
             COUNT(DISTINCT t.event_id) AS visits,
             MAX(t.created_at) AS last_seen,
             MAX(t.full_name) AS full_name
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      WHERE t.status = 'paid' AND t.user_email IS NOT NULL
        AND (e.organizer_user_id = v_campaign.organizer_user_id OR e.partner_organizer_id = v_campaign.organizer_user_id)
      GROUP BY LOWER(t.user_email)
    )
    SELECT a.email::text,
           SPLIT_PART(COALESCE(a.full_name,''), ' ', 1)::text,
           NULLIF(REGEXP_REPLACE(COALESCE(a.full_name,''), '^\S+\s*', ''), '')::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
    RETURN;
  END IF;
END;
$$;

-- ── 3. Net réel pour l'écran Audience ───────────────────────────────────────
-- Dédoublonné + exclusions (déjà appliquées dans resolve) + suppression list.
CREATE OR REPLACE FUNCTION public.count_campaign_audience(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gross integer := 0;
  v_net integer := 0;
BEGIN
  -- L'autorisation est portée par resolve_campaign_audience (RAISE si non
  -- propriétaire de la campagne).
  SELECT count(*), count(*) FILTER (WHERE NOT public.is_email_suppressed(addr))
    INTO v_gross, v_net
    FROM (
      SELECT DISTINCT LOWER(a.email) AS addr
        FROM public.resolve_campaign_audience(p_campaign_id) a
       WHERE a.email IS NOT NULL AND position('@' in a.email) > 1
    ) d;

  RETURN jsonb_build_object(
    'gross', v_gross,
    'net', v_net,
    'suppressed', v_gross - v_net
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_campaign_audience(uuid) TO authenticated, service_role;

-- ── 4. Claim A/B-aware ───────────────────────────────────────────────────────
-- Le type de retour change (ab_variant) → DROP puis CREATE, comme le pattern
-- count_campaign_recipients de 20260827110200.
DROP FUNCTION IF EXISTS public.claim_campaign_recipients(uuid, integer);

CREATE FUNCTION public.claim_campaign_recipients(
  p_campaign_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(email text, first_name text, last_name text, unsubscribe_token uuid, attempts integer, ab_variant text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_campaign_recipients: service_role only';
  END IF;

  -- Phase de test A/B en cours : seules les lignes avec variante sont
  -- réclamables. Le reste attend le gagnant.
  SELECT (c.ab_enabled AND COALESCE(c.subject_b, '') <> '' AND c.ab_winner IS NULL)
    INTO v_gate
    FROM public.email_campaigns c WHERE c.id = p_campaign_id;

  RETURN QUERY
  WITH picked AS (
    SELECT r.id
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.status = 'pending'
       AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
       AND (NOT COALESCE(v_gate, false) OR r.ab_variant IS NOT NULL)
     ORDER BY r.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_campaign_recipients r
     SET status = 'sending',
         claimed_at = now(),
         attempts = r.attempts + 1
    FROM picked
   WHERE r.id = picked.id
  RETURNING r.email, r.first_name, r.last_name, r.unsubscribe_token, r.attempts, r.ab_variant;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, integer) TO service_role;

-- ── 5. Assignation des variantes A/B à l'enqueue ─────────────────────────────
-- Déterministe (md5 email+campagne) : rejouer l'enqueue ne rebrasse pas les
-- variantes. split_pct = part du total en phase de test, moitié A moitié B.
CREATE OR REPLACE FUNCTION public.assign_campaign_ab_variants(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_assigned integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'assign_campaign_ab_variants: service_role only';
  END IF;

  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL OR NOT c.ab_enabled OR COALESCE(c.subject_b, '') = '' OR c.ab_winner IS NOT NULL THEN
    RETURN 0;
  END IF;

  WITH ranked AS (
    SELECT r.id,
           row_number() OVER (ORDER BY md5(LOWER(r.email) || p_campaign_id::text)) AS rn,
           count(*) OVER () AS total
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.status = 'pending'
       AND r.ab_variant IS NULL
  ), sized AS (
    SELECT id, rn,
           GREATEST(2, CEIL(total * c.ab_split_pct / 100.0))::bigint AS test_n
      FROM ranked
  ), upd AS (
    UPDATE public.email_campaign_recipients r
       SET ab_variant = CASE
             WHEN s.rn * 2 <= s.test_n THEN 'a'
             WHEN s.rn <= s.test_n THEN 'b'
             ELSE NULL
           END
      FROM sized s
     WHERE r.id = s.id AND s.rn <= s.test_n
    RETURNING 1
  )
  SELECT count(*) INTO v_assigned FROM upd;

  RETURN v_assigned;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_campaign_ab_variants(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_campaign_ab_variants(uuid) TO service_role;

-- ── 6. Gagnant A/B à l'ouverture ─────────────────────────────────────────────
-- Appelé par le cron. Ne déclare le gagnant qu'une fois la phase de test
-- entièrement partie ET la fenêtre écoulée (sauf p_force). Égalité → 'a'.
CREATE OR REPLACE FUNCTION public.resolve_campaign_ab_winner(
  p_campaign_id uuid,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_pending_test integer := 0;
  v_last_test_sent timestamptz;
  v_sent_a integer := 0;
  v_sent_b integer := 0;
  v_opens_a integer := 0;
  v_opens_b integer := 0;
  v_winner text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'resolve_campaign_ab_winner: service_role only';
  END IF;

  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL OR NOT c.ab_enabled OR COALESCE(c.subject_b, '') = '' THEN
    RETURN jsonb_build_object('resolved', false, 'reason', 'not_ab');
  END IF;
  IF c.ab_winner IS NOT NULL THEN
    RETURN jsonb_build_object('resolved', true, 'winner', c.ab_winner, 'reason', 'already');
  END IF;

  SELECT count(*) FILTER (WHERE status IN ('pending','sending')),
         MAX(sent_at) FILTER (WHERE status = 'sent')
    INTO v_pending_test, v_last_test_sent
    FROM public.email_campaign_recipients
   WHERE campaign_id = p_campaign_id AND ab_variant IS NOT NULL;

  IF NOT p_force THEN
    IF v_pending_test > 0 THEN
      RETURN jsonb_build_object('resolved', false, 'reason', 'test_in_flight');
    END IF;
    IF v_last_test_sent IS NULL
       OR v_last_test_sent + make_interval(mins => GREATEST(5, c.ab_window_minutes)) > now() THEN
      RETURN jsonb_build_object('resolved', false, 'reason', 'window_open',
        'resolves_at', v_last_test_sent + make_interval(mins => GREATEST(5, c.ab_window_minutes)));
    END IF;
  END IF;

  SELECT count(*) FILTER (WHERE r.ab_variant = 'a'),
         count(*) FILTER (WHERE r.ab_variant = 'b')
    INTO v_sent_a, v_sent_b
    FROM public.email_campaign_recipients r
   WHERE r.campaign_id = p_campaign_id AND r.status = 'sent';

  SELECT count(DISTINCT LOWER(ev.recipient_email)) FILTER (WHERE r.ab_variant = 'a'),
         count(DISTINCT LOWER(ev.recipient_email)) FILTER (WHERE r.ab_variant = 'b')
    INTO v_opens_a, v_opens_b
    FROM public.email_campaign_events ev
    JOIN public.email_campaign_recipients r
      ON r.campaign_id = ev.campaign_id AND LOWER(r.email) = LOWER(ev.recipient_email)
   WHERE ev.campaign_id = p_campaign_id AND ev.event_type = 'opened';

  -- Taux d'ouverture comparés ; à envoi nul ou égalité stricte, A gagne.
  v_winner := CASE
    WHEN v_sent_b = 0 THEN 'a'
    WHEN v_sent_a = 0 THEN 'b'
    WHEN (v_opens_b::numeric / v_sent_b) > (v_opens_a::numeric / v_sent_a) THEN 'b'
    ELSE 'a'
  END;

  UPDATE public.email_campaigns SET ab_winner = v_winner WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'resolved', true, 'winner', v_winner,
    'sent_a', v_sent_a, 'sent_b', v_sent_b,
    'opens_a', v_opens_a, 'opens_b', v_opens_b
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_campaign_ab_winner(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_ab_winner(uuid, boolean) TO service_role;
