-- Add presale_price column to drinks table
ALTER TABLE public.drinks 
ADD COLUMN presale_price numeric NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.drinks.presale_price IS 'Reduced price for pre-event purchases';