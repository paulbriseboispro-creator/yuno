-- SÉCURITÉ — fonctions SECURITY DEFINER qui ÉCRIVENT sans contrôle
-- d'identité, restées exécutables par `anon` et `authenticated` (2026-09-25).
--
-- Par défaut Postgres accorde EXECUTE à PUBLIC : toute fonction créée sans
-- REVOKE s'ouvrait donc à un visiteur anonyme par /rest/v1/rpc. Un inventaire
-- (SECURITY DEFINER, écrit, ne lit ni auth.uid() ni auth.jwt()) en a trouvé
-- 45. Parmi elles : créditer des SMS à n'importe quel compte
-- (add_sms_credits), distribuer des points de fidélité, appliquer un avenant
-- de contrat collab, pauser la campagne d'un autre, écrire une notification
-- chez n'importe quel club, marquer « servies » toutes les boissons payées non
-- remises, effacer des factures.
--
-- Chacune a été rapprochée de ses appelants (front, edge, SQL) :
--   * appelée seulement par une edge au client service role, un cron, un
--     trigger ou une autre fonction DEFINER ⇒ service_role seul ;
--   * appelée par la Console connectée ⇒ authenticated, jamais anon ;
--   * faite pour un visiteur anonyme (suivi, liens de la bio, liste
--     d'attente, désinscription par jeton, aperçu de code promo, parcours de
--     la landing, accusé de réception push iOS) ⇒ inchangée.

DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    '_execute_event_collab_action', '_insert_recurring_rounds', 'add_sms_credits',
    'apply_collab_amendment', 'apply_series_responsibilities',
    'archive_expired_event_orders', 'award_loyalty_points', 'backfill_missing_invoices',
    'bump_guest_signup_throttle', 'campaign_circuit_breaker', 'cancel_ticket_reservation',
    'cleanup_affiliate_invitation_meta', 'cleanup_expired_invoices',
    'cleanup_expired_mfa_pending', 'cleanup_old_visitor_events', 'cleanup_stale_live_pings',
    'confirm_ticket_reservation', 'consume_sms_credits', 'create_agency_guestlist_part',
    'create_promoter_guestlist_part', 'expire_dj_booking_requests',
    'expire_stale_ticket_reservations', 'get_or_create_customer_loyalty',
    'get_or_create_sms_balance', 'get_or_create_venue_customer',
    'increment_venue_customer_stats', 'log_marketing_email', 'marketing_email_log_purge',
    'notify_collab_party', 'refund_sms_credits', 'seed_dj_event_tracked_link',
    'sms_stop_unsubscribe', 'suppress_email'
  ];
  r record;
BEGIN
  FOREACH fn IN ARRAY service_only LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END LOOP;
  END LOOP;

  -- La Console sème ses liens suivis (TrackedLinksManager) : connectée seulement.
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'seed_event_tracked_links'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- Archiver n'est pas servir. L'ancienne version passait les boissons payées
-- jamais remises en `served` avec un `served_at` inventé : le client perdait
-- la trace d'une boisson due, le temps de service du bar était faussé. On ne
-- pose plus que `archived` (la commande quitte « à récupérer » côté client et
-- l'écran du barman), statut et horodatages intacts. Une commande sans soirée
-- s'archive 24 h après son paiement.
CREATE OR REPLACE FUNCTION public.archive_expired_event_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.orders o
     SET archived = true
   WHERE o.archived = false
     AND o.status = 'paid'
     AND o.served_at IS NULL
     AND (
       EXISTS (SELECT 1 FROM public.events e
                WHERE e.id = o.event_id
                  AND coalesce(e.end_at, e.start_at + interval '8 hours') + interval '2 hours' < now())
       OR (o.event_id IS NULL AND coalesce(o.paid_at, o.created_at) < now() - interval '24 hours')
     );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.archive_expired_event_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_expired_event_orders() TO service_role;

-- Trois crons appelaient des edge functions supprimées depuis longtemps
-- (404 toutes les heures). Leur travail ne doit PAS revenir tel quel :
-- `cleanup-expired-orders` supprimait des commandes PAYÉES, et
-- `cleanup-expired-invoices` des factures, qu'on conserve. Seul l'archivage,
-- rendu sûr ci-dessus, repart — en SQL, sans edge.
DO $$
BEGIN
  PERFORM cron.unschedule(j.jobid)
  FROM cron.job j
  WHERE j.jobname IN ('archive-expired-orders-hourly', 'cleanup-expired-orders-hourly',
                      'cleanup-expired-invoices-daily');
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive-stale-orders') THEN
    PERFORM cron.schedule('archive-stale-orders', '12 * * * *',
                          'SELECT public.archive_expired_event_orders();');
  END IF;
END $$;
