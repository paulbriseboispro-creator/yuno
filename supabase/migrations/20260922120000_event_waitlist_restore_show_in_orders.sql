-- Réparation : « Afficher cette soirée dans Mes commandes » avait été effacé
-- par le client lui-même.
--
-- `MyOrders` cachait une ligne de liste d'attente quand la soirée n'avait
-- encore aucune date de vente et l'interrupteur waitlist éteint — et, pour ne
-- pas la recalculer au chargement suivant, écrivait `show_in_orders = false`.
-- Or cette colonne n'est pas un cache : c'est le choix de la personne au
-- moment de l'inscription. Une soirée à venir dont la billetterie n'est pas
-- encore réglée est précisément le cas où l'on s'inscrit pour être prévenu :
-- le drapeau tombait donc sur les inscriptions les plus légitimes, et la
-- soirée ne revenait plus jamais dans l'onglet « À venir », même la vente
-- ouverte.
--
-- Le filtrage est désormais CALCULÉ à la lecture (billet déjà acheté, soirée
-- annulée, soirée finie) et n'écrit plus rien. On rend ici leur choix aux
-- personnes à qui il a été pris, en se limitant aux soirées qui n'ont pas
-- encore eu lieu : au-delà, la ligne serait filtrée à la lecture de toute
-- façon.
UPDATE public.event_waitlist w
SET show_in_orders = true
FROM public.events e
WHERE e.id = w.event_id
  AND w.show_in_orders = false
  AND e.is_active
  AND e.cancelled_at IS NULL
  AND COALESCE(e.end_at, e.start_at) > now();
