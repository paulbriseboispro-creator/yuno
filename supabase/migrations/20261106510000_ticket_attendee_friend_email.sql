-- Billet individuel envoyé par e-mail à chaque personne invitée par l'acheteur
-- (ticket_attendees.email, saisi au paiement : obligatoire sur un billet de plusieurs
-- personnes). `friend_emailed_at` : une personne ne reçoit son billet qu'UNE fois, même si
-- l'e-mail de l'acheteur est renvoyé à la main.
ALTER TABLE public.ticket_attendees
  ADD COLUMN IF NOT EXISTS friend_emailed_at timestamptz;

COMMENT ON COLUMN public.ticket_attendees.friend_emailed_at IS
  'Quand cette personne a reçu son billet individuel par e-mail (send-ticket-confirmation). NULL = pas encore.';
