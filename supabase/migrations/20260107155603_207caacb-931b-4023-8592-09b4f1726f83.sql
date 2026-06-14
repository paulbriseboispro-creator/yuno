-- Add 'dj' role to the app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dj';

-- Create table for DJ profiles with their info
CREATE TABLE public.djs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  stage_name TEXT,
  whatsapp_number TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  music_genres TEXT[] DEFAULT '{}',
  bio TEXT,
  profile_image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  pending_amount NUMERIC DEFAULT 0,
  total_paid NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create table for DJ sets/schedules
CREATE TABLE public.dj_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dj_id UUID NOT NULL REFERENCES public.djs(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  title TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  music_genre TEXT,
  notes TEXT,
  fee NUMERIC DEFAULT 0,
  fee_paid BOOLEAN DEFAULT false,
  fee_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create table for DJ payments history
CREATE TABLE public.dj_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dj_id UUID NOT NULL REFERENCES public.djs(id) ON DELETE CASCADE,
  dj_set_id UUID REFERENCES public.dj_sets(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  description TEXT,
  paid_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.djs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for djs table
CREATE POLICY "Owners can manage their venue DJs"
ON public.djs FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.venues v
    WHERE v.id = djs.venue_id AND v.owner_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.venue_id = djs.venue_id
    AND public.has_role(auth.uid(), 'owner')
  )
);

CREATE POLICY "DJs can view their own profile"
ON public.djs FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "DJs can update their own profile"
ON public.djs FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- RLS Policies for dj_sets table
CREATE POLICY "Owners can manage DJ sets"
ON public.dj_sets FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.venues v
    WHERE v.id = dj_sets.venue_id AND v.owner_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.venue_id = dj_sets.venue_id
    AND public.has_role(auth.uid(), 'owner')
  )
);

CREATE POLICY "DJs can view their own sets"
ON public.dj_sets FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.djs d
    WHERE d.id = dj_sets.dj_id AND d.user_id = auth.uid()
  )
);

-- RLS Policies for dj_payments table
CREATE POLICY "Owners can manage DJ payments"
ON public.dj_payments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.djs d
    JOIN public.venues v ON v.id = d.venue_id
    WHERE d.id = dj_payments.dj_id AND v.owner_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM public.djs d
    JOIN public.profiles p ON p.venue_id = d.venue_id
    WHERE d.id = dj_payments.dj_id AND p.id = auth.uid()
    AND public.has_role(auth.uid(), 'owner')
  )
);

CREATE POLICY "DJs can view their own payments"
ON public.dj_payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.djs d
    WHERE d.id = dj_payments.dj_id AND d.user_id = auth.uid()
  )
);

-- Triggers for updated_at
CREATE TRIGGER update_djs_updated_at
BEFORE UPDATE ON public.djs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dj_sets_updated_at
BEFORE UPDATE ON public.dj_sets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();