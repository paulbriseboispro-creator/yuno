-- Drop the old check constraint and add a new one that includes 'soft' and removes 'bottle'
ALTER TABLE public.drinks DROP CONSTRAINT IF EXISTS drinks_collection_check;
ALTER TABLE public.drinks ADD CONSTRAINT drinks_collection_check CHECK (collection IN ('drink', 'shot', 'soft'));

-- Update any existing 'bottle' drinks to 'drink'
UPDATE public.drinks SET collection = 'drink' WHERE collection = 'bottle';