-- Add promo_price field to drinks table for promotions
ALTER TABLE public.drinks
ADD COLUMN promo_price numeric NULL;

COMMENT ON COLUMN public.drinks.promo_price IS 'Prix promotionnel (optionnel). Si renseigné, price devient l''ancien prix barré';