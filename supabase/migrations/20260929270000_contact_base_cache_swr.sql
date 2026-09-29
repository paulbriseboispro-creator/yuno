-- Base de contacts : le cache se sert périmé et se reconstruit en arrière-plan.
--
-- POURQUOI : 20260929260000 reconstruisait la base d'une portée DANS l'appel de
-- la page dès que le cache avait plus de 2 minutes. Sur les 16 000 lignes de
-- l'organisateur démo, la reconstruction prend 1 à 8 s selon la charge ; ajoutée
-- au reste de la vue d'ensemble, elle dépassait le statement_timeout de 8 s — et
-- la transaction annulée ne gardait rien : chaque visite suivante recommençait.
-- Mesuré par PostgREST : vue d'ensemble et liste en 500 après 10-11 s, à froid.
--
-- Deux causes, deux remèdes :
--
-- 1. Plans génériques. PostgREST garde ses connexions : après cinq appels,
--    plpgsql passe aux plans GÉNÉRIQUES, qui ignorent que p_venue_id est NULL
--    et balaient tout. Mesuré sur la même reconstruction : 11-14 s en plan
--    générique, 3-6 s en plan sur mesure. Toutes les fonctions de la base
--    vivante forcent désormais `plan_cache_mode = force_custom_plan` (le
--    réglage suit les fonctions appelées).
--
-- 2. Reconstruction hors de la page (« stale-while-revalidate ») :
--    • premier appel d'une portée, ou petite portée (≤ 3 000 lignes) : on
--      reconstruit tout de suite, comme avant ;
--    • grande portée périmée : la page lit le cache tel quel (le CONSENTEMENT,
--      email_ok / phone_ok, reste calculé en direct à chaque appel) et note
--      la lecture ; le cron `contact-base-cache-refresh` (chaque minute)
--      reconstruit les portées lues depuis 15 min, une transaction par portée,
--      et prépare d'avance toute portée qui a importé un fichier.
--    • une écriture (import, fusion, engagement) ne supprime plus l'état : elle
--      pose `dirty_at`, la ligne reste lisible jusqu'à la reconstruction.
--
-- Les envois ne passent toujours pas par ici (resolve_contact_segment_def lit
-- contact_rows() en direct).

-- Les anciennes lignes d'état n'ont pas les arguments de portée : on repart de
-- zéro, le cron et les pages reconstruisent.
TRUNCATE public.contact_base_cache, public.contact_base_cache_state;

ALTER TABLE public.contact_base_cache_state
  ADD COLUMN IF NOT EXISTS dirty_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS venue_id text,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid,
  ADD COLUMN IF NOT EXISTS row_count integer;

CREATE OR REPLACE FUNCTION public.contact_base_cache_fresh(p_built_at timestamptz, p_dirty_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_built_at > now() - interval '3 minutes'
     AND (p_dirty_at IS NULL OR p_dirty_at < p_built_at);
$$;

CREATE OR REPLACE FUNCTION public._contact_base_cache_build(
  p_key text, p_venue_id text, p_organizer_user_id uuid, p_read boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_n integer;
BEGIN
  DELETE FROM public.contact_base_cache WHERE scope_key = p_key;
  INSERT INTO public.contact_base_cache
    SELECT p_key, r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.contact_base_cache_state AS s
         (scope_key, built_at, dirty_at, last_read_at, venue_id, organizer_user_id, row_count)
  VALUES (p_key, v_started, NULL, CASE WHEN p_read THEN now() END, p_venue_id, p_organizer_user_id, v_n)
  ON CONFLICT (scope_key) DO UPDATE SET
    built_at = EXCLUDED.built_at,
    -- Une écriture arrivée PENDANT la reconstruction reste à rattraper.
    dirty_at = CASE WHEN s.dirty_at > EXCLUDED.built_at THEN s.dirty_at END,
    last_read_at = COALESCE(EXCLUDED.last_read_at, s.last_read_at),
    venue_id = EXCLUDED.venue_id,
    organizer_user_id = EXCLUDED.organizer_user_id,
    row_count = EXCLUDED.row_count;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public._contact_base_cache_build(text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n integer;
  v_key text := public.contact_base_scope_key(p_venue_id, p_organizer_user_id);
  v_state public.contact_base_cache_state%ROWTYPE;
  v_have boolean;
  v_use_cache boolean;
  v_read_only boolean := COALESCE(current_setting('transaction_read_only', true), 'off') = 'on';
BEGIN
  DROP TABLE IF EXISTS _cr;

  SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
  v_have := FOUND;

  IF NOT v_read_only
     AND NOT (v_have AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at))
     AND (NOT v_have OR COALESCE(v_state.row_count, 0) <= 3000) THEN
    -- Première lecture, ou petite portée : on reconstruit tout de suite (un
    -- import de 200 contacts se voit à l'écran suivant). Un seul reconstructeur
    -- par portée : l'appel parallèle attend ici puis trouve le cache frais.
    PERFORM pg_advisory_xact_lock(hashtext('contact_base_cache:' || v_key));
    SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
    IF NOT (FOUND AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at)) THEN
      PERFORM public._contact_base_cache_build(v_key, p_venue_id, p_organizer_user_id, true);
    END IF;
    v_have := true;
  ELSIF v_have AND NOT v_read_only
        AND (v_state.last_read_at IS NULL OR v_state.last_read_at < now() - interval '1 minute') THEN
    -- Grande portée périmée : on sert le cache tel quel, et on signale la
    -- lecture — le cron la reconstruit dans la minute. SKIP LOCKED : une
    -- reconstruction en cours ne fait jamais attendre la page.
    UPDATE public.contact_base_cache_state s SET last_read_at = now()
     WHERE s.scope_key IN (SELECT s2.scope_key FROM public.contact_base_cache_state s2
                            WHERE s2.scope_key = v_key FOR UPDATE SKIP LOCKED);
  END IF;
  -- Aperçu démo (transaction en lecture seule) : le cache s'il existe, sinon
  -- le calcul en direct comme avant.
  v_use_cache := v_have;

  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  WITH base AS (
    SELECT c.id,
           c.list_import_id,
           c.venue_id,
           c.organizer_user_id,
           c.email,
           c.phone_e164,
           c.first_name,
           c.last_name,
           c.country_code,
           c.country,
           c.region,
           c.city,
           c.postal_code,
           c.zone,
           c.age,
           c.gender,
           c.newsletter_opt_in,
           c.added_at,
           c.last_purchase_at,
           c.total_spent,
           c.event_count,
           c.extra,
           c.created_at,
           c.origin,
           c.user_id,
           c.imported_spent,
           c.imported_events,
           c.yuno_spent,
           c.yuno_events,
           c.yuno_first_at,
           c.yuno_last_at,
           c.ticket_count,
           c.table_count,
           c.order_count,
           c.guest_list_count,
           c.last_seen_at,
           c.eng_status,
           c.emails_sent,
           c.opens,
           c.clicks,
           c.last_opened_at,
           c.last_clicked_at,
           c.unsubscribed_at,
           c.bounced,
           c.subscribed,
           c.has_account
      FROM public.contact_base_cache c
     WHERE v_use_cache AND c.scope_key = v_key
    UNION ALL
    SELECT r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r
     WHERE NOT v_use_cache
  ), ok_e AS (
    SELECT DISTINCT lower(ns.email) AS e
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in
       AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id))
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS e FROM public.email_suppressions s
  ), ok_p AS (
    SELECT DISTINCT vc.phone_e164 AS p
      FROM public.venue_sms_contacts vc
     WHERE NOT vc.unsubscribed
       AND vc.sms_consent_at > now() - interval '36 months'
       AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id))
  )
  SELECT b.*,
         (b.email IS NOT NULL AND oe.e IS NOT NULL AND s.e IS NULL) AS email_ok,
         (b.phone_e164 IS NOT NULL AND op.p IS NOT NULL) AS phone_ok
    FROM base b
    LEFT JOIN ok_e oe ON oe.e = b.email
    LEFT JOIN sup s ON s.e = b.email
    LEFT JOIN ok_p op ON op.p = b.phone_e164;
  SELECT count(*) INTO v_n FROM _cr;
  RETURN v_n;
END;
$function$
;

-- ─── Invalidation : on marque, on ne supprime plus ─────────────────────────
CREATE OR REPLACE FUNCTION public.contact_base_cache_invalidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
       WHERE s.scope_key IN (SELECT DISTINCT public.contact_base_scope_key(n.venue_id, n.organizer_user_id) FROM new_rows n);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
       WHERE s.scope_key IN (SELECT DISTINCT public.contact_base_scope_key(o.venue_id, o.organizer_user_id) FROM old_rows o);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;

-- ─── Reconstruction en arrière-plan ─────────────────────────────────────────
-- Procédure (pas de clause SET : elle COMMIT entre deux portées). Chaque portée
-- a sa transaction : une reconstruction ratée n'emporte pas les autres.
CREATE OR REPLACE PROCEDURE public.contact_base_cache_refresh(p_budget interval DEFAULT interval '40 seconds')
LANGUAGE plpgsql
AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  r record;
  v_state public.contact_base_cache_state%ROWTYPE;
BEGIN
  FOR r IN
    SELECT q.scope_key, q.venue_id, q.organizer_user_id FROM (
      -- Lues depuis 15 min, périmées ou marquées.
      SELECT s.scope_key, s.venue_id, s.organizer_user_id, 0 AS prio, s.last_read_at AS t
        FROM public.contact_base_cache_state s
       WHERE s.last_read_at > now() - interval '15 minutes'
         AND NOT public.contact_base_cache_fresh(s.built_at, s.dirty_at)
      UNION ALL
      -- Toute portée qui a importé un fichier : prête avant la première visite.
      SELECT DISTINCT public.contact_base_scope_key(li.venue_id, li.organizer_user_id),
             li.venue_id, li.organizer_user_id, 1, NULL::timestamptz
        FROM public.contact_list_imports li
       WHERE NOT EXISTS (SELECT 1 FROM public.contact_base_cache_state s
                          WHERE s.scope_key = public.contact_base_scope_key(li.venue_id, li.organizer_user_id))
    ) q
    ORDER BY q.prio, q.t DESC NULLS LAST
  LOOP
    EXIT WHEN clock_timestamp() - v_t0 > p_budget;
    BEGIN
      IF pg_try_advisory_xact_lock(hashtext('contact_base_cache:' || r.scope_key)) THEN
        SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = r.scope_key;
        IF NOT (FOUND AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at)) THEN
          PERFORM public._contact_base_cache_build(r.scope_key, r.venue_id, r.organizer_user_id, false);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact_base_cache_refresh(%): %', r.scope_key, SQLERRM;
    END;
    COMMIT;
  END LOOP;
END;
$$;

REVOKE ALL ON PROCEDURE public.contact_base_cache_refresh(interval) FROM PUBLIC, anon, authenticated;

-- ─── Plans sur mesure pour toute la base vivante ────────────────────────────
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND (p.proname IN ('contact_rows', 'contact_build_rows', '_contact_base_cache_build')
            OR p.prosrc ILIKE '%contact_rows(%' OR p.prosrc ILIKE '%contact_build_rows(%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET plan_cache_mode = force_custom_plan', f);
  END LOOP;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('contact-base-cache-refresh');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM cron.schedule('contact-base-cache-refresh', '* * * * *', 'CALL public.contact_base_cache_refresh()');
END;
$$;
