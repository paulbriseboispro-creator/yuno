-- ============================================================================
-- Staff : identité personnalisable + attribution des actions + durcissement RLS
-- ============================================================================
-- Contexte de l'audit (2026-07-18) :
--   * Un membre du staff n'a AUCUNE identité propre : les dashboards affichent
--     un titre de poste statique ("Vestiaire", "Scanner d'Entrées"). Ni son nom,
--     ni le nom du club. On ajoute une identité de travail personnalisable.
--   * L'attribution des actions est incohérente : le vestiaire écrit
--     `processed_by` alors que l'analytics lit `staff_id`; le barman qui sert
--     directement n'est enregistré nulle part.
--   * `is_venue_staff()` oublie 'cloakroom' et 'dj'.
--   * Un membre du staff peut réécrire son propre `venue_id` et s'auto-rattacher
--     à n'importe quel club (escalade de privilèges via `is_venue_staff`).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Identité de travail du staff (colonnes sur `profiles`)
-- ────────────────────────────────────────────────────────────────────────────
-- Un membre du staff appartient à exactement un club (`profiles.venue_id` est
-- scalaire), donc l'identité staff est 1:1 avec le profil : pas besoin d'une
-- table dédiée tant que le modèle « un club par personne » tient.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS staff_display_name TEXT,
  ADD COLUMN IF NOT EXISTS staff_title        TEXT,
  ADD COLUMN IF NOT EXISTS staff_emoji        TEXT,
  ADD COLUMN IF NOT EXISTS staff_accent       TEXT,
  ADD COLUMN IF NOT EXISTS staff_avatar_url   TEXT,
  ADD COLUMN IF NOT EXISTS staff_since        DATE;

COMMENT ON COLUMN public.profiles.staff_display_name IS
  'Nom affiché sur les écrans pro du staff (surnom de service). Fallback : first_name.';
COMMENT ON COLUMN public.profiles.staff_title IS
  'Intitulé de poste personnalisé ("Chef de rang", "Responsable porte"). Fallback : libellé du rôle.';
COMMENT ON COLUMN public.profiles.staff_emoji IS
  'Emoji d''identité affiché dans le header et la liste d''équipe.';
COMMENT ON COLUMN public.profiles.staff_accent IS
  'Clé de couleur d''accent du dashboard staff (voir src/lib/staffIdentity.ts).';
COMMENT ON COLUMN public.profiles.staff_avatar_url IS
  'Photo de profil pro, distincte de l''avatar client (avatar_url).';
COMMENT ON COLUMN public.profiles.staff_since IS
  'Date d''arrivée dans l''équipe — alimente "Membre de l''équipe depuis...".';

-- Garde-fous de longueur : ces champs sont affichés dans un header de 14px.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_staff_display_name_len;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_staff_display_name_len
  CHECK (staff_display_name IS NULL OR char_length(staff_display_name) <= 40);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_staff_title_len;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_staff_title_len
  CHECK (staff_title IS NULL OR char_length(staff_title) <= 40);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_staff_emoji_len;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_staff_emoji_len
  CHECK (staff_emoji IS NULL OR char_length(staff_emoji) <= 8);

-- `staff_since` par défaut = date de création du profil, pour que l'écran
-- "Mon compte" affiche quelque chose de vrai dès le premier jour.
UPDATE public.profiles
   SET staff_since = created_at::date
 WHERE staff_since IS NULL
   AND id IN (
     SELECT user_id FROM public.user_roles
      WHERE role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
   );


-- ────────────────────────────────────────────────────────────────────────────
-- 2. `is_venue_staff` : 'cloakroom' et 'dj' manquaient
-- ────────────────────────────────────────────────────────────────────────────
-- Sans 'cloakroom', tout policy RLS bâtie sur is_venue_staff() refuse
-- silencieusement l'accès au vestiaire alors que le rôle existe depuis
-- 20260217145929.

CREATE OR REPLACE FUNCTION public.is_venue_staff(_user_id uuid, _venue_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
     WHERE p.id = _user_id
       AND p.venue_id = _venue_id
       AND ur.role IN ('vip_host', 'barman', 'bouncer', 'manager', 'cloakroom', 'dj')
  )
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Attribution vestiaire : réconcilier `staff_id` / `processed_by`
-- ────────────────────────────────────────────────────────────────────────────
-- `cloakroom_transactions` porte deux colonnes pour un seul concept. Le front
-- écrivait `processed_by` (au dépôt ET au retrait, écrasant le déposant),
-- pendant que `useLiveNightData` lisait `staff_id` — jamais renseigné. Résultat :
-- le vestiaire n'apparaissait jamais dans l'activité staff de la soirée.
--
-- Modèle retenu : `staff_id` = qui a DÉPOSÉ (colonne historique, porte la FK),
--                 `retrieved_by` = qui a RENDU. `processed_by` devient un alias
--                 legacy maintenu en écriture pour ne rien casser en lecture.

ALTER TABLE public.cloakroom_transactions
  ADD COLUMN IF NOT EXISTS retrieved_by UUID;

COMMENT ON COLUMN public.cloakroom_transactions.staff_id IS
  'Membre du staff ayant enregistré le dépôt.';
COMMENT ON COLUMN public.cloakroom_transactions.retrieved_by IS
  'Membre du staff ayant rendu les affaires (peut différer du déposant).';
COMMENT ON COLUMN public.cloakroom_transactions.processed_by IS
  'DEPRECATED — alias historique de staff_id. Conservé en écriture pour compat.';

-- Rattrapage : les dépôts passés n'ont que `processed_by`.
UPDATE public.cloakroom_transactions
   SET staff_id = processed_by
 WHERE staff_id IS NULL
   AND processed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS cloakroom_transactions_staff_id_idx
  ON public.cloakroom_transactions (staff_id)
  WHERE staff_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. Attribution bar : qui a réellement servi la commande
-- ────────────────────────────────────────────────────────────────────────────
-- `orders.prep_claimed_by` ne couvre que le Click&Collect. Un barman qui scanne
-- et sert directement ne laissait aucune trace.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS served_by UUID;

COMMENT ON COLUMN public.orders.served_by IS
  'Barman ayant validé le service (scan du QR client ou service direct).';

CREATE INDEX IF NOT EXISTS orders_served_by_idx
  ON public.orders (served_by)
  WHERE served_by IS NOT NULL;

-- Rattrapage best-effort : les commandes déjà servies héritent du barman qui
-- les avait mises en préparation.
UPDATE public.orders
   SET served_by = prep_claimed_by
 WHERE served_by IS NULL
   AND prep_claimed_by IS NOT NULL
   AND served_at IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Durcissement RLS
-- ────────────────────────────────────────────────────────────────────────────

-- 5a. "Owners update venue staff profiles" avait un USING sans WITH CHECK :
--     un owner pouvait déplacer un profil staff vers un club qu'il ne possède pas.
DROP POLICY IF EXISTS "Owners update venue staff profiles" ON public.profiles;
CREATE POLICY "Owners update venue staff profiles"
  ON public.profiles FOR UPDATE
  USING (
    public.is_owner_of_any_venue(auth.uid())
    AND venue_id IN (SELECT public.get_owner_venue_ids(auth.uid()))
  )
  WITH CHECK (
    public.is_owner_of_any_venue(auth.uid())
    AND venue_id IN (SELECT public.get_owner_venue_ids(auth.uid()))
  );

-- 5b. Escalade de privilèges : "Users can update own profile" laisse n'importe
--     quel utilisateur écrire son propre `venue_id`. Comme `is_venue_staff()`
--     ne regarde QUE (profiles.venue_id, user_roles.role), un barman pouvait
--     pointer son profil vers un autre club et hériter de l'accès staff.
--     On verrouille la colonne : seuls le service_role et les owners/managers
--     (qui passent par leurs propres policies) peuvent la déplacer.
CREATE OR REPLACE FUNCTION public.guard_profile_venue_self_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rien à contrôler si la colonne ne bouge pas.
  IF NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id THEN
    RETURN NEW;
  END IF;

  -- Le service_role (edge functions : accept-staff-invitation, delete-employee)
  -- n'a pas d'auth.uid() applicatif : on le laisse passer.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Un utilisateur qui modifie SON propre profil ne peut pas se rattacher
  -- lui-même à un club.
  IF auth.uid() = NEW.id THEN
    RAISE EXCEPTION 'venue_id cannot be changed by the profile owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_venue_self_move_trg ON public.profiles;
CREATE TRIGGER guard_profile_venue_self_move_trg
  BEFORE UPDATE OF venue_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_venue_self_move();


-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC : statistiques personnelles d'un membre du staff
-- ────────────────────────────────────────────────────────────────────────────
-- Alimente l'écran "Mon compte" : ce que J'AI fait, pas ce que le club a fait.
-- SECURITY DEFINER pour agréger sans dépendre des policies de lecture de
-- chaque table métier — mais l'agrégat est toujours borné à auth.uid().

CREATE OR REPLACE FUNCTION public.get_staff_self_stats(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_since timestamptz;
  v_today timestamptz;
  v_venue text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Fenêtre bornée : évite qu'un p_days absurde scanne tout l'historique.
  v_since := now() - (LEAST(GREATEST(COALESCE(p_days, 30), 1), 365) || ' days')::interval;
  -- "Cette nuit" démarre à 6h du matin : une soirée club déborde sur le lendemain.
  v_today := date_trunc('day', now() - interval '6 hours') + interval '6 hours';

  SELECT venue_id INTO v_venue FROM public.profiles WHERE id = v_uid;

  SELECT jsonb_build_object(
    'venue_id', v_venue,
    'since',    v_since,

    -- Scans porte (billets nominatifs + billets legacy + tables + guest list)
    'scans_total', (
      (SELECT count(*) FROM public.ticket_attendees
        WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.tickets
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.table_reservations
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
      + (SELECT count(*) FROM public.guest_list_entries
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since)
    ),
    'scans_tonight', (
      (SELECT count(*) FROM public.ticket_attendees
        WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
      + (SELECT count(*) FROM public.tickets
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
      + (SELECT count(*) FROM public.table_reservations
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
      + (SELECT count(*) FROM public.guest_list_entries
          WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_today)
    ),

    -- Bar
    'orders_total', (
      SELECT count(*) FROM public.orders
       WHERE served_by = v_uid AND served_at >= v_since
    ),
    'orders_tonight', (
      SELECT count(*) FROM public.orders
       WHERE served_by = v_uid AND served_at >= v_today
    ),

    -- Vestiaire (dépôts enregistrés)
    'cloakroom_total', (
      SELECT count(*) FROM public.cloakroom_transactions
       WHERE staff_id = v_uid AND created_at >= v_since
    ),
    'cloakroom_tonight', (
      SELECT count(*) FROM public.cloakroom_transactions
       WHERE staff_id = v_uid AND created_at >= v_today
    ),

    -- VIP (consommations servies + upsell généré)
    'vip_items_total', (
      SELECT COALESCE(count(*), 0) FROM public.vip_consumptions
       WHERE COALESCE(served_by, staff_id) = v_uid AND created_at >= v_since
    ),
    'vip_items_tonight', (
      SELECT COALESCE(count(*), 0) FROM public.vip_consumptions
       WHERE COALESCE(served_by, staff_id) = v_uid AND created_at >= v_today
    ),
    'vip_upsell_total', (
      SELECT COALESCE(sum(upsell_amount), 0) FROM public.vip_upsell_stats
       WHERE staff_id = v_uid AND created_at >= v_since
    ),

    -- Nuits travaillées : nombre de jours distincts avec au moins une action.
    'nights_worked', (
      SELECT count(DISTINCT d) FROM (
        SELECT date_trunc('day', entry_scanned_at - interval '6 hours') AS d
          FROM public.ticket_attendees
         WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since
        UNION
        SELECT date_trunc('day', entry_scanned_at - interval '6 hours')
          FROM public.table_reservations
         WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since
        UNION
        SELECT date_trunc('day', entry_scanned_at - interval '6 hours')
          FROM public.guest_list_entries
         WHERE entry_scanned_by = v_uid AND entry_scanned_at >= v_since
        UNION
        SELECT date_trunc('day', served_at - interval '6 hours')
          FROM public.orders
         WHERE served_by = v_uid AND served_at >= v_since
        UNION
        SELECT date_trunc('day', created_at - interval '6 hours')
          FROM public.cloakroom_transactions
         WHERE staff_id = v_uid AND created_at >= v_since
      ) nights
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_self_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_self_stats(integer) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPC : l'équipe du club, vue par un membre du staff
-- ────────────────────────────────────────────────────────────────────────────
-- Un barman ne peut pas lire `profiles` de ses collègues (aucune policy ne le
-- permet, et c'est bien ainsi : ces lignes portent téléphone, PIN, MFA...).
-- Cette RPC expose UNIQUEMENT l'identité de travail publique, et seulement aux
-- membres du même club. Plusieurs personnes par rôle sont attendues.

CREATE OR REPLACE FUNCTION public.get_venue_staff_team()
RETURNS TABLE (
  user_id      uuid,
  display_name text,
  title        text,
  emoji        text,
  accent       text,
  avatar_url   text,
  roles        text[],
  staff_since  date,
  is_me        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_venue text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT p.venue_id INTO v_venue FROM public.profiles p WHERE p.id = v_uid;
  IF v_venue IS NULL THEN
    RETURN;
  END IF;

  -- L'appelant doit lui-même être staff ou owner du club.
  IF NOT (
    public.is_venue_staff(v_uid, v_venue)
    OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_venue AND v.owner_id = v_uid)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(p.staff_display_name, ''), NULLIF(p.first_name, ''), split_part(p.email, '@', 1)),
    p.staff_title,
    p.staff_emoji,
    p.staff_accent,
    COALESCE(NULLIF(p.staff_avatar_url, ''), p.avatar_url),
    ARRAY(
      SELECT ur2.role::text FROM public.user_roles ur2
       WHERE ur2.user_id = p.id
         AND ur2.role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
       ORDER BY ur2.role::text
    ),
    p.staff_since,
    (p.id = v_uid)
  FROM public.profiles p
  WHERE p.venue_id = v_venue
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = p.id
         AND ur.role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
    )
  ORDER BY (p.id = v_uid) DESC, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.get_venue_staff_team() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_venue_staff_team() TO authenticated;
