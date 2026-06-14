-- Add last_tables_threshold column to table_zones
ALTER TABLE public.table_zones 
ADD COLUMN last_tables_threshold integer NOT NULL DEFAULT 20;

-- Add comment to explain the column
COMMENT ON COLUMN public.table_zones.last_tables_threshold IS 'Percentage threshold for showing "last tables" scarcity badge (e.g., 20 means show when 20% or less tables remain)';