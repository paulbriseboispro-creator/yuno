-- ============================================================================
-- Toggle "Live" pour la démo : rend le club/orga démo visibles dans l'app publique
-- (comme un vrai club) le temps d'une présentation, puis re-masquables.
--   demo_set_live(true)  -> venues.is_hidden=false + events démo public/discoverable
--   demo_set_live(false) -> re-masque tout (état démo isolé par défaut)
-- Réservé aux comptes démo @womber.fr (SECURITY DEFINER pour marcher quel que soit
-- le compte démo connecté, sans dépendre de la RLS owner).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.demo_set_live(p_live boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid; v_venue text; v_org uuid;
BEGIN
  IF COALESCE(auth.jwt() ->> 'email', '') NOT LIKE '%@womber.fr' THEN
    RAISE EXCEPTION 'Réservé aux comptes démo';
  END IF;

  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  SELECT id INTO v_org FROM auth.users WHERE email = 'organizer@womber.fr';

  UPDATE public.venues
    SET is_hidden = NOT p_live, hidden_from_map = NOT p_live
    WHERE id = v_venue;

  UPDATE public.events SET
      is_discoverable  = p_live,
      visibility       = CASE WHEN p_live THEN 'public'::public.event_visibility ELSE 'private'::public.event_visibility END,
      discovery_status = CASE WHEN p_live THEN 'approved'::public.discovery_status ELSE discovery_status END
    WHERE access_code = 'DEMO_SEED'
      AND (venue_id = v_venue OR organizer_user_id = v_org OR partner_organizer_id = v_org);

  RETURN p_live;
END;
$$;

CREATE OR REPLACE FUNCTION public.demo_is_live()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT COALESCE(v.is_hidden, true)
  FROM public.venues v
  WHERE v.owner_id = (SELECT id FROM auth.users WHERE email = 'owner@womber.fr')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.demo_set_live(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.demo_is_live() TO authenticated;
