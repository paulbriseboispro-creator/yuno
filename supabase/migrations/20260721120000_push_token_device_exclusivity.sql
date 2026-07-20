-- Un device token APNs n'appartient qu'à UNE personne.
--
-- Symptôme : un même téléphone recevait la même notification en français, en
-- anglais et en espagnol. Cause : `syncNativeTokenToDb` purgeait les anciens
-- tokens avec `.eq('user_id', <moi>)`, donc uniquement pour le compte connecté.
-- Quand une autre personne se connectait sur le même téléphone, la ligne du
-- compte précédent restait en base en pointant vers le MÊME token APNs. Le
-- fan-out résolvait ensuite `profiles.preferred_language` compte par compte —
-- chacun dans sa langue — et APNs livrait tout sur le seul appareil physique.
--
-- Correctif structurel : l'enregistrement passe par une RPC qui revendique le
-- token pour la personne connectée, et un index unique rend l'invariant
-- impossible à violer depuis n'importe quel autre chemin.

-- 1. Nettoyage des tokens déjà orphelins : on ne garde, pour chaque
--    (endpoint, plateforme), que la ligne la plus récente.
--    NULLS LAST + départage par id : `created_at` est nullable, et une
--    comparaison impliquant NULL laisserait deux doublons en place — l'index
--    unique de l'étape 2 échouerait alors et annulerait toute la migration.
DELETE FROM public.push_subscriptions
 WHERE platform IN ('ios', 'ios_pro')
   AND id NOT IN (
     SELECT DISTINCT ON (endpoint, platform) id
       FROM public.push_subscriptions
      WHERE platform IN ('ios', 'ios_pro')
      ORDER BY endpoint, platform, created_at DESC NULLS LAST, id DESC
   );

-- 2. L'invariant, au niveau de la base. Restreint aux plateformes natives :
--    les lignes 'web' héritées ne sont plus alimentées et ne doivent pas
--    faire échouer la migration.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_native_endpoint_key
    ON public.push_subscriptions (endpoint, platform)
 WHERE platform IN ('ios', 'ios_pro');

-- 3. Enregistrement d'un token : revendique l'appareil pour l'appelant.
--    SECURITY DEFINER car l'étape décisive (supprimer la ligne d'un AUTRE
--    compte pointant vers ce téléphone) est par nature hors de portée du RLS
--    de l'appelant.
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_endpoint text,
  p_platform text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_endpoint IS NULL OR length(btrim(p_endpoint)) = 0 THEN
    RAISE EXCEPTION 'endpoint required';
  END IF;
  IF p_platform NOT IN ('ios', 'ios_pro') THEN
    RAISE EXCEPTION 'unsupported platform: %', p_platform;
  END IF;

  -- Ce téléphone appartient désormais à la personne connectée : toute ligne
  -- d'un autre compte pointant vers le même token est caduque.
  DELETE FROM public.push_subscriptions
   WHERE endpoint = p_endpoint
     AND platform = p_platform
     AND user_id <> v_user;

  -- Et cette personne n'a qu'un seul token courant par app.
  DELETE FROM public.push_subscriptions
   WHERE user_id = v_user
     AND platform = p_platform
     AND endpoint <> p_endpoint;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
  VALUES (v_user, p_endpoint, NULL, NULL, p_platform)
  ON CONFLICT (user_id, endpoint)
  DO UPDATE SET platform = EXCLUDED.platform;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text) TO authenticated;

COMMENT ON FUNCTION public.register_push_token(text, text) IS
  'Enregistre le token APNs de l''appelant et libère ce token de tout autre compte. Évite qu''un téléphone reçoive les notifications de chaque compte y ayant été connecté (et donc dans chaque langue).';
