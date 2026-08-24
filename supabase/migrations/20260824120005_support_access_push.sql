-- Accès assisté : pousser la notification sur le téléphone du pro.
--
-- Sans ça, le consentement n'est visible qu'à la prochaine ouverture de l'app —
-- soit potentiellement 12 h d'accès non surveillé, ce que la promesse faite au
-- client contredit frontalement. Une session qui s'ouvre dans SON compte doit
-- faire vibrer SON téléphone, tout de suite.
--
-- Le flux staff (`staff_notifications`) a déjà un trigger de push, gouverné par
-- une allowlist de types : on l'étend aux trois types d'accès assisté.
-- Voir la double porte du push staff dans CLAUDE.md.

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
    'event_prep_6h',      -- soirée dans ~6h : préparer le service -> tout le staff
    -- Accès assisté Yuno : ces trois-là doivent sonner, pas attendre.
    'support_access_requested',
    'support_access_session',
    'support_access_ended'
  ))
  EXECUTE FUNCTION private.notify_staff_push();
