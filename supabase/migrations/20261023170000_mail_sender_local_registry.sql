-- Suite de l'audit Yuno CRM du 18/10 — MAIL-15 (P3) : l'adresse d'expédition
-- d'une campagne ne dépend plus seulement du nom du compte.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- AVANT : `<slug du nom>@news.yunoapp.eu`. Deux comptes au même nom
-- partageaient la même adresse (l'un pouvait écrire « depuis » l'autre), et un
-- compte nommé « Support » ou « Yuno » écrivait depuis support@ / yuno@.
--
-- MAINTENANT : un registre, `email_sender_locals` (une adresse par espace,
-- unique). La première fois qu'un espace envoie, il reçoit le slug de son nom
-- s'il est libre et non réservé, sinon le slug suivi de six caractères tirés
-- de l'espace (`rex-club-3f9a1c`). Une fois attribuée, l'adresse ne bouge plus,
-- même si le compte est renommé. Les espaces qui ont déjà envoyé gardent leur
-- adresse d'aujourd'hui (attribuée ici, dans l'ordre de leur premier envoi) ;
-- Yuno garde yuno@.
--   · email_sender_local_claim (service_role) : lue / attribuée par send-campaign ;
--   · email_sender_local_preview : ce que verra la Console (Réglages › Envoi),
--     sans rien attribuer ;
--   · crm_email_settings_get : `from_local` lu par la même porte (réécrit
--     depuis pg_get_functiondef de la prod, seul le calcul de l'adresse change).

CREATE TABLE IF NOT EXISTS public.email_sender_locals (
  scope_key text PRIMARY KEY,
  local_part text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.email_sender_locals IS
  'Adresse d''expédition (partie avant @) de chaque espace qui envoie des campagnes : attribuée une fois, unique (audit 18/10, MAIL-15).';
ALTER TABLE public.email_sender_locals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_sender_locals FROM PUBLIC, anon, authenticated;

-- Slug d'un nom : miroir de slugifyVenueName (_shared/campaign-html.ts).
CREATE OR REPLACE FUNCTION public._email_local_slug(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(NULLIF(left(btrim(regexp_replace(regexp_replace(
           regexp_replace(normalize(lower(COALESCE(p_name, '')), NFD), '[\u0300-\u036f]', '', 'g'),
           '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'), '-'), 64), ''), 'club')
$function$;

-- Adresse qu'aurait l'espace s'il envoyait maintenant (sans rien attribuer).
CREATE OR REPLACE FUNCTION public.email_sender_local_preview(p_scope_key text, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_have text;
  v_slug text := left(public._email_local_slug(p_name), 56);
  v_tag text := left(encode(sha256(convert_to(COALESCE(p_scope_key, ''), 'UTF8')), 'hex'), 6);
  v_reserved text[] := ARRAY['abuse', 'admin', 'administrator', 'billing', 'club', 'contact', 'dpo', 'help', 'hello',
    'hostmaster', 'info', 'legal', 'mailer-daemon', 'marketing', 'news', 'newsletter', 'no-reply', 'noreply',
    'postmaster', 'privacy', 'root', 'sales', 'security', 'support', 'team', 'webmaster', 'yuno', 'yunoapp', 'yuno-crm'];
BEGIN
  SELECT l.local_part INTO v_have FROM public.email_sender_locals l WHERE l.scope_key = p_scope_key;
  IF v_have IS NOT NULL THEN RETURN v_have; END IF;
  IF v_slug = ANY (v_reserved)
     OR EXISTS (SELECT 1 FROM public.email_sender_locals l WHERE l.local_part = v_slug) THEN
    RETURN v_slug || '-' || v_tag;
  END IF;
  RETURN v_slug;
END;
$function$;

-- Adresse de l'espace, attribuée à son premier envoi (service_role).
CREATE OR REPLACE FUNCTION public.email_sender_local_claim(p_scope_key text, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_local text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'email_sender_local_claim: service_role only';
  END IF;
  IF p_scope_key IS NULL OR p_scope_key = '' THEN RAISE EXCEPTION 'email_sender_local_claim: scope required'; END IF;
  SELECT l.local_part INTO v_local FROM public.email_sender_locals l WHERE l.scope_key = p_scope_key;
  IF v_local IS NOT NULL THEN RETURN v_local; END IF;
  v_local := public.email_sender_local_preview(p_scope_key, p_name);
  BEGIN
    INSERT INTO public.email_sender_locals (scope_key, local_part) VALUES (p_scope_key, v_local);
  EXCEPTION WHEN unique_violation THEN
    -- Course : un autre espace vient de prendre ce nom, ou cet espace vient
    -- d'être servi par un autre worker.
    SELECT l.local_part INTO v_local FROM public.email_sender_locals l WHERE l.scope_key = p_scope_key;
    IF v_local IS NOT NULL THEN RETURN v_local; END IF;
    v_local := left(public._email_local_slug(p_name), 56) || '-' || left(encode(sha256(convert_to(p_scope_key, 'UTF8')), 'hex'), 6);
    INSERT INTO public.email_sender_locals (scope_key, local_part) VALUES (p_scope_key, v_local);
  END;
  RETURN v_local;
END;
$function$;

REVOKE ALL ON FUNCTION public._email_local_slug(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_sender_local_preview(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_sender_local_claim(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._email_local_slug(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_sender_local_preview(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_sender_local_claim(text, text) TO service_role;

-- Les espaces qui ont déjà envoyé gardent leur adresse : Yuno d'abord, puis
-- dans l'ordre de leur premier envoi, avec le nom que lit send-campaign
-- (resolveSender : nom du club ; sinon nom de l'organisation du profil, sinon
-- prénom nom, sinon « Organisateur »).
INSERT INTO public.email_sender_locals (scope_key, local_part) VALUES ('yuno', 'yuno')
ON CONFLICT DO NOTHING;

DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT s.scope_key, s.name
      FROM (
        SELECT CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id::text END AS scope_key,
               CASE WHEN c.venue_id IS NOT NULL THEN (SELECT v.name FROM public.venues v WHERE v.id = c.venue_id)
                    ELSE (SELECT COALESCE(NULLIF(p.organization_name, ''), NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), 'Organisateur')
                            FROM public.profiles p WHERE p.id = c.organizer_user_id) END AS name,
               min(c.sent_at) AS first_sent
          FROM public.email_campaigns c
         WHERE c.sent_at IS NOT NULL AND (c.venue_id IS NOT NULL OR c.organizer_user_id IS NOT NULL)
         GROUP BY 1, 2
      ) s
     ORDER BY s.first_sent
  LOOP
    -- Adresse d'aujourd'hui (le slug nu), même réservée : elle a déjà servi.
    INSERT INTO public.email_sender_locals (scope_key, local_part)
    VALUES (r.scope_key, public._email_local_slug(r.name))
    ON CONFLICT DO NOTHING;
    -- Slug déjà gardé par un espace plus ancien : suffixe de l'espace.
    INSERT INTO public.email_sender_locals (scope_key, local_part)
    VALUES (r.scope_key, left(public._email_local_slug(r.name), 56) || '-' || left(encode(sha256(convert_to(r.scope_key, 'UTF8')), 'hex'), 6))
    ON CONFLICT DO NOTHING;
  END LOOP;
END
$backfill$;

CREATE OR REPLACE FUNCTION public.crm_email_settings_get(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.crm_email_settings%ROWTYPE;
  v_name text; v_reply text; v_city text; v_addr text; v_from text;
  v_legal text; v_legal_addr text;
  v_writer boolean;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_writer := public.crm_scope_writable(p_venue_id, p_organizer_user_id);
  SELECT * INTO s FROM public.crm_email_settings WHERE scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id);
  IF p_venue_id IS NOT NULL THEN
    SELECT v.name, p.email, v.city, v.address, v.legal_name, v.legal_address
      INTO v_name, v_reply, v_city, v_addr, v_legal, v_legal_addr
      FROM public.venues v LEFT JOIN public.profiles p ON p.id = v.owner_id WHERE v.id = p_venue_id;
  ELSE
    SELECT COALESCE(NULLIF(btrim(p.organization_name), ''), NULLIF(btrim(op.display_name), ''), btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))),
           p.email, COALESCE(op.city, p.city), NULL, op.legal_name, op.legal_address
      INTO v_name, v_reply, v_city, v_addr, v_legal, v_legal_addr
      FROM public.profiles p LEFT JOIN public.organizer_profiles op ON op.user_id = p.id WHERE p.id = p_organizer_user_id;
  END IF;
  -- Nom dont l'adresse d'envoi est tirée : celui que lit send-campaign
  -- (resolveSender : nom du club, sinon nom de l'organisation du profil,
  -- sinon prénom nom), passé au même slug que slugifyVenueName.
  IF p_venue_id IS NOT NULL THEN
    v_from := v_name;
  ELSE
    SELECT COALESCE(NULLIF(p.organization_name, ''), NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), 'Organisateur')
      INTO v_from FROM public.profiles p WHERE p.id = p_organizer_user_id;
  END IF;
  -- MAIL-15 : l'adresse vient du registre de l'espace (attribuée une fois,
  -- suffixe tiré de l'espace pour un nom réservé ou déjà pris), comme l'envoi.
  v_from := public.email_sender_local_preview(
    CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id::text END, v_from);

  RETURN jsonb_build_object(
    'from_local', v_from,
    'sender_name', s.sender_name, 'legal_name', s.legal_name, 'reply_to', s.reply_to, 'postal_address', s.postal_address,
    'quiet_hours', COALESCE(s.quiet_hours, true), 'waves', COALESCE(s.waves, false), 'notify_done', COALESCE(s.notify_done, true),
    'test_emails', COALESCE(to_jsonb(s.test_emails), '[]'::jsonb), 'updated_at', s.updated_at,
    'readiness', public._crm_email_identity(p_venue_id, p_organizer_user_id),
    'defaults', jsonb_build_object('sender_name', v_name, 'reply_to', v_reply, 'city', v_city, 'address', v_addr,
      'legal_name', CASE WHEN v_writer THEN NULLIF(btrim(v_legal), '') END,
      'legal_address', CASE WHEN v_writer THEN NULLIF(btrim(v_legal_addr), '') END));
END;
$function$;
