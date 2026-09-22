-- « Afficher cette soirée dans Mes commandes » n'est plus modifiable par un
-- client, quel que soit le bundle qui tourne.
--
-- La réparation du 22/09 (20260922120000) n'a tenu que quelques minutes : le
-- code fautif vit encore dans les bundles déjà distribués — onglet gardé
-- ouvert, service worker qui sert l'ancien fichier, et surtout l'app native,
-- qui ne reçoit le nouveau code qu'à la prochaine publication OTA. Chaque
-- ouverture de Mes Commandes depuis un de ces bundles remettait le drapeau à
-- false. Corriger le client ne suffit donc pas : tant qu'un ancien bundle peut
-- écrire cette colonne, le choix de la personne est à sa merci.
--
-- Deux écritures existaient, et les deux étaient des masquages d'affichage
-- posés sur une préférence :
--   - MyOrders, pour ne pas recalculer une ligne cachée (supprimé) ;
--   - OwnerTicketing, qui effaçait le choix de TOUS les inscrits d'une soirée
--     au passage en vente normale (supprimé) — un pro n'a pas à décider de ce
--     qui s'affiche dans les commandes de ses clients.
--
-- La colonne se pose donc à l'INSERT (la question est posée à l'inscription)
-- et ne bouge plus ensuite. Seul `service_role` peut encore la corriger.
-- Le reste de la ligne (lien user_id, presale_access) reste modifiable :
-- la garde ne verrouille QUE cette colonne.
--
-- SECURITY INVOKER : une garde qui discrimine l'appelant ne doit jamais
-- s'exécuter sous son propriétaire. Elle lit `auth.role()` (le JWT), pas
-- `current_user`, donc elle reste valable sous n'importe quel rôle SQL.

-- Rejouer la réparation : les lignes remises à false depuis ce matin.
UPDATE public.event_waitlist w
SET show_in_orders = true
FROM public.events e
WHERE e.id = w.event_id
  AND w.show_in_orders = false
  AND e.is_active
  AND e.cancelled_at IS NULL
  AND COALESCE(e.end_at, e.start_at) > now();

CREATE OR REPLACE FUNCTION public.guard_event_waitlist_preference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  -- Les jobs serveur gardent la main (réparations, purges, notifications).
  -- `auth.role()` vide = connexion SQL directe (migration, pg_cron) : il n'y a
  -- pas de client au bout, rien à protéger.
  IF COALESCE(auth.role(), '') IN ('', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Silencieux, pas bloquant : les écritures fautives sont des « fire and
  -- forget » d'anciens bundles. Lever ferait échouer, au passage, la mise à
  -- jour légitime qui les accompagne (rattachement du user_id après une
  -- inscription faite en invité).
  NEW.show_in_orders := OLD.show_in_orders;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_event_waitlist_preference ON public.event_waitlist;
CREATE TRIGGER guard_event_waitlist_preference
  BEFORE UPDATE OF show_in_orders ON public.event_waitlist
  FOR EACH ROW
  WHEN (NEW.show_in_orders IS DISTINCT FROM OLD.show_in_orders)
  EXECUTE FUNCTION public.guard_event_waitlist_preference();

