-- ════════════════════════════════════════════════════════════════════════════
-- Serveur MCP Yuno (2026-10-03) — Claude, ChatGPT, Gemini et Le Chat lisent les
-- chiffres d'un club ou d'un organisateur, avec son accord, en LECTURE SEULE.
-- Doc complète : docs/MCP.md.
--
--   • Le Worker Cloudflare (worker/mcp/*) parle MCP (Streamable HTTP) et OAuth
--     2.1 (DCR, CIMD, PKCE S256). Il n'a AUCUN droit propre : il appelle ces
--     fonctions avec une clé serveur dédiée (service_role seul les exécute).
--   • Aucune session Supabase n'est jamais remise à une IA. L'IA reçoit un jeton
--     opaque (yuno_mcp_at_…) qui n'ouvre QUE https://yunoapp.eu/mcp, stocké ici
--     HACHÉ (sha256), révocable d'un clic depuis la Console.
--   • Une connexion (mcp_grants) = une personne + une IA + les espaces qu'elle a
--     cochés (club / organisation) + un niveau : 'analytics' (chiffres agrégés,
--     aucune identité) ou 'customers' (fiches clients en plus).
--   • mcp_call exécute un outil EN TANT QUE la personne : il pose ses claims
--     (auth.uid() = elle, rôle authenticated), passe la transaction en lecture
--     seule, et n'appelle QUE les RPC d'analyse que la Console appelle déjà —
--     avec leurs portes (portée, argent, seuils de 10). L'IA voit ce que l'écran
--     voit, jamais plus.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_clients (
  id                          text PRIMARY KEY,           -- mcpc_… (DCR) ou l'URL https du document (CIMD)
  kind                        text NOT NULL CHECK (kind IN ('dcr', 'cimd')),
  client_name                 text NOT NULL,
  client_uri                  text,
  logo_uri                    text,
  redirect_uris               text[] NOT NULL,
  token_endpoint_auth_method  text NOT NULL DEFAULT 'none'
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  client_secret_hash          text,
  software_id                 text,
  software_version            text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  last_used_at                timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_clients_created_idx ON public.mcp_clients (created_at);

CREATE TABLE IF NOT EXISTS public.mcp_authorization_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       text NOT NULL REFERENCES public.mcp_clients(id) ON DELETE CASCADE,
  redirect_uri    text NOT NULL,
  state           text,
  code_challenge  text NOT NULL,
  scope           text,
  resource        text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_id        uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  decided_at      timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_auth_requests_created_idx ON public.mcp_authorization_requests (created_at);

CREATE TABLE IF NOT EXISTS public.mcp_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       text NOT NULL REFERENCES public.mcp_clients(id) ON DELETE CASCADE,
  client_name     text NOT NULL,
  spaces          text[] NOT NULL CHECK (cardinality(spaces) BETWEEN 1 AND 20),
  level           text NOT NULL CHECK (level IN ('analytics', 'customers')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  calls_count     integer NOT NULL DEFAULT 0,
  revoked_at      timestamptz,
  revoked_by      uuid,
  revoked_reason  text
);
CREATE INDEX IF NOT EXISTS mcp_grants_user_idx ON public.mcp_grants (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_grants_spaces_idx ON public.mcp_grants USING gin (spaces);

CREATE TABLE IF NOT EXISTS public.mcp_codes (
  code_hash       text PRIMARY KEY,
  grant_id        uuid NOT NULL REFERENCES public.mcp_grants(id) ON DELETE CASCADE,
  client_id       text NOT NULL,
  redirect_uri    text NOT NULL,
  code_challenge  text NOT NULL,
  resource        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  used_at         timestamptz
);

CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  token_hash  text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id    uuid NOT NULL REFERENCES public.mcp_grants(id) ON DELETE CASCADE,
  client_id   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,           -- refresh : consommé par la rotation
  revoked_at  timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_tokens_grant_idx ON public.mcp_tokens (grant_id);
CREATE INDEX IF NOT EXISTS mcp_tokens_expires_idx ON public.mcp_tokens (expires_at);

CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
  id            bigserial PRIMARY KEY,
  grant_id      uuid NOT NULL REFERENCES public.mcp_grants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  tool          text NOT NULL,
  space_key     text,
  args          jsonb,
  status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'denied', 'rate_limited')),
  error         text,
  duration_ms   integer,
  result_bytes  integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_tool_calls_grant_idx ON public.mcp_tool_calls (grant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tool_calls_created_idx ON public.mcp_tool_calls (created_at);

-- RLS totale, AUCUNE policy : tout passe par les fonctions ci-dessous.
ALTER TABLE public.mcp_clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_authorization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_grants                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_codes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tokens                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tool_calls             ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_clients, public.mcp_authorization_requests, public.mcp_grants,
              public.mcp_codes, public.mcp_tokens, public.mcp_tool_calls FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.mcp_tool_calls_id_seq FROM anon, authenticated;

-- ── Petits outils ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._mcp_sha256(p text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$ SELECT encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex') $$;

-- Jeton aléatoire base64url (32 octets = 256 bits par défaut).
CREATE OR REPLACE FUNCTION public._mcp_random(p_bytes integer DEFAULT 32)
RETURNS text LANGUAGE sql VOLATILE
SET search_path = public, extensions
AS $$
  SELECT rtrim(translate(replace(encode(extensions.gen_random_bytes(p_bytes), 'base64'), E'\n', ''), '+/', '-_'), '=')
$$;

-- Une URI de redirection acceptable : https, boucle locale http (RFC 8252), ou
-- un schéma d'application (cursor://, vscode://…). Jamais javascript:, data:,
-- file:, ni http vers un vrai hôte, ni fragment.
CREATE OR REPLACE FUNCTION public._mcp_redirect_ok(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT p IS NOT NULL AND length(p) <= 2000 AND position('#' IN p) = 0 AND p !~ '\s' AND (
       p ~* '^https://[^/?#@]+'
    OR p ~* '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/|\?|$)'
    OR (p ~* '^[a-z][a-z0-9+.-]*:' AND p !~* '^(https?|javascript|data|file|vbscript|blob|about|ftp|ws|wss):')
  )
$$;

-- Comparaison d'une URI demandée aux URI enregistrées. Exacte, sauf pour la
-- boucle locale http où le port est libre (RFC 8252 §7.3).
CREATE OR REPLACE FUNCTION public._mcp_redirect_matches(p_registered text[], p_requested text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_requested = ANY (p_registered)
      OR (p_requested ~* '^http://(localhost|127\.0\.0\.1|\[::1\])'
          AND regexp_replace(p_requested, '^(http://[^/:?]+|http://\[::1\])(:[0-9]+)?', '\1', 'i') = ANY (
                SELECT regexp_replace(r, '^(http://[^/:?]+|http://\[::1\])(:[0-9]+)?', '\1', 'i') FROM unnest(p_registered) r))
$$;

-- Les espaces qu'une personne peut ouvrir à une IA : ceux où elle LIT déjà les
-- chiffres dans la Console. Club = propriétaire, ou manager qui voit
-- l'analytique / la finance / les clients ; organisation = fondateur, ou membre
-- d'équipe admin / éditeur accepté (jamais un scanneur). `money` et
-- `customers` disent ce qu'elle voit ; les RPC appelées le revérifient de toute
-- façon. Le super admin n'a ici QUE ses propres espaces : la connexion d'une IA
-- n'ouvre jamais les données d'un autre client.
CREATE OR REPLACE FUNCTION public._mcp_user_spaces(p_uid uuid)
RETURNS TABLE (space_key text, kind text, space_id text, name text, product text,
               timezone text, role text, money boolean, customers boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'venue:' || v.id, 'venue', v.id, v.name, coalesce(v.product, 'suite'),
         coalesce(v.timezone, 'Europe/Paris'), 'owner', true, true
    FROM public.venues v
   WHERE v.owner_id = p_uid AND v.decommissioned_at IS NULL
  UNION ALL
  SELECT 'venue:' || v.id, 'venue', v.id, v.name, coalesce(v.product, 'suite'),
         coalesce(v.timezone, 'Europe/Paris'), 'manager',
         coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false),
         coalesce(mp.can_view_customers, false) OR coalesce(mp.can_manage_crm, false)
    FROM public.manager_permissions mp
    JOIN public.venues v ON v.id = mp.venue_id
   WHERE mp.user_id = p_uid AND v.decommissioned_at IS NULL
     AND v.owner_id IS DISTINCT FROM p_uid
     AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false)
          OR coalesce(mp.can_view_customers, false) OR coalesce(mp.can_manage_crm, false))
  UNION ALL
  SELECT 'org:' || op.user_id, 'organizer', op.user_id::text, coalesce(nullif(op.display_name, ''), 'Organisation'),
         coalesce(op.product, 'suite'), 'Europe/Paris', 'founder', true, true
    FROM public.organizer_profiles op
   WHERE op.user_id = p_uid
  UNION ALL
  SELECT 'org:' || m.organizer_user_id, 'organizer', m.organizer_user_id::text,
         coalesce(nullif(op.display_name, ''), 'Organisation'), coalesce(op.product, 'suite'), 'Europe/Paris', m.role,
         public.org_member_has_permission(p_uid, m.organizer_user_id, 'view_finance'), true
    FROM public.org_members m
    JOIN public.organizer_profiles op ON op.user_id = m.organizer_user_id
   WHERE m.member_user_id = p_uid AND m.invitation_status = 'accepted' AND m.role IN ('admin', 'editor')
     AND m.organizer_user_id <> p_uid
$$;

-- Ce qu'une IA ne voit JAMAIS (coordonnées GPS d'une visite, IP, navigateur),
-- et au niveau 'analytics' aucune identité (email, téléphone, nom, prénom).
CREATE OR REPLACE FUNCTION public._mcp_redact(p jsonb, p_people boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  k text; v jsonb; o jsonb;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      o := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
        IF lower(k) ~ '^(lat|lng|lon|latitude|longitude|ip|ip_address|ip_hash|user_agent|visitor_hash|session_id|unsubscribe_token|qr_code|token)$' THEN CONTINUE; END IF;
        IF p_people AND lower(k) ~ '^(email|buyer_email|customer_email|guest_email|phone|phone_e164|first_name|last_name|full_name|firstname|lastname|customer_name|guest_name|buyer_name|notes|ban_reason|birthday|birth_date|postal_code|address)$' THEN CONTINUE; END IF;
        o := o || jsonb_build_object(k, public._mcp_redact(v, p_people));
      END LOOP;
      RETURN o;
    WHEN 'array' THEN
      RETURN coalesce((SELECT jsonb_agg(public._mcp_redact(e, p_people) ORDER BY n)
                         FROM jsonb_array_elements(p) WITH ORDINALITY AS x(e, n)), '[]'::jsonb);
    ELSE
      RETURN p;
  END CASE;
END;
$$;

-- Une fenêtre de temps lue dans les arguments : from / to (YYYY-MM-DD) ou days.
CREATE OR REPLACE FUNCTION public._mcp_window(p_args jsonb, p_default_days integer)
RETURNS TABLE (w_from timestamptz, w_to timestamptz, w_days integer)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_to   timestamptz := now();
  v_from timestamptz;
  v_days integer;
BEGIN
  BEGIN
    IF nullif(p_args->>'to', '') IS NOT NULL THEN
      v_to := least(now(), ((p_args->>'to')::date + 1)::timestamptz);
    END IF;
    IF nullif(p_args->>'from', '') IS NOT NULL THEN
      v_from := (p_args->>'from')::date::timestamptz;
    END IF;
  EXCEPTION WHEN others THEN
    v_from := NULL; v_to := now();
  END;
  IF v_from IS NULL THEN
    v_days := greatest(1, least(coalesce(nullif(p_args->>'days', '')::integer, p_default_days), 1095));
    v_from := v_to - make_interval(days => v_days);
  END IF;
  IF v_from > v_to THEN v_from := v_to - interval '1 day'; END IF;
  v_days := greatest(1, ceil(extract(epoch FROM v_to - v_from) / 86400)::integer);
  RETURN QUERY SELECT v_from, v_to, v_days;
END;
$$;

-- Une soirée désignée par l'IA : un id, « last » / « next », ou un bout de
-- titre (la plus proche dans le temps). Toujours dans la portée de l'espace.
CREATE OR REPLACE FUNCTION public._mcp_resolve_event(p_ref text, p_ids uuid[])
RETURNS uuid LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_ref text := btrim(coalesce(p_ref, ''));
  v_id  uuid;
BEGIN
  IF v_ref = '' OR p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN NULL; END IF;
  IF v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_id := v_ref::uuid;
    RETURN CASE WHEN v_id = ANY (p_ids) THEN v_id END;
  END IF;
  IF lower(v_ref) IN ('last', 'latest', 'previous', 'derniere', 'dernière', 'ultima', 'última') THEN
    SELECT e.id INTO v_id FROM public.events e
     WHERE e.id = ANY (p_ids) AND e.cancelled_at IS NULL
       AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
     ORDER BY e.start_at DESC LIMIT 1;
    RETURN v_id;
  END IF;
  IF lower(v_ref) IN ('next', 'upcoming', 'prochaine', 'proxima', 'próxima', 'tonight', 'ce soir', 'esta noche') THEN
    SELECT e.id INTO v_id FROM public.events e
     WHERE e.id = ANY (p_ids) AND e.cancelled_at IS NULL
       AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
     ORDER BY e.start_at ASC LIMIT 1;
    RETURN v_id;
  END IF;
  SELECT e.id INTO v_id FROM public.events e
   WHERE e.id = ANY (p_ids) AND e.cancelled_at IS NULL
     AND lower(e.title) LIKE '%' || lower(v_ref) || '%'
   ORDER BY abs(extract(epoch FROM e.start_at - now())) ASC LIMIT 1;
  RETURN v_id;
END;
$$;

-- ── OAuth : enregistrement des clients ──────────────────────────────────────

-- Enregistrement dynamique (RFC 7591). Le client choisit son nom et ses URI de
-- redirection ; Yuno génère l'identifiant et, pour un client confidentiel, le
-- secret (rendu UNE fois, stocké haché).
CREATE OR REPLACE FUNCTION public.mcp_oauth_register_client(p_meta jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uris   text[];
  v_name   text;
  v_method text := coalesce(nullif(p_meta->>'token_endpoint_auth_method', ''), 'none');
  v_id     text := 'mcpc_' || public._mcp_random(18);
  v_secret text;
  u        text;
BEGIN
  IF (SELECT count(*) FROM public.mcp_clients WHERE kind = 'dcr' AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'temporarily_unavailable');
  END IF;
  IF jsonb_typeof(p_meta->'redirect_uris') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_redirect_uri');
  END IF;
  SELECT array_agg(x) INTO v_uris FROM jsonb_array_elements_text(p_meta->'redirect_uris') x;
  IF v_uris IS NULL OR cardinality(v_uris) NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_redirect_uri');
  END IF;
  FOREACH u IN ARRAY v_uris LOOP
    IF NOT public._mcp_redirect_ok(u) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_redirect_uri', 'uri', left(u, 200));
    END IF;
  END LOOP;
  IF v_method NOT IN ('none', 'client_secret_post', 'client_secret_basic') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_client_metadata');
  END IF;
  v_name := left(btrim(regexp_replace(coalesce(nullif(p_meta->>'client_name', ''), 'MCP client'), '[[:cntrl:]<>]', '', 'g')), 80);
  IF v_name = '' THEN v_name := 'MCP client'; END IF;
  IF v_method <> 'none' THEN v_secret := 'yuno_mcp_cs_' || public._mcp_random(32); END IF;

  INSERT INTO public.mcp_clients (id, kind, client_name, client_uri, logo_uri, redirect_uris,
                                  token_endpoint_auth_method, client_secret_hash, software_id, software_version)
  VALUES (v_id, 'dcr', v_name,
          CASE WHEN p_meta->>'client_uri' ~* '^https://' THEN left(p_meta->>'client_uri', 500) END,
          CASE WHEN p_meta->>'logo_uri' ~* '^https://' THEN left(p_meta->>'logo_uri', 500) END,
          v_uris, v_method, CASE WHEN v_secret IS NOT NULL THEN public._mcp_sha256(v_secret) END,
          left(p_meta->>'software_id', 120), left(p_meta->>'software_version', 60));

  RETURN jsonb_build_object('ok', true, 'client_id', v_id, 'client_secret', v_secret,
                            'client_name', v_name, 'redirect_uris', to_jsonb(v_uris),
                            'token_endpoint_auth_method', v_method);
END;
$$;

-- Client ID Metadata Document : l'identifiant EST l'URL https du document, que
-- le Worker a lu et vérifié (client_id identique, URI valides). On le garde en
-- cache pour relier les connexions à un client stable.
CREATE OR REPLACE FUNCTION public.mcp_oauth_upsert_cimd_client(p_client_id text, p_meta jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uris text[];
  v_name text;
  u      text;
BEGIN
  IF p_client_id !~* '^https://[^/?#]+/[^#]*$' OR length(p_client_id) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_client');
  END IF;
  IF jsonb_typeof(p_meta->'redirect_uris') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_client');
  END IF;
  SELECT array_agg(x) INTO v_uris FROM jsonb_array_elements_text(p_meta->'redirect_uris') x;
  IF v_uris IS NULL OR cardinality(v_uris) NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_client');
  END IF;
  FOREACH u IN ARRAY v_uris LOOP
    IF NOT public._mcp_redirect_ok(u) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_client');
    END IF;
  END LOOP;
  v_name := left(btrim(regexp_replace(coalesce(nullif(p_meta->>'client_name', ''),
                  substring(p_client_id from '^https://([^/]+)')), '[[:cntrl:]<>]', '', 'g')), 80);

  INSERT INTO public.mcp_clients AS c (id, kind, client_name, client_uri, logo_uri, redirect_uris, token_endpoint_auth_method)
  VALUES (p_client_id, 'cimd', v_name,
          CASE WHEN p_meta->>'client_uri' ~* '^https://' THEN left(p_meta->>'client_uri', 500) END,
          CASE WHEN p_meta->>'logo_uri' ~* '^https://' THEN left(p_meta->>'logo_uri', 500) END,
          v_uris, 'none')
  ON CONFLICT (id) DO UPDATE
     SET client_name = EXCLUDED.client_name, client_uri = EXCLUDED.client_uri,
         logo_uri = EXCLUDED.logo_uri, redirect_uris = EXCLUDED.redirect_uris, updated_at = now()
   WHERE c.kind = 'cimd';
  RETURN jsonb_build_object('ok', true, 'client_id', p_client_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_oauth_client(p_client_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', c.id, 'kind', c.kind, 'client_name', c.client_name,
                            'redirect_uris', to_jsonb(c.redirect_uris),
                            'token_endpoint_auth_method', c.token_endpoint_auth_method,
                            'updated_at', c.updated_at)
    FROM public.mcp_clients c WHERE c.id = p_client_id
$$;

-- ── OAuth : autorisation ────────────────────────────────────────────────────

-- Le Worker valide la requête /oauth/authorize et la range ici, puis envoie la
-- personne sur la page de consentement de Yuno (/connect-ai?request=…).
CREATE OR REPLACE FUNCTION public.mcp_oauth_create_request(
  p_client_id text, p_redirect_uri text, p_state text, p_code_challenge text,
  p_scope text, p_resource text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c  public.mcp_clients%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public.mcp_clients WHERE id = p_client_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_client', 'redirect_ok', false); END IF;
  IF NOT public._mcp_redirect_matches(c.redirect_uris, p_redirect_uri) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_redirect_uri', 'redirect_ok', false);
  END IF;
  IF p_code_challenge IS NULL OR p_code_challenge !~ '^[A-Za-z0-9_-]{43,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request', 'redirect_ok', true,
                              'description', 'PKCE S256 code_challenge required');
  END IF;
  IF length(coalesce(p_state, '')) > 2000 OR length(coalesce(p_scope, '')) > 300 OR length(coalesce(p_resource, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request', 'redirect_ok', true);
  END IF;
  INSERT INTO public.mcp_authorization_requests (client_id, redirect_uri, state, code_challenge, scope, resource)
  VALUES (c.id, p_redirect_uri, p_state, p_code_challenge, nullif(p_scope, ''), nullif(p_resource, ''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'request_id', v_id);
END;
$$;

-- Page de consentement : ce que demande l'IA, et les espaces de la personne.
CREATE OR REPLACE FUNCTION public.mcp_get_authorization_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r     public.mcp_authorization_requests%ROWTYPE;
  c     public.mcp_clients%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO r FROM public.mcp_authorization_requests WHERE id = p_request_id;
  IF NOT FOUND OR r.status <> 'pending' OR r.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  SELECT * INTO c FROM public.mcp_clients WHERE id = r.client_id;
  RETURN jsonb_build_object(
    'ok', true,
    'client', jsonb_build_object(
      'name', c.client_name, 'uri', c.client_uri, 'logo', c.logo_uri, 'kind', c.kind,
      'redirect_host', coalesce(substring(r.redirect_uri from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]+)'), r.redirect_uri)),
    'scope', r.scope,
    'support_session', public.is_support_session(),
    'spaces', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', s.space_key, 'kind', s.kind, 'name', s.name, 'product', s.product,
        'role', s.role, 'money', s.money, 'customers', s.customers) ORDER BY s.kind DESC, s.name)
      FROM (SELECT DISTINCT ON (space_key) * FROM public._mcp_user_spaces(v_uid) ORDER BY space_key, role) s), '[]'::jsonb),
    'existing', EXISTS (SELECT 1 FROM public.mcp_grants g
                         WHERE g.user_id = v_uid AND g.client_id = r.client_id AND g.revoked_at IS NULL)
  );
END;
$$;

-- La personne accepte : la connexion naît, le code d'autorisation aussi. Le
-- navigateur repart vers l'IA avec code + state + iss (RFC 9207).
CREATE OR REPLACE FUNCTION public.mcp_approve_authorization(p_request_id uuid, p_spaces text[], p_level text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  r       public.mcp_authorization_requests%ROWTYPE;
  c       public.mcp_clients%ROWTYPE;
  v_grant uuid;
  v_code  text;
  v_bad   text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  -- Une IA ne se connecte jamais pendant un accès assisté : c'est au pro de
  -- décider qui lit ses chiffres, pas au support qui travaille dans son compte.
  IF public.is_support_session() THEN RETURN jsonb_build_object('ok', false, 'error', 'support_session'); END IF;
  IF p_level NOT IN ('analytics', 'customers') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_level'); END IF;
  IF p_spaces IS NULL OR cardinality(p_spaces) NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_space');
  END IF;

  SELECT * INTO r FROM public.mcp_authorization_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT x INTO v_bad FROM unnest(p_spaces) x
   WHERE NOT EXISTS (SELECT 1 FROM public._mcp_user_spaces(v_uid) s
                      WHERE s.space_key = x AND (p_level = 'analytics' OR s.customers))
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', CASE WHEN p_level = 'customers' THEN 'customers_not_allowed' ELSE 'forbidden_space' END, 'space', v_bad);
  END IF;

  SELECT * INTO c FROM public.mcp_clients WHERE id = r.client_id;

  -- Une nouvelle connexion de la MÊME IA remplace la précédente : jamais deux
  -- accès parallèles oubliés.
  UPDATE public.mcp_grants SET revoked_at = now(), revoked_by = v_uid, revoked_reason = 'replaced'
   WHERE user_id = v_uid AND client_id = r.client_id AND revoked_at IS NULL;
  UPDATE public.mcp_tokens t SET revoked_at = now()
    FROM public.mcp_grants g
   WHERE t.grant_id = g.id AND g.user_id = v_uid AND g.client_id = r.client_id
     AND g.revoked_reason = 'replaced' AND t.revoked_at IS NULL;

  INSERT INTO public.mcp_grants (user_id, client_id, client_name, spaces, level)
  VALUES (v_uid, r.client_id, c.client_name, (SELECT array_agg(DISTINCT x) FROM unnest(p_spaces) x), p_level)
  RETURNING id INTO v_grant;

  v_code := 'yuno_mcp_ac_' || public._mcp_random(32);
  INSERT INTO public.mcp_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource)
  VALUES (public._mcp_sha256(v_code), v_grant, r.client_id, r.redirect_uri, r.code_challenge, r.resource);

  UPDATE public.mcp_authorization_requests
     SET status = 'approved', user_id = v_uid, grant_id = v_grant, decided_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant, 'redirect_uri', r.redirect_uri,
    'params', jsonb_strip_nulls(jsonb_build_object('code', v_code, 'state', r.state, 'iss', 'https://yunoapp.eu')));
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_deny_authorization(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r     public.mcp_authorization_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO r FROM public.mcp_authorization_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;
  UPDATE public.mcp_authorization_requests SET status = 'denied', user_id = v_uid, decided_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'redirect_uri', r.redirect_uri,
    'params', jsonb_strip_nulls(jsonb_build_object('error', 'access_denied', 'state', r.state, 'iss', 'https://yunoapp.eu')));
END;
$$;

-- ── OAuth : jetons ──────────────────────────────────────────────────────────

-- Révoque tous les jetons d'une connexion (et la connexion si demandé).
CREATE OR REPLACE FUNCTION public._mcp_kill_grant(p_grant uuid, p_reason text, p_revoke_grant boolean)
RETURNS void LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.mcp_tokens SET revoked_at = now() WHERE grant_id = p_grant AND revoked_at IS NULL;
  UPDATE public.mcp_grants SET revoked_at = now(), revoked_reason = p_reason
   WHERE id = p_grant AND revoked_at IS NULL AND p_revoke_grant;
$$;

CREATE OR REPLACE FUNCTION public._mcp_client_auth_ok(c public.mcp_clients, p_secret_hash text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT c.token_endpoint_auth_method = 'none'
      OR (c.client_secret_hash IS NOT NULL AND p_secret_hash IS NOT NULL AND c.client_secret_hash = p_secret_hash)
$$;

-- Échange du code (RFC 6749 §4.1.3 + PKCE). Le Worker génère les jetons et
-- n'envoie que leurs empreintes ; le code est à usage unique : rejoué, il
-- révoque tout ce qu'il a produit.
CREATE OR REPLACE FUNCTION public.mcp_oauth_exchange_code(
  p_code_hash text, p_client_id text, p_redirect_uri text, p_challenge text,
  p_resource text, p_client_secret_hash text, p_access_hash text, p_refresh_hash text,
  p_access_ttl integer, p_refresh_ttl integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c   public.mcp_clients%ROWTYPE;
  k   public.mcp_codes%ROWTYPE;
  g   public.mcp_grants%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.mcp_clients WHERE id = p_client_id;
  IF NOT FOUND OR NOT public._mcp_client_auth_ok(c, p_client_secret_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_client');
  END IF;
  SELECT * INTO k FROM public.mcp_codes WHERE code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_grant'); END IF;
  IF k.used_at IS NOT NULL THEN
    PERFORM public._mcp_kill_grant(k.grant_id, 'code_replay', true);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_grant');
  END IF;
  IF k.expires_at < now() OR k.client_id <> p_client_id OR k.redirect_uri <> p_redirect_uri
     OR k.code_challenge <> coalesce(p_challenge, '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_grant');
  END IF;
  IF k.resource IS NOT NULL AND p_resource IS NOT NULL AND rtrim(k.resource, '/') <> rtrim(p_resource, '/') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target');
  END IF;
  SELECT * INTO g FROM public.mcp_grants WHERE id = k.grant_id;
  IF NOT FOUND OR g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_grant'); END IF;

  UPDATE public.mcp_codes SET used_at = now() WHERE code_hash = k.code_hash;
  INSERT INTO public.mcp_tokens (token_hash, kind, grant_id, client_id, expires_at) VALUES
    (p_access_hash, 'access', g.id, c.id, now() + make_interval(secs => greatest(60, least(p_access_ttl, 86400)))),
    (p_refresh_hash, 'refresh', g.id, c.id, now() + make_interval(secs => greatest(3600, least(p_refresh_ttl, 7776000))));
  UPDATE public.mcp_clients SET last_used_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'grant_id', g.id, 'scope', g.level);
END;
$$;

-- Rafraîchissement avec ROTATION : chaque refresh sert une fois. Deux appels
-- quasi simultanés (30 s) sont tolérés ; un refresh rejoué plus tard est un vol
-- probable : la connexion entière tombe et la personne le voit dans la Console.
CREATE OR REPLACE FUNCTION public.mcp_oauth_refresh(
  p_refresh_hash text, p_client_id text, p_client_secret_hash text,
  p_new_access_hash text, p_new_refresh_hash text, p_access_ttl integer, p_refresh_ttl integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.mcp_clients%ROWTYPE;
  t public.mcp_tokens%ROWTYPE;
  g public.mcp_grants%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.mcp_clients WHERE id = p_client_id;
  IF NOT FOUND OR NOT public._mcp_client_auth_ok(c, p_client_secret_hash) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_client');
  END IF;
  SELECT * INTO t FROM public.mcp_tokens WHERE token_hash = p_refresh_hash AND kind = 'refresh' FOR UPDATE;
  IF NOT FOUND OR t.client_id <> p_client_id OR t.revoked_at IS NOT NULL OR t.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_grant');
  END IF;
  SELECT * INTO g FROM public.mcp_grants WHERE id = t.grant_id;
  IF NOT FOUND OR g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_grant'); END IF;
  IF t.used_at IS NOT NULL AND t.used_at < now() - interval '30 seconds' THEN
    PERFORM public._mcp_kill_grant(g.id, 'refresh_reuse', true);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_grant');
  END IF;
  UPDATE public.mcp_tokens SET used_at = coalesce(used_at, now()) WHERE token_hash = t.token_hash;
  INSERT INTO public.mcp_tokens (token_hash, kind, grant_id, client_id, expires_at) VALUES
    (p_new_access_hash, 'access', g.id, c.id, now() + make_interval(secs => greatest(60, least(p_access_ttl, 86400)))),
    (p_new_refresh_hash, 'refresh', g.id, c.id, now() + make_interval(secs => greatest(3600, least(p_refresh_ttl, 7776000))));
  UPDATE public.mcp_clients SET last_used_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'grant_id', g.id, 'scope', g.level);
END;
$$;

-- RFC 7009 : le client se déconnecte. Révoquer un jeton révoque la connexion.
CREATE OR REPLACE FUNCTION public.mcp_oauth_revoke(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_grant uuid;
BEGIN
  SELECT grant_id INTO v_grant FROM public.mcp_tokens WHERE token_hash = p_token_hash;
  IF v_grant IS NOT NULL THEN PERFORM public._mcp_kill_grant(v_grant, 'client_revoked', true); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── Session MCP : qui parle, sur quels espaces ──────────────────────────────

-- Lecture d'un jeton d'accès valide. Un espace dont la personne a perdu l'accès
-- (manager retiré, club fermé) disparaît aussitôt, sans attendre la révocation.
CREATE OR REPLACE FUNCTION public._mcp_access(p_access_hash text)
RETURNS TABLE (grant_id uuid, user_id uuid, level text, client_name text, spaces text[])
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.id, g.user_id, g.level, g.client_name, g.spaces
    FROM public.mcp_tokens t
    JOIN public.mcp_grants g ON g.id = t.grant_id
    JOIN auth.users u ON u.id = g.user_id
    LEFT JOIN public.profiles p ON p.id = g.user_id
   WHERE t.token_hash = p_access_hash AND t.kind = 'access'
     AND t.revoked_at IS NULL AND t.expires_at > now()
     AND g.revoked_at IS NULL
     AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until < now())
     AND NOT coalesce(p.is_suspended, false)
$$;

CREATE OR REPLACE FUNCTION public.mcp_session(p_access_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  RETURN jsonb_build_object(
    'ok', true, 'grant_id', a.grant_id, 'level', a.level, 'client_name', a.client_name,
    'first_name', (SELECT nullif(btrim(first_name), '') FROM public.profiles WHERE id = a.user_id),
    'language', (SELECT preferred_language FROM public.profiles WHERE id = a.user_id),
    'spaces', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', s.space_key, 'kind', s.kind, 'name', s.name, 'product', s.product,
        'timezone', s.timezone, 'role', s.role, 'money', s.money,
        'customers', s.customers AND a.level = 'customers') ORDER BY array_position(a.spaces, s.space_key))
      FROM (SELECT DISTINCT ON (space_key) * FROM public._mcp_user_spaces(a.user_id) ORDER BY space_key, role) s
      WHERE s.space_key = ANY (a.spaces)), '[]'::jsonb));
END;
$$;

-- ── Les outils ──────────────────────────────────────────────────────────────
-- Chaque outil appelle les RPC de la Console avec la portée de l'espace. Ils
-- tournent DANS mcp_call, claims de la personne posés : auth.uid() est elle.

CREATE OR REPLACE FUNCTION public._mcp_tool(
  p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_venue  text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org    uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_crm    boolean := p_product = 'crm';
  gate     record;
  w        record;
  v_event  uuid;
  v_ref    text;
  v_limit  integer;
  v_offset integer;
  v        jsonb;
  v2       jsonb;
  v3       jsonb;
  v_when   text;
  v_search text;
  v_topic  text;
  v_ids    uuid[];
  v_out    jsonb;
  r        record;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;

  CASE p_tool

  -- ── Contexte ──────────────────────────────────────────────────────────────
  WHEN 'get_account_overview' THEN
    SELECT jsonb_build_object(
      'past_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') < now()),
      'upcoming_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') >= now()),
      'first_event_at', min(e.start_at), 'last_event_at', max(e.start_at) FILTER (WHERE e.start_at < now()))
      INTO v
      FROM public.events e
     WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
       AND (e.is_active OR e.external_source IS NOT NULL);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at), '[]'::jsonb)
      INTO v2
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
             ORDER BY e.start_at LIMIT 5) x;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at DESC), '[]'::jsonb)
      INTO v3
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
             ORDER BY e.start_at DESC LIMIT 5) x;
    v_out := jsonb_build_object(
      'ok', true, 'now', now(), 'timezone', coalesce(gate.tz, p_tz),
      'today_local', to_char(now() AT TIME ZONE coalesce(gate.tz, p_tz), 'YYYY-MM-DD (Dy)'),
      'currency', 'EUR', 'product', p_product, 'can_see_money', gate.money,
      'access_level', p_level, 'events', v, 'next_events', v2, 'last_events', v3);
    IF v_crm THEN
      v_out := v_out || jsonb_build_object('ticketing', public.get_my_ticketing_connections(v_venue, v_org));
    END IF;
    RETURN v_out;

  -- ── Soirées ───────────────────────────────────────────────────────────────
  WHEN 'list_events' THEN
    v_when := coalesce(nullif(p_args->>'when', ''), 'all');
    v_search := nullif(btrim(coalesce(p_args->>'search', '')), '');
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 20), 60));
    IF v_crm THEN
      v := public.get_crm_nights(v_venue, v_org, 200, 0);
      SELECT coalesce(jsonb_agg(n ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                                           (n->>'start_at')::timestamptz DESC), '[]'::jsonb)
        INTO v2
        FROM (SELECT n FROM jsonb_array_elements(v->'nights') n
               WHERE (v_when = 'all' OR (v_when = 'upcoming') = coalesce((n->>'upcoming')::boolean, false))
                 AND (v_search IS NULL OR lower(n->>'title') LIKE '%' || lower(v_search) || '%')
               ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                        (n->>'start_at')::timestamptz DESC
               LIMIT v_limit) q;
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'total', v->'total', 'events', v2);
    END IF;
    v := public.get_analytics_event_rail(v_venue, v_org, 400);
    SELECT coalesce(jsonb_agg(q.e), '[]'::jsonb) INTO v2
      FROM (SELECT e FROM jsonb_array_elements(v->'events') e
             WHERE (v_when = 'all' OR (v_when = 'upcoming' AND e->>'phase' <> 'after')
                    OR (v_when = 'past' AND e->>'phase' = 'after'))
               AND (v_search IS NULL OR lower(e->>'title') LIKE '%' || lower(v_search) || '%')
               AND (nullif(p_args->>'from', '') IS NULL OR (e->>'startAt')::timestamptz >= (p_args->>'from')::date)
               AND (nullif(p_args->>'to', '') IS NULL OR (e->>'startAt')::timestamptz < (p_args->>'to')::date + 1)
             ORDER BY CASE WHEN v_when = 'upcoming' THEN (e->>'startAt')::timestamptz END ASC,
                      (e->>'startAt')::timestamptz DESC
             LIMIT v_limit) q;
    v_out := jsonb_build_object('ok', true, 'money', v->'money', 'events', v2);
    IF v_when IN ('upcoming', 'all') THEN
      -- Jauges et ventes du jour des prochaines soirées (même source que
      -- « Vos prochaines soirées » de l'accueil).
      v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
    END IF;
    RETURN v_out;

  WHEN 'get_event_report' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'event_id', v_event, 'report', public.get_crm_night_report(v_event));
    END IF;
    RETURN public.get_event_report(v_event);

  WHEN 'get_event_details' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v_topic := coalesce(nullif(p_args->>'topic', ''), 'ticket_types');
    CASE v_topic
      WHEN 'ticket_types' THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'name', tr.name, 'price', tr.price, 'capacity', tr.max_tickets, 'sold', tr.tickets_sold,
                 'fill_pct', CASE WHEN coalesce(tr.max_tickets, 0) > 0 THEN round(100.0 * tr.tickets_sold / tr.max_tickets, 1) END,
                 'open', tr.is_active, 'sold_out_by_hand', tr.manually_sold_out, 'hidden', tr.hidden,
                 'type', tr.ticket_type, 'group_size', CASE WHEN tr.is_group THEN tr.group_size END,
                 'sale_starts_at', tr.sale_starts_at, 'sale_ends_at', tr.sale_ends_at,
                 'entry_deadline', tr.entry_deadline, 'includes_free_drink', tr.includes_drink)
               ORDER BY tr.position, tr.price), '[]'::jsonb)
          INTO v
          FROM public.ticket_rounds tr WHERE tr.event_id = v_event;
        SELECT jsonb_build_object('title', e.title, 'start_at', e.start_at, 'selling_mode', e.ticket_selling_mode,
                 'ticketing_enabled', e.ticketing_enabled, 'tables_enabled', e.tables_enabled,
                 'guest_list_parts', (SELECT count(*) FROM public.guest_lists gl WHERE gl.event_id = e.id),
                 'tickets_sold_out', e.tickets_sold_out,
                 'tables_sold_out', e.tables_sold_out, 'guest_list_sold_out', e.guest_list_sold_out,
                 'entry_target', e.entry_target)
          INTO v2 FROM public.events e WHERE e.id = v_event;
        RETURN jsonb_build_object('ok', true, 'event', v2, 'ticket_types', v);
      WHEN 'tables' THEN
        RETURN public.get_vip_table_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'guest_list' THEN
        RETURN public.get_guest_list_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'traffic' THEN
        RETURN public.get_event_traffic(v_event);
      WHEN 'pacing' THEN
        RETURN public.get_analytics_pacing(v_event, 'previous', greatest(7, least(coalesce(nullif(p_args->>'days', '')::integer, 30), 90)));
      WHEN 'door' THEN
        RETURN public.get_analytics_door(v_venue, v_org, v_event, NULL, NULL);
      WHEN 'partners' THEN
        RETURN public.get_collab_party_breakdown(v_event);
      WHEN 'promoters' THEN
        RETURN public.get_analytics_promoters(v_venue, v_org, v_event, NULL, NULL);
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'unknown topic');
    END CASE;

  WHEN 'compare_events' THEN
    v_ids := '{}';
    IF jsonb_typeof(p_args->'events') = 'array' THEN
      FOR v_ref IN SELECT x FROM jsonb_array_elements_text(p_args->'events') x LIMIT 6 LOOP
        v_event := public._mcp_resolve_event(v_ref, gate.scope_ids);
        IF v_event IS NOT NULL AND NOT v_event = ANY (v_ids) THEN v_ids := v_ids || v_event; END IF;
      END LOOP;
    END IF;
    IF cardinality(v_ids) = 0 THEN
      SELECT coalesce(array_agg(x.id ORDER BY x.start_at DESC), '{}') INTO v_ids
        FROM (SELECT e.id, e.start_at FROM public.events e
               WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
                 AND (e.is_active OR e.external_source IS NOT NULL)
                 AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
               ORDER BY e.start_at DESC
               LIMIT greatest(2, least(coalesce(nullif(p_args->>'last', '')::integer, 4), 6))) x;
    END IF;
    v := '[]'::jsonb;
    FOREACH v_event IN ARRAY v_ids LOOP
      IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
        v2 := public.get_crm_night_report(v_event);
        v := v || jsonb_build_array(jsonb_build_object('event_id', v_event, 'source', 'ticketing',
                 'report', v2 - 'curve' - 'buyers_list'));
      ELSE
        v2 := public.get_event_report(v_event);
        v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'event', v2->'event', 'totals', v2->'totals', 'audience', v2->'audience',
                 'channels', v2->'channels', 'visit_sources', v2->'visitSources',
                 'takeaways', v2->'takeaways', 'money', v2->'money')));
      END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'events', v);

  -- ── Ventes ────────────────────────────────────────────────────────────────
  WHEN 'get_sales_overview' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'overview', public.get_crm_overview(v_venue, v_org)); END IF;
    RETURN public.get_sales_takeaways(v_venue, v_org,
      CASE WHEN p_args->>'period' IN ('last', 'last4', 'month', 'year', 'all') THEN p_args->>'period' ELSE 'last4' END);

  WHEN 'get_sales_trends' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'overview', public.get_crm_overview(v_venue, v_org)); END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    RETURN jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to,
      'curve', public.get_sales_period_curve(v_venue, v_org, w.w_from, w.w_to),
      'drivers', public.get_sales_period_drivers(v_venue, v_org, w.w_from, w.w_to),
      'audience', public.get_sales_period_audience(v_venue, v_org, w.w_from, w.w_to));

  WHEN 'get_purchase_behavior' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 180);
    RETURN public.get_purchase_behavior(v_venue, v_org, w.w_from, w.w_to);

  WHEN 'get_promoters_performance' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    RETURN public.get_analytics_promoters(v_venue, v_org, NULL, w.w_from, w.w_to);

  WHEN 'get_live_now' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    RETURN public.get_live_view(v_venue, v_org);

  -- ── Public et trafic ──────────────────────────────────────────────────────
  WHEN 'get_audience_overview' THEN
    RETURN jsonb_build_object('ok', true,
      'community', public.get_community_overview(v_venue, v_org),
      'tastes', public.get_community_tastes(v_venue, v_org),
      'cohorts', public.get_analytics_cohorts(v_venue, v_org, 6));

  WHEN 'get_web_traffic' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 30);
    RETURN jsonb_build_object('ok', true,
      'page', public.get_page_traffic(v_venue, v_org, least(w.w_days, 365)),
      'sources', public.get_analytics_sources(v_venue, v_org, NULL, w.w_from, w.w_to));

  WHEN 'count_contacts' THEN
    IF jsonb_typeof(p_args->'conditions') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'conditions[] required');
    END IF;
    RETURN jsonb_build_object('ok', true, 'definition', jsonb_build_object('conditions', p_args->'conditions'),
      'result', public.count_contact_segment_def(v_venue, v_org, jsonb_build_object('conditions', p_args->'conditions')));

  WHEN 'get_customer_segments' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
             'definition', s.definition, 'origin', s.origin) ORDER BY s.updated_at DESC), '[]'::jsonb)
      INTO v
      FROM (SELECT * FROM public.contact_segments cs
             WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org)
             ORDER BY cs.updated_at DESC LIMIT 30) s;
    RETURN jsonb_build_object('ok', true,
      'rfm', public.get_analytics_rfm(v_venue, v_org),
      'saved_segments', v,
      'imported_lists', public.get_email_lists_health(v_venue, v_org),
      'basket_threshold', public.suggest_basket_threshold(v_venue, v_org));

  -- ── Marketing ─────────────────────────────────────────────────────────────
  WHEN 'get_marketing_performance' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_topic := coalesce(nullif(p_args->>'channel', ''), 'all');
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    IF v_topic IN ('all', 'email') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', c.id, 'name', c.name, 'subject', c.subject, 'type', c.type, 'status', c.status,
               'sent_at', c.sent_at, 'event_id', c.event_id,
               'recipients', coalesce(c.total_recipients, c.recipients_count), 'delivered', c.delivered_count,
               'opens', c.opens_count, 'clicks', c.clicks_count, 'clickers', c.clickers_count,
               'unsubscribes', c.unsubscribes_count, 'bounced', c.bounced_count, 'complaints', c.complained_count,
               'protected_by_yuno_rules', c.policy_skipped_count, 'ab_test', c.ab_enabled, 'ab_winner', c.ab_winner,
               'open_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * c.opens_count / c.delivered_count, 1) END,
               'click_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * coalesce(c.clickers_count, c.clicks_count) / c.delivered_count, 1) END))
             ORDER BY c.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.email_campaigns c
               WHERE ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL))
                 AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                 AND c.sent_at >= w.w_from AND c.sent_at < w.w_to
               ORDER BY c.sent_at DESC LIMIT 20) c;
      v_out := v_out || jsonb_build_object('email_campaigns', v,
        'email_revenue_attribution', public.get_email_campaign_attribution(
            CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text)),
        'best_send_time', public.get_email_send_time_insights(v_venue, v_org));
    END IF;
    IF v_topic IN ('all', 'automations') THEN
      v_out := v_out || jsonb_build_object(
        'email_automations', public.get_email_automation_stats(v_venue, v_org, least(w.w_days, 365)),
        'automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
    END IF;
    IF v_topic IN ('all', 'push') AND NOT v_crm THEN
      v_out := v_out || jsonb_build_object(
        'push_campaigns', public.get_push_campaigns(v_venue, v_org, 'all', NULL, 15, 0),
        'push_automatic', public.get_push_center(v_venue, v_org, least(w.w_days, 365)));
    END IF;
    IF v_topic IN ('all', 'sms') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', s.id, 'name', s.name, 'status', s.status, 'sent_at', s.sent_at, 'event_id', s.event_id,
               'recipients', s.total_recipients, 'sent', s.sent_count, 'delivered', s.delivered_count,
               'failed', s.failed_count, 'credits_used', s.credits_consumed)) ORDER BY s.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.sms_campaigns s
               WHERE ((v_venue IS NOT NULL AND s.venue_id = v_venue) OR (v_org IS NOT NULL AND s.organizer_id = v_org))
                 AND s.sent_at >= w.w_from AND s.sent_at < w.w_to
               ORDER BY s.sent_at DESC LIMIT 15) s;
      v_out := v_out || jsonb_build_object('sms_campaigns', v);
    END IF;
    RETURN v_out;

  WHEN 'get_campaign_report' THEN
    SELECT * INTO r FROM public.email_campaigns c
     WHERE c.id::text = coalesce(p_args->>'campaign_id', '')
       AND ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL));
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;
    SELECT x INTO v FROM jsonb_array_elements(public.get_email_campaign_attribution(
        CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text))->'campaigns') x
     WHERE x->>'campaign_id' = r.id::text OR x->>'id' = r.id::text LIMIT 1;
    RETURN jsonb_build_object('ok', true,
      'campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', r.id, 'name', r.name, 'subject', r.subject, 'subject_b', r.subject_b, 'preheader', r.preheader,
        'status', r.status, 'sent_at', r.sent_at, 'event_id', r.event_id,
        'recipients', coalesce(r.total_recipients, r.recipients_count), 'delivered', r.delivered_count,
        'opens', r.opens_count, 'clicks', r.clicks_count, 'clickers', r.clickers_count,
        'unsubscribes', r.unsubscribes_count, 'bounced', r.bounced_count, 'complaints', r.complained_count,
        'failed', r.failed_count, 'suppressed', r.suppressed_count,
        'protected_by_yuno_rules', r.policy_skipped_count, 'paused_reason', r.paused_reason,
        'audiences', r.audiences_json, 'exclusions', r.exclusions_json, 'resend_enabled', r.resend_enabled,
        'followup_enabled', r.followup_enabled)),
      'revenue_attribution', v,
      'ab_test', CASE WHEN r.ab_enabled THEN public.get_campaign_ab_stats(r.id) END,
      'resend_to_non_openers', CASE WHEN r.resend_enabled THEN public.get_campaign_resend_stats(r.id) END,
      'click_followup', CASE WHEN r.followup_enabled THEN public.get_campaign_followup_stats(r.id) END);

  -- ── Conseils ──────────────────────────────────────────────────────────────
  WHEN 'get_recommendations' THEN
    v_out := jsonb_build_object('ok', true, 'product', p_product);
    IF v_crm THEN
      v_out := v_out || jsonb_build_object('overview', public.get_crm_overview(v_venue, v_org));
    ELSE
      v := public.get_sales_takeaways(v_venue, v_org, 'last4');
      v_out := v_out || jsonb_build_object(
        'sales_takeaways', v->'takeaways',
        'sales_last4_vs_previous4', jsonb_build_object('current', v->'current', 'previous', v->'previous'),
        'upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events',
        'signals_30d', public.get_analytics_insights(v_venue, v_org, NULL, now() - interval '30 days', now(), 'previous'));
    END IF;
    v_out := v_out || jsonb_build_object(
      'rfm', public.get_analytics_rfm(v_venue, v_org),
      'automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org),
      'automations', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a->>'kind', 'enabled', a->'enabled', 'sent', a->'sent')), '[]'::jsonb)
                        FROM jsonb_array_elements(coalesce(public.get_email_automation_stats(v_venue, v_org, 30), '[]'::jsonb)) a));
    RETURN v_out;

  -- ── Fiches clients (niveau 'customers' seulement) ─────────────────────────
  WHEN 'list_customers' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_offset := greatest(0, least(coalesce(nullif(p_args->>'offset', '')::integer, 0), 500));
    v := public.list_contact_base(v_venue, v_org,
           nullif(btrim(coalesce(p_args->>'search', '')), ''),
           CASE WHEN p_args->>'segment_id' ~* '^[0-9a-f-]{36}$' THEN (p_args->>'segment_id')::uuid END,
           CASE WHEN p_args->>'status' IN ('active', 'passive', 'silent', 'new', 'unsubscribed', 'unreachable') THEN p_args->>'status' END,
           CASE WHEN p_args->>'origin' IN ('import', 'yuno', 'both') THEN p_args->>'origin' END,
           NULL,
           CASE WHEN p_args->>'sort' IN ('recent', 'engaged', 'spent', 'events', 'name') THEN p_args->>'sort' ELSE 'spent' END,
           v_limit, v_offset);
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
             'phone', CASE WHEN coalesce((p_args->>'include_phone')::boolean, false) THEN x->>'phone_e164' END,
             'city', x->>'city', 'age', x->'age', 'gender', x->>'gender', 'status', x->>'status',
             'origin', x->>'origin', 'total_spent', x->'total_spent', 'events', x->'event_count',
             'tables', x->'table_count', 'tickets', x->'ticket_count', 'guest_lists', x->'guest_list_count',
             'last_seen_at', x->>'last_seen_at', 'emails_received', x->'emails_sent', 'opens', x->'opens',
             'clicks', x->'clicks', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
      INTO v2
      FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
    RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit, 'customers', v2);

  WHEN 'list_customers_by_segment' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_topic := nullif(p_args->>'segment', '');
    IF v_venue IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_venue_customer_segments(v_venue) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_organizer_customer_segments(v_org) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    END IF;
    RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'customers', v);

  WHEN 'get_customer_profile' THEN
    v_ref := lower(btrim(coalesce(p_args->>'email', '')));
    IF v_ref !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'email required');
    END IF;
    SELECT to_jsonb(cr) - 'id' - 'list_import_id' - 'venue_id' - 'organizer_user_id' - 'user_id' - 'extra' - 'postal_code'
      INTO v
      FROM public.contact_rows(v_venue, v_org) cr WHERE lower(cr.email) = v_ref LIMIT 1;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'customer_not_found'); END IF;
    RETURN jsonb_build_object('ok', true, 'customer', v,
      'automation_emails', public.get_customer_automation_emails(v_venue, v_org, v_ref));

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$$;

-- Outils qui exigent le niveau 'customers'.
CREATE OR REPLACE FUNCTION public._mcp_customer_tool(p_tool text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT p_tool IN ('list_customers', 'list_customers_by_segment', 'get_customer_profile') $$;

-- Outils dont la RPC passe par une table temporaire : CREATE TEMP TABLE est
-- refusé en transaction READ ONLY. Ils restent des lectures (même liste que
-- demo_preview_writable_rpc), seule la ceinture saute pour eux.
CREATE OR REPLACE FUNCTION public._mcp_needs_temp(p_tool text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT p_tool IN ('count_contacts', 'list_customers') $$;

-- ── Le répartiteur ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mcp_call(p_access_hash text, p_tool text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a        record;
  s        record;
  v_args   jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space  text;
  v_call   bigint;
  v_res    jsonb;
  v_min    integer;
  v_day    integer;
  v_cust   integer;
  v_has_space boolean;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;

  IF p_tool IS NULL OR p_tool !~ '^[a-z_]{3,40}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Espace : celui demandé (clé « venue:… » / « org:… ») ou le premier.
  v_space := coalesce(nullif(v_args->>'space', ''), a.spaces[1]);
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Débits : 60 appels / minute, 3 000 / jour, 100 lectures de fiches / jour.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE public._mcp_customer_tool(tool) AND status = 'ok')
    INTO v_min, v_day, v_cust
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';

  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed',
      'spaces', to_jsonb(a.spaces));
  END IF;

  IF v_min >= 60 OR v_day >= 3000 OR (public._mcp_customer_tool(p_tool) AND v_cust >= 100) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  IF public._mcp_customer_tool(p_tool) AND NOT (a.level = 'customers' AND s.customers) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'customers_level_required');
    RETURN jsonb_build_object('ok', false, 'error', 'customers_level_required');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space, left((v_args - 'space')::text, 2000)::jsonb)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    -- La personne, et elle seule : auth.uid(), auth.role(), auth.jwt() la
    -- désignent pour toutes les RPC appelées ensuite. Les deux formes de claims
    -- sont posées (la forme « claim.x » est lue en priorité par auth.uid()).
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    IF NOT public._mcp_needs_temp(p_tool) THEN
      PERFORM set_config('transaction_read_only', 'on', true);
    END IF;

    v_res := public._mcp_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.level);
    v_res := public._mcp_redact(v_res, NOT public._mcp_customer_tool(p_tool));
  EXCEPTION WHEN others THEN
    -- Sous-transaction annulée : claims et lecture seule tombent avec elle, on
    -- peut noter l'échec.
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error', 'internal', 'call_id', v_call,
      'message', CASE WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid argument' ELSE 'query failed' END);
  END;

  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, true), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$$;

-- Le Worker note la durée et la taille après coup (hors transaction de l'outil).
CREATE OR REPLACE FUNCTION public.mcp_call_finished(p_call_id bigint, p_duration_ms integer, p_bytes integer, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.mcp_tool_calls
     SET duration_ms = p_duration_ms, result_bytes = p_bytes,
         status = CASE WHEN p_error IS NOT NULL AND status = 'ok' THEN 'error' ELSE status END,
         error = coalesce(error, left(p_error, 300))
   WHERE id = p_call_id;
$$;

-- ── Console : mes connexions ────────────────────────────────────────────────

-- Les connexions de la personne, ET celles de son équipe qui touchent un espace
-- dont elle est propriétaire / fondatrice : le patron voit qui a branché une IA
-- sur les chiffres de son club, et peut couper.
CREATE OR REPLACE FUNCTION public.mcp_my_connections()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owned text[];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT coalesce(array_agg(space_key), '{}') INTO v_owned
    FROM public._mcp_user_spaces(v_uid) WHERE role IN ('owner', 'founder');
  RETURN jsonb_build_object('ok', true, 'connections', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'client_name', g.client_name, 'level', g.level,
      'created_at', g.created_at, 'last_used_at', g.last_used_at, 'calls_count', g.calls_count,
      'revoked_at', g.revoked_at, 'revoked_reason', g.revoked_reason,
      'mine', g.user_id = v_uid,
      'person', CASE WHEN g.user_id = v_uid THEN NULL ELSE
                  (SELECT coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email)
                     FROM public.profiles p WHERE p.id = g.user_id) END,
      'spaces', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', x,
                    'name', coalesce((SELECT v.name FROM public.venues v WHERE 'venue:' || v.id = x),
                                     (SELECT op.display_name FROM public.organizer_profiles op WHERE 'org:' || op.user_id = x), x))), '[]'::jsonb)
                   FROM unnest(g.spaces) x)
    ) ORDER BY g.revoked_at IS NOT NULL, coalesce(g.last_used_at, g.created_at) DESC)
    FROM public.mcp_grants g
    WHERE (g.user_id = v_uid OR g.spaces && v_owned)
      AND (g.revoked_at IS NULL OR g.revoked_at > now() - interval '30 days')), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_revoke_connection(p_grant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  g     public.mcp_grants%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO g FROM public.mcp_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF g.user_id <> v_uid AND NOT EXISTS (
       SELECT 1 FROM public._mcp_user_spaces(v_uid) s
        WHERE s.role IN ('owner', 'founder') AND s.space_key = ANY (g.spaces)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  UPDATE public.mcp_tokens SET revoked_at = now() WHERE grant_id = g.id AND revoked_at IS NULL;
  UPDATE public.mcp_grants SET revoked_at = now(), revoked_by = v_uid,
         revoked_reason = CASE WHEN g.user_id = v_uid THEN 'user_revoked' ELSE 'owner_revoked' END
   WHERE id = g.id AND revoked_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Le journal d'une connexion : quel outil, quand, sur quel espace, avec quel
-- résultat. Jamais le contenu rendu à l'IA.
CREATE OR REPLACE FUNCTION public.mcp_connection_activity(p_grant_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  g     public.mcp_grants%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO g FROM public.mcp_grants WHERE id = p_grant_id;
  IF NOT FOUND OR (g.user_id <> v_uid AND NOT EXISTS (
       SELECT 1 FROM public._mcp_user_spaces(v_uid) s
        WHERE s.role IN ('owner', 'founder') AND s.space_key = ANY (g.spaces))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  RETURN jsonb_build_object('ok', true, 'calls', coalesce((
    SELECT jsonb_agg(jsonb_build_object('tool', c.tool, 'space', c.space_key, 'status', c.status,
             'created_at', c.created_at, 'duration_ms', c.duration_ms) ORDER BY c.created_at DESC)
      FROM (SELECT * FROM public.mcp_tool_calls WHERE grant_id = g.id
             ORDER BY created_at DESC LIMIT greatest(1, least(coalesce(p_limit, 50), 200))) c), '[]'::jsonb));
END;
$$;

-- ── Ménage ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mcp_housekeeping()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_req integer; n_codes integer; n_tok integer; n_cli integer; n_calls integer;
BEGIN
  DELETE FROM public.mcp_authorization_requests WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n_req = ROW_COUNT;
  DELETE FROM public.mcp_codes WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS n_codes = ROW_COUNT;
  DELETE FROM public.mcp_tokens
   WHERE (expires_at < now() - interval '7 days') OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days');
  GET DIAGNOSTICS n_tok = ROW_COUNT;
  -- Un client enregistré qui n'a jamais servi à une connexion : 30 jours.
  DELETE FROM public.mcp_clients c
   WHERE c.created_at < now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.mcp_grants g WHERE g.client_id = c.id);
  GET DIAGNOSTICS n_cli = ROW_COUNT;
  DELETE FROM public.mcp_tool_calls WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS n_calls = ROW_COUNT;
  RETURN jsonb_build_object('requests', n_req, 'codes', n_codes, 'tokens', n_tok, 'clients', n_cli, 'calls', n_calls);
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mcp-housekeeping';
  PERFORM cron.schedule('mcp-housekeeping', '41 4 * * *', 'SELECT public.mcp_housekeeping();');
END $$;

-- ── Droits ──────────────────────────────────────────────────────────────────
-- Postgres accorde EXECUTE à PUBLIC par défaut : tout est repris, puis rendu à
-- qui en a besoin. Le Worker (clé serveur) = service_role ; la Console =
-- authenticated ; personne d'autre.

REVOKE ALL ON FUNCTION public._mcp_sha256(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_random(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_redirect_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_redirect_matches(text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_user_spaces(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_redact(jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_window(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_resolve_event(text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_kill_grant(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_client_auth_ok(public.mcp_clients, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_access(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_tool(text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_customer_tool(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mcp_needs_temp(text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mcp_oauth_register_client(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_upsert_cimd_client(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_client(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_create_request(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_exchange_code(text, text, text, text, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_refresh(text, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_revoke(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_call(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_call_finished(bigint, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_housekeeping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_register_client(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_upsert_cimd_client(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_client(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_create_request(text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_exchange_code(text, text, text, text, text, text, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_refresh(text, text, text, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_revoke(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_call(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_call_finished(bigint, integer, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.mcp_get_authorization_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_approve_authorization(uuid, text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_deny_authorization(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_my_connections() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_revoke_connection(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mcp_connection_activity(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_get_authorization_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_approve_authorization(uuid, text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_deny_authorization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_my_connections() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_revoke_connection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_connection_activity(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
