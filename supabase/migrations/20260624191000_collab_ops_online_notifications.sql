-- =============================================================================
-- Co-soirée : prévenir la PARTIE adverse quand la billetterie ou la vente de
-- tables passe EN LIGNE.
--
-- Demande (Paul) :
--   • L'orga active la vente de tables / met les billets en ligne → notifier le
--     club ("les ventes ont été activées pour la soirée").
--   • Mode org_hosted (le club gère tout, l'orga ne fait que le marketing) :
--     c'est le club qui active → notifier l'orga.
--
-- Règle simple : on notifie celui qui N'A PAS agi. On résout les deux parties
-- via collab_event_parties(), on déduit l'acteur depuis auth.uid() (organisateur
-- vs propriétaire du club), et on écrit dans l'inbox de l'autre via
-- notify_collab_party() (helper déjà en place).
--
-- Déclenchement : AFTER UPDATE OF tables_enabled, ticketing_enabled — uniquement
-- sur les bascules false→true (l'activation), et seulement sur les events qui
-- ont bien deux parties (donc une co-soirée).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_collab_ops_online()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_venue_id   text;
  v_org_id     uuid;
  v_owner      uuid;
  v_recipient  text;
  v_title      text;
  v_actor      text;
  v_event_title text;
  v_tables_on  boolean;
  v_tickets_on boolean;
BEGIN
  -- Résoudre les deux parties (lead OU partner). Si l'une manque, ce n'est pas
  -- une co-soirée → rien à notifier.
  SELECT venue_id, organizer_user_id INTO v_venue_id, v_org_id
    FROM public.collab_event_parties(NEW.id);
  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_tables_on  := (NEW.tables_enabled   IS TRUE AND OLD.tables_enabled   IS DISTINCT FROM TRUE);
  v_tickets_on := (NEW.ticketing_enabled IS TRUE AND OLD.ticketing_enabled IS DISTINCT FROM TRUE);
  IF NOT v_tables_on AND NOT v_tickets_on THEN
    RETURN NEW;
  END IF;

  -- Qui a agi ? → notifier l'autre. Par défaut on prévient le club (cas le plus
  -- courant : l'orga active).
  SELECT owner_id INTO v_owner FROM public.venues WHERE id = v_venue_id;
  IF auth.uid() = v_org_id THEN
    v_recipient := 'venue';
  ELSIF auth.uid() = v_owner THEN
    v_recipient := 'organizer';
  ELSE
    v_recipient := 'venue';
  END IF;

  SELECT title INTO v_event_title FROM public.events WHERE id = NEW.id;
  v_event_title := COALESCE(v_event_title, 'une soirée');

  IF v_recipient = 'organizer' THEN
    SELECT name INTO v_actor FROM public.venues WHERE id = v_venue_id;
    v_actor := COALESCE(v_actor, 'Le club');
  ELSE
    SELECT display_name INTO v_actor FROM public.organizer_profiles WHERE user_id = v_org_id;
    v_actor := COALESCE(v_actor, 'L''organisateur');
  END IF;

  IF v_tables_on THEN
    PERFORM public.notify_collab_party(
      v_recipient, v_venue_id, v_org_id, NEW.id,
      'collab_tables_online', 'Vente de tables en ligne',
      v_actor || ' a activé la vente de tables pour « ' || v_event_title || ' ».',
      'normal', 'event', NEW.id,
      jsonb_build_object('event_id', NEW.id, 'kind', 'tables')
    );
  END IF;

  IF v_tickets_on THEN
    PERFORM public.notify_collab_party(
      v_recipient, v_venue_id, v_org_id, NEW.id,
      'collab_tickets_online', 'Billetterie en ligne',
      v_actor || ' a ouvert la billetterie de « ' || v_event_title || ' ».',
      'normal', 'event', NEW.id,
      jsonb_build_object('event_id', NEW.id, 'kind', 'tickets')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_collab_ops_online ON public.events;
CREATE TRIGGER trg_notify_collab_ops_online
  AFTER UPDATE OF tables_enabled, ticketing_enabled ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.notify_collab_ops_online();
