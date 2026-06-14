-- Add tables_count column to table_packs
ALTER TABLE public.table_packs 
ADD COLUMN tables_count integer NOT NULL DEFAULT 1;

-- Add comment for clarity
COMMENT ON COLUMN public.table_packs.tables_count IS 'Number of tables available at this price';
