-- =====================================================================
-- Compte « Association » (ex-« BDE ») — une orga à part entière
-- =====================================================================
-- Le drapeau `organizer_profiles.bde_verified` (posé par un super admin) ne
-- désigne plus seulement un Bureau des étudiants : il désigne toute
-- ASSOCIATION (loi 1901) — BDE, association culturelle, collectif associatif.
-- Les noms techniques (`bde_verified`, `events.is_bde`) restent : ils sont lus
-- par les edge functions de paiement et par les bundles déjà publiés.
--
-- Ce qui change :
--   1. Une association choisit SEULE entre soirée publique et privée. Passer en
--      public n'est plus une demande soumise au super admin : une association
--      qui vend des billets pour une soirée dans un club hors Yuno doit
--      apparaître dans Explore comme n'importe quel organisateur, sur les
--      mêmes critères de qualité (affiche, titre, description, date).
--   2. Emails de campagne offerts : 2 000 par mois pour une association
--      (15 000 pour un compte pro standard). La surcharge
--      `email_sender_state.monthly_cap_override` gagne toujours.
--
-- Ce qui ne change pas : le plancher de commission réduit (0,49 €) reste
-- porté par `events.is_bde`, stampé ici même de façon autoritaire.

COMMENT ON COLUMN public.organizer_profiles.bde_verified IS
  'Compte ASSOCIATION (loi 1901 : BDE, asso culturelle…) validé par un super admin. Plancher de commission réduit (0,49 €) et 2 000 emails de campagne offerts par mois. Nom de colonne historique (« BDE »).';

COMMENT ON COLUMN public.events.is_bde IS
  'Soirée portée par une ASSOCIATION vérifiée (organizer_profiles.bde_verified). Stampé par evaluate_event_discoverability, jamais par le client. Sert au plancher de commission réduit.';

-- ── 1. Visibilité : l'association suit la règle de tout organisateur ────────
-- Corps repris de l'état LIVE (20260722180000) ; seule différence : la branche
-- « soirée BDE publique = demande de modération » disparaît.
CREATE OR REPLACE FUNCTION public.evaluate_event_discoverability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- (1) Stamp autoritaire : un event est « association » ssi son organisateur
  -- est bde_verified. Calculé ici (jamais lu depuis NEW tel quel) pour que le
  -- tarif s'appuie sur events.is_bde comme signal infalsifiable.
  NEW.is_bde := (
    NEW.organizer_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organizer_profiles
      WHERE user_id = NEW.organizer_user_id AND bde_verified = true
    )
  );

  -- Events portés par un organisateur (avec ou sans club partenaire),
  -- association comprise.
  IF NEW.organizer_user_id IS NOT NULL THEN
    IF NEW.event_kind = 'private_event' THEN
      -- Privé : jamais découvrable.
      NEW.is_discoverable := false;

    ELSIF NEW.event_kind = 'public_event' THEN
      -- Auto-approbation sur critères de qualité. Description >= 30 caractères
      -- exigée UNIQUEMENT pour les soirées solo / hors plateforme
      -- (partner_venue_id NULL) : une soirée adossée à un club partenaire porte
      -- déjà le nom et l'adresse d'un lieu vérifié.
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

    ELSE
      NEW.is_discoverable := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Les demandes de publication encore en attente (ancien circuit BDE) sont
-- réévaluées sur les critères communs : un UPDATE no-op relance le trigger.
UPDATE public.events
   SET is_active = is_active
 WHERE is_bde = true
   AND event_kind = 'public_event'
   AND discovery_status = 'pending';

-- ── 2. Emails offerts : 2 000 / mois pour une association ───────────────────
-- Corps repris de l'état LIVE (20260908210000). La clé d'une portée
-- organisateur est 'org:<uuid>' ; un suffixe qui n'est pas un uuid ne matche
-- rien (jamais de cast qui lèverait).
CREATE OR REPLACE FUNCTION public.email_sender_monthly_free(p_scope_key text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_override integer;
  v_org text;
BEGIN
  SELECT monthly_cap_override INTO v_override
    FROM public.email_sender_state WHERE scope_key = p_scope_key;
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v_override, 40000);   -- pool marketing (plan 50k − réserve 10k)
  END IF;
  IF p_scope_key = 'yuno' THEN
    -- Le marketing de Yuno n'a pas de forfait « offert » à lui : il puise dans
    -- le pool plateforme, déjà plafonné à l'étage 1.
    RETURN COALESCE(v_override, 40000);
  END IF;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;
  IF p_scope_key LIKE 'org:%' THEN
    v_org := substr(p_scope_key, 5);
    IF EXISTS (
      SELECT 1 FROM public.organizer_profiles
       WHERE user_id::text = v_org AND bde_verified = true
    ) THEN
      RETURN 2000;                        -- offert par compte association
    END IF;
  END IF;
  RETURN 15000;                           -- offert par compte pro
END;
$function$;
