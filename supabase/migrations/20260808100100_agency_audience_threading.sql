-- ─────────────────────────────────────────────────────────────────────────────
-- Audience RP : on branche le sujet 'agency' dans le moteur d'audience existant.
--
-- Le système audience (Phase 0-4) est POLYMORPHE sur subject_type
-- ('venue' | 'dj' | 'organizer'). Ajouter les RP = ajouter un 4e sujet 'agency'
-- (subject_id = agencies.id::text) partout où le grain de sujet est câblé :
--   1. les CHECK des tables journal/snapshot ;
--   2. can_read_audience (garde d'ownership) → is_agency_owner ;
--   3. audience_members (l'ensemble des abonnés) → branche agency_followers ;
--   4. les triggers de journal (follow/unfollow sur agency_followers) ;
--   5. run_audience_snapshot (stock + joignables).
-- Le flux (gained/lost) et toutes les RPC de lecture (analytics, growth, segments,
-- notifications, cohorts, sources) sont déjà génériques : elles fonctionnent dès
-- que audience_members + can_read_audience connaissent 'agency'.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Étendre les contraintes CHECK des tables internes ──────────────────────
-- On drope par DÉFINITION (pas par nom auto-généré) : si l'ancienne contrainte
-- restrictive survivait, tout follow 'agency' échouerait. Le DO block trouve la
-- contrainte CHECK portant sur subject_type quel que soit son nom, la supprime,
-- puis on rajoute la version élargie.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.conrelid IN ('public.audience_follow_events'::regclass,
                          'public.audience_daily_snapshots'::regclass)
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%subject_type%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.audience_follow_events   ADD CONSTRAINT audience_follow_events_subject_type_check
  CHECK (subject_type IN ('venue', 'dj', 'organizer', 'agency'));
ALTER TABLE public.audience_daily_snapshots ADD CONSTRAINT audience_daily_snapshots_subject_type_check
  CHECK (subject_type IN ('venue', 'dj', 'organizer', 'agency'));

-- ── 2. Garde d'ownership : l'agence est lisible par son propriétaire ──────────
CREATE OR REPLACE FUNCTION public.can_read_audience(p_subject_type text, p_subject_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN p_subject_type = 'dj' THEN
      p_subject_id::uuid = auth.uid()
      OR public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public.dj_team_members
         WHERE member_user_id = auth.uid()
           AND dj_user_id = p_subject_id::uuid
           AND status = 'active'
      )
    WHEN p_subject_type = 'venue' THEN
      public.is_venue_owner(auth.uid(), p_subject_id) OR public.is_super_admin()
    WHEN p_subject_type = 'organizer' THEN
      public.can_manage_organizer(p_subject_id::uuid)
    WHEN p_subject_type = 'agency' THEN
      public.is_agency_owner(auth.uid(), p_subject_id::uuid) OR public.is_super_admin()
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.can_read_audience(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_read_audience(text, text) TO authenticated;

-- ── 3. L'ensemble des abonnés d'un sujet : branche agency ─────────────────────
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
      FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
     WHERE p_subject_type = 'dj' AND f.favorite_type = 'dj'
       AND d.user_id = CASE WHEN p_subject_type = 'dj' THEN nullif(p_subject_id, '')::uuid END
    UNION ALL
    SELECT opf.user_id, opf.created_at, false
      FROM public.organizer_profile_followers opf
     WHERE p_subject_type = 'organizer'
       AND opf.organizer_user_id = CASE WHEN p_subject_type = 'organizer' THEN nullif(p_subject_id, '')::uuid END
    UNION ALL
    SELECT af.user_id, af.created_at, false
      FROM public.agency_followers af
     WHERE p_subject_type = 'agency'
       AND af.agency_id = CASE WHEN p_subject_type = 'agency' THEN nullif(p_subject_id, '')::uuid END
  ) m
  ORDER BY m.user_id, m.first_followed ASC;
$$;

REVOKE ALL ON FUNCTION public.audience_members(text, text) FROM public, anon, authenticated;

-- ── 4. Triggers de journal sur agency_followers ──────────────────────────────
-- Miroir des triggers organisateur : source depuis le GUC (fallback 'trigger'),
-- pas de dédup (une agence = une ligne par abonné). Un DELETE en cascade
-- (suppression d'agence / de compte) est journalisé comme un vrai unfollow.
CREATE OR REPLACE FUNCTION public.audience_log_agency_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text := COALESCE(NULLIF(current_setting('yuno.follow_source', true), ''), 'trigger');
BEGIN
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source)
    VALUES ('agency', NEW.agency_id::text, NEW.user_id, 'follow', v_source);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audience_log_agency_unfollow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source)
    VALUES ('agency', OLD.agency_id::text, OLD.user_id, 'unfollow', 'trigger');
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS audience_agency_follow_trg ON public.agency_followers;
CREATE TRIGGER audience_agency_follow_trg
  AFTER INSERT ON public.agency_followers
  FOR EACH ROW EXECUTE FUNCTION public.audience_log_agency_follow();

DROP TRIGGER IF EXISTS audience_agency_unfollow_trg ON public.agency_followers;
CREATE TRIGGER audience_agency_unfollow_trg
  AFTER DELETE ON public.agency_followers
  FOR EACH ROW EXECUTE FUNCTION public.audience_log_agency_unfollow();

-- ── 5. Snapshot quotidien : ajouter le stock + les joignables des agences ─────
CREATE OR REPLACE FUNCTION public.run_audience_snapshot(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rows int;
BEGIN
  WITH stock AS (
    SELECT 'venue'::text AS subject_type, f.venue_id AS subject_id, count(*)::int AS total
      FROM public.favorites f
     WHERE f.favorite_type = 'club' AND f.venue_id IS NOT NULL
     GROUP BY f.venue_id
    UNION ALL
    SELECT 'dj', d.user_id::text, count(DISTINCT f.user_id)::int
      FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
     WHERE f.favorite_type = 'dj' AND f.dj_id IS NOT NULL AND d.user_id IS NOT NULL
     GROUP BY d.user_id
    UNION ALL
    SELECT 'organizer', opf.organizer_user_id::text, count(*)::int
      FROM public.organizer_profile_followers opf
     GROUP BY opf.organizer_user_id
    UNION ALL
    SELECT 'agency', af.agency_id::text, count(*)::int
      FROM public.agency_followers af
     GROUP BY af.agency_id
  ),
  flow AS (
    SELECT subject_type, subject_id,
           count(*) FILTER (WHERE action = 'follow')::int   AS gained,
           count(*) FILTER (WHERE action = 'unfollow')::int AS lost
      FROM public.audience_follow_events
     WHERE created_at >= p_date::timestamptz
       AND created_at <  (p_date + 1)::timestamptz
     GROUP BY subject_type, subject_id
  ),
  reach AS (
    SELECT subject_type, subject_id, count(DISTINCT follower)::int AS reachable
    FROM (
      SELECT 'venue'::text AS subject_type, f.venue_id AS subject_id, f.user_id AS follower
        FROM public.favorites f
        JOIN public.push_subscriptions ps ON ps.user_id = f.user_id AND ps.platform = 'ios'
       WHERE f.favorite_type = 'club' AND f.venue_id IS NOT NULL
      UNION ALL
      SELECT 'dj', d.user_id::text, f.user_id
        FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
        JOIN public.push_subscriptions ps ON ps.user_id = f.user_id AND ps.platform = 'ios'
       WHERE f.favorite_type = 'dj' AND f.dj_id IS NOT NULL AND d.user_id IS NOT NULL
      UNION ALL
      SELECT 'organizer', opf.organizer_user_id::text, opf.user_id
        FROM public.organizer_profile_followers opf
        JOIN public.push_subscriptions ps ON ps.user_id = opf.user_id AND ps.platform = 'ios'
      UNION ALL
      SELECT 'agency', af.agency_id::text, af.user_id
        FROM public.agency_followers af
        JOIN public.push_subscriptions ps ON ps.user_id = af.user_id AND ps.platform = 'ios'
    ) r
    GROUP BY subject_type, subject_id
  )
  INSERT INTO public.audience_daily_snapshots
    (subject_type, subject_id, snapshot_date,
     followers_total, follows_gained, follows_lost, net_change, reachable_count)
  SELECT COALESCE(st.subject_type, fl.subject_type),
         COALESCE(st.subject_id,   fl.subject_id),
         p_date,
         COALESCE(st.total,  0),
         COALESCE(fl.gained, 0),
         COALESCE(fl.lost,   0),
         COALESCE(fl.gained, 0) - COALESCE(fl.lost, 0),
         COALESCE(rc.reachable, 0)
    FROM stock st
    FULL JOIN flow fl
      ON fl.subject_type = st.subject_type AND fl.subject_id = st.subject_id
    LEFT JOIN reach rc
      ON rc.subject_type = COALESCE(st.subject_type, fl.subject_type)
     AND rc.subject_id   = COALESCE(st.subject_id,   fl.subject_id)
  ON CONFLICT (subject_type, subject_id, snapshot_date) DO UPDATE SET
    followers_total = EXCLUDED.followers_total,
    follows_gained  = EXCLUDED.follows_gained,
    follows_lost    = EXCLUDED.follows_lost,
    net_change      = EXCLUDED.net_change,
    reachable_count = EXCLUDED.reachable_count;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('date', p_date, 'rows', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_audience_snapshot(date) FROM public, anon, authenticated;
