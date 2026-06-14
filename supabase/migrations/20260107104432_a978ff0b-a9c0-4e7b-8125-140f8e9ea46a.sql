-- Add custom_domain field to venues for branded promoter links
ALTER TABLE public.venues ADD COLUMN custom_domain TEXT;