-- Phase 7 — Ops en club : moments de service (parade bouteille / cierges) + waitlist tables.
--
-- vip_service_moments : planifier un « moment » (arrivée bouteille avec cierges, annonce)
--   pour une table, notifiable au host/barman. Donne du rythme au service et une exécution
--   fiable de l'expérience VIP.
-- vip_table_waitlist  : quand une zone/pack est complet, le client se met en liste d'attente
--   plutôt que de partir ; le club peut le recontacter à la première annulation.

-- =========================================================================
-- 1. Moments de service
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.vip_service_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  table_reservation_id uuid REFERENCES public.table_reservations(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'bottle_parade',
  label text,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'scheduled',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  CONSTRAINT vip_service_moments_status_check CHECK (status IN ('scheduled','done','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_vip_service_moments_venue_event ON public.vip_service_moments(venue_id, event_id);
CREATE INDEX IF NOT EXISTS idx_vip_service_moments_res         ON public.vip_service_moments(table_reservation_id);
CREATE INDEX IF NOT EXISTS idx_vip_service_moments_sched       ON public.vip_service_moments(scheduled_at);

ALTER TABLE public.vip_service_moments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vip_service_moments_staff_all ON public.vip_service_moments;
CREATE POLICY vip_service_moments_staff_all ON public.vip_service_moments
  FOR ALL TO authenticated
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.is_super_admin()
    OR ((public.has_role(auth.uid(), 'vip_host')
         OR public.has_role(auth.uid(), 'manager')
         OR public.has_role(auth.uid(), 'barman'))
        AND public.get_user_venue_id(auth.uid()) = venue_id)
  )
  WITH CHECK (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.is_super_admin()
    OR ((public.has_role(auth.uid(), 'vip_host')
         OR public.has_role(auth.uid(), 'manager'))
        AND public.get_user_venue_id(auth.uid()) = venue_id)
  );

-- =========================================================================
-- 2. Waitlist tables VIP
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.vip_table_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.table_zones(id) ON DELETE SET NULL,
  pack_id uuid REFERENCES public.table_packs(id) ON DELETE SET NULL,
  user_id uuid,
  email text,
  full_name text,
  phone text,
  guest_count int NOT NULL DEFAULT 1,
  note text,
  status text NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vip_table_waitlist_status_check CHECK (status IN ('waiting','offered','converted','expired','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_vip_waitlist_venue_event ON public.vip_table_waitlist(venue_id, event_id);
CREATE INDEX IF NOT EXISTS idx_vip_waitlist_status      ON public.vip_table_waitlist(status);

ALTER TABLE public.vip_table_waitlist ENABLE ROW LEVEL SECURITY;

-- Le client (connecté ou invité) peut se mettre en liste d'attente.
DROP POLICY IF EXISTS vip_waitlist_insert_public ON public.vip_table_waitlist;
CREATE POLICY vip_waitlist_insert_public ON public.vip_table_waitlist
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Le club (owner / staff / super admin) lit et gère sa waitlist.
DROP POLICY IF EXISTS vip_waitlist_staff_read ON public.vip_table_waitlist;
CREATE POLICY vip_waitlist_staff_read ON public.vip_table_waitlist
  FOR SELECT TO authenticated
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.is_super_admin()
    OR ((public.has_role(auth.uid(), 'vip_host')
         OR public.has_role(auth.uid(), 'manager'))
        AND public.get_user_venue_id(auth.uid()) = venue_id)
  );

DROP POLICY IF EXISTS vip_waitlist_staff_update ON public.vip_table_waitlist;
CREATE POLICY vip_waitlist_staff_update ON public.vip_table_waitlist
  FOR UPDATE TO authenticated
  USING (
    public.is_venue_owner(auth.uid(), venue_id)
    OR public.is_super_admin()
    OR ((public.has_role(auth.uid(), 'vip_host')
         OR public.has_role(auth.uid(), 'manager'))
        AND public.get_user_venue_id(auth.uid()) = venue_id)
  );
