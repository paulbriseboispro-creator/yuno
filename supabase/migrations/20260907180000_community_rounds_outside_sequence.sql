-- Un tarif communauté vit À CÔTÉ de la séquence des tours publics (Early Bird →
-- Regular → Last Minute), jamais dedans : sinon, en mode séquentiel, un tour
-- « abonnés » placé en tête verrouillait toute la billetterie pour les
-- non-abonnés (le tour public suivant restait caché et refusé au checkout).
-- Le trigger d'auto-activation ne fait donc avancer la séquence que pour un
-- tour public, et ne choisit jamais un tour communauté comme « suivant ».
CREATE OR REPLACE FUNCTION public.auto_activate_next_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  next_round_id uuid;
  v_just_sold_out boolean;
BEGIN
  v_just_sold_out :=
    (NEW.tickets_sold >= NEW.max_tickets AND OLD.tickets_sold < OLD.max_tickets)
    OR (NEW.manually_sold_out = true AND COALESCE(OLD.manually_sold_out, false) = false);

  IF v_just_sold_out THEN
    NEW.is_active := false;

    IF COALESCE(NEW.audience, 'everyone') = 'everyone' THEN
      SELECT id INTO next_round_id
      FROM public.ticket_rounds
      WHERE event_id = NEW.event_id
        AND position > NEW.position
        AND COALESCE(audience, 'everyone') = 'everyone'
        AND auto_activate = true
        AND is_active = false
        AND manually_sold_out = false
        AND tickets_sold < max_tickets
      ORDER BY position
      LIMIT 1;

      IF next_round_id IS NOT NULL THEN
        UPDATE public.ticket_rounds SET is_active = true WHERE id = next_round_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
