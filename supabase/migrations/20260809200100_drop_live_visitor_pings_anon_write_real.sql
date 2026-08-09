-- ============================================================================
-- Correctif de 20260809200000 : retirer les VRAIES policies d'écriture anon de
-- live_visitor_pings.
--
-- 20260809200000 a créé le RPC ping_live_visitor (definer) et voulait retirer les
-- policies anon INSERT/UPDATE, mais visait les noms de la migration 20260703140100
-- (« Anyone can upsert their session ping » / « ... update their own session
-- ping »). La prod a dérivé : les policies réelles s'appellent « Anyone can insert
-- their live ping » et « Users can update their own live ping » (versions déjà
-- scopées à user_id IS NULL par un durcissement ultérieur). Le DROP d'origine était
-- donc un no-op et les écritures anon directes subsistaient.
--
-- Ici on retire tous les noms possibles (IF EXISTS, idempotent), quelle que soit la
-- dérive d'une base donnée. Après ça, ping_live_visitor (SECURITY DEFINER) est le
-- seul chemin d'écriture ; les policies SELECT (owners/organisateurs/admin) restent.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can insert their live ping" ON public.live_visitor_pings;
DROP POLICY IF EXISTS "Users can update their own live ping" ON public.live_visitor_pings;
-- Noms hérités éventuels (autres bases / replays depuis zéro) :
DROP POLICY IF EXISTS "Anyone can upsert their session ping" ON public.live_visitor_pings;
DROP POLICY IF EXISTS "Anyone can update their own session ping" ON public.live_visitor_pings;
