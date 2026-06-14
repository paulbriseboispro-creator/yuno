ALTER TABLE public.promoters 
  ADD COLUMN IF NOT EXISTS guest_list_template_id uuid REFERENCES public.commission_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_discount_template_id uuid REFERENCES public.commission_templates(id) ON DELETE SET NULL;