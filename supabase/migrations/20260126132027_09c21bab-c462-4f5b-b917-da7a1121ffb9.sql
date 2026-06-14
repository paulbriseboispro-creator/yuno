-- Drop the existing foreign key constraint and recreate with CASCADE
ALTER TABLE public.visitor_sessions 
DROP CONSTRAINT IF EXISTS visitor_sessions_venue_id_fkey;

ALTER TABLE public.visitor_sessions 
ADD CONSTRAINT visitor_sessions_venue_id_fkey 
FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;