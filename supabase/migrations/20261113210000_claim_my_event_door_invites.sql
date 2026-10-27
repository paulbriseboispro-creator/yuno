-- Un staff qui se connecte à Yuno Pro SANS passer par le lien de son invitation
-- (Apple, Google, « Recevoir un code ») avec l'adresse d'une invitation de porte
-- en attente : l'invitation s'accepte toute seule.
--
-- Constaté le 27/10 avec le premier vrai videur invité (House Of Masquerade) :
-- connecté par Apple sur le bon compte, il tombait sur « pas d'accès » et l'app
-- le déconnectait (ProAccessGate refuse un compte sans rôle pro), son invitation
-- restant « en attente ».
--
-- La preuve est la même que sur la page d'invitation : l'adresse CONFIRMÉE du
-- compte (code par e-mail, Apple, Google) est celle à laquelle l'invitation a
-- été envoyée. Les règles restent celles d'`accept_event_door_invite` (soirée
-- ouverte, pas révoquée, démo avec démo) ; une invitation refusée par elle est
-- simplement laissée en attente. Jamais en session d'accès assisté.

CREATE OR REPLACE FUNCTION public.claim_my_event_door_invites()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_row    record;
  v_titles text[] := '{}';
BEGIN
  IF v_uid IS NULL OR public.is_support_session() THEN
    RETURN jsonb_build_object('claimed', 0, 'events', '[]'::jsonb);
  END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u
   WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('claimed', 0, 'events', '[]'::jsonb);
  END IF;

  FOR v_row IN
    SELECT ds.token, e.title
      FROM public.event_door_staff ds
      JOIN public.events e ON e.id = ds.event_id
     WHERE ds.status = 'pending' AND lower(ds.email) = v_email
       AND public._event_door_window_open(ds.event_id)
     ORDER BY e.start_at
  LOOP
    BEGIN
      PERFORM public.accept_event_door_invite(v_row.token, v_uid, v_email);
      v_titles := v_titles || v_row.title;
    EXCEPTION WHEN raise_exception THEN
      NULL; -- règle d'acceptation non remplie : l'invitation reste en attente
    END;
  END LOOP;

  IF cardinality(v_titles) > 0 THEN
    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (v_uid, 'bouncer', v_email)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('claimed', cardinality(v_titles), 'events', to_jsonb(v_titles));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_event_door_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_event_door_invites() TO authenticated;
