-- E-mail de test : n'importe quelle adresse, pas seulement l'équipe (03/11).
--
-- Demande de Paul après le test 3AM Act III : une personne hors de l'équipe de
-- l'espace (Paul depuis le compte de Jules, un associé, un DJ) doit pouvoir
-- recevoir l'aperçu. La porte du 23/10 (MAIL-08, migration 20261023120000)
-- refusait toute adresse hors de `email_scope_team_emails`.
--
-- Ce qui reste, et suffit à ce que le test ne soit pas un relais d'envoi :
--   · 20 tests par jour et par espace (inchangé) ;
--   · 6 destinataires au plus par test : la personne qui clique + 5 ;
--   · une adresse de la liste de suppression (rebond dur, plainte) est
--     refusée : elle abîmerait la réputation du domaine d'envoi partagé ;
--   · une adresse mal formée est refusée.
-- Les adresses écartées reviennent dans `refused`, comme avant.
CREATE OR REPLACE FUNCTION public.email_test_send_allow(p_venue_id text, p_organizer_user_id uuid, p_caller uuid, p_emails text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
                     WHEN p_organizer_user_id IS NOT NULL THEN 'org:' || p_organizer_user_id::text
                     ELSE 'yuno' END;
  v_day date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_me text;
  v_allowed text[] := '{}';
  v_refused text[] := '{}';
  v_e text;
  v_n integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'email_test_send_allow: service_role only';
  END IF;

  -- La personne qui clique (le worker a vérifié qu'elle agit dans cet espace).
  SELECT NULLIF(lower(btrim(p.email)), '') INTO v_me FROM public.profiles p WHERE p.id = p_caller;
  IF v_me IS NOT NULL THEN v_allowed := ARRAY[v_me]; END IF;

  FOREACH v_e IN ARRAY COALESCE(p_emails, '{}') LOOP
    v_e := lower(btrim(COALESCE(v_e, '')));
    CONTINUE WHEN v_e = '' OR v_e = ANY (v_allowed) OR v_e = ANY (v_refused);
    IF v_e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
       OR EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = v_e) THEN
      v_refused := array_append(v_refused, v_e);
    ELSIF cardinality(v_allowed) < 6 THEN
      v_allowed := array_append(v_allowed, v_e);
    END IF;
  END LOOP;

  IF cardinality(v_allowed) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_team_address', 'refused', to_jsonb(v_refused));
  END IF;

  INSERT INTO public.email_test_sends AS s (scope_key, day, n) VALUES (v_key, v_day, 1)
  ON CONFLICT (scope_key, day) DO UPDATE SET n = s.n + 1, updated_at = now()
   WHERE s.n < GREATEST(1, COALESCE(p_limit, 20))
  RETURNING s.n INTO v_n;
  IF v_n IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'test_limit', 'limit', GREATEST(1, COALESCE(p_limit, 20)),
                              'refused', to_jsonb(v_refused));
  END IF;
  DELETE FROM public.email_test_sends WHERE day < v_day - 7;

  RETURN jsonb_build_object('ok', true, 'allowed', to_jsonb(v_allowed), 'refused', to_jsonb(v_refused),
                            'used', v_n, 'limit', GREATEST(1, COALESCE(p_limit, 20)));
END;
$function$;

REVOKE ALL ON FUNCTION public.email_test_send_allow(text, uuid, uuid, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_test_send_allow(text, uuid, uuid, text[], integer) TO service_role;
