-- Lien démo = LECTURE SEULE, garantie par le SERVEUR (2026-09-27).
--
-- Constat : le prospect qui ouvre un lien d'aperçu (/preview/:token) reçoit
-- une vraie session GoTrue sur un compte démo (owner@womber.fr…). La lecture
-- seule ne vivait QUE dans son onglet (sessionStorage + intercepteur
-- supabase-js, src/lib/previewGuard.ts) : un deuxième onglet (la session, elle,
-- est dans localStorage), la console, ou un appel HTTP direct avec le jeton
-- suffisaient à tout faire — un prospect a ainsi connecté un compte Facebook
-- au compte démo.
--
-- Même modèle que l'accès assisté (20260824120000) : la clé est le claim JWT
-- `session_id`. Chaque session émise par un lien d'aperçu est enregistrée dans
-- demo_preview_sessions par l'edge de redeem (et par demo-login quand un
-- aperçu bascule de rôle) ; tout ce qui suit la reconnaît :
--   1. PostgREST : hook pre-request → la transaction de toute requête d'une
--      session d'aperçu passe en READ ONLY (tables ET RPC, SECURITY DEFINER
--      compris), sauf une courte liste de RPC de mesure / d'écrans dont
--      l'écriture est un cache ou un compteur (DEMO_PREVIEW_WRITABLE_RPCS).
--      Refus par défaut : une RPC ajoutée demain est lecture seule en aperçu
--      sans que personne n'y pense. Les RPC `export_*` (lectures) sont en
--      plus refusées : le compte orga démo porte des adresses réelles.
--   2. Storage : policies RESTRICTIVE sur storage.objects (le Storage ne passe
--      pas par PostgREST).
--   3. Edge functions : _shared/demo-guard.ts (même table, service_role).
--
-- Les sessions de Paul, de l'agent (mintSession) et du reviewer Apple sur ces
-- mêmes comptes ont un AUTRE session_id : elles gardent l'écriture.

-- ─── 1. Registre des sessions d'aperçu ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.demo_preview_sessions (
  auth_session_id uuid PRIMARY KEY,
  user_id         uuid NOT NULL,
  link_id         uuid REFERENCES public.demo_preview_links(id) ON DELETE SET NULL,
  -- 'redeem' = ouverte par le lien ; 'role_switch' = bascule de rôle depuis
  -- une session d'aperçu (demo-login hérite du marquage).
  origin          text NOT NULL DEFAULT 'redeem' CHECK (origin IN ('redeem', 'role_switch')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS totale, aucune policy : seules les fonctions ci-dessous et service_role.
ALTER TABLE public.demo_preview_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_preview_sessions FROM anon, authenticated;

COMMENT ON TABLE public.demo_preview_sessions IS
  'Sessions GoTrue émises par un lien d''aperçu démo : lecture seule imposée côté serveur (pre-request PostgREST, storage, edge). Ne jamais vider tant que la session peut vivre : une ligne retirée rend l''écriture au prospect.';

-- ─── 2. Porte unique : la requête vient-elle d'une session d'aperçu ? ───────
-- Rapide pour tout le monde : sans email démo dans le JWT, aucune lecture de
-- table. Ne lève jamais (appelée sur CHAQUE requête PostgREST).
CREATE OR REPLACE FUNCTION public.is_demo_preview_session()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claims jsonb;
  v_sid    uuid;
BEGIN
  BEGIN
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_claims IS NULL OR NOT public.is_demo_email(v_claims ->> 'email') THEN
    RETURN false;
  END IF;
  BEGIN
    v_sid := nullif(v_claims ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF v_sid IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.demo_preview_sessions s WHERE s.auth_session_id = v_sid);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_demo_preview_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_demo_preview_session() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_demo_preview_session() IS
  'Vrai si le JWT courant est une session ouverte par un lien d''aperçu démo. Le front la lit pour armer la bannière lecture seule dans un onglet qui ne l''a pas.';

-- ─── 3. Enregistrement (service_role seul : edge de redeem / demo-login) ────
CREATE OR REPLACE FUNCTION public.register_demo_preview_session(
  p_session_id uuid,
  p_user_id    uuid,
  p_token      text DEFAULT NULL,
  p_origin     text DEFAULT 'redeem'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link uuid;
BEGIN
  IF p_session_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_session';
  END IF;
  IF p_token IS NOT NULL THEN
    SELECT id INTO v_link FROM public.demo_preview_links WHERE token = p_token;
  END IF;
  INSERT INTO public.demo_preview_sessions (auth_session_id, user_id, link_id, origin)
  VALUES (p_session_id, p_user_id, v_link,
          CASE WHEN p_origin = 'role_switch' THEN 'role_switch' ELSE 'redeem' END)
  ON CONFLICT (auth_session_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.register_demo_preview_session(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_demo_preview_session(uuid, uuid, text, text) TO service_role;

-- ─── 4. RPC encore inscriptibles en aperçu ──────────────────────────────────
-- Uniquement de la MESURE (compteurs, battements) et des écrans de lecture
-- dont l'« écriture » est une table temporaire ou un cache recalculé. Rien qui
-- engage le compte, parle à quelqu'un, ou sorte des données. Liste courte à
-- dessein : une RPC absente d'ici est lecture seule en aperçu, et une lecture
-- qui écrit en douce y lève — c'est voulu, on l'ajoute ici après l'avoir lue.
CREATE OR REPLACE FUNCTION public.demo_preview_writable_rpc(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(p_name, '')) = ANY (ARRAY[
    -- CTA « Activer mon compte » des sessions vitrine (seul canal d'écriture voulu)
    'request_showcase_claim',
    -- mesure d'audience / live view (battements, vues, clics)
    'ping_live_visitor', 'platform_heartbeat', 'track_platform_view',
    'track_links_event', 'ping_affiliate_live', 'flush_affiliate_session',
    'track_guest_artist_click',
    -- parcours client consultable depuis la démo (anti-flood, déverrouillage)
    'check_promo_code', 'unlock_event_sale', 'open_discovery_selection',
    -- écrans de lecture dont le calcul passe par une table temporaire / un cache
    'list_contact_base', 'count_contact_segment_def', 'analyze_contact_lists',
    'check_contact_import', 'get_contact_intelligence_overview',
    'get_contact_segment_panel', 'get_campaign_list_impact',
    'get_dj_audience', 'get_tracked_link_stats', 'get_user_nightlife_stats',
    'seed_event_tracked_links', 'seed_guest_list_tracked_links',
    'seed_venue_tracked_links', 'demo_is_live'
  ]::text[]);
$$;

-- ─── 5. Hook pre-request PostgREST ──────────────────────────────────────────
-- SECURITY INVOKER et SANS clause SET : un set_config local posé dans une
-- fonction à clause SET peut être rendu à la sortie ; ici il doit survivre
-- jusqu'à la requête principale. Passer une transaction en READ ONLY est
-- toujours permis (c'est le retour en lecture-écriture qui est interdit).
-- Doit rester infaillible : une exception ici casserait TOUTE l'API. La seule
-- exception levée l'est exprès (export depuis un aperçu), et uniquement pour
-- une session d'aperçu.
CREATE OR REPLACE FUNCTION public.pgrst_demo_preview_guard()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_path text;
  v_fn   text;
BEGIN
  IF NOT public.is_demo_preview_session() THEN
    RETURN;
  END IF;

  BEGIN
    v_path := coalesce(current_setting('request.path', true), '');
    IF v_path LIKE '%/rpc/%' THEN
      v_fn := lower(split_part(substring(v_path FROM position('/rpc/' IN v_path) + 5), '/', 1));
      IF public.demo_preview_writable_rpc(v_fn) THEN
        RETURN;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- chemin illisible : on tombe dans la lecture seule
  END;

  -- Les exports sont des LECTURES, que la lecture seule laisse passer. Or le
  -- compte orga démo porte 12 315 adresses importées réelles (CLAUDE.md,
  -- « servent au rendu, à rien d'autre ») : un aperçu n'en sort aucun fichier.
  IF v_fn LIKE 'export\_%' THEN
    RAISE EXCEPTION 'demo_read_only' USING ERRCODE = '42501',
      HINT = 'Aperçu de démonstration : export désactivé.';
  END IF;

  PERFORM set_config('transaction_read_only', 'on', true);
END;
$$;

REVOKE ALL ON FUNCTION public.pgrst_demo_preview_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pgrst_demo_preview_guard() TO anon, authenticated, service_role, authenticator;
GRANT EXECUTE ON FUNCTION public.demo_preview_writable_rpc(text) TO anon, authenticated, service_role, authenticator;
GRANT EXECUTE ON FUNCTION public.is_demo_preview_session() TO authenticator;

COMMENT ON FUNCTION public.pgrst_demo_preview_guard() IS
  'Hook pgrst.db_pre_request : transaction READ ONLY pour toute requête d''une session d''aperçu démo (hors demo_preview_writable_rpc). Ne doit JAMAIS lever.';

-- ─── 6. Storage : pas d'upload / remplacement / suppression en aperçu ───────
DROP POLICY IF EXISTS "demo_preview_no_insert" ON storage.objects;
CREATE POLICY "demo_preview_no_insert" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_demo_preview_session());

DROP POLICY IF EXISTS "demo_preview_no_update" ON storage.objects;
CREATE POLICY "demo_preview_no_update" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_demo_preview_session())
  WITH CHECK (NOT public.is_demo_preview_session());

DROP POLICY IF EXISTS "demo_preview_no_delete" ON storage.objects;
CREATE POLICY "demo_preview_no_delete" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_demo_preview_session());

-- ─── 7. Branchement du hook ─────────────────────────────────────────────────
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.pgrst_demo_preview_guard';
NOTIFY pgrst, 'reload config';
