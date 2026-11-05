-- Liens suivis de la PAGE d'un organisateur (profil public /o/<slug>), comme ceux
-- d'une soirée et ceux de la page d'un club : un lien par réseau (Instagram,
-- TikTok, Newsletter, WhatsApp), posé tout seul, adresse lisible (« amoris-insta »).
--
-- La redirection /l/ sait déjà viser un profil (record_tracked_link_click rend
-- organizer_slug) et un achat fait après le clic est déjà attribué au lien
-- (setActiveTrackedLink). Il manquait : le semis, et la lecture du Trafic.
--
-- 1. seed_organizer_tracked_links(orga) : fondateur ou équipe (porte
--    tracked_link_team_can_read, la même que la lecture des liens).
-- 2. seed_venue_tracked_links : ouverte à l'équipe du club (managers), plus
--    jamais appelable sans connexion (elle l'était : anon pouvait semer les
--    liens de n'importe quel club).
-- 3. tix_ana_visits__core : la carte « Votre page » du Trafic rend ses visites
--    par lien de page (`page.links`). Remplacement ciblé de la définition
--    vivante, jamais une recopie.

-- ── 1. Semis des liens de la page organisateur ────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_organizer_tracked_links(p_organizer_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_channel  text;
  v_channels text[] := ARRAY['instagram', 'tiktok', 'newsletter', 'whatsapp'];
BEGIN
  IF p_organizer_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id) THEN
    RETURN;
  END IF;
  -- Le fondateur et son équipe (admin, éditeur) : le scope est l'ORGANISATION.
  IF auth.uid() IS NOT NULL AND NOT public.tracked_link_team_can_read('organizer', NULL, p_organizer_user_id) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  FOREACH v_channel IN ARRAY v_channels LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.tracked_links
       WHERE organizer_user_id = p_organizer_user_id AND owner_kind = 'organizer'
         AND target_kind = 'organizer' AND event_id IS NULL AND lower(label) = v_channel
    ) THEN
      -- Le code aléatoire est réécrit en adresse lisible par le déclencheur.
      INSERT INTO public.tracked_links
        (code, label, owner_kind, organizer_user_id, created_by, target_kind, utm_source, utm_medium)
      VALUES
        (public.gen_tracked_link_code(), v_channel, 'organizer', p_organizer_user_id,
         COALESCE(auth.uid(), p_organizer_user_id), 'organizer', v_channel, 'profile_link');
    END IF;
  END LOOP;
END; $function$;

REVOKE ALL ON FUNCTION public.seed_organizer_tracked_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_organizer_tracked_links(uuid) TO authenticated, service_role;

-- ── 2. Semis des liens de la page club : l'équipe, jamais un anonyme ──────
CREATE OR REPLACE FUNCTION public.seed_venue_tracked_links(p_venue_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_channel  text;
  v_channels text[] := ARRAY['instagram', 'tiktok', 'newsletter', 'whatsapp'];
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.venues WHERE id = p_venue_id;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  -- Le propriétaire et l'équipe du club (managers) : même porte que la lecture.
  IF auth.uid() IS NOT NULL AND NOT public.tracked_link_team_can_read('venue', p_venue_id, NULL) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  FOREACH v_channel IN ARRAY v_channels LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.tracked_links
      WHERE venue_id = p_venue_id AND owner_kind = 'venue'
        AND target_kind = 'venue' AND lower(label) = v_channel
    ) THEN
      INSERT INTO public.tracked_links
        (code, label, owner_kind, venue_id, created_by, target_kind, target_venue_id, utm_source, utm_medium)
      VALUES
        (public.gen_tracked_link_code(), v_channel, 'venue', p_venue_id, v_owner_id, 'venue', p_venue_id, v_channel, 'profile_link');
    END IF;
  END LOOP;
END; $function$;

REVOKE ALL ON FUNCTION public.seed_venue_tracked_links(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_venue_tracked_links(text) TO authenticated, service_role;

-- ── 3. Trafic › Votre page : les visites par lien de page ─────────────────
DO $patch$
DECLARE
  v_def text;
  v_old text := $o$'next_total', (SELECT count(*) FROM v p0 WHERE p0.page AND p0.cur AND p0.visitor IS NOT NULL)) END,$o$;
  v_new text := $n$'next_total', (SELECT count(*) FROM v p0 WHERE p0.page AND p0.cur AND p0.visitor IS NOT NULL),
      -- Les visites arrivées par un lien suivi de la page (Instagram, TikTok…) :
      -- même lien, même règle « finie par un achat » que le reste de la carte.
      'links', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'id', x.link_id, 'label', x.label, 'net', x.net, 'med', x.med,
                   'visits', x.visits, 'visitors', x.visitors, 'ordered', x.ordered) ORDER BY x.visits DESC, x.label)
                   FROM (SELECT link_id, max(link_label) AS label, max(link_net) AS net, max(link_med) AS med,
                                count(*) AS visits, count(DISTINCT visitor) AS visitors,
                                count(*) FILTER (WHERE ordered) AS ordered
                           FROM pg WHERE cur AND link_id IS NOT NULL GROUP BY link_id) x), '[]'::jsonb)) END,$n$;
BEGIN
  v_def := pg_get_functiondef('public.tix_ana_visits__core(text,uuid,text,uuid,uuid)'::regprocedure);
  IF position($m$'links', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'id', x.link_id$m$ IN v_def) > 0 THEN
    RETURN; -- déjà appliqué
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'tix_ana_visits__core : repère « next_total » introuvable';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch$;
