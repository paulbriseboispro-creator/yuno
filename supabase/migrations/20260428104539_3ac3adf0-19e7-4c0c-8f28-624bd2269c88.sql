-- 1. Table snapshot des destinataires
CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  user_id uuid,
  unsubscribe_token uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','bounced','complained','suppressed')),
  resend_email_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_recipient_email
  ON public.email_campaign_recipients(campaign_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status
  ON public.email_campaign_recipients(campaign_id, status);

ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners view campaign recipients" ON public.email_campaign_recipients;
CREATE POLICY "Owners view campaign recipients"
  ON public.email_campaign_recipients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.email_campaigns c
      WHERE c.id = campaign_id
        AND (
          (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid())
          OR public.is_super_admin()
        )
    )
  );

-- 2. RPC count étendu pour clubs (segments CRM)
CREATE OR REPLACE FUNCTION public.count_campaign_recipients(
  p_venue_id text,
  p_type text,
  p_audience_type text,
  p_event_id uuid DEFAULT NULL
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

-- 3. RPC count étendu pour orgas (mêmes segments, basés sur tickets/events de l'orga)
CREATE OR REPLACE FUNCTION public.count_campaign_recipients_org(
  p_organizer_user_id uuid,
  p_type text,
  p_audience_type text,
  p_event_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND t.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(tr.user_email)) INTO v_count
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE tr.event_id = p_event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH allowed AS (
      SELECT id FROM public.events
      WHERE id = p_event_id
        AND (organizer_user_id = p_organizer_user_id OR partner_organizer_id = p_organizer_user_id)
    ), emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id IN (SELECT id FROM allowed) AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id IN (SELECT id FROM allowed) AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE organizer_user_id = p_organizer_user_id AND opted_in = true;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.organizer_user_id = p_organizer_user_id
      JOIN public.events e ON e.id = t.event_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true
        AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      WITH agg AS (
        SELECT LOWER(t.user_email) AS email,
               SUM(t.total_price)::numeric AS spent,
               COUNT(DISTINCT t.event_id) AS visits,
               MAX(t.created_at) AS last_seen
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE t.status = 'paid' AND t.user_email IS NOT NULL
          AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)
        GROUP BY LOWER(t.user_email)
      )
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN agg a ON a.email = LOWER(ns.email)
      WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true
        AND CASE p_audience_type
          WHEN 'vip' THEN a.spent >= 500
          WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
          WHEN 'new_customers' THEN a.visits = 1
          WHEN 'big_spenders' THEN a.spent >= 1000
          WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

-- 4. RPC qui retourne la liste détaillée des destinataires pour une campagne
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

GRANT EXECUTE ON FUNCTION public.count_campaign_recipients(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_campaign_recipients_org(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(uuid) TO authenticated;