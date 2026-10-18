-- Audit de préparation Yuno CRM (18/10) — lot connecteur.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md (SYNC-01b, SYNC-04).
--
-- 1. SYNC-01b — « Supprimer les données importées » effaçait billets, soirées et
--    analyses, mais laissait au registre de consentement les accords ACTIFS que
--    la billetterie avait versés. Ces personnes restaient joignables, y compris
--    après une reconnexion à une AUTRE organisation Shotgun (ce que le
--    connecteur exige désormais pour changer d'organisation) : elles n'avaient
--    pourtant rien accordé à la nouvelle. La suppression retire maintenant ces
--    accords, avec une trace dans marketing_consent_events, sur le modèle de
--    l'effacement venu de la billetterie (ticketing_apply_erasures). Un refus
--    (opted_in = false) reste en mémoire ; un accord donné ailleurs (page,
--    fichier) n'est pas touché. Pas de garde « avale-tout » : si le retrait
--    échoue, la suppression échoue (le pro réessaie), jamais l'inverse.
CREATE OR REPLACE FUNCTION public.ticketing_connections_withdraw_consents()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH off AS (
    DELETE FROM public.newsletter_subscriptions s
     WHERE ((OLD.venue_id IS NOT NULL AND s.venue_id = OLD.venue_id)
         OR (OLD.venue_id IS NULL AND s.organizer_user_id = OLD.organizer_user_id))
       AND s.opted_in
       AND COALESCE(s.source, '') = 'connector:' || OLD.provider
    RETURNING s.email, s.user_id
  )
  INSERT INTO public.marketing_consent_events
    (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
  SELECT o.user_id, lower(o.email), 'email', OLD.venue_id,
         CASE WHEN OLD.venue_id IS NULL THEN OLD.organizer_user_id END,
         'withdrawn', 'connector_purged',
         'Données de la billetterie (' || OLD.provider || ') supprimées par le pro : accord versé par la billetterie retiré',
         'connector:' || OLD.provider
    FROM off o;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.ticketing_connections_withdraw_consents() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ticketing_connections_withdraw_consents ON public.ticketing_connections;
CREATE TRIGGER trg_ticketing_connections_withdraw_consents
  BEFORE DELETE ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.ticketing_connections_withdraw_consents();

-- 2. SYNC-04 — après 5 pannes de suite (≈ 2 h 30 de panne Shotgun), la
--    connexion passait « error » et la réclamation ne prenait plus que les
--    connexions « active » : la synchro restait arrêtée jusqu'à un clic du pro
--    sur « Synchroniser », même une fois Shotgun revenu. Une connexion en
--    erreur est maintenant reprise à l'échéance de son repli (2 h au plus) ;
--    une passe réussie la remet « active ». Un jeton refusé (token_invalid)
--    n'est jamais retenté : il faut un nouveau jeton.
--    Réécrit depuis pg_get_functiondef de la prod (18/10) ; seule la ligne
--    du statut change.
CREATE OR REPLACE FUNCTION public.claim_ticketing_connections(p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 150, p_connection_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF ticketing_connections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_ticketing_connections: service_role only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE public.ticketing_connections c
     SET locked_until = now() + make_interval(secs => p_lease_seconds),
         last_sync_started_at = now()
   WHERE c.id IN (
     SELECT x.id FROM public.ticketing_connections x
      WHERE x.status IN ('active', 'error')   -- audit 18/10 : « error » est retenté au rythme du repli
        AND x.vault_secret_id IS NOT NULL
        AND (p_connection_id IS NULL OR x.id = p_connection_id)
        AND (p_connection_id IS NOT NULL OR x.next_sync_at <= now())
        AND (x.locked_until IS NULL OR x.locked_until < now())
        AND NOT public.crm_scope_paused(public.crm_scope_key(x.venue_id, x.organizer_user_id))
      ORDER BY x.next_sync_at
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_ticketing_connections(integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ticketing_connections(integer, integer, uuid) TO service_role;
