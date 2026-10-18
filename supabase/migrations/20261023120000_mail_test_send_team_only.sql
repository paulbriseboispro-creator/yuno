-- Suite de l'audit Yuno CRM du 18/10 — MAIL-08 (P2) : un e-mail de test ne
-- part qu'à l'équipe de l'espace, 20 fois par jour au plus.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- AVANT : `send-campaign` (mode test) envoyait au titulaire + jusqu'à cinq
-- adresses LIBRES, sans limite, sans Yunit, depuis le domaine marketing
-- partagé : un relais d'envoi pour qui a un compte, au nom de n'importe quel
-- club.
--
-- MAINTENANT, une porte unique appelée par le worker avant tout test
-- (`email_test_send_allow`) :
--   · reçoit le test : la personne qui clique, plus les adresses demandées QUI
--     SONT DE L'ÉQUIPE de l'espace (`email_scope_team_emails` : celle que
--     montre Compte › Équipe — titulaire, gérants d'un club, membres admin /
--     éditeur / lecteur d'une organisation ; super admins pour Yuno) ; les
--     autres sont refusées et rendues au front, qui les nomme ;
--   · 20 envois de test par jour (de Paris) et par espace, six adresses au plus
--     chacun ; au-delà, `test_limit`.
-- Un test reste gratuit (aucun Yunit) et ne passe jamais par la file.

CREATE TABLE IF NOT EXISTS public.email_test_sends (
  scope_key text NOT NULL,
  day date NOT NULL,
  n integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, day)
);
COMMENT ON TABLE public.email_test_sends IS
  'Envois d''e-mails de test par espace et par jour de Paris (audit 18/10, MAIL-08). Écrit par email_test_send_allow seulement.';
ALTER TABLE public.email_test_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_test_sends FROM PUBLIC, anon, authenticated;

-- Adresses de l'équipe d'un espace, en minuscules (miroir de crm_team_get).
CREATE OR REPLACE FUNCTION public.email_scope_team_emails(p_venue_id text, p_organizer_user_id uuid)
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT lower(btrim(p.email))
    FROM public.venues v JOIN public.profiles p ON p.id = v.owner_id
   WHERE p_venue_id IS NOT NULL AND v.id = p_venue_id AND COALESCE(p.email, '') <> ''
  UNION
  SELECT lower(btrim(p.email))
    FROM public.manager_permissions mp JOIN public.profiles p ON p.id = mp.user_id
   WHERE p_venue_id IS NOT NULL AND mp.venue_id = p_venue_id AND COALESCE(p.email, '') <> ''
  UNION
  SELECT lower(btrim(p.email))
    FROM public.profiles p
   WHERE p_venue_id IS NULL AND p.id = p_organizer_user_id AND COALESCE(p.email, '') <> ''
  UNION
  SELECT lower(btrim(COALESCE(p.email, m.member_email)))
    FROM public.org_members m LEFT JOIN public.profiles p ON p.id = m.member_user_id
   WHERE p_venue_id IS NULL AND m.organizer_user_id = p_organizer_user_id
     AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor', 'viewer')
     AND COALESCE(p.email, m.member_email, '') <> ''
  UNION
  SELECT lower(btrim(p.email))
    FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
   WHERE p_venue_id IS NULL AND p_organizer_user_id IS NULL
     AND r.role::text = 'admin' AND COALESCE(p.email, '') <> ''
$function$;

REVOKE ALL ON FUNCTION public.email_scope_team_emails(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_scope_team_emails(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.email_test_send_allow(
  p_venue_id text, p_organizer_user_id uuid, p_caller uuid, p_emails text[], p_limit integer DEFAULT 20)
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
  v_team text[];
  v_me text;
  v_allowed text[] := '{}';
  v_refused text[] := '{}';
  v_e text;
  v_n integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'email_test_send_allow: service_role only';
  END IF;

  SELECT COALESCE(array_agg(t), '{}') INTO v_team
    FROM public.email_scope_team_emails(p_venue_id, p_organizer_user_id) t;
  -- La personne qui clique (le worker a vérifié qu'elle agit dans cet espace).
  SELECT NULLIF(lower(btrim(p.email)), '') INTO v_me FROM public.profiles p WHERE p.id = p_caller;
  IF v_me IS NOT NULL THEN v_allowed := ARRAY[v_me]; END IF;

  FOREACH v_e IN ARRAY COALESCE(p_emails, '{}') LOOP
    v_e := lower(btrim(COALESCE(v_e, '')));
    CONTINUE WHEN v_e = '' OR v_e = ANY (v_allowed) OR v_e = ANY (v_refused);
    IF v_e = ANY (v_team) THEN
      IF cardinality(v_allowed) < 6 THEN v_allowed := array_append(v_allowed, v_e); END IF;
    ELSE
      v_refused := array_append(v_refused, v_e);
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
  -- Les compteurs de plus d'une semaine ne servent plus.
  DELETE FROM public.email_test_sends WHERE day < v_day - 7;

  RETURN jsonb_build_object('ok', true, 'allowed', to_jsonb(v_allowed), 'refused', to_jsonb(v_refused),
                            'used', v_n, 'limit', GREATEST(1, COALESCE(p_limit, 20)));
END;
$function$;

REVOKE ALL ON FUNCTION public.email_test_send_allow(text, uuid, uuid, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_test_send_allow(text, uuid, uuid, text[], integer) TO service_role;
