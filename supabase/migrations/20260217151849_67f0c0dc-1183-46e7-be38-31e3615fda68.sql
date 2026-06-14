
-- Add new manager permission columns for recently created owner pages
ALTER TABLE public.manager_permissions 
  ADD COLUMN IF NOT EXISTS can_manage_loyalty boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_upsell boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_guest_list boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_customers boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_invoices boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_venue boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_refunds boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_crm boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_hype boolean DEFAULT false;
