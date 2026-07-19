-- ============================================================================
-- Refonte système promoteurs — 3 correctifs structurels.
--
-- 1. VISIBILITÉ DES SOIRÉES. Le dashboard promoteur lit `events` sous la session
--    du promoteur (RLS), mais aucune policy ne couvrait ce rôle : une soirée
--    active non "discoverable/approved" était invisible → « Mes Événements »
--    vide alors que le linktree public (service-role) la montrait. On ajoute
--    une policy SELECT dédiée, partner_venue_id inclus (co-events).
--
-- 2. AUTO-ASSIGNATION. Un promoteur peut être marqué auto_assign_events :
--    chaque nouvelle soirée de son club / organisateur (récurrentes incluses —
--    les crons de génération insèrent dans events, donc le trigger les couvre)
--    crée automatiquement son promoter_event_assignments.
--
-- 3. UNICITÉ DU PROMO_CODE ENTRE PERSONNES. Le code n'était unique que par
--    (venue) ou (organizer) : deux personnes homonymes dans deux clubs
--    différents partageaient /promoteur/CODE et le résolveur public prenait
--    la première ligne arbitraire. Un même user garde le même code sur tous
--    ses clubs (multi-club voulu) ; deux users différents ne peuvent plus
--    partager un code (insensible à la casse).
-- ============================================================================

-- ── 1. Policy SELECT pour les promoteurs ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_promoter_for_event(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.promoters p
    JOIN public.events e ON e.id = _event_id
    WHERE p.user_id = _user_id
      AND p.is_active
      AND (
        (p.venue_id IS NOT NULL
          AND (p.venue_id = e.venue_id OR p.venue_id = e.partner_venue_id))
        OR
        (p.organizer_user_id IS NOT NULL
          AND (p.organizer_user_id = e.organizer_user_id
            OR p.organizer_user_id = e.partner_organizer_id))
      )
  );
$$;

DROP POLICY IF EXISTS "Promoters can view their scope events" ON public.events;
CREATE POLICY "Promoters can view their scope events"
ON public.events
FOR SELECT
TO authenticated
USING (public.is_promoter_for_event(auth.uid(), id));

-- ── 2. Auto-assignation aux nouvelles soirées ───────────────────────────────

ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS auto_assign_events boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.auto_assign_promoters_to_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guestlist/tables ouverts par défaut : sans assignation, le fallback
  -- "Smart Mixed" donnait déjà les deux accès — l'auto-assignation ne doit
  -- pas être une régression de droits.
  INSERT INTO public.promoter_event_assignments
    (promoter_id, event_id, commission_template_id, status, can_access_guestlist, can_access_tables)
  SELECT p.id, NEW.id, p.default_commission_template_id, 'active', true, true
  FROM public.promoters p
  WHERE p.is_active
    AND p.auto_assign_events
    AND (
      (p.venue_id IS NOT NULL
        AND (p.venue_id = NEW.venue_id OR p.venue_id = NEW.partner_venue_id))
      OR
      (p.organizer_user_id IS NOT NULL
        AND (p.organizer_user_id = NEW.organizer_user_id
          OR p.organizer_user_id = NEW.partner_organizer_id))
    )
  ON CONFLICT (promoter_id, event_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_promoters_insert ON public.events;
CREATE TRIGGER trg_auto_assign_promoters_insert
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_promoters_to_event();

-- Un partenaire ajouté après coup (collab signée en cours de route) doit aussi
-- déclencher l'assignation des promoteurs du partenaire.
DROP TRIGGER IF EXISTS trg_auto_assign_promoters_partner ON public.events;
CREATE TRIGGER trg_auto_assign_promoters_partner
  AFTER UPDATE OF partner_venue_id, partner_organizer_id ON public.events
  FOR EACH ROW
  WHEN (
    NEW.partner_venue_id IS DISTINCT FROM OLD.partner_venue_id
    OR NEW.partner_organizer_id IS DISTINCT FROM OLD.partner_organizer_id
  )
  EXECUTE FUNCTION public.auto_assign_promoters_to_event();

-- ── 3. promo_code : un code = une personne ──────────────────────────────────

-- Dédoublonnage préalable : pour chaque code partagé par plusieurs users, le
-- plus ancien (min created_at) le garde ; les autres reçoivent CODE2, CODE3…
-- (toutes leurs lignes multi-clubs sont renommées ensemble, le code reste
-- cohérent pour la personne).
DO $$
DECLARE
  v_code text;
  v_user uuid;
  v_rank int;
  v_suffix int;
  v_new text;
BEGIN
  FOR v_code IN
    SELECT lower(promo_code)
    FROM public.promoters
    WHERE promo_code IS NOT NULL
    GROUP BY lower(promo_code)
    HAVING count(DISTINCT user_id) > 1
  LOOP
    v_rank := 0;
    FOR v_user IN
      SELECT user_id
      FROM public.promoters
      WHERE lower(promo_code) = v_code
      GROUP BY user_id
      ORDER BY min(created_at)
    LOOP
      v_rank := v_rank + 1;
      IF v_rank = 1 THEN
        CONTINUE; -- le plus ancien garde le code
      END IF;
      v_suffix := v_rank;
      LOOP
        v_new := v_code || v_suffix::text;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.promoters WHERE lower(promo_code) = lower(v_new)
        );
        v_suffix := v_suffix + 1;
      END LOOP;
      UPDATE public.promoters
      SET promo_code = upper(v_new)
      WHERE user_id = v_user
        AND lower(promo_code) = v_code;
    END LOOP;
  END LOOP;
END $$;

-- Garde-fou : un code (insensible à la casse) ne peut appartenir qu'à un seul
-- user. Le même user peut le réutiliser sur plusieurs clubs/organisateurs.
-- ERRCODE 23505 pour que le front affiche son message « code déjà pris ».
CREATE OR REPLACE FUNCTION public.enforce_promo_code_single_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.promo_code IS NULL THEN
    RETURN NEW;
  END IF;
  -- Sérialise les prises de code concurrentes sur le même code.
  PERFORM pg_advisory_xact_lock(hashtext('promo_code:' || lower(NEW.promo_code)));
  IF EXISTS (
    SELECT 1 FROM public.promoters p
    WHERE lower(p.promo_code) = lower(NEW.promo_code)
      AND p.user_id <> NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Promo code % is already taken by another promoter', NEW.promo_code
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promo_code_single_owner ON public.promoters;
CREATE TRIGGER trg_promo_code_single_owner
  BEFORE INSERT OR UPDATE OF promo_code, user_id ON public.promoters
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_promo_code_single_owner();
