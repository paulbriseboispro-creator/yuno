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
--   2. La décision de Yuno tient : « Dépublier » / « Rejeter » dans
--      /admin/events posent discovery_status = 'rejected', et l'organisateur ne
--      la lève plus en retouchant sa soirée. Avant, le trigger recalculait tout
--      depuis les critères de qualité : le bouton « Dépublier » du super admin
--      était SANS EFFET sur une soirée d'organisateur (il ne tenait que pour les
--      soirées BDE, par la branche de modération qu'on retire ici).
--   3. Une soirée d'un compte de DÉMO n'est jamais découvrable : ouvrir et
--      enregistrer une soirée démo dans le formulaire la passait en
--      'public_event' et l'envoyait dans l'Explore réel.
--   4. Emails de campagne offerts : 2 000 par mois pour une association
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
-- Corps repris de l'état LIVE (20260722180000). Différences : la branche
-- « soirée BDE publique = demande de modération » disparaît, et un refus du
-- super admin (discovery_status = 'rejected') s'impose aux critères de qualité.
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
    -- Une décision de Yuno (discovery_status = 'rejected') ne se lève que par
    -- le super admin. Vérifié AVANT le type de soirée : passer la soirée en
    -- privée puis de nouveau en publique ne doit pas la blanchir.
    IF TG_OP = 'UPDATE' AND OLD.discovery_status = 'rejected' AND NOT public.is_super_admin() THEN
      NEW.discovery_status := 'rejected';
    END IF;

    IF NEW.event_kind = 'private_event' THEN
      -- Privé : jamais découvrable.
      NEW.is_discoverable := false;

    ELSIF NEW.event_kind = 'public_event' THEN
      IF NEW.discovery_status = 'rejected' THEN
        -- Yuno a dépublié / refusé : rien ne la remet dans Explore.
        NEW.is_discoverable := false;
      ELSIF EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = NEW.organizer_user_id AND public.is_demo_email(p.email)
      ) THEN
        -- Compte de démo (@womber.fr…) : une soirée fictive n'atteint JAMAIS
        -- l'Explore des vrais clients, même enregistrée « publique » depuis le
        -- formulaire pendant une démo.
        NEW.is_discoverable := false;
      -- Auto-approbation sur critères de qualité. Description >= 30 caractères
      -- exigée UNIQUEMENT pour les soirées solo / hors plateforme
      -- (partner_venue_id NULL) : une soirée adossée à un club partenaire porte
      -- déjà le nom et l'adresse d'un lieu vérifié.
      ELSIF NEW.visibility = 'public'
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
        -- Plus de file de modération pour un organisateur : 'pending' n'a plus
        -- de sens ici (seul 'rejected', posé par Yuno, en garde un).
        IF NEW.discovery_status = 'pending' THEN
          NEW.discovery_status := 'approved';
        END IF;
      END IF;

    ELSE
      NEW.is_discoverable := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Les demandes de publication encore en attente (ancien circuit BDE) sortent
-- de la file de modération et sont réévaluées sur les critères communs par le
-- trigger ('approved' + is_discoverable selon la qualité, l'état normal d'une
-- soirée d'organisateur).
UPDATE public.events
   SET discovery_status = 'approved'
 WHERE is_bde = true
   AND event_kind = 'public_event'
   AND discovery_status = 'pending';

-- « Dépublier » / « Republier » (/admin/events) : sur une soirée
-- d'organisateur, la décision passe par discovery_status pour survivre aux
-- retouches (voir le trigger). Une soirée de club garde le comportement
-- d'avant : le trigger ne la recalcule pas, is_discoverable suffit.
CREATE OR REPLACE FUNCTION public.admin_set_event_published(_event_id uuid, _published boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.events
  SET discovery_status = CASE
        WHEN organizer_user_id IS NULL THEN discovery_status
        WHEN _published THEN 'approved'::discovery_status
        ELSE 'rejected'::discovery_status
      END,
      is_discoverable = _published
  WHERE id = _event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', _event_id;
  END IF;

  PERFORM public.log_admin_action(
    CASE WHEN _published THEN 'event_published' ELSE 'event_depublished' END,
    'event', _event_id::text, '{}'::jsonb
  );
END;
$function$;

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
  IF p_scope_key ~ '^org:[0-9a-fA-F-]{36}$' THEN
    v_org := substr(p_scope_key, 5);
    IF EXISTS (
      SELECT 1 FROM public.organizer_profiles
       WHERE user_id = v_org::uuid AND bde_verified = true
    ) THEN
      RETURN 2000;                        -- offert par compte association
    END IF;
  END IF;
  RETURN 15000;                           -- offert par compte pro
END;
$function$;

-- ── 3. Les soirées démo déjà découvrables sortent d'Explore tout de suite ────
-- (le trigger ne les aurait retirées qu'à leur prochaine modification).
UPDATE public.events e
   SET is_discoverable = false
  FROM public.profiles p
 WHERE p.id = e.organizer_user_id
   AND public.is_demo_email(p.email)
   AND e.is_discoverable;

-- ── 4. Poser / retirer le statut Association restampe les soirées À VENIR ───
-- events.is_bde n'était recalculé qu'à la prochaine édition de chaque soirée :
-- une association vérifiée payait encore le plancher de 0,99 € sur ses soirées
-- déjà créées. Les soirées passées gardent le tarif sous lequel elles ont vendu.
CREATE OR REPLACE FUNCTION public.admin_set_organizer_bde_verified(
  p_organizer_user_id uuid,
  p_verified          boolean,
  p_reason            text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  UPDATE public.organizer_profiles
  SET bde_verified    = p_verified,
      bde_verified_at = CASE WHEN p_verified THEN now() ELSE NULL END
  WHERE user_id = p_organizer_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizer not found: %', p_organizer_user_id;
  END IF;

  -- No-op qui relance evaluate_event_discoverability (stamp de is_bde).
  UPDATE public.events
     SET is_bde = is_bde
   WHERE organizer_user_id = p_organizer_user_id
     AND COALESCE(end_at, start_at) > now()
     AND is_bde IS DISTINCT FROM p_verified;

  PERFORM public.log_admin_action(
    CASE WHEN p_verified THEN 'organizer_bde_verified' ELSE 'organizer_bde_unverified' END,
    'organizer', p_organizer_user_id::text, jsonb_build_object('reason', p_reason)
  );
END;
$$;
