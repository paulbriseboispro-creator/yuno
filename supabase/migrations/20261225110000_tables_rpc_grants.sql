-- Tables VIP, vague A — P6.2 : les RPC de configuration / gestion des tables ne sont plus exécutables par un visiteur.
--
-- Postgres accorde EXECUTE à PUBLIC par défaut : apply_vip_room_to_event, enable_collab_tables et set_event_tables_mode
-- étaient appelables avec la seule clé publique (elles lèvent « Not authenticated » sans session, mais une surface
-- SECURITY DEFINER n'a aucune raison d'être ouverte à anon). Même traitement pour les fonctions pro du même périmètre
-- dont l'accès anonyme n'a aucun usage (toutes lisent auth.uid() ou ne servent qu'une Console).
--
-- Gardées anon volontairement : get_event_table_availability (la page de réservation en a besoin),
-- can_manage_event_tables (évaluée dans des policies ALL qui s'appliquent aussi à anon en lecture : la retirer
-- ferait échouer les SELECT publics de table_packs / table_zones / venue_floor_plans).
-- generate_table_reference (appelée par le trigger d'insertion) et les fonctions de trigger sont laissées en l'état.
-- GRANT explicites : authenticated (Console) et service_role (edge, crons).

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.apply_vip_room_to_event(uuid,uuid)',
    'public.enable_collab_tables(uuid)',
    'public.set_event_tables_mode(uuid,text)',
    'public.enable_collab_basic_tables(uuid)',
    'public.save_event_vip_room(uuid,text,uuid)',
    'public.compute_collab_table_settlement(uuid)',
    'public.prepare_collab_table_settlement(uuid)',
    'public.cancel_collab_table_settlement(uuid)',
    'public.calculate_vip_upsell(uuid)',
    'public.upsert_event_floor_plan(uuid,jsonb,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;
END $$;

-- Les deux lectures analytiques prennent des paramètres typés différemment selon les versions : on les retrouve par nom.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_vip_table_analytics', 'get_vip_consumption_analytics')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
