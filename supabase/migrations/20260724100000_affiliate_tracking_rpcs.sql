-- ============================================================================
-- Tracking affilié : réparer le flush durée/scroll et le heartbeat live.
--
-- Constat prouvé en prod (2026-07-24) : le PATCH anonyme sur
-- affiliate_visitor_sessions matche 0 ligne et l'upsert heartbeat sur
-- affiliate_live_pings lève 42501 — les policies UPDATE publiques déclarées
-- par 20260606000010 n'existent plus sur la base live (hardening advisor).
-- Conséquence : « Durée moy. », « Scroll moyen » et « en ligne » restent à
-- zéro pour toujours, quel que soit le trafic.
--
-- Correctif : deux RPC SECURITY DEFINER remplacent les écritures directes.
-- Surface minimale — une session précise, valeurs bornées, sessions récentes
-- uniquement — donc plus aucune policy UPDATE publique nécessaire (et rien
-- que l'advisor puisse « corriger » à nouveau).
-- ============================================================================

-- Flush de fin de session : durée + profondeur de scroll.
-- Monotone (jamais de régression), borné (6 h max, scroll 0-100), et limité
-- aux sessions de moins de 24 h pour fermer la porte au vandalisme tardif.
CREATE OR REPLACE FUNCTION public.flush_affiliate_session(
  p_session_id text,
  p_affiliate_id uuid,
  p_duration_seconds integer,
  p_scroll_depth integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE affiliate_visitor_sessions
  SET duration_seconds = GREATEST(
        COALESCE(duration_seconds, 0),
        LEAST(GREATEST(COALESCE(p_duration_seconds, 0), 0), 21600)
      ),
      scroll_depth_max = GREATEST(
        COALESCE(scroll_depth_max, 0),
        LEAST(GREATEST(COALESCE(p_scroll_depth, 0), 0), 100)
      ),
      last_activity_at = now()
  WHERE session_id = p_session_id
    AND affiliate_id = p_affiliate_id
    AND visited_at > now() - interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.flush_affiliate_session(text, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flush_affiliate_session(text, uuid, integer, integer) TO anon, authenticated;

-- Heartbeat « en ligne » : upsert par session, colonnes bornées.
CREATE OR REPLACE FUNCTION public.ping_affiliate_live(
  p_session_id text,
  p_affiliate_id uuid,
  p_member_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_venue_id uuid DEFAULT NULL,
  p_page_path text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO affiliate_live_pings
    (session_id, affiliate_id, affiliate_member_id, affiliate_event_id, affiliate_venue_id, last_seen, page_path)
  VALUES
    (left(p_session_id, 80), p_affiliate_id, p_member_id, p_event_id, p_venue_id, now(), left(p_page_path, 300))
  ON CONFLICT (session_id) DO UPDATE
    SET last_seen = now(),
        page_path = EXCLUDED.page_path;
$$;

REVOKE ALL ON FUNCTION public.ping_affiliate_live(text, uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ping_affiliate_live(text, uuid, uuid, uuid, uuid, text) TO anon, authenticated;
