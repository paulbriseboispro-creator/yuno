ALTER TABLE public.manager_permissions
  ADD COLUMN IF NOT EXISTS can_manage_scarcity boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_organizations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_vip_service boolean NOT NULL DEFAULT false;