-- ═══════════════════════════════════════════════════════════════════════════
-- Liens suivis : toute l'ÉQUIPE voit (et gère) les liens de sa structure (29/09).
--
-- `get_tracked_link_stats` n'ouvrait les liens d'un organisateur qu'au compte
-- FONDATEUR (`p_organizer_user_id = auth.uid()`) et ceux d'un club qu'à son
-- owner. Un admin ou un éditeur d'équipe — qui travaille pourtant dans la
-- Console de l'organisation (`useActingOrganizer`) — tombait sur « Impossible
-- de charger les liens » dans ses soirées, sur sa page Co-organisation, et ne
-- pouvait ni créer ni renommer un lien (policy `tracked_links_owner_all`).
--
-- Une porte unique, miroir de `coorg_party_level` (≥ 1) :
--   • organisateur : fondateur, admin ou éditeur d'équipe (jamais un scanneur) ;
--   • club : owner ou manager du club.
-- Le CA reste à qui voit l'argent (fondateur / admin / membre view_finance ;
-- owner / manager finance ou analytique) : les autres reçoivent NULL et voient
-- clics et ventes.
--
-- Les chiffres des AUTRES parties d'une soirée à plusieurs vivent à l'endroit
-- prévu pour ça (« Qui fait vendre ? », `get_collab_party_breakdown`), déjà
-- ouvert à toute l'équipe de chaque partie (niveau ≥ 1).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tracked_link_team_can_read(p_kind text, p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND CASE
    WHEN p_kind = 'organizer' AND p_organizer_user_id IS NOT NULL
      THEN auth.uid() = p_organizer_user_id
        OR public.is_org_team_member(auth.uid(), p_organizer_user_id, 'editor')
    WHEN p_kind = 'venue' AND p_venue_id IS NOT NULL
      THEN EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid())
        OR public.can_manage_venue(auth.uid(), p_venue_id)
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.tracked_link_team_can_read(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracked_link_team_can_read(text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tracked_link_team_sees_money(p_kind text, p_venue_id text, p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND CASE
    WHEN p_kind = 'organizer' AND p_organizer_user_id IS NOT NULL
      THEN auth.uid() = p_organizer_user_id
        OR public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')
    WHEN p_kind = 'venue' AND p_venue_id IS NOT NULL
      THEN EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                    WHERE mp.user_id = auth.uid() AND mp.venue_id = p_venue_id
                      AND (COALESCE(mp.can_view_finance, false) OR COALESCE(mp.can_view_analytics, false)))
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.tracked_link_team_sees_money(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracked_link_team_sees_money(text, text, uuid) TO authenticated, service_role;

-- ─── Lecture des statistiques (reprise de la définition EN LIGNE, portes seules changées)

CREATE OR REPLACE FUNCTION public.get_tracked_link_stats(p_owner_kind text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_promoter_id uuid DEFAULT NULL::uuid, p_dj_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid, p_target_kind text DEFAULT NULL::text, p_guest_list_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, code text, label text, target_kind text, event_id uuid, is_active boolean, created_at timestamp with time zone, clicks integer, conversions bigint, revenue numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_money boolean := true;
BEGIN
  IF p_owner_kind = 'venue' THEN
    -- Toute l'équipe du club (owner, managers) : chacun voit les liens du club.
    IF NOT public.tracked_link_team_can_read('venue', p_venue_id, NULL) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
    v_money := public.tracked_link_team_sees_money('venue', p_venue_id, NULL);
  ELSIF p_owner_kind = 'organizer' THEN
    -- Le fondateur ET son équipe (admin, éditeur) : le scope est l'ORGANISATION.
    IF NOT public.tracked_link_team_can_read('organizer', NULL, p_organizer_user_id) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
    v_money := public.tracked_link_team_sees_money('organizer', NULL, p_organizer_user_id);
  ELSIF p_owner_kind = 'promoter' THEN
    IF NOT EXISTS (SELECT 1 FROM public.promoters p WHERE p.id = p_promoter_id AND p.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSIF p_owner_kind = 'dj' THEN
    IF NOT EXISTS (SELECT 1 FROM public.djs d WHERE d.id = p_dj_id AND d.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'not authorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid owner_kind';
  END IF;

  RETURN QUERY
  WITH links AS (
    SELECT tl.* FROM public.tracked_links tl
    WHERE tl.owner_kind = p_owner_kind
      AND ( (p_owner_kind = 'venue'     AND tl.venue_id = p_venue_id)
         OR (p_owner_kind = 'organizer' AND tl.organizer_user_id = p_organizer_user_id)
         OR (p_owner_kind = 'promoter'  AND tl.promoter_id = p_promoter_id)
         OR (p_owner_kind = 'dj'        AND tl.dj_id = p_dj_id) )
      AND (p_event_id IS NULL OR tl.event_id = p_event_id)
      AND (p_target_kind IS NULL OR tl.target_kind = p_target_kind)
      AND (p_guest_list_id IS NULL OR tl.guest_list_id = p_guest_list_id)
  ),
  conv AS (
    SELECT tracked_link_id, count(*)::bigint AS c, coalesce(sum(amt), 0) AS rev
    FROM (
      SELECT t.tracked_link_id, (greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))) AS amt
        FROM public.tickets t WHERE t.tracked_link_id IS NOT NULL AND t.status IN ('paid','used')
      UNION ALL
      SELECT r.tracked_link_id, (greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))) AS amt
        FROM public.table_reservations r WHERE r.tracked_link_id IS NOT NULL AND r.status IN ('paid','confirmed')
      UNION ALL
      SELECT o.tracked_link_id, (greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))) AS amt
        FROM public.orders o WHERE o.tracked_link_id IS NOT NULL AND o.status IN ('paid','served')
      UNION ALL
      -- Une inscription guest list est gratuite : elle compte comme conversion,
      -- jamais comme chiffre d'affaires.
      SELECT tracked_link_id, 0::numeric   AS amt FROM public.guest_list_entries WHERE tracked_link_id IS NOT NULL AND status <> 'cancelled'
    ) all_conv
    GROUP BY tracked_link_id
  )
  SELECT l.id, l.code, l.label, l.target_kind, l.event_id, l.is_active, l.created_at,
         l.clicks_count, coalesce(conv.c, 0),
         -- Le CA ne part qu'à qui voit l'argent ; les autres voient clics et ventes.
         CASE WHEN v_money THEN coalesce(conv.rev, 0) END
  FROM links l
  LEFT JOIN conv ON conv.tracked_link_id = l.id
  ORDER BY l.created_at DESC;
END; $function$;

-- ─── Créer / renommer / désactiver un lien : l'équipe aussi ────────────────
-- Policy permissive EN PLUS de tracked_links_owner_all (qui reste pour les
-- promoteurs et DJ). Même porte que la lecture.
DROP POLICY IF EXISTS tracked_links_team_all ON public.tracked_links;
CREATE POLICY tracked_links_team_all ON public.tracked_links
  FOR ALL TO authenticated
  USING (owner_kind IN ('venue', 'organizer')
         AND public.tracked_link_team_can_read(owner_kind, venue_id, organizer_user_id))
  WITH CHECK (owner_kind IN ('venue', 'organizer')
         AND public.tracked_link_team_can_read(owner_kind, venue_id, organizer_user_id));
