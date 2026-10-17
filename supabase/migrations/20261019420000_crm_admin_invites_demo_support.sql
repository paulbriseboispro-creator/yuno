-- Admin Yuno CRM : inviter soi-même un club ou un organisateur, ouvrir la démo à
-- un prospect, et l'accès assisté d'un compte CRM (demande de Paul, 18/10/2026 :
-- « que le compte admin Yuno CRM soit vraiment 100 % fonctionnel »).
--
-- 1. INVITATIONS. Une invitation n'est plus seulement l'offre fondateurs : le
--    super admin invite qui il veut, avec un PRÉ-PROFIL (type, structure,
--    contact, e-mail, téléphone, ville, langue), par e-mail ou WhatsApp.
--    `crm_offer_invites.offer` = 'founder' (5 places, 6 mois, 15 000 Yunits,
--    règles de 20261017230000 inchangées) ou 'standard' (l'essai de tout le
--    monde, aucune place prise). Le pré-profil part dans le brouillon
--    d'inscription dès l'ouverture du lien (track_pro_signup) : complete_pro_signup
--    en remplit le profil et le compte (prénom, nom, téléphone, ville). La case
--    « Proposer l'accès assisté » dépose, à l'ouverture du compte, une demande
--    EN ATTENTE que le pro accepte ou non depuis sa Console : jamais un accès
--    accordé à sa place.
-- 2. DÉMO. Un accès démo est un lien d'aperçu ordinaire (demo_preview_links,
--    lecture seule imposée par le serveur, 20260927160000) sur le compte
--    crm@womber.fr, ouvert sur https://crm.yunoapp.eu/crm/preview?token=…. Le
--    mot de passe est gardé dans crm_demo_accesses (RLS sans policy, super
--    admin par les RPC seulement) pour pouvoir le renvoyer : il ouvre une démo
--    en lecture seule aux données fictives, rien d'autre. Lié à une invitation,
--    le bouton « Créer mon compte » de la démo mène au lien de l'invitation.
-- 3. ACCÈS ASSISTÉ. Même mécanique que la Billetterie (admin_support_grants,
--    20260824120000) : une vue d'ensemble pour l'Admin CRM
--    (crm_admin_support), et la demande en attente devient une notification de
--    la Console CRM (« support_request », _crm_notif_list).

-- ── 1. Invitations ─────────────────────────────────────────────────────────
ALTER TABLE public.crm_offer_invites DROP CONSTRAINT IF EXISTS crm_offer_invites_offer_check;
ALTER TABLE public.crm_offer_invites ADD CONSTRAINT crm_offer_invites_offer_check CHECK (offer IN ('founder', 'standard'));
ALTER TABLE public.crm_offer_invites DROP CONSTRAINT IF EXISTS crm_offer_invites_free_months_check;
ALTER TABLE public.crm_offer_invites ADD CONSTRAINT crm_offer_invites_free_months_check CHECK (free_months BETWEEN 0 AND 24);
ALTER TABLE public.crm_offer_invites
  ADD COLUMN IF NOT EXISTS kind text CHECK (kind IS NULL OR kind IN ('club', 'organizer')),
  ADD COLUMN IF NOT EXISTS city text CHECK (city IS NULL OR length(city) <= 120),
  ADD COLUMN IF NOT EXISTS support_offer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS support_grant_id uuid REFERENCES public.admin_support_grants (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pro_signups_offer_invite_idx ON public.pro_signups (offer_invite_id) WHERE offer_invite_id IS NOT NULL;

-- ── 2. Accès démo (avant le JSON des invitations, qui les lit) ─────────────
CREATE TABLE IF NOT EXISTS public.crm_demo_accesses (
  link_id      uuid PRIMARY KEY REFERENCES public.demo_preview_links (id) ON DELETE CASCADE,
  contact_name text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  email        text CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone        text CHECK (phone IS NULL OR length(phone) <= 40),
  lang         text NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr', 'en', 'es')),
  -- Mot de passe d'un aperçu en LECTURE SEULE du compte démo (données
  -- fictives) : gardé pour que le super admin puisse le renvoyer.
  password     text NOT NULL CHECK (length(password) BETWEEN 4 AND 64),
  invite_id    uuid REFERENCES public.crm_offer_invites (id) ON DELETE SET NULL,
  note         text CHECK (note IS NULL OR length(note) <= 500),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  emailed_at   timestamptz,
  email_count  integer NOT NULL DEFAULT 0,
  shared_at    timestamptz
);
CREATE INDEX IF NOT EXISTS crm_demo_accesses_invite_idx ON public.crm_demo_accesses (invite_id) WHERE invite_id IS NOT NULL;
ALTER TABLE public.crm_demo_accesses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_demo_accesses FROM anon, authenticated;

-- L'adresse d'un accès démo : la Console CRM, sur le domaine CRM.
CREATE OR REPLACE FUNCTION public.crm_demo_link_url(p_token text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT 'https://crm.yunoapp.eu/crm/preview?token=' || p_token;
$function$;
REVOKE ALL ON FUNCTION public.crm_demo_link_url(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_link_url(text) TO service_role;

-- Statut lisible d'un lien d'aperçu.
CREATE OR REPLACE FUNCTION public._crm_demo_link_state(l public.demo_preview_links)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
    WHEN NOT l.is_active OR l.revoked_at IS NOT NULL THEN 'revoked'
    WHEN l.expires_at IS NOT NULL AND l.expires_at < now() THEN 'expired'
    WHEN l.failed_attempts > 10 THEN 'locked'
    WHEN l.used_count > 0 THEN 'opened'
    ELSE 'ready' END;
$function$;
REVOKE ALL ON FUNCTION public._crm_demo_link_state(public.demo_preview_links) FROM PUBLIC, anon, authenticated;

-- Un accès démo pour l'admin (mot de passe compris, jamais exposé ailleurs).
CREATE OR REPLACE FUNCTION public._crm_demo_access_json(p_link uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', l.id, 'url', public.crm_demo_link_url(l.token), 'label', l.label,
    'password', a.password, 'managed', a.link_id IS NOT NULL,
    'contact_name', a.contact_name, 'email', a.email, 'phone', a.phone,
    'lang', COALESCE(a.lang, l.language), 'note', a.note,
    'status', public._crm_demo_link_state(l), 'expires_at', l.expires_at, 'created_at', l.created_at,
    'used_count', l.used_count, 'last_used_at', l.last_used_at,
    'sessions', (SELECT count(*) FROM public.demo_preview_sessions s WHERE s.link_id = l.id),
    'emailed_at', a.emailed_at, 'email_count', COALESCE(a.email_count, 0), 'shared_at', a.shared_at,
    'invite', CASE WHEN a.invite_id IS NULL THEN NULL ELSE (
      SELECT jsonb_build_object('id', i.id, 'org_name', i.org_name, 'offer', i.offer, 'status', public._crm_offer_invite_state(i))
        FROM public.crm_offer_invites i WHERE i.id = a.invite_id) END)
  FROM public.demo_preview_links l
  LEFT JOIN public.crm_demo_accesses a ON a.link_id = l.id
  WHERE l.id = p_link;
$function$;
REVOKE ALL ON FUNCTION public._crm_demo_access_json(uuid) FROM PUBLIC, anon, authenticated;

-- ── Une invitation pour l'admin ─────────────────────────────────────────────
-- Reprend 20261017230000 et ajoute : l'offre, le pré-profil, le parcours
-- d'inscription (pro_signups), l'accès démo lié et la demande d'accès assisté.
CREATE OR REPLACE FUNCTION public._crm_offer_invite_json(i public.crm_offer_invites)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', i.id, 'url', public.crm_offer_invite_url(i.token, i.lang), 'offer', i.offer, 'kind', i.kind,
    'org_name', i.org_name, 'contact_name', i.contact_name, 'email', i.email, 'phone', i.phone, 'city', i.city,
    'lang', i.lang, 'note', i.note,
    'free_months', i.free_months, 'yunits', i.yunits, 'status', public._crm_offer_invite_state(i),
    'support_offer', i.support_offer,
    'expires_at', i.expires_at, 'created_at', i.created_at, 'emailed_at', i.emailed_at,
    'email_count', i.email_count, 'shared_at', i.shared_at, 'opened_at', i.opened_at,
    'claimed_at', i.claimed_at, 'scope_key', i.scope_key, 'revoked_at', i.revoked_at,
    'revoked_reason', i.revoked_reason,
    -- Le parcours d'inscription ouvert par ce lien (le plus avancé).
    'journey', (SELECT jsonb_build_object('started_at', ps.created_at, 'updated_at', ps.updated_at,
                                          'last_step', ps.last_step, 'email', ps.email)
                  FROM public.pro_signups ps WHERE ps.offer_invite_id = i.id
                 ORDER BY (ps.user_id IS NOT NULL) DESC, ps.updated_at DESC LIMIT 1),
    'demo', (SELECT public._crm_demo_access_json(a.link_id) FROM public.crm_demo_accesses a
              WHERE a.invite_id = i.id ORDER BY a.created_at DESC LIMIT 1),
    'support', CASE WHEN i.support_grant_id IS NULL THEN NULL ELSE (
      SELECT jsonb_build_object('id', g.id, 'status', g.status, 'approved_at', g.approved_at)
        FROM public.admin_support_grants g WHERE g.id = i.support_grant_id) END,
    'account', CASE WHEN i.scope_key IS NULL THEN NULL ELSE (
      SELECT jsonb_build_object(
        'name', COALESCE((SELECT v.name FROM public.venues v WHERE 'venue:' || v.id = i.scope_key),
                         (SELECT NULLIF(o.display_name, '') FROM public.organizer_profiles o WHERE 'org:' || o.user_id::text = i.scope_key)),
        'offer_until', s.offer_until, 'status', s.status, 'trial_ends_at', s.trial_ends_at,
        'has_stripe', s.stripe_subscription_id IS NOT NULL,
        'yunits_balance', public.crm_yunits_balance(i.scope_key))
      FROM public.crm_subscriptions s WHERE s.scope_key = i.scope_key) END);
$function$;
REVOKE ALL ON FUNCTION public._crm_offer_invite_json(public.crm_offer_invites) FROM PUBLIC, anon, authenticated;

-- ── Admin CRM › Inviter : toutes les invitations (offre fondateurs ou non) ──
CREATE OR REPLACE FUNCTION public.crm_admin_invites()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_founder_offer_config();
  pc jsonb := public.crm_pricing_config();
  v_claimed integer;
  v_pending integer;
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT count(*) FILTER (WHERE status = 'claimed'),
         count(*) FILTER (WHERE status = 'pending' AND expires_at > now())
    INTO v_claimed, v_pending
    FROM public.crm_offer_invites WHERE offer = 'founder';
  RETURN jsonb_build_object(
    'config', cfg,
    'price_month', (pc->>'price_month')::numeric,
    'trial', jsonb_build_object('days', (pc->>'trial_days')::int, 'yunits', (pc->>'trial_yunits')::int),
    'seats', jsonb_build_object('total', (cfg->>'seats')::int, 'claimed', v_claimed, 'pending', v_pending,
                                'left', GREATEST(0, (cfg->>'seats')::int - v_claimed - v_pending)),
    'invites', COALESCE((SELECT jsonb_agg(public._crm_offer_invite_json(i) ORDER BY i.created_at DESC)
                           FROM public.crm_offer_invites i), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_invites() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_invite_create(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_founder_offer_config();
  v_offer text := CASE WHEN p->>'offer' = 'founder' THEN 'founder' ELSE 'standard' END;
  v_kind text := CASE WHEN p->>'kind' IN ('club', 'organizer') THEN p->>'kind' END;
  v_name text := left(regexp_replace(trim(COALESCE(p->>'org_name', '')), '\s+', ' ', 'g'), 120);
  v_email text := lower(NULLIF(trim(COALESCE(p->>'email', '')), ''));
  v_lang text := CASE WHEN p->>'lang' IN ('fr', 'en', 'es') THEN p->>'lang' ELSE 'fr' END;
  v_row public.crm_offer_invites%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'org_name_required' USING ERRCODE = '22023'; END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE = '22023';
  END IF;
  IF v_offer = 'founder' THEN
    -- Une place à la fois : deux créations simultanées ne dépassent pas le plafond.
    PERFORM pg_advisory_xact_lock(hashtext('crm_founder_offer_seats'));
    IF public._crm_offer_seats_taken() >= (cfg->>'seats')::int THEN
      RAISE EXCEPTION 'offer_full' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  INSERT INTO public.crm_offer_invites (token, offer, kind, org_name, contact_name, email, phone, city, lang, note,
                                        free_months, yunits, support_offer, expires_at, created_by)
  VALUES (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), v_offer, v_kind,
          v_name, left(NULLIF(regexp_replace(trim(COALESCE(p->>'contact_name', '')), '\s+', ' ', 'g'), ''), 120), v_email,
          left(NULLIF(trim(COALESCE(p->>'phone', '')), ''), 40),
          left(NULLIF(trim(COALESCE(p->>'city', '')), ''), 120), v_lang,
          left(NULLIF(trim(COALESCE(p->>'note', '')), ''), 500),
          CASE WHEN v_offer = 'founder' THEN (cfg->>'free_months')::int ELSE 0 END,
          CASE WHEN v_offer = 'founder' THEN (cfg->>'yunits')::int ELSE 0 END,
          COALESCE((p->>'support_offer')::boolean, true),
          now() + make_interval(days => (cfg->>'link_days')::int), auth.uid())
  RETURNING * INTO v_row;
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'crm_offer_invite_create', 'crm_offer_invite', v_row.id::text,
            jsonb_build_object('org_name', v_row.org_name, 'email', v_row.email, 'offer', v_row.offer,
                               'kind', v_row.kind, 'support_offer', v_row.support_offer));
  END IF;
  RETURN public._crm_offer_invite_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_invite_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_invite_create(jsonb) TO authenticated, service_role;

-- Corriger le pré-profil tant que le lien n'a pas servi (reprise de
-- 20261017230000, avec le type, la ville et la proposition d'accès assisté).
CREATE OR REPLACE FUNCTION public.crm_admin_offer_invite_update(p_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
  v_email text;
BEGIN
  PERFORM public._crm_admin_gate();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_row FROM public.crm_offer_invites WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = 'P0001'; END IF;
  IF p_patch ? 'email' THEN
    v_email := lower(NULLIF(trim(COALESCE(p_patch->>'email', '')), ''));
    IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
      RAISE EXCEPTION 'bad_email' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.crm_offer_invites SET
    org_name = CASE WHEN p_patch ? 'org_name' AND length(trim(COALESCE(p_patch->>'org_name', ''))) > 0
                    THEN left(regexp_replace(trim(p_patch->>'org_name'), '\s+', ' ', 'g'), 120) ELSE org_name END,
    contact_name = CASE WHEN p_patch ? 'contact_name' THEN left(NULLIF(trim(COALESCE(p_patch->>'contact_name', '')), ''), 120) ELSE contact_name END,
    email = CASE WHEN p_patch ? 'email' THEN v_email ELSE email END,
    phone = CASE WHEN p_patch ? 'phone' THEN left(NULLIF(trim(COALESCE(p_patch->>'phone', '')), ''), 40) ELSE phone END,
    city = CASE WHEN p_patch ? 'city' THEN left(NULLIF(trim(COALESCE(p_patch->>'city', '')), ''), 120) ELSE city END,
    kind = CASE WHEN p_patch ? 'kind' THEN (CASE WHEN p_patch->>'kind' IN ('club', 'organizer') THEN p_patch->>'kind' END) ELSE kind END,
    support_offer = CASE WHEN jsonb_typeof(p_patch->'support_offer') = 'boolean' THEN (p_patch->>'support_offer')::boolean ELSE support_offer END,
    lang = CASE WHEN p_patch->>'lang' IN ('fr', 'en', 'es') THEN p_patch->>'lang' ELSE lang END,
    note = CASE WHEN p_patch ? 'note' THEN left(NULLIF(trim(COALESCE(p_patch->>'note', '')), ''), 500) ELSE note END
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN public._crm_offer_invite_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_offer_invite_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_offer_invite_update(uuid, jsonb) TO authenticated, service_role;

-- Un lien expiré (ou qui va l'être) repart pour la durée de l'offre. Une
-- invitation fondateur reprend une place : refusée si les 5 sont prises.
CREATE OR REPLACE FUNCTION public.crm_admin_invite_extend(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_founder_offer_config();
  v_row public.crm_offer_invites%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  PERFORM pg_advisory_xact_lock(hashtext('crm_founder_offer_seats'));
  SELECT * INTO v_row FROM public.crm_offer_invites WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = 'P0001'; END IF;
  IF v_row.offer = 'founder' AND public._crm_offer_seats_taken(v_row.id) >= (cfg->>'seats')::int THEN
    RAISE EXCEPTION 'offer_full' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.crm_offer_invites SET expires_at = now() + make_interval(days => (cfg->>'link_days')::int)
   WHERE id = p_id RETURNING * INTO v_row;
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'crm_offer_invite_extend', 'crm_offer_invite', v_row.id::text,
            jsonb_build_object('org_name', v_row.org_name, 'expires_at', v_row.expires_at));
  END IF;
  RETURN public._crm_offer_invite_json(v_row);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_invite_extend(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_invite_extend(uuid) TO authenticated, service_role;

-- Ce que l'edge met dans l'e-mail d'invitation : l'invitation, le prix, l'essai
-- (invitation standard) et l'accès démo s'il est lié et encore valable.
CREATE OR REPLACE FUNCTION public.crm_offer_invite_for_email(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
  pc jsonb := public.crm_pricing_config();
BEGIN
  PERFORM public._crm_admin_gate();
  SELECT * INTO v_row FROM public.crm_offer_invites WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF public._crm_offer_invite_state(v_row) <> 'pending' THEN RAISE EXCEPTION 'not_pending' USING ERRCODE = 'P0001'; END IF;
  IF v_row.email IS NULL THEN RAISE EXCEPTION 'no_email' USING ERRCODE = '22023'; END IF;
  RETURN public._crm_offer_invite_json(v_row)
    || jsonb_build_object('price_month', (pc->>'price_month')::numeric,
                          'trial_days', (pc->>'trial_days')::int, 'trial_yunits', (pc->>'trial_yunits')::int);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_offer_invite_for_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_offer_invite_for_email(uuid) TO authenticated, service_role;

-- Lecture publique d'une invitation (page d'inscription) : ce qu'il faut pour
-- accueillir la personne et pré-remplir son inscription. Le jeton (64
-- caractères aléatoires) EST l'accès.
CREATE OR REPLACE FUNCTION public.crm_offer_invite_preview(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.crm_offer_invites%ROWTYPE;
  v_state text;
  v_contact text;
  v_first text;
  pc jsonb := public.crm_pricing_config();
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{20,80}$' THEN
    RETURN jsonb_build_object('status', 'unknown');
  END IF;
  SELECT * INTO v_row FROM public.crm_offer_invites WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  v_state := public._crm_offer_invite_state(v_row);
  IF v_state = 'pending' AND v_row.opened_at IS NULL THEN
    UPDATE public.crm_offer_invites SET opened_at = now() WHERE id = v_row.id;
  END IF;
  IF v_state <> 'pending' THEN RETURN jsonb_build_object('status', v_state); END IF;
  v_contact := trim(COALESCE(v_row.contact_name, ''));
  v_first := NULLIF(split_part(v_contact, ' ', 1), '');
  RETURN jsonb_build_object(
    'status', 'ok', 'offer', v_row.offer, 'kind', v_row.kind, 'org_name', v_row.org_name,
    'first_name', v_first,
    'last_name', NULLIF(trim(substr(v_contact, length(COALESCE(v_first, '')) + 1)), ''),
    'email', v_row.email, 'city', v_row.city, 'lang', v_row.lang,
    'free_months', v_row.free_months, 'yunits', v_row.yunits,
    'price_month', (pc->>'price_month')::numeric,
    'trial_days', (pc->>'trial_days')::int, 'trial_yunits', (pc->>'trial_yunits')::int,
    'support_offer', v_row.support_offer,
    'expires_at', v_row.expires_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_offer_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_offer_invite_preview(text) TO anon, authenticated, service_role;

-- La demande d'accès assisté proposée à l'invitation (interne). Elle naît EN
-- ATTENTE : le pro l'accepte ou non depuis sa Console. Ne lève jamais.
CREATE OR REPLACE FUNCTION public._crm_invite_offer_support(p_invite uuid, p_uid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv public.crm_offer_invites%ROWTYPE;
  v_gid uuid;
BEGIN
  SELECT * INTO v_inv FROM public.crm_offer_invites WHERE id = p_invite;
  IF NOT FOUND OR NOT v_inv.support_offer OR v_inv.created_by IS NULL OR p_uid IS NULL THEN RETURN NULL; END IF;
  IF v_inv.created_by = p_uid THEN RETURN NULL; END IF;
  SELECT g.id INTO v_gid FROM public.admin_support_grants g
   WHERE g.target_user_id = p_uid AND g.status IN ('pending', 'active')
     AND (g.expires_at IS NULL OR g.expires_at > now())
   ORDER BY g.created_at DESC LIMIT 1;
  IF v_gid IS NULL THEN
    INSERT INTO public.admin_support_grants (target_user_id, requested_by, status, reason, initiated_by)
    VALUES (p_uid, v_inv.created_by, 'pending',
            CASE v_inv.lang
              WHEN 'en' THEN 'Set up Yuno CRM with you (offered with your invitation)'
              WHEN 'es' THEN 'Configurar Yuno CRM contigo (propuesto con tu invitación)'
              ELSE 'Configurer Yuno CRM avec vous (proposé avec votre invitation)' END,
            'admin')
    RETURNING id INTO v_gid;
  END IF;
  UPDATE public.crm_offer_invites SET support_grant_id = v_gid WHERE id = p_invite;
  RETURN v_gid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_invite_offer_support(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_invite_offer_support(uuid, uuid) TO service_role;

-- ── Appliquer une invitation à un compte CRM (interne) ─────────────────────
-- Reprise de 20261017230000. Une invitation STANDARD ne touche ni à
-- l'abonnement ni aux Yunits (l'essai de tout le monde s'applique) : elle est
-- seulement rattachée au compte qu'elle a fait ouvrir. Les deux déposent la
-- demande d'accès assisté si elle a été proposée. Ne lève jamais.
CREATE OR REPLACE FUNCTION public._crm_offer_apply(p_invite uuid, p_scope text, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg jsonb := public.crm_founder_offer_config();
  pc jsonb := public.crm_pricing_config();
  v_inv public.crm_offer_invites%ROWTYPE;
  v_sub public.crm_subscriptions%ROWTYPE;
  v_until timestamptz;
  v_parts record;
  v_name text;
  v_grant uuid;
BEGIN
  IF p_invite IS NULL OR p_scope IS NULL OR p_scope !~ '^(venue|org):.+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_founder_offer_seats'));
  SELECT * INTO v_inv FROM public.crm_offer_invites WHERE id = p_invite FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown'); END IF;
  -- Déjà appliquée à CE compte (deuxième passage du même parcours) : même réponse.
  IF v_inv.status = 'claimed' AND v_inv.scope_key = p_scope THEN
    SELECT * INTO v_sub FROM public.crm_subscriptions WHERE scope_key = p_scope;
    RETURN jsonb_build_object('ok', true, 'already', true, 'offer', v_inv.offer,
                              'until', CASE WHEN v_inv.offer = 'founder' THEN v_sub.offer_until ELSE v_sub.trial_ends_at END,
                              'free_months', v_inv.free_months, 'yunits', v_inv.yunits);
  END IF;
  IF public._crm_offer_invite_state(v_inv) <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', public._crm_offer_invite_state(v_inv));
  END IF;
  IF NOT public.crm_scope_has_crm(p_scope) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_crm');
  END IF;
  SELECT * INTO v_parts FROM public.crm_scope_parts(p_scope);
  v_name := COALESCE((SELECT v.name FROM public.venues v WHERE v.id = v_parts.venue_id),
                     (SELECT NULLIF(o.display_name, '') FROM public.organizer_profiles o WHERE o.user_id = v_parts.organizer_user_id),
                     v_inv.org_name);

  -- ── Invitation standard : le compte garde l'essai de tout le monde ──────
  IF v_inv.offer = 'standard' THEN
    UPDATE public.crm_offer_invites
       SET status = 'claimed', claimed_at = now(), claimed_by = p_uid, scope_key = p_scope
     WHERE id = v_inv.id;
    v_grant := public._crm_invite_offer_support(v_inv.id, p_uid);
    SELECT * INTO v_sub FROM public.crm_subscriptions WHERE scope_key = p_scope;
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_crm_invite_claimed',
        'Invitation Yuno CRM acceptée',
        v_name || ' a ouvert son compte Yuno CRM avec ton invitation (essai de '
          || COALESCE((pc->>'trial_days'), '14') || ' jours).'
          || CASE WHEN v_grant IS NOT NULL THEN ' La demande d''accès assisté l''attend dans sa Console.' ELSE '' END,
        'high', 'crm_account', p_scope,
        jsonb_build_object('invite_id', v_inv.id, 'scope_key', p_scope, 'org_name', v_name, 'support_grant_id', v_grant),
        'crm_invite_claimed:' || v_inv.id::text, NULL);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN jsonb_build_object('ok', true, 'offer', 'standard', 'until', v_sub.trial_ends_at,
                              'free_months', 0, 'yunits', 0, 'support_grant_id', v_grant);
  END IF;

  -- ── Offre fondateurs (règles de 20261017230000) ─────────────────────────
  IF public._crm_offer_seats_taken(v_inv.id) >= (cfg->>'seats')::int THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'offer_full');
  END IF;
  SELECT * INTO v_sub FROM public.crm_subscriptions WHERE scope_key = p_scope FOR UPDATE;
  IF FOUND AND v_sub.offer IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_has_offer');
  END IF;
  -- Un compte qui paie déjà chez Stripe ne change pas de contrat par un lien.
  IF FOUND AND v_sub.stripe_subscription_id IS NOT NULL AND v_sub.status IN ('trialing', 'active', 'past_due') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'has_stripe');
  END IF;

  v_until := now() + make_interval(months => v_inv.free_months);
  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, trial_ends_at,
                                             founder, offer, offer_invite_id, offer_until, granted_by)
  VALUES (p_scope, v_parts.venue_id, v_parts.organizer_user_id, 'base', 'trialing', v_until,
          true, v_inv.offer, v_inv.id, v_until, v_inv.created_by)
  ON CONFLICT (scope_key) DO UPDATE SET
    plan = 'base', status = 'trialing', trial_ends_at = v_until, current_period_end = NULL,
    cancel_at_period_end = false, founder = true, offer = EXCLUDED.offer,
    offer_invite_id = EXCLUDED.offer_invite_id, offer_until = v_until,
    granted_by = EXCLUDED.granted_by, updated_at = now();

  -- L'essai standard crédite ses Yunits dès l'ouverture (trg_crm_subscription_allowance) :
  -- un lot d'essai jamais entamé est REMPLACÉ par ceux de l'offre (lot et ligne
  -- d'historique retirés, il n'a jamais servi). Un lot déjà entamé reste.
  WITH gone AS (
    DELETE FROM public.crm_yunit_lots l
     WHERE l.scope_key = p_scope AND l.kind = 'trial' AND l.remaining = l.amount
    RETURNING l.id)
  DELETE FROM public.crm_yunit_moves m USING gone
   WHERE m.scope_key = p_scope AND m.kind = 'credit' AND m.ref_type = 'lot' AND m.ref_id = gone.id::text;

  IF v_inv.yunits > 0 THEN
    PERFORM public.crm_yunits_credit(
      p_scope, 'grant', v_inv.yunits,
      now() + make_interval(months => COALESCE((cfg->>'yunits_valid_months')::int, 12)),
      'founder_offer', 'Offre fondateur', jsonb_build_object('invite_id', v_inv.id));
  END IF;

  UPDATE public.crm_offer_invites
     SET status = 'claimed', claimed_at = now(), claimed_by = p_uid, scope_key = p_scope
   WHERE id = v_inv.id;
  PERFORM public.crm_sync_scope(p_scope);
  v_grant := public._crm_invite_offer_support(v_inv.id, p_uid);

  BEGIN
    PERFORM public.emit_admin_notification(
      'admin_crm_offer_claimed',
      'Offre fondateur activée',
      v_name || ' a ouvert son compte Yuno CRM : ' || v_inv.free_months || ' mois offerts (jusqu''au '
        || to_char(v_until AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY') || ') et '
        || replace(to_char(v_inv.yunits, 'FM999,999'), ',', ' ') || ' Yunits. Places prises : '
        || public._crm_offer_seats_taken() || ' / ' || (cfg->>'seats') || '.',
      'high', 'crm_account', p_scope,
      jsonb_build_object('invite_id', v_inv.id, 'scope_key', p_scope, 'org_name', v_name,
                         'offer_until', v_until, 'yunits', v_inv.yunits, 'support_grant_id', v_grant),
      'crm_offer_claimed:' || v_inv.id::text, NULL);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'offer', v_inv.offer, 'until', v_until,
                            'free_months', v_inv.free_months, 'yunits', v_inv.yunits, 'support_grant_id', v_grant);
EXCEPTION WHEN OTHERS THEN
  -- L'invitation ne doit jamais faire échouer l'ouverture d'un compte.
  RETURN jsonb_build_object('ok', false, 'reason', 'error', 'detail', left(SQLERRM, 200));
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_offer_apply(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_offer_apply(uuid, text, uuid) TO service_role;

-- ── Le pré-profil suit le parcours d'inscription ───────────────────────────
-- Reprise de 20261017230000 : une invitation valable remplit ce que la
-- personne n'a pas (encore) saisi — type, structure, prénom, nom, e-mail,
-- téléphone, ville, langue — sans jamais écraser ce qu'elle tape.
CREATE OR REPLACE FUNCTION public.track_pro_signup(p_key text, p_step text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ctx      record;
  v_row      public.pro_signups%ROWTYPE;
  v_inv      public.crm_offer_invites%ROWTYPE;
  v_recent   integer;
  v_d        jsonb := CASE WHEN jsonb_typeof(p_data) = 'object' AND length(p_data::text) <= 4000
                           THEN p_data ELSE '{}'::jsonb END;
  v_kind     text := lower(nullif(trim(coalesce(v_d->>'kind', '')), ''));
  v_email    text := lower(nullif(trim(coalesce(v_d->>'email', '')), ''));
  v_product  text := lower(nullif(trim(coalesce(v_d->>'product', '')), ''));
  v_pillars  text[];
  v_offer    uuid;
  v_contact  text;
  v_first    text;
  v_last     text;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RETURN; END IF;
  IF p_step NOT IN ('opened','role','structure','account','lead') THEN RETURN; END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('club','organizer','promoter','other') THEN v_kind := NULL; END IF;
  IF v_product IS NOT NULL AND v_product NOT IN ('suite','crm') THEN v_product := NULL; END IF;
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    v_email := NULL;
  END IF;

  -- Invitation Yuno CRM (offre fondateurs ou non) : elle suit le parcours et
  -- apporte son pré-profil (20261017230000, 20261019420000).
  IF nullif(v_d->>'offer', '') IS NOT NULL THEN
    SELECT i.* INTO v_inv FROM public.crm_offer_invites i
     WHERE i.token = v_d->>'offer' AND i.status = 'pending' AND i.expires_at > now();
    v_offer := v_inv.id;
    IF v_offer IS NOT NULL THEN
      v_contact := trim(coalesce(v_inv.contact_name, ''));
      v_first := nullif(split_part(v_contact, ' ', 1), '');
      v_last := nullif(trim(substr(v_contact, length(coalesce(v_first, '')) + 1)), '');
    END IF;
  END IF;

  IF jsonb_typeof(v_d->'pillars') = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_pillars
      FROM jsonb_array_elements_text(v_d->'pillars') x
     WHERE x IN ('tickets','guest_list','tables','drinks');
  END IF;

  SELECT * INTO v_row FROM public.pro_signups WHERE client_key = p_key FOR UPDATE;

  IF NOT FOUND THEN
    SELECT * INTO v_ctx FROM public.links_visitor_context();
    -- Anti-flood : 20 parcours neufs par visiteur et par heure.
    SELECT count(*) INTO v_recent FROM public.pro_signups
     WHERE visitor_hash = v_ctx.o_hash AND created_at > now() - interval '1 hour';
    IF v_recent >= 20 THEN RETURN; END IF;

    INSERT INTO public.pro_signups (client_key, visitor_hash, device, geo_country)
    VALUES (p_key, v_ctx.o_hash, v_ctx.o_device, v_ctx.o_country)
    RETURNING * INTO v_row;
  END IF;

  -- Un parcours qui a déjà produit un compte ne s'écrit plus anonymement.
  IF v_row.user_id IS NOT NULL THEN RETURN; END IF;

  UPDATE public.pro_signups SET
    updated_at    = now(),
    kind          = coalesce(v_kind, kind, v_inv.kind),
    -- Une invitation Yuno CRM mène au CRM, quel que soit le défaut du brouillon.
    product       = coalesce(v_product, CASE WHEN v_offer IS NOT NULL THEN 'crm' END, product),
    lang          = coalesce(lower(left(nullif(v_d->>'lang', ''), 2)), lang, v_inv.lang),
    first_name    = coalesce(left(nullif(trim(v_d->>'first_name'), ''), 80), first_name, left(v_first, 80)),
    last_name     = coalesce(left(nullif(trim(v_d->>'last_name'), ''), 80), last_name, left(v_last, 80)),
    email         = coalesce(v_email, email, v_inv.email),
    phone         = coalesce(left(nullif(trim(v_d->>'phone'), ''), 40), phone, v_inv.phone),
    org_name      = coalesce(left(nullif(regexp_replace(trim(v_d->>'org_name'), '\s+', ' ', 'g'), ''), 120), org_name, v_inv.org_name),
    city          = coalesce(left(nullif(trim(v_d->>'city'), ''), 120), city, v_inv.city),
    country       = coalesce(upper(left(nullif(trim(v_d->>'country'), ''), 2)), country),
    size_band     = coalesce(left(nullif(v_d->>'size_band', ''), 20), size_band),
    frequency     = coalesce(left(nullif(v_d->>'frequency', ''), 20), frequency),
    pillars       = coalesce(v_pillars, pillars),
    current_tool  = coalesce(left(nullif(v_d->>'current_tool', ''), 40), current_tool),
    next_night    = coalesce(left(nullif(v_d->>'next_night', ''), 20), next_night),
    source        = coalesce(source, left(nullif(v_d->>'source', ''), 60), CASE WHEN v_offer IS NOT NULL THEN 'crm_invite' END),
    utm_source    = coalesce(utm_source, left(nullif(v_d->>'utm_source', ''), 120)),
    utm_medium    = coalesce(utm_medium, left(nullif(v_d->>'utm_medium', ''), 120)),
    utm_campaign  = coalesce(utm_campaign, left(nullif(v_d->>'utm_campaign', ''), 120)),
    referrer_host = coalesce(referrer_host, left(nullif(v_d->>'referrer_host', ''), 120)),
    offer_invite_id = coalesce(v_offer, offer_invite_id),
    steps         = CASE WHEN steps ? p_step THEN steps
                         ELSE steps || jsonb_build_object(p_step, now()) END,
    last_step     = p_step
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Promoteur / autre : pas de compte en libre-service, c'est un lead chaud.
  IF p_step = 'lead' AND v_row.email IS NOT NULL AND NOT public.is_demo_email(v_row.email) THEN
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_pro_signup_lead',
        'Nouveau lead pro (landing)',
        coalesce(nullif(trim(coalesce(v_row.first_name, '') || ' ' || coalesce(v_row.last_name, '')), ''), v_row.email)
          || coalesce(' — ' || v_row.org_name, '') || coalesce(' (' || v_row.city || ')', '')
          || ' · ' || coalesce(v_row.kind, 'other') || '.',
        'high', 'pro_signup', v_row.id::text,
        jsonb_build_object('kind', v_row.kind, 'email', v_row.email, 'phone', v_row.phone,
                           'org_name', v_row.org_name, 'city', v_row.city, 'lang', v_row.lang),
        'pro_signup_lead:' || v_row.id::text
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $function$;

-- ── 2 bis. Accès démo : lire, créer, corriger, couper, noter le partage ────
CREATE OR REPLACE FUNCTION public.crm_admin_demo_links()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object(
    'links', COALESCE((SELECT jsonb_agg(public._crm_demo_access_json(l.id) ORDER BY l.created_at DESC)
                         FROM public.demo_preview_links l
                        WHERE 'crm' = ANY (l.target_accounts) AND l.venue_id IS NULL AND l.organizer_user_id IS NULL),
                      '[]'::jsonb),
    -- Invitations encore ouvertes, à lier à un accès démo.
    'invites', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'org_name', i.org_name, 'offer', i.offer,
                                                             'contact_name', i.contact_name, 'email', i.email,
                                                             'phone', i.phone, 'lang', i.lang)
                                          ORDER BY i.created_at DESC)
                           FROM public.crm_offer_invites i
                          WHERE i.status = 'pending' AND i.expires_at > now()), '[]'::jsonb));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_demo_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_demo_links() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_demo_link_create(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv public.crm_offer_invites%ROWTYPE;
  v_label text;
  v_email text;
  v_lang text;
  v_pw text := NULLIF(trim(COALESCE(p->>'password', '')), '');
  v_days integer := LEAST(GREATEST(COALESCE(NULLIF(p->>'days', '')::int, 30), 1), 180);
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_id uuid;
  v_token text;
  k integer;
BEGIN
  PERFORM public._crm_admin_gate();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023'; END IF;
  IF NULLIF(p->>'invite_id', '') IS NOT NULL THEN
    SELECT * INTO v_inv FROM public.crm_offer_invites WHERE id = (p->>'invite_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  v_label := left(regexp_replace(trim(COALESCE(NULLIF(trim(COALESCE(p->>'label', '')), ''), v_inv.org_name, v_inv.contact_name, '')), '\s+', ' ', 'g'), 120);
  IF v_label = '' THEN RAISE EXCEPTION 'label_required' USING ERRCODE = '22023'; END IF;
  v_email := lower(NULLIF(trim(COALESCE(NULLIF(trim(COALESCE(p->>'email', '')), ''), v_inv.email, '')), ''));
  IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
    RAISE EXCEPTION 'bad_email' USING ERRCODE = '22023';
  END IF;
  v_lang := CASE WHEN p->>'lang' IN ('fr', 'en', 'es') THEN p->>'lang' ELSE COALESCE(v_inv.lang, 'fr') END;
  IF v_pw IS NOT NULL AND length(v_pw) < 4 THEN RAISE EXCEPTION 'password_too_short' USING ERRCODE = '22023'; END IF;
  -- Six caractères sans ambiguïté (ni 0/O, ni 1/l/i) : se lit et se tape au téléphone.
  IF v_pw IS NULL THEN
    v_pw := '';
    FOR k IN 1..6 LOOP
      v_pw := v_pw || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
  END IF;
  SELECT c.id, c.token INTO v_id, v_token
    FROM public.create_demo_preview_link(v_label, v_pw, ARRAY['crm'], v_lang, now() + make_interval(days => v_days), NULL, NULL) c;
  INSERT INTO public.crm_demo_accesses (link_id, contact_name, email, phone, lang, password, invite_id, note, created_by)
  VALUES (v_id,
          left(NULLIF(trim(COALESCE(NULLIF(trim(COALESCE(p->>'contact_name', '')), ''), v_inv.contact_name, '')), ''), 120),
          v_email,
          left(NULLIF(trim(COALESCE(NULLIF(trim(COALESCE(p->>'phone', '')), ''), v_inv.phone, '')), ''), 40),
          v_lang, v_pw, v_inv.id, left(NULLIF(trim(COALESCE(p->>'note', '')), ''), 500), auth.uid());
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'crm_demo_link_create', 'demo_preview_link', v_id::text,
            jsonb_build_object('label', v_label, 'email', v_email, 'invite_id', v_inv.id, 'days', v_days));
  END IF;
  RETURN public._crm_demo_access_json(v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_demo_link_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_demo_link_create(jsonb) TO authenticated, service_role;

-- Corriger le contact d'un accès démo (adresse, numéro, invitation liée).
CREATE OR REPLACE FUNCTION public.crm_admin_demo_link_update(p_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
BEGIN
  PERFORM public._crm_admin_gate();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_demo_accesses WHERE link_id = p_id) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_patch ? 'email' THEN
    v_email := lower(NULLIF(trim(COALESCE(p_patch->>'email', '')), ''));
    IF v_email IS NOT NULL AND (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254) THEN
      RAISE EXCEPTION 'bad_email' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NULLIF(p_patch->>'invite_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.crm_offer_invites WHERE id = (p_patch->>'invite_id')::uuid) THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.crm_demo_accesses SET
    contact_name = CASE WHEN p_patch ? 'contact_name' THEN left(NULLIF(trim(COALESCE(p_patch->>'contact_name', '')), ''), 120) ELSE contact_name END,
    email = CASE WHEN p_patch ? 'email' THEN v_email ELSE email END,
    phone = CASE WHEN p_patch ? 'phone' THEN left(NULLIF(trim(COALESCE(p_patch->>'phone', '')), ''), 40) ELSE phone END,
    invite_id = CASE WHEN p_patch ? 'invite_id' THEN NULLIF(p_patch->>'invite_id', '')::uuid ELSE invite_id END,
    note = CASE WHEN p_patch ? 'note' THEN left(NULLIF(trim(COALESCE(p_patch->>'note', '')), ''), 500) ELSE note END
  WHERE link_id = p_id;
  RETURN public._crm_demo_access_json(p_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_demo_link_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_demo_link_update(uuid, jsonb) TO authenticated, service_role;

-- Couper un accès démo : le lien n'ouvre plus rien, et les sessions déjà
-- ouvertes par lui sont fermées.
CREATE OR REPLACE FUNCTION public.crm_admin_demo_link_revoke(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record;
BEGIN
  PERFORM public._crm_admin_gate();
  UPDATE public.demo_preview_links SET is_active = false, revoked_at = COALESCE(revoked_at, now())
   WHERE id = p_id AND 'crm' = ANY (target_accounts);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  FOR s IN SELECT auth_session_id FROM public.demo_preview_sessions WHERE link_id = p_id LOOP
    BEGIN
      PERFORM public.revoke_auth_session(s.auth_session_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'crm_demo_link_revoke', 'demo_preview_link', p_id::text, '{}'::jsonb);
  END IF;
  RETURN public._crm_demo_access_json(p_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_demo_link_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_demo_link_revoke(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_demo_link_mark(p_id uuid, p_channel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._crm_admin_gate();
  IF p_channel NOT IN ('email', 'whatsapp', 'copy') THEN RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_demo_accesses SET
    emailed_at = CASE WHEN p_channel = 'email' THEN now() ELSE emailed_at END,
    email_count = email_count + CASE WHEN p_channel = 'email' THEN 1 ELSE 0 END,
    shared_at = CASE WHEN p_channel <> 'email' THEN now() ELSE shared_at END
  WHERE link_id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public._crm_demo_access_json(p_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_demo_link_mark(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_demo_link_mark(uuid, text) TO authenticated, service_role;

-- Ce que l'edge met dans l'e-mail d'un accès démo (lien, mot de passe, langue,
-- et le lien d'inscription de l'invitation liée s'il est encore valable).
CREATE OR REPLACE FUNCTION public.crm_demo_link_for_email(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_inv public.crm_offer_invites%ROWTYPE;
BEGIN
  PERFORM public._crm_admin_gate();
  v := public._crm_demo_access_json(p_id);
  IF v IS NULL OR NOT COALESCE((v->>'managed')::boolean, false) THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v->>'status' IN ('revoked', 'expired', 'locked') THEN RAISE EXCEPTION 'not_active' USING ERRCODE = 'P0001'; END IF;
  IF v->>'email' IS NULL THEN RAISE EXCEPTION 'no_email' USING ERRCODE = '22023'; END IF;
  SELECT i.* INTO v_inv FROM public.crm_demo_accesses a JOIN public.crm_offer_invites i ON i.id = a.invite_id
   WHERE a.link_id = p_id;
  RETURN v || jsonb_build_object('signup_url',
    CASE WHEN v_inv.id IS NOT NULL AND public._crm_offer_invite_state(v_inv) = 'pending'
         THEN public.crm_offer_invite_url(v_inv.token, v_inv.lang) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_demo_link_for_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_demo_link_for_email(uuid) TO authenticated, service_role;

-- Après le mot de passe d'un accès démo (edge accept-staff-invitation) : où
-- mène « Créer mon compte » — l'invitation liée si elle vaut encore, sinon
-- l'inscription Yuno CRM dans la langue du lien.
CREATE OR REPLACE FUNCTION public.crm_demo_link_cta(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l public.demo_preview_links%ROWTYPE;
  v_inv public.crm_offer_invites%ROWTYPE;
BEGIN
  SELECT * INTO l FROM public.demo_preview_links WHERE token = p_token;
  IF NOT FOUND OR NOT ('crm' = ANY (l.target_accounts)) THEN RETURN NULL; END IF;
  SELECT i.* INTO v_inv FROM public.crm_demo_accesses a JOIN public.crm_offer_invites i ON i.id = a.invite_id
   WHERE a.link_id = l.id;
  IF v_inv.id IS NOT NULL AND public._crm_offer_invite_state(v_inv) = 'pending' THEN
    RETURN jsonb_build_object('kind', 'invite', 'url', public.crm_offer_invite_url(v_inv.token, v_inv.lang),
                              'org_name', v_inv.org_name, 'offer', v_inv.offer);
  END IF;
  RETURN jsonb_build_object('kind', 'signup', 'url',
    'https://crm.yunoapp.eu' || CASE l.language WHEN 'fr' THEN '/fr/start' WHEN 'es' THEN '/es/start' ELSE '/start' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_demo_link_cta(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_demo_link_cta(text) TO service_role;

-- ── 3. Accès assisté : la vue de l'Admin CRM ───────────────────────────────
-- Un compte CRM = son titulaire (propriétaire du club, ou l'organisateur) :
-- c'est lui qui consent. Démo exclue selon l'interrupteur de l'admin.
CREATE OR REPLACE FUNCTION public.crm_admin_support(p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  RETURN (
    WITH acc AS MATERIALIZED (
      SELECT r->>'id' AS id, r->>'name' AS name, r->>'city' AS city, r->>'type' AS type,
             r->>'contact' AS contact, r->>'email' AS email, r->>'state' AS state,
             COALESCE(NULLIF(r->>'organizer_user_id', '')::uuid,
                      (SELECT v.owner_id FROM public.venues v WHERE v.id = r->>'venue_id')) AS owner_id
        FROM jsonb_array_elements(COALESCE(v_rows, '[]'::jsonb)) r
    ), g AS (
      SELECT DISTINCT ON (x.target_user_id) x.*
        FROM public.admin_support_grants x
       WHERE x.target_user_id IN (SELECT owner_id FROM acc WHERE owner_id IS NOT NULL)
         AND x.status IN ('pending', 'active') AND x.revoked_at IS NULL
         AND (x.expires_at IS NULL OR x.expires_at > now())
       ORDER BY x.target_user_id, x.created_at DESC
    ), s AS (
      SELECT x.target_user_id,
             count(*) FILTER (WHERE x.created_at > now() - interval '90 days') AS n90,
             max(x.created_at) AS last_at,
             max(x.expires_at) FILTER (WHERE x.status = 'active' AND x.expires_at > now()) AS live_until
        FROM public.admin_support_sessions x
       WHERE x.target_user_id IN (SELECT owner_id FROM acc WHERE owner_id IS NOT NULL)
       GROUP BY x.target_user_id
    ), lg AS (
      SELECT a.created_at, a.action, a.table_name, a.target_user_id, a.actor_id
        FROM public.admin_support_audit a
       WHERE a.target_user_id IN (SELECT owner_id FROM acc WHERE owner_id IS NOT NULL)
       ORDER BY a.created_at DESC LIMIT 60
    )
    SELECT jsonb_build_object(
      'at', now(),
      'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', acc.id, 'name', acc.name, 'city', acc.city, 'type', acc.type, 'contact', acc.contact,
          'email', acc.email, 'state', acc.state, 'owner_id', acc.owner_id,
          'grant', CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', g.id, 'status', g.status, 'reason', g.reason, 'initiated_by', g.initiated_by,
            'created_at', g.created_at, 'approved_at', g.approved_at) END,
          'sessions_90', COALESCE(s.n90, 0), 'last_session_at', s.last_at, 'live_until', s.live_until)
          ORDER BY (g.status = 'active') DESC NULLS LAST, (g.status = 'pending') DESC NULLS LAST, acc.name)
        FROM acc LEFT JOIN g ON g.target_user_id = acc.owner_id LEFT JOIN s ON s.target_user_id = acc.owner_id), '[]'::jsonb),
      'log', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'at', lg.created_at, 'action', lg.action, 'table', lg.table_name,
          'account', (SELECT acc.name FROM acc WHERE acc.owner_id = lg.target_user_id LIMIT 1),
          'account_id', (SELECT acc.id FROM acc WHERE acc.owner_id = lg.target_user_id LIMIT 1),
          'by_admin', lg.actor_id IS DISTINCT FROM lg.target_user_id)
          ORDER BY lg.created_at DESC) FROM lg), '[]'::jsonb)));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_support(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_support(boolean) TO authenticated, service_role;

-- Le titulaire tient-il un compte Yuno CRM ? (lien et e-mail de la demande
-- d'accès assisté : la Console CRM plutôt que la Billetterie).
CREATE OR REPLACE FUNCTION public.crm_user_holds_crm(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.venues v
                  WHERE v.owner_id = p_uid AND v.decommissioned_at IS NULL AND public.crm_scope_has_crm('venue:' || v.id))
      OR EXISTS (SELECT 1 FROM public.organizer_profiles o
                  WHERE o.user_id = p_uid AND public.crm_scope_has_crm('org:' || o.user_id::text));
$function$;
REVOKE ALL ON FUNCTION public.crm_user_holds_crm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_user_holds_crm(uuid) TO service_role;

-- Le titulaire ne tient-il QUE le CRM (aucune Billetterie) ?
CREATE OR REPLACE FUNCTION public.crm_user_crm_only(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.crm_user_holds_crm(p_uid)
     AND NOT EXISTS (SELECT 1 FROM public.venues v
                      WHERE v.owner_id = p_uid AND v.decommissioned_at IS NULL
                        AND 'suite' = ANY (public.account_products('venue:' || v.id)))
     AND NOT EXISTS (SELECT 1 FROM public.organizer_profiles o
                      WHERE o.user_id = p_uid AND 'suite' = ANY (public.account_products('org:' || o.user_id::text)));
$function$;
REVOKE ALL ON FUNCTION public.crm_user_crm_only(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_user_crm_only(uuid) TO service_role;

-- L'alerte « accès assisté prêt » mène à l'Admin CRM pour un compte CRM
-- (reprise de 20260824120000, métadonnée `crm` en plus).
CREATE OR REPLACE FUNCTION public.notify_admin_support_grant_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
BEGIN
  -- Seul le passage à 'active' compte : c'est le moment où une session devient
  -- ouvrable, que l'accord vienne d'une acceptation ou d'une demande directe.
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;

  SELECT COALESCE(
           NULLIF(btrim(p.organization_name), ''),
           NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
           p.email
         )
    INTO v_name
    FROM public.profiles p
   WHERE p.id = NEW.target_user_id;

  PERFORM emit_admin_notification(
    'admin_support_access_ready',
    CASE WHEN NEW.initiated_by = 'client'
         THEN 'Un pro demande de l''aide'
         ELSE 'Accès assisté accordé' END,
    COALESCE(v_name, 'Un pro') ||
      CASE WHEN NEW.initiated_by = 'client'
           THEN ' demande que Yuno configure son compte.'
           ELSE ' a accordé l''accès assisté.' END,
    'high',
    'support_grant',
    NEW.id::text,
    jsonb_build_object('grant_id', NEW.id, 'target_user_id', NEW.target_user_id,
                       'initiated_by', NEW.initiated_by,
                       'crm', public.crm_user_crm_only(NEW.target_user_id)),
    'support_grant_ready:' || NEW.id::text
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

-- ── Notifications de la Console CRM : la demande d'accès assisté ───────────
-- Reprise du corps LIVE de _crm_notif_list (pg_get_functiondef, 19/10) avec
-- deux entrées : « support_request » (à faire) et « support_live » (en cours).
CREATE OR REPLACE FUNCTION public._crm_notif_list(p_venue_id text, p_organizer_user_id uuid, p_user uuid, p_enrich boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  cfg jsonb := public.crm_pricing_config();
  v_def jsonb := public.crm_notif_defaults();
  v_pref public.crm_notification_prefs%ROWTYPE;
  v_kinds jsonb := '{}'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_balance integer := public.crm_yunits_balance(v_scope);
  v_threshold integer;
  v_short boolean := false;
  v_cum integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_left integer := 2;
  k text;
  r record;
  it jsonb;
  st public.crm_notification_states%ROWTYPE;
  v_buyers integer;
BEGIN
  -- Préférences « dans Yuno » de la personne (défauts complétés).
  SELECT * INTO v_pref FROM public.crm_notification_prefs WHERE scope_key = v_scope AND user_id = p_user;
  FOR k IN SELECT jsonb_object_keys(v_def) LOOP
    v_kinds := v_kinds || jsonb_build_object(k,
      CASE WHEN COALESCE((v_def->k->>'lock')::boolean, false) THEN v_def->k
           ELSE (v_def->k) || COALESCE(v_pref.prefs->k, '{}'::jsonb) END);
  END LOOP;
  v_threshold := COALESCE(v_pref.low_balance, (cfg->>'low_balance')::int, 2000);

  -- ── À faire ───────────────────────────────────────────────────────────────
  -- Un envoi programmé dans l'heure.
  FOR r IN SELECT c.id, c.name, c.scheduled_at FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now() AND c.scheduled_at <= now() + interval '1 hour'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_soon:' || r.id, 'kind', 'send_soon', 'cat', 'envois', 'tone', 'todo',
      'need', true, 'lock', false, 'pref', 'prog', 'at', LEAST(now(), r.scheduled_at - interval '1 hour'), 'due_at', r.scheduled_at,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.scheduled_at,
                                   'recipients', public._crm_campaign_estimate(r.id)));
  END LOOP;

  -- Des Yunits qui manquent pour les envois programmés (le premier qui casse).
  FOR r IN SELECT c.id, c.name, c.scheduled_at,
                  public._crm_campaign_estimate(c.id) * (cfg->'rates'->>'email')::int AS cost
             FROM public.email_campaigns c
            WHERE c.status = 'scheduled' AND c.scheduled_at > now()
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
            ORDER BY c.scheduled_at LOOP
    v_cum := v_cum + COALESCE(r.cost, 0);
    IF v_cum > v_balance THEN
      v_short := true;
      v_items := v_items || jsonb_build_object('id', 'yunits_short:' || r.id, 'kind', 'yunits_short', 'cat', 'envois', 'tone', 'todo',
        'need', true, 'lock', false, 'pref', 'bloque', 'at', now(), 'due_at', r.scheduled_at,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'missing', v_cum - v_balance, 'cost', r.cost, 'balance', v_balance));
      EXIT;
    END IF;
  END LOOP;

  -- La synchro Shotgun interrompue (verrouillée), puis reprise.
  FOR r IN SELECT c.id, c.status, c.last_ok_at, c.last_error_at, c.fail_count FROM public.ticketing_connections c
            WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
               OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id) LOOP
    IF r.status = 'token_invalid'
       OR (r.last_error_at IS NOT NULL AND (r.last_ok_at IS NULL OR r.last_error_at > r.last_ok_at) AND COALESCE(r.fail_count, 0) >= 3) THEN
      v_items := v_items || jsonb_build_object('id', 'sync_broken:' || r.id || ':' || to_char(COALESCE(r.last_ok_at, r.last_error_at, now()), 'YYYYMMDD'),
        'kind', 'sync_broken', 'cat', 'donnees', 'tone', 'todo', 'need', true, 'lock', true, 'pref', 'sync',
        'at', COALESCE(r.last_error_at, now()), 'due_at', NULL, 'params', jsonb_build_object('since_at', COALESCE(r.last_ok_at, r.last_error_at)));
    ELSIF r.last_error_at IS NOT NULL AND r.last_error_at > now() - interval '7 days' AND r.last_ok_at > r.last_error_at THEN
      v_items := v_items || jsonb_build_object('id', 'sync_resolved:' || r.id || ':' || to_char(r.last_ok_at, 'YYYYMMDD'),
        'kind', 'sync_resolved', 'cat', 'donnees', 'tone', 'ok', 'need', false, 'lock', false, 'pref', 'sync',
        'at', r.last_ok_at, 'due_at', NULL, 'params', '{}'::jsonb);
    END IF;
  END LOOP;

  -- L'abonnement : essai qui finit, compte en pause.
  FOR r IN SELECT s.status, s.trial_ends_at, s.stripe_subscription_id FROM public.crm_subscriptions s WHERE s.scope_key = v_scope LOOP
    IF r.status = 'trialing' AND r.stripe_subscription_id IS NULL AND r.trial_ends_at > now() AND r.trial_ends_at <= now() + interval '3 days' THEN
      v_items := v_items || jsonb_build_object('id', 'trial_ending:' || to_char(r.trial_ends_at, 'YYYYMMDD'),
        'kind', 'trial_ending', 'cat', 'compte', 'tone', 'warn', 'need', true, 'lock', false, 'pref', NULL,
        'at', r.trial_ends_at - interval '3 days', 'due_at', NULL,
        'params', jsonb_build_object('days', GREATEST(1, ceil(extract(epoch FROM r.trial_ends_at - now()) / 86400))::int));
    END IF;
  END LOOP;
  IF public.crm_effective_plan(v_scope) = 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'account_paused', 'kind', 'account_paused', 'cat', 'compte', 'tone', 'todo',
      'need', true, 'lock', true, 'pref', NULL, 'at', now(), 'due_at', NULL, 'params', '{}'::jsonb);
  END IF;

  -- Accès assisté (20261019420000) : une demande de l'équipe Yuno attend la
  -- réponse du titulaire (le consentement est le sien : elle ne vise que lui),
  -- et une session de l'équipe Yuno en cours dans le compte.
  FOR r IN SELECT g.id, g.created_at FROM public.admin_support_grants g
            WHERE g.target_user_id = p_user AND g.status = 'pending' AND g.revoked_at IS NULL
              AND (g.expires_at IS NULL OR g.expires_at > now())
            ORDER BY g.created_at DESC LIMIT 1 LOOP
    v_items := v_items || jsonb_build_object('id', 'support_request:' || r.id, 'kind', 'support_request', 'cat', 'compte', 'tone', 'todo',
      'need', true, 'lock', false, 'pref', NULL, 'at', r.created_at, 'due_at', NULL,
      'params', jsonb_build_object('grant_id', r.id));
  END LOOP;
  FOR r IN SELECT s.id, s.created_at, s.expires_at FROM public.admin_support_sessions s
            WHERE s.target_user_id = p_user AND s.status = 'active' AND s.expires_at > now()
            ORDER BY s.created_at DESC LIMIT 1 LOOP
    v_items := v_items || jsonb_build_object('id', 'support_live:' || r.id, 'kind', 'support_live', 'cat', 'compte', 'tone', 'warn',
      'need', false, 'lock', true, 'pref', NULL, 'at', r.created_at, 'due_at', NULL,
      'params', jsonb_build_object('until_at', r.expires_at));
  END LOOP;

  -- ── Historique (30 jours) ─────────────────────────────────────────────────
  FOR r IN SELECT c.id, c.name, c.sent_at, COALESCE(NULLIF(c.recipients_count, 0), c.total_recipients, 0) AS n,
                  COALESCE(c.clickers_count, 0) AS clickers, COALESCE(c.policy_skipped_count, 0) + COALESCE(c.suppressed_count, 0) AS excluded
             FROM public.email_campaigns c
            WHERE c.status = 'sent' AND c.sent_at > now() - interval '30 days'
              AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
              AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id LOOP
    v_items := v_items || jsonb_build_object('id', 'send_done:' || r.id, 'kind', 'send_done', 'cat', 'envois', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'prog', 'at', r.sent_at, 'due_at', NULL,
      'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'at', r.sent_at, 'recipients', r.n));
    IF r.sent_at < now() - interval '20 hours' THEN
      SELECT buyers INTO v_buyers FROM public.crm_notif_report_cache WHERE campaign_id = r.id;
      IF v_buyers IS NULL AND p_enrich AND v_left > 0 THEN
        v_left := v_left - 1;
        BEGIN
          v_buyers := COALESCE((public.crm_email_result__core(p_venue_id, p_organizer_user_id, r.id)->'stats'->>'purchases')::int, 0);
          BEGIN
            INSERT INTO public.crm_notif_report_cache (campaign_id, buyers) VALUES (r.id, v_buyers)
            ON CONFLICT (campaign_id) DO UPDATE SET buyers = EXCLUDED.buyers, computed_at = now();
          EXCEPTION WHEN others THEN NULL;
          END;
        EXCEPTION WHEN others THEN v_buyers := NULL;
        END;
      END IF;
      v_items := v_items || jsonb_build_object('id', 'send_report:' || r.id, 'kind', 'send_report', 'cat', 'envois', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'rapport', 'at', r.sent_at + interval '20 hours', 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'clickers', r.clickers, 'buyers', v_buyers));
    END IF;
    IF r.excluded > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'send_blocked:' || r.id, 'kind', 'send_blocked', 'cat', 'envois', 'tone', 'warn',
        'need', false, 'lock', false, 'pref', 'bloque', 'at', r.sent_at, 'due_at', NULL,
        'params', jsonb_build_object('campaign_id', r.id, 'name', r.name, 'excluded', r.excluded));
    END IF;
  END LOOP;

  FOR r IN SELECT i.list_import_id, i.finished_at, i.new_count, i.existing_count, i.file_dup_count FROM public.crm_imports i
            WHERE i.scope_key = v_scope AND i.status = 'done' AND i.finished_at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'import_done:' || r.list_import_id, 'kind', 'import_done', 'cat', 'donnees', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'import', 'at', r.finished_at, 'due_at', NULL,
      'params', jsonb_build_object('added', COALESCE(r.new_count, 0), 'merged', COALESCE(r.existing_count, 0) + COALESCE(r.file_dup_count, 0)));
  END LOOP;

  FOR r IN SELECT count(*)::int AS n FROM public.contact_engagement e WHERE e.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id) AND e.status = 'unreachable' LOOP
    IF r.n > 0 THEN
      v_items := v_items || jsonb_build_object('id', 'contacts_unreadable:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
        'kind', 'contacts_unreadable', 'cat', 'donnees', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'import',
        'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
        'params', jsonb_build_object('n', r.n));
    END IF;
  END LOOP;

  FOR r IN SELECT m.id, m.at, m.delta FROM public.crm_yunit_moves m
            WHERE m.scope_key = v_scope AND m.kind = 'credit' AND m.lot_kind = 'purchase' AND m.at > now() - interval '30 days' LOOP
    v_items := v_items || jsonb_build_object('id', 'recharge_done:' || r.id, 'kind', 'recharge_done', 'cat', 'compte', 'tone', 'ok',
      'need', false, 'lock', false, 'pref', 'facture', 'at', r.at, 'due_at', NULL,
      'params', jsonb_build_object('amount', r.delta, 'balance', v_balance));
  END LOOP;

  IF NOT v_short AND v_balance < v_threshold AND public.crm_effective_plan(v_scope) <> 'paused' THEN
    v_items := v_items || jsonb_build_object('id', 'yunits_low:' || v_threshold || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'IYYYIW'),
      'kind', 'yunits_low', 'cat', 'envois', 'tone', 'warn', 'need', false, 'lock', false, 'pref', 'solde',
      'at', date_trunc('week', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
      'params', jsonb_build_object('balance', v_balance, 'threshold', v_threshold));
  END IF;

  IF p_organizer_user_id IS NOT NULL THEN
    FOR r IN SELECT om.id, om.accepted_at, om.member_user_id,
                    COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), om.member_email) AS name
               FROM public.org_members om LEFT JOIN public.profiles p ON p.id = om.member_user_id
              WHERE om.organizer_user_id = p_organizer_user_id AND om.invitation_status = 'accepted'
                AND om.accepted_at > now() - interval '30 days' AND om.member_user_id IS DISTINCT FROM p_user LOOP
      v_items := v_items || jsonb_build_object('id', 'team_joined:' || r.id, 'kind', 'team_joined', 'cat', 'compte', 'tone', 'info',
        'need', false, 'lock', false, 'pref', 'equipe', 'at', r.accepted_at, 'due_at', NULL,
        'params', jsonb_build_object('name', r.name));
    END LOOP;
  END IF;

  -- Scénarios : l'étape « Me prévenir » (20261016130000), un compteur par jour
  -- et par étape, jamais une alerte par personne. Le libellé est celui de la
  -- version en ligne (sinon du brouillon).
  FOR r IN SELECT d.scenario_id, d.node_id, d.day, d.n, s.name,
                  COALESCE(v.graph->'nodes'->d.node_id->>'label', s.draft->'nodes'->d.node_id->>'label') AS label
             FROM public.crm_scenario_notify_daily d
             JOIN public.crm_scenarios s ON s.id = d.scenario_id
             LEFT JOIN public.crm_scenario_versions v ON v.id = s.live_version_id
            WHERE s.scope_key = v_scope AND d.n > 0
              AND d.day > (now() AT TIME ZONE 'Europe/Paris')::date - 30 LOOP
    v_items := v_items || jsonb_build_object('id', 'scenario_notify:' || r.scenario_id || ':' || r.node_id || ':' || to_char(r.day, 'YYYYMMDD'),
      'kind', 'scenario_notify', 'cat', 'envois', 'tone', 'info', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', LEAST(now(), (r.day::timestamp + interval '23 hours 59 minutes') AT TIME ZONE 'Europe/Paris'), 'due_at', NULL,
      'params', jsonb_build_object('scenario_id', r.scenario_id, 'name', r.name, 'label', COALESCE(r.label, ''), 'n', r.n,
                                   'seen_at', (r.day::timestamp + interval '12 hours') AT TIME ZONE 'Europe/Paris',
                                   'today', r.day = (now() AT TIME ZONE 'Europe/Paris')::date));
  END LOOP;

  -- Plan de soirée prêt (lot A1) : compte en essai, premier import fait,
  -- analyse calculée, prochaine soirée à plus de 24 h. Une entrée par soirée.
  FOR r IN SELECT e.id, e.title, e.start_at, GREATEST(an.computed_at, tc.done_at) AS at
             FROM public.crm_subscriptions cs
             JOIN public.crm_analysis_state an ON an.scope_key = v_scope AND an.computed_at IS NOT NULL
             CROSS JOIN LATERAL (SELECT max(c.initial_import_done_at) AS done_at FROM public.ticketing_connections c
                                  WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
                                    AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)) tc
             CROSS JOIN LATERAL (SELECT ev.id, ev.title, ev.start_at FROM public.events ev
                                  WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
                                    AND ev.start_at > now() + interval '24 hours'
                                    AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
                                      OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
                                  ORDER BY ev.start_at LIMIT 1) e
            WHERE cs.scope_key = v_scope AND cs.status = 'trialing' AND COALESCE(cs.trial_ends_at, now() + interval '1 day') > now()
              AND tc.done_at IS NOT NULL LOOP
    v_items := v_items || jsonb_build_object('id', 'night_plan_ready:' || r.id,
      'kind', 'night_plan_ready', 'cat', 'donnees', 'tone', 'todo', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', LEAST(now(), r.at), 'due_at', r.start_at,
      'params', jsonb_build_object('event_id', r.id, 'title', r.title, 'start_at', r.start_at));
  END LOOP;

  -- Bilan de la semaine (lot A3) : le lundi à partir de 8 h (Paris).
  IF now() >= ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '8 hours') AT TIME ZONE 'Europe/Paris')
     AND (EXISTS (SELECT 1 FROM public.email_campaigns c
                   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)
                     AND c.sent_at >= ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days') AT TIME ZONE 'Europe/Paris')
                     AND c.sent_at < ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'))
       OR EXISTS (SELECT 1 FROM public.crm_scenarios s WHERE s.scope_key = v_scope AND s.status = 'active')
       OR EXISTS (SELECT 1 FROM public.events ev
                   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
                     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id)))) THEN
    v_items := v_items || jsonb_build_object(
      'id', 'weekly_review:' || to_char(date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days', 'IYYYIW'),
      'kind', 'weekly_review', 'cat', 'envois', 'tone', 'info', 'need', false, 'lock', false, 'pref', 'rapport',
      'at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '8 hours') AT TIME ZONE 'Europe/Paris', 'due_at', NULL,
      'params', jsonb_build_object('from_at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '7 days') AT TIME ZONE 'Europe/Paris',
                                   'to_at', (date_trunc('week', now() AT TIME ZONE 'Europe/Paris') - interval '1 day') AT TIME ZONE 'Europe/Paris'));
  END IF;

  -- ── Préférences et état de la personne ────────────────────────────────────
  FOR it IN SELECT x FROM jsonb_array_elements(v_items) x LOOP
    k := it->>'pref';
    -- Coupée « dans Yuno » : on ne la montre pas (sauf alerte verrouillée).
    CONTINUE WHEN k IS NOT NULL AND NOT COALESCE((it->>'lock')::boolean, false)
                  AND COALESCE((v_kinds->k->>'app')::boolean, true)
                  AND NOT COALESCE((v_kinds->k->>'a')::boolean, true);
    SELECT * INTO st FROM public.crm_notification_states
     WHERE scope_key = v_scope AND user_id = p_user AND item_id = it->>'id';
    v_out := v_out || jsonb_build_array((it - 'pref') || jsonb_build_object(
      'icon', it->>'kind', 'resolved', false, 'href', NULL,
      'read', st.read_at IS NOT NULL, 'archived', st.archived_at IS NOT NULL,
      'snoozed_until', CASE WHEN st.snoozed_until > now() THEN st.snoozed_until END));
  END LOOP;

  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'need')::boolean DESC, (x->>'at')::timestamptz DESC)
                     FROM jsonb_array_elements(v_out) x), '[]'::jsonb);
END;
$function$;
