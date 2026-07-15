-- ============================================================================
-- Audit (2026-07-15) — anti-bot signup public + intégrité FK.
--
-- 1) RATE-LIMIT create-guest-list-entry. L'endpoint est public (pas de JWT sur
--    le chemin invité) : une boucle scriptée peut saturer une liste de faux
--    emails. Le quota reste plafonné par le trigger atomique (impossible de
--    dépasser), donc le risque résiduel est le remplissage-poubelle. On ajoute
--    un throttle PAR IP+LISTE, volontairement GÉNÉREUX et FAIL-OPEN : il n'attrape
--    qu'un script en boucle serrée, PAS une foule légitime derrière le même NAT
--    (wifi du club). Défaut : 30 tentatives / 120 s (ajustable via l'edge function).
--
-- 2) FK MANQUANTES (intégrité). Ajoutées en NOT VALID : enforcées pour les
--    écritures futures, sans revalider l'existant (aucun risque d'échec de
--    migration sur d'éventuels orphelins hérités).
-- ============================================================================

-- ── 1. Throttle ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_list_signup_throttle (
  ip_hash text NOT NULL,
  guest_list_id uuid NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, guest_list_id)
);

-- RLS on, zéro policy → table invisible à anon/authenticated ; seul service_role
-- (les edge functions) y touche.
ALTER TABLE public.guest_list_signup_throttle ENABLE ROW LEVEL SECURITY;

-- Bump atomique + verdict. Renvoie true si l'inscription est autorisée.
-- Fail-open : ip_hash vide → toujours autorisé (on ne bloque jamais faute d'IP).
CREATE OR REPLACE FUNCTION public.bump_guest_signup_throttle(
  _ip_hash text,
  _guest_list_id uuid,
  _max integer,
  _window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
BEGIN
  IF _ip_hash IS NULL OR _ip_hash = '' THEN
    RETURN true;
  END IF;

  INSERT INTO public.guest_list_signup_throttle (ip_hash, guest_list_id, window_start, attempts)
  VALUES (_ip_hash, _guest_list_id, now(), 1)
  ON CONFLICT (ip_hash, guest_list_id) DO UPDATE
    SET attempts = CASE
          WHEN public.guest_list_signup_throttle.window_start < now() - make_interval(secs => _window_seconds)
          THEN 1
          ELSE public.guest_list_signup_throttle.attempts + 1
        END,
        window_start = CASE
          WHEN public.guest_list_signup_throttle.window_start < now() - make_interval(secs => _window_seconds)
          THEN now()
          ELSE public.guest_list_signup_throttle.window_start
        END
  RETURNING attempts INTO v_attempts;

  RETURN v_attempts <= _max;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bump_guest_signup_throttle(text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_guest_signup_throttle(text, uuid, integer, integer) TO service_role;

-- ── 2. FK manquantes (NOT VALID — forward-only) ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_list_entries_user_id_fkey') THEN
    ALTER TABLE public.guest_list_entries
      ADD CONSTRAINT guest_list_entries_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_list_entries_entry_scanned_by_fkey') THEN
    ALTER TABLE public.guest_list_entries
      ADD CONSTRAINT guest_list_entries_entry_scanned_by_fkey
      FOREIGN KEY (entry_scanned_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_lists_organizer_user_id_fkey') THEN
    ALTER TABLE public.guest_lists
      ADD CONSTRAINT guest_lists_organizer_user_id_fkey
      FOREIGN KEY (organizer_user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'guest_list_templates_organizer_user_id_fkey') THEN
    ALTER TABLE public.guest_list_templates
      ADD CONSTRAINT guest_list_templates_organizer_user_id_fkey
      FOREIGN KEY (organizer_user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
