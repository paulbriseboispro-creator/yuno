-- CRM super admin : savoir QUI est en face, et pouvoir écrire dessus.
--
-- Trois manques constatés le 2026-09-08 sur `/admin/segmentation` :
--
--   1. **Des doublons visibles.** 11 lignes pour 9 personnes. La jointure
--      `profiles p ON lower(p.email) = b.em` frappe les profils orphelins
--      laissés par les suppressions douces (docs/ORPHAN_PROFILES.md) : deux
--      lignes portant le même email produisent deux lignes client.
--   2. **Aucun statut d'identité.** Impossible de dire si un client a un compte
--      Yuno, s'il a l'app, ou si on peut seulement le joindre. Sur 9 clients,
--      2 ont un compte — c'est LE chiffre qui décide de la prochaine action.
--   3. **Rien à écrire.** Un tableau qu'on ne peut pas annoter n'est pas un
--      CRM, c'est un rapport.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Un email = UNE identité
-- ─────────────────────────────────────────────────────────────────────────────

-- Résout l'identité d'un client à partir de son email, et rend d'un seul coup
-- ce qui décide de l'action commerciale : a-t-il un compte, a-t-il l'app, par
-- quel canal peut-on le joindre.
--
-- Sur un email en doublon, le profil VIVANT gagne (celui qui a encore une ligne
-- `auth.users`), puis le plus récent. C'est ce qui supprime les doublons
-- d'affichage sans toucher aux profils orphelins, qu'on ne supprime jamais.
CREATE OR REPLACE FUNCTION public._admin_customer_identity(p_email text)
RETURNS TABLE(
  user_id uuid, first_name text, last_name text, city text, gender text,
  phone text, birth_date date, avatar_url text, preferred_language text,
  account_created_at timestamptz, is_suspended boolean,
  has_account boolean, profile_count integer,
  app_platforms text[], has_app boolean, push_on boolean,
  email_opt_in boolean, sms_opt_in boolean, email_suppressed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH pick AS (
    SELECT p.*
    FROM public.profiles p
    WHERE lower(p.email) = lower(p_email)
    ORDER BY (EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)) DESC,
             p.created_at DESC
    LIMIT 1
  )
  SELECT
    pick.id, pick.first_name, pick.last_name, pick.city, pick.gender,
    pick.phone, pick.birth_date, pick.avatar_url, pick.preferred_language,
    pick.created_at, COALESCE(pick.is_suspended, false),
    EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pick.id),
    (SELECT count(*)::int FROM public.profiles p2 WHERE lower(p2.email) = lower(p_email)),
    -- L'app se déduit des abonnements push : c'est le seul rattachement
    -- appareil→personne qu'on ait (ota_devices n'a pas de custom_id).
    -- Sous-estime donc les gens qui ont l'app et ont refusé les notifications.
    COALESCE((SELECT array_agg(DISTINCT ps.platform)
              FROM public.push_subscriptions ps WHERE ps.user_id = pick.id), '{}'::text[]),
    EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = pick.id),
    EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = pick.id),
    -- Joignable par email : au moins un opt-in newsletter vivant.
    EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
             WHERE lower(ns.email) = lower(p_email) AND ns.opted_in),
    COALESCE(pick.phone_sms_opt_in, false)
      OR EXISTS (SELECT 1 FROM public.venue_sms_contacts sc
                  WHERE lower(sc.email) = lower(p_email) AND NOT COALESCE(sc.unsubscribed, false)),
    -- Supprimé côté délivrabilité : le marketing ne l'atteint plus, quoi qu'en
    -- dise l'opt-in.
    EXISTS (SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(p_email))
  FROM pick;
$function$;

-- Un email sans aucun profil doit quand même rendre une ligne (le client existe,
-- il n'a simplement pas de compte) : la version ci-dessus rend 0 ligne dans ce
-- cas, les appelants l'utilisent donc en LEFT JOIN LATERAL.
GRANT EXECUTE ON FUNCTION public._admin_customer_identity(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La couche qu'on écrit : étiquettes et notes
-- ─────────────────────────────────────────────────────────────────────────────

-- Clé = l'email, pas l'user_id : la majorité des clients n'ont PAS de compte
-- (7 sur 9 au 08/09). Un CRM qui n'annote que les inscrits rate sa cible.
CREATE TABLE IF NOT EXISTS public.crm_customers (
  email       text PRIMARY KEY,
  tags        text[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.crm_customer_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_customer_notes_email
  ON public.crm_customer_notes (email, created_at DESC);

-- RLS totale : ces tables ne sont jamais lues ni écrites depuis le client.
-- Tout passe par les RPC SECURITY DEFINER ci-dessous, qui vérifient
-- `is_super_admin()`. Aucune policy — donc aucun accès direct, y compris en
-- lecture, pour `anon` et `authenticated`.
ALTER TABLE public.crm_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_customer_notes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.crm_customers IS
  'Étiquettes CRM par email client. Aucune policy RLS : accès uniquement via les RPC admin_crm_*.';
COMMENT ON TABLE public.crm_customer_notes IS
  'Notes CRM par email client. Aucune policy RLS : accès uniquement via les RPC admin_crm_*.';

-- Poser les étiquettes d'un client (remplace la liste entière).
CREATE OR REPLACE FUNCTION public.admin_crm_set_tags(p_email text, p_tags text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_em text := lower(trim(p_email));
  v_tags text[];
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_em IS NULL OR length(v_em) = 0 THEN
    RAISE EXCEPTION 'Email requis' USING ERRCODE = '22023';
  END IF;

  -- Nettoyage : trim, vide écarté, doublons écartés, 20 étiquettes au plus.
  SELECT COALESCE(array_agg(DISTINCT t), '{}'::text[]) INTO v_tags
  FROM (
    SELECT left(trim(x), 40) AS t
    FROM unnest(COALESCE(p_tags, '{}'::text[])) x
    WHERE length(trim(x)) > 0
    LIMIT 20
  ) s;

  INSERT INTO public.crm_customers (email, tags, updated_at, updated_by)
  VALUES (v_em, v_tags, now(), auth.uid())
  ON CONFLICT (email) DO UPDATE
    SET tags = EXCLUDED.tags, updated_at = now(), updated_by = auth.uid();

  RETURN v_tags;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_crm_add_note(p_email text, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_em text := lower(trim(p_email));
  v_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_em IS NULL OR length(v_em) = 0 OR length(trim(COALESCE(p_body, ''))) = 0 THEN
    RAISE EXCEPTION 'Email et note requis' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.crm_customer_notes (email, body, created_by)
  VALUES (v_em, left(trim(p_body), 4000), auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_crm_delete_note(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.crm_customer_notes WHERE id = p_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_crm_set_tags(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_crm_add_note(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_crm_delete_note(uuid) TO authenticated;

-- Toutes les étiquettes déjà utilisées, pour l'autocomplétion et le filtre.
CREATE OR REPLACE FUNCTION public.admin_crm_all_tags()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tags text[];
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT t ORDER BY t), '{}'::text[]) INTO v_tags
  FROM public.crm_customers c, unnest(c.tags) t;
  RETURN v_tags;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_crm_all_tags() TO authenticated;
