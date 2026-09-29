-- ═══════════════════════════════════════════════════════════════════════════
-- Co-organisation : un bac à sable de test RÉEL ↔ DÉMO, pour Amoris seul (29/09).
--
-- La démo ne s'invite qu'entre comptes démo (`demo_mismatch`, recherche qui
-- cache la démo au réel). Paul gère Amoris et veut jouer la co-organisation
-- de bout en bout avec Stripe live : Amoris (vrai compte, vrai Stripe) invite
-- l'organisateur démo sur une de SES soirées.
--
-- L'exception est ÉTROITE, et c'est ce qui la rend sûre :
--   • une liste explicite d'organisations (`coorg_demo_sandbox_orgs`, RLS sans
--     policy, une ligne = Amoris) — la retirer referme tout ;
--   • seulement sur une soirée que l'organisation MÈNE et qui est en lien
--     PRIVÉ (`visibility = 'private'`) : jamais une soirée publique qui
--     afficherait « Présenté par … × Organisateur Démo » à de vrais clients ;
--   • seul le sens réel → démo s'ouvre (une soirée démo n'invite toujours pas
--     un vrai compte).
--
-- Et deux verrous posés POUR TOUTES les soirées réelles, exception ou non :
-- aucune donnée d'un vrai client n'atteint un compte démo (que les prospects
-- lisent par les liens d'aperçu).
--   1. La case email du checkout ne NOMME jamais une partie démo sur une
--      soirée réelle, et le consentement ne s'y verse jamais
--      (`get_event_marketing_hosts`, `_coorg_apply_cohost_consent`).
--   2. Le push de lancement ne vise pas les abonnés d'une partie démo et ne
--      la nomme pas (`get_event_host_followers`).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.coorg_demo_sandbox_orgs (
  organizer_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coorg_demo_sandbox_orgs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coorg_demo_sandbox_orgs FROM anon, authenticated;
COMMENT ON TABLE public.coorg_demo_sandbox_orgs IS
  'Organisations RÉELLES autorisées à inviter un compte démo en co-organisation, sur leurs soirées privées. Test seulement : supprimer la ligne referme l''exception.';

INSERT INTO public.coorg_demo_sandbox_orgs (organizer_user_id, note)
SELECT u.id, 'Amoris — tests de co-organisation avec la démo et Stripe live (Paul, 29/09)'
  FROM auth.users u
 WHERE u.id = '06ce47f8-66a5-42d5-a7bf-56253619ff96'
ON CONFLICT (organizer_user_id) DO NOTHING;

-- ─── Portes de l'exception ─────────────────────────────────────────────────

-- NULL = soirée hors bac à sable ; 'ok' = invitation démo permise ;
-- 'not_private' = soirée d'une organisation du bac à sable, mais publique.
CREATE OR REPLACE FUNCTION public.coorg_demo_sandbox_status(p_event_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN e.visibility = 'private' THEN 'ok' ELSE 'not_private' END
    FROM public.events e
    JOIN public.coorg_demo_sandbox_orgs s ON s.organizer_user_id = e.organizer_user_id
   WHERE e.id = p_event_id
     AND e.venue_id IS NULL
     AND NOT (e.id = ANY (public.demo_event_ids()));
$$;
REVOKE ALL ON FUNCTION public.coorg_demo_sandbox_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coorg_demo_sandbox_status(uuid) TO service_role;

-- L'appelant travaille pour une organisation du bac à sable (fondateur ou
-- équipe admin / éditeur) : la recherche lui montre aussi les comptes démo.
CREATE OR REPLACE FUNCTION public.coorg_demo_sandbox_caller()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.coorg_demo_sandbox_orgs s
     WHERE s.organizer_user_id = auth.uid()
        OR public.is_org_team_member(auth.uid(), s.organizer_user_id, 'editor'));
$$;
REVOKE ALL ON FUNCTION public.coorg_demo_sandbox_caller() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coorg_demo_sandbox_caller() TO service_role;

-- Une partie (club ou organisation) est-elle un compte démo ?
CREATE OR REPLACE FUNCTION public.coorg_party_is_demo(p_kind text, p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN p_kind = 'venue'
              THEN COALESCE(p_venue_id = ANY (public.demo_venue_ids()), false)
              ELSE COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u
                              WHERE u.id = p_organizer_user_id), false) END;
$$;
REVOKE ALL ON FUNCTION public.coorg_party_is_demo(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coorg_party_is_demo(text, text, uuid) TO service_role;

-- ─── Recherche de partenaires (définition EN LIGNE, seule la porte démo change)
CREATE OR REPLACE FUNCTION public.search_coorg_partners(p_query text, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- La démo ne voit que la démo, le réel ne voit jamais la démo — sauf une
  -- organisation du bac à sable de test, qui voit les deux.
  WITH q AS (SELECT lower(btrim(COALESCE(p_query, ''))) AS s,
                    COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = auth.uid()), false) AS demo,
                    public.coorg_demo_sandbox_caller() AS sandbox)
  SELECT COALESCE(jsonb_agg(x ORDER BY x.followers DESC NULLS LAST, x.name), '[]'::jsonb)
    FROM (
      (SELECT 'org' AS kind, op.user_id::text AS id, op.display_name AS name, op.slug,
              op.avatar_url, op.city,
              (SELECT count(*) FROM public.organizer_profile_followers f WHERE f.organizer_user_id = op.user_id) AS followers
         FROM public.organizer_profiles op, q
        WHERE auth.uid() IS NOT NULL
          AND length(q.s) >= 2
          AND COALESCE(op.is_public, true)
          AND op.user_id <> auth.uid()
          AND (COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = op.user_id), false) = q.demo
               OR (q.sandbox AND NOT q.demo))
          AND (lower(op.display_name) LIKE '%' || q.s || '%' OR lower(COALESCE(op.slug, '')) LIKE '%' || q.s || '%')
        LIMIT p_limit)
      UNION ALL
      (SELECT 'venue', v.id, v.name, v.slug, v.logo_url, v.city,
              (SELECT count(*) FROM public.favorites f WHERE f.venue_id = v.id)
         FROM public.venues v, q
        WHERE auth.uid() IS NOT NULL
          AND length(q.s) >= 2
          AND v.decommissioned_at IS NULL
          AND (NOT COALESCE(v.is_hidden, false) OR v.id = ANY (public.demo_venue_ids()))
          AND ((v.id = ANY (public.demo_venue_ids())) = q.demo OR (q.sandbox AND NOT q.demo))
          AND (lower(v.name) LIKE '%' || q.s || '%' OR lower(COALESCE(v.slug, '')) LIKE '%' || q.s || '%'
               OR lower(COALESCE(v.city, '')) LIKE '%' || q.s || '%')
        LIMIT p_limit)
    ) x;
$function$;

-- ─── Invitation d'un co-hôte (définition EN LIGNE, seule la porte démo change)
CREATE OR REPLACE FUNCTION public.invite_event_cohost(p_event_id uuid, p_organizer_user_id uuid DEFAULT NULL::uuid, p_venue_id text DEFAULT NULL::text, p_access text DEFAULT 'editor'::text, p_share_crm boolean DEFAULT true, p_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_party text;
  v_id    uuid;
  v_count integer;
  v_title text;
  v_ev_demo boolean;
  v_inv_demo boolean;
  v_sandbox text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF (p_organizer_user_id IS NULL) = (p_venue_id IS NULL) THEN RAISE EXCEPTION 'one_party_required'; END IF;
  IF p_access NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_access'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR v_ev.end_at < now() THEN RAISE EXCEPTION 'event_closed'; END IF;

  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_party := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id END;
  IF EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = v_party) THEN
    RAISE EXCEPTION 'already_party';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_cohosts c WHERE c.event_id = p_event_id AND c.status = 'pending'
              AND (c.organizer_user_id = p_organizer_user_id OR c.venue_id = p_venue_id)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id) THEN
      RAISE EXCEPTION 'organizer_not_found';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.decommissioned_at IS NULL) THEN
      RAISE EXCEPTION 'venue_not_found';
    END IF;
  END IF;

  -- La démo ne s'invite qu'entre comptes démo : une soirée démo annoncée par
  -- les recettes d'un vrai compte partirait chez de vrais clients.
  -- Exception : une organisation du bac à sable de test invite la démo sur
  -- une de SES soirées PRIVÉES (jamais l'inverse).
  v_ev_demo := p_event_id = ANY (public.demo_event_ids());
  v_inv_demo := CASE WHEN p_venue_id IS NOT NULL THEN p_venue_id = ANY (public.demo_venue_ids())
                     ELSE COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = p_organizer_user_id), false) END;
  IF v_ev_demo IS DISTINCT FROM v_inv_demo THEN
    v_sandbox := CASE WHEN v_inv_demo AND NOT v_ev_demo THEN public.coorg_demo_sandbox_status(p_event_id) END;
    IF v_sandbox = 'not_private' THEN RAISE EXCEPTION 'demo_sandbox_private_only'; END IF;
    IF v_sandbox IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'demo_mismatch'; END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.event_cohosts c
   WHERE c.event_id = p_event_id AND c.status IN ('pending', 'accepted');
  IF v_count >= 8 THEN RAISE EXCEPTION 'too_many_cohosts'; END IF;

  INSERT INTO public.event_cohosts (event_id, organizer_user_id, venue_id, access, share_crm, message,
                                    invited_by, invited_by_party)
  VALUES (p_event_id, p_organizer_user_id, p_venue_id, p_access, COALESCE(p_share_crm, true),
          NULLIF(btrim(COALESCE(p_message, '')), ''), v_uid, v_me.party_key)
  RETURNING id INTO v_id;

  -- L'accord en cours NE bouge PAS : la nouvelle partie y entre à 0 % (hors
  -- décompte) tant que les parts ne sont pas reproposées et re-signées.

  v_title := COALESCE(v_ev.title, 'Soirée');
  PERFORM public.notify_coorg_party(v_party, p_event_id, 'cohost_invited',
    'Invitation à co-organiser',
    COALESCE((SELECT display_name FROM public.event_parties(p_event_id) WHERE party_key = v_me.party_key), 'Un partenaire')
      || ' t''invite à co-organiser « ' || v_title || ' ».',
    v_id, 'cohost_invited:' || v_id::text);
  RETURN v_id;
END;
$function$;

-- ─── Verrou 1 : la case email ne nomme jamais une partie démo sur une soirée réelle
CREATE OR REPLACE FUNCTION public.get_event_marketing_hosts(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS MATERIALIZED (SELECT (p_event_id = ANY (public.demo_event_ids())) AS ev_demo)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', p.party_key, 'kind', p.kind, 'venue_id', p.venue_id,
           'organizer_user_id', p.organizer_user_id, 'name', p.display_name, 'role', p.role
         ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
    FROM public.event_parties(p_event_id) p, d
   WHERE p.share_crm AND COALESCE(btrim(p.display_name), '') <> ''
     -- Soirée réelle : aucun client réel ne s'abonne à un compte démo.
     AND (d.ev_demo OR NOT public.coorg_party_is_demo(p.kind, p.venue_id, p.organizer_user_id));
$function$;

CREATE OR REPLACE FUNCTION public._coorg_apply_cohost_consent(p_event_id uuid, p_email text, p_host_keys text[], p_wording text, p_locale text, p_source text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_ev record; v_primary text; v_uid uuid; p record; v_n integer := 0;
  v_ev_demo boolean;
BEGIN
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_email = '' OR COALESCE(array_length(p_host_keys, 1), 0) = 0 THEN RETURN 0; END IF;
  v_primary := CASE WHEN v_ev.venue_id IS NOT NULL THEN 'venue:' || v_ev.venue_id ELSE 'org:' || v_ev.organizer_user_id END;
  v_ev_demo := p_event_id = ANY (public.demo_event_ids());
  SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  FOR p IN SELECT * FROM public.event_parties(p_event_id) x
            WHERE x.share_crm AND x.party_key <> v_primary AND x.party_key = ANY (p_host_keys)
              -- Soirée réelle : jamais un contact réel versé dans un compte démo.
              AND (v_ev_demo OR NOT public.coorg_party_is_demo(x.kind, x.venue_id, x.organizer_user_id))
  LOOP
    IF p.kind = 'venue' THEN
      INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.venue_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    ELSE
      INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.organizer_user_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    END IF;
    INSERT INTO public.marketing_consent_events (user_id, email, channel, venue_id, organizer_user_id,
                                                 action, wording_key, wording_text, locale, source)
    VALUES (v_uid, v_email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'consent.emailOffersFrom',
            left(btrim(p_wording), 1000), p_locale, left(COALESCE(p_source, 'checkout'), 60) || ':cohost');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ─── Verrou 2 : le push de lancement ignore les parties démo d'une soirée réelle
CREATE OR REPLACE FUNCTION public.get_event_host_followers(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS MATERIALIZED (SELECT (p_event_id = ANY (public.demo_event_ids())) AS ev_demo),
  hosts AS MATERIALIZED (
    SELECT p.* FROM public.event_parties(p_event_id) p, d
     WHERE d.ev_demo OR NOT public.coorg_party_is_demo(p.kind, p.venue_id, p.organizer_user_id)
  )
  SELECT jsonb_build_object(
    'user_ids', COALESCE((
      SELECT jsonb_agg(DISTINCT x.user_id) FROM (
        SELECT f.user_id FROM public.favorites f
          JOIN hosts p ON p.kind = 'venue' AND f.venue_id = p.venue_id
         WHERE f.user_id IS NOT NULL
        UNION
        SELECT f.user_id FROM public.organizer_profile_followers f
          JOIN hosts p ON p.kind = 'org' AND f.organizer_user_id = p.organizer_user_id
      ) x), '[]'::jsonb),
    'host_names', (SELECT string_agg(p.display_name, ' × ' ORDER BY p.ord, p.party_key) FROM hosts p),
    'parties', (SELECT count(*) FROM hosts)
  );
$function$;
