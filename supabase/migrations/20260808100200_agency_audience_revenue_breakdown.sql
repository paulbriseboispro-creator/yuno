-- ─────────────────────────────────────────────────────────────────────────────
-- Audience RP : revenu abonnés scopé agence + ventilation par soirée.
--
-- 1) get_audience_revenue gagne une branche 'agency' : les soirées de l'agence =
--    celles des clubs / organisateurs sous contrat ACTIF (agency_venue_contracts).
--    Le revenu abonnés vs non-abonnés se calcule alors comme pour un club.
-- 2) get_agency_event_breakdown : la vue « par soirée » demandée — pour chaque
--    soirée rattachée à l'agence (fenêtre -90j / +120j), combien de SES abonnés
--    ont acheté (billet ou table payés) et le taux de conversion sur l'audience.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Revenu abonnés : brancher 'agency' via les contrats ────────────────────
CREATE OR REPLACE FUNCTION public.get_audience_revenue(
  p_subject_type text,
  p_subject_id   text,
  p_from         timestamptz DEFAULT (now() - interval '90 days'),
  p_to           timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result   jsonb;
  v_org    uuid := CASE WHEN p_subject_type = 'organizer' THEN nullif(p_subject_id, '')::uuid END;
  v_agency uuid := CASE WHEN p_subject_type = 'agency'    THEN nullif(p_subject_id, '')::uuid END;
BEGIN
  IF NOT public.can_read_audience(p_subject_type, p_subject_id) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  IF p_subject_type = 'dj' THEN
    RETURN jsonb_build_object('ok', true, 'supported', false, 'reason', 'dj_revenue_via_conversion_hub');
  END IF;

  WITH members AS (
    SELECT user_id FROM public.audience_members(p_subject_type, p_subject_id)
  ),
  scoped_events AS (
    SELECT e.id FROM public.events e
    WHERE (p_subject_type = 'venue'
             AND (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id))
       OR (p_subject_type = 'organizer'
             AND (e.organizer_user_id = v_org OR e.partner_organizer_id = v_org))
       OR (p_subject_type = 'agency' AND EXISTS (
             SELECT 1 FROM public.agency_venue_contracts avc
              WHERE avc.agency_id = v_agency AND avc.status = 'active'
                AND ((avc.venue_id IS NOT NULL AND avc.venue_id = e.venue_id)
                  OR (avc.organizer_user_id IS NOT NULL AND avc.organizer_user_id = e.organizer_user_id))
           ))
  ),
  sales AS (
    SELECT t.user_id, lower(nullif(trim(t.user_email), '')) AS email,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)) AS gross,
           coalesce(t.refund_amount, 0) AS refund
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid'
       AND t.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.user_id, lower(nullif(trim(r.user_email), '')),
           (r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)),
           coalesce(r.refund_amount, 0)
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid'
       AND r.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT o.user_id, lower(nullif(trim(o.user_email), '')),
           (o.total - coalesce(o.service_fee, 0)),
           coalesce(o.refund_amount, 0)
      FROM public.orders o
     WHERE o.status IN ('paid', 'served')
       AND o.created_at BETWEEN p_from AND p_to
       AND ((p_subject_type = 'venue'     AND o.venue_id = p_subject_id)
         OR (p_subject_type = 'organizer' AND o.event_id IN (SELECT id FROM scoped_events))
         OR (p_subject_type = 'agency'    AND o.event_id IN (SELECT id FROM scoped_events)))
  ),
  resolved AS (
    SELECT s.gross, s.refund,
      coalesce(s.user_id,
               (SELECT pr.id FROM public.profiles pr
                 WHERE s.email IS NOT NULL AND lower(pr.email) = s.email LIMIT 1)) AS buyer_uid
    FROM sales s
  ),
  tagged AS (
    SELECT r.gross, r.refund,
      EXISTS (SELECT 1 FROM members mm WHERE mm.user_id = r.buyer_uid) AS is_follower
    FROM resolved r
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'from', p_from, 'to', p_to,
    'followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2)        FROM tagged WHERE is_follower),
      'net',    (SELECT round(coalesce(sum(gross - refund), 0)::numeric, 2) FROM tagged WHERE is_follower)
    ),
    'non_followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE NOT is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2)        FROM tagged WHERE NOT is_follower),
      'net',    (SELECT round(coalesce(sum(gross - refund), 0)::numeric, 2) FROM tagged WHERE NOT is_follower)
    ),
    'follower_share', (
      SELECT CASE WHEN coalesce(sum(gross), 0) > 0
                  THEN round(100.0 * coalesce(sum(gross) FILTER (WHERE is_follower), 0) / sum(gross), 1)
                  ELSE 0 END
      FROM tagged
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audience_revenue(text, text, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_audience_revenue(text, text, timestamptz, timestamptz) TO authenticated;

-- ── 2. Ventilation par soirée (conversion des abonnés sur chaque soirée) ──────
CREATE OR REPLACE FUNCTION public.get_agency_event_breakdown(p_agency_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result  jsonb;
  v_total int;
BEGIN
  IF NOT public.can_read_audience('agency', p_agency_id::text) THEN
    RETURN jsonb_build_object('ok', false,
             'reason', CASE WHEN auth.uid() IS NULL THEN 'not_authenticated' ELSE 'forbidden' END);
  END IF;

  SELECT count(*)::int INTO v_total FROM public.agency_followers WHERE agency_id = p_agency_id;

  WITH members AS (
    SELECT user_id FROM public.agency_followers WHERE agency_id = p_agency_id
  ),
  scoped AS (
    SELECT e.id, e.title, e.start_at, e.venue_id
      FROM public.events e
     WHERE e.is_active = true AND e.cancelled_at IS NULL
       AND e.start_at >= now() - interval '90 days'
       AND e.start_at <= now() + interval '120 days'
       AND EXISTS (
         SELECT 1 FROM public.agency_venue_contracts avc
          WHERE avc.agency_id = p_agency_id AND avc.status = 'active'
            AND ((avc.venue_id IS NOT NULL AND avc.venue_id = e.venue_id)
              OR (avc.organizer_user_id IS NOT NULL AND avc.organizer_user_id = e.organizer_user_id))
       )
     ORDER BY e.start_at DESC
     LIMIT 30
  ),
  buyers AS (
    SELECT s.event_id, count(DISTINCT s.user_id)::int AS buyers
    FROM (
      SELECT t.event_id, t.user_id FROM public.tickets t
       WHERE t.status = 'paid' AND t.user_id IS NOT NULL
      UNION
      SELECT r.event_id, r.user_id FROM public.table_reservations r
       WHERE r.status = 'paid' AND r.user_id IS NOT NULL
    ) s
    JOIN members m ON m.user_id = s.user_id
    WHERE s.event_id IN (SELECT id FROM scoped)
    GROUP BY s.event_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'total_followers', v_total,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'event_id',   sc.id,
               'title',      sc.title,
               'start_at',   sc.start_at,
               'venue_name', v.name,
               'buyers',     COALESCE(bu.buyers, 0),
               'conversion', CASE WHEN v_total > 0
                                  THEN round(100.0 * COALESCE(bu.buyers, 0) / v_total, 1)
                                  ELSE 0 END
             ) ORDER BY sc.start_at DESC)
        FROM scoped sc
        LEFT JOIN buyers bu ON bu.event_id = sc.id
        LEFT JOIN public.venues v ON v.id = sc.venue_id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_event_breakdown(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_event_breakdown(uuid) TO authenticated;
