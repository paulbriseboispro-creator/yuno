
ALTER TABLE public.guest_lists ADD COLUMN IF NOT EXISTS entry_deadline time DEFAULT NULL;
ALTER TABLE public.guest_list_entries ADD COLUMN IF NOT EXISTS entry_deadline time DEFAULT NULL;
