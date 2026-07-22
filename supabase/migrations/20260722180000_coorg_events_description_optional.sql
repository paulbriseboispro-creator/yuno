-- =====================================================================
-- Soirées co-organisées — description optionnelle pour la découverte publique
-- =====================================================================
-- Règle métier : la barre qualité qui gate la découvrabilité d'un event standard
-- (affiche + description >= 30 caractères) existe pour éviter que des soirées
-- solo / hors plateforme atterrissent vides dans Explore. Une soirée adossée à un
-- club partenaire (co-event, location de salle, hébergé par le club) porte déjà le
-- nom, l'adresse et la réputation d'un lieu vérifié : la description longue devient
-- superflue. On lève donc l'exigence de description pour tout event public dont
-- partner_venue_id est renseigné. L'affiche, le titre >= 5 et la date restent requis.
-- Les soirées solo/off-platform (partner_venue_id NULL) gardent EXACTEMENT le seuil
-- de 30 caractères. Les soirées BDE gardent leur modération super admin inchangée.

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
        -- ── Organisateur standard : auto-approbation sur critères de qualité ──
        -- Description >= 30 caractères exigée UNIQUEMENT pour les soirées solo /
        -- hors plateforme (partner_venue_id NULL). Une soirée co-organisée avec un
        -- club partenaire est adossée à un lieu vérifié : la description devient
        -- optionnelle pour apparaître dans Explore.
        IF NEW.visibility = 'public'
           AND NEW.poster_url IS NOT NULL
           AND LENGTH(COALESCE(NEW.title, '')) >= 5
           AND (
             NEW.partner_venue_id IS NOT NULL
             OR LENGTH(COALESCE(NEW.description, '')) >= 30
           )
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
