-- Billetterie LIBRE : un billet peut s'ouvrir quand un AUTRE est complet.
--
-- C'est la mécanique des rounds, posée billet par billet au lieu d'une file
-- unique : « First Round — Before 1 AM » s'ouvre quand « Early Round —
-- Before 1 AM » est complet, pendant que « First Round — All Night Long »
-- attend « Early Round — All Night Long ». Combinée à l'heure limite d'entrée
-- (entry_deadline) et aux dates du mode libre, elle permet de composer
-- n'importe quelle billetterie.
--
-- ticket_rounds.opens_after_round_id = le billet à épuiser. Tant qu'il ne
-- l'est pas, `is_active` reste à false (« Bientôt » côté public, refusé au
-- checkout par ticketPhase, comme tout billet libre fermé). Dès qu'il l'est
-- (quantité atteinte OU marqué « Complet »), le trigger existant
-- auto_activate_next_round ouvre ses successeurs. Le reste du mode libre
-- (affichage, date de mise en vente, fin de vente) se combine : un billet
-- ouvert par sa chaîne mais dont la date n'est pas venue reste « Bientôt ».
--
-- Écriture : la colonne vaut dans tous les modes mais seul le mode libre la
-- pose. Le trigger guard_ticket_round_opens_after décide `is_active` quand le
-- lien est posé, changé ou réécrit, ou quand on retire « Complet » : jamais
-- le client.

ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS opens_after_round_id uuid
    REFERENCES public.ticket_rounds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_rounds_opens_after
  ON public.ticket_rounds (opens_after_round_id)
  WHERE opens_after_round_id IS NOT NULL;

COMMENT ON COLUMN public.ticket_rounds.opens_after_round_id IS
  'Billetterie libre : ce billet s''ouvre quand ce billet-là est complet (rounds billet par billet). NULL = selon is_active / sale_starts_at.';

-- ── Garde du lien : même soirée, pas de boucle, is_active décidé ici ──────────
-- SECURITY INVOKER : il ne lit que des lignes de la même soirée, que celui qui
-- écrit voit déjà (RLS). Un prédécesseur invisible (inséré dans la même
-- requête, plus loin dans la liste) laisse le billet fermé : la clé
-- étrangère garantit qu'il existe.
CREATE OR REPLACE FUNCTION public.guard_ticket_round_opens_after()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pred record;
  v_found boolean;
  v_cursor uuid;
  v_steps int := 0;
BEGIN
  IF NEW.opens_after_round_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.opens_after_round_id = NEW.id THEN
    RAISE EXCEPTION 'ticket_chain_self' USING ERRCODE = '22023';
  END IF;

  SELECT id, event_id, tickets_sold, max_tickets, manually_sold_out
    INTO v_pred
    FROM public.ticket_rounds
   WHERE id = NEW.opens_after_round_id;
  v_found := FOUND;

  IF v_found THEN
    IF v_pred.event_id <> NEW.event_id THEN
      RAISE EXCEPTION 'ticket_chain_other_event' USING ERRCODE = '22023';
    END IF;
    -- Pas de boucle : en remontant la chaîne depuis le prédécesseur, on ne
    -- doit jamais retomber sur ce billet (deux billets qui s'attendent ne
    -- s'ouvriraient jamais).
    v_cursor := NEW.opens_after_round_id;
    WHILE v_cursor IS NOT NULL AND v_steps < 100 LOOP
      SELECT opens_after_round_id INTO v_cursor FROM public.ticket_rounds WHERE id = v_cursor;
      IF v_cursor = NEW.id THEN
        RAISE EXCEPTION 'ticket_chain_cycle' USING ERRCODE = '22023';
      END IF;
      v_steps := v_steps + 1;
    END LOOP;
  END IF;

  -- Un billet lui-même complet reste fermé (auto_activate_next_round s'en charge).
  IF COALESCE(NEW.manually_sold_out, false) OR NEW.tickets_sold >= NEW.max_tickets THEN
    RETURN NEW;
  END IF;

  -- Déjà ouvert par sa chaîne, lien inchangé : une simple modification du
  -- billet (prix, nom…) ne le referme pas, même si le prédécesseur a depuis
  -- rendu une place (réservation expirée, remboursement).
  IF TG_OP = 'UPDATE'
     AND OLD.opens_after_round_id IS NOT DISTINCT FROM NEW.opens_after_round_id
     AND OLD.is_active
     AND NOT COALESCE(OLD.manually_sold_out, false) THEN
    NEW.is_active := true;
    RETURN NEW;
  END IF;

  NEW.is_active := v_found AND (
    COALESCE(v_pred.manually_sold_out, false) OR v_pred.tickets_sold >= v_pred.max_tickets
  );
  RETURN NEW;
END;
$function$;

-- « ticket_… » se déclenche AVANT « trigger_auto_activate_next_round » (ordre
-- alphabétique) : un billet qui s'épuise est refermé par ce dernier, qui a
-- donc le dernier mot.
DROP TRIGGER IF EXISTS ticket_rounds_opens_after_guard ON public.ticket_rounds;
CREATE TRIGGER ticket_rounds_opens_after_guard
  BEFORE INSERT OR UPDATE OF opens_after_round_id, manually_sold_out ON public.ticket_rounds
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_round_opens_after();

-- ── Ouverture des successeurs quand un billet s'épuise ────────────────────────
-- Repris de l'état live (20260907180000) ; seul ajout : le bloc « billets qui
-- attendaient celui-ci ».
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

    -- Billetterie libre : les billets qui attendaient celui-ci s'ouvrent.
    UPDATE public.ticket_rounds
       SET is_active = true
     WHERE opens_after_round_id = NEW.id
       AND event_id = NEW.event_id
       AND is_active = false
       AND manually_sold_out = false
       AND tickets_sold < max_tickets;
  END IF;

  RETURN NEW;
END;
$function$;
