-- Résoudre un email vers le compte auth VIVANT — jamais vers un profil orphelin.
--
-- `accept-staff-invitation` cherchait le destinataire avec
--   profiles.select('id').eq('email', …).limit(1)
-- sans ORDER BY. Sur un email en doublon (7 profils orphelins recensés dans
-- docs/ORPHAN_PROFILES.md, hérités des suppressions douces), PostgREST rend la
-- ligne en ordre PHYSIQUE : pour paul.brisebois.pro@gmail.com, c'est le profil
-- ORPHELIN (aucune ligne auth.users) qui sortait. Les upserts `user_roles` /
-- `org_staff` qui suivent pointent une FK vers auth.users : ils échouaient en
-- 23503, l'erreur n'était pas lue, et l'invitation finissait « acceptée » sans
-- qu'aucun rôle ne soit posé. Un employé avec un écran de succès et aucun droit.
--
-- La question « quel compte porte cet email ? » n'a qu'une réponse correcte :
-- celle de auth.users. Cette fonction est cette réponse.
CREATE OR REPLACE FUNCTION public.auth_user_id_for_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT u.id
  FROM auth.users u
  WHERE u.email IS NOT NULL
    AND lower(u.email) = lower(btrim(coalesce(_email, '')))
    AND u.deleted_at IS NULL
  -- Un email est unique dans auth.users ; l'ordre est une ceinture, pas une règle.
  ORDER BY u.created_at
  LIMIT 1
$function$;

-- Un id de compte est une donnée d'annuaire : jamais exposée au client.
-- Seul le service_role (les fonctions edge) résout un email.
REVOKE ALL ON FUNCTION public.auth_user_id_for_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_id_for_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.auth_user_id_for_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_for_email(text) TO service_role;

COMMENT ON FUNCTION public.auth_user_id_for_email(text) IS
  'Email → id du compte auth VIVANT. Porte unique : ne jamais chercher un destinataire par profiles.email (doublons orphelins). service_role seulement.';
