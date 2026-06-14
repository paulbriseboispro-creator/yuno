-- Extend favorites_favorite_type_check to accept affiliate_event and affiliate_venue
ALTER TABLE public.favorites DROP CONSTRAINT favorites_favorite_type_check;
ALTER TABLE public.favorites ADD CONSTRAINT favorites_favorite_type_check
  CHECK (favorite_type = ANY (ARRAY['club'::text, 'event'::text, 'drink'::text, 'dj'::text, 'affiliate_event'::text, 'affiliate_venue'::text]));
