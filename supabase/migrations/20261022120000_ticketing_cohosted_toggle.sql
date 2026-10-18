-- Audit de préparation Yuno CRM (18/10) — DATA-05.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- « Inclure les soirées que je co-organise » ne faisait que changer le
-- paramètre des PROCHAINES lectures :
--   • allumé après l'import, il ne rattrapait rien : le curseur des billets
--     était déjà au présent, l'historique des soirées co-organisées n'arrivait
--     jamais (seules leurs ventes futures) ;
--   • éteint, il ne retirait rien : billets, soirées miroirs et accords venus
--     de ces soirées restaient dans la base.
--
-- Une soirée co-organisée = une soirée dont Shotgun rend le rôle de
-- l'organisation connectée comme « editor » ou « viewer » (« cohost » est
-- accepté par prudence) ; « organizer » ou rôle absent = sa propre soirée.
-- Mesuré en prod le 18/10 sur WOH : 53 soirées « editor », 25 « viewer »,
-- 203 « organizer ». Un rôle inconnu compte comme une soirée propre : rien
-- n'est jamais retiré sur une valeur qu'on ne connaît pas. Miroir TS :
-- `isCohostedRole` (_shared/ticketing-shotgun.ts, testé).
--
-- Désormais crm_ticketing_set_cohosted :
--   • ALLUMER : relit tout (curseur des billets et date des soirées remis à
--     zéro, passe complète du post-traitement) ;
--   • ÉTEINDRE : retire tout de suite ce qui venait de ces soirées
--     (_ticketing_drop_cohosted) : leurs billets, leurs soirées miroirs (une
--     soirée encore citée par une campagne envoyée reste, inactive et privée,
--     comme à la suppression des données), l'accord que la billetterie avait
--     versé à une personne qui n'a plus aucun billet de la connexion (tracé
--     `connector_cohosted_off`), le profil d'analyse d'une personne qui n'a
--     plus aucun billet dans l'espace ; les autres sont marquées à recalculer.
--     Le connecteur ne recrée plus ces soirées tant que la case est éteinte ;
--   • refuse pendant qu'une lecture tourne (`sync_running`) : la passe en
--     cours réécrirait le curseur et rapporterait des billets déjà retirés.
-- Rien ne change si la case garde sa valeur.

CREATE OR REPLACE FUNCTION public._ticketing_role_is_cohosted(p_role text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(lower(btrim(p_role)) IN ('editor', 'viewer', 'cohost'), false);
$function$;
REVOKE ALL ON FUNCTION public._ticketing_role_is_cohosted(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ticketing_role_is_cohosted(text) TO service_role;

CREATE OR REPLACE FUNCTION public._ticketing_drop_cohosted(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  v_key text;
  v_org uuid;
  v_emails text[];
  v_gone text[];
  v_tickets integer := 0;
  v_events integer := 0;
  v_kept integer := 0;
  v_withdrawn integer := 0;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  v_org := CASE WHEN c.venue_id IS NULL THEN c.organizer_user_id END;

  -- Les billets des soirées co-organisées, et les adresses qu'ils portaient.
  WITH gone AS (
    DELETE FROM public.external_tickets t
     USING public.external_events ee
     WHERE t.connection_id = p_connection_id
       AND ee.connection_id = p_connection_id
       AND ee.external_id = t.external_event_id
       AND public._ticketing_role_is_cohosted(ee.external_role)
    RETURNING lower(t.buyer_email) AS em
  )
  SELECT count(*)::int, COALESCE(array_agg(DISTINCT em) FILTER (WHERE em IS NOT NULL), '{}')
    INTO v_tickets, v_emails
    FROM gone;

  -- Leurs soirées miroirs (même règle que la suppression des données : une
  -- soirée encore citée ailleurs reste, inactive et privée).
  FOR v_id IN
    SELECT ee.event_id FROM public.external_events ee
      JOIN public.events e ON e.id = ee.event_id AND e.external_source IS NOT NULL
     WHERE ee.connection_id = p_connection_id
       AND public._ticketing_role_is_cohosted(ee.external_role)
  LOOP
    BEGIN
      DELETE FROM public.events WHERE id = v_id;
    EXCEPTION WHEN OTHERS THEN
      v_kept := v_kept + 1;
      RAISE WARNING 'mirror event % kept: %', v_id, SQLERRM;
    END;
  END LOOP;
  DELETE FROM public.external_events ee
   WHERE ee.connection_id = p_connection_id
     AND public._ticketing_role_is_cohosted(ee.external_role);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  IF cardinality(v_emails) > 0 THEN
    -- L'accord versé par la billetterie part quand la personne n'a plus aucun
    -- billet de cette connexion ; un refus ou un accord donné ailleurs reste.
    WITH off AS (
      DELETE FROM public.newsletter_subscriptions s
       WHERE ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
           OR (c.venue_id IS NULL AND s.organizer_user_id = c.organizer_user_id))
         AND lower(s.email) = ANY (v_emails)
         AND s.opted_in
         AND COALESCE(s.source, '') = 'connector:' || c.provider
         AND NOT EXISTS (SELECT 1 FROM public.external_tickets t
                          WHERE t.connection_id = p_connection_id AND t.buyer_email = lower(s.email))
      RETURNING s.email, s.user_id
    )
    INSERT INTO public.marketing_consent_events
      (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
    SELECT o.user_id, lower(o.email), 'email', c.venue_id, v_org, 'withdrawn', 'connector_cohosted_off',
           'Soirées co-organisées retirées par le pro (' || c.provider || ') : accord versé par la billetterie retiré',
           'connector:' || c.provider
      FROM off o;
    GET DIAGNOSTICS v_withdrawn = ROW_COUNT;

    -- Plus aucun billet dans l'espace (toutes connexions) : plus de profil
    -- d'analyse ; les autres sont recalculés.
    SELECT COALESCE(array_agg(q.em), '{}') INTO v_gone
      FROM unnest(v_emails) q(em)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.external_tickets t
        WHERE t.buyer_email = q.em
          AND ((c.venue_id IS NOT NULL AND t.venue_id = c.venue_id)
            OR (c.venue_id IS NULL AND t.organizer_user_id = c.organizer_user_id)));
    DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_gone);
    DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_gone);
    INSERT INTO public.crm_analysis_dirty (scope_key, email)
    SELECT v_key, q.em FROM unnest(v_emails) q(em)
     WHERE NOT (q.em = ANY (v_gone))
       AND NOT EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = v_key AND o.email = q.em)
    ON CONFLICT (scope_key, email) DO UPDATE SET marked_at = now();

    UPDATE public.contact_base_cache_state
       SET dirty_at = clock_timestamp()
     WHERE scope_key = public.contact_base_scope_key(c.venue_id, c.organizer_user_id);
  END IF;

  RETURN jsonb_build_object('tickets', v_tickets, 'events', v_events, 'events_kept', v_kept,
                            'consents_withdrawn', v_withdrawn);
END;
$function$;
REVOKE ALL ON FUNCTION public._ticketing_drop_cohosted(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ticketing_drop_cohosted(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_ticketing_set_cohosted(p_venue_id text, p_organizer_user_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  v_on boolean := COALESCE(p_on, true);
  v_removed jsonb;
BEGIN
  IF NOT public.ticketing_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections tc
   WHERE tc.provider = 'shotgun'
     AND ((p_venue_id IS NOT NULL AND tc.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND tc.organizer_user_id = p_organizer_user_id))
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_connected'); END IF;
  IF c.include_cohosted = v_on THEN
    RETURN jsonb_build_object('ok', true, 'include_cohosted', v_on);
  END IF;
  -- Une lecture en cours réécrirait le curseur (allumer) ou rapporterait les
  -- billets qu'on retire (éteindre) : on attend sa fin (2 min au plus).
  IF c.locked_until IS NOT NULL AND c.locked_until > now() THEN
    RETURN jsonb_build_object('error', 'sync_running');
  END IF;

  IF v_on THEN
    UPDATE public.ticketing_connections tc
       SET include_cohosted = true,
           -- Relire tout : l'historique des soirées co-organisées n'a jamais été lu.
           tickets_cursor = NULL,
           events_synced_at = NULL,
           post_full_at = NULL,
           stats_at = NULL,
           next_sync_at = CASE WHEN tc.status IN ('active', 'error') THEN now() ELSE tc.next_sync_at END,
           updated_at = now()
     WHERE tc.id = c.id;
    RETURN jsonb_build_object('ok', true, 'include_cohosted', true, 'reread', true);
  END IF;

  UPDATE public.ticketing_connections tc
     SET include_cohosted = false,
         post_full_at = NULL,
         stats_at = NULL,
         next_sync_at = CASE WHEN tc.status IN ('active', 'error') THEN LEAST(COALESCE(tc.next_sync_at, now()), now() + interval '1 minute') ELSE tc.next_sync_at END,
         updated_at = now()
   WHERE tc.id = c.id;
  v_removed := public._ticketing_drop_cohosted(c.id);
  RETURN jsonb_build_object('ok', true, 'include_cohosted', false, 'removed', v_removed);
END;
$function$;
