-- ============================================================================
-- Audit guest list (2026-07-15) — durcissement RLS + capacité.
--
-- Quatre corrections, toutes sur le système guest list :
--
--  1. RÉGRESSION SCAN PORTE (introduite le 2026-07-04). La migration
--     20260704120000 a remplacé la policy SELECT `USING(true)` de guest_lists
--     par 5 policies scopées qui NE couvrent NI le staff de venue (bouncer),
--     NI les propriétaires/organisateurs partenaires d'une co-soirée. Or les
--     policies de guest_list_entries (lecture + scan) valident l'accès via un
--     `EXISTS (SELECT 1 FROM guest_lists gl …)` — sous-requête elle-même
--     soumise au RLS de guest_lists. Résultat : pour une liste
--     `visible_on_club_page = false`, un bouncer ou un partenaire ne voit plus
--     la ligne mère → le sous-EXISTS échoue en SILENCE → il ne peut ni lire ni
--     scanner l'invité par le chemin online (PostgREST direct de Bouncer.tsx).
--     Le chemin offline (get_event_scan_manifest, SECURITY DEFINER) n'était pas
--     touché, ce qui a masqué le trou. FIX : rendre la ligne guest_lists
--     visible au staff et aux partenaires, comme tickets/table_reservations.
--
--  2. POLICY DUPLIQUÉE : « Public can view publicly listed guest lists »
--     (20260503) et « Public can view visible active guest lists » (20260704)
--     ont un USING strictement identique. On retire la première.
--
--  3. WITH CHECK TROP LARGE sur « Organizers manage own guest lists » :
--     `WITH CHECK (organizer_user_id = auth.uid())` ne valide PAS l'event_id.
--     N'importe quel utilisateur authentifié pouvait donc INSÉRER une part
--     guest_lists rattachée à la soirée d'un AUTRE club/organisateur (en se
--     mettant en organizer_user_id), la rendre publique et collecter des
--     inscriptions (PII) sur un event qui n'est pas le sien. FIX : exiger que
--     l'appelant soit bien un organisateur légitime de l'event (helper
--     is_event_partner_organizer, qui couvre organizer_user_id /
--     partner_organizer_id / membre d'équipe org 'editor').
--
--  4. QUOTAS CONTOURNABLES (deux chemins) :
--     (a) UPDATE de entry_type sans changement de status : le trigger de
--         capacité ne se déclenchait que sur `UPDATE OF status` → un promoteur
--         pouvait inscrire N invités « normal » puis les repasser en
--         « table »/« drink » un par un pour exploser son allocation VIP.
--     (b) Variantes de casse du genre ('F', 'femme', 'M', 'homme') : le trigger
--         comparait `NEW.gender = 'female'` en exact → une entrée 'F' échappait
--         au quota genré ET n'était pas comptée. FIX : le trigger se déclenche
--         aussi sur entry_type/gender, re-vérifie la dimension qui change, et
--         normalise le genre comme get_guest_list_public_fill.
--
-- Les messages d'erreur du trigger restent MOT POUR MOT identiques
-- (« Guest list is full », « Female/Male quota reached ») : le front et les
-- edge functions matchent sur ces chaînes.
-- ============================================================================

-- ── 1. Visibilité guest_lists pour le staff et les partenaires de co-soirée ──
DROP POLICY IF EXISTS "Venue staff can view their venue guest lists" ON public.guest_lists;
CREATE POLICY "Venue staff can view their venue guest lists"
ON public.guest_lists FOR SELECT TO authenticated
USING (public.is_venue_staff(auth.uid(), venue_id));

DROP POLICY IF EXISTS "Partner venue owner can view co-event guest lists" ON public.guest_lists;
CREATE POLICY "Partner venue owner can view co-event guest lists"
ON public.guest_lists FOR SELECT TO authenticated
USING (event_id IS NOT NULL AND public.is_event_partner_venue_owner(auth.uid(), event_id));

DROP POLICY IF EXISTS "Partner organizer can view co-event guest lists" ON public.guest_lists;
CREATE POLICY "Partner organizer can view co-event guest lists"
ON public.guest_lists FOR SELECT TO authenticated
USING (event_id IS NOT NULL AND public.is_event_partner_organizer(auth.uid(), event_id));

-- ── 2. Nettoyage de la policy SELECT dupliquée ──
DROP POLICY IF EXISTS "Public can view publicly listed guest lists" ON public.guest_lists;

-- ── 3. Resserrer le WITH CHECK organizer (interdire l'attache à un event tiers) ──
DROP POLICY IF EXISTS "Organizers manage own guest lists" ON public.guest_lists;
CREATE POLICY "Organizers manage own guest lists"
ON public.guest_lists
FOR ALL
USING (organizer_user_id = auth.uid())
WITH CHECK (
  organizer_user_id = auth.uid()
  AND event_id IS NOT NULL
  AND public.is_event_partner_organizer(auth.uid(), event_id)
);

-- ── 4. Trigger de capacité durci ──
CREATE OR REPLACE FUNCTION public.enforce_guest_list_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gl RECORD;
  v_count integer;
  v_entry_type text;
  v_type_quota integer;
  v_new_gender text;
  v_old_gender text;
  v_is_new_consumption boolean;
  v_type_changed boolean;
  v_gender_changed boolean;
BEGIN
  -- Une entrée annulée ne consomme pas de place.
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Normalise le genre EXACTEMENT comme get_guest_list_public_fill : 'F'/'femme'
  -- et 'M'/'homme' ne peuvent plus échapper aux quotas genrés ni fausser le compte.
  v_new_gender := CASE
    WHEN lower(btrim(coalesce(NEW.gender, ''))) IN ('female', 'f', 'femme') THEN 'female'
    WHEN lower(btrim(coalesce(NEW.gender, ''))) IN ('male', 'm', 'homme')   THEN 'male'
    ELSE NULL
  END;

  -- Une place est NEUVELLEMENT consommée à l'INSERT et à la résurrection
  -- (cancelled → actif). Un simple changement de champ sur une entrée déjà
  -- active ne re-consomme pas le quota total.
  v_is_new_consumption := (TG_OP = 'INSERT')
    OR (TG_OP = 'UPDATE' AND OLD.status = 'cancelled');

  IF TG_OP = 'UPDATE' AND NOT v_is_new_consumption THEN
    -- Entrée active qui reste active : on ne re-vérifie QUE la dimension modifiée.
    v_old_gender := CASE
      WHEN lower(btrim(coalesce(OLD.gender, ''))) IN ('female', 'f', 'femme') THEN 'female'
      WHEN lower(btrim(coalesce(OLD.gender, ''))) IN ('male', 'm', 'homme')   THEN 'male'
      ELSE NULL
    END;
    v_type_changed   := coalesce(NEW.entry_type, 'normal') IS DISTINCT FROM coalesce(OLD.entry_type, 'normal');
    v_gender_changed := v_new_gender IS DISTINCT FROM v_old_gender;
    -- Rien de pertinent pour les quotas n'a bougé (ex. édition nom/email, scan) → laisser passer.
    IF NOT v_type_changed AND NOT v_gender_changed THEN
      RETURN NEW;
    END IF;
  ELSE
    v_type_changed := true;
    v_gender_changed := true;
  END IF;

  -- Sérialise toutes les admissions de cette liste : verrou sur la ligne mère.
  SELECT id, quota, quota_female, quota_male, quota_normal, quota_drink, quota_table
    INTO gl
    FROM public.guest_lists
   WHERE id = NEW.guest_list_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest list not found';
  END IF;

  -- Quota total : seulement quand une place est NEUVELLEMENT consommée.
  IF v_is_new_consumption AND gl.quota IS NOT NULL AND gl.quota > 0 THEN
    SELECT count(*) INTO v_count
      FROM public.guest_list_entries
     WHERE guest_list_id = NEW.guest_list_id
       AND status <> 'cancelled'
       AND id <> NEW.id;
    IF v_count >= gl.quota THEN
      RAISE EXCEPTION 'Guest list is full';
    END IF;
  END IF;

  -- Quota par type (0 = non contraint). Re-vérifié à la consommation neuve
  -- OU dès que entry_type change (ferme le contournement normal→table).
  IF v_type_changed THEN
    v_entry_type := COALESCE(NEW.entry_type, 'normal');
    v_type_quota := CASE v_entry_type
      WHEN 'drink' THEN COALESCE(gl.quota_drink, 0)
      WHEN 'table' THEN COALESCE(gl.quota_table, 0)
      ELSE COALESCE(gl.quota_normal, 0)
    END;
    IF v_type_quota > 0 THEN
      SELECT count(*) INTO v_count
        FROM public.guest_list_entries
       WHERE guest_list_id = NEW.guest_list_id
         AND COALESCE(entry_type, 'normal') = v_entry_type
         AND status <> 'cancelled'
         AND id <> NEW.id;
      IF v_count >= v_type_quota THEN
        RAISE EXCEPTION 'Guest list is full';
      END IF;
    END IF;
  END IF;

  -- Quotas par genre (comptés sur le genre NORMALISÉ). Re-vérifiés à la
  -- consommation neuve OU dès que le genre change.
  IF v_gender_changed THEN
    IF v_new_gender = 'female' AND COALESCE(gl.quota_female, 0) > 0 THEN
      SELECT count(*) INTO v_count
        FROM public.guest_list_entries
       WHERE guest_list_id = NEW.guest_list_id
         AND lower(btrim(coalesce(gender, ''))) IN ('female', 'f', 'femme')
         AND status <> 'cancelled'
         AND id <> NEW.id;
      IF v_count >= gl.quota_female THEN
        RAISE EXCEPTION 'Female quota reached';
      END IF;
    END IF;

    IF v_new_gender = 'male' AND COALESCE(gl.quota_male, 0) > 0 THEN
      SELECT count(*) INTO v_count
        FROM public.guest_list_entries
       WHERE guest_list_id = NEW.guest_list_id
         AND lower(btrim(coalesce(gender, ''))) IN ('male', 'm', 'homme')
         AND status <> 'cancelled'
         AND id <> NEW.id;
      IF v_count >= gl.quota_male THEN
        RAISE EXCEPTION 'Male quota reached';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_guest_list_capacity ON public.guest_list_entries;
CREATE TRIGGER trg_enforce_guest_list_capacity
  BEFORE INSERT OR UPDATE OF status, entry_type, gender ON public.guest_list_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_guest_list_capacity();
