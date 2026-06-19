-- Organizer "Clients" page — full mirror of the owner CRM, scoped to the
-- organizer instead of a venue.
--
-- Owners get RFM segmentation (get_venue_customer_segments), email bans
-- (venue_banned_emails) and incidents (customer_incidents), all keyed on the
-- persistent venue_customers table. Organizers have NO venue_customers base, so
-- here the customer rows are built directly from the organizer's paid activity
-- (tickets + table_reservations — organizers never sell drinks), and the ban /
-- incident / notes registries are keyed by lowercased email.
--
-- Isolation mirrors the venue model: an organizer ban only affects that
-- organizer's events, never another organizer or a club.

-- ───────────────────────────────────────────────────────────────────────────
-- 0. Authorization helper: the organizer themselves, an org admin, or a superadmin.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_organizer(p_organizer_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    is_super_admin()
    OR p_organizer_user_id = auth.uid()
    OR is_org_team_member(auth.uid(), p_organizer_user_id, 'admin');
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. organizer_banned_emails: email-level ban registry, scoped to one organizer.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizer_banned_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id UUID NOT NULL,
  email TEXT NOT NULL,                 -- always stored lower-cased
  banned_by UUID,
  ban_reason TEXT,
  banned_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organizer_user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_organizer_banned_emails_lookup
  ON public.organizer_banned_emails (organizer_user_id, email);
ALTER TABLE public.organizer_banned_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Organizer manages own banned emails"
  ON public.organizer_banned_emails FOR ALL
  USING (can_manage_organizer(organizer_user_id))
  WITH CHECK (can_manage_organizer(organizer_user_id));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. organizer_customer_incidents: warning / ban / unban / note timeline,
--    keyed by email (no venue_customer to anchor to).
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizer_customer_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id UUID NOT NULL,
  email TEXT NOT NULL,                 -- always stored lower-cased
  reported_by UUID NOT NULL,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('warning', 'ban', 'unban', 'note')),
  reason TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_incidents_lookup
  ON public.organizer_customer_incidents (organizer_user_id, email);
ALTER TABLE public.organizer_customer_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Organizer manages own incidents"
  ON public.organizer_customer_incidents FOR ALL
  USING (can_manage_organizer(organizer_user_id))
  WITH CHECK (can_manage_organizer(organizer_user_id));

-- ───────────────────────────────────────────────────────────────────────────
-- 3. organizer_customer_notes: free-text note per customer email.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizer_customer_notes (
  organizer_user_id UUID NOT NULL,
  email TEXT NOT NULL,                 -- always stored lower-cased
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (organizer_user_id, email)
);
ALTER TABLE public.organizer_customer_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Organizer manages own customer notes"
  ON public.organizer_customer_notes FOR ALL
  USING (can_manage_organizer(organizer_user_id))
  WITH CHECK (can_manage_organizer(organizer_user_id));

-- ───────────────────────────────────────────────────────────────────────────
-- 4. is_email_banned_org: org-scoped checkout guard (mirrors is_email_banned).
--    Wiring into the organizer checkout edge functions is deferred (edge deploy
--    cap), but the predicate is available now for when it lands.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_email_banned_org(p_organizer_user_id UUID, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM organizer_banned_emails
    WHERE organizer_user_id = p_organizer_user_id AND email = lower(p_email)
  );
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. organizer_warn_customer / ban / unban — mirror the staff_* flow.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organizer_warn_customer(
  p_organizer_user_id UUID, p_email TEXT, p_reason TEXT, p_details TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Email required' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO organizer_customer_incidents (organizer_user_id, email, reported_by, incident_type, reason, details)
  VALUES (p_organizer_user_id, lower(p_email), auth.uid(), 'warning', p_reason, p_details);
END;
$$;

CREATE OR REPLACE FUNCTION public.organizer_ban_customer(
  p_organizer_user_id UUID, p_email TEXT, p_reason TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Email required' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO organizer_banned_emails (organizer_user_id, email, banned_by, ban_reason)
  VALUES (p_organizer_user_id, lower(p_email), auth.uid(), p_reason)
  ON CONFLICT (organizer_user_id, email)
  DO UPDATE SET banned_by = EXCLUDED.banned_by, ban_reason = EXCLUDED.ban_reason, banned_at = now();
  INSERT INTO organizer_customer_incidents (organizer_user_id, email, reported_by, incident_type, reason)
  VALUES (p_organizer_user_id, lower(p_email), auth.uid(), 'ban', p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.organizer_unban_customer(
  p_organizer_user_id UUID, p_email TEXT, p_reason TEXT DEFAULT 'Manual unban'
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;
  DELETE FROM organizer_banned_emails WHERE organizer_user_id = p_organizer_user_id AND email = lower(p_email);
  INSERT INTO organizer_customer_incidents (organizer_user_id, email, reported_by, incident_type, reason)
  VALUES (p_organizer_user_id, lower(p_email), auth.uid(), 'unban', p_reason);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. organizer_save_customer_note: upsert free-text note.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organizer_save_customer_note(
  p_organizer_user_id UUID, p_email TEXT, p_notes TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;
  INSERT INTO organizer_customer_notes (organizer_user_id, email, notes, updated_at, updated_by)
  VALUES (p_organizer_user_id, lower(p_email), p_notes, now(), auth.uid())
  ON CONFLICT (organizer_user_id, email)
  DO UPDATE SET notes = EXCLUDED.notes, updated_at = now(), updated_by = auth.uid();
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. get_organizer_customer_segments: RFM aggregates built from the organizer's
--    paid tickets + table reservations. Club revenue excludes Yuno fees, exactly
--    like get_venue_customer_segments. Relative RFM scoring is done client-side.
--    `id` is the lowercased email (no venue_customers surrogate key).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_organizer_customer_segments(p_organizer_user_id UUID)
RETURNS TABLE (
  id TEXT, user_id UUID, email TEXT, first_name TEXT, last_name TEXT, phone TEXT,
  first_visit_at TIMESTAMPTZ, last_visit_at TIMESTAMPTZ, total_spent NUMERIC,
  ticket_count INTEGER, order_count INTEGER, table_count INTEGER,
  is_banned BOOLEAN, banned_at TIMESTAMPTZ, ban_reason TEXT, notes TEXT,
  revenue_30d NUMERIC, revenue_90d NUMERIC, revenue_prev_90d NUMERIC,
  avg_basket NUMERIC, visit_nights INTEGER, visits_per_month NUMERIC,
  last_activity_at TIMESTAMPTZ, preferred_dow INTEGER, preferred_event_title TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_organizer(p_organizer_user_id) THEN
    RAISE EXCEPTION 'Not authorized for organizer %', p_organizer_user_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH organizer_events AS (
    SELECT e.id, e.start_at, e.title
    FROM events e
    WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
  ),
  -- Club revenue = amount charged − Yuno fees (tickets + tables only).
  activity AS (
    SELECT lower(t.user_email) AS em,
           (t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0))::numeric AS amount,
           t.created_at, t.event_id, 'ticket'::text AS kind,
           t.user_id, t.full_name, t.guest_first_name, t.guest_last_name,
           COALESCE(t.phone, t.guest_phone) AS phone
    FROM tickets t JOIN organizer_events oe ON oe.id = t.event_id
    WHERE t.user_email IS NOT NULL AND t.paid_at IS NOT NULL
    UNION ALL
    SELECT lower(tr.user_email),
           (tr.total_price - COALESCE(tr.service_fee, 0) - COALESCE(tr.management_fee, 0))::numeric,
           tr.created_at, tr.event_id, 'table'::text,
           tr.user_id, tr.full_name, tr.guest_first_name, tr.guest_last_name,
           COALESCE(tr.phone, tr.guest_phone)
    FROM table_reservations tr JOIN organizer_events oe ON oe.id = tr.event_id
    WHERE tr.user_email IS NOT NULL AND tr.paid_at IS NOT NULL
  ),
  agg AS (
    SELECT a.em,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '30 days'), 0) AS revenue_30d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '90 days'), 0) AS revenue_90d,
      COALESCE(sum(a.amount) FILTER (WHERE a.created_at >= now() - interval '180 days'
                                       AND a.created_at < now() - interval '90 days'), 0) AS revenue_prev_90d,
      COALESCE(sum(a.amount), 0) AS total_spent,
      COALESCE(avg(a.amount), 0) AS avg_basket,
      count(*) FILTER (WHERE a.kind = 'ticket') AS ticket_count,
      count(*) FILTER (WHERE a.kind = 'table') AS table_count,
      count(DISTINCT date(a.created_at)) AS visit_nights,
      max(a.created_at) AS last_activity_at,
      min(a.created_at) AS first_activity_at
    FROM activity a GROUP BY a.em
  ),
  ident AS (
    SELECT DISTINCT ON (a.em) a.em, a.user_id, a.full_name, a.guest_first_name, a.guest_last_name, a.phone
    FROM activity a ORDER BY a.em, a.created_at DESC
  ),
  event_activity AS (
    SELECT a.em, a.event_id, oe.start_at, oe.title, count(*) AS cnt
    FROM activity a JOIN organizer_events oe ON oe.id = a.event_id
    WHERE a.event_id IS NOT NULL
    GROUP BY a.em, a.event_id, oe.start_at, oe.title
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
    ag.em AS id,
    COALESCE(id_.user_id, p.id) AS user_id,
    ag.em AS email,
    COALESCE(p.first_name, id_.guest_first_name,
             NULLIF(split_part(COALESCE(id_.full_name, ''), ' ', 1), '')) AS first_name,
    COALESCE(p.last_name, id_.guest_last_name,
             NULLIF(substr(COALESCE(id_.full_name, ''), strpos(COALESCE(id_.full_name, '') || ' ', ' ') + 1), '')) AS last_name,
    COALESCE(p.phone, id_.phone) AS phone,
    ag.first_activity_at AS first_visit_at,
    ag.last_activity_at AS last_visit_at,
    round(ag.total_spent, 2) AS total_spent,
    ag.ticket_count::int, 0 AS order_count, ag.table_count::int,
    (b.email IS NOT NULL) AS is_banned, b.banned_at, b.ban_reason, n.notes,
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
  FROM agg ag
  LEFT JOIN ident id_ ON id_.em = ag.em
  LEFT JOIN profiles p ON lower(p.email) = ag.em
  LEFT JOIN organizer_banned_emails b ON b.organizer_user_id = p_organizer_user_id AND b.email = ag.em
  LEFT JOIN organizer_customer_notes n ON n.organizer_user_id = p_organizer_user_id AND n.email = ag.em
  LEFT JOIN pref_event pe ON pe.em = ag.em
  LEFT JOIN pref_dow pd ON pd.em = ag.em
  ORDER BY ag.last_activity_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_organizer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_email_banned_org(UUID, TEXT) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.organizer_warn_customer(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_ban_customer(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_unban_customer(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_save_customer_note(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organizer_customer_segments(UUID) TO authenticated;
