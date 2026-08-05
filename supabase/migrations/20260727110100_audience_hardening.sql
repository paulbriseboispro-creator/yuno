-- ============================================================================
-- Durcissement du système d'audience (correctifs issus de l'auto-audit) :
--  1. audience_members : branche DJ réécrite en IN (subselect) → utilise
--     idx_djs_user_id puis idx_favorites_dj_person au lieu d'un seq scan + join.
--  2. get_audience_revenue : le "net" soustrait désormais le frais Stripe
--     (1.5% + 0.25€/txn), pour COÏNCIDER avec le CA Net de fees.ts (source de
--     vérité) affiché ailleurs. Avant, il ne retirait que les remboursements.
--  3. favorites.dj_id : FK passée en ON DELETE CASCADE (comme venue_id/event_id)
--     → supprimer une fiche DJ suivie n'échoue plus.
--  4. Cron snapshot re-planifié à 00h05 sur CURRENT_DATE-1 (au lieu de 23h55 sur
--     CURRENT_DATE) → le flux du jour n'est plus tronqué de ses 5 dernières min
--     (pic de nuit EU), le churn est complet.
-- NB : on NE remet PAS le flag yuno.skip_follow_ledger à 0 après le DELETE de
--     dédup — ce serait un bug (ré-loggerait un faux follow). Le comportement
--     single-tap est correct ; le risque multi-lignes n'existe pas dans l'app.
-- ============================================================================

-- ── 1. audience_members : branche DJ perf ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audience_members(p_subject_type text, p_subject_id text)
RETURNS TABLE(user_id uuid, first_followed timestamptz, notify_all boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.user_id) m.user_id, m.first_followed, m.notify_all
  FROM (
    SELECT f.user_id, f.created_at AS first_followed, false AS notify_all
      FROM public.favorites f
     WHERE p_subject_type = 'venue' AND f.favorite_type = 'club' AND f.venue_id = p_subject_id
    UNION ALL
    SELECT f.user_id, f.created_at, f.notify_all_locations
      FROM public.favorites f
     WHERE p_subject_type = 'dj' AND f.favorite_type = 'dj'
       AND f.dj_id IN (
         SELECT id FROM public.djs
          WHERE user_id = CASE WHEN p_subject_type = 'dj' THEN nullif(p_subject_id, '')::uuid END
       )
    UNION ALL
    SELECT opf.user_id, opf.created_at, false
      FROM public.organizer_profile_followers opf
     WHERE p_subject_type = 'organizer'
       AND opf.organizer_user_id = CASE WHEN p_subject_type = 'organizer' THEN nullif(p_subject_id, '')::uuid END
  ) m
  ORDER BY m.user_id, m.first_followed ASC;
$$;

REVOKE ALL ON FUNCTION public.audience_members(text, text) FROM public, anon, authenticated;

-- ── 2. get_audience_revenue : net = brut − Stripe − remboursement ─────────────
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
  result jsonb;
  v_org  uuid := CASE WHEN p_subject_type = 'organizer' THEN nullif(p_subject_id, '')::uuid END;
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
  ),
  sales AS (
    SELECT t.user_id, lower(nullif(trim(t.user_email), '')) AS email,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)) AS gross,
           coalesce(t.refund_amount, 0) AS refund, t.total_price AS charged
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid'
       AND t.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT r.user_id, lower(nullif(trim(r.user_email), '')),
           (r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)),
           coalesce(r.refund_amount, 0), r.total_price
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid'
       AND r.created_at BETWEEN p_from AND p_to
    UNION ALL
    SELECT o.user_id, lower(nullif(trim(o.user_email), '')),
           (o.total - coalesce(o.service_fee, 0)),
           coalesce(o.refund_amount, 0), o.total
      FROM public.orders o
     WHERE o.status IN ('paid', 'served')
       AND o.created_at BETWEEN p_from AND p_to
       AND ((p_subject_type = 'venue'     AND o.venue_id = p_subject_id)
         OR (p_subject_type = 'organizer' AND o.event_id IN (SELECT id FROM scoped_events)))
  ),
  resolved AS (
    SELECT s.gross, s.refund, s.charged,
      coalesce(s.user_id,
               (SELECT pr.id FROM public.profiles pr
                 WHERE s.email IS NOT NULL AND lower(pr.email) = s.email LIMIT 1)) AS buyer_uid
    FROM sales s
  ),
  tagged AS (
    SELECT r.gross, r.refund,
      -- CA Net club = brut − frais Stripe (1.5% + 0.25€/txn) − remboursement (fees.ts)
      (r.gross - r.refund - (r.charged * 0.015 + 0.25)) AS net,
      EXISTS (SELECT 1 FROM members mm WHERE mm.user_id = r.buyer_uid) AS is_follower
    FROM resolved r
  )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true, 'from', p_from, 'to', p_to,
    'followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2) FROM tagged WHERE is_follower),
      'net',    (SELECT round(coalesce(sum(net),   0)::numeric, 2) FROM tagged WHERE is_follower)
    ),
    'non_followers', jsonb_build_object(
      'orders', (SELECT count(*) FROM tagged WHERE NOT is_follower),
      'gross',  (SELECT round(coalesce(sum(gross), 0)::numeric, 2) FROM tagged WHERE NOT is_follower),
      'net',    (SELECT round(coalesce(sum(net),   0)::numeric, 2) FROM tagged WHERE NOT is_follower)
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

-- ── 3. favorites.dj_id → ON DELETE CASCADE ───────────────────────────────────
ALTER TABLE public.favorites DROP CONSTRAINT IF EXISTS favorites_dj_id_fkey;
ALTER TABLE public.favorites
  ADD CONSTRAINT favorites_dj_id_fkey
  FOREIGN KEY (dj_id) REFERENCES public.djs(id) ON DELETE CASCADE;

-- ── 4. Cron snapshot : 00h05 sur le jour qui vient de s'achever ───────────────
SELECT cron.schedule(
  'audience-daily-snapshot',
  '5 0 * * *',
  $$SELECT public.run_audience_snapshot(CURRENT_DATE - 1);$$
);
