-- ============================================================================
-- Guest list : afficher (ou non) le nombre de places restantes côté public.
--
-- Jusqu'ici la page publique d'inscription (GuestListSignup) et la page club
-- (GuestListCheckout) affichaient TOUJOURS le compteur « X places restantes ».
-- C'est un choix marketing, pas une constante : beaucoup de clubs préfèrent ne
-- pas exposer le remplissage (une liste à 3/200 la veille tue la conversion,
-- une liste presque pleine peut au contraire créer l'urgence). Le choix se fait
-- à la création du MODÈLE (guest_list_templates) et se recopie dans chaque part
-- (guest_lists) au moment où le modèle est appliqué, comme tous les autres
-- réglages du preset (quotas, free_before_time, visible_on_club_page…).
--
-- Défaut = true : comportement actuel inchangé pour tout l'existant.
-- ============================================================================

ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS show_remaining boolean NOT NULL DEFAULT true;

ALTER TABLE public.guest_list_templates
  ADD COLUMN IF NOT EXISTS show_remaining boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.guest_lists.show_remaining IS
  'Affiche le compteur « X places restantes » sur les pages publiques de la liste. false = le visiteur voit seulement ouvert/complet.';
COMMENT ON COLUMN public.guest_list_templates.show_remaining IS
  'Valeur par défaut de guest_lists.show_remaining pour les parts créées depuis ce modèle.';

-- get_guest_list_by_token renvoie SETOF public.guest_lists : la nouvelle colonne
-- est propagée automatiquement, aucune redéfinition de la RPC n'est nécessaire.
