-- ───────────────────────────────────────────────────────────────────────────
-- Audience email « custom_segment » — les segments sauvegardés arrivent dans
-- les campagnes email (clubs uniquement, v1).
--
-- • email_campaigns.segment_id → venue_segments (SET NULL si le segment meurt :
--   la campagne draft redevient sans audience plutôt que de casser).
-- • CHECK audience_type recréé avec 'custom_segment' (pattern 20260428105834).
-- • resolve_campaign_audience : corps INTÉGRALEMENT restaté depuis
--   20260428104539 + la branche custom_segment. RÈGLE ABSOLUE : la branche
--   est dans la section promotionnelle et JOINt l'opt-in newsletter — un
--   client qui matche le segment mais n'est pas abonné ne reçoit RIEN.
-- • count_campaign_recipients : + p_segment_id. DROP puis CREATE (et non
--   OR REPLACE) : ajouter un paramètre par défaut créerait une SURCHARGE à
--   côté de l'ancienne signature, et PostgREST ne saurait plus résoudre les
--   appels existants à 4 arguments nommés (ambiguïté 300).
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES public.venue_segments(id) ON DELETE SET NULL;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_audience_type_check;

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_audience_type_check
  CHECK (audience_type IN (
    'all_subscribers','event_subscribers','event_buyers',
    'event_table_buyers','event_all_buyers',
    'vip','big_spenders','regulars','new_customers','dormant',
    'custom_segment'
  ));

-- ── resolve_campaign_audience : corps complet + branche custom_segment ───────
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := (v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  -- send-campaign (chemin cron/scheduled) appelle avec le client service.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- INFORMATIONAL : acheteurs / tables / tous
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

  -- PROMOTIONAL : opt-in newsletter requis
  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

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
    -- Branche venue : utilise venue_customers
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

    -- Branche organizer : agrégation des tickets de leurs events
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

-- ── count_campaign_recipients : + p_segment_id (DROP, pas de surcharge) ──────
DROP FUNCTION public.count_campaign_recipients(text, text, text, uuid);

CREATE FUNCTION public.count_campaign_recipients(
  p_venue_id text,
  p_type text,
  p_audience_type text,
  p_event_id uuid DEFAULT NULL,
  p_segment_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Informational: acheteurs ticket d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.tickets
    WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: réservations table d'un événement
  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.table_reservations
    WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  -- Informational: tous les acheteurs (ticket + table)
  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  -- Marketing: filtrage commun = abonnés opt-in venue
  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE venue_id = p_venue_id AND opted_in = true;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.venue_id = p_venue_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true;
    ELSIF p_audience_type = 'custom_segment' AND p_segment_id IS NOT NULL THEN
      -- Segment sauvegardé ∩ opt-in : même intersection que resolve_campaign_audience.
      SELECT COUNT(DISTINCT LOWER(ns.email)) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.resolve_venue_segment(
             p_venue_id,
             (SELECT vs.definition FROM public.venue_segments vs
               WHERE vs.id = p_segment_id AND vs.venue_id = p_venue_id)
           ) seg ON LOWER(seg.email) = LOWER(ns.email)
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true;
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc
        ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = p_venue_id
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true
        AND CASE p_audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(uuid) TO authenticated, service_role;
