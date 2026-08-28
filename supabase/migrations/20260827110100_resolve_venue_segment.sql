-- ───────────────────────────────────────────────────────────────────────────
-- resolve_venue_segment — LE résolveur unique des segments sauvegardés.
--
-- Reçoit une définition jsonb ({"version":1,"match":"all","conditions":[...]})
-- et renvoie les clients du club qui satisfont TOUTES les conditions (AND
-- plat, v1). Bâti sur _venue_customer_rfm (20260827100000) : les conditions
-- RFM utilisent exactement les mêmes quintiles que la page Clients et que le
-- ciblage push rfm:<segment>.
--
-- Consommateurs :
--   • send-push-campaign, scope `segment:<uuid>` (client service) ;
--   • resolve_campaign_audience, audience 'custom_segment' (email,
--     TOUJOURS intersecté avec l'opt-in newsletter — jamais contourné) ;
--   • count_venue_segment pour les compteurs live de l'UI.
--
-- Vocabulaire v1 (toute condition inconnue ⇒ FAUX, l'audience rétrécit) :
--   rfm_segment {in[]} · rfm_tier {in[]} · churn_risk {value} ·
--   total_spent {op gte|lte, value} · avg_basket {op, value} ·
--   last_visit_days {op lte|gt, value} · pillar {pillar, has} ·
--   event {event_id, kind bought|scanned} · follower {value} ·
--   language {in[]} · city {value, ilike} · loyalty_tier {in[]} ·
--   genres {any[]} (vocabulaire canonique src/lib/musicGenres.ts)
--
-- Les bannis sont TOUJOURS exclus, quelle que soit la définition.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_venue_segment(p_venue_id text, p_definition jsonb)
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role'
          OR is_super_admin()
          OR is_venue_owner(auth.uid(), p_venue_id)
          OR manager_has_permission(auth.uid(), p_venue_id, 'analytics')
          OR EXISTS (
            SELECT 1 FROM manager_permissions mp
            WHERE mp.user_id = auth.uid() AND mp.venue_id = p_venue_id AND mp.can_manage_crm = true
          )) THEN
    RAISE EXCEPTION 'Not authorized for venue %', p_venue_id USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.user_id, r.email
  FROM public._venue_customer_rfm(p_venue_id) r
  LEFT JOIN public.profiles pr ON pr.id = r.user_id
  LEFT JOIN public.customer_loyalty cl ON cl.venue_id = p_venue_id AND cl.user_id = r.user_id
  LEFT JOIN public.user_taste_profiles utp ON utp.user_id = r.user_id
  WHERE r.is_banned = false
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_definition->'conditions', '[]'::jsonb)) AS c
      WHERE NOT CASE c->>'type'
        WHEN 'rfm_segment' THEN
          r.rfm_segment IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'rfm_tier' THEN
          r.rfm_tier IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'churn_risk' THEN
          r.churn_risk = COALESCE((c->>'value')::boolean, true)
        WHEN 'total_spent' THEN
          CASE WHEN c->>'op' = 'lte' THEN COALESCE(r.total_spent, 0) <= (c->>'value')::numeric
               ELSE COALESCE(r.total_spent, 0) >= (c->>'value')::numeric END
        WHEN 'avg_basket' THEN
          CASE WHEN c->>'op' = 'lte' THEN COALESCE(r.avg_basket, 0) <= (c->>'value')::numeric
               ELSE COALESCE(r.avg_basket, 0) >= (c->>'value')::numeric END
        WHEN 'last_visit_days' THEN
          CASE WHEN c->>'op' = 'gt' THEN r.recency_days > (c->>'value')::int
               ELSE r.recency_days <= (c->>'value')::int END
        WHEN 'pillar' THEN
          ((CASE c->>'pillar'
              WHEN 'tickets' THEN COALESCE(r.ticket_count, 0)
              WHEN 'drinks'  THEN COALESCE(r.order_count, 0)
              WHEN 'tables'  THEN COALESCE(r.table_count, 0)
              ELSE 0 END) > 0) = COALESCE((c->>'has')::boolean, true)
        WHEN 'event' THEN
          CASE WHEN c->>'kind' = 'scanned' THEN
            EXISTS (
              SELECT 1 FROM public.tickets t
              WHERE t.event_id = (c->>'event_id')::uuid AND t.status = 'paid'
                AND t.entry_scanned = true AND lower(t.user_email) = lower(r.email)
            ) OR EXISTS (
              SELECT 1 FROM public.table_reservations tr
              WHERE tr.event_id = (c->>'event_id')::uuid AND tr.entry_scanned = true
                AND lower(tr.user_email) = lower(r.email)
            )
          ELSE
            EXISTS (
              SELECT 1 FROM public.tickets t
              WHERE t.event_id = (c->>'event_id')::uuid AND t.status = 'paid'
                AND lower(t.user_email) = lower(r.email)
            ) OR EXISTS (
              SELECT 1 FROM public.table_reservations tr
              WHERE tr.event_id = (c->>'event_id')::uuid AND tr.status = 'paid'
                AND lower(tr.user_email) = lower(r.email)
            )
          END
        WHEN 'follower' THEN
          (r.user_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.favorites f
            WHERE f.venue_id = p_venue_id AND f.user_id = r.user_id
          )) = COALESCE((c->>'value')::boolean, true)
        WHEN 'language' THEN
          COALESCE(pr.preferred_language, '') IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'city' THEN
          pr.city ILIKE '%' || (c->>'value') || '%'
        WHEN 'loyalty_tier' THEN
          COALESCE(cl.tier, '') IN (SELECT jsonb_array_elements_text(c->'in'))
        WHEN 'genres' THEN
          utp.genres && (SELECT COALESCE(array_agg(g), '{}'::text[])
                         FROM jsonb_array_elements_text(c->'any') AS g)
        ELSE false
      END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.count_venue_segment(p_venue_id text, p_definition jsonb)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.resolve_venue_segment(p_venue_id, p_definition);
$$;

GRANT EXECUTE ON FUNCTION public.resolve_venue_segment(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_venue_segment(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_venue_segment(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.count_venue_segment(text, jsonb) FROM anon;
