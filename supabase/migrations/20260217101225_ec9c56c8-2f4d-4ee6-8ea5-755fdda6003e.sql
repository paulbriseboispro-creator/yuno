
-- Fix favorites check constraint to allow 'dj' type
ALTER TABLE public.favorites DROP CONSTRAINT favorites_favorite_type_check;
ALTER TABLE public.favorites ADD CONSTRAINT favorites_favorite_type_check 
  CHECK (favorite_type = ANY (ARRAY['club'::text, 'event'::text, 'drink'::text, 'dj'::text]));

-- Add unique constraint for dj favorites
ALTER TABLE public.favorites ADD CONSTRAINT favorites_user_id_favorite_type_dj_id_key 
  UNIQUE (user_id, favorite_type, dj_id);
