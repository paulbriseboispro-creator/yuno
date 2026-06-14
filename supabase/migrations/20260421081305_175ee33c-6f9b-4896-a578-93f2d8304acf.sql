
ALTER TABLE public.promoter_invitations
  ALTER COLUMN venue_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.promoter_invitations DROP CONSTRAINT IF EXISTS promoter_invitations_email_venue_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS promoter_invitations_email_venue_unique
  ON public.promoter_invitations (email, venue_id) WHERE venue_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS promoter_invitations_email_organizer_unique
  ON public.promoter_invitations (email, organizer_user_id) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.promoter_invitations DROP CONSTRAINT IF EXISTS promoter_invitations_context_check;
ALTER TABLE public.promoter_invitations
  ADD CONSTRAINT promoter_invitations_context_check
  CHECK ((venue_id IS NOT NULL)::int + (organizer_user_id IS NOT NULL)::int = 1);

DROP POLICY IF EXISTS "Organizer can manage own promoter invitations" ON public.promoter_invitations;
CREATE POLICY "Organizer can manage own promoter invitations"
  ON public.promoter_invitations FOR ALL
  TO authenticated
  USING (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id))
  WITH CHECK (organizer_user_id IS NOT NULL AND public.is_organizer_promoter_admin(auth.uid(), organizer_user_id));
