-- =====================================================================
-- Offre BDE — étape 3/3 : confidentialité par défaut + gate de publication
-- =====================================================================
-- Règle métier : une soirée BDE est PRIVÉE par défaut (accès par lien). La
-- rendre publique est une DEMANDE qu'un super admin doit approuver. On réécrit
-- evaluate_event_discoverability pour :
--   1. stamper events.is_bde de façon autoritaire (jamais depuis le client) ;
--   2. pour un event BDE en visibilité publique → discovery_status='pending' +
--      is_discoverable=false, tant qu'un super admin n'a pas approuvé ;
--   3. ne JAMAIS laisser un contexte non-admin s'auto-approuver, et ne pas
--      ré-écraser une approbation admin lors d'une édition ultérieure.
-- Les organisateurs standard (non BDE) gardent EXACTEMENT le comportement actuel
-- (auto-approbation sur critères de qualité).

CREATE OR REPLACE FUNCTION public.evaluate_event_discoverability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_bde boolean;
BEGIN
  -- (1) Stamp autoritaire : un event est "BDE" ssi son organisateur est bde_verified.
  -- Calculé ici (jamais lu depuis NEW tel quel) pour que le tarif et la visibilité
  -- s'appuient sur events.is_bde comme signal infalsifiable. Forcé à false pour les
  -- events sans organisateur (club seul) ou dont l'organisateur n'est pas BDE.
  v_is_bde := (
    NEW.organizer_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organizer_profiles
      WHERE user_id = NEW.organizer_user_id AND bde_verified = true
    )
  );
  NEW.is_bde := v_is_bde;

  -- Events portés par un organisateur (avec ou sans club partenaire).
  IF NEW.organizer_user_id IS NOT NULL THEN
    IF NEW.event_kind = 'private_event' THEN
      -- Privé : jamais découvrable.
      NEW.is_discoverable := false;

    ELSIF NEW.event_kind = 'public_event' THEN
      IF v_is_bde THEN
        -- ── Soirée BDE en visibilité publique ──────────────────────────────
        IF public.is_super_admin() THEN
          -- Modération super admin. La visibilité suit la décision de modération
          -- quand discovery_status change ; sinon on honore le toggle
          -- publier/dépublier (is_discoverable posé par la RPC admin).
          IF TG_OP = 'INSERT' OR NEW.discovery_status IS DISTINCT FROM OLD.discovery_status THEN
            NEW.is_discoverable := (NEW.discovery_status = 'approved');
          END IF;
        ELSE
          -- Contexte BDE lui-même (ou tout process serveur) : passer en public est
          -- une DEMANDE, jamais une auto-approbation. Une soirée déjà approuvée le
          -- reste à travers les éditions (pas de re-modération sur simple retouche).
          IF TG_OP = 'UPDATE' AND OLD.discovery_status = 'approved' THEN
            NEW.discovery_status := 'approved';
            NEW.is_discoverable  := true;
          ELSE
            NEW.discovery_status := 'pending';
            NEW.is_discoverable  := false;
          END IF;
        END IF;

      ELSE
        -- ── Organisateur standard : comportement inchangé (auto-approbation) ──
        IF NEW.visibility = 'public'
           AND NEW.poster_url IS NOT NULL
           AND LENGTH(COALESCE(NEW.title, '')) >= 5
           AND LENGTH(COALESCE(NEW.description, '')) >= 30
           AND NEW.start_at IS NOT NULL
           AND NEW.is_active = true
        THEN
          NEW.is_discoverable  := true;
          NEW.discovery_status := 'approved';
        ELSE
          NEW.is_discoverable := false;
        END IF;
      END IF;

    ELSE
      NEW.is_discoverable := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------
-- RPC admin : approuver / rejeter / remettre en attente une demande de publication
-- ---------------------------------------------------------------------
-- La RPC pose discovery_status ET is_discoverable ; le trigger (branche super
-- admin) re-dérive is_discoverable de façon cohérente. C'est le chemin canonique
-- de modération pour les soirées BDE (approuver = rendre public, rejeter = garder
-- privé). Le toggle publier/dépublier existant (admin_set_event_published) reste
-- pour les events standard.
CREATE OR REPLACE FUNCTION public.admin_set_event_discovery_status(
  _event_id uuid,
  _status   public.discovery_status,
  _reason   text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.events
  SET discovery_status = _status,
      is_discoverable  = (_status = 'approved')
  WHERE id = _event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', _event_id;
  END IF;

  PERFORM public.log_admin_action(
    'event_discovery_' || _status::text,
    'event', _event_id::text, jsonb_build_object('reason', _reason)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_event_discovery_status(uuid, public.discovery_status, text) TO authenticated;
