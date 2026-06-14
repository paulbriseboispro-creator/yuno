
-- 11 fonctions sensibles : on retire EXECUTE pour anon et public
-- Elles restent accessibles à authenticated (les checks internes is_super_admin/etc. font le filtrage),
-- au service_role et au compte cron (qui appelle via service_role).

REVOKE EXECUTE ON FUNCTION public.admin_delete_venue(text)                  FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.update_maintenance_password(text)         FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.hash_maintenance_password(text)           FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.backfill_missing_invoices()               FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.calculate_client_scores(text)             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.auto_finalize_leaderboard_contests()      FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.finalize_leaderboard_contest(uuid)        FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.archive_expired_event_orders()            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_mfa_pending()             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_live_pings()                FROM anon, public;

-- enforce_mfa_for_owners est un trigger function : EXECUTE n'est de toute façon pas requis pour anon
REVOKE EXECUTE ON FUNCTION public.enforce_mfa_for_owners()                  FROM anon, public;

-- Bonus défensif : verify_maintenance_password est intentionnellement appelable
-- depuis edge functions (service_role). On retire l'accès anon par sécurité.
REVOKE EXECUTE ON FUNCTION public.verify_maintenance_password(text)         FROM anon, public;
