-- Quotas PAR TYPE d'entrée : une liste/preset peut allouer un mix (ex. 10 normales +
-- 2 VIP + 5 boissons). quota reste le total (= somme des trois). Le scanner de porte
-- et l'app promoteur s'appuient sur guest_list_entries.entry_type ('normal'|'drink'|'table').

ALTER TABLE public.guest_list_templates
  ADD COLUMN IF NOT EXISTS quota_normal integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_drink  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_table  integer NOT NULL DEFAULT 0;

ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS quota_normal integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_drink  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_table  integer NOT NULL DEFAULT 0;

-- Backfill : l'existant devient 100% "normal" (le quota total actuel = quota_normal).
UPDATE public.guest_list_templates
  SET quota_normal = quota
  WHERE quota_normal = 0 AND quota_drink = 0 AND quota_table = 0;

UPDATE public.guest_lists
  SET quota_normal = quota
  WHERE quota_normal = 0 AND quota_drink = 0 AND quota_table = 0;
