-- Cache de la base de contacts : reconstruit quand quelque chose change.
--
-- contact_base_cache_refresh (cron, toutes les 5 min) reconstruisait toute
-- portée lue dans les 15 dernières minutes dès que sa copie avait plus de
-- 3 min — donc à chaque passe, changement ou pas, et un cron qui lit une
-- portée suffit à la garder « lue ». Mesuré le 17/10 : 3 277 appels, 2,1 s en
-- moyenne, 75 s au pire, 1,9 h de base cumulée, le premier consommateur.
--
-- Désormais une portée lue n'est reconstruite que si elle est marquée (fichier,
-- engagement — triggers existants — et billets de la billetterie, marqués par
-- ticketing_after_sync) ou si sa copie a plus de 15 min (filet des sources sans
-- marque : ventes Yuno, comptes). Le consentement n'est jamais lu dans la
-- copie : contact_build_rows recalcule email_ok / phone_ok en direct.
-- La lecture d'une petite portée (≤ 3 000 lignes) reconstruit toujours en
-- direct une copie de plus de 3 min (contact_base_cache_fresh, inchangée).
-- Et une reconstruction n'écrit plus que les lignes qui ont changé.

CREATE OR REPLACE FUNCTION public.contact_base_cache_due(p_built_at timestamptz, p_dirty_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p_built_at IS NULL OR p_dirty_at IS NOT NULL OR p_built_at < now() - interval '15 minutes';
$function$;
REVOKE ALL ON FUNCTION public.contact_base_cache_due(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- Lecture des lignes d'une portée par identifiant (écriture différentielle).
CREATE INDEX IF NOT EXISTS contact_base_cache_scope_id_idx ON public.contact_base_cache (scope_key, id);
DROP INDEX IF EXISTS public.contact_base_cache_scope_idx;

CREATE OR REPLACE FUNCTION public._contact_base_cache_build(p_key text, p_venue_id text, p_organizer_user_id uuid, p_read boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_n integer;
BEGIN
  -- Seules les lignes qui changent s'écrivent (20261018240000) : avant, toute
  -- la portée (jusqu'à 17 000 lignes) était effacée puis réécrite à chaque
  -- reconstruction, le plus souvent à l'identique. Même contenu à la fin.
  DROP TABLE IF EXISTS _cbn;
  CREATE TEMP TABLE _cbn ON COMMIT DROP AS
    SELECT p_key AS scope_key, r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- Mêmes colonnes, dans le même ordre (scope_key puis contact_rows) :
  -- comparaison champ à champ.
  DELETE FROM public.contact_base_cache c
   WHERE c.scope_key = p_key
     AND NOT EXISTS (SELECT 1 FROM _cbn n WHERE n.id = c.id AND ROW(c.*) IS NOT DISTINCT FROM ROW(n.*));
  INSERT INTO public.contact_base_cache
    SELECT n.* FROM _cbn n
     WHERE NOT EXISTS (SELECT 1 FROM public.contact_base_cache c WHERE c.scope_key = p_key AND c.id = n.id);
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
$function$;

CREATE OR REPLACE PROCEDURE public.contact_base_cache_refresh(IN p_budget interval DEFAULT '00:00:40'::interval)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  r record;
  v_state public.contact_base_cache_state%ROWTYPE;
BEGIN
  FOR r IN
    SELECT q.scope_key, q.venue_id, q.organizer_user_id FROM (
      -- Lues depuis 15 min, ET marquées (une écriture dans une source suivie :
      -- fichier, engagement, billets de la billetterie) ou construites il y a
      -- plus de 15 min (filet des sources sans marque : ventes Yuno, comptes).
      -- Avant (20261018240000), toute portée lue était reconstruite à chaque
      -- passe du cron, même sans aucun changement : 3 277 reconstructions,
      -- 2,1 s en moyenne, le plus gros consommateur de la base.
      SELECT s.scope_key, s.venue_id, s.organizer_user_id, 0 AS prio, s.last_read_at AS t
        FROM public.contact_base_cache_state s
       WHERE s.last_read_at > now() - interval '15 minutes'
         AND public.contact_base_cache_due(s.built_at, s.dirty_at)
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
        IF NOT FOUND OR public.contact_base_cache_due(v_state.built_at, v_state.dirty_at) THEN
          PERFORM public._contact_base_cache_build(r.scope_key, r.venue_id, r.organizer_user_id, false);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact_base_cache_refresh(%): %', r.scope_key, SQLERRM;
    END;
    COMMIT;
  END LOOP;
END;
$procedure$;
