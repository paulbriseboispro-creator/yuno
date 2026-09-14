-- ============================================================================
-- Meta — phase 2 : connexion en un clic (Facebook Login for Business).
-- Design : docs/designs/META_ADS_INTEGRATION_PLAN.md §5 phase 2 ;
-- mise en service : docs/META_GO_LIVE_GUIDE.md.
--
-- Le pro autorise Yuno une fois dans une fenêtre Meta ; l'edge `meta-connect`
-- échange le code, découvre ses actifs (pixels, comptes pub, Pages) et range
-- le jeton dans le Vault — même colonne, même RPC que le mode manuel. Ce qui
-- change : la nature du jeton, sa date d'expiration éventuelle, l'identité
-- Meta qui l'a accordé (pour honorer les rappels de suppression de données),
-- et un état intermédiaire « en attente du choix du pixel » quand le pro en
-- possède plusieurs.
-- ============================================================================

ALTER TABLE public.meta_connections
  ADD COLUMN IF NOT EXISTS meta_user_id     text,
  ADD COLUMN IF NOT EXISTS token_kind       text NOT NULL DEFAULT 'capi',
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  -- Actifs découverts à la connexion (ids + noms, jamais de secret) :
  -- {"pixels":[{"id","name"}],"ad_accounts":[{"id","name"}],"pages":[{"id","name"}]}
  ADD COLUMN IF NOT EXISTS assets           jsonb,
  -- Dernier bilan de santé (debug_token + qualité du dataset), lisible par le pro.
  ADD COLUMN IF NOT EXISTS last_health      jsonb,
  ADD COLUMN IF NOT EXISTS last_health_at   timestamptz;

ALTER TABLE public.meta_connections
  DROP CONSTRAINT IF EXISTS meta_connections_token_kind_check;
ALTER TABLE public.meta_connections
  ADD CONSTRAINT meta_connections_token_kind_check
  CHECK (token_kind IN ('capi', 'bisu', 'user'));

-- Un pixel de secours vide le temps du choix : la contrainte de format reste,
-- on autorise juste le marqueur 'pending' (jamais servi : status ≠ active).
ALTER TABLE public.meta_connections
  DROP CONSTRAINT IF EXISTS meta_connections_pixel_id_check;
ALTER TABLE public.meta_connections
  ADD CONSTRAINT meta_connections_pixel_id_check
  CHECK (pixel_id ~ '^[0-9]{6,32}$' OR pixel_id = 'pending');

ALTER TABLE public.meta_connections
  DROP CONSTRAINT IF EXISTS meta_connections_status_check;
ALTER TABLE public.meta_connections
  ADD CONSTRAINT meta_connections_status_check
  CHECK (status IN ('active', 'token_invalid', 'pending_assets'));

CREATE INDEX IF NOT EXISTS meta_connections_meta_user_idx
  ON public.meta_connections (meta_user_id) WHERE meta_user_id IS NOT NULL;

-- Rappel de suppression / désautorisation envoyé par Meta (signed_request) :
-- on journalise le code de confirmation que Meta réclame et ce qu'on a fait.
CREATE TABLE IF NOT EXISTS public.meta_data_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL CHECK (kind IN ('deletion', 'deauthorize')),
  meta_user_id      text NOT NULL,
  confirmation_code text NOT NULL UNIQUE,
  connections_affected integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'done' CHECK (status IN ('done')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_data_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_data_requests FROM anon, authenticated;

-- La lecture pro rend les nouveaux champs (jamais le jeton).
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
      'token_kind', v_conn.token_kind,
      'token_expires_at', v_conn.token_expires_at,
      'assets', v_conn.assets,
      'business_id', v_conn.business_id,
      'ad_account_id', v_conn.ad_account_id,
      'page_id', v_conn.page_id,
      'last_health', v_conn.last_health,
      'last_health_at', v_conn.last_health_at,
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
