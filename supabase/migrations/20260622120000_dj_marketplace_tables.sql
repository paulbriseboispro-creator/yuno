-- DJ Marketplace (Barreau C) — tables.
-- Couche booking : un booker (club/orga) trouve un DJ et lui demande une date ;
-- le DJ est dispo PAR DÉFAUT et bloque ses dates occupées ; tarif + résidences.
--
-- Garde-fou identité : une personne = N lignes `djs` (une par venue/orga). Tout ce qui
-- est PAR PERSONNE (tarif, dispo) se clé sur user_id. Les tables booker (requests,
-- résidences) portent le scope venue_id XOR organizer_user_id comme djs/dj_sets.
-- Paiement HORS SCOPE : on stocke seulement agreed_fee (le futur système de commission s'y branche).

-- =============================================================================
-- 1. dj_rate_card — tarif demandé, PAR PERSONNE (PK user_id)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_rate_card (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  min_fee    numeric,
  max_fee    numeric,
  currency   text NOT NULL DEFAULT 'EUR',
  rate_note  text,
  is_public  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dj_rate_card_fee_order CHECK (max_fee IS NULL OR min_fee IS NULL OR max_fee >= min_fee)
);

ALTER TABLE public.dj_rate_card ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dj_rate_card_self_select ON public.dj_rate_card;
CREATE POLICY dj_rate_card_self_select ON public.dj_rate_card
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS dj_rate_card_self_insert ON public.dj_rate_card;
CREATE POLICY dj_rate_card_self_insert ON public.dj_rate_card
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS dj_rate_card_self_update ON public.dj_rate_card;
CREATE POLICY dj_rate_card_self_update ON public.dj_rate_card
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS dj_rate_card_self_delete ON public.dj_rate_card;
CREATE POLICY dj_rate_card_self_delete ON public.dj_rate_card
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_dj_rate_card_updated_at ON public.dj_rate_card;
CREATE TRIGGER update_dj_rate_card_updated_at
  BEFORE UPDATE ON public.dj_rate_card
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 2. dj_availability — dates bloquées (default-available), PAR PERSONNE
--    On ne stocke QUE les blocages manuels. Les dj_sets + bookings acceptés sont
--    des auto-blocs calculés à la lecture (get_dj_availability), pas de trigger.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_date date NOT NULL,
  reason       text,
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','set','booking')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, blocked_date)
);

CREATE INDEX IF NOT EXISTS dj_availability_user_date_idx ON public.dj_availability (user_id, blocked_date);

ALTER TABLE public.dj_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dj_availability_self_select ON public.dj_availability;
CREATE POLICY dj_availability_self_select ON public.dj_availability
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS dj_availability_self_insert ON public.dj_availability;
CREATE POLICY dj_availability_self_insert ON public.dj_availability
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS dj_availability_self_update ON public.dj_availability;
CREATE POLICY dj_availability_self_update ON public.dj_availability
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS dj_availability_self_delete ON public.dj_availability;
CREATE POLICY dj_availability_self_delete ON public.dj_availability
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =============================================================================
-- 3. dj_booking_requests — demande booker -> DJ (cible la PERSONNE : dj_user_id)
--    Scope booker venue_id XOR organizer_user_id (miroir djs/dj_sets).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_booking_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by        uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,

  dj_user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  requested_date    date NOT NULL,
  start_time        timestamptz,
  end_time          timestamptz,
  agreed_fee        numeric,
  currency          text NOT NULL DEFAULT 'EUR',
  message           text,
  event_id          uuid REFERENCES public.events(id) ON DELETE SET NULL,

  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','expired','cancelled')),
  dj_response_note  text,
  responded_at      timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '14 days'),

  created_dj_set_id uuid REFERENCES public.dj_sets(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dj_booking_requests_scope_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS dj_booking_requests_dj_status_idx ON public.dj_booking_requests (dj_user_id, status);
CREATE INDEX IF NOT EXISTS dj_booking_requests_venue_idx     ON public.dj_booking_requests (venue_id);
CREATE INDEX IF NOT EXISTS dj_booking_requests_org_idx       ON public.dj_booking_requests (organizer_user_id);
CREATE INDEX IF NOT EXISTS dj_booking_requests_date_idx      ON public.dj_booking_requests (requested_date);

-- Anti-doublon : une seule demande EN ATTENTE par (booker, DJ, date).
-- NULLs distincts en Postgres -> COALESCE pour que le scope nullable n'ouvre pas de doublons.
CREATE UNIQUE INDEX IF NOT EXISTS dj_booking_requests_pending_unique
  ON public.dj_booking_requests (
    COALESCE(venue_id, ''),
    COALESCE(organizer_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    dj_user_id,
    requested_date
  ) WHERE status = 'pending';

ALTER TABLE public.dj_booking_requests ENABLE ROW LEVEL SECURITY;

-- Table 2 parties : LECTURE seulement en RLS (booker + DJ), toutes les ÉCRITURES
-- passent par les RPC SECURITY DEFINER (create/accept/decline/cancel) qui valident.
DROP POLICY IF EXISTS dj_booking_requests_booker_select ON public.dj_booking_requests;
CREATE POLICY dj_booking_requests_booker_select ON public.dj_booking_requests
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
  );

DROP POLICY IF EXISTS dj_booking_requests_dj_select ON public.dj_booking_requests;
CREATE POLICY dj_booking_requests_dj_select ON public.dj_booking_requests
  FOR SELECT TO authenticated USING (dj_user_id = auth.uid());

DROP POLICY IF EXISTS dj_booking_requests_admin_all ON public.dj_booking_requests;
CREATE POLICY dj_booking_requests_admin_all ON public.dj_booking_requests
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_dj_booking_requests_updated_at ON public.dj_booking_requests;
CREATE TRIGGER update_dj_booking_requests_updated_at
  BEFORE UPDATE ON public.dj_booking_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 4. dj_residencies — tier Resident (déclaré ; le dérivé est calculé dans get_dj_tiers)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_residencies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dj_user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at        date,
  ended_at          date,
  created_by        uuid NOT NULL DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dj_residencies_scope_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  )
);

-- Unicité par scope (NULLs distincts -> index partiels par scope).
CREATE UNIQUE INDEX IF NOT EXISTS dj_residencies_venue_unique
  ON public.dj_residencies (dj_user_id, venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dj_residencies_org_unique
  ON public.dj_residencies (dj_user_id, organizer_user_id) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.dj_residencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dj_residencies_booker_all ON public.dj_residencies;
CREATE POLICY dj_residencies_booker_all ON public.dj_residencies
  FOR ALL TO authenticated USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
  ) WITH CHECK (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
  );

DROP POLICY IF EXISTS dj_residencies_dj_select ON public.dj_residencies;
CREATE POLICY dj_residencies_dj_select ON public.dj_residencies
  FOR SELECT TO authenticated USING (dj_user_id = auth.uid());

DROP POLICY IF EXISTS dj_residencies_admin_all ON public.dj_residencies;
CREATE POLICY dj_residencies_admin_all ON public.dj_residencies
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
