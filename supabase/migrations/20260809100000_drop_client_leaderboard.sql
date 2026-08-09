-- ============================================================================
-- Remove the "consumption contest between customers" feature (client leaderboard).
-- ============================================================================
-- Drops the whole leaderboard subsystem:
--   * the hourly recalc cron job
--   * every scoring / contest / reward function
--   * the contest-winner redemption sync trigger (on the SHARED reward_redemptions
--     table — only the trigger is removed, the table stays)
--   * the 6 leaderboard tables
--   * the profiles.leaderboard_visibility privacy column
-- and rewrites get_live_session / demo_live_session to stop reading client_scores
-- (the Live Mode "TOP #rank" chip is gone).
--
-- Idempotent (IF EXISTS everywhere). No shared feature is touched: reward_redemptions,
-- venue_customers and the loyalty program remain intact.

-- ----------------------------------------------------------------------------
-- 1. Stop the recurring recalculation cron (pg_cron may be absent in some envs).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'leaderboard-recalc-hourly') THEN
    PERFORM cron.unschedule('leaderboard-recalc-hourly');
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Remove the contest-winner redemption sync trigger from the shared table.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_contest_winner_redeemed ON public.reward_redemptions;

-- ----------------------------------------------------------------------------
-- 3. Rewrite the Live Mode RPCs WITHOUT the leaderboard rank/tier chip.
--    They used to LEFT JOIN client_scores (about to be dropped); the return
--    signature loses client_rank / client_tier (the front no longer reads them).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_live_session();
CREATE FUNCTION public.get_live_session()
RETURNS TABLE (
  state text,
  source text,
  event_id uuid,
  event_title text,
  event_start_at timestamptz,
  event_end_at timestamptz,
  venue_id text,
  venue_name text,
  entry_scanned_at timestamptz,
  table_reservation_id uuid,
  menu_enabled boolean,
  live_mode_enabled boolean,
  solo_bottle_sale_enabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;

  -- 1) Session live : une entrée scannée dans la fenêtre de l'événement.
  RETURN QUERY
  WITH hits AS (
    SELECT 'table'::text AS src, tr.event_id AS ev_id, tr.entry_scanned_at AS scanned_at,
           tr.id AS res_id, 1 AS prio
    FROM public.table_reservations tr
    WHERE tr.user_id = v_uid
      AND tr.entry_scanned
      AND tr.status IN ('paid', 'confirmed')
      AND tr.entry_scanned_at > now() - interval '24 hours'
    UNION ALL
    SELECT 'ticket', t.event_id, t.entry_scanned_at, NULL::uuid, 2
    FROM public.tickets t
    WHERE t.user_id = v_uid
      AND t.entry_scanned
      AND t.status = 'paid'
      AND t.entry_scanned_at > now() - interval '24 hours'
    UNION ALL
    SELECT 'guest_list', gl.event_id, gle.entry_scanned_at, NULL::uuid, 3
    FROM public.guest_list_entries gle
    JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
    WHERE gle.entry_scanned
      AND gle.status <> 'cancelled'
      AND gle.entry_scanned_at > now() - interval '24 hours'
      AND (
        gle.user_id = v_uid
        OR (gle.user_id IS NULL AND v_email IS NOT NULL AND lower(gle.email) = v_email)
      )
  )
  SELECT
    'live'::text,
    h.src,
    e.id,
    e.title,
    e.start_at,
    e.end_at,
    v.id,
    v.name,
    h.scanned_at,
    h.res_id,
    COALESCE(v.menu_enabled, false),
    v.live_mode_enabled,
    v.solo_bottle_sale_enabled
  FROM hits h
  JOIN public.events e ON e.id = h.ev_id
  JOIN public.venues v ON v.id = e.venue_id
  WHERE v.live_mode_enabled
    AND now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
  ORDER BY h.prio, h.scanned_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- 2) Pending : une entrée NON scannée pour un événement dans sa fenêtre.
  RETURN QUERY
  WITH pend AS (
    SELECT 'table'::text AS src, tr.event_id AS ev_id, tr.id AS res_id, 1 AS prio
    FROM public.table_reservations tr
    WHERE tr.user_id = v_uid
      AND NOT tr.entry_scanned
      AND tr.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT 'ticket', t.event_id, NULL::uuid, 2
    FROM public.tickets t
    WHERE t.user_id = v_uid
      AND NOT t.entry_scanned
      AND t.status = 'paid'
    UNION ALL
    SELECT 'guest_list', gl.event_id, NULL::uuid, 3
    FROM public.guest_list_entries gle
    JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
    WHERE NOT gle.entry_scanned
      AND gle.status <> 'cancelled'
      AND (
        gle.user_id = v_uid
        OR (gle.user_id IS NULL AND v_email IS NOT NULL AND lower(gle.email) = v_email)
      )
  )
  SELECT
    'pending_scan'::text,
    p.src,
    e.id,
    e.title,
    e.start_at,
    e.end_at,
    v.id,
    v.name,
    NULL::timestamptz,
    p.res_id,
    COALESCE(v.menu_enabled, false),
    v.live_mode_enabled,
    v.solo_bottle_sale_enabled
  FROM pend p
  JOIN public.events e ON e.id = p.ev_id
  JOIN public.venues v ON v.id = e.venue_id
  WHERE v.live_mode_enabled
    AND now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
  ORDER BY p.prio, e.start_at
  LIMIT 1;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.get_live_session() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_live_session() TO authenticated;

DROP FUNCTION IF EXISTS public.demo_live_session();
CREATE FUNCTION public.demo_live_session()
RETURNS TABLE (
  state text,
  source text,
  event_id uuid,
  event_title text,
  event_start_at timestamptz,
  event_end_at timestamptz,
  venue_id text,
  venue_name text,
  entry_scanned_at timestamptz,
  table_reservation_id uuid,
  menu_enabled boolean,
  live_mode_enabled boolean,
  solo_bottle_sale_enabled boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_venue text;
BEGIN
  IF COALESCE(auth.jwt() ->> 'email', '') NOT LIKE '%@womber.fr' THEN
    RAISE EXCEPTION 'Réservé aux comptes démo';
  END IF;

  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  IF v_venue IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'live'::text,
    'ticket'::text,
    e.id,
    e.title,
    CASE WHEN now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
         THEN e.start_at ELSE now() - interval '1 hour' END,
    CASE WHEN now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours'
         THEN e.end_at ELSE now() + interval '5 hours' END,
    v.id,
    v.name,
    now(),
    NULL::uuid,
    COALESCE(v.menu_enabled, false),
    true, -- le mode démo force le Live même si le toggle club est coupé
    v.solo_bottle_sale_enabled
  FROM public.venues v
  JOIN public.events e ON e.venue_id = v.id
  WHERE v.id = v_venue
  ORDER BY
    CASE
      WHEN now() BETWEEN e.start_at - interval '2 hours' AND e.end_at + interval '2 hours' THEN 0
      WHEN e.start_at > now() THEN 1
      ELSE 2
    END,
    CASE WHEN e.start_at > now() THEN e.start_at END ASC,
    e.start_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.demo_live_session() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.demo_live_session() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Drop every leaderboard scoring / contest / reward function (any signature).
-- ----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT 'DROP FUNCTION IF EXISTS public.' || quote_ident(p.proname)
           || '(' || pg_get_function_identity_arguments(p.oid) || ') CASCADE' AS stmt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'calculate_client_scores',
        'calculate_contest_scores',
        'finalize_leaderboard_contest',
        'auto_finalize_leaderboard_contests',
        'recalc_all_leaderboards',
        '_leaderboard_user_activity',
        '_deliver_contest_reward',
        '_sync_contest_winner_redeemed'
      )
  LOOP
    EXECUTE r.stmt;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Drop the leaderboard tables (children first; CASCADE clears policies/FKs).
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.leaderboard_contest_scores CASCADE;
DROP TABLE IF EXISTS public.leaderboard_contest_winners CASCADE;
DROP TABLE IF EXISTS public.leaderboard_contests CASCADE;
DROP TABLE IF EXISTS public.leaderboard_rewards CASCADE;
DROP TABLE IF EXISTS public.leaderboard_settings CASCADE;
DROP TABLE IF EXISTS public.client_scores CASCADE;

-- ----------------------------------------------------------------------------
-- 6. Drop the client privacy column (was only used by the leaderboard display).
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles DROP COLUMN IF EXISTS leaderboard_visibility;
