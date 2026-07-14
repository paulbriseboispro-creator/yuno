-- Notifications push du staff (app « Yuno Pro »).
--
-- Jusqu'ici le staff n'avait QUE du temps réel in-app (staff_notifications +
-- Supabase Realtime) : rien n'arrivait sur un téléphone verrouillé, et le seul
-- producteur non-owner existant était `vip_entry` (écrit par le scan videur).
-- Barman, videur, vestiaire et promoteur ne recevaient donc rien du tout.
--
-- Ce lot ajoute (1) le pont staff_notifications -> APNs et (2) les producteurs
-- manquants.
--
-- Principe : `staff_notifications` reste la source de vérité (l'inbox in-app ne
-- change pas). Un trigger AFTER INSERT relaie vers send-push-notification pour
-- une LISTE BLANCHE de types « importants » seulement — un push réveille, il ne
-- raconte pas la nuit. Le reste (notifications 'owner' : une par vente de
-- billet) ne pousse pas : c'est du volume, et le rôle owner n'est même pas
-- embarqué dans l'app Pro.
--
-- `net.http_post` est asynchrone (queue pg_net) : zéro latence ajoutée au scan
-- à la porte ou à la commande d'un client. Chaque fonction est enveloppée d'un
-- EXCEPTION WHEN OTHERS : un push raté ne doit JAMAIS faire échouer l'écriture
-- métier qui l'a déclenché.
--
-- Le libellé, la langue et le deep-link sont construits côté edge function, qui
-- seule connaît la langue de chaque destinataire (profiles.preferred_language).
-- Ici on n'écrit que le français, comme les producteurs existants, pour l'inbox.

-- ── 1. Le pont : staff_notifications -> push ─────────────────────────────────

CREATE OR REPLACE FUNCTION private.notify_staff_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', private.get_cron_secret()
    ),
    body := jsonb_build_object(
      'action', 'staff_notification',
      'notification_id', NEW.id
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort : ne jamais casser l'écriture métier pour un push raté.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_staff_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_staff_notification_push ON public.staff_notifications;
CREATE TRIGGER trg_staff_notification_push
  AFTER INSERT ON public.staff_notifications
  FOR EACH ROW
  WHEN (NEW.notification_type IN (
    'vip_entry',          -- un client VIP vient d'entrer      -> vip_host
    'vip_order_request',  -- un client demande une commande    -> vip_host
    'bar_order_new',      -- une commande entre en file        -> barman
    'door_incident'       -- incident signalé à la porte       -> bouncer
  ))
  EXECUTE FUNCTION private.notify_staff_push();

-- ── 2. Producteur : demande de commande VIP (client -> hôte VIP) ─────────────
--
-- Les trois écrivains de vip_table_orders se distinguent par leur statut :
--   • 'pending'   -> VipMenu : un CLIENT assis à sa table passe commande. C'est
--                    la seule qui doit réveiller l'hôte (il doit la confirmer).
--   • 'preparing' -> QuickAddPopover : l'hôte VIP ajoute lui-même la conso. Le
--                    notifier de son propre geste serait absurde.
--   • 'preorder'  -> create-table-checkout : pré-commande à la réservation,
--                    souvent des jours avant. Rien d'urgent.

CREATE OR REPLACE FUNCTION private.notify_vip_order_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r record;
BEGIN
  SELECT tr.full_name, tr.guest_count, tr.event_id, z.name AS zone_name
    INTO r
    FROM public.table_reservations tr
    LEFT JOIN public.table_zones z ON z.id = tr.zone_id
   WHERE tr.id = NEW.table_reservation_id;

  INSERT INTO public.staff_notifications (
    venue_id, event_id, target_role, notification_type, title, message,
    reference_type, reference_id, priority, metadata
  ) VALUES (
    NEW.venue_id, r.event_id, 'vip_host', 'vip_order_request',
    'Demande de commande',
    COALESCE(r.full_name, 'Table VIP') || ' vient de passer une commande'
      || COALESCE(' — ' || r.zone_name, ''),
    'vip_table_order', NEW.id, 'high',
    jsonb_build_object(
      'guest_name', r.full_name,
      'zone_name', r.zone_name,
      'total_amount', COALESCE(NEW.total_amount, 0)
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_vip_order_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vip_order_request ON public.vip_table_orders;
CREATE TRIGGER trg_vip_order_request
  AFTER INSERT ON public.vip_table_orders
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION private.notify_vip_order_request();

-- ── 3. Producteur : nouvelle commande au bar (client -> barman) ──────────────
--
-- Une commande entre dans la file du barman quand elle est payée ET que la
-- préparation est demandée ET qu'elle est en 'queue' (mêmes critères que la
-- requête de Barman.tsx).
--
-- ANTI-SPAM, et c'est le point important : on ne pousse QUE si la file était
-- vide. Un samedi soir à 200 commandes, un push par commande serait
-- inutilisable — et inutile, puisque le barman a déjà l'app ouverte avec sa
-- pastille temps réel. Le push sert à le RÉVEILLER quand rien n'attendait.

CREATE OR REPLACE FUNCTION private.notify_bar_order_new()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_queued int;
BEGIN
  SELECT count(*) INTO v_queued
    FROM public.orders o
   WHERE o.venue_id = NEW.venue_id
     AND o.id <> NEW.id
     AND o.status = 'paid'
     AND COALESCE(o.prep_requested, false)
     AND o.prep_status = 'queue';

  IF v_queued > 0 THEN
    RETURN NEW; -- le barman est déjà au travail : pas de push.
  END IF;

  INSERT INTO public.staff_notifications (
    venue_id, event_id, target_role, notification_type, title, message,
    reference_type, reference_id, priority, metadata
  ) VALUES (
    NEW.venue_id, NEW.event_id, 'barman', 'bar_order_new',
    'Nouvelle commande',
    'Une commande' || COALESCE(' #' || NEW.order_number, '') || ' attend au bar',
    'order', NEW.id, 'high',
    jsonb_build_object(
      'order_number', NEW.order_number,
      'items_count', CASE
        WHEN jsonb_typeof(NEW.items::jsonb) = 'array' THEN jsonb_array_length(NEW.items::jsonb)
        ELSE 0
      END
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_bar_order_new() FROM PUBLIC, anon, authenticated;

-- Deux triggers : une commande peut naître déjà payée (INSERT) ou n'entrer en
-- file qu'au moment où le paiement est confirmé / la prépa demandée (UPDATE).
-- Le WHEN de l'UPDATE exige une vraie TRANSITION, sinon chaque UPDATE anodin
-- sur la ligne (claim, notify_status...) re-notifierait.
DROP TRIGGER IF EXISTS trg_bar_order_new_ins ON public.orders;
CREATE TRIGGER trg_bar_order_new_ins
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.status = 'paid'
    AND COALESCE(NEW.prep_requested, false)
    AND NEW.prep_status = 'queue'
  )
  EXECUTE FUNCTION private.notify_bar_order_new();

DROP TRIGGER IF EXISTS trg_bar_order_new_upd ON public.orders;
CREATE TRIGGER trg_bar_order_new_upd
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.status = 'paid'
    AND COALESCE(NEW.prep_requested, false)
    AND NEW.prep_status = 'queue'
    AND (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.prep_status IS DISTINCT FROM NEW.prep_status
      OR OLD.prep_requested IS DISTINCT FROM NEW.prep_requested
    )
  )
  EXECUTE FUNCTION private.notify_bar_order_new();

-- ── 4. Producteur : incident à la porte (videur -> videurs) ──────────────────
--
-- Un incident (bagarre, refus, urgence médicale) signalé en 1 tap depuis
-- IncidentQuickReport doit atteindre les AUTRES videurs, y compris si leur
-- téléphone est verrouillé. `actor_id` porte l'auteur du signalement : l'edge
-- function l'exclut des destinataires (on ne se notifie pas soi-même).

CREATE OR REPLACE FUNCTION private.notify_door_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  INSERT INTO public.staff_notifications (
    venue_id, event_id, target_role, notification_type, title, message,
    reference_type, reference_id, priority, metadata
  ) VALUES (
    NEW.venue_id, NEW.event_id, 'bouncer', 'door_incident',
    'Incident signalé',
    COALESCE(NULLIF(NEW.note, ''), 'Incident signalé à la porte'),
    'night_ops_event', NEW.id, 'urgent',
    jsonb_build_object(
      'kind', NEW.kind,
      'note', NEW.note,
      'actor_id', NEW.reported_by
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_door_incident() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_door_incident ON public.night_ops_events;
CREATE TRIGGER trg_door_incident
  AFTER INSERT ON public.night_ops_events
  FOR EACH ROW
  WHEN (NEW.kind LIKE 'incident\_%')
  EXECUTE FUNCTION private.notify_door_incident();
