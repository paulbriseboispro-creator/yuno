-- =====================================================================
-- Guest list — trois canaux de distribution pour CHAQUE détenteur de part
-- (club / organisateur / DJ / promoteur / custom) :
--
--   1. LIEN PUBLIC GÉNÉRIQUE : le détenteur choisit les types d'entrée
--      proposés sur son lien (public_entry_types) — ex. normale + boisson,
--      ou juste normale. NULL = comportement historique (type primaire
--      résolu automatiquement, pas de choix côté guest).
--   2. AJOUT DIRECT nom/prénom/email : généralisé à tous les détenteurs via
--      l'edge function guest-list-manage (l'invité reçoit son QR par email).
--   3. LIEN UNIQUE PERSONNEL (guest_list_invites) : type imposé + nombre de
--      places max, consommé par create-guest-list-entry (?invite=<token>).
--
-- Autorisation unifiée : can_manage_guest_list_part() — le détenteur de la
-- part ET, pour les parts déléguées dj/promoter/custom, la partie qui les a
-- accordées (club owner/manager ou organisateur du scope). Une part
-- 'organizer' reste gérée par l'organisateur seul (le club fixe déjà ses
-- quotas via decide_guest_list_allocation_request).
-- =====================================================================

-- ── 1) Offre publique par type ───────────────────────────────────────────
ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS public_entry_types text[];

COMMENT ON COLUMN public.guest_lists.public_entry_types IS
  'Types d''entrée proposés sur le lien public de la part (sous-ensemble de normal/drink/table). NULL = historique : type primaire résolu automatiquement, aucun choix affiché.';

ALTER TABLE public.guest_lists
  DROP CONSTRAINT IF EXISTS guest_lists_public_entry_types_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_public_entry_types_check CHECK (
    public_entry_types IS NULL
    OR (
      array_length(public_entry_types, 1) BETWEEN 1 AND 3
      AND public_entry_types <@ ARRAY['normal','drink','table']
    )
  );

-- ── 2) Règle partagée : quels types une part PEUT offrir ─────────────────
-- club = les trois (c'est sa propre maison) ; part déléguée avec allocation
-- par type = les types à quota > 0 ; sinon = son entry_kind (une part « 20
-- places » sans ventilation ne peut pas inventer des boissons non accordées).
CREATE OR REPLACE FUNCTION public.guest_list_allowed_entry_types(_gl public.guest_lists)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _gl.holder_type = 'club' THEN ARRAY['normal','drink','table']
    WHEN (_gl.quota_normal + _gl.quota_drink + _gl.quota_table) > 0 THEN
      ARRAY(
        SELECT t FROM unnest(ARRAY['normal','drink','table']) AS t
        WHERE (t = 'normal' AND _gl.quota_normal > 0)
           OR (t = 'drink'  AND _gl.quota_drink  > 0)
           OR (t = 'table'  AND _gl.quota_table  > 0)
      )
    ELSE ARRAY[COALESCE(_gl.entry_kind, 'normal')]
  END
$$;

-- ── 3) Qui gère une part ? — source unique (RLS invites + RPCs + edge fn) ─
CREATE OR REPLACE FUNCTION public.can_manage_guest_list_part(_user_id uuid, _guest_list_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.guest_lists gl
    WHERE gl.id = _guest_list_id
      AND (
        -- Part maison : suit le domaine operations (même verrou que le trigger).
        (gl.holder_type = 'club'
         AND public.can_manage_event_guestlist_house(_user_id, gl.event_id))
        -- Part d'allocation organisateur : l'organisateur seul.
        OR (gl.holder_type = 'organizer' AND gl.organizer_user_id = _user_id)
        -- Parts déléguées : le détenteur…
        OR (gl.holder_type = 'dj' AND EXISTS (
              SELECT 1 FROM public.djs d
              WHERE d.id = gl.dj_id AND d.user_id = _user_id))
        OR (gl.holder_type = 'promoter' AND EXISTS (
              SELECT 1 FROM public.promoters p
              WHERE p.id = gl.promoter_id AND p.user_id = _user_id))
        -- …ET la partie qui a accordé la part (scope des colonnes), custom incluse.
        OR (gl.holder_type IN ('dj','promoter','custom') AND (
              (gl.venue_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.venues v
                 WHERE v.id = gl.venue_id
                   AND (v.owner_id = _user_id OR public.can_manage_venue(_user_id, v.id))))
              OR gl.organizer_user_id = _user_id))
        OR public.is_super_admin()
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_guest_list_part(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_guest_list_part(uuid, uuid) TO authenticated, service_role;

-- ── 4) Réglage de l'offre publique (DJ/promoteur n'ont pas d'UPDATE RLS) ──
CREATE OR REPLACE FUNCTION public.set_guest_list_public_types(p_guest_list_id uuid, p_types text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gl public.guest_lists;
  v_clean text[];
BEGIN
  SELECT * INTO v_gl FROM public.guest_lists WHERE id = p_guest_list_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest list not found';
  END IF;
  IF NOT public.can_manage_guest_list_part(auth.uid(), p_guest_list_id) THEN
    RAISE EXCEPTION 'Not allowed to manage this guest list';
  END IF;

  IF p_types IS NULL THEN
    v_clean := NULL;
  ELSE
    -- Dédoublonne et remet dans l'ordre canonique normal → drink → table.
    v_clean := ARRAY(
      SELECT t FROM unnest(ARRAY['normal','drink','table']) AS t
      WHERE t = ANY (p_types)
    );
    IF COALESCE(array_length(v_clean, 1), 0) = 0 THEN
      RAISE EXCEPTION 'At least one entry type is required';
    END IF;
    IF NOT (v_clean <@ public.guest_list_allowed_entry_types(v_gl)) THEN
      RAISE EXCEPTION 'Entry type not allowed by this allocation';
    END IF;
  END IF;

  UPDATE public.guest_lists SET public_entry_types = v_clean WHERE id = p_guest_list_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_guest_list_public_types(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_guest_list_public_types(uuid, text[]) TO authenticated;

-- ── 5) Liens uniques personnels ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_list_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_list_id uuid NOT NULL REFERENCES public.guest_lists(id) ON DELETE CASCADE,
  token         text UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  entry_type    text NOT NULL DEFAULT 'normal' CHECK (entry_type IN ('normal','drink','table')),
  -- Nombre de places que CE lien permet de prendre (ex. 2 pour « toi + 1 »).
  max_uses      integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
  used_count    integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  guest_name    text,
  guest_email   text,
  email_sent_at timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_list_invites_list
  ON public.guest_list_invites (guest_list_id);

ALTER TABLE public.guest_list_invites ENABLE ROW LEVEL SECURITY;

-- Le détenteur (et la partie qui a accordé la part) gèrent leurs liens.
-- La résolution publique passe par get_guest_list_invite (SECURITY DEFINER),
-- jamais par un SELECT direct — le token n'est pas énumérable.
DROP POLICY IF EXISTS "Holders manage their part invites" ON public.guest_list_invites;
CREATE POLICY "Holders manage their part invites"
ON public.guest_list_invites FOR ALL TO authenticated
USING (public.can_manage_guest_list_part(auth.uid(), guest_list_id))
WITH CHECK (public.can_manage_guest_list_part(auth.uid(), guest_list_id));

-- Type du lien ⊆ types que la part peut offrir (même règle que l'offre publique).
CREATE OR REPLACE FUNCTION public.validate_guest_list_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gl public.guest_lists;
BEGIN
  SELECT * INTO v_gl FROM public.guest_lists WHERE id = NEW.guest_list_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest list not found';
  END IF;
  IF NOT (NEW.entry_type = ANY (public.guest_list_allowed_entry_types(v_gl))) THEN
    RAISE EXCEPTION 'Entry type not allowed by this allocation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_guest_list_invite ON public.guest_list_invites;
CREATE TRIGGER trg_validate_guest_list_invite
  BEFORE INSERT OR UPDATE OF entry_type, guest_list_id ON public.guest_list_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_guest_list_invite();

-- Trace du canal sur l'entrée (et support du comptage/compensation).
ALTER TABLE public.guest_list_entries
  ADD COLUMN IF NOT EXISTS invite_id uuid REFERENCES public.guest_list_invites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_list_entries_invite
  ON public.guest_list_entries (invite_id) WHERE invite_id IS NOT NULL;

-- ── 6) Résolution publique d'un lien unique (page d'inscription) ─────────
-- Ne renvoie JAMAIS share_token : un invité limité à N places ne doit pas
-- récupérer le lien public générique de la part par la petite porte.
CREATE OR REPLACE FUNCTION public.get_guest_list_invite(_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'invite', jsonb_build_object(
      'id',         i.id,
      'entry_type', i.entry_type,
      'max_uses',   i.max_uses,
      'used_count', i.used_count,
      'guest_name', i.guest_name,
      'revoked',    (i.revoked_at IS NOT NULL)
    ),
    'guest_list', jsonb_build_object(
      'id',               gl.id,
      'event_id',         gl.event_id,
      'holder_type',      gl.holder_type,
      'quota',            gl.quota,
      'quota_female',     gl.quota_female,
      'quota_male',       gl.quota_male,
      'show_remaining',   gl.show_remaining,
      'free_before_time', gl.free_before_time,
      'entry_deadline',   gl.entry_deadline,
      'includes_drink',   gl.includes_drink,
      'is_active',        gl.is_active
    )
  )
  FROM public.guest_list_invites i
  JOIN public.guest_lists gl ON gl.id = i.guest_list_id
  WHERE i.token = _token
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_list_invite(text) TO anon, authenticated;

-- ── 7) Consommation atomique d'une place du lien (service_role only) ─────
-- L'edge function réserve la place AVANT l'insertion de l'entrée (l'UPDATE
-- conditionnel sérialise les claims concurrents), et la relâche si le
-- trigger de capacité rejette l'insertion.
CREATE OR REPLACE FUNCTION public.claim_guest_list_invite_use(_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.guest_list_invites
  SET used_count = used_count + 1
  WHERE id = _invite_id
    AND revoked_at IS NULL
    AND used_count < max_uses;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_guest_list_invite_use(_invite_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.guest_list_invites
  SET used_count = GREATEST(used_count - 1, 0)
  WHERE id = _invite_id
$$;

REVOKE ALL ON FUNCTION public.claim_guest_list_invite_use(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_guest_list_invite_use(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_list_invite_use(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_guest_list_invite_use(uuid) TO service_role;
