-- =============================================================================
-- Co-organisation : un co-hôte ÉDITEUR tient ses propres parts de guest list
-- =============================================================================
-- Joué sur la démo le 29/09 (« Triple Collab Night », club × orga partenaire ×
-- Asso co-hôte) : l'Asso, invitée en édition, ouvrait « Ajouter une part »,
-- remplissait le formulaire… et prenait « Erreur lors de l'enregistrement ».
-- La policy « Organizers manage own guest lists » n'accepte une part
-- d'organisateur que des parties PRINCIPALES (`is_event_partner_organizer`) ; un
-- co-hôte ne pouvait toucher qu'à la liste maison (`can_manage_event_guestlist_house`).
-- Or c'est tout l'intérêt d'un co-hôte : amener SON public par SA liste.
--
-- Ce qui s'ouvre, et rien d'autre : un co-hôte ÉDITEUR accepté (même porte que
-- le design, les tables et la liste maison) gère les parts qu'il POSSÈDE
-- (`organizer_user_id = auth.uid()`). Jamais la liste maison (déjà couverte par
-- sa propre policy), jamais une enveloppe d'agence (accordée par le club).
-- Un co-hôte « lecture » ne crée rien.
-- =============================================================================

CREATE POLICY "Cohost organizers manage own guest lists"
  ON public.guest_lists
  FOR ALL
  TO authenticated
  USING (
    organizer_user_id = auth.uid()
    AND event_id IS NOT NULL
    AND public.is_event_cohost(event_id, auth.uid(), 'editor')
  )
  WITH CHECK (
    organizer_user_id = auth.uid()
    AND event_id IS NOT NULL
    AND holder_type NOT IN ('club', 'agency')
    AND public.is_event_cohost(event_id, auth.uid(), 'editor')
  );
