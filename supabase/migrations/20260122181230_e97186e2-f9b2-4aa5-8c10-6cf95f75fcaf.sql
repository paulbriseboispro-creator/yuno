-- Add category column to email_templates for folder organization
ALTER TABLE public.email_templates 
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';

-- Update existing templates with appropriate categories
UPDATE public.email_templates SET category = 'recap' WHERE slug LIKE 'recap-%' OR slug = 'end-of-night-recap';

-- Create index for faster category queries
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON public.email_templates(category);