ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.ticket_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_reservation_id
  ON public.tickets(reservation_id) WHERE reservation_id IS NOT NULL;