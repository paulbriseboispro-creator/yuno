-- ═══════════════════════════════════════════════════════════════════════════
-- Restaure public.is_direct_client_write(), disparue de la base vivante
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Constaté le 2026-09-21 en rejouant le décompte de soirée dans une transaction
-- annulée : « function public.is_direct_client_write() does not exist ». La
-- fonction avait été créée par 20260721090000 et est appelée par DEUX triggers
-- de garde SECURITY INVOKER encore en place :
--   - guard_collab_settlement_write  (collab_table_settlements, 20260805103000)
--   - guard_collab_night_closing_write (collab_night_closings, 20260921120000)
-- Sans elle, TOUTE mise à jour ou suppression d'un règlement collab levait cette
-- erreur — y compris depuis les RPC du cycle (declare_collab_settlement_sent,
-- confirm_collab_settlement_received, dispute, resolve, cancel). Le complément
-- tables « total dépensé » ne pouvait donc plus avancer d'un cran en prod.
--
-- Le contrat est celui d'origine : dans un trigger SECURITY INVOKER,
-- current_user est le rôle réellement actif — `authenticated` / `anon` pour une
-- écriture PostgREST directe (à refuser), le propriétaire de la RPC SECURITY
-- DEFINER pour une écriture passée par le cycle (à laisser passer). Ne JAMAIS
-- l'appeler depuis le corps d'une fonction SECURITY DEFINER : current_user y
-- vaut toujours le propriétaire et la garde serait morte (cf. 20260731153000).
CREATE OR REPLACE FUNCTION public.is_direct_client_write()
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT current_user IN ('authenticated', 'anon');
$fn$;

COMMENT ON FUNCTION public.is_direct_client_write() IS
  'Vrai quand l''écriture en cours vient directement d''un client PostgREST (rôle authenticated/anon). À n''utiliser que dans un trigger SECURITY INVOKER.';

-- Le trigger s'exécute sous le rôle appelant : ce rôle doit pouvoir évaluer la garde.
GRANT EXECUTE ON FUNCTION public.is_direct_client_write() TO authenticated, anon, service_role;
