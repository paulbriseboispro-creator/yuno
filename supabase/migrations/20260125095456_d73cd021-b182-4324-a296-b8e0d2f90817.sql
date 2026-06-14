-- Add maintenance_password column to app_settings
ALTER TABLE public.app_settings 
ADD COLUMN IF NOT EXISTS maintenance_password TEXT DEFAULT NULL;