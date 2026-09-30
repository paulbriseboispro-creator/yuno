-- DJ sets : un artiste SANS compte Yuno au planning, son cachet suivi comme
-- dépense de la soirée, et le virement prêt au moment de payer.
--
-- Avant : un set exigeait une fiche `djs` (DJ inscrit sur Yuno). Un organisateur
-- ou un club qui programme un artiste invité du line-up (`event_guest_artists`,
-- sans compte) ne pouvait ni le mettre au calendrier ni suivre son cachet.
--
-- Règles :
--   • Un set = un DJ Yuno (`dj_id`) OU un artiste externe (`artist_name`, relié
--     s'il vient du line-up à `guest_artist_id`). Un artiste externe ne devient
--     JAMAIS une ligne `djs` (cf. CLAUDE.md, line-up à deux moitiés).
--   • Coordonnées de virement portées par le set (`payee_name`, `payee_iban`) :
--     pré-remplies depuis `dj_payout_details` pour un DJ Yuno (saisies par le DJ
--     dans « Mes paiements »), saisies à la main pour un externe. C'est une photo
--     prise au moment du booking : le virement montre ce qui a été convenu.
--   • `payment_method` dit comment le cachet a été réglé (virement, espèces, autre).
--   • Écritures d'argent (IBAN, « payé ») refusées en session d'accès assisté.
--   • Un DJ ne modifie plus sur SES sets que `show_on_profile` : la policy
--     `dj_sets_self_update_visibility` lui ouvrait toutes les colonnes (cachet,
--     « payé »…).
--   • L'équipe d'un organisateur (admin / éditeur) gère ses sets : la page DJ
--     leur était ouverte (`PATH_CAPABILITY` editEvents) mais la RLS refusait tout.

-- =============================================================================
-- 1. dj_sets : l'interprète peut être un artiste externe
-- =============================================================================
ALTER TABLE public.dj_sets ALTER COLUMN dj_id DROP NOT NULL;

ALTER TABLE public.dj_sets
  ADD COLUMN IF NOT EXISTS guest_artist_id uuid REFERENCES public.event_guest_artists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artist_name     text,
  ADD COLUMN IF NOT EXISTS payee_name      text,
  ADD COLUMN IF NOT EXISTS payee_iban      text,
  ADD COLUMN IF NOT EXISTS payment_method  text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dj_sets_performer_chk') THEN
    ALTER TABLE public.dj_sets ADD CONSTRAINT dj_sets_performer_chk
      CHECK (dj_id IS NOT NULL OR length(btrim(coalesce(artist_name, ''))) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dj_sets_payment_method_chk') THEN
    ALTER TABLE public.dj_sets ADD CONSTRAINT dj_sets_payment_method_chk
      CHECK (payment_method IS NULL OR payment_method IN ('transfer', 'cash', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dj_sets_payee_iban_chk') THEN
    ALTER TABLE public.dj_sets ADD CONSTRAINT dj_sets_payee_iban_chk
      CHECK (payee_iban IS NULL OR payee_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dj_sets_event_id ON public.dj_sets(event_id);
CREATE INDEX IF NOT EXISTS idx_dj_sets_guest_artist_id ON public.dj_sets(guest_artist_id) WHERE guest_artist_id IS NOT NULL;

-- Le lien suivi d'un DJ n'a de sens que pour un DJ Yuno.
CREATE OR REPLACE FUNCTION public.trg_seed_dj_set_tracked_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.event_id IS NOT NULL AND NEW.dj_id IS NOT NULL THEN
    PERFORM public.seed_dj_event_tracked_link(NEW.event_id, NEW.dj_id);
  END IF;
  RETURN NEW;
END; $$;

-- =============================================================================
-- 2. Porte de gestion d'une portée DJ (club ou organisateur)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.can_manage_dj_scope(_user_id uuid, _venue_id text, _organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    (_venue_id IS NOT NULL AND (
      public.is_venue_owner(_user_id, _venue_id)
      OR public.manager_has_permission(_user_id, _venue_id, 'djs')
    ))
    OR (_organizer_user_id IS NOT NULL AND (
      _organizer_user_id = _user_id
      OR public.is_org_team_member(_user_id, _organizer_user_id, 'editor')
    ))
  )
$$;
REVOKE ALL ON FUNCTION public.can_manage_dj_scope(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_dj_scope(uuid, text, uuid) TO authenticated;

-- L'équipe d'un organisateur gère ses sets (lecture, écriture).
DROP POLICY IF EXISTS "Org team manages dj_sets" ON public.dj_sets;
CREATE POLICY "Org team manages dj_sets"
ON public.dj_sets FOR ALL TO authenticated
USING (organizer_user_id IS NOT NULL AND public.is_org_team_member(auth.uid(), organizer_user_id, 'editor'))
WITH CHECK (organizer_user_id IS NOT NULL AND public.is_org_team_member(auth.uid(), organizer_user_id, 'editor'));

-- =============================================================================
-- 3. Garde d'écriture des sets (SECURITY INVOKER : elle discrimine sur la
--    session appelante, elle ne doit jamais s'exécuter sous son propriétaire)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guard_dj_set_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_money_changed boolean;
BEGIN
  -- Le DJ d'un set (hors gestionnaire de la portée) ne touche qu'à sa visibilité.
  -- Testé AVANT la normalisation, sur la ligne telle que le client l'envoie.
  IF TG_OP = 'UPDATE'
     AND current_user IN ('authenticated', 'anon')
     AND OLD.dj_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.djs d WHERE d.id = OLD.dj_id AND d.user_id = v_uid)
     AND NOT public.can_manage_dj_scope(v_uid, OLD.venue_id, OLD.organizer_user_id)
     AND (to_jsonb(NEW) - 'show_on_profile' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'show_on_profile' - 'updated_at')
  THEN
    RAISE EXCEPTION 'dj_set_self_update_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Normalisation : IBAN sans espaces en majuscules, noms rognés, vides = NULL.
  NEW.payee_iban  := nullif(upper(regexp_replace(coalesce(NEW.payee_iban, ''), '\s', '', 'g')), '');
  NEW.payee_name  := nullif(btrim(coalesce(NEW.payee_name, '')), '');
  NEW.artist_name := nullif(btrim(coalesce(NEW.artist_name, '')), '');
  IF NEW.dj_id IS NOT NULL THEN
    NEW.artist_name := NULL;
    NEW.guest_artist_id := NULL;
  END IF;
  IF NOT coalesce(NEW.fee_paid, false) THEN
    NEW.fee_paid_at := NULL;
    NEW.payment_method := NULL;
  ELSIF NEW.fee_paid_at IS NULL THEN
    NEW.fee_paid_at := now();
  END IF;

  -- Les services (service_role, postgres) passent.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_money_changed := NEW.payee_iban IS NOT NULL OR coalesce(NEW.fee_paid, false);
  ELSE
    v_money_changed := NEW.payee_iban IS DISTINCT FROM OLD.payee_iban
      OR NEW.payee_name IS DISTINCT FROM OLD.payee_name
      OR NEW.fee_paid IS DISTINCT FROM OLD.fee_paid
      OR NEW.payment_method IS DISTINCT FROM OLD.payment_method;
  END IF;

  IF v_money_changed AND public.is_support_session() THEN
    RAISE EXCEPTION 'support_session_forbidden: coordonnées et règlement d''un cachet non modifiables en mode support'
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_dj_set_write ON public.dj_sets;
CREATE TRIGGER guard_dj_set_write
  BEFORE INSERT OR UPDATE ON public.dj_sets
  FOR EACH ROW EXECUTE FUNCTION public.guard_dj_set_write();

-- =============================================================================
-- 4. Coordonnées de virement d'un DJ Yuno (une par personne, pas par fiche :
--    un DJ a une fiche `djs` par club / organisateur, un seul compte en banque)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_payout_details (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  holder_name text NOT NULL,
  iban        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dj_payout_details_holder_chk CHECK (length(btrim(holder_name)) BETWEEN 1 AND 120),
  CONSTRAINT dj_payout_details_iban_chk   CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$')
);

ALTER TABLE public.dj_payout_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "DJ manages own payout details" ON public.dj_payout_details;
CREATE POLICY "DJ manages own payout details"
ON public.dj_payout_details FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.normalize_dj_payout_details()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  NEW.iban := upper(regexp_replace(coalesce(NEW.iban, ''), '\s', '', 'g'));
  NEW.holder_name := btrim(coalesce(NEW.holder_name, ''));
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_normalize_dj_payout_details ON public.dj_payout_details;
CREATE TRIGGER trg_normalize_dj_payout_details
  BEFORE INSERT OR UPDATE ON public.dj_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.normalize_dj_payout_details();

DROP TRIGGER IF EXISTS trg_support_block_dj_payout_details ON public.dj_payout_details;
CREATE TRIGGER trg_support_block_dj_payout_details
  BEFORE INSERT OR UPDATE OR DELETE ON public.dj_payout_details
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- =============================================================================
-- 5. Pré-remplissage : l'IBAN d'un DJ Yuno n'est lisible que par une portée qui
--    travaille avec lui (DJ de son équipe, ou au line-up d'une de ses soirées).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_payout_prefill(p_dj_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dj_user uuid;
  v_row public.dj_payout_details%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR p_dj_id IS NULL THEN RETURN NULL; END IF;

  SELECT d.user_id INTO v_dj_user FROM public.djs d WHERE d.id = p_dj_id;
  IF v_dj_user IS NULL THEN RETURN NULL; END IF;

  IF NOT (
    EXISTS (
      SELECT 1 FROM public.djs d
       WHERE d.user_id = v_dj_user
         AND public.can_manage_dj_scope(v_uid, d.venue_id, d.organizer_user_id)
    )
    OR EXISTS (
      SELECT 1
        FROM public.event_djs ed
        JOIN public.djs d ON d.id = ed.dj_id AND d.user_id = v_dj_user
        JOIN public.events e ON e.id = ed.event_id
       WHERE public.can_manage_dj_scope(v_uid, e.venue_id, e.organizer_user_id)
    )
    OR EXISTS (
      SELECT 1
        FROM public.dj_sets s
        JOIN public.djs d ON d.id = s.dj_id AND d.user_id = v_dj_user
       WHERE public.can_manage_dj_scope(v_uid, s.venue_id, s.organizer_user_id)
    )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM public.dj_payout_details WHERE user_id = v_dj_user;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('holder_name', v_row.holder_name, 'iban', v_row.iban, 'updated_at', v_row.updated_at);
END;
$$;
REVOKE ALL ON FUNCTION public.get_dj_payout_prefill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dj_payout_prefill(uuid) TO authenticated;
