-- ============================================================================
-- Email Studio — blocs Yuno branchés sur la billetterie connectée (Yuno CRM)
-- et nouveau bloc « Line-up ».
--
-- 1. get_external_event_live v2. Une soirée Shotgun se lisait dans un email
--    avec deux trous par rapport à une soirée Yuno :
--    - un tarif dont tout le stock est vendu ne se disait jamais « épuisé »
--      (seule la soirée entière complète l'était). Chaque tarif porte
--      désormais `out` : billets vendus (même lecture que les tarifs de
--      l'écran Soirées, _crm_night_tiers) >= stock Shotgun (`quantity`) ;
--    - le lieu s'affichait « — Paris » : une soirée miroir n'a pas de nom de
--      lieu. `venue_label` assemble l'adresse Shotgun quand elle est publique
--      (sinon la ville seule), sans répéter la ville que la rue porte déjà.
--    Chaque tarif porte aussi son `id` Shotgun : le pro peut en décrocher un
--    du bloc Billetterie, comme une tranche Yuno.
-- 2. get_event_lineup_live : les artistes d'une soirée, avec leur photo.
--    Soirée Shotgun = `external_events.artists` (relu à chaque synchro, donc
--    à jour quand le line-up s'annonce après la mise en vente) ; soirée Yuno
--    = DJ du line-up puis artistes invités (même règle que le pass Wallet).
--    Une photo n'est rendue que si c'est une URL https.
-- 3. _email_blocks_without_live : le bloc « lineup » est un bloc live, il
--    part d'un email enfant sans soirée reliée comme les quatre autres.
--
-- Mêmes portes que la v1 : service_role (envoi), super admin, ou quelqu'un
-- qui gère le design de la soirée (aperçu du Studio).
-- ============================================================================

-- ── 1. Tarifs et lieu d'une soirée externe ─────────────────────────────────
-- Le type de retour change (colonne venue_label) : DROP + CREATE. Les
-- appelants (hooks.ts, email-studio-html.ts) lisent les colonnes par nom.
DROP FUNCTION IF EXISTS public.get_external_event_live(uuid[]);

CREATE FUNCTION public.get_external_event_live(p_event_ids uuid[])
RETURNS TABLE(event_id uuid, ticket_url text, deals jsonb, left_tickets integer, sold_out boolean, venue_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.id, e.external_ticket_url, e.tickets_sold_out, e.location_name, e.location_city,
           ee.url, ee.deals, ee.left_tickets, ee.city, ee.address_visibility,
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
     WHERE COALESCE(lower(x.j->>'visibility'), 'public') = 'public'
       AND COALESCE(lower(x.j->>'sales_channel'), 'online') = 'online'
       AND NULLIF(btrim(x.j->>'name'), '') IS NOT NULL
  ), sold AS (
    -- Billets vendus par tarif : même rapprochement que _crm_night_tiers
    -- (id Shotgun, sinon nom), mêmes ventes (_crm_ticket_is_sale).
    SELECT d.event_id, d.ord,
           COALESCE((SELECT sum(GREATEST(t.quantity, 1))
                       FROM public.external_tickets t
                      WHERE t.event_id = d.event_id
                        AND public._crm_ticket_is_sale(t.status, t.raw)
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
$$;

REVOKE ALL ON FUNCTION public.get_external_event_live(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_event_live(uuid[]) TO authenticated, service_role;

-- ── 2. Line-up d'une soirée ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_lineup_live(p_event_ids uuid[])
RETURNS TABLE(event_id uuid, artists jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id,
         CASE WHEN e.external_source IS NOT NULL THEN
           -- Soirée d'une billetterie connectée : ses artistes, dans son ordre.
           COALESCE((
             SELECT jsonb_agg(a.j ORDER BY a.ord)
               FROM (
                 SELECT t.ord,
                        jsonb_build_object(
                          'name', left(btrim(t.a->>'name'), 120),
                          'photo', CASE WHEN t.a->>'avatar' ~ '^https://[^\s"<>]+$' THEN left(t.a->>'avatar', 1000) END) AS j
                   FROM public.external_events ee,
                        jsonb_array_elements(CASE WHEN jsonb_typeof(ee.artists) = 'array' THEN ee.artists ELSE '[]'::jsonb END)
                          WITH ORDINALITY AS t(a, ord)
                  WHERE ee.event_id = e.id
                    AND NULLIF(btrim(t.a->>'name'), '') IS NOT NULL
                  ORDER BY t.ord
                  LIMIT 24
               ) a
           ), '[]'::jsonb)
         ELSE
           -- Soirée Yuno : les DJ du line-up, puis les artistes invités.
           COALESCE((
             SELECT jsonb_agg(u.j ORDER BY u.grp, u.pos, u.at)
               FROM (SELECT * FROM (
                 SELECT 0 AS grp, 0 AS pos, ed.created_at AS at,
                        jsonb_build_object(
                          'name', left(btrim(d.stage_name), 120),
                          'photo', CASE WHEN d.profile_image_url ~ '^https://[^\s"<>]+$' THEN d.profile_image_url END) AS j
                   FROM public.event_djs ed
                   JOIN public.djs_public d ON d.id = ed.dj_id
                  WHERE ed.event_id = e.id
                    AND NULLIF(btrim(d.stage_name), '') IS NOT NULL
                 UNION ALL
                 SELECT 1, COALESCE(g.position, 0), g.created_at,
                        jsonb_build_object(
                          'name', left(btrim(g.name), 120),
                          'photo', CASE WHEN g.photo_url ~ '^https://[^\s"<>]+$' THEN g.photo_url END)
                   FROM public.event_guest_artists g
                  WHERE g.event_id = e.id
                    AND NULLIF(btrim(g.name), '') IS NOT NULL
               ) v ORDER BY v.grp, v.pos, v.at LIMIT 24) u
           ), '[]'::jsonb)
         END
    FROM public.events e
   WHERE e.id = ANY (p_event_ids)
     AND (COALESCE(auth.role(), '') = 'service_role'
          OR public.is_super_admin()
          OR (auth.uid() IS NOT NULL AND public.can_manage_event_design(auth.uid(), e.id)));
$$;

REVOKE ALL ON FUNCTION public.get_event_lineup_live(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_lineup_live(uuid[]) TO authenticated, service_role;

-- ── 3. Le Line-up est un bloc live ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._email_blocks_without_live(p_blocks jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(b) FROM jsonb_array_elements(COALESCE(p_blocks, '[]'::jsonb)) b
      WHERE COALESCE(b->>'type', '') NOT IN ('event', 'tickets', 'guestlist', 'table', 'countdown', 'lineup')),
    '[]'::jsonb
  )
$$;

NOTIFY pgrst, 'reload schema';
