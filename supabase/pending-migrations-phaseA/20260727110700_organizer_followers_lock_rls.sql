-- ─────────────────────────────────────────────────────────────────────────────
-- Fix item 4 — organizer_profile_followers world-readable (fuite du graphe social).
--
-- La policy SELECT d'origine (mig 20260419145720) est USING (true) : n'importe qui
-- (même anonyme) peut énumérer QUI suit QUEL organisateur. On verrouille la lecture
-- à sa propre ligne (le self-check « est-ce que je suis ? » continue de marcher) et
-- on expose le compteur PUBLIC via un RPC DEFINER, comme get_public_favorite_count.
--
-- ⚠️ COORDINATION : ce verrou fait passer les counts DIRECTS du front à 0. Le front
-- (EventDetails, OrganizerPublicProfile) est routé vers le RPC dans le même chantier.
-- Cette migration ne doit donc être poussée qu'AVEC le déploiement du nouveau front,
-- sinon les compteurs d'abonnés organisateur affichent 0 en prod dans l'intervalle.
-- (Les writes insert/delete et les reads own-row — OrderConfirmation, Favorites — ne
-- sont pas affectés ; le fan-out push serveur passe en service-role, hors RLS.)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can view organizer profile followers" ON public.organizer_profile_followers;

CREATE POLICY "Users can view their own organizer follows"
ON public.organizer_profile_followers
FOR SELECT
USING (auth.uid() = user_id);

-- Compteur public au grain organisateur (personne). DEFINER : contourne la RLS
-- verrouillée sans réexposer les lignes individuelles.
CREATE OR REPLACE FUNCTION public.get_organizer_follower_count(p_organizer_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.organizer_profile_followers
  WHERE organizer_user_id = p_organizer_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_organizer_follower_count(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_organizer_follower_count(uuid) TO anon, authenticated;
