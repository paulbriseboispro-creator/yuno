-- Audit de préparation Yuno CRM (18/10) — lot sécurité.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md (SEC-01, SEC-02, SEC-03, MAIL-05).
--
-- 1. SEC-01 (P0) — trois helpers du CRM super admin s'exécutaient avec les droits
--    du propriétaire, SANS garde, et Postgres les avait ouverts à PUBLIC (donc à
--    `anon` et `authenticated`) : avec la clé publique du site, n'importe qui
--    pouvait lire l'identité (nom, téléphone, date de naissance, ville) de toute
--    adresse et l'historique d'achat de tous les clients de la plateforme.
--    Leurs seuls appelants sont des RPC admin SECURITY DEFINER gardées par
--    is_super_admin() (propriétaire postgres) : la révocation ne casse rien.
--    `_admin_paid_activity`, leur voisine, était déjà fermée.
REVOKE ALL ON FUNCTION public._admin_customer_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_customer_identity(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_customer_rfm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_customer_activity() TO service_role;
GRANT EXECUTE ON FUNCTION public._admin_customer_identity(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._admin_customer_rfm() TO service_role;

-- 2. SEC-02 — sans garde et sans aucun appelant dans le code : l'historique
--    d'activité d'un client (vide aujourd'hui) et deux rafraîchissements de vue
--    matérialisée que n'importe quel visiteur pouvait relancer en boucle sur
--    une machine de 1 Go.
REVOKE ALL ON FUNCTION public.get_customer_timeline(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_analytics_rollup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_analytics_daily_rollup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_timeline(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_analytics_rollup() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_analytics_daily_rollup() TO service_role;

-- 3. SEC-03 — une vue matérialisée n'a pas de RLS : visites, paniers, ventes et
--    montants de chaque club et de chaque organisateur, jour par jour, lisibles
--    par tout visiteur. Aucun lecteur dans le code ni dans une fonction.
REVOKE ALL ON public.analytics_daily_rollup FROM anon, authenticated;

-- 4. MAIL-05 — le gel d'envoi (Admin CRM) était contournable : le trigger
--    tournait avec les droits de l'APPELANT, et `crm_settings` (RLS sans policy)
--    est invisible d'un client. Une campagne passée en « sending » par le
--    client lui-même lisait donc « pas gelé ». La garde teste des données, pas
--    current_user : elle peut tourner sous son propriétaire.
ALTER FUNCTION public.guard_crm_send_frozen() SECURITY DEFINER;
ALTER FUNCTION public.guard_crm_send_frozen() SET search_path = public;
