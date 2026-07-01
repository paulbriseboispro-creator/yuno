-- Système d'agence autonome — Phase 1 (2/4) : tables, ledger, colonne de
-- rattachement, helper RLS et policies.
--
-- Modèle : une agence est un tenant autonome. Elle possède ses promoteurs
-- (colonne additive `promoters.agency_id`) et contracte avec des clubs (venue)
-- OU des organisateurs. Un promoteur d'agence garde une ligne `promoters` par
-- club (scope venue/org inchangé, contrainte XOR intacte) ; `agency_id` marque
-- simplement qui gère ce promoteur.
--
-- Flux d'argent = grand-livre (aucun mouvement Stripe) : le club doit le BRUT à
-- l'agence, l'agence reverse le NET à ses promoteurs, la marge est la différence.

-- ---------------------------------------------------------------------------
-- 1. agencies — le profil / compte agence
-- ---------------------------------------------------------------------------
CREATE TABLE public.agencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text UNIQUE,
  city text,
  logo_url text,
  bio text,
  instagram_url text,
  whatsapp_number text,
  website_url text,
  contact_email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agencies_owner ON public.agencies(owner_user_id);
CREATE INDEX idx_agencies_slug ON public.agencies(slug) WHERE slug IS NOT NULL;

-- Helper RLS canonique : l'utilisateur possède-t-il cette agence ?
CREATE OR REPLACE FUNCTION public.is_agency_owner(_user_id uuid, _agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agencies a
    WHERE a.id = _agency_id AND a.owner_user_id = _user_id
  );
$$;

ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

-- Lecture ouverte aux authentifiés (profil semi-public : un club doit pouvoir
-- retrouver une agence pour l'inviter ; microsite public en Phase 2).
CREATE POLICY "Agencies readable by authenticated"
  ON public.agencies FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Owner manages own agency"
  ON public.agencies FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Super admin manages agencies"
  ON public.agencies FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 2. agency_venue_contracts — le deal agence ↔ club/organisateur
--    (double-signature, garde-fou d'activation, marge de l'agence)
-- ---------------------------------------------------------------------------
CREATE TABLE public.agency_venue_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'pending_signatures'
    CHECK (status IN ('draft','pending_signatures','active','paused','ended','cancelled')),

  -- Marge de l'agence prélevée sur chaque vente EN PLUS du net promoteur.
  -- 'fixed' = X€/vente ; 'percentage' = X% du net promoteur.
  override_type text CHECK (override_type IN ('fixed','percentage')),
  override_value numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'eur',

  created_by uuid NOT NULL DEFAULT auth.uid(),

  -- Signatures électroniques (clic + horodatage) des deux parties.
  agency_signed_at timestamptz,
  agency_signed_by uuid,
  club_signed_at timestamptz,
  club_signed_by uuid,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agency_contract_context_check
    CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1)
);

-- Un seul contrat par (agence, club) et par (agence, organisateur).
-- Les NULL étant distincts en Postgres, ces deux index partiels cohabitent.
CREATE UNIQUE INDEX uniq_agency_contract_venue
  ON public.agency_venue_contracts(agency_id, venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_agency_contract_org
  ON public.agency_venue_contracts(agency_id, organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX idx_agency_contracts_agency ON public.agency_venue_contracts(agency_id, status);
CREATE INDEX idx_agency_contracts_venue ON public.agency_venue_contracts(venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX idx_agency_contracts_org ON public.agency_venue_contracts(organizer_user_id) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.agency_venue_contracts ENABLE ROW LEVEL SECURITY;

-- Les deux parties (+ admin) peuvent lire. Les mutations passent par les RPC
-- SECURITY DEFINER (create/sign/pause/end) — voir migration 3/4.
CREATE POLICY "Agency contract parties can read"
  ON public.agency_venue_contracts FOR SELECT TO authenticated
  USING (
    public.is_agency_owner(auth.uid(), agency_id)
    OR (venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
    OR public.is_super_admin()
  );

-- L'agence peut éditer son propre contrat tant qu'il n'est pas signé des deux
-- côtés (ajuster la marge proposée). Le passage à 'active' se fait via RPC.
CREATE POLICY "Agency owner edits own contract"
  ON public.agency_venue_contracts FOR ALL TO authenticated
  USING (public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (public.is_agency_owner(auth.uid(), agency_id));

CREATE POLICY "Super admin manages agency contracts"
  ON public.agency_venue_contracts FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. promoters.agency_id — rattachement additif (n'affecte pas la contrainte XOR)
-- ---------------------------------------------------------------------------
ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promoters_agency ON public.promoters(agency_id) WHERE agency_id IS NOT NULL;

-- L'agence gère ses propres promoteurs (peu importe le club de rattachement).
CREATE POLICY "Agency owner manages own promoters"
  ON public.promoters FOR ALL TO authenticated
  USING (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (agency_id IS NOT NULL AND public.is_agency_owner(auth.uid(), agency_id));

-- L'agence lit les conversions de ses promoteurs (finance / analytics).
CREATE POLICY "Agency owner views own promoters conversions"
  ON public.promoter_conversions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_conversions.promoter_id
        AND p.agency_id IS NOT NULL
        AND public.is_agency_owner(auth.uid(), p.agency_id)
    )
  );

-- L'agence gère les versements vers ses propres promoteurs (agence → promoteur).
CREATE POLICY "Agency owner manages own promoters payouts"
  ON public.promoter_payouts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_payouts.promoter_id
        AND p.agency_id IS NOT NULL
        AND public.is_agency_owner(auth.uid(), p.agency_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.promoters p
      WHERE p.id = promoter_payouts.promoter_id
        AND p.agency_id IS NOT NULL
        AND public.is_agency_owner(auth.uid(), p.agency_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. agency_conversions — grand-livre côté agence (une ligne par vente
--    d'un promoteur d'agence). gross = ce que le club doit à l'agence,
--    net = part reversée au promoteur, margin = gain de l'agence.
-- ---------------------------------------------------------------------------
CREATE TABLE public.agency_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  promoter_id uuid REFERENCES public.promoters(id) ON DELETE SET NULL,
  source_conversion_id uuid REFERENCES public.promoter_conversions(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  gross_amount numeric NOT NULL DEFAULT 0,   -- dû par le club à l'agence (net + marge)
  margin_amount numeric NOT NULL DEFAULT 0,  -- gain de l'agence
  net_amount numeric NOT NULL DEFAULT 0,     -- part reversée au promoteur

  -- Règlement du club VERS l'agence (indépendant du règlement agence→promoteur,
  -- lequel suit le statut de promoter_conversions).
  club_status text NOT NULL DEFAULT 'pending' CHECK (club_status IN ('pending','paid')),
  club_paid_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(source_conversion_id)
);

CREATE INDEX idx_agency_conversions_agency ON public.agency_conversions(agency_id, club_status);
CREATE INDEX idx_agency_conversions_venue ON public.agency_conversions(venue_id) WHERE venue_id IS NOT NULL;
CREATE INDEX idx_agency_conversions_org ON public.agency_conversions(organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX idx_agency_conversions_event ON public.agency_conversions(event_id);

ALTER TABLE public.agency_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency conversions readable by parties"
  ON public.agency_conversions FOR SELECT TO authenticated
  USING (
    public.is_agency_owner(auth.uid(), agency_id)
    OR (venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
    OR public.is_super_admin()
  );

CREATE POLICY "Super admin manages agency conversions"
  ON public.agency_conversions FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 5. agency_payouts — trace des règlements club → agence (grand-livre)
-- ---------------------------------------------------------------------------
CREATE TABLE public.agency_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  venue_id text REFERENCES public.venues(id) ON DELETE SET NULL,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  period_label text,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'paid',
  paid_at timestamptz DEFAULT now(),
  paid_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_payouts_context_check
    CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1)
);

CREATE INDEX idx_agency_payouts_agency ON public.agency_payouts(agency_id);
CREATE INDEX idx_agency_payouts_venue ON public.agency_payouts(venue_id) WHERE venue_id IS NOT NULL;

ALTER TABLE public.agency_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency payouts readable by parties"
  ON public.agency_payouts FOR SELECT TO authenticated
  USING (
    public.is_agency_owner(auth.uid(), agency_id)
    OR (venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
    OR public.is_super_admin()
  );

CREATE POLICY "Super admin manages agency payouts"
  ON public.agency_payouts FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

GRANT EXECUTE ON FUNCTION public.is_agency_owner(uuid, uuid) TO authenticated;
