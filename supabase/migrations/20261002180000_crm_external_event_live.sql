-- ============================================================================
-- Yuno CRM — lot 2c : données « live » d'une soirée externe pour l'Email Studio.
--
-- Une soirée miroir (events.external_source) n'a ni ticket_rounds ni page Yuno :
-- le bloc Billetterie et la carte de soirée d'un email lisent ses tarifs PUBLICS
-- chez Shotgun (external_events.deals) et le bouton part vers sa billetterie.
-- Une seule lecture pour l'aperçu du Studio (client du pro) et pour l'envoi
-- (edge, service_role) : les deux montrent la même chose.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_external_event_live(p_event_ids uuid[])
RETURNS TABLE(event_id uuid, ticket_url text, deals jsonb, left_tickets integer, sold_out boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id,
         COALESCE(ee.url, e.external_ticket_url),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('name', d->>'name', 'price', (d->>'price')::numeric) ORDER BY (d->>'price')::numeric NULLS LAST)
             FROM jsonb_array_elements(COALESCE(ee.deals, '[]'::jsonb)) d
            WHERE COALESCE(d->>'visibility', 'public') = 'public'
              AND COALESCE(d->>'sales_channel', 'online') = 'online'
              AND NULLIF(btrim(d->>'name'), '') IS NOT NULL
         ), '[]'::jsonb),
         ee.left_tickets,
         COALESCE(e.tickets_sold_out, false)
    FROM public.events e
    LEFT JOIN public.external_events ee ON ee.event_id = e.id
   WHERE e.id = ANY (p_event_ids)
     AND e.external_source IS NOT NULL
     AND (COALESCE(auth.role(), '') = 'service_role'
          OR public.is_super_admin()
          OR (auth.uid() IS NOT NULL AND public.can_manage_event_design(auth.uid(), e.id)));
$$;
REVOKE ALL ON FUNCTION public.get_external_event_live(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_event_live(uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
