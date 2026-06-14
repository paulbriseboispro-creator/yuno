ALTER TABLE public.ticket_upsell_selections
  DROP CONSTRAINT IF EXISTS ticket_upsell_selections_offer_id_fkey,
  ADD CONSTRAINT ticket_upsell_selections_offer_id_fkey
    FOREIGN KEY (offer_id) REFERENCES public.ticket_upsell_offers(id) ON DELETE CASCADE;