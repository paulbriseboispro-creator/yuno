-- 1. EVENTS — nouveaux champs pour le mode tables
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS tables_mode text CHECK (tables_mode IN ('elite', 'basic')),
  ADD COLUMN IF NOT EXISTS tables_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_tables_owner ON public.events(tables_owner_user_id) WHERE tables_owner_user_id IS NOT NULL;

-- 2. TABLE_ZONES — scope event optionnel
ALTER TABLE public.table_zones
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_table_zones_event ON public.table_zones(event_id) WHERE event_id IS NOT NULL;

-- 3. TABLE_PACKS — scope event optionnel
ALTER TABLE public.table_packs
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_table_packs_event ON public.table_packs(event_id) WHERE event_id IS NOT NULL;

-- 4. VENUE_FLOOR_PLANS — scope event optionnel
ALTER TABLE public.venue_floor_plans
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_venue_floor_plans_event ON public.venue_floor_plans(event_id) WHERE event_id IS NOT NULL;

-- 5. RLS — autoriser l'orga à gérer ses zones/packs/plan event-scopés
-- Helper : peut-on gérer les ressources d'un event ?
CREATE OR REPLACE FUNCTION public.can_manage_event_tables(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id
        OR e.partner_organizer_id = _user_id
        OR e.tables_owner_user_id = _user_id
        OR v.owner_id = _user_id
        OR public.is_super_admin()
      )
  )
$$;

-- Policies table_zones (event-scoped)
DROP POLICY IF EXISTS "Event-scoped zones manageable by event managers" ON public.table_zones;
CREATE POLICY "Event-scoped zones manageable by event managers"
ON public.table_zones FOR ALL
TO authenticated
USING (
  event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id)
)
WITH CHECK (
  event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id)
);

-- Policies table_packs (event-scoped)
DROP POLICY IF EXISTS "Event-scoped packs manageable by event managers" ON public.table_packs;
CREATE POLICY "Event-scoped packs manageable by event managers"
ON public.table_packs FOR ALL
TO authenticated
USING (
  event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id)
)
WITH CHECK (
  event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id)
);

-- Policies venue_floor_plans (event-scoped)
DROP POLICY IF EXISTS "Event-scoped floor plans manageable by event managers" ON public.venue_floor_plans;
CREATE POLICY "Event-scoped floor plans manageable by event managers"
ON public.venue_floor_plans FOR ALL
TO authenticated
USING (
  event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id)
)
WITH CHECK (
  event_id IS NOT NULL AND public.can_manage_event_tables(auth.uid(), event_id)
);