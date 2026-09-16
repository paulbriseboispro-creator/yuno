-- ============================================================================
-- Le rafraîchissement de l'engagement doit tourner SANS requête HTTP
-- (2026-09-15, correctif de 180000)
--
-- `contact_scope_allowed` lit auth.uid() / auth.role() : dans un job pg_cron
-- ou une migration il n'y a ni l'un ni l'autre, et le premier remplissage a
-- répondu « Unauthorized » sur les quatre portées. Le balayage toutes les
-- 10 minutes aurait fait pareil, en silence.
--
-- La porte devient : la portée est autorisée pour l'appelant, OU l'appel vient
-- d'un contexte interne. Le contexte interne se reconnaît à `session_user`
-- (le rôle de connexion : `postgres` pour cron et migrations), JAMAIS à
-- `current_user`, qui vaut toujours le propriétaire dans une fonction
-- SECURITY DEFINER et ouvrirait la porte à tout le monde.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.contact_scope_allowed_or_internal(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT session_user IN ('postgres', 'supabase_admin')
      OR public.contact_scope_allowed(p_venue_id, p_organizer_user_id);
$$;
REVOKE ALL ON FUNCTION public.contact_scope_allowed_or_internal(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_scope_allowed_or_internal(text, uuid) TO authenticated, service_role;

-- Les trois fonctions qui gardaient sur contact_scope_allowed passent par la
-- nouvelle porte. Corps identiques à 180000 hors cette ligne.
DO $$
DECLARE
  v_names text[] := ARRAY['refresh_contact_engagement', 'refresh_campaign_list_impacts'];
  v_name text;
  v_def text;
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    v_def := replace(v_def,
      'IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN',
      'IF NOT public.contact_scope_allowed_or_internal(p_venue_id, p_organizer_user_id) THEN');
    EXECUTE v_def;
  END LOOP;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_campaign_list_baseline';
  v_def := replace(v_def,
    'IF NOT public.contact_scope_allowed(c.venue_id, c.organizer_user_id) THEN',
    'IF NOT public.contact_scope_allowed_or_internal(c.venue_id, c.organizer_user_id) THEN');
  EXECUTE v_def;
END $$;

-- Premier remplissage, cette fois dans le bon contexte.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT venue_id, organizer_user_id FROM (
      SELECT li.venue_id, li.organizer_user_id FROM public.contact_list_imports li
      UNION
      SELECT c.venue_id, c.organizer_user_id FROM public.email_campaigns c WHERE c.status = 'sent'
    ) s
  LOOP
    BEGIN
      PERFORM public.refresh_contact_engagement(r.venue_id, r.organizer_user_id);
      PERFORM public.refresh_campaign_list_impacts(r.venue_id, r.organizer_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'contact engagement backfill (%, %): %', r.venue_id, r.organizer_user_id, SQLERRM;
    END;
  END LOOP;
END $$;
