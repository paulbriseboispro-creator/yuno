-- ────────────────────────────────────────────────────────────────────────────
--  night_ops_events : journal opérationnel de soirée
--  Le staff alimente le centre de commandement owner en direct :
--  - incidents 1-tap déclarés par le bouncer (bagarre, refus, médical, foule)
--  - prise de poste (shift_start) émise au premier montage des apps staff
--  customer_incidents reste le CRM (lié à un venue_customer connu, pour bloquer
--  les prochains events) — ce journal-ci accepte des événements anonymes,
--  horodatés par soirée. Immutable : pas d'UPDATE/DELETE (v1).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.night_ops_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    TEXT NOT NULL,
  event_id    UUID REFERENCES public.events(id) ON DELETE SET NULL,
  reported_by UUID NOT NULL,
  kind        TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT night_ops_events_kind_chk CHECK (kind IN (
    'incident_fight', 'incident_refusal', 'incident_medical',
    'incident_crowd', 'incident_other', 'shift_start'
  ))
);

CREATE INDEX IF NOT EXISTS idx_night_ops_events_venue_created
  ON public.night_ops_events (venue_id, created_at DESC);

ALTER TABLE public.night_ops_events ENABLE ROW LEVEL SECURITY;

-- Staff de nuit d'un venue : owner, manager (permission staff), et les rôles
-- opérationnels rattachés au venue via profiles.venue_id.
CREATE OR REPLACE FUNCTION public.is_night_staff_of_venue(p_venue_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_super_admin()
    OR is_venue_owner(auth.uid(), p_venue_id)
    OR manager_has_permission(auth.uid(), p_venue_id, 'staff')
    OR (
      get_user_venue_id(auth.uid()) = p_venue_id
      AND (
        has_role(auth.uid(), 'bouncer')
        OR has_role(auth.uid(), 'barman')
        OR has_role(auth.uid(), 'cloakroom')
        OR has_role(auth.uid(), 'vip_host')
      )
    );
$$;

CREATE POLICY "night staff can report ops events"
  ON public.night_ops_events
  FOR INSERT
  WITH CHECK (
    public.is_night_staff_of_venue(venue_id)
    AND reported_by = auth.uid()
  );

CREATE POLICY "night staff can read ops events"
  ON public.night_ops_events
  FOR SELECT
  USING (public.is_night_staff_of_venue(venue_id));

-- Le centre de commandement écoute la table en realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE public.night_ops_events;
