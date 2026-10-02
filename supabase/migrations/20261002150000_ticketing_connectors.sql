-- ============================================================================
-- Yuno CRM — lot 1 : connecteurs de billetterie (Shotgun d'abord)
-- Plan : docs/designs/YUNO_CRM_PLAN.md §5.2.
--
-- Un club ou un organisateur relie SA billetterie (Shotgun aujourd'hui) avec
-- son ID organisateur et son jeton API. Yuno lit, n'écrit jamais chez Shotgun.
-- Ce lot ne fait que COLLECTER et RANGER, dans des tables à part :
--   • ticketing_connections — une connexion par (portée, fournisseur), jeton
--     dans le Vault, état de la synchro (curseur, prochaine passe, erreurs) ;
--   • ticketing_sync_runs   — le journal de chaque passe ;
--   • external_events       — les soirées vues chez le fournisseur ;
--   • external_tickets      — un billet par ligne, acheteur et détenteur ;
--   • ticketing_rate_window — le limiteur GLOBAL : Shotgun autorise 100
--     requêtes / minute PAR IP et toutes les fonctions edge sortent par des
--     IP partagées, donc le quota est commun à tous les clients.
-- Rien ici n'est lu par le CRM existant : le branchement (soirées miroir,
-- base vivante, automatisations, attribution) est le lot 2.
--
-- Règles :
--   • RLS active, AUCUNE policy : tout passe par les RPC ou le service_role ;
--   • le jeton n'existe que dans le Vault et ne ressort jamais (token_hint) ;
--   • une session d'accès assisté ne connecte ni ne déconnecte une billetterie
--     (même règle que Meta et Stripe) ;
--   • déconnecter efface le jeton et GARDE les données ; « supprimer les
--     données importées » est une action séparée (DELETE de la connexion).
-- ============================================================================

-- ── 1. Connexions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticketing_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              text NOT NULL CHECK (provider IN ('shotgun')),
  external_org_id       text NOT NULL CHECK (external_org_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  external_org_name     text,
  vault_secret_id       uuid,
  token_hint            text,
  -- active | token_invalid (le fournisseur refuse le jeton) | error (pannes
  -- répétées) | disconnected (jeton effacé, données gardées)
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'token_invalid', 'error', 'disconnected')),
  include_cohosted      boolean NOT NULL DEFAULT true,
  -- Synchro
  tickets_cursor        text,          -- paramètre `after` de /tickets (date ISO ou date_id)
  events_synced_at      timestamptz,   -- dernière passe complète des soirées
  initial_import_done_at timestamptz,
  next_sync_at          timestamptz NOT NULL DEFAULT now(),
  sync_interval_minutes integer NOT NULL DEFAULT 60 CHECK (sync_interval_minutes BETWEEN 5 AND 1440),
  locked_until          timestamptz,
  last_sync_started_at  timestamptz,
  last_ok_at            timestamptz,
  last_error_at         timestamptz,
  last_error            text,
  fail_count            integer NOT NULL DEFAULT 0,
  -- Montants : unité de la réponse du fournisseur (1 = euros, 100 = centimes).
  -- Réglable par le super admin si la première réponse réelle le contredit.
  amount_divisor        numeric NOT NULL DEFAULT 1 CHECK (amount_divisor > 0),
  -- Clés (jamais les valeurs) du premier billet et de la première soirée vus :
  -- sert à caler la lecture sur le schéma réel, que Shotgun ne documente pas.
  schema_sample         jsonb,
  stats                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticketing_connections_scope_chk
    CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ticketing_connections_venue_uq
  ON public.ticketing_connections (provider, venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ticketing_connections_org_uq
  ON public.ticketing_connections (provider, organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticketing_connections_due_idx
  ON public.ticketing_connections (next_sync_at) WHERE status = 'active';

ALTER TABLE public.ticketing_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_connections FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ticketing_connections_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ticketing_connections_touch ON public.ticketing_connections;
CREATE TRIGGER trg_ticketing_connections_touch
  BEFORE UPDATE ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.ticketing_connections_touch();

-- Accès assisté : jamais de connexion / déconnexion d'une billetterie.
DROP TRIGGER IF EXISTS trg_support_block_ticketing_connections ON public.ticketing_connections;
CREATE TRIGGER trg_support_block_ticketing_connections
  BEFORE INSERT OR DELETE ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.block_support_session_write();

-- Le secret Vault suit la ligne.
CREATE OR REPLACE FUNCTION public.ticketing_connections_drop_secret()
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
DROP TRIGGER IF EXISTS trg_ticketing_connections_drop_secret ON public.ticketing_connections;
CREATE TRIGGER trg_ticketing_connections_drop_secret
  AFTER DELETE ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.ticketing_connections_drop_secret();

-- ── 2. Jeton dans le Vault (service_role seul) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.store_ticketing_token(p_connection_id uuid, p_token text)
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
    RAISE EXCEPTION 'store_ticketing_token: service_role only' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR length(p_token) < 12 THEN
    RAISE EXCEPTION 'store_ticketing_token: token too short';
  END IF;

  SELECT vault_secret_id INTO v_old FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_ticketing_token: unknown connection';
  END IF;
  IF v_old IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old;
  END IF;

  v_new := vault.create_secret(
    p_token,
    'ticketing_' || p_connection_id::text || '_' || extract(epoch FROM now())::bigint::text,
    'Ticketing API token for connection ' || p_connection_id::text
  );

  UPDATE public.ticketing_connections
     SET vault_secret_id = v_new,
         token_hint = right(p_token, 4),
         status = 'active',
         fail_count = 0,
         last_error = NULL,
         last_error_at = NULL
   WHERE id = p_connection_id;
END;
$$;
REVOKE ALL ON FUNCTION public.store_ticketing_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_ticketing_token(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_ticketing_token(p_connection_id uuid)
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
    RAISE EXCEPTION 'get_ticketing_token: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT ds.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets ds
    JOIN public.ticketing_connections tc ON tc.vault_secret_id = ds.id
   WHERE tc.id = p_connection_id
   LIMIT 1;
  RETURN v_secret;
END;
$$;
REVOKE ALL ON FUNCTION public.get_ticketing_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ticketing_token(uuid) TO service_role;

-- Déconnexion : le jeton part, les données restent.
CREATE OR REPLACE FUNCTION public.forget_ticketing_token(p_connection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_old uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forget_ticketing_token: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT vault_secret_id INTO v_old FROM public.ticketing_connections WHERE id = p_connection_id;
  IF v_old IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old;
  END IF;
  UPDATE public.ticketing_connections
     SET vault_secret_id = NULL, status = 'disconnected', locked_until = NULL
   WHERE id = p_connection_id;
END;
$$;
REVOKE ALL ON FUNCTION public.forget_ticketing_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forget_ticketing_token(uuid) TO service_role;

-- ── 3. Journal des synchros ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ticketing_sync_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    uuid NOT NULL REFERENCES public.ticketing_connections(id) ON DELETE CASCADE,
  trigger          text NOT NULL CHECK (trigger IN ('connect', 'manual', 'cron', 'chain')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'ok', 'partial', 'error', 'rate_limited')),
  requests         integer NOT NULL DEFAULT 0,
  pages            integer NOT NULL DEFAULT 0,
  events_upserted  integer NOT NULL DEFAULT 0,
  tickets_upserted integer NOT NULL DEFAULT 0,
  error            text,
  detail           jsonb
);
CREATE INDEX IF NOT EXISTS ticketing_sync_runs_conn_idx
  ON public.ticketing_sync_runs (connection_id, started_at DESC);
ALTER TABLE public.ticketing_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_sync_runs FROM anon, authenticated;

-- ── 4. Soirées et billets externes ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.external_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id      uuid NOT NULL REFERENCES public.ticketing_connections(id) ON DELETE CASCADE,
  venue_id           text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider           text NOT NULL,
  external_id        text NOT NULL,
  name               text,
  slug               text,
  url                text,
  start_at           timestamptz,
  end_at             timestamptz,
  timezone           text,
  description        text,
  cover_url          text,
  street             text,
  city               text,
  zip_code           text,
  country_code       text,
  latitude           double precision,
  longitude          double precision,
  address_visibility text,
  genres             text[] NOT NULL DEFAULT '{}',
  artists            jsonb NOT NULL DEFAULT '[]'::jsonb,
  deals              jsonb NOT NULL DEFAULT '[]'::jsonb,
  left_tickets       integer,
  published_at       timestamptz,
  launched_at        timestamptz,
  cancelled_at       timestamptz,
  external_role      text,           -- organizer | cohost…
  type_of_place      text,
  -- Lot 2 : la soirée Yuno miroir (jamais publique).
  event_id           uuid REFERENCES public.events(id) ON DELETE SET NULL,
  raw                jsonb,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  synced_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_events_scope_chk CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL)),
  CONSTRAINT external_events_uq UNIQUE (connection_id, external_id)
);
CREATE INDEX IF NOT EXISTS external_events_venue_idx ON public.external_events (venue_id, start_at) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_events_org_idx ON public.external_events (organizer_user_id, start_at) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_events_event_idx ON public.external_events (event_id) WHERE event_id IS NOT NULL;
ALTER TABLE public.external_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_events FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.external_tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       uuid NOT NULL REFERENCES public.ticketing_connections(id) ON DELETE CASCADE,
  venue_id            text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  external_id         text NOT NULL,
  external_order_id   text,
  external_event_id   text,
  deal_id             text,
  deal_name           text,
  -- valid | refunded | cancelled | transferred | other ; la valeur brute est gardée.
  status              text NOT NULL DEFAULT 'valid'
                      CHECK (status IN ('valid', 'refunded', 'cancelled', 'transferred', 'other')),
  raw_status          text,
  quantity            integer NOT NULL DEFAULT 1,
  price               numeric(12,2),  -- valeur faciale, hors frais, déjà divisée par amount_divisor
  fees                numeric(12,2),
  currency            text,
  buyer_email         text,           -- minuscules
  buyer_first_name    text,
  buyer_last_name     text,
  buyer_phone         text,
  buyer_ref           text,           -- identifiant utilisateur chez le fournisseur
  holder_email        text,
  holder_first_name   text,
  holder_last_name    text,
  -- NULL = inconnu. N'est JAMAIS à lui seul un consentement marketing Yuno :
  -- le versement dans le registre de consentement est une décision du lot 2.
  newsletter_optin    boolean,
  age                 integer,
  gender              text,
  city                text,
  zip_code            text,
  country_code        text,
  purchased_at        timestamptz,
  scanned_at          timestamptz,
  refunded_at         timestamptz,
  source_updated_at   timestamptz,
  utm                 jsonb,
  raw                 jsonb,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  synced_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_tickets_scope_chk CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL)),
  CONSTRAINT external_tickets_uq UNIQUE (connection_id, external_id)
);
CREATE INDEX IF NOT EXISTS external_tickets_venue_email_idx
  ON public.external_tickets (venue_id, buyer_email) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_tickets_org_email_idx
  ON public.external_tickets (organizer_user_id, buyer_email) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_tickets_event_idx
  ON public.external_tickets (connection_id, external_event_id);
CREATE INDEX IF NOT EXISTS external_tickets_purchased_idx
  ON public.external_tickets (connection_id, purchased_at DESC);
ALTER TABLE public.external_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.external_tickets FROM anon, authenticated;

-- ── 5. Limiteur de débit commun ─────────────────────────────────────────────
-- Fenêtre fixe de 60 s. Toute fenêtre glissante de 60 s chevauche au plus deux
-- fenêtres fixes : 45 / fenêtre garantit ≤ 90 requêtes / minute réelle, sous
-- les 100 de Shotgun, quel que soit le nombre de workers en parallèle.

CREATE TABLE IF NOT EXISTS public.ticketing_rate_window (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  used         integer NOT NULL DEFAULT 0
);
ALTER TABLE public.ticketing_rate_window ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticketing_rate_window FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_ticketing_rate(p_key text, p_limit integer, p_n integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
  v_used integer;
  v_grant integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'consume_ticketing_rate: service_role only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.ticketing_rate_window (key) VALUES (p_key) ON CONFLICT (key) DO NOTHING;
  SELECT window_start, used INTO v_start, v_used
    FROM public.ticketing_rate_window WHERE key = p_key FOR UPDATE;
  IF v_start < now() - interval '60 seconds' THEN
    v_start := now();
    v_used := 0;
  END IF;
  v_grant := LEAST(GREATEST(p_limit - v_used, 0), GREATEST(p_n, 0));
  UPDATE public.ticketing_rate_window
     SET window_start = v_start, used = v_used + v_grant
   WHERE key = p_key;
  RETURN v_grant;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ticketing_rate(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ticketing_rate(text, integer, integer) TO service_role;

-- ── 6. File : réclamer les connexions dues ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_ticketing_connections(
  p_limit integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 150,
  p_connection_id uuid DEFAULT NULL
)
RETURNS SETOF public.ticketing_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_ticketing_connections: service_role only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE public.ticketing_connections c
     SET locked_until = now() + make_interval(secs => p_lease_seconds),
         last_sync_started_at = now()
   WHERE c.id IN (
     SELECT x.id FROM public.ticketing_connections x
      WHERE x.status = 'active'
        AND x.vault_secret_id IS NOT NULL
        AND (p_connection_id IS NULL OR x.id = p_connection_id)
        AND (p_connection_id IS NOT NULL OR x.next_sync_at <= now())
        AND (x.locked_until IS NULL OR x.locked_until < now())
      ORDER BY x.next_sync_at
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ticketing_connections(integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ticketing_connections(integer, integer, uuid) TO service_role;

-- ── 7. Chiffres d'une connexion (recalculés en fin de passe) ────────────────

CREATE OR REPLACE FUNCTION public.ticketing_refresh_stats(p_connection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_refresh_stats: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'events',          (SELECT count(*) FROM public.external_events e WHERE e.connection_id = p_connection_id),
    'upcoming_events', (SELECT count(*) FROM public.external_events e
                         WHERE e.connection_id = p_connection_id AND e.cancelled_at IS NULL
                           AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now()),
    'tickets',         count(*),
    'valid_tickets',   count(*) FILTER (WHERE t.status = 'valid'),
    'buyers',          count(DISTINCT t.buyer_email) FILTER (WHERE t.buyer_email IS NOT NULL),
    'optin_buyers',    count(DISTINCT t.buyer_email) FILTER (WHERE t.buyer_email IS NOT NULL AND t.newsletter_optin IS TRUE),
    'with_email_pct',  CASE WHEN count(*) = 0 THEN NULL
                            ELSE round(100.0 * count(*) FILTER (WHERE t.buyer_email IS NOT NULL) / count(*)) END,
    'scanned_tickets', count(*) FILTER (WHERE t.scanned_at IS NOT NULL),
    'first_purchase_at', min(t.purchased_at),
    'last_purchase_at',  max(t.purchased_at)
  ) INTO v
  FROM public.external_tickets t
  WHERE t.connection_id = p_connection_id;

  UPDATE public.ticketing_connections SET stats = v WHERE id = p_connection_id;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.ticketing_refresh_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticketing_refresh_stats(uuid) TO service_role;

-- ── 8. Qui règle la connexion d'une portée ──────────────────────────────────
-- Même porte que Meta : propriétaire du club (pas un manager — surface
-- identité), l'organisateur lui-même, ou le super admin.

CREATE OR REPLACE FUNCTION public.ticketing_scope_allowed(p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
    OR (auth.uid() IS NOT NULL AND ((p_venue_id IS NULL) <> (p_organizer_user_id IS NULL)) AND (
      public.is_super_admin()
      OR (p_venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), p_venue_id))
      OR (p_organizer_user_id IS NOT NULL AND p_organizer_user_id = auth.uid())
    ));
$$;
REVOKE ALL ON FUNCTION public.ticketing_scope_allowed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticketing_scope_allowed(text, uuid) TO authenticated, service_role;

-- Lecture pour la carte « Billetterie connectée » : jamais le jeton.
CREATE OR REPLACE FUNCTION public.get_my_ticketing_connections(
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.ticketing_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('connections', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'provider', c.provider,
      'external_org_id', c.external_org_id,
      'external_org_name', c.external_org_name,
      'token_hint', c.token_hint,
      'has_token', c.vault_secret_id IS NOT NULL,
      'status', c.status,
      'running', c.locked_until IS NOT NULL AND c.locked_until > now(),
      'include_cohosted', c.include_cohosted,
      'initial_import_done_at', c.initial_import_done_at,
      'next_sync_at', c.next_sync_at,
      'sync_interval_minutes', c.sync_interval_minutes,
      'last_ok_at', c.last_ok_at,
      'last_error_at', c.last_error_at,
      'last_error', c.last_error,
      'stats', c.stats,
      'created_at', c.created_at,
      'runs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'trigger', r.trigger, 'started_at', r.started_at, 'finished_at', r.finished_at,
          'status', r.status, 'events_upserted', r.events_upserted,
          'tickets_upserted', r.tickets_upserted, 'error', r.error
        ) ORDER BY r.started_at DESC)
        FROM (SELECT * FROM public.ticketing_sync_runs r0
               WHERE r0.connection_id = c.id ORDER BY r0.started_at DESC LIMIT 5) r
      ), '[]'::jsonb)
    ) ORDER BY c.created_at)
    FROM public.ticketing_connections c
    WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_ticketing_connections(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ticketing_connections(text, uuid) TO authenticated, service_role;

-- ── 9. Cron : une passe toutes les 10 minutes ───────────────────────────────
-- La fonction réclame les connexions dues, lit au plus ~45 s, et se relance
-- seule tant qu'un import initial a du retard. La fréquence réelle d'un compte
-- vient de sync_interval_minutes (offre).

DO $$
BEGIN
  PERFORM cron.unschedule('ticketing-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ticketing-sync');
  PERFORM cron.schedule(
    'ticketing-sync',
    '*/10 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/affiliate-ticket-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.get_cron_secret()),
      body := '{"action":"ticketing_drain","trigger":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
