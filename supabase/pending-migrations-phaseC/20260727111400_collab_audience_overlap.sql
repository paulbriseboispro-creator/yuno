-- ─────────────────────────────────────────────────────────────────────────────
-- Phase C / item C1 — chevauchement d'audience entre co-organisateurs (LE moat).
--
-- Sur un co-event (collab club ↔ organisateur), chaque partie voit combien
-- d'abonnés elle PARTAGE avec l'autre, et surtout le NET-NEW : les abonnés de
-- l'autre qui ne la suivent pas encore (= la valeur d'audience qu'une collab
-- débloque). Jaccard |A∩B|/|A∪B| + net-new de chaque côté. Comptes SEULEMENT,
-- jamais une identité — l'effet réseau sans fuite du graphe.
--
-- Garde : is_event_collab_participant(event_id, auth.uid()) — seules les DEUX
-- parties de ce co-event voient le calcul. Intersection via audience_members
-- (REVOKE de authenticated → seule une RPC DEFINER propriété postgres l'appelle).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_collab_audience_overlap(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result       jsonb;
  v_venue_id   text;
  v_org_id     uuid;
  v_venue_name text;
  v_org_name   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF NOT public.is_event_collab_participant(p_event_id, auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  -- Les deux parties : le club (lead ou partenaire) et l'organisateur (lead ou partenaire).
  SELECT COALESCE(NULLIF(e.venue_id, ''), e.partner_venue_id),
         COALESCE(e.organizer_user_id, e.partner_organizer_id)
    INTO v_venue_id, v_org_id
    FROM public.events e
   WHERE e.id = p_event_id;

  IF v_venue_id IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'supported', false, 'reason', 'not_club_organizer_collab');
  END IF;

  SELECT name INTO v_venue_name FROM public.venues WHERE id = v_venue_id;
  SELECT NULLIF(btrim(display_name), '') INTO v_org_name
    FROM public.organizer_profiles WHERE user_id = v_org_id;

  WITH a AS (SELECT user_id FROM public.audience_members('venue', v_venue_id)),
       b AS (SELECT user_id FROM public.audience_members('organizer', v_org_id::text)),
       agg AS (
         SELECT (SELECT count(*) FROM a)                          AS na,
                (SELECT count(*) FROM b)                          AS nb,
                (SELECT count(*) FROM a JOIN b USING (user_id))   AS ni
       )
  SELECT jsonb_build_object(
    'ok', true, 'supported', true,
    'venue',     jsonb_build_object('id', v_venue_id, 'name', COALESCE(v_venue_name, ''), 'followers', na),
    'organizer', jsonb_build_object('id', v_org_id,   'name', COALESCE(v_org_name, ''),   'followers', nb),
    'shared', ni,
    'union',  (na + nb - ni),
    'jaccard', CASE WHEN (na + nb - ni) > 0
                    THEN round(100.0 * ni / (na + nb - ni), 1) ELSE 0 END,
    -- abonnés de l'autre qui ne suivent pas encore ce côté (= audience à gagner)
    'net_new_for_venue',     (nb - ni),
    'net_new_for_organizer', (na - ni)
  )
  FROM agg
  INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_collab_audience_overlap(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_collab_audience_overlap(uuid) TO authenticated;
