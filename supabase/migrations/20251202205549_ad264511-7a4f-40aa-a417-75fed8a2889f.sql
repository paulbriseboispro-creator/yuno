-- Add presale_active boolean to drinks table
ALTER TABLE public.drinks
ADD COLUMN presale_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.drinks.presale_active IS 'Whether presale pricing is currently active for this drink';