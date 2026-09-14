-- ============================================================================
-- Meta (Facebook / Instagram) — Pixel + Conversions API, phase 1 (mode manuel).
-- Design : docs/designs/META_ADS_INTEGRATION_PLAN.md (2026-09-14).
--
-- Une connexion Meta appartient à un club (venue_id), à un organisateur
-- (organizer_user_id) ou à la plateforme Yuno elle-même (les deux NULL, réglée
-- par le super admin) — le même patron « au plus une portée » que
-- venue_sms_contacts et le marketing plateforme.
--
-- Le jeton Conversions API est un secret qui n'expire pas : il vit dans le
-- Vault Supabase (même recette que les secrets TOTP, 20260512100001) et n'est
-- lisible que par service_role. Le front ne voit jamais que « ••••1234 ».
--
-- Trois tables :
--   meta_connections   la connexion (pixel, statut, interrupteurs, santé)
--   meta_capi_outbox   la file de sortie des événements serveur (une ligne par
--                      connexion × événement, idempotente : un retry Stripe ne
--                      double jamais un Purchase)
--   meta_consent_log   la preuve de consentement par commande — le pro et
--                      Meta sont responsables conjoints (art. 26 RGPD), Yuno
--                      lui donne de quoi le prouver. Aucun concurrent ne le fait.
--
-- RLS activée partout, AUCUNE policy : l'écriture passe par l'edge
-- `meta-connect` (service_role), la lecture par les RPC gardées ci-dessous.
-- ============================================================================

-- ── 1. Connexions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id            text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  mode                text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'oauth')),
  pixel_id            text NOT NULL CHECK (pixel_id ~ '^[0-9]{6,32}$'),
  vault_secret_id     uuid,
  token_hint          text,
  -- Code « Événements de test » d'Events Manager : les événements envoyés avec
  -- ce code apparaissent dans l'onglet de test au lieu d'alimenter la pub.
  -- Vidé automatiquement au bout de 7 jours pour ne jamais laisser une
  -- connexion en mode test par oubli.
  test_event_code     text,
  test_event_code_expires_at timestamptz,
  -- Réservé à la phase 2 (Facebook Login for Business).
  business_id         text,
  ad_account_id       text,
  page_id             text,
  ig_user_id          text,
  granted_scopes      text[],
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'token_invalid')),
  -- Interrupteurs par événement. `pixel` = charger le script navigateur sur les
  -- pages publiques (toujours après consentement) ; les autres = événements
  -- serveur (Conversions API).
  events_enabled      jsonb NOT NULL DEFAULT '{"pixel": true, "view_content": true, "initiate_checkout": true, "purchase": true, "lead": true}'::jsonb,
  -- Phase 2 : autoriser l'envoi depuis l'app native (exige un consentement
  -- in-app qui n'existe pas encore). FALSE tant que ce consentement n'existe pas.
  send_native         boolean NOT NULL DEFAULT false,
  verified_at         timestamptz,
  last_ok_at          timestamptz,
  last_error_at       timestamptz,
  last_error          text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_connections_scope_chk CHECK (venue_id IS NULL OR organizer_user_id IS NULL)
);

-- Une connexion par portée. La portée plateforme (les deux NULL) est unique par
-- construction : index d'expression constante sur le prédicat.
CREATE UNIQUE INDEX IF NOT EXISTS meta_connections_venue_uq
  ON public.meta_connections (venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meta_connections_org_uq
  ON public.meta_connections (organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meta_connections_platform_uq
  ON public.meta_connections ((1)) WHERE venue_id IS NULL AND organizer_user_id IS NULL;

ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_connections FROM anon, authenticated;

-- updated_at
CREATE OR REPLACE FUNCTION public.meta_connections_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_meta_connections_touch ON public.meta_connections;
CREATE TRIGGER trg_meta_connections_touch
  BEFORE UPDATE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.meta_connections_touch();

-- Surface identité / argent : une session support (accès assisté Yuno) ne
-- connecte ni ne déconnecte jamais le compte publicitaire d'un pro.
DROP TRIGGER IF EXISTS trg_support_block_meta_connections ON public.meta_connections;
CREATE TRIGGER trg_support_block_meta_connections
  BEFORE INSERT OR UPDATE OR DELETE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- Le secret Vault suit la ligne : supprimer la connexion détruit le jeton.
CREATE OR REPLACE FUNCTION public.meta_connections_drop_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
BEGIN
  IF OLD.vault_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = OLD.vault_secret_id;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_meta_connections_drop_secret ON public.meta_connections;
CREATE TRIGGER trg_meta_connections_drop_secret
  AFTER DELETE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.meta_connections_drop_secret();

-- ── 2. Jeton dans le Vault (service_role seul) ───────────────────────────────

CREATE OR REPLACE FUNCTION public.store_meta_capi_token(p_connection_id uuid, p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_old uuid;
  v_new uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'store_meta_capi_token: service_role only' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RAISE EXCEPTION 'store_meta_capi_token: token too short';
  END IF;

  SELECT vault_secret_id INTO v_old FROM public.meta_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_meta_capi_token: unknown connection';
  END IF;
  IF v_old IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old;
  END IF;

  v_new := vault.create_secret(
    p_token,
    'meta_capi_' || p_connection_id::text,
    'Meta Conversions API token for connection ' || p_connection_id::text
  );

  UPDATE public.meta_connections
     SET vault_secret_id = v_new,
         token_hint = right(p_token, 4),
         status = 'active',
         last_error = NULL,
         last_error_at = NULL
   WHERE id = p_connection_id;
END;
$$;
REVOKE ALL ON FUNCTION public.store_meta_capi_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_meta_capi_token(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_meta_capi_token(p_connection_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_secret text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'get_meta_capi_token: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT ds.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets ds
    JOIN public.meta_connections mc ON mc.vault_secret_id = ds.id
   WHERE mc.id = p_connection_id
   LIMIT 1;
  RETURN v_secret;
END;
$$;
REVOKE ALL ON FUNCTION public.get_meta_capi_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_capi_token(uuid) TO service_role;

-- ── 3. File de sortie Conversions API ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_capi_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid NOT NULL REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  event_name      text NOT NULL,
  -- Déterministe : `ticket:<uuid>`, `table:<uuid>`, `order:<uuid>`, `gl:<uuid>`.
  -- C'est aussi l'`event_id` envoyé à Meta, et celui que le pixel navigateur
  -- répète : Meta ne garde qu'un des deux (dédoublonnage 48 h).
  event_id        text NOT NULL,
  event_kind      text NOT NULL CHECK (event_kind IN ('ticket', 'table', 'order', 'guest_list', 'test')),
  -- Charge utile DÉJÀ hachée (email, téléphone, nom…), sans jeton. Ce qui part
  -- chez Meta, ni plus ni moins : c'est ce que le pro peut auditer.
  payload         jsonb NOT NULL,
  value_cents     integer,
  currency        text,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (connection_id, event_name, event_id)
);
CREATE INDEX IF NOT EXISTS meta_capi_outbox_due_idx
  ON public.meta_capi_outbox (next_attempt_at) WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS meta_capi_outbox_conn_idx
  ON public.meta_capi_outbox (connection_id, created_at DESC);

ALTER TABLE public.meta_capi_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_capi_outbox FROM anon, authenticated;

-- Réclamation atomique d'un lot (deux drainers concurrents : le cron et le
-- fire-and-forget des fonctions verify-*). SKIP LOCKED : jamais deux envois.
-- Une ligne restée `sending` plus de 10 min (worker tué) redevient éligible.
CREATE OR REPLACE FUNCTION public.claim_meta_capi_outbox(p_limit integer DEFAULT 50)
RETURNS SETOF public.meta_capi_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_meta_capi_outbox: service_role only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
      FROM public.meta_capi_outbox o
     WHERE (o.status = 'queued' AND o.next_attempt_at <= now())
        OR (o.status = 'sending' AND o.next_attempt_at <= now() - interval '10 minutes')
     ORDER BY o.next_attempt_at
     LIMIT GREATEST(1, LEAST(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.meta_capi_outbox o
     SET status = 'sending', next_attempt_at = now()
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_meta_capi_outbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meta_capi_outbox(integer) TO service_role;

-- ── 4. Preuve de consentement par commande ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_consent_log (
  id                bigserial PRIMARY KEY,
  order_kind        text NOT NULL CHECK (order_kind IN ('ticket', 'table', 'order', 'guest_list')),
  order_id          text NOT NULL,
  venue_id          text,
  organizer_user_id uuid,
  consent_marketing boolean NOT NULL,
  consent_version   integer,
  -- web = bandeau CMP ; native = jamais de consentement pub en V1 (donc FALSE) ;
  -- unknown = ancien client qui n'envoie pas encore le contexte.
  source            text NOT NULL DEFAULT 'unknown' CHECK (source IN ('web', 'native', 'unknown')),
  fbp               text,
  fbc               text,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_kind, order_id)
);
CREATE INDEX IF NOT EXISTS meta_consent_log_scope_idx
  ON public.meta_consent_log (venue_id, organizer_user_id, recorded_at DESC);
ALTER TABLE public.meta_consent_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_consent_log FROM anon, authenticated;

-- ── 5. Lecture pro (jamais le jeton) ─────────────────────────────────────────

-- Qui a le droit de VOIR et de RÉGLER la connexion d'une portée ?
--   club        → propriétaire (pas un manager : c'est une surface argent,
--                 comme Stripe et export_venue_ad_audience) ou super admin
--   organisateur→ lui-même ou super admin
--   plateforme  → super admin seul
CREATE OR REPLACE FUNCTION public.meta_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = auth.uid())
    ));
$$;
REVOKE ALL ON FUNCTION public.meta_scope_allowed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meta_scope_allowed(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_meta_connection(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conn   public.meta_connections%ROWTYPE;
  v_stats  jsonb;
  v_recent jsonb;
  v_consent jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_my_meta_connection: at most one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.meta_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conn
    FROM public.meta_connections mc
   WHERE mc.venue_id IS NOT DISTINCT FROM p_venue_id
     AND mc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('connection', NULL);
  END IF;

  SELECT jsonb_build_object(
           'queued',   count(*) FILTER (WHERE o.status IN ('queued', 'sending')),
           'sent_7d',  count(*) FILTER (WHERE o.status = 'sent'   AND o.created_at >= now() - interval '7 days'),
           'failed_7d',count(*) FILTER (WHERE o.status = 'failed' AND o.created_at >= now() - interval '7 days'),
           'sent_30d', count(*) FILTER (WHERE o.status = 'sent'   AND o.created_at >= now() - interval '30 days'),
           'value_30d_cents', COALESCE(sum(o.value_cents) FILTER (WHERE o.status = 'sent' AND o.event_name = 'Purchase' AND o.created_at >= now() - interval '30 days'), 0),
           'last_sent_at', max(o.sent_at) FILTER (WHERE o.status = 'sent'),
           'by_event', (
             SELECT COALESCE(jsonb_agg(jsonb_build_object('event_name', e.event_name, 'n', e.n) ORDER BY e.n DESC), '[]'::jsonb)
               FROM (SELECT event_name, count(*) AS n
                       FROM public.meta_capi_outbox
                      WHERE connection_id = v_conn.id AND status = 'sent' AND created_at >= now() - interval '30 days'
                      GROUP BY event_name) e
           )
         )
    INTO v_stats
    FROM public.meta_capi_outbox o
   WHERE o.connection_id = v_conn.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id, 'event_name', r.event_name, 'event_kind', r.event_kind, 'status', r.status,
           'attempts', r.attempts, 'value_cents', r.value_cents, 'currency', r.currency,
           'last_error', r.last_error, 'created_at', r.created_at, 'sent_at', r.sent_at
         ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_recent
    FROM (SELECT * FROM public.meta_capi_outbox
           WHERE connection_id = v_conn.id
           ORDER BY created_at DESC LIMIT 12) r;

  -- Consentement : part des commandes de la portée (30 j) où la personne a
  -- accepté la publicité. C'est le chiffre que le pro doit comprendre : ses
  -- événements ne comptent que les visiteurs qui ont dit oui.
  SELECT jsonb_build_object(
           'orders_30d', count(*),
           'consented_30d', count(*) FILTER (WHERE c.consent_marketing),
           'native_30d', count(*) FILTER (WHERE c.source = 'native')
         )
    INTO v_consent
    FROM public.meta_consent_log c
   WHERE c.recorded_at >= now() - interval '30 days'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
       OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL));

  RETURN jsonb_build_object(
    'connection', jsonb_build_object(
      'id', v_conn.id,
      'mode', v_conn.mode,
      'pixel_id', v_conn.pixel_id,
      'token_hint', v_conn.token_hint,
      'has_token', v_conn.vault_secret_id IS NOT NULL,
      'test_event_code', CASE WHEN v_conn.test_event_code_expires_at > now() THEN v_conn.test_event_code ELSE NULL END,
      'test_event_code_expires_at', CASE WHEN v_conn.test_event_code_expires_at > now() THEN v_conn.test_event_code_expires_at ELSE NULL END,
      'status', v_conn.status,
      'events_enabled', v_conn.events_enabled,
      'send_native', v_conn.send_native,
      'verified_at', v_conn.verified_at,
      'last_ok_at', v_conn.last_ok_at,
      'last_error_at', v_conn.last_error_at,
      'last_error', v_conn.last_error,
      'created_at', v_conn.created_at,
      'updated_at', v_conn.updated_at
    ),
    'stats', v_stats,
    'recent', v_recent,
    'consent', v_consent
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_meta_connection(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_meta_connection(text, uuid) TO authenticated;

-- ── 6. Pixels à charger sur une page publique ────────────────────────────────
-- Ne rend que des identifiants de pixel (publics par nature : ils sont dans le
-- code source de toute page qui les charge). Jamais un jeton. Résolution :
-- le club de la soirée (ou son club partenaire), son organisateur (ou son
-- organisateur partenaire), et la plateforme. Le front ne charge le script
-- qu'après consentement « publicité » ; cette RPC ne décide pas de ça.
CREATE OR REPLACE FUNCTION public.get_public_meta_pixels(
  p_event_id uuid DEFAULT NULL,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS TABLE (pixel_id text, scope text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue text := p_venue_id;
  v_org   uuid := p_organizer_user_id;
  v_pvenue text;
  v_porg   uuid;
BEGIN
  IF p_event_id IS NOT NULL THEN
    SELECT e.venue_id, e.partner_venue_id, e.organizer_user_id, e.partner_organizer_id
      INTO v_venue, v_pvenue, v_org, v_porg
      FROM public.events e
     WHERE e.id = p_event_id;
  END IF;

  RETURN QUERY
  SELECT mc.pixel_id,
         CASE WHEN mc.venue_id IS NOT NULL THEN 'venue'
              WHEN mc.organizer_user_id IS NOT NULL THEN 'organizer'
              ELSE 'platform' END
    FROM public.meta_connections mc
   WHERE mc.status = 'active'
     AND mc.vault_secret_id IS NOT NULL
     AND COALESCE((mc.events_enabled ->> 'pixel')::boolean, true)
     AND (
       (mc.venue_id IS NULL AND mc.organizer_user_id IS NULL)
       OR (v_venue  IS NOT NULL AND mc.venue_id = v_venue)
       OR (v_pvenue IS NOT NULL AND mc.venue_id = v_pvenue)
       OR (v_org    IS NOT NULL AND mc.organizer_user_id = v_org)
       OR (v_porg   IS NOT NULL AND mc.organizer_user_id = v_porg)
     );
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_meta_pixels(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_meta_pixels(uuid, text, uuid) TO anon, authenticated, service_role;

-- ── 7. Entretien ─────────────────────────────────────────────────────────────
-- Appelée par le drainer : codes de test périmés, file envoyée de plus de
-- 90 jours (l'audit du pro n'a pas besoin de plus, et Meta n'accepte de toute
-- façon rien de plus vieux que 7 jours).
CREATE OR REPLACE FUNCTION public.meta_capi_housekeeping()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codes int;
  v_rows  int;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'meta_capi_housekeeping: service_role only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.meta_connections
     SET test_event_code = NULL, test_event_code_expires_at = NULL
   WHERE test_event_code IS NOT NULL
     AND (test_event_code_expires_at IS NULL OR test_event_code_expires_at <= now());
  GET DIAGNOSTICS v_codes = ROW_COUNT;

  DELETE FROM public.meta_capi_outbox
   WHERE status IN ('sent', 'failed') AND created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object('expired_test_codes', v_codes, 'purged_rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.meta_capi_housekeeping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_housekeeping() TO service_role;
