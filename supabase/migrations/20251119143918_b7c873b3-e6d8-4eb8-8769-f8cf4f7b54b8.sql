-- Add collection column to drinks table
ALTER TABLE public.drinks 
ADD COLUMN collection text NOT NULL DEFAULT 'drink';

-- Add check constraint for valid collection values
ALTER TABLE public.drinks
ADD CONSTRAINT drinks_collection_check 
CHECK (collection IN ('drink', 'shot', 'bottle'));