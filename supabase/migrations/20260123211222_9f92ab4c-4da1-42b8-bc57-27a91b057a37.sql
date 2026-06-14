-- Table pour les paramètres globaux de l'application
CREATE TABLE IF NOT EXISTS public.app_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- Insérer les paramètres par défaut
INSERT INTO public.app_settings (id, maintenance_mode, maintenance_message)
VALUES ('global', false, 'Yuno arrive bientôt. Inscris-toi pour être le premier informé du lancement!')
ON CONFLICT (id) DO NOTHING;

-- Table pour les pré-inscriptions (waitlist)
CREATE TABLE IF NOT EXISTS public.launch_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  city TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notified_at TIMESTAMP WITH TIME ZONE
);

-- RLS pour app_settings - lecture publique, écriture super admin uniquement
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read app settings"
ON public.app_settings FOR SELECT
USING (true);

CREATE POLICY "Super admins can update app settings"
ON public.app_settings FOR UPDATE
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- RLS pour launch_waitlist - insertion publique, lecture super admin
ALTER TABLE public.launch_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join waitlist"
ON public.launch_waitlist FOR INSERT
WITH CHECK (true);

CREATE POLICY "Super admins can view waitlist"
ON public.launch_waitlist FOR SELECT
TO authenticated
USING (public.is_super_admin());

CREATE POLICY "Super admins can delete from waitlist"
ON public.launch_waitlist FOR DELETE
TO authenticated
USING (public.is_super_admin());