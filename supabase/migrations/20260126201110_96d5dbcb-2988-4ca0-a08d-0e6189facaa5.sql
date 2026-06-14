-- Drop the unique constraint on user_id alone for DJs (allow multi-venue)
ALTER TABLE public.djs DROP CONSTRAINT IF EXISTS djs_user_id_key;

-- Add composite unique constraint (user can be DJ at multiple venues, but only once per venue)
ALTER TABLE public.djs ADD CONSTRAINT djs_user_id_venue_id_key UNIQUE (user_id, venue_id);

-- Drop the unique constraint on user_id alone for Promoters if exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promoters_user_id_key') THEN
    ALTER TABLE public.promoters DROP CONSTRAINT promoters_user_id_key;
  END IF;
END $$;

-- Add composite unique constraint for promoters
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promoters_user_id_venue_id_key') THEN
    ALTER TABLE public.promoters ADD CONSTRAINT promoters_user_id_venue_id_key UNIQUE (user_id, venue_id);
  END IF;
END $$;

-- Create DJ invitations table
CREATE TABLE IF NOT EXISTS public.dj_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL,
  token TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  accepted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(email, venue_id)
);

-- Create Promoter invitations table
CREATE TABLE IF NOT EXISTS public.promoter_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL,
  token TEXT NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  promo_code TEXT NOT NULL,
  commission_config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  accepted_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(email, venue_id)
);

-- Enable RLS
ALTER TABLE public.dj_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promoter_invitations ENABLE ROW LEVEL SECURITY;

-- RLS policies for DJ invitations
CREATE POLICY "Owners can manage DJ invitations for their venue"
ON public.dj_invitations FOR ALL
USING (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'djs'))
WITH CHECK (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'djs'));

CREATE POLICY "Users can view their own DJ invitations"
ON public.dj_invitations FOR SELECT
USING (email = (SELECT email FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Super admins can manage all DJ invitations"
ON public.dj_invitations FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- RLS policies for Promoter invitations
CREATE POLICY "Owners can manage promoter invitations for their venue"
ON public.promoter_invitations FOR ALL
USING (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'promoters'))
WITH CHECK (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'promoters'));

CREATE POLICY "Users can view their own promoter invitations"
ON public.promoter_invitations FOR SELECT
USING (email = (SELECT email FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Super admins can manage all promoter invitations"
ON public.promoter_invitations FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());