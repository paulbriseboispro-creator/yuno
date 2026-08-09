-- ============================================================================
-- live_visitor_pings : remplacer l'écriture anonyme directe par une RPC
-- SECURITY DEFINER, et retirer les policies anon INSERT/UPDATE USING (true).
--
-- Constat (audit 2026-08-09) : 20260703140100 a rétabli des policies anon
--   INSERT WITH CHECK (true) + UPDATE USING (true) sur live_visitor_pings.
--   N'importe quel anonyme peut donc insérer en masse (pollution des compteurs
--   « live ») ou écraser le ping d'une autre session s'il en connaît le
--   session_id. SELECT reste fermé (pas de fuite en lecture), mais l'écriture
--   grande ouverte est le même anti-pattern que celui déjà corrigé pour le
--   tracking affilié (20260724100000).
--
-- Correctif : une RPC SECURITY DEFINER `ping_live_visitor` — surface minimale,
--   session_id/page_path bornés, stage validé, user_id imposé côté serveur via
--   auth.uid() (jamais un claim client) — remplace l'upsert direct. Les policies
--   anon d'écriture peuvent alors disparaître : plus aucune écriture directe
--   possible, et rien que l'advisor puisse « corriger » en les rouvrant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ping_live_visitor(
  p_session_id text,
  p_venue_id text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL,
  p_page_path text DEFAULT NULL,
  p_stage text DEFAULT 'browsing'
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO live_visitor_pings
    (session_id, venue_id, event_id, organizer_user_id, page_path, stage, user_id, last_seen)
  VALUES (
    left(p_session_id, 80),
    p_venue_id,
    p_event_id,
    p_organizer_user_id,
    left(p_page_path, 300),
    -- Le stage vient du client : on le contraint à la liste connue, sinon
    -- 'browsing'. Empêche d'injecter une valeur arbitraire dans la colonne.
    CASE WHEN p_stage IN ('browsing', 'cart', 'checkout', 'paid') THEN p_stage ELSE 'browsing' END,
    -- Identité imposée par le serveur : auth.uid() (NULL pour un anonyme).
    -- Jamais un user_id passé par le client.
    auth.uid(),
    now()
  )
  ON CONFLICT (session_id) DO UPDATE
    SET venue_id          = EXCLUDED.venue_id,
        event_id          = EXCLUDED.event_id,
        organizer_user_id = EXCLUDED.organizer_user_id,
        page_path         = EXCLUDED.page_path,
        stage             = EXCLUDED.stage,
        user_id           = EXCLUDED.user_id,
        last_seen         = now();
$$;

REVOKE ALL ON FUNCTION public.ping_live_visitor(text, text, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ping_live_visitor(text, text, uuid, uuid, text, text) TO anon, authenticated;

-- Retrait des écritures anonymes directes : la RPC (definer) est désormais le
-- seul chemin d'écriture. SELECT (owners/admins authentifiés) reste inchangé.
DROP POLICY IF EXISTS "Anyone can upsert their session ping" ON public.live_visitor_pings;
DROP POLICY IF EXISTS "Anyone can update their own session ping" ON public.live_visitor_pings;
