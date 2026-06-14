-- Customer segmentation (RFM aggregates) + club-internal email-level ban + staff warn/ban flow
-- Part of the owner "Clients" page overhaul. All objects stay strictly venue-scoped.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. venue_banned_emails: email-level ban registry, independent of accounts.
--    Covers guest checkout + new-account evasion + walk-ins with no Yuno account.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_banned_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  email TEXT NOT NULL,                 -- always stored lower-cased
  banned_by UUID,
  ban_reason TEXT,
  banned_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (venue_id, email)
);

CREATE INDEX IF NOT EXISTS idx_venue_banned_emails_lookup
  ON public.venue_banned_emails (venue_id, email);

ALTER TABLE public.venue_banned_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage banned emails"
  ON public.venue_banned_emails FOR ALL
  USING (is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (is_venue_owner(auth.uid(), venue_id));

CREATE POLICY "Managers view banned emails"
  ON public.venue_banned_emails FOR SELECT
  USING (manager_has_permission(auth.uid(), venue_id, 'analytics'));

CREATE POLICY "Bouncers view banned emails"
  ON public.venue_banned_emails FOR SELECT
  USING (has_role(auth.uid(), 'bouncer') AND venue_id = get_user_venue_id(auth.uid()));

CREATE POLICY "Bouncers insert banned emails"
  ON public.venue_banned_emails FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'bouncer') AND venue_id = get_user_venue_id(auth.uid()));

CREATE POLICY "Super admins manage banned emails"
  ON public.venue_banned_emails FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ───────────────────────────────────────────────────────────────────────────
-- 2. is_email_banned: used by the 3 checkout edge functions. Scoped per venue,
--    so a ban at club A never leaks to club B.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_email_banned(p_venue_id TEXT, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM venue_banned_emails
    WHERE venue_id = p_venue_id AND email = lower(p_email)
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Authorization helper for staff flagging actions (owner / manager / bouncer).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_staff_flag_venue(p_venue_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_super_admin()
    OR is_venue_owner(auth.uid(), p_venue_id)
    OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')
    OR (has_role(auth.uid(), 'bouncer') AND get_user_venue_id(auth.uid()) = p_venue_id);
$$;

-- Resolve an existing venue_customer id by user_id then by email (no creation).
CREATE OR REPLACE FUNCTION public.resolve_venue_customer(p_venue_id TEXT, p_user_id UUID, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT id INTO v_id FROM venue_customers
      WHERE venue_id = p_venue_id AND user_id = p_user_id LIMIT 1;
  END IF;
  IF v_id IS NULL AND p_email IS NOT NULL THEN
    SELECT id INTO v_id FROM venue_customers
      WHERE venue_id = p_venue_id AND lower(email) = lower(p_email) LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. staff_warn_customer: records a real 'warning' incident (no ticket cancel).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_warn_customer(
  p_venue_id TEXT, p_user_id UUID, p_email TEXT, p_reason TEXT,
  p_details TEXT DEFAULT NULL, p_first_name TEXT DEFAULT NULL, p_last_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_customer_id UUID;
BEGIN
  IF NOT can_staff_flag_venue(p_venue_id) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  v_customer_id := resolve_venue_customer(p_venue_id, p_user_id, p_email);
  IF v_customer_id IS NULL AND p_user_id IS NOT NULL THEN
    v_customer_id := get_or_create_venue_customer(p_venue_id, p_user_id, p_email, p_first_name, p_last_name, NULL);
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Cannot warn a customer with no Yuno account' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO customer_incidents (venue_customer_id, venue_id, reported_by, incident_type, reason, details)
  VALUES (v_customer_id, p_venue_id, auth.uid(), 'warning', p_reason, p_details);

  RETURN v_customer_id;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. staff_ban_customer: email-level ban + account ban (when resolvable) + incident.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_ban_customer(
  p_venue_id TEXT, p_user_id UUID, p_email TEXT, p_reason TEXT,
  p_first_name TEXT DEFAULT NULL, p_last_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_customer_id UUID;
BEGIN
  IF NOT can_staff_flag_venue(p_venue_id) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  -- Email-level ban (covers guest checkout / new account / no account).
  IF p_email IS NOT NULL AND length(trim(p_email)) > 0 THEN
    INSERT INTO venue_banned_emails (venue_id, email, banned_by, ban_reason)
    VALUES (p_venue_id, lower(p_email), auth.uid(), p_reason)
    ON CONFLICT (venue_id, email)
    DO UPDATE SET banned_by = EXCLUDED.banned_by, ban_reason = EXCLUDED.ban_reason, banned_at = now();
  END IF;

  -- Account-level ban + incident when we can tie it to a venue_customer.
  v_customer_id := resolve_venue_customer(p_venue_id, p_user_id, p_email);
  IF v_customer_id IS NULL AND p_user_id IS NOT NULL THEN
    v_customer_id := get_or_create_venue_customer(p_venue_id, p_user_id, p_email, p_first_name, p_last_name, NULL);
  END IF;

  IF v_customer_id IS NOT NULL THEN
    UPDATE venue_customers
      SET is_banned = true, banned_at = now(), banned_by = auth.uid(), ban_reason = p_reason
      WHERE id = v_customer_id;
    INSERT INTO customer_incidents (venue_customer_id, venue_id, reported_by, incident_type, reason)
    VALUES (v_customer_id, p_venue_id, auth.uid(), 'ban', p_reason);
  END IF;

  RETURN v_customer_id;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. staff_unban_customer: lift email + account ban.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_unban_customer(
  p_venue_id TEXT, p_user_id UUID, p_email TEXT, p_reason TEXT DEFAULT 'Manual unban'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_customer_id UUID;
BEGIN
  IF NOT can_staff_flag_venue(p_venue_id) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  IF p_email IS NOT NULL THEN
    DELETE FROM venue_banned_emails WHERE venue_id = p_venue_id AND email = lower(p_email);
  END IF;

  v_customer_id := resolve_venue_customer(p_venue_id, p_user_id, p_email);
  IF v_customer_id IS NOT NULL THEN
    UPDATE venue_customers
      SET is_banned = false, banned_at = NULL, banned_by = NULL, ban_reason = NULL
      WHERE id = v_customer_id;
    INSERT INTO customer_incidents (venue_customer_id, venue_id, reported_by, incident_type, reason)
    VALUES (v_customer_id, p_venue_id, auth.uid(), 'unban', p_reason);
  END IF;

  RETURN v_customer_id;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. get_venue_customer_segments: enriches venue_customers with RFM aggregates
--    computed from raw paid activity (tickets / orders / table_reservations)
--    across this venue's events. Relative scoring is done client-side.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_customer_segments(p_venue_id TEXT)
RETURNS TABLE (
  id UUID, user_id UUID, email TEXT, first_name TEXT, last_name TEXT, phone TEXT,
  first_visit_at TIMESTAMPTZ, last_visit_at TIMESTAMPTZ, total_spent NUMERIC,
  ticket_count INTEGER, order_count INTEGER, table_count INTEGER,
  is_banned BOOLEAN, banned_at TIMESTAMPTZ, ban_reason TEXT, notes TEXT,
  revenue_30d NUMERIC, revenue_90d NUMERIC, revenue_prev_90d NUMERIC,
  avg_basket NUMERIC, visit_nights INTEGER, visits_per_month NUMERIC,
  last_activity_at TIMESTAMPTZ, preferred_dow INTEGER, preferred_event_title TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_super_admin()
          OR is_venue_owner(auth.uid(), p_venue_id)
          OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH venue_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
  ),
  activity AS (
    SELECT lower(t.user_email) AS em, t.total_price::numeric AS amount, t.created_at, t.event_id
    FROM tickets t JOIN venue_events ve ON ve.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(o.user_email), o.total::numeric, o.created_at, o.event_id
    FROM orders o
    WHERE o.venue_id = p_venue_id AND o.user_email IS NOT NULL AND o.status = 'paid'
    UNION ALL
    SELECT lower(tr.user_email), tr.total_price::numeric, tr.created_at, tr.event_id
    FROM table_reservations tr JOIN venue_events ve ON ve.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(avg(a.amount), 0) AS avg_basket,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  event_activity AS (
    SELECT a.em, a.event_id, ve.start_at, ve.title, count(*) AS cnt
    FROM activity a JOIN venue_events ve ON ve.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, ve.start_at, ve.title
  ),
  pref_event AS (
    SELECT DISTINCT ON (ea.em) ea.em, ea.title AS preferred_event_title
    FROM event_activity ea ORDER BY ea.em, ea.cnt DESC, ea.start_at DESC
  ),
  pref_dow AS (
    SELECT s.em, s.dow FROM (
      SELECT ea.em, extract(dow FROM ea.start_at)::int AS dow,
             row_number() OVER (PARTITION BY ea.em ORDER BY sum(ea.cnt) DESC) AS rn
      FROM event_activity ea GROUP BY ea.em, extract(dow FROM ea.start_at)
    ) s WHERE s.rn = 1
  )
  SELECT
    vc.id, vc.user_id, vc.email, vc.first_name, vc.last_name, vc.phone,
    vc.first_visit_at, vc.last_visit_at, vc.total_spent,
    vc.ticket_count, vc.order_count, vc.table_count,
    vc.is_banned, vc.banned_at, vc.ban_reason, vc.notes,
    ag.revenue_30d, ag.revenue_90d, ag.revenue_prev_90d, ag.avg_basket,
    COALESCE(ag.visit_nights, 0)::int AS visit_nights,
    CASE
      WHEN ag.first_activity_at IS NULL THEN 0
      ELSE round(
        ag.visit_nights::numeric /
        greatest(1, extract(epoch FROM (ag.last_activity_at - ag.first_activity_at)) / 2592000.0),
        2)
    END AS visits_per_month,
    ag.last_activity_at, pd.dow AS preferred_dow, pe.preferred_event_title
  FROM venue_customers vc
  LEFT JOIN agg ag ON ag.em = lower(vc.email)
  LEFT JOIN pref_event pe ON pe.em = lower(vc.email)
  LEFT JOIN pref_dow pd ON pd.em = lower(vc.email)
  WHERE vc.venue_id = p_venue_id
  ORDER BY vc.last_visit_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_email_banned(TEXT, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.can_staff_flag_venue(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_venue_customer(TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_warn_customer(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_ban_customer(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_unban_customer(TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_venue_customer_segments(TEXT) TO authenticated;
