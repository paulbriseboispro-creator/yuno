-- =====================================================================
-- Guest list — modèle HYBRIDE dans une collaboration.
--
-- La part MAISON (holder_type='club') et l'allocation totale suivent le domaine
-- `operations` : la partie qui tient l'opérationnel la gère, l'AUTRE la
-- prévisualise. Chaque partie garde par ailleurs ses propres parts déléguées
-- (dj / promoter / custom), qui conservent leurs policies d'ownership.
--
-- Ce fichier ajoute :
--   1. can_manage_event_guestlist_house() — qui peut ÉCRIRE la part maison,
--      calqué sur can_manage_event_tables() (domaine operations), mais SANS le
--      bypass inconditionnel du lead-organisateur : sur une co-soirée où il a
--      confié l'operations, le lead ne touche plus la part maison (miroir exact
--      du garde-fou client canSideEdit).
--   2. un trigger de garde sur guest_lists : seule la part maison est verrouillée,
--      et seulement sur UPDATE / DELETE. L'INSERT reste libre — l'auto-seed
--      SECURITY DEFINER du modèle récurrent (apply_recurring_guest_list_template)
--      en crée une, et la contrainte UNIQUE(event_id) WHERE holder_type='club'
--      empêche déjà les doublons.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.can_manage_event_guestlist_house(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND (
        -- Lead organisateur : plein contrôle sur une soirée solo / sans club
        -- partenaire, OU sur une co-soirée où il tient encore l'operations.
        (e.organizer_user_id = _user_id
         AND (e.partner_venue_id IS NULL
              OR public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                 IN ('organizer', 'both')))
        -- Organisateur partenaire : seulement s'il tient l'operations.
        OR (e.partner_organizer_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('organizer', 'both'))
        -- Club (owner ou manager) : seulement s'il tient l'operations.
        OR ((v.owner_id = _user_id OR public.can_manage_venue(_user_id, v.id))
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('venue', 'both'))
        OR public.is_super_admin()
      )
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_event_guestlist_house(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_guest_list_house()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_house boolean;
  v_event uuid;
BEGIN
  -- Écritures système / service_role (pas de JWT) : jamais gardées. L'anon n'a
  -- aucune policy d'écriture sur guest_lists, donc le trigger ne le voit jamais.
  IF auth.uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_is_house := (OLD.holder_type = 'club');
    v_event := OLD.event_id;
  ELSE
    -- Couvre aussi une bascule de holder_type vers/depuis 'club'.
    v_is_house := (OLD.holder_type = 'club' OR NEW.holder_type = 'club');
    v_event := NEW.event_id;
  END IF;

  IF v_is_house AND NOT public.can_manage_event_guestlist_house(auth.uid(), v_event) THEN
    RAISE EXCEPTION 'La guest list maison est tenue par la partie qui gère l''opérationnel'
      USING HINT = 'Proposez un avenant pour déplacer l''opérationnel, ou gérez votre propre part.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_guest_list_house ON public.guest_lists;
CREATE TRIGGER trg_guard_guest_list_house
  BEFORE UPDATE OR DELETE ON public.guest_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_guest_list_house();

-- GRANT : le détenteur des opérations peut écrire la part maison même quand il
-- n'en est PAS propriétaire au sens des colonnes (ex. organisateur qui tient
-- l'operations sur une part maison venue-scopée). Les policies existantes
-- couvrent déjà le venue owner ; celle-ci ajoute l'orga-operations. Le trigger
-- ci-dessus reste le garde-fou qui BLOQUE un non-détenteur même propriétaire.
DROP POLICY IF EXISTS "Operations holder manages house guest list" ON public.guest_lists;
CREATE POLICY "Operations holder manages house guest list"
ON public.guest_lists FOR ALL TO authenticated
USING (holder_type = 'club' AND public.can_manage_event_guestlist_house(auth.uid(), event_id))
WITH CHECK (holder_type = 'club' AND public.can_manage_event_guestlist_house(auth.uid(), event_id));
