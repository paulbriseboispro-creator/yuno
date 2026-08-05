-- ============================================================================
-- Rappel opérationnel staff : « soirée dans ~6h » (push app Pro)
-- ============================================================================
-- Le staff d'un club reçoit désormais un heads-up ~6h avant le début d'une
-- soirée pour préparer le service. C'est l'inverse d'une pub client : la
-- marketing « nouvel événement » (new_event) reste sur l'app grand public,
-- ce rappel-ci est de l'EXPLOITATION, sur l'app Pro.
--
-- Produit par le cron horaire `event-reminder` (nouvelle fenêtre T-6h) qui
-- insère UNE ligne staff_notifications (target_role 'all_staff', type
-- 'event_prep_6h'). Le pont staff_notifications -> APNs (trg_staff_notification_push)
-- ne pousse que pour une liste fermée de types : on y ajoute 'event_prep_6h'.
-- Le relay handleStaffNotification traite 'all_staff' = tout le staff du club
-- (tous rôles) + le patron.
--
-- Recréation à l'identique de la liste existante (cf. 20260722150000), plus le
-- nouveau type. Aucun autre changement de comportement.

DROP TRIGGER IF EXISTS trg_staff_notification_push ON public.staff_notifications;
CREATE TRIGGER trg_staff_notification_push
  AFTER INSERT ON public.staff_notifications
  FOR EACH ROW
  WHEN (NEW.notification_type IN (
    'vip_entry',          -- un client VIP vient d'entrer          -> vip_host
    'vip_order_request',  -- un client demande une commande        -> vip_host
    'bar_order_new',      -- une commande entre en file            -> barman
    'door_incident',      -- incident signalé à la porte           -> bouncer
    'station_call',       -- appel entre postes                    -> rôle ciblé
    'night_brief',        -- consigne du soir publiée              -> staff terrain
    'event_prep_6h'       -- soirée dans ~6h : préparer le service -> tout le staff
  ))
  EXECUTE FUNCTION private.notify_staff_push();
