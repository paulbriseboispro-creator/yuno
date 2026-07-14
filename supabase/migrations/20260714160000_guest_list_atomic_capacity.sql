-- ============================================================================
-- Guest list : capacité ATOMIQUE au niveau base (soirées à forte affluence).
--
-- TROU corrigé : le quota était vérifié en applicatif (count() PUIS insert(),
-- sans transaction ni verrou) dans create-guest-list-entry et
-- promoter-add-guest. Sous forte concurrence (1000 personnes sur le même lien
-- dans la même minute), N requêtes passent toutes le `count < quota` puis
-- insèrent → sur-remplissage garanti. Les billets ont reserve_ticket_capacity
-- (FOR UPDATE) ; la guest list n'avait AUCUN équivalent. De plus, la policy
-- INSERT de guest_list_entries est WITH CHECK (true) : un appel PostgREST
-- direct contournait entièrement les quotas.
--
-- FIX : trigger BEFORE INSERT (et BEFORE UPDATE de résurrection
-- cancelled → actif) qui verrouille la ligne guest_lists parente (FOR UPDATE)
-- et re-compte SOUS verrou : quota total, quota par type (normal/drink/table,
-- même sémantique que l'edge function : appliqué seulement si > 0), quotas
-- par genre. Les inscriptions d'une même liste se sérialisent sur le verrou
-- de ligne (quelques ms), ce qui rend le dépassement impossible quel que soit
-- le chemin d'écriture (edge function, PostgREST, SQL).
--
-- Les messages d'erreur reprennent MOT POUR MOT ceux des edge functions
-- (« Guest list is full », « Female/Male quota reached ») : le front matche
-- sur ces chaînes (GuestListSignup.tsx → toasts guestList.full/quotaReached).
--
-- BONUS anti-doublon : index unique (guest_list_id, lower(email)) hors
-- entrées annulées — la dédup email était un SELECT-puis-INSERT racy.
-- Vérifié en prod le 2026-07-14 : zéro doublon existant, l'index passe.
-- ============================================================================

-- Index de support pour les counts sous verrou (et les compteurs publics).
CREATE INDEX IF NOT EXISTS idx_guest_list_entries_list_status
  ON public.guest_list_entries (guest_list_id, status);

-- Anti-doublon email par liste (les annulées peuvent se réinscrire).
CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_list_entries_list_email
  ON public.guest_list_entries (guest_list_id, lower(email))
  WHERE email IS NOT NULL AND status <> 'cancelled';

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
BEGIN
  -- Une entrée annulée ne consomme pas de place.
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- En UPDATE, seule la résurrection cancelled → actif re-consomme une place.
  IF TG_OP = 'UPDATE' AND OLD.status <> 'cancelled' THEN
    RETURN NEW;
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

  -- Quota total.
  IF gl.quota IS NOT NULL AND gl.quota > 0 THEN
    SELECT count(*) INTO v_count
      FROM public.guest_list_entries
     WHERE guest_list_id = NEW.guest_list_id
       AND status <> 'cancelled'
       AND id <> NEW.id;
    IF v_count >= gl.quota THEN
      RAISE EXCEPTION 'Guest list is full';
    END IF;
  END IF;

  -- Quota par type (même règle que l'edge function : 0 = non contraint).
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

  -- Quotas par genre.
  IF NEW.gender = 'female' AND COALESCE(gl.quota_female, 0) > 0 THEN
    SELECT count(*) INTO v_count
      FROM public.guest_list_entries
     WHERE guest_list_id = NEW.guest_list_id
       AND gender = 'female'
       AND status <> 'cancelled'
       AND id <> NEW.id;
    IF v_count >= gl.quota_female THEN
      RAISE EXCEPTION 'Female quota reached';
    END IF;
  END IF;

  IF NEW.gender = 'male' AND COALESCE(gl.quota_male, 0) > 0 THEN
    SELECT count(*) INTO v_count
      FROM public.guest_list_entries
     WHERE guest_list_id = NEW.guest_list_id
       AND gender = 'male'
       AND status <> 'cancelled'
       AND id <> NEW.id;
    IF v_count >= gl.quota_male THEN
      RAISE EXCEPTION 'Male quota reached';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_guest_list_capacity ON public.guest_list_entries;
CREATE TRIGGER trg_enforce_guest_list_capacity
  BEFORE INSERT OR UPDATE OF status ON public.guest_list_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_guest_list_capacity();
