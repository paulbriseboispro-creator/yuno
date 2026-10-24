-- E-mails CRM : le bloc Billetterie n'affiche que les tarifs PUBLICS d'une
-- soirée Shotgun.
--
-- Constaté le 22/10/2026 sur le premier import de 3AM : l'API Shotgun rend la
-- visibilité d'un tarif dans `visibilities` (tableau), pas dans `visiblity` /
-- `visibility`. Le connecteur ne la lisait donc jamais, et un tarif privé
-- (guest list nominative, « INVITATION STAFF », table d'un anniversaire) passait
-- pour public : 39 des 52 tarifs de la prochaine soirée de 3AM seraient sortis
-- dans un e-mail, en tête de liste (triés par prix, 0 € d'abord).
--
-- Le connecteur lit désormais `visibilities` ; cette fonction relit en plus le
-- tarif brut stocké, pour que la règle vaille sans attendre une synchro.
-- Le prix affiché ne change pas : prix du tarif, hors frais Shotgun (le fan les
-- voit au paiement, décision de Paul du 22/10).

CREATE OR REPLACE FUNCTION public.get_external_event_live(p_event_ids uuid[])
 RETURNS TABLE(event_id uuid, ticket_url text, deals jsonb, left_tickets integer, sold_out boolean, venue_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id, e.external_ticket_url, e.tickets_sold_out, e.location_name, e.location_city,
           ee.url, ee.deals, ee.raw AS ee_raw, ee.left_tickets, ee.city, ee.address_visibility,
           -- Rue montrée seulement quand Shotgun la dit publique (une valeur
           -- inconnue la cache : un lieu secret ne fuit jamais par l'email).
           CASE WHEN COALESCE(lower(btrim(ee.address_visibility)), 'public') IN ('public', 'visible', 'always', 'everyone', 'all')
                THEN NULLIF(btrim(ee.street), '') END AS street
      FROM public.events e
      LEFT JOIN public.external_events ee ON ee.event_id = e.id
     WHERE e.id = ANY (p_event_ids)
       AND e.external_source IS NOT NULL
       AND (COALESCE(auth.role(), '') = 'service_role'
            OR public.is_super_admin()
            OR (auth.uid() IS NOT NULL AND public.can_manage_event_design(auth.uid(), e.id)))
  ), d AS (
    SELECT ev.id AS event_id, x.ord,
           NULLIF(btrim(x.j->>'id'), '') AS did,
           btrim(x.j->>'name') AS name,
           CASE WHEN x.j->>'price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x.j->>'price')::numeric END AS price,
           CASE WHEN x.j->>'quantity' ~ '^[0-9]+$' THEN (x.j->>'quantity')::integer END AS q
      FROM ev,
           jsonb_array_elements(CASE WHEN jsonb_typeof(ev.deals) = 'array' THEN ev.deals ELSE '[]'::jsonb END)
             WITH ORDINALITY AS x(j, ord)
     -- Un tarif n'entre dans un e-mail que s'il est PUBLIC. L'API rend
     -- `visibilities` (tableau) ; un tarif stocké avant que le connecteur ne le
     -- lise a `visibility` vide : on relit alors le tarif brut de la soirée.
     -- Une guest list nominative ou une invitation (`["private"]`) ne part
     -- jamais chez un fan.
     WHERE COALESCE(
             NULLIF(lower(btrim(x.j->>'visibility')), ''),
             (SELECT CASE
                       WHEN jsonb_typeof(rd->'visibilities') <> 'array' THEN NULL
                       WHEN rd->'visibilities' ? 'public' THEN 'public'
                       ELSE NULLIF(lower(btrim(rd->'visibilities'->>0)), '')
                     END
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ev.ee_raw->'deals') = 'array' THEN ev.ee_raw->'deals' ELSE '[]'::jsonb END) rd
               WHERE NULLIF(btrim(x.j->>'id'), '') IS NOT NULL
                 AND COALESCE(rd->>'product_id', rd->>'productId', rd->>'id') = btrim(x.j->>'id')
               LIMIT 1),
             'public') = 'public'
       AND COALESCE(lower(x.j->>'sales_channel'), 'online') = 'online'
       AND NULLIF(btrim(x.j->>'name'), '') IS NOT NULL
  ), sold AS (
    -- Billets vendus par tarif : même rapprochement que _crm_night_tiers
    -- (id Shotgun, sinon nom), mêmes ventes (_crm_ticket_is_sale).
    SELECT d.event_id, d.ord,
           COALESCE((SELECT sum(GREATEST(t.quantity, 1))
                       FROM public.external_tickets t
                      WHERE t.event_id = d.event_id
                        AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                        AND ((d.did IS NOT NULL AND t.deal_id = d.did)
                          OR (lower(btrim(t.deal_name)) = lower(d.name)
                              AND (d.did IS NULL OR t.deal_id IS DISTINCT FROM d.did)))), 0) AS n
      FROM d
  )
  SELECT ev.id,
         COALESCE(ev.url, ev.external_ticket_url),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', d.did,
                    'name', d.name,
                    'price', d.price,
                    'out', (d.q IS NOT NULL AND d.q > 0 AND s.n >= d.q))
                  ORDER BY d.price NULLS LAST, d.ord)
             FROM d JOIN sold s ON s.event_id = d.event_id AND s.ord = d.ord
            WHERE d.event_id = ev.id
         ), '[]'::jsonb),
         ev.left_tickets,
         COALESCE(ev.tickets_sold_out, false),
         NULLIF(concat_ws(' — ',
           NULLIF(btrim(ev.location_name), ''),
           CASE
             WHEN ev.street IS NULL THEN NULLIF(btrim(COALESCE(ev.city, ev.location_city)), '')
             WHEN NULLIF(btrim(COALESCE(ev.city, ev.location_city)), '') IS NOT NULL
              AND position(lower(btrim(COALESCE(ev.city, ev.location_city))) IN lower(ev.street)) = 0
               THEN ev.street || ', ' || btrim(COALESCE(ev.city, ev.location_city))
             ELSE ev.street
           END), '')
    FROM ev;
$function$;

REVOKE ALL ON FUNCTION public.get_external_event_live(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_event_live(uuid[]) TO authenticated, service_role;
