-- Billets : permettre de marquer manuellement un round comme épuisé (sold out), sans
-- attendre que tickets_sold atteigne max_tickets. Et, en mode rounds, réutiliser
-- l'auto-activation existante : marquer un round épuisé ouvre le round suivant
-- automatiquement (si ce round suivant a opté pour auto_activate).

ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS manually_sold_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ticket_rounds.manually_sold_out IS
  'Épuisé forcé par le club/orga (indépendant de tickets_sold). Bloque l''achat côté public + checkout, et déclenche l''ouverture du round suivant si auto_activate.';

-- On étend la fonction d'auto-activation : elle se déclenche désormais soit quand un round
-- atteint sa capacité (comportement existant), soit quand le flag manuel passe à true.
CREATE OR REPLACE FUNCTION public.auto_activate_next_round()
RETURNS TRIGGER AS $$
DECLARE
  next_round_id uuid;
  v_just_sold_out boolean;
BEGIN
  -- Vient-il de passer "épuisé" sur cet UPDATE ? Capacité atteinte organiquement
  -- OU le club a basculé le flag manuel de false → true.
  v_just_sold_out :=
    (NEW.tickets_sold >= NEW.max_tickets AND OLD.tickets_sold < OLD.max_tickets)
    OR (NEW.manually_sold_out = true AND COALESCE(OLD.manually_sold_out, false) = false);

  IF v_just_sold_out THEN
    -- Le round épuisé n'est plus le round vivant.
    NEW.is_active := false;

    -- Ouvre le round suivant dans l'ordre, mais seulement s'il a opté pour l'auto-activation
    -- et qu'il n'est ni déjà actif, ni lui-même épuisé.
    SELECT id INTO next_round_id
    FROM public.ticket_rounds
    WHERE event_id = NEW.event_id
      AND position > NEW.position
      AND auto_activate = true
      AND is_active = false
      AND manually_sold_out = false
      AND tickets_sold < max_tickets
    ORDER BY position
    LIMIT 1;

    IF next_round_id IS NOT NULL THEN
      UPDATE public.ticket_rounds
      SET is_active = true
      WHERE id = next_round_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Le trigger BEFORE UPDATE trigger_auto_activate_next_round existe déjà et reste attaché.
