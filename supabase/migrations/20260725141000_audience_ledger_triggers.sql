-- ─────────────────────────────────────────────────────────────────────────────
-- Audience Intelligence — Phase 0 : capture (2/4) — les triggers de journalisation.
--
-- On journalise chaque follow/unfollow réel dans audience_follow_events. Deux
-- pièges de correctness, tous deux traités ici :
--
--   A. FAUX DÉPART via la dédup DJ. `favorites_dedupe_dj_person()` (BEFORE INSERT,
--      migration 20260717120000) SUPPRIME l'ancienne fiche quand on suit la MÊME
--      personne via un autre club. Au grain personne, c'est une opération NETTE
--      NULLE, mais un trigger naïf enregistrerait 1 départ (le DELETE de dédup)
--      + 1 arrivée (l'INSERT) = churn fantôme. Parade : la fonction de dédup pose
--      un drapeau de session `yuno.skip_follow_ledger` avant son DELETE, et NOS
--      triggers le respectent (départ ET arrivée neutralisés). Hypothèse assumée :
--      une mutation de favori = une transaction mono-ligne (vrai dans cette app),
--      donc le drapeau (SET LOCAL, portée transaction) ne fuit pas d'un tap à
--      l'autre.
--
--   B. GRAIN DJ. Un abonnement DJ vise la PERSONNE (djs.user_id), pas la fiche
--      par club (favorites.dj_id). On journalise donc subject_id = djs.user_id.
--
-- Note : les DELETE en cascade (suppression de compte / de profil organisateur)
-- passent par ces triggers et sont journalisés comme 'unfollow' — ce sont de
-- vraies pertes d'audience, le stock doit les refléter.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Coopération de la dédup DJ (drapeau anti-faux-départ) ──────────────────
-- Corps de dédup INCHANGÉ (on garde le plus ancien abonnement par personne) ; on
-- n'ajoute que : (a) un pré-check d'existence du doublon, (b) le drapeau de
-- session posé UNIQUEMENT quand un doublon existe, juste avant le DELETE.
CREATE OR REPLACE FUNCTION public.favorites_dedupe_dj_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person   uuid;
  v_has_dupe boolean;
BEGIN
  IF NEW.favorite_type IS DISTINCT FROM 'dj' OR NEW.dj_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = NEW.dj_id;
  IF v_person IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.favorites f
      JOIN public.djs d ON d.id = f.dj_id
     WHERE f.user_id = NEW.user_id
       AND f.favorite_type = 'dj'
       AND d.user_id = v_person
       AND f.dj_id IS DISTINCT FROM NEW.dj_id
  ) INTO v_has_dupe;

  IF v_has_dupe THEN
    -- Opération nette nulle au grain personne : neutraliser le journal pour le
    -- DELETE ci-dessous ET l'INSERT qui suit (les triggers plus bas lisent ce flag).
    PERFORM set_config('yuno.skip_follow_ledger', '1', true);

    DELETE FROM public.favorites f
    USING public.djs d
    WHERE f.dj_id = d.id
      AND f.user_id = NEW.user_id
      AND f.favorite_type = 'dj'
      AND d.user_id = v_person
      AND f.dj_id IS DISTINCT FROM NEW.dj_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Journal : arrivée sur favorites (club / dj) ────────────────────────────
CREATE OR REPLACE FUNCTION public.audience_log_favorite_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person uuid;
BEGIN
  IF current_setting('yuno.skip_follow_ledger', true) = '1' THEN
    RETURN NEW;                       -- no-op de dédup : ne rien journaliser
  END IF;

  IF NEW.favorite_type = 'club' AND NEW.venue_id IS NOT NULL THEN
    INSERT INTO public.audience_follow_events
      (subject_type, subject_id, follower_user_id, action, source)
      VALUES ('venue', NEW.venue_id, NEW.user_id, 'follow', 'trigger');

  ELSIF NEW.favorite_type = 'dj' AND NEW.dj_id IS NOT NULL THEN
    SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = NEW.dj_id;
    IF v_person IS NOT NULL THEN
      INSERT INTO public.audience_follow_events
        (subject_type, subject_id, follower_user_id, action, source)
        VALUES ('dj', v_person::text, NEW.user_id, 'follow', 'trigger');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Journal : départ sur favorites (club / dj) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.audience_log_favorite_unfollow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person uuid;
BEGIN
  IF current_setting('yuno.skip_follow_ledger', true) = '1' THEN
    RETURN OLD;                       -- DELETE de dédup : ne rien journaliser
  END IF;

  IF OLD.favorite_type = 'club' AND OLD.venue_id IS NOT NULL THEN
    INSERT INTO public.audience_follow_events
      (subject_type, subject_id, follower_user_id, action, source)
      VALUES ('venue', OLD.venue_id, OLD.user_id, 'unfollow', 'trigger');

  ELSIF OLD.favorite_type = 'dj' AND OLD.dj_id IS NOT NULL THEN
    SELECT d.user_id INTO v_person FROM public.djs d WHERE d.id = OLD.dj_id;
    IF v_person IS NOT NULL THEN
      INSERT INTO public.audience_follow_events
        (subject_type, subject_id, follower_user_id, action, source)
        VALUES ('dj', v_person::text, OLD.user_id, 'unfollow', 'trigger');
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

-- ── 4. Journal : abonnés organisateur (table dédiée, pas de dédup) ────────────
CREATE OR REPLACE FUNCTION public.audience_log_org_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source)
    VALUES ('organizer', NEW.organizer_user_id::text, NEW.user_id, 'follow', 'trigger');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audience_log_org_unfollow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audience_follow_events
    (subject_type, subject_id, follower_user_id, action, source)
    VALUES ('organizer', OLD.organizer_user_id::text, OLD.user_id, 'unfollow', 'trigger');
  RETURN OLD;
END;
$$;

-- ── 5. Câblage des triggers ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audience_favorite_follow_trg ON public.favorites;
CREATE TRIGGER audience_favorite_follow_trg
  AFTER INSERT ON public.favorites
  FOR EACH ROW EXECUTE FUNCTION public.audience_log_favorite_follow();

DROP TRIGGER IF EXISTS audience_favorite_unfollow_trg ON public.favorites;
CREATE TRIGGER audience_favorite_unfollow_trg
  AFTER DELETE ON public.favorites
  FOR EACH ROW EXECUTE FUNCTION public.audience_log_favorite_unfollow();

DROP TRIGGER IF EXISTS audience_org_follow_trg ON public.organizer_profile_followers;
CREATE TRIGGER audience_org_follow_trg
  AFTER INSERT ON public.organizer_profile_followers
  FOR EACH ROW EXECUTE FUNCTION public.audience_log_org_follow();

DROP TRIGGER IF EXISTS audience_org_unfollow_trg ON public.organizer_profile_followers;
CREATE TRIGGER audience_org_unfollow_trg
  AFTER DELETE ON public.organizer_profile_followers
  FOR EACH ROW EXECUTE FUNCTION public.audience_log_org_unfollow();
