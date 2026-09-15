-- Les RPC du marketing plateforme ne sont pas des surfaces publiques.
--
-- `REVOKE ... FROM PUBLIC` ne suffit pas : Supabase pose un GRANT EXECUTE
-- EXPLICITE à `anon` et `authenticated` sur toute fonction créée dans `public`.
-- Le garde `is_super_admin()` refuse déjà l'appel, mais laisser `anon` dans la
-- liste des exécutants d'une fonction qui écrit dans le registre de
-- consentement est un mauvais défaut : on retire le droit à la source.
REVOKE EXECUTE ON FUNCTION public.sync_platform_marketing_contacts(text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_platform_marketing_overview() FROM anon;
REVOKE EXECUTE ON FUNCTION public.count_platform_audience_kinds() FROM anon;
