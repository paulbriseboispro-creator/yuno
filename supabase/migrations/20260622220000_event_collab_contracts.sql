-- Contrat numérique de collaboration club ↔ organisateur.
--
-- Couche "contrat" par-dessus le partage de revenus co-event existant
-- (events.revenue_split_rules / revenue_split_proposal / split_approved_by_* +
--  ledger revenue_distributions + transfers webhook). Transforme l'approbation
-- bilatérale légère en VRAI contrat signé : signatures électroniques des 2 parties,
-- termes figés (terms_snapshot), PDF, machine à états, immuabilité après 1re vente.
--
-- L'argent ne change pas : la charge collab reste encaissée sur la plateforme avec
-- on_behalf_of=club (club = vendeur de record, alcool inclus) et répartie par transfers.
-- Le contrat verrouille le % et garantit que personne n'ouvre les ventes seul.
--
-- Sécurité : toutes les ÉCRITURES passent par des RPC SECURITY DEFINER. RLS = LECTURE.
-- Les RPC pilotent AUSSI les colonnes events.* (proposal/approved/rules) pour que le
-- CONTRACT GUARD déjà déployé dans les checkouts continue de fonctionner.

-- =============================================================================
-- 1. Table event_collab_contracts (1:1 avec un event co-event)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.event_collab_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  partnership_id     uuid REFERENCES public.venue_organizer_partnerships(id) ON DELETE SET NULL,

  venue_id           text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by         uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'pending_signatures' CHECK (status IN (
                       'draft','pending_signatures','active','locked','closed','cancelled')),
  currency           text NOT NULL DEFAULT 'eur',

  -- Le % convenu { tickets:{organizer_pct,venue_pct}, tables:{...}, drinks:{0,100} }.
  -- Forme identique aux règles lues par _shared/payment-split.ts.
  split_rules        jsonb NOT NULL,
  cancellation_policy text NOT NULL DEFAULT 'pro_rata_refund'
                       CHECK (cancellation_policy IN ('pro_rata_refund','no_refund_after_event')),
  terms_snapshot     jsonb,                 -- figé à la signature complète (immuable)
  contract_pdf_url   text,

  -- signatures électroniques (clic + horodatage + IP + user-agent), comme le DJ
  venue_signed_at    timestamptz, venue_signed_by uuid, venue_signed_ip text, venue_signed_user_agent text,
  org_signed_at      timestamptz, org_signed_by  uuid, org_signed_ip  text, org_signed_user_agent  text,

  auto_release_at    timestamptz,           -- = fin event + 2 j (filet futur)
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_collab_contracts_venue_idx ON public.event_collab_contracts (venue_id, status);
CREATE INDEX IF NOT EXISTS event_collab_contracts_org_idx   ON public.event_collab_contracts (organizer_user_id, status);

ALTER TABLE public.event_collab_contracts ENABLE ROW LEVEL SECURITY;

-- 2 parties : LECTURE seulement (club owner + orga + créateur + admin). Écritures via RPC.
DROP POLICY IF EXISTS event_collab_contracts_party_select ON public.event_collab_contracts;
CREATE POLICY event_collab_contracts_party_select ON public.event_collab_contracts
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR organizer_user_id = auth.uid()
    OR public.is_venue_owner(auth.uid(), venue_id)
  );
DROP POLICY IF EXISTS event_collab_contracts_admin_all ON public.event_collab_contracts;
CREATE POLICY event_collab_contracts_admin_all ON public.event_collab_contracts
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_event_collab_contracts_updated_at ON public.event_collab_contracts;
CREATE TRIGGER update_event_collab_contracts_updated_at
  BEFORE UPDATE ON public.event_collab_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Immuabilité : interdire toute modif du % (split_rules) une fois verrouillé/clos.
-- Changer le partage après une vente = nouveau contrat (futures ventes seulement).
CREATE OR REPLACE FUNCTION public.event_collab_contract_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('locked','closed') AND NEW.split_rules IS DISTINCT FROM OLD.split_rules THEN
    RAISE EXCEPTION 'Le contrat est verrouillé (une vente a eu lieu) : le partage ne peut plus changer.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS event_collab_contract_immutable_trg ON public.event_collab_contracts;
CREATE TRIGGER event_collab_contract_immutable_trg
  BEFORE UPDATE ON public.event_collab_contracts
  FOR EACH ROW EXECUTE FUNCTION public.event_collab_contract_immutable();

-- =============================================================================
-- 2. Lien ledger → contrat (traçabilité de chaque vente vers le contrat signé)
-- =============================================================================
ALTER TABLE public.revenue_distributions
  ADD COLUMN IF NOT EXISTS collab_contract_id uuid REFERENCES public.event_collab_contracts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS revenue_distributions_collab_idx ON public.revenue_distributions (collab_contract_id);

-- Quand une vente verrouille le split de l'event (split_locked_at), passer le contrat
-- de 'active' à 'locked' aussi (termes figés). Greffé sur le même évènement que le trigger
-- lock_event_split_on_first_sale existant, via un trigger sur events.
CREATE OR REPLACE FUNCTION public.lock_collab_contract_on_event_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.split_locked_at IS NOT NULL AND OLD.split_locked_at IS NULL THEN
    UPDATE public.event_collab_contracts
       SET status = 'locked'
     WHERE event_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS lock_collab_contract_on_event_lock_trg ON public.events;
CREATE TRIGGER lock_collab_contract_on_event_lock_trg
  AFTER UPDATE OF split_locked_at ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.lock_collab_contract_on_event_lock();

-- =============================================================================
-- 3. Storage bucket partagé pour les PDF de contrat (réutilise le pattern DJ)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('collab-contracts', 'collab-contracts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS collab_contracts_read ON storage.objects;
CREATE POLICY collab_contracts_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'collab-contracts' AND EXISTS (
      SELECT 1 FROM public.event_collab_contracts c
      WHERE c.id::text = split_part(name, '/', 1)
        AND (c.created_by = auth.uid() OR c.organizer_user_id = auth.uid()
             OR public.is_venue_owner(auth.uid(), c.venue_id))
    ));
DROP POLICY IF EXISTS collab_contracts_write ON storage.objects;
CREATE POLICY collab_contracts_write ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'collab-contracts' AND EXISTS (
      SELECT 1 FROM public.event_collab_contracts c
      WHERE c.id::text = split_part(name, '/', 1)
        AND (c.created_by = auth.uid() OR c.organizer_user_id = auth.uid()
             OR public.is_venue_owner(auth.uid(), c.venue_id))
    ));

-- =============================================================================
-- 4. Helper interne : résout (side, venue_id, organizer_user_id) pour un event + caller
-- =============================================================================
CREATE OR REPLACE FUNCTION public.collab_event_parties(p_event_id uuid)
RETURNS TABLE (venue_id text, organizer_user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $$
  SELECT COALESCE(e.venue_id, e.partner_venue_id)            AS venue_id,
         COALESCE(e.organizer_user_id, e.partner_organizer_id) AS organizer_user_id
  FROM public.events e WHERE e.id = p_event_id;
$$;

-- =============================================================================
-- 5. RPC — création du contrat (club OU orga propose le %)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_event_collab_contract(
  p_event_id           uuid,
  p_split_rules        jsonb DEFAULT NULL,
  p_cancellation_policy text DEFAULT 'pro_rata_refund'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_is_venue   boolean;
  v_is_org     boolean;
  v_rules      jsonb;
  v_partnership uuid;
  v_id         uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cancellation_policy NOT IN ('pro_rata_refund','no_refund_after_event') THEN
    RAISE EXCEPTION 'Invalid cancellation policy';
  END IF;

  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
  FROM public.collab_event_parties(p_event_id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cet évènement n''est pas une collaboration club ↔ organisateur';
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), v_venue_id);
  v_is_org   := (v_org_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (SELECT 1 FROM public.event_collab_contracts c
              WHERE c.event_id = p_event_id AND c.status <> 'cancelled') THEN
    RAISE EXCEPTION 'Un contrat existe déjà pour cette soirée';
  END IF;

  -- Règles : payload OU défaut du partenariat OU 50/50 tickets, 0/100 tables, 0/100 drinks.
  SELECT id, default_split_rules INTO v_partnership, v_rules
  FROM public.venue_organizer_partnerships
  WHERE venue_id = v_venue_id AND organizer_user_id = v_org_id AND status = 'active'
  LIMIT 1;

  v_rules := COALESCE(p_split_rules, v_rules, jsonb_build_object(
    'tickets', jsonb_build_object('organizer_pct', 50, 'venue_pct', 50),
    'tables',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100),
    'drinks',  jsonb_build_object('organizer_pct', 0,  'venue_pct', 100)
  ));
  -- Boissons toujours 100% club (vendeur d'alcool).
  v_rules := jsonb_set(v_rules, '{drinks}', jsonb_build_object('organizer_pct', 0, 'venue_pct', 100));

  INSERT INTO public.event_collab_contracts (
    event_id, partnership_id, venue_id, organizer_user_id, created_by,
    status, split_rules, cancellation_policy, auto_release_at,
    venue_signed_at, venue_signed_by, org_signed_at, org_signed_by
  ) VALUES (
    p_event_id, v_partnership, v_venue_id, v_org_id, auth.uid(),
    'pending_signatures', v_rules, p_cancellation_policy,
    (SELECT COALESCE(end_at, start_at) + interval '2 days' FROM public.events WHERE id = p_event_id),
    CASE WHEN v_is_venue THEN now() END, CASE WHEN v_is_venue THEN auth.uid() END,
    CASE WHEN v_is_org   THEN now() END, CASE WHEN v_is_org   THEN auth.uid() END
  ) RETURNING id INTO v_id;

  -- Pilote les colonnes events.* pour le CONTRACT GUARD déployé : proposition + l'approbation
  -- du proposeur. Les ventes restent bloquées tant que l'autre partie n'a pas signé.
  UPDATE public.events
     SET revenue_split_proposal = v_rules,
         split_proposed_by = auth.uid(),
         split_proposed_at = now(),
         split_approved_by_venue = v_is_venue,
         split_approved_by_organizer = v_is_org
   WHERE id = p_event_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_event_collab_contract(uuid, jsonb, text) TO authenticated;

-- =============================================================================
-- 6. RPC — signature (club OU orga ; rôle déduit de auth.uid())
--    Quand les 2 ont signé → fige les termes, copie la proposition dans
--    revenue_split_rules (le GUARD passe), statut 'active'.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sign_event_collab_contract(
  p_contract_id uuid,
  p_ip          text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c         public.event_collab_contracts%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
  v_both     boolean;
BEGIN
  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Le contrat n''attend pas de signature (statut=%)', c.status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), c.venue_id);
  v_is_org   := (c.organizer_user_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_contracts
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
    UPDATE public.events SET split_approved_by_venue = true WHERE id = c.event_id;
  ELSE
    UPDATE public.event_collab_contracts
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
    UPDATE public.events SET split_approved_by_organizer = true WHERE id = c.event_id;
  END IF;

  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id;
  v_both := c.venue_signed_at IS NOT NULL AND c.org_signed_at IS NOT NULL;

  IF v_both THEN
    UPDATE public.event_collab_contracts
       SET status = 'active',
           terms_snapshot = jsonb_build_object(
             'split_rules', c.split_rules,
             'cancellation_policy', c.cancellation_policy,
             'currency', c.currency,
             'venue_id', c.venue_id,
             'organizer_user_id', c.organizer_user_id,
             'event_id', c.event_id,
             'venue_signed_at', c.venue_signed_at,
             'org_signed_at', c.org_signed_at,
             'frozen_at', now()
           )
     WHERE id = p_contract_id;
    -- Le GUARD : copier la proposition dans les règles en vigueur + purger la proposition.
    UPDATE public.events
       SET revenue_split_rules = c.split_rules,
           revenue_split_proposal = NULL,
           split_proposed_by = NULL,
           split_proposed_at = NULL,
           split_approved_by_venue = false,
           split_approved_by_organizer = false
     WHERE id = c.event_id;
    RETURN 'active';
  END IF;

  RETURN 'pending_signatures';
END; $$;

GRANT EXECUTE ON FUNCTION public.sign_event_collab_contract(uuid, text, text) TO authenticated;

-- =============================================================================
-- 7. RPC — annulation (avant toute vente / signature complète)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_collab_contract(p_contract_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.event_collab_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT (c.created_by = auth.uid() OR c.organizer_user_id = auth.uid()
          OR public.is_venue_owner(auth.uid(), c.venue_id)) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_signatures') THEN
    RAISE EXCEPTION 'Impossible d''annuler après activation (une vente a pu avoir lieu)';
  END IF;
  UPDATE public.event_collab_contracts SET status = 'cancelled' WHERE id = p_contract_id;
  -- Libère le GUARD (purge la proposition en attente).
  UPDATE public.events
     SET revenue_split_proposal = NULL, split_proposed_by = NULL, split_proposed_at = NULL,
         split_approved_by_venue = false, split_approved_by_organizer = false
   WHERE id = c.event_id AND revenue_split_rules IS NULL;
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_event_collab_contract(uuid) TO authenticated;

-- =============================================================================
-- 8. Backfill : pour chaque co-event ayant déjà des règles verrouillées
--    (revenue_split_rules non nul), créer un contrat 'locked' réputé signé,
--    pour ne JAMAIS bloquer rétro-activement une soirée live avec le nouveau guard.
-- =============================================================================
INSERT INTO public.event_collab_contracts (
  event_id, venue_id, organizer_user_id, created_by, status, split_rules,
  venue_signed_at, org_signed_at, terms_snapshot
)
SELECT e.id,
       COALESCE(e.venue_id, e.partner_venue_id),
       COALESCE(e.organizer_user_id, e.partner_organizer_id),
       COALESCE(e.organizer_user_id, e.partner_organizer_id),
       CASE WHEN e.split_locked_at IS NOT NULL THEN 'locked' ELSE 'active' END,
       e.revenue_split_rules,
       now(), now(),
       jsonb_build_object('backfilled', true, 'frozen_at', now())
FROM public.events e
WHERE e.revenue_split_rules IS NOT NULL
  AND COALESCE(e.venue_id, e.partner_venue_id) IS NOT NULL
  AND COALESCE(e.organizer_user_id, e.partner_organizer_id) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.event_collab_contracts c WHERE c.event_id = e.id)
ON CONFLICT (event_id) DO NOTHING;
