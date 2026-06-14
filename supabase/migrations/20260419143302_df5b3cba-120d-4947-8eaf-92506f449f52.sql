
-- Phase 1: Schema — make venue_id nullable + add organizer_user_id on DJ-related tables
-- Goal: enable organizers (Yuno BDE/Org accounts) to manage their own roster of DJs,
-- using the same data model as venue owners.

-- =====================================================
-- 1. djs table
-- =====================================================
ALTER TABLE public.djs
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.djs
  ALTER COLUMN venue_id DROP NOT NULL;

-- A DJ row must belong to exactly one of: a venue OR an organizer
ALTER TABLE public.djs
  DROP CONSTRAINT IF EXISTS djs_scope_check;
ALTER TABLE public.djs
  ADD CONSTRAINT djs_scope_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR
    (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_djs_organizer_user_id ON public.djs(organizer_user_id);

-- =====================================================
-- 2. dj_sets table
-- =====================================================
ALTER TABLE public.dj_sets
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.dj_sets
  ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.dj_sets
  DROP CONSTRAINT IF EXISTS dj_sets_scope_check;
ALTER TABLE public.dj_sets
  ADD CONSTRAINT dj_sets_scope_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR
    (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_dj_sets_organizer_user_id ON public.dj_sets(organizer_user_id);

-- =====================================================
-- 3. dj_invitations table
-- =====================================================
ALTER TABLE public.dj_invitations
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.dj_invitations
  ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.dj_invitations
  DROP CONSTRAINT IF EXISTS dj_invitations_scope_check;
ALTER TABLE public.dj_invitations
  ADD CONSTRAINT dj_invitations_scope_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR
    (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_dj_invitations_organizer_user_id ON public.dj_invitations(organizer_user_id);

-- =====================================================
-- 4. RLS for djs — organizer scope
-- =====================================================
DROP POLICY IF EXISTS "Organizers can manage their djs" ON public.djs;
CREATE POLICY "Organizers can manage their djs"
ON public.djs
FOR ALL
TO authenticated
USING (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
WITH CHECK (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid());

-- =====================================================
-- 5. RLS for dj_sets — organizer scope
-- =====================================================
DROP POLICY IF EXISTS "Organizers can manage their dj_sets" ON public.dj_sets;
CREATE POLICY "Organizers can manage their dj_sets"
ON public.dj_sets
FOR ALL
TO authenticated
USING (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
WITH CHECK (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid());

-- =====================================================
-- 6. RLS for dj_invitations — organizer scope
-- =====================================================
DROP POLICY IF EXISTS "Organizers can manage their dj invitations" ON public.dj_invitations;
CREATE POLICY "Organizers can manage their dj invitations"
ON public.dj_invitations
FOR ALL
TO authenticated
USING (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
WITH CHECK (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid());

-- =====================================================
-- 7. RLS for dj_payments — organizer scope (via djs join)
-- =====================================================
DROP POLICY IF EXISTS "Organizers can manage dj payments" ON public.dj_payments;
CREATE POLICY "Organizers can manage dj payments"
ON public.dj_payments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.djs d
    WHERE d.id = dj_payments.dj_id
      AND d.organizer_user_id IS NOT NULL
      AND d.organizer_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.djs d
    WHERE d.id = dj_payments.dj_id
      AND d.organizer_user_id IS NOT NULL
      AND d.organizer_user_id = auth.uid()
  )
);

-- =====================================================
-- 8. ticket_presets — make venue_id nullable + add organizer_user_id
-- =====================================================
ALTER TABLE public.ticket_presets
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.ticket_presets
  ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.ticket_presets
  DROP CONSTRAINT IF EXISTS ticket_presets_scope_check;
ALTER TABLE public.ticket_presets
  ADD CONSTRAINT ticket_presets_scope_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR
    (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_ticket_presets_organizer_user_id ON public.ticket_presets(organizer_user_id);

DROP POLICY IF EXISTS "Organizers can manage their ticket presets" ON public.ticket_presets;
CREATE POLICY "Organizers can manage their ticket presets"
ON public.ticket_presets
FOR ALL
TO authenticated
USING (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
WITH CHECK (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid());
