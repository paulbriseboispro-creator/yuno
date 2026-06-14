-- Add discount fields to promoters table for customer discounts
ALTER TABLE public.promoters 
ADD COLUMN customer_discount_type TEXT DEFAULT 'percentage' CHECK (customer_discount_type IN ('fixed', 'percentage')),
ADD COLUMN customer_discount_value NUMERIC DEFAULT 0;