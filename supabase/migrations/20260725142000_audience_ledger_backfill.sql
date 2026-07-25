-- ─────────────────────────────────────────────────────────────────────────────
-- Audience Intelligence — Phase 0 : capture (3/4) — backfill + réconciliation.
--
-- Le journal démarre vide. On y injecte UN événement 'follow' par abonnement
-- existant, daté de son created_at : ça reconstitue la courbe des follows BRUTS
-- passés (le churn passé, lui, est perdu — pas de created/deleted historique).
-- À partir de maintenant, les triggers capturent le net.
--
-- DJ : grain PERSONNE. favorites 'dj' est déjà dédupliqué (une ligne par
-- (user, personne) depuis 20260717120000), mais on GROUP BY (personne, follower)
-- par ceinture-et-bretelles, avec min(created_at) comme vraie date d'abonnement.
--
-- Idempotence : le backfill ne s'exécute qu'une fois, garde sur la présence de
-- lignes source='backfill'. Puis une réconciliation DURE : le net du journal doit
-- égaler le compte vivant par sujet, sinon on ABORTE la migration.
-- ─────────────────────────────────────────────────────────────────────────────

DO $backfill$
DECLARE
  v_already   int;
  v_live      bigint;
  v_ledger    bigint;
BEGIN
  SELECT count(*) INTO v_already
    FROM public.audience_follow_events WHERE source = 'backfill';
  IF v_already > 0 THEN
    RAISE NOTICE 'Backfill audience déjà effectué (% lignes) — on saute.', v_already;
    RETURN;
  END IF;

  -- ── Clubs ───────────────────────────────────────────────────────────────────
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source, created_at)
  SELECT 'venue', f.venue_id, f.user_id, 'follow', 'backfill', f.created_at
    FROM public.favorites f
   WHERE f.favorite_type = 'club' AND f.venue_id IS NOT NULL;

  -- ── DJs (grain personne) ─────────────────────────────────────────────────────
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source, created_at)
  SELECT 'dj', d.user_id::text, f.user_id, 'follow', 'backfill', min(f.created_at)
    FROM public.favorites f
    JOIN public.djs d ON d.id = f.dj_id
   WHERE f.favorite_type = 'dj' AND f.dj_id IS NOT NULL AND d.user_id IS NOT NULL
   GROUP BY d.user_id, f.user_id;

  -- ── Organisateurs ────────────────────────────────────────────────────────────
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source, created_at)
  SELECT 'organizer', opf.organizer_user_id::text, opf.user_id, 'follow', 'backfill', opf.created_at
    FROM public.organizer_profile_followers opf;

  -- ── Réconciliation dure : net(journal) == compte vivant, par sujet ───────────
  WITH live AS (
    SELECT 'venue'::text AS st, f.venue_id AS sid, count(*)::bigint AS n
      FROM public.favorites f
     WHERE f.favorite_type = 'club' AND f.venue_id IS NOT NULL
     GROUP BY f.venue_id
    UNION ALL
    SELECT 'dj', d.user_id::text, count(DISTINCT f.user_id)::bigint
      FROM public.favorites f JOIN public.djs d ON d.id = f.dj_id
     WHERE f.favorite_type = 'dj' AND f.dj_id IS NOT NULL AND d.user_id IS NOT NULL
     GROUP BY d.user_id
    UNION ALL
    SELECT 'organizer', opf.organizer_user_id::text, count(*)::bigint
      FROM public.organizer_profile_followers opf
     GROUP BY opf.organizer_user_id
  ),
  ledger AS (
    SELECT subject_type AS st, subject_id AS sid,
           count(*) FILTER (WHERE action = 'follow')::bigint
         - count(*) FILTER (WHERE action = 'unfollow')::bigint AS n
      FROM public.audience_follow_events
     GROUP BY subject_type, subject_id
  )
  SELECT count(*) INTO v_ledger
    FROM live
    FULL JOIN ledger USING (st, sid)
   WHERE COALESCE(live.n, 0) IS DISTINCT FROM COALESCE(ledger.n, 0);

  IF v_ledger > 0 THEN
    RAISE EXCEPTION 'Réconciliation backfill échouée : % sujet(s) où net(journal) != compte vivant.', v_ledger;
  END IF;

  SELECT count(*) INTO v_live FROM public.audience_follow_events WHERE source = 'backfill';
  RAISE NOTICE 'Backfill audience OK : % abonnements journalisés, réconciliation propre.', v_live;
END;
$backfill$;
