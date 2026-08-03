-- ============================================================================
-- P3 Gamification — le classement d'équipe devient visible côté promoteur.
--
-- Le leaderboard existait déjà côté admin (« Suivi promoteurs »), mais un
-- promoteur ne voyait jamais sa position : la compétition, moteur n°1 de
-- cette population, restait invisible. La RLS empêche (à raison) un membre de
-- lire les sessions/clics de ses pairs — cette RPC SECURITY DEFINER expose
-- UNIQUEMENT des agrégats 30 jours (vues, clics, rang) des promoteurs actifs
-- de SA propre agence, previews internes exclues.
--
-- Appelable par : un membre actif (promoteur ou manager) OU le chef d'agence
-- (ligne affiliates). Tout autre appelant reçoit zéro ligne.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_agency_team_leaderboard()
RETURNS TABLE (
  member_id uuid,
  first_name text,
  last_name text,
  linktree_slug text,
  views_30d bigint,
  clicks_30d bigint,
  rank integer,
  is_you boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT affiliate_id, my_member_id FROM (
      SELECT am.affiliate_id, am.id AS my_member_id, 0 AS prio
      FROM affiliate_members am
      WHERE am.user_id = auth.uid() AND am.is_active
      UNION ALL
      SELECT a.id, NULL::uuid, 1
      FROM affiliates a
      WHERE a.user_id = auth.uid() AND a.is_active
    ) x
    ORDER BY prio
    LIMIT 1
  ),
  members AS (
    SELECT m.id, m.first_name, m.last_name, m.linktree_slug
    FROM affiliate_members m
    JOIN me ON m.affiliate_id = me.affiliate_id
    WHERE m.is_active AND m.role = 'promoter'
  ),
  stats AS (
    SELECT
      mb.id,
      (SELECT count(*) FROM affiliate_visitor_sessions s
        WHERE s.affiliate_member_id = mb.id
          AND s.visited_at >= now() - interval '30 days'
          AND NOT COALESCE(s.is_internal, false)) AS views,
      (SELECT count(*) FROM affiliate_clicks c
        WHERE c.affiliate_member_id = mb.id
          AND c.clicked_at >= now() - interval '30 days'
          AND NOT COALESCE(c.is_internal, false)) AS clicks
    FROM members mb
  )
  SELECT
    mb.id,
    mb.first_name,
    mb.last_name,
    mb.linktree_slug,
    st.views,
    st.clicks,
    (RANK() OVER (ORDER BY st.clicks DESC, st.views DESC))::int AS rank,
    mb.id IS NOT DISTINCT FROM (SELECT my_member_id FROM me) AS is_you
  FROM members mb
  JOIN stats st ON st.id = mb.id
  ORDER BY st.clicks DESC, st.views DESC, mb.first_name
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_agency_team_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_team_leaderboard() TO authenticated;
