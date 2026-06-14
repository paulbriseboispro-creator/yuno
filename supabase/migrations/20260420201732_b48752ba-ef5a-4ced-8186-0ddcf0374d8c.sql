-- ============================================================
-- CHANTIER 1 + 3 : Contrat par event + snapshot dans le ledger
-- ============================================================

-- 1. Colonnes events : double consentement + lock
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS revenue_split_proposal jsonb,
  ADD COLUMN IF NOT EXISTS split_proposed_by uuid,
  ADD COLUMN IF NOT EXISTS split_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS split_approved_by_venue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_approved_by_organizer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_locked_at timestamptz;

COMMENT ON COLUMN public.events.revenue_split_proposal IS
  'Proposition de contrat en attente de validation par l''autre partie. Forme: {tickets:{organizer_pct,venue_pct}, tables:{...}, drinks:{...}}';
COMMENT ON COLUMN public.events.split_locked_at IS
  'Figé dès la première vente. Toute modification ultérieure exige re-consentement et n''affecte que les ventes futures.';

-- 2. Colonnes revenue_distributions : snapshot
ALTER TABLE public.revenue_distributions
  ADD COLUMN IF NOT EXISTS split_rules_applied jsonb,
  ADD COLUMN IF NOT EXISTS venue_pct_applied numeric,
  ADD COLUMN IF NOT EXISTS organizer_pct_applied numeric,
  ADD COLUMN IF NOT EXISTS partnership_id uuid REFERENCES public.venue_organizer_partnerships(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.revenue_distributions.split_rules_applied IS
  'Snapshot complet du contrat appliqué au moment du paiement. Audit-ready.';

-- 3. Trigger : geler le contrat à la 1ère vente
CREATE OR REPLACE FUNCTION public.lock_event_split_on_first_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si l'event a un revenue_split_rules signé et n'est pas encore verrouillé
  -- ET qu'une distribution est créée → on verrouille
  IF NEW.event_id IS NOT NULL THEN
    UPDATE public.events
    SET split_locked_at = COALESCE(split_locked_at, now())
    WHERE id = NEW.event_id
      AND split_locked_at IS NULL
      AND revenue_split_rules IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_event_split_on_first_sale ON public.revenue_distributions;
CREATE TRIGGER trg_lock_event_split_on_first_sale
AFTER INSERT ON public.revenue_distributions
FOR EACH ROW
EXECUTE FUNCTION public.lock_event_split_on_first_sale();

-- 4. Trigger : empêcher la révocation d'un partenariat avec events futurs vendus
CREATE OR REPLACE FUNCTION public.prevent_partnership_revoke_with_active_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocking_count integer;
  v_titles text;
BEGIN
  IF NEW.status = 'revoked' AND COALESCE(OLD.status, '') <> 'revoked' THEN
    -- Compter les events futurs en co-event avec ventes confirmées
    SELECT COUNT(*), STRING_AGG(e.title, ', ')
    INTO v_blocking_count, v_titles
    FROM public.events e
    WHERE e.start_at > now()
      AND e.is_active = true
      AND (
        (e.venue_id = NEW.venue_id AND e.partner_organizer_id = NEW.organizer_user_id)
        OR (e.organizer_user_id = NEW.organizer_user_id AND e.partner_venue_id = NEW.venue_id)
      )
      AND (
        EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = e.id AND t.status = 'paid')
        OR EXISTS (
          SELECT 1 FROM public.table_reservations tr
          JOIN public.table_zones tz ON tz.id = tr.zone_id
          WHERE tr.event_id = e.id AND tr.status = 'confirmed' AND tz.venue_id = NEW.venue_id
        )
      );

    IF v_blocking_count > 0 THEN
      RAISE EXCEPTION 'PARTNERSHIP_REVOKE_BLOCKED: % soirée(s) future(s) ont des ventes en cours: %. Termine ou annule ces soirées avant de révoquer le partenariat.', v_blocking_count, v_titles
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_partnership_revoke_with_active_events ON public.venue_organizer_partnerships;
CREATE TRIGGER trg_prevent_partnership_revoke_with_active_events
BEFORE UPDATE ON public.venue_organizer_partnerships
FOR EACH ROW
EXECUTE FUNCTION public.prevent_partnership_revoke_with_active_events();

-- 5. Fonction utilitaire : qui peut éditer/voir le contrat d'un event ?
CREATE OR REPLACE FUNCTION public.can_manage_event_split(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id
        OR e.partner_organizer_id = _user_id
        OR v.owner_id = _user_id
        OR public.is_super_admin()
      )
  );
$$;

-- 6. Index pour audit
CREATE INDEX IF NOT EXISTS idx_revenue_distributions_partnership ON public.revenue_distributions(partnership_id) WHERE partnership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_split_pending ON public.events(id) WHERE revenue_split_proposal IS NOT NULL;