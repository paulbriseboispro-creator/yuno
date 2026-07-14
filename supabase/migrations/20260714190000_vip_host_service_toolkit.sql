-- =============================================================================
-- Refonte outil serveur VIP — capacités de service élargies
--
-- 1) Le trigger enforce_vip_host_reservation_columns (20260616120000) limite un
--    pur vip_host à 5 colonnes de service (vip_status, assigned_table_id,
--    placed_at, placed_by, finished_at). Le nouvel outil serveur a besoin de
--    trois capacités de service supplémentaires, toutes non financières :
--      - marquer l'arrivée d'un client (checked_in_at) quand il se présente
--        directement à l'hôte sans passer par le scan videur ;
--      - répondre à la demande de table précise faite par le client au
--        checkout : placement_status ('approved' si installé à la table
--        demandée, 'modified' sinon) + placement_reviewed_by/at ;
--      - poser une note de placement (placement_note).
--    L'allow-list est étendue à ces colonnes ; prix, statut de paiement,
--    identité et remboursements restent verrouillés pour ce rôle.
--
-- 2) Droit à l'erreur : un hôte peut SUPPRIMER une conso qu'il vient de saisir
--    lui-même (< 15 minutes) — annuler une faute de frappe sans appeler le
--    owner. Pas d'UPDATE accordé : on supprime et on ressaisit, le grand
--    livre reste append-only pour tout le reste.
--
-- Idempotent : CREATE OR REPLACE + DROP POLICY IF EXISTS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_vip_host_reservation_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Les seules colonnes qu'un pur vip_host peut modifier. Miroir du hook
  -- src/hooks/useVipNight.tsx (ex-useVipHost).
  v_allowed text[] := ARRAY[
    'vip_status', 'assigned_table_id', 'placed_at', 'placed_by', 'finished_at',
    -- Refonte serveur VIP (20260714190000) : arrivée manuelle + revue de la
    -- demande de table du client. Aucune colonne financière.
    'checked_in_at', 'placement_status', 'placement_reviewed_by',
    'placement_reviewed_at', 'placement_note'
  ];
  v_venue text;
  v_old jsonb;
  v_new jsonb;
  k text;
BEGIN
  -- Non-host sessions are unrestricted here. has_role() returns false when
  -- auth.uid() is NULL, so the service_role edge-function path (which
  -- legitimately writes every column) short-circuits immediately.
  IF NOT public.has_role(auth.uid(), 'vip_host') THEN
    RETURN NEW;
  END IF;

  -- A user who also owns this venue / is a co-event partner / is a super admin
  -- keeps full write access even while holding the vip_host role (owners can
  -- and do operate the VIP host dashboard).
  SELECT venue_id INTO v_venue FROM public.table_zones WHERE id = NEW.zone_id;
  IF v_venue IS NOT NULL AND public.is_venue_owner(auth.uid(), v_venue) THEN
    RETURN NEW;
  END IF;
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.event_id IS NOT NULL
     AND (public.is_event_partner_venue_owner(auth.uid(), NEW.event_id)
          OR public.is_event_partner_organizer(auth.uid(), NEW.event_id)) THEN
    RETURN NEW;
  END IF;

  -- Pure vip_host: strip the allow-listed keys from both row images and reject
  -- if anything else changed.
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH k IN ARRAY v_allowed LOOP
    v_old := v_old - k;
    v_new := v_new - k;
  END LOOP;

  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION
      'A VIP host may only change service fields (vip_status, table placement, arrival, placement review). Financial and identity fields are read-only for this role.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- Le trigger existe déjà (20260616120000) et pointe sur la fonction par nom :
-- le CREATE OR REPLACE ci-dessus suffit. On le (re)crée quand même pour les
-- environnements neufs.
DROP TRIGGER IF EXISTS trg_enforce_vip_host_reservation_columns ON public.table_reservations;
CREATE TRIGGER trg_enforce_vip_host_reservation_columns
  BEFORE UPDATE ON public.table_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_vip_host_reservation_columns();

-- Droit à l'erreur : suppression d'une conso saisie par soi-même il y a moins
-- de 15 minutes. Les owners gardent leur accès complet (policy ALL existante).
DROP POLICY IF EXISTS "VIP hosts can delete their own recent consumptions" ON public.vip_consumptions;
CREATE POLICY "VIP hosts can delete their own recent consumptions"
  ON public.vip_consumptions
  FOR DELETE
  USING (
    public.has_role(auth.uid(), 'vip_host')
    AND venue_id = public.get_user_venue_id(auth.uid())
    AND served_by = auth.uid()
    AND served_at > now() - interval '15 minutes'
  );
