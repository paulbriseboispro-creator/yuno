-- Fix FK constraints to allow venue deletion

ALTER TABLE public.orders DROP CONSTRAINT orders_venue_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_venue_id_fkey 
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;

ALTER TABLE public.profiles DROP CONSTRAINT profiles_venue_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_venue_id_fkey 
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE SET NULL;

ALTER TABLE public.feedback_issues DROP CONSTRAINT feedback_issues_venue_id_fkey;
ALTER TABLE public.feedback_issues ADD CONSTRAINT feedback_issues_venue_id_fkey 
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;

ALTER TABLE public.venue_commissions DROP CONSTRAINT venue_commissions_venue_id_fkey;
ALTER TABLE public.venue_commissions ADD CONSTRAINT venue_commissions_venue_id_fkey 
  FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;