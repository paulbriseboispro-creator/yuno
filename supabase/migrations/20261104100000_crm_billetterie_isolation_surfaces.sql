-- Yuno CRM ⇄ Billetterie : une donnée du CRM n'apparaît jamais dans la Billetterie.
--
-- Une soirée Shotgun a une soirée MIROIR dans `events` (`external_source = 'shotgun'`,
-- inactive, privée, sans vente Yuno, créée par `ticketing_after_sync`). Elle partage la
-- portée (`organizer_user_id` / `venue_id`) des vraies soirées Yuno d'un compte à deux
-- produits : 311 miroirs pour 160 soirées Yuno en prod le 19/10, 282 sur 285 pour Amoris.
-- Audit des 395 fonctions SQL qui lisent `events` : celles qui recalculent leur propre
-- périmètre sans passer par `analytics_scope_gate` (déjà filtré par 20261007230000)
-- comptaient, listaient ou choisissaient ces miroirs. Un `external_source IS NULL` par
-- endroit, rien d'autre ne change. Les fonctions de la Console CRM (`crm_*`, `_crm_*`),
-- l'Email Studio et `_mcp_email_scope_events` continuent de lire les miroirs.
--
--   • get_agency_upcoming_events : la Console Agence listait (et comptait) les soirées Shotgun
--     d'un club ou d'un organisateur sous contrat, et laissait y assigner des promoteurs.
--   • gen_event_slug : un miroir occupait le slug d'une soirée Yuno de même titre (…-N).
--   • get_guest_artist_book : le carnet d'artistes proposait les line-ups Shotgun.
--   • get_tracked_link_stats : la page Liens montrait les liens de partage du CRM (/go/).
--   • get_event_report, get_push_center, get_my_meta_ads, get_staff_night_pulse, get_live_view :
--     « première soirée », rythme, frise des soirées, sélecteur de boost, soirée principale
--     de la nuit, ancre du globe.
--   • weekly_digest_email_targets / _data, night_recap_data / _due / _email_data : cron d'e-mails
--     pro (un compte CRM pur devenait destinataire du digest de la Billetterie).
--   • event_analytics_scope, get_analytics_benchmarks : alignées sur analytics_scope_gate.
--
-- CREATE OR REPLACE conserve les droits ; ils sont néanmoins reposés explicitement
-- (jamais anon, service_role seul pour ce que seuls un cron / une edge appellent).

DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('get_agency_upcoming_events', '50a6680196e9cb5c685b6e2c5dbf8118'),
    ('gen_event_slug', 'ceed9564a5138aea97a35832fa4c7bfa'),
    ('get_guest_artist_book', '71918aca1d853498094d9d746ae7dbec'),
    ('get_tracked_link_stats', 'b8fe36363827a46a75815f0a1fcc01c2'),
    ('get_event_report', '7a7f10018a0168f211f5eeade44ae853'),
    ('get_push_center', 'a1d54e21cd4016514a9d07abb8abd890'),
    ('get_my_meta_ads', '34965928d21d8858dcc875d27948035d'),
    ('get_staff_night_pulse', '679914bcdf9d6b9d07fa82c98ba5e047'),
    ('get_live_view', 'e619da040840c8f4beaadb60157f390b'),
    ('weekly_digest_email_targets', 'aa4e7bc088a524cff2e0f3377bf33606'),
    ('weekly_digest_email_data', '1686bb494e283c92a0c931f3fd7ff615'),
    ('night_recap_data', 'e4703f80c0c02e07751a084f5e9999be'),
    ('night_recap_due', 'be195225169d7731ad03f0a55a81cca5'),
    ('night_recap_email_data', '439a3023851030ac3f70bab707500bbf'),
    ('event_analytics_scope', 'd333ad68de807275bf34d301149fb93c'),
    ('get_analytics_benchmarks', 'f47350e9531f739c351a5d08a9847109')
  ) AS v(name, md5) LOOP
    IF (SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.name) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'public.% a changé depuis l''audit du 19/10 : régénérer la migration depuis pg_get_functiondef', r.name;
    END IF;
  END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_agency_upcoming_events(p_agency_id uuid, p_days_ahead integer DEFAULT 30)
 RETURNS TABLE(event_id uuid, title text, start_at timestamp with time zone, venue_id text, venue_name text, organizer_user_id uuid, is_active boolean, assigned_promoter_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    e.id,
    e.title,
    e.start_at,
    e.venue_id,
    v.name                 AS venue_name,
    e.organizer_user_id,
    e.is_active,
    COUNT(DISTINCT pea.promoter_id) FILTER (
      WHERE pea.promoter_id IN (
        SELECT p.id FROM public.promoters p WHERE p.agency_id = p_agency_id
      )
    )                      AS assigned_promoter_count
  FROM public.agency_venue_contracts avc
  JOIN public.events e
    ON (avc.venue_id IS NOT NULL AND e.venue_id = avc.venue_id)
    OR (avc.organizer_user_id IS NOT NULL AND e.organizer_user_id = avc.organizer_user_id)
  LEFT JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN public.promoter_event_assignments pea ON pea.event_id = e.id
  WHERE avc.agency_id = p_agency_id
    AND avc.status    = 'active'
    AND e.external_source IS NULL
    AND e.start_at   >= now()
    AND e.start_at   <= now() + (p_days_ahead || ' days')::interval
    AND public.is_agency_owner(auth.uid(), p_agency_id)
  GROUP BY e.id, e.title, e.start_at, e.venue_id, v.name, e.organizer_user_id, e.is_active
  ORDER BY e.start_at ASC;
$function$;
REVOKE ALL ON FUNCTION public.get_agency_upcoming_events(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agency_upcoming_events(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gen_event_slug(p_title text, p_event_id uuid DEFAULT NULL::uuid, p_org uuid DEFAULT NULL::uuid, p_venue text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE base text; cand text; n int := 1;
BEGIN
  base := btrim(regexp_replace(lower(extensions.unaccent(coalesce(p_title, 'event'))), '[^a-z0-9]+', '-', 'g'), '-');
  IF base = '' THEN base := 'event'; END IF;
  cand := base;
  WHILE EXISTS (
          SELECT 1 FROM public.events e
           WHERE e.slug = cand
             AND e.external_source IS NULL
             AND e.id IS DISTINCT FROM p_event_id
             AND ( (p_org IS NOT NULL  AND e.organizer_user_id = p_org)
                OR (p_org IS NULL      AND e.organizer_user_id IS NULL AND e.venue_id IS NOT DISTINCT FROM p_venue) )
        )
     OR EXISTS (
          SELECT 1 FROM public.event_slug_aliases a
            JOIN public.events e ON e.id = a.event_id
           WHERE a.slug = cand
             AND e.external_source IS NULL
             AND a.event_id IS DISTINCT FROM p_event_id
             AND ( (p_org IS NOT NULL  AND e.organizer_user_id = p_org)
                OR (p_org IS NULL      AND e.organizer_user_id IS NULL AND e.venue_id IS NOT DISTINCT FROM p_venue) )
        )
  LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  RETURN cand;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_guest_artist_book(p_query text DEFAULT NULL::text)
 RETURNS TABLE(name text, photo_url text, instagram_url text, instagram_handle text, times_used integer, last_used_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  RETURN QUERY
  -- Une personne = un nom (insensible à la casse). On garde sa fiche la plus
  -- récente : si le pro a changé la photo la dernière fois, c'est celle-là que
  -- le carnet propose.
  SELECT DISTINCT ON (lower(a.name))
    a.name,
    a.photo_url,
    a.instagram_url,
    a.instagram_handle,
    count(*) OVER (PARTITION BY lower(a.name))::integer,
    max(a.created_at) OVER (PARTITION BY lower(a.name))
  FROM event_guest_artists a
  WHERE public.can_manage_event_design(auth.uid(), a.event_id)
    AND NOT EXISTS (SELECT 1 FROM public.events ev WHERE ev.id = a.event_id AND ev.external_source IS NOT NULL)
    AND (v_q IS NULL OR a.name ILIKE '%' || v_q || '%')
  ORDER BY lower(a.name), a.created_at DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_guest_artist_book(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guest_artist_book(text) TO authenticated, service_role;

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
      AND NOT EXISTS (SELECT 1 FROM public.events ev WHERE ev.id = tl.event_id AND ev.external_source IS NOT NULL)
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
REVOKE ALL ON FUNCTION public.get_tracked_link_stats(text, text, uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tracked_link_stats(text, text, uuid, uuid, uuid, uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_report(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_now        timestamptz := now();
  e            record;
  v_tz         text;
  v_day_start  timestamptz;
  v_scope_venue text := null;
  v_scope_org  uuid := null;
  v_money      boolean := false;
  v_scope_ids  uuid[];
  v_result     jsonb;
  v_take       jsonb := '[]'::jsonb;
  v_tx_total   integer;
  v_expected   integer;
  v_entered    integer;
  v_heads_d0   integer;
  v_heads      integer;
  v_row        record;
  v_ref        record;
  v_ref_d      integer;
  v_ref_final  integer;
  v_ref_at     integer;
  v_pace       jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select ev.*, coalesce(ev.timezone, v.timezone, 'Europe/Paris') as tz, v.name as venue_name
    into e
  from public.events ev
  left join public.venues v on v.id = coalesce(ev.venue_id, ev.partner_venue_id)
  where ev.id = p_event_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ── Portée + droit de voir l'argent ───────────────────────────────────
  if e.venue_id is not null and (public.can_manage_venue(v_uid, e.venue_id) or public.is_super_admin()) then
    v_scope_venue := e.venue_id;
  elsif e.partner_venue_id is not null and public.can_manage_venue(v_uid, e.partner_venue_id) then
    v_scope_venue := e.partner_venue_id;
  elsif e.organizer_user_id is not null and (
          v_uid = e.organizer_user_id
          or public.is_super_admin()
          or public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) then
    v_scope_org := e.organizer_user_id;
  elsif e.partner_organizer_id is not null and (
          v_uid = e.partner_organizer_id
          or public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) then
    v_scope_org := e.partner_organizer_id;
  -- Co-hôte accepté : la soirée se lit dans SA portée (orga d'abord).
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
                   and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) then
    select c.organizer_user_id into v_scope_org from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.organizer_user_id is not null
       and (c.organizer_user_id = v_uid or public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     order by (c.organizer_user_id = v_uid) desc limit 1;
  elsif exists (select 1 from public.event_cohosts c
                 where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
                   and public.can_manage_venue(v_uid, c.venue_id)) then
    select c.venue_id into v_scope_venue from public.event_cohosts c
     where c.event_id = p_event_id and c.status = 'accepted' and c.venue_id is not null
       and public.can_manage_venue(v_uid, c.venue_id)
     limit 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_scope_venue is not null then
    -- Club hôte, ou club CO-HÔTE quand l'organisateur principal partage les
    -- montants (« Tout », défaut) ; jamais un club qui ne fait qu'accueillir.
    v_money := (coalesce(v_scope_venue = e.venue_id, false)
                or public.coorg_cohost_sees_money(p_event_id, 'venue:' || v_scope_venue)) and (
      public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = v_scope_venue and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = v_scope_venue
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      ));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where (x.venue_id = v_scope_venue or x.partner_venue_id = v_scope_venue or x.id in (select public.cohost_event_ids_venue(v_scope_venue))) and x.external_source is null;
  else
    v_money := (v_uid = v_scope_org
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, v_scope_org, 'view_finance'))
      -- Un co-hôte voit l'argent si l'organisateur principal le partage (défaut)
      -- ou s'il a une part dans un accord actif (coorg_sees_event_money).
      and (public.is_super_admin() or public.coorg_sees_event_money(p_event_id, 'org:' || v_scope_org::text));
    select coalesce(array_agg(x.id), '{}') into v_scope_ids
    from public.events x
    where (x.organizer_user_id = v_scope_org or x.partner_organizer_id = v_scope_org or x.id in (select public.cohost_event_ids_org(v_scope_org))) and x.external_source is null;
  end if;

  v_tz := e.tz;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  with
  -- ── Les ventes de la soirée, une ligne par transaction ────────────────
  tx as materialized (
    select 'tickets'::text as pillar, t.id, lower(t.user_email) as email, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(coalesce(t.quantity, 1), 1) as units,
           greatest(coalesce(t.quantity, 1), 1) as heads,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount,
           coalesce(nullif(t.purchase_source, ''), 'direct') as source,
           t.tracked_link_id, t.ticket_round_id as line_id
    from public.tickets t
    where t.event_id = p_event_id and t.status in ('paid', 'used')
    union all
    select 'tables', r.id, lower(r.user_email), r.user_id,
           coalesce(r.paid_at, r.created_at),
           1,
           greatest(coalesce(r.guest_count, 0), 1),
           greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)),
           coalesce(nullif(r.purchase_source, ''), 'direct'),
           r.tracked_link_id, r.pack_id
    from public.table_reservations r
    where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
    union all
    select 'drinks', o.id, lower(o.user_email), o.user_id,
           coalesce(o.paid_at, o.created_at),
           1,
           0,
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)),
           coalesce(nullif(o.purchase_source, ''), 'direct'),
           o.tracked_link_id, null::uuid
    from public.orders o
    where o.event_id = p_event_id and o.status in ('paid', 'served')
      and v_scope_venue is not null and o.venue_id = v_scope_venue
  ),
  gle as materialized (
    select g.id, lower(nullif(btrim(g.email), '')) as email, g.user_id, g.created_at as at_ts,
           g.guest_list_id as line_id, g.tracked_link_id
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = p_event_id and g.status <> 'cancelled'
  ),
  vis as materialized (
    select s.visited_at, coalesce(nullif(s.referrer_category, ''), 'direct') as source,
           coalesce(s.completed_order, false) as done
    from public.visitor_sessions s
    where s.event_id = p_event_id
  ),

  -- ── Contacts de la soirée, et ceux déjà vus à une soirée PRÉCÉDENTE ────
  people as (
    select distinct email from (
      select email from tx where pillar in ('tickets', 'tables') and email is not null
      union all
      select email from gle where email is not null
    ) p
  ),
  prior_events as materialized (
    select x.id from public.events x
    where x.id = any(v_scope_ids) and x.id <> p_event_id and x.start_at < e.start_at
  ),
  seen_before as (
    select distinct p.email
    from people p
    where exists (select 1 from public.tickets t
                  where t.event_id in (select id from prior_events)
                    and t.status in ('paid', 'used') and lower(t.user_email) = p.email)
       or exists (select 1 from public.table_reservations r
                  where r.event_id in (select id from prior_events)
                    and r.status in ('paid', 'confirmed') and lower(r.user_email) = p.email)
       or exists (select 1 from public.guest_list_entries g
                  join public.guest_lists gl on gl.id = g.guest_list_id
                  where gl.event_id in (select id from prior_events)
                    and g.status <> 'cancelled' and lower(g.email) = p.email)
  ),

  -- ── Série jour par jour, clé d = jours calendaires avant la soirée ─────
  day_rows as (
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date as d,
           case when pillar = 'tickets' then units else 0 end as tickets,
           case when pillar = 'tables' then 1 else 0 end as tables,
           0 as guests, amount, 0 as visits,
           heads as people
    from tx
    union all
    select (e.start_at at time zone v_tz)::date - (at_ts at time zone v_tz)::date, 0, 0, 1, 0, 0, 1 from gle
    union all
    select (e.start_at at time zone v_tz)::date - (visited_at at time zone v_tz)::date, 0, 0, 0, 0, 1, 0 from vis
  ),
  series as (
    select d, sum(tickets) as tickets, sum(tables) as tables, sum(guests) as guests,
           sum(amount) as amount, sum(visits) as visits, sum(people) as people
    from day_rows group by d
  ),

  -- ── Messages qui parlaient de CETTE soirée ────────────────────────────
  emails as (
    select ec.id, coalesce(nullif(ec.subject, ''), ec.name) as title, ec.sent_at,
           coalesce(ec.recipients_count, ec.total_recipients, 0) as reach,
           coalesce(ec.opens_count, 0) as opens, coalesce(ec.clickers_count, ec.clicks_count, 0) as clicks,
           ec.automation_id is not null as auto
    from public.email_campaigns ec
    where (ec.event_id = p_event_id or ec.automation_trigger_event_id = p_event_id)
      and ec.status in ('sent', 'sending', 'paused')
      and ((v_scope_venue is not null and ec.venue_id = v_scope_venue)
        or (v_scope_org is not null and ec.organizer_user_id = v_scope_org))
    order by ec.sent_at desc nulls last
    limit 30
  ),
  email_clicks as (
    select ece.campaign_id, lower(ece.recipient_email) as email, min(ece.created_at) as click_at
    from public.email_campaign_events ece
    where ece.campaign_id in (select id from emails)
      and ece.event_type = 'clicked' and ece.recipient_email is not null
    group by 1, 2
  ),
  email_attr as (
    select c.campaign_id,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from email_clicks c
    join (
      select pillar, id, email, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, email, at_ts, 0 from gle
    ) x on x.email = c.email and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  ),
  pushes as (
    select pc.id, coalesce(pc.title, pc.template_key) as title, pc.created_at as sent_at,
           coalesce(pc.sent_count, 0) as reach, pc.source = 'auto' as auto, pc.template_key
    from public.push_campaigns pc
    where pc.event_id = p_event_id
      and pc.status in ('sent', 'sending', 'completed')
      and ((v_scope_venue is not null and pc.venue_id = v_scope_venue)
        or (v_scope_org is not null and pc.venue_id is null and pc.agency_id is null))
    order by pc.created_at desc
    limit 30
  ),
  push_clicks as (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as click_at
    from public.push_campaign_events pce
    where pce.campaign_id in (select id from pushes)
      and pce.event_type = 'clicked' and pce.user_id is not null
    group by 1, 2
  ),
  push_attr as (
    select c.campaign_id,
           count(*) as clicks,
           count(distinct x.id) filter (where x.pillar <> 'guestlist') as orders,
           coalesce(sum(x.amount), 0) as amount,
           count(distinct x.id) filter (where x.pillar = 'guestlist') as entries
    from push_clicks c
    left join (
      select pillar, id, user_id, at_ts, amount from tx where pillar in ('tickets', 'tables')
      union all
      select 'guestlist', id, user_id, at_ts, 0 from gle
    ) x on x.user_id = c.user_id and x.at_ts >= c.click_at and x.at_ts < c.click_at + interval '72 hours'
    group by c.campaign_id
  )

  select jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'money', v_money,
    'scope', case when v_scope_venue is not null then 'venue' else 'organizer' end,
    'event', jsonb_build_object(
      'id', e.id, 'title', e.title, 'startAt', e.start_at, 'endAt', e.end_at,
      'poster', coalesce(e.poster_url, e.image_url), 'status', e.status,
      'cancelled', e.cancelled_at is not null,
      'publishedAt', e.published_at, 'createdAt', e.created_at,
      'venueName', e.venue_name,
      'entryTarget', e.entry_target,
      'phase', case when v_now >= e.end_at then 'after' when v_now >= e.start_at then 'live' else 'before' end
    ),

    -- 1. Où en sont mes ventes ?
    'totals', jsonb_build_object(
      'tickets', jsonb_build_object(
        'sold', (select coalesce(sum(units), 0) from tx where pillar = 'tickets'),
        'today', (select coalesce(sum(units), 0) from tx where pillar = 'tickets' and at_ts >= v_day_start),
        'orders', (select count(*) from tx where pillar = 'tickets'),
        'capacity', case
          when coalesce(e.max_tickets, 0) > 0 then e.max_tickets
          when exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id)
           and not exists (select 1 from public.ticket_rounds tr where tr.event_id = p_event_id and coalesce(tr.max_tickets, 0) <= 0)
            then (select sum(tr.max_tickets) from public.ticket_rounds tr where tr.event_id = p_event_id)
          else null end,
        'enabled', coalesce(e.ticketing_enabled, false),
        'soldOut', coalesce(e.tickets_sold_out, false)
      ),
      'tables', jsonb_build_object(
        'booked', (select count(*) from tx where pillar = 'tables'),
        'today', (select count(*) from tx where pillar = 'tables' and at_ts >= v_day_start),
        'guests', (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 0)), 0)
                   from public.table_reservations r where r.event_id = p_event_id and r.status in ('paid', 'confirmed')),
        'capacity', nullif((
          select coalesce(sum(p.tables_count), 0)
          from public.table_packs p
          where p.is_active
            and (p.event_id = p_event_id
                 or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                     and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
            and not (p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])))
        ), 0),
        'enabled', coalesce(e.tables_enabled, false),
        'soldOut', coalesce(e.tables_sold_out, false)
      ),
      'guestList', jsonb_build_object(
        'registered', (select count(*) from gle),
        'today', (select count(*) from gle where at_ts >= v_day_start),
        'capacity', (
          select case when count(*) > 0 and count(*) filter (where coalesce(gl.quota, 0) <= 0) = 0
                      then sum(gl.quota) else null end
          from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active
        ),
        'enabled', exists (select 1 from public.guest_lists gl where gl.event_id = p_event_id and gl.is_active),
        'soldOut', coalesce(e.guest_list_sold_out, false)
      ),
      'drinks', case when v_scope_venue is not null then jsonb_build_object(
        'orders', (select count(*) from tx where pillar = 'drinks'),
        'today', (select count(*) from tx where pillar = 'drinks' and at_ts >= v_day_start)
      ) else null end,
      'revenue', case when v_money then jsonb_build_object(
        'total', round((select coalesce(sum(amount), 0) from tx)::numeric, 2),
        'today', round((select coalesce(sum(amount), 0) from tx where at_ts >= v_day_start)::numeric, 2),
        'tickets', round((select coalesce(sum(amount), 0) from tx where pillar = 'tickets')::numeric, 2),
        'tables', round((select coalesce(sum(amount), 0) from tx where pillar = 'tables')::numeric, 2),
        'drinks', round((select coalesce(sum(amount), 0) from tx where pillar = 'drinks')::numeric, 2)
      ) else null end,
      'visits', jsonb_build_object(
        'total', (select count(*) from vis),
        'today', (select count(*) from vis where visited_at >= v_day_start),
        'withOrder', (select count(*) from vis where done)
      ),
      -- La porte : personnes scannées (billets en quantité, convives d'une
      -- table scannée ou arrivée, inscrits guest list) et attendus. Même
      -- définition que « Entrées » dans get_sales_overview.
      'door', jsonb_build_object(
        'entered',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used')
              and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
              and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled' and coalesce(g2.entry_scanned, false)),
        'expected',
          (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
            where t.event_id = p_event_id and t.status in ('paid', 'used'))
        + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
            where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
        + (select count(*) from public.guest_list_entries g2 join public.guest_lists l2 on l2.id = g2.guest_list_id
            where l2.event_id = p_event_id and g2.status <> 'cancelled')
      )
    ),

    'lines', coalesce((
      select jsonb_agg(l.obj order by l.pillar_ord, l.ord)
      from (
        -- Paliers de billets
        select 1 as pillar_ord, coalesce(tr.position, 0) * 1000 + row_number() over (order by tr.position, tr.created_at) as ord,
               jsonb_build_object(
                 'pillar', 'tickets', 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0),
                 'capacity', nullif(tr.max_tickets, 0),
                 'status', case
                   when coalesce(e.tickets_sold_out, false) or coalesce(tr.manually_sold_out, false)
                     or (coalesce(tr.max_tickets, 0) > 0 and coalesce((select sum(units) from tx where pillar = 'tickets' and line_id = tr.id), 0) >= tr.max_tickets)
                     then 'sold_out'
                   when tr.is_active then 'on_sale'
                   when coalesce(tr.auto_activate, false) then 'upcoming'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tickets' and line_id = tr.id), 0)::numeric, 2) else null end
               ) as obj
        from public.ticket_rounds tr where tr.event_id = p_event_id
        union all
        -- Formules de table (de la soirée, ou du club quand elles ne sont pas event-scopées)
        select 2, coalesce(p.position, 0) * 1000 + row_number() over (order by p.position, p.created_at),
               jsonb_build_object(
                 'pillar', 'tables', 'id', p.id, 'name', p.name, 'price', p.base_price,
                 'sold', (select count(*) from tx where pillar = 'tables' and line_id = p.id),
                 'capacity', nullif(p.tables_count, 0),
                 'status', case
                   when coalesce(e.tables_sold_out, false) or p.id = any (coalesce(e.sold_out_pack_ids, '{}'::uuid[])) then 'sold_out'
                   when coalesce(p.tables_count, 0) > 0 and (select count(*) from tx where pillar = 'tables' and line_id = p.id) >= p.tables_count then 'sold_out'
                   when coalesce(e.tables_enabled, false) then 'on_sale'
                   else 'closed' end,
                 'amount', case when v_money then round(coalesce((select sum(amount) from tx where pillar = 'tables' and line_id = p.id), 0)::numeric, 2) else null end
               )
        from public.table_packs p
        where p.is_active
          and (p.event_id = p_event_id
               or (p.event_id is null and coalesce(e.venue_id, e.partner_venue_id) is not null
                   and p.venue_id = coalesce(e.venue_id, e.partner_venue_id)))
        union all
        -- Parts de guest list
        select 3, row_number() over (order by gl.created_at),
               jsonb_build_object(
                 'pillar', 'guestList', 'id', gl.id,
                 'name', nullif(btrim(coalesce(gl.holder_label, '')), ''),
                 'holderType', gl.holder_type,
                 'price', null,
                 'sold', (select count(*) from gle where line_id = gl.id),
                 'capacity', nullif(gl.quota, 0),
                 'status', case
                   when coalesce(e.guest_list_sold_out, false) or coalesce(gl.manually_sold_out, false) then 'sold_out'
                   when coalesce(gl.quota, 0) > 0 and (select count(*) from gle where line_id = gl.id) >= gl.quota then 'sold_out'
                   when gl.is_active then 'on_sale'
                   else 'closed' end,
                 'amount', null
               )
        from public.guest_lists gl where gl.event_id = p_event_id
      ) l
    ), '[]'::jsonb),

    -- 2. Comment évoluent-elles ?
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
               'd', s.d, 'tickets', s.tickets, 'tables', s.tables, 'guests', s.guests,
               'amount', case when v_money then round(s.amount::numeric, 2) else null end,
               'visits', s.visits, 'people', s.people
             ) order by s.d desc)
      from series s
    ), '[]'::jsonb),

    -- 3. Est-ce qu'on voit ma soirée ?
    'visitSources', coalesce((
      select jsonb_agg(jsonb_build_object('source', v.source, 'sessions', v.sessions, 'orders', v.orders) order by v.sessions desc)
      from (select source, count(*) as sessions, count(*) filter (where done) as orders
            from vis group by source order by 2 desc limit 8) v
    ), '[]'::jsonb),

    -- 4. Qui achète ?
    'audience', jsonb_build_object(
      'people', (select count(*) from people),
      'returning', (select count(*) from seen_before),
      'new', (select count(*) from people) - (select count(*) from seen_before),
      'buyers', (select count(distinct email) from tx where pillar in ('tickets', 'tables') and email is not null),
      'priorEvents', (select count(*) from prior_events)
    ),

    -- 5. Qu'est-ce qui a fait vendre ?
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('source', c.source, 'n', c.n,
               'amount', case when v_money then round(c.amount::numeric, 2) else null end) order by c.n desc)
      from (
        select case when source in ('venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct') then source
                    when source in ('manual', 'manual_open') then 'manual'
                    else 'other' end as source,
               count(*) as n, sum(amount) as amount
        from tx where pillar in ('tickets', 'tables')
        group by 1
      ) c
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'label', coalesce(nullif(btrim(k.label), ''), k.utm_source, k.code), 'code', k.code,
               'clicks', coalesce(k.clicks_count, 0), 'n', k.n, 'entries', k.entries,
               'amount', case when v_money then round(k.amount::numeric, 2) else null end
             ) order by k.n + k.entries desc, k.clicks_count desc nulls last)
      from (
        select tl.id, tl.label, tl.utm_source, tl.code, tl.clicks_count,
               (select count(*) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as n,
               (select count(*) from gle where gle.tracked_link_id = tl.id) as entries,
               (select coalesce(sum(amount), 0) from tx where tx.tracked_link_id = tl.id and pillar in ('tickets', 'tables')) as amount
        from public.tracked_links tl
        where tl.event_id = p_event_id
           or tl.id in (select tracked_link_id from tx where tracked_link_id is not null)
           or tl.id in (select tracked_link_id from gle where tracked_link_id is not null)
      ) k
      where k.n > 0 or k.entries > 0 or coalesce(k.clicks_count, 0) > 0
    ), '[]'::jsonb),
    -- Repères de la courbe J-N : publication, ouverture d'un tarif (première
    -- vente d'un palier qui n'est pas le premier), emails et push de la soirée.
    'markers', coalesce((
      select jsonb_agg(jsonb_build_object('kind', mk.kind, 'd', mk.d, 'at', mk.at_ts, 'label', mk.label)
                       order by mk.at_ts)
      from (
        select 'published'::text as kind, e.published_at as at_ts, null::text as label,
               (e.start_at at time zone v_tz)::date - (e.published_at at time zone v_tz)::date as d
        where e.published_at is not null
        union all
        select 'round', r.first_at, r.name,
               (e.start_at at time zone v_tz)::date - (r.first_at at time zone v_tz)::date
        from (
          select tr.name, min(tx.at_ts) as first_at,
                 row_number() over (order by min(tx.at_ts)) as rn
          from public.ticket_rounds tr
          join tx on tx.pillar = 'tickets' and tx.line_id = tr.id
          where tr.event_id = p_event_id
          group by tr.id, tr.name
        ) r
        where r.rn > 1
        union all
        select 'email', em.sent_at, em.title,
               (e.start_at at time zone v_tz)::date - (em.sent_at at time zone v_tz)::date
        from emails em where em.sent_at is not null
        union all
        select 'push', pu.sent_at, pu.title,
               (e.start_at at time zone v_tz)::date - (pu.sent_at at time zone v_tz)::date
        from pushes pu where pu.sent_at is not null
      ) mk
      where mk.at_ts <= v_now
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(m.obj order by m.sent_at desc nulls last)
      from (
        select em.sent_at, jsonb_build_object(
                 'kind', 'email', 'id', em.id, 'title', em.title, 'sentAt', em.sent_at, 'auto', em.auto,
                 'reach', em.reach, 'opens', em.opens, 'clicks', em.clicks,
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               ) as obj
        from emails em left join email_attr a on a.campaign_id = em.id
        union all
        select pu.sent_at, jsonb_build_object(
                 'kind', 'push', 'id', pu.id, 'title', pu.title, 'sentAt', pu.sent_at, 'auto', pu.auto,
                 'templateKey', pu.template_key,
                 'reach', pu.reach, 'opens', null, 'clicks', coalesce(a.clicks, 0),
                 'orders', coalesce(a.orders, 0), 'entries', coalesce(a.entries, 0),
                 'amount', case when v_money then round(coalesce(a.amount, 0)::numeric, 2) else null end
               )
        from pushes pu left join push_attr a on a.campaign_id = pu.id
      ) m
    ), '[]'::jsonb)
  )
  into v_result;

  -- ── À retenir : 0 à 3 constats, chacun avec son seuil et sa section ──────
  -- Clé + paramètres ; le texte est traduit côté front (er.tk.*). Une base
  -- mince ne dit rien : chaque constat porte un minimum de volume.
  v_entered  := coalesce((v_result #>> '{totals,door,entered}')::int, 0);
  v_expected := coalesce((v_result #>> '{totals,door,expected}')::int, 0);
  v_tx_total := coalesce((v_result #>> '{totals,tickets,orders}')::int, 0)
              + coalesce((v_result #>> '{totals,tables,booked}')::int, 0)
              + coalesce((v_result #>> '{totals,guestList,registered}')::int, 0);

  -- 1. Soirée passée : la porte n'a pas vu tout le monde.
  if v_result #>> '{event,phase}' = 'after' and v_expected >= 30 and v_entered > 0
     and v_entered::numeric / v_expected < 0.7 then
    v_take := v_take || jsonb_build_object('key', 'no_show', 'tone', 'bad', 'section', 'sales',
      'params', jsonb_build_object('pct', round(100.0 * v_entered / v_expected), 'missing', v_expected - v_entered));
  end if;

  -- 2. Un message a fait une bonne part des ventes.
  select m.value into v_row from jsonb_array_elements(v_result -> 'messages') m
   order by (m.value ->> 'orders')::int + (m.value ->> 'entries')::int desc limit 1;
  if found and v_tx_total >= 10
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) >= 5
     and ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int)::numeric / v_tx_total >= 0.2 then
    v_take := v_take || jsonb_build_object('key', 'msg_drove', 'tone', 'good', 'section', 'reach',
      'params', jsonb_build_object('kind', v_row.value ->> 'kind', 'title', v_row.value ->> 'title',
        'n', (v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int,
        'pct', round(100.0 * ((v_row.value ->> 'orders')::int + (v_row.value ->> 'entries')::int) / v_tx_total)));
  end if;

  -- 3. Beaucoup de visites, peu d'achats.
  if coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 100
     and (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int < 0.02 then
    v_take := v_take || jsonb_build_object('key', 'low_conversion', 'tone', 'bad', 'section', 'reach',
      'params', jsonb_build_object('visits', (v_result #>> '{totals,visits,total}')::int,
        'pct', round(100.0 * (v_result #>> '{totals,visits,withOrder}')::numeric / (v_result #>> '{totals,visits,total}')::int, 1)));
  end if;

  -- 4. Soirée passée : une grosse part des attendus a acheté le jour J.
  select coalesce(sum((x.value ->> 'people')::int) filter (where (x.value ->> 'd')::int <= 0), 0),
         coalesce(sum((x.value ->> 'people')::int), 0)
    into v_heads_d0, v_heads
  from jsonb_array_elements(v_result -> 'series') x;
  if v_result #>> '{event,phase}' = 'after' and v_heads >= 30 and v_heads_d0::numeric / v_heads >= 0.3 then
    v_take := v_take || jsonb_build_object('key', 'day_of', 'tone', 'info', 'section', 'curve',
      'params', jsonb_build_object('pct', round(100.0 * v_heads_d0 / v_heads)));
  end if;

  -- 5. D'où viennent les visites.
  select s.value into v_row from jsonb_array_elements(v_result -> 'visitSources') s
   order by (s.value ->> 'sessions')::int desc limit 1;
  if found and coalesce((v_result #>> '{totals,visits,total}')::int, 0) >= 30
     and (v_row.value ->> 'sessions')::numeric / (v_result #>> '{totals,visits,total}')::int >= 0.5 then
    v_take := v_take || jsonb_build_object('key', 'visit_source', 'tone', 'info', 'section', 'reach',
      'params', jsonb_build_object('source', v_row.value ->> 'source',
        'pct', round(100.0 * (v_row.value ->> 'sessions')::int / (v_result #>> '{totals,visits,total}')::int)));
  end if;

  -- 6. Public neuf ou public d'habitués (seulement s'il y a eu des soirées avant).
  if coalesce((v_result #>> '{audience,people}')::int, 0) >= 20
     and coalesce((v_result #>> '{audience,priorEvents}')::int, 0) >= 1 then
    if (v_result #>> '{audience,new}')::numeric / (v_result #>> '{audience,people}')::int >= 0.6 then
      v_take := v_take || jsonb_build_object('key', 'mostly_new', 'tone', 'info', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,new}')::int / (v_result #>> '{audience,people}')::int)));
    elsif (v_result #>> '{audience,returning}')::numeric / (v_result #>> '{audience,people}')::int >= 0.5 then
      v_take := v_take || jsonb_build_object('key', 'mostly_returning', 'tone', 'good', 'section', 'who',
        'params', jsonb_build_object('pct', round(100.0 * (v_result #>> '{audience,returning}')::int / (v_result #>> '{audience,people}')::int)));
    end if;
  end if;

  -- ── Rythme : la dernière soirée TERMINÉE de la portée (≥ 20 attendus), et
  --    la part de ses attendus qu'elle avait au même J-N. Le front applique
  --    cette part aux attendus d'aujourd'hui pour dire où finira la soirée.
  if v_result #>> '{event,phase}' = 'before' then
    v_ref_d := (e.start_at at time zone v_tz)::date - (v_now at time zone v_tz)::date;
    for v_ref in
      select x.id, x.title, x.start_at, coalesce(x.timezone, v.timezone, 'Europe/Paris') as tz
      from public.events x
      left join public.venues v on v.id = coalesce(x.venue_id, x.partner_venue_id)
      where x.id = any(v_scope_ids) and x.id <> p_event_id
        and x.cancelled_at is null and x.end_at < v_now and x.start_at < e.start_at
      order by x.start_at desc
      limit 6
    loop
      select coalesce(sum(h.n), 0),
             -- Jours ENTIERS avant ce J-N (strictement) : aujourd'hui n'est pas
             -- fini ici, on ne le compare pas à une journée complète là-bas.
             coalesce(sum(h.n) filter (where (v_ref.start_at at time zone v_ref.tz)::date - (h.at_ts at time zone v_ref.tz)::date > v_ref_d), 0)
        into v_ref_final, v_ref_at
      from (
        select greatest(coalesce(t.quantity, 1), 1) as n, coalesce(t.paid_at, t.created_at) as at_ts
        from public.tickets t where t.event_id = v_ref.id and t.status in ('paid', 'used')
        union all
        select greatest(coalesce(r.guest_count, 0), 1), coalesce(r.paid_at, r.created_at)
        from public.table_reservations r where r.event_id = v_ref.id and r.status in ('paid', 'confirmed')
        union all
        select 1, g.created_at
        from public.guest_list_entries g join public.guest_lists gl on gl.id = g.guest_list_id
        where gl.event_id = v_ref.id and g.status <> 'cancelled'
      ) h;
      if v_ref_final >= 20 then
        v_pace := jsonb_build_object('refId', v_ref.id, 'refTitle', v_ref.title, 'd', v_ref_d,
                                     'final', v_ref_final, 'atSameD', v_ref_at);
        exit;
      end if;
    end loop;
  end if;
  v_result := v_result || jsonb_build_object('pace', v_pace);

  v_result := v_result || jsonb_build_object('takeaways',
    coalesce((select jsonb_agg(x.value) from (select value from jsonb_array_elements(v_take) limit 3) x), '[]'::jsonb));

  return v_result;
end;
$function$;
REVOKE ALL ON FUNCTION public.get_event_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_report(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_push_center(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid       uuid := auth.uid();
  v_money     boolean := false;
  v_party     text;
  v_event_ids uuid[];
  v_days      integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 120);
  v_from      timestamptz;
  v_result    jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  v_from := now() - make_interval(days => v_days);

  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT (v_uid = p_organizer_user_id OR public.is_super_admin()
            OR public.is_org_team_member(v_uid, p_organizer_user_id, 'admin')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := v_uid = p_organizer_user_id OR public.is_super_admin()
      OR public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    v_party := 'org:' || p_organizer_user_id::text;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id OR e.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id))) AND e.external_source IS NULL;
  ELSIF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR public.is_venue_owner(v_uid, p_venue_id)
            OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                        WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                          AND (COALESCE(mp.can_manage_crm, false) OR COALESCE(mp.can_view_analytics, false)))) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                  WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                    AND (COALESCE(mp.can_view_analytics, false) OR COALESCE(mp.can_view_finance, false)));
    v_party := 'venue:' || p_venue_id;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id OR e.id IN (SELECT public.cohost_event_ids_venue(p_venue_id))) AND e.external_source IS NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  WITH
  ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, COALESCE(e.poster_url, e.image_url) AS image, e.published_at,
           COALESCE(e.visibility::text, 'public') AS visibility
      FROM public.events e
     WHERE e.id = ANY (v_event_ids) AND e.cancelled_at IS NULL
       AND e.start_at >= v_from AND e.start_at < now() + interval '180 days'
  ),
  camp AS MATERIALIZED (
    SELECT pc.id, pc.event_id, pc.created_at, COALESCE(pc.sent_count, 0) AS sent_count,
           CASE pc.template_key
             WHEN 'almost_sold_out' THEN 'last_tickets' WHEN 'thank_you' THEN 'after_thanks'
             WHEN 'reminder_day_of' THEN 'event_day_reminder' WHEN 'drinks_preorder' THEN 'event_day_reminder'
             WHEN 'event_live' THEN 'doors_open' ELSE pc.template_key END AS rule
      FROM public.push_campaigns pc
     WHERE pc.source = 'auto' AND pc.event_id IN (SELECT ev.id FROM ev)
  ),
  recv AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'sent' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  taps AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'clicked' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  sales AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.id, t.user_id, t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
           GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - LEAST(GREATEST(COALESCE(t.refund_amount, 0), 0),
                     GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t
     WHERE t.event_id IN (SELECT ev.id FROM ev) AND t.status IN ('paid', 'used') AND t.user_id IS NOT NULL
    UNION ALL
    SELECT 'tables', r.id, r.user_id, r.event_id, COALESCE(r.paid_at, r.created_at),
           GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0),
                     GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT ev.id FROM ev) AND r.status IN ('paid', 'confirmed') AND r.user_id IS NOT NULL
    UNION ALL
    SELECT 'guestlist', g.id, g.user_id, gl.event_id, g.created_at, 0
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id IN (SELECT ev.id FROM ev) AND g.status <> 'cancelled' AND g.user_id IS NOT NULL
  ),
  touch AS MATERIALIZED (
    SELECT DISTINCT ON (s.pillar, s.id) s.pillar, s.id AS sale_id, s.user_id, s.event_id, s.amount,
           c.rule, tp.campaign_id
      FROM sales s
      JOIN taps tp ON tp.user_id = s.user_id
      JOIN camp c ON c.id = tp.campaign_id AND c.event_id = s.event_id
     WHERE s.at >= tp.at AND s.at < tp.at + interval '72 hours'
     ORDER BY s.pillar, s.id, tp.at DESC
  ),
  infl AS MATERIALIZED (
    SELECT DISTINCT rv.campaign_id, rv.user_id
      FROM recv rv
      JOIN camp c ON c.id = rv.campaign_id
      JOIN sales s ON s.user_id = rv.user_id AND s.event_id = c.event_id AND s.pillar <> 'guestlist'
     WHERE s.at >= rv.at AND s.at < rv.at + interval '72 hours'
  ),
  cand AS MATERIALIZED (
    SELECT c.rule_key, c.event_id, c.status, COALESCE(c.hold_reason, '') AS hold, c.reason_party,
           c.user_id, c.campaign_id, c.not_before
      FROM public.push_candidates c
     WHERE c.event_id IN (SELECT ev.id FROM ev)
  ),
  per_camp AS MATERIALIZED (
    SELECT c.id, c.event_id, c.rule, c.created_at, c.sent_count,
           (SELECT count(*) FROM taps t WHERE t.campaign_id = c.id) AS taps,
           (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.campaign_id = c.id AND t.pillar <> 'guestlist') AS buyers,
           (SELECT count(*) FROM touch t WHERE t.campaign_id = c.id AND t.pillar = 'guestlist') AS entries,
           (SELECT COALESCE(sum(t.amount), 0) FROM touch t WHERE t.campaign_id = c.id) AS revenue,
           (SELECT count(*) FROM infl i WHERE i.campaign_id = c.id) AS influenced
      FROM camp c
  ),
  steps AS MATERIALIZED (
    SELECT k.event_id, k.rule,
           COALESCE(sum(pc.sent_count), 0) AS sent,
           COALESCE(sum(pc.taps), 0) AS taps,
           COALESCE(sum(pc.buyers), 0) AS buyers,
           COALESCE(sum(pc.entries), 0) AS entries,
           COALESCE(sum(pc.revenue), 0) AS revenue,
           COALESCE(sum(pc.influenced), 0) AS influenced,
           max(pc.created_at) AS last_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('pending', 'claimed')) AS queued,
           (SELECT min(x.not_before) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status = 'pending') AS next_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('skipped', 'expired')
               AND x.hold IN ('daily_cap', 'weekly_cap', 'fatigue', 'quiet_hours', 'event_budget',
                                  'lower_priority', 'awaiting_announcement', 'window_passed')) AS held,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.hold = 'already_bought') AS bought_before
      FROM (SELECT DISTINCT camp.event_id, camp.rule FROM camp
            UNION SELECT DISTINCT cand.event_id, cand.rule_key FROM cand) k
      LEFT JOIN per_camp pc ON pc.event_id = k.event_id AND pc.rule = k.rule
     GROUP BY k.event_id, k.rule
  ),
  mine AS MATERIALIZED (
    SELECT x.user_id, x.campaign_id FROM cand x WHERE x.status = 'sent' AND x.reason_party = v_party
  ),
  disc AS (
    SELECT count(*) AS selections, count(DISTINCT ds.user_id) AS people,
           count(*) FILTER (WHERE ds.opened_at IS NOT NULL) AS opened
      FROM public.discovery_selections ds
     WHERE ds.created_at >= v_from AND ds.event_ids && v_event_ids
  ),
  evj AS (
    SELECT e.*, ps.announce_at,
           (SELECT count(*) FROM public.event_parties(e.id)) AS parties,
           EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0) AS announced,
           (e.start_at > now() + interval '3 hours'
            AND e.visibility = 'public'
            AND NOT EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0)
            AND (public.is_super_admin() OR EXISTS (
                  SELECT 1 FROM public.event_parties(e.id) p
                   WHERE p.role IN ('lead', 'partner') AND public.coorg_party_level(v_uid, p.party_key) >= 2))) AS can_schedule
      FROM ev e
      LEFT JOIN public.push_event_settings ps ON ps.event_id = e.id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'money', v_money,
    'days', v_days,
    'party', v_party,
    'summary', jsonb_build_object(
      'sent',       (SELECT COALESCE(sum(pc.sent_count), 0) FROM per_camp pc),
      'people',     (SELECT count(DISTINCT rv.user_id) FROM recv rv),
      'taps',       (SELECT count(*) FROM taps),
      'buyers',     (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.pillar <> 'guestlist'),
      'entries',    (SELECT count(*) FROM touch t WHERE t.pillar = 'guestlist'),
      'influenced', (SELECT count(DISTINCT i.user_id) FROM infl i),
      'revenue',    CASE WHEN v_money THEN round((SELECT COALESCE(sum(t.amount), 0) FROM touch t)::numeric, 2) END,
      'held',       (SELECT COALESCE(sum(st.held), 0) FROM steps st),
      'boughtBefore', (SELECT COALESCE(sum(st.bought_before), 0) FROM steps st),
      'queued',     (SELECT COALESCE(sum(st.queued), 0) FROM steps st)
    ),
    'viaMe', jsonb_build_object(
      'multiParty', EXISTS (SELECT 1 FROM evj WHERE evj.parties > 1),
      'sent',  (SELECT count(*) FROM mine),
      'taps',  (SELECT count(*) FROM mine m JOIN taps t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id),
      'buyers', (SELECT count(DISTINCT m.user_id) FROM mine m
                   JOIN touch t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id AND t.pillar <> 'guestlist')
    ),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', s.notification_key, 'enabled', s.enabled, 'params', s.params,
               'sent',    (SELECT COALESCE(sum(st.sent), 0) FROM steps st WHERE st.rule = s.notification_key),
               'taps',    (SELECT COALESCE(sum(st.taps), 0) FROM steps st WHERE st.rule = s.notification_key),
               'buyers',  (SELECT COALESCE(sum(st.buyers), 0) FROM steps st WHERE st.rule = s.notification_key),
               'revenue', CASE WHEN v_money THEN round((SELECT COALESCE(sum(st.revenue), 0) FROM steps st WHERE st.rule = s.notification_key)::numeric, 2) END,
               'held',    (SELECT COALESCE(sum(st.held), 0) FROM steps st WHERE st.rule = s.notification_key),
               'queued',  (SELECT COALESCE(sum(st.queued), 0) FROM steps st WHERE st.rule = s.notification_key)
             ) ORDER BY s.notification_key)
        FROM public.platform_notification_settings s WHERE s.category = 'event_engine'
    ), '[]'::jsonb),
    'discovery', (SELECT jsonb_build_object('selections', d.selections, 'people', d.people, 'opened', d.opened) FROM disc d),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'startAt', e.start_at, 'image', e.image,
               'publishedAt', e.published_at, 'visibility', e.visibility,
               'upcoming', e.start_at > now(),
               'announceAt', e.announce_at, 'announced', e.announced,
               'canSchedule', e.can_schedule, 'parties', e.parties,
               'steps', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'rule', st.rule, 'sent', st.sent, 'taps', st.taps, 'buyers', st.buyers,
                          'entries', st.entries, 'influenced', st.influenced,
                          'revenue', CASE WHEN v_money THEN round(st.revenue::numeric, 2) END,
                          'queued', st.queued, 'nextAt', st.next_at, 'held', st.held,
                          'boughtBefore', st.bought_before, 'lastAt', st.last_at))
                   FROM steps st WHERE st.event_id = e.id), '[]'::jsonb)
             ) ORDER BY (e.start_at < now()), CASE WHEN e.start_at >= now() THEN e.start_at END ASC, e.start_at DESC)
        FROM (SELECT * FROM evj
               ORDER BY (evj.start_at < now()), CASE WHEN evj.start_at >= now() THEN evj.start_at END ASC, evj.start_at DESC
               LIMIT 30) e
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_push_center(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_push_center(text, uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_meta_ads(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conn public.meta_connections%ROWTYPE;
  v_out  jsonb;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_my_meta_ads: at most one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.meta_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conn FROM public.meta_connections mc
   WHERE mc.venue_id IS NOT DISTINCT FROM p_venue_id AND mc.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
   LIMIT 1;

  v_out := jsonb_build_object(
    'connection', CASE WHEN v_conn.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conn.id, 'mode', v_conn.mode, 'status', v_conn.status, 'pixel_id', v_conn.pixel_id,
      'ad_account_id', v_conn.ad_account_id, 'page_id', v_conn.page_id, 'ig_user_id', v_conn.ig_user_id,
      'token_kind', v_conn.token_kind, 'assets', v_conn.assets, 'last_health', v_conn.last_health,
      'ads_ready', (v_conn.status = 'active' AND v_conn.ad_account_id IS NOT NULL AND v_conn.page_id IS NOT NULL)
    ) END,
    'audiences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'ref', a.ref, 'name', a.name, 'meta_audience_id', a.meta_audience_id,
        'lookalike_ratio', a.lookalike_ratio, 'lookalike_country', a.lookalike_country,
        'size_uploaded', a.size_uploaded, 'status', a.status, 'last_sync_at', a.last_sync_at, 'last_error', a.last_error,
        'created_at', a.created_at) ORDER BY a.created_at)
        FROM public.meta_audiences a WHERE a.connection_id = v_conn.id), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'status', c.status, 'effective_status', c.effective_status, 'objective', c.objective,
        'event_id', c.event_id, 'event_title', e.title, 'event_start_at', e.start_at, 'event_poster_url', e.poster_url,
        'budget_type', c.budget_type, 'budget_cents', c.budget_cents, 'currency', c.currency,
        'start_at', c.start_at, 'end_at', c.end_at, 'targeting', c.targeting, 'creative', c.creative, 'placements', c.placements,
        'creatives', c.creatives, 'meta_ads', c.meta_ads, 'ad_insights', c.ad_insights,
        'delivery', c.delivery, 'insight_breakdowns', c.insight_breakdowns,
        'meta_campaign_id', c.meta_campaign_id, 'meta_ad_id', c.meta_ad_id, 'review_feedback', c.review_feedback,
        'last_error', c.last_error, 'last_synced_at', c.last_synced_at, 'created_at', c.created_at,
        'tracked_code', tl.code,
        'insights', (SELECT jsonb_build_object(
            'spend_cents', COALESCE(sum(i.spend_cents), 0), 'impressions', COALESCE(sum(i.impressions), 0),
            'reach', COALESCE(max(i.reach), 0), 'clicks', COALESCE(sum(i.clicks), 0), 'link_clicks', COALESCE(sum(i.link_clicks), 0),
            'purchases', COALESCE(sum(i.purchases), 0), 'purchase_value_cents', COALESCE(sum(i.purchase_value_cents), 0),
            'leads', COALESCE(sum(i.leads), 0),
            'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'spend_cents', d.spend_cents, 'clicks', d.link_clicks, 'purchases', d.purchases) ORDER BY d.day)
                               FROM public.meta_insights_daily d WHERE d.campaign_id = c.id), '[]'::jsonb))
          FROM public.meta_insights_daily i WHERE i.campaign_id = c.id),
        'attributed', jsonb_build_object(
          'tickets', (SELECT count(*) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tickets_revenue_cents', (SELECT COALESCE(round(sum((greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)))) * 100), 0) FROM public.tickets t WHERE t.tracked_link_id = c.tracked_link_id AND t.paid_at IS NOT NULL),
          'tables', (SELECT count(*) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'tables_revenue_cents', (SELECT COALESCE(round(sum((greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0) - least(greatest(coalesce(tr.refund_amount, 0), 0), greatest(tr.total_price - coalesce(tr.service_fee, 0) - (CASE WHEN coalesce(tr.fee_absorbed, false) THEN coalesce(tr.management_fee, 0) ELSE 0 END), 0)))) * 100), 0) FROM public.table_reservations tr WHERE tr.tracked_link_id = c.tracked_link_id AND tr.paid_at IS NOT NULL),
          'orders', (SELECT count(*) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'orders_revenue_cents', (SELECT COALESCE(round(sum((greatest(o.total - coalesce(o.service_fee, 0), 0) - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)))) * 100), 0) FROM public.orders o WHERE o.tracked_link_id = c.tracked_link_id AND o.status IN ('paid', 'served')),
          'guest_list', (SELECT count(*) FROM public.guest_list_entries g WHERE g.tracked_link_id = c.tracked_link_id AND g.status <> 'cancelled'),
          'clicks', COALESCE(tl.clicks_count, 0)
        )) ORDER BY c.created_at DESC)
        FROM public.meta_campaigns c
        LEFT JOIN public.events e ON e.id = c.event_id
        LEFT JOIN public.tracked_links tl ON tl.id = c.tracked_link_id
       WHERE c.connection_id = v_conn.id), '[]'::jsonb),
    'leads', jsonb_build_object(
      'total', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id),
      'last_30d', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.received_at >= now() - interval '30 days'),
      'pending', (SELECT count(*) FROM public.meta_leads l WHERE l.connection_id = v_conn.id AND l.processed_at IS NULL),
      'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.leadgen_id, 'name', r.contact_name, 'email', r.contact_email, 'received_at', r.received_at, 'processed', r.processed_at IS NOT NULL, 'error', r.error) ORDER BY r.received_at DESC)
                            FROM (SELECT * FROM public.meta_leads l WHERE l.connection_id = v_conn.id ORDER BY l.received_at DESC LIMIT 20) r), '[]'::jsonb)
    ),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at, 'poster_url', e.poster_url, 'city', e.location_city,
          'venue_name', COALESCE((SELECT v.name FROM public.venues v WHERE v.id = e.venue_id), e.location_name),
          'price_from', (SELECT min(tr.price) FROM public.ticket_rounds tr WHERE tr.event_id = e.id AND tr.is_active AND tr.price > 0),
          'lineup', COALESCE((
            SELECT array_to_json(array_remove(array_agg(x.n ORDER BY x.o), NULL))::jsonb FROM (
              SELECT COALESCE(NULLIF(d.stage_name, ''), NULLIF(d.first_name || ' ' || d.last_name, ' ')) AS n, 0 AS o FROM public.event_djs ed JOIN public.djs d ON d.id = ed.dj_id WHERE ed.event_id = e.id
              UNION ALL
              SELECT g.name, 1 + g.position FROM public.event_guest_artists g WHERE g.event_id = e.id
            ) x), '[]'::jsonb)
        ) ORDER BY e.start_at)
        FROM public.events e
       WHERE e.end_at >= now() AND e.external_source IS NULL AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id OR e.id in (select public.cohost_event_ids_venue(p_venue_id))))
           OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id OR e.id in (select public.cohost_event_ids_org(p_organizer_user_id)))))), '[]'::jsonb),
    'segments', jsonb_build_object(
      'venue', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', vs.id, 'name', vs.name) ORDER BY vs.name) FROM public.venue_segments vs WHERE p_venue_id IS NOT NULL AND vs.venue_id = p_venue_id), '[]'::jsonb),
      'contact', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cs.id, 'name', cs.name) ORDER BY cs.name) FROM public.contact_segments cs WHERE cs.venue_id IS NOT DISTINCT FROM p_venue_id AND cs.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id), '[]'::jsonb)
    ),
    'home', jsonb_build_object(
      'city', COALESCE((SELECT v.city FROM public.venues v WHERE v.id = p_venue_id), (SELECT op.city FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id)),
      'latitude', (SELECT v.latitude FROM public.venues v WHERE v.id = p_venue_id),
      'longitude', (SELECT v.longitude FROM public.venues v WHERE v.id = p_venue_id)
    )
  );
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_meta_ads(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_meta_ads(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_staff_night_pulse(p_venue_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_venue       text;
  v_night_start timestamptz;
  v_night       date;
  v_event_ids   uuid[];
  v_result      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  v_venue := COALESCE(p_venue_id, public.get_user_venue_id(v_uid));
  IF v_venue IS NULL OR NOT public.is_night_staff_of_venue(v_venue) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- « Cette nuit » démarre à 6h du matin, heure de Paris — même convention que
  -- get_staff_self_stats (20260718110000).
  v_night_start := (
    date_trunc('day', (now() AT TIME ZONE 'Europe/Paris') - interval '6 hours')
    + interval '6 hours'
  ) AT TIME ZONE 'Europe/Paris';
  v_night := public.paris_night_date();

  -- Les événements de la nuit : lead OU co-soirée dont ce club tient la porte.
  SELECT COALESCE(array_agg(e.id), '{}')
    INTO v_event_ids
    FROM public.events e
   WHERE (e.venue_id = v_venue OR e.partner_venue_id = v_venue) AND e.external_source IS NULL AND e.start_at < v_night_start + interval '24 hours'
     AND e.end_at   > v_night_start
     AND COALESCE(e.status, '') <> 'cancelled';

  SELECT jsonb_build_object(
    'venue_id', v_venue,
    'night_date', v_night,
    'night_start', v_night_start,

    -- L'événement « principal » : celui en cours, sinon le prochain de la nuit.
    'event', (
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title,
        'start_at', e.start_at, 'end_at', e.end_at
      )
      FROM public.events e
      WHERE e.id = ANY(v_event_ids)
      ORDER BY (now() BETWEEN e.start_at AND e.end_at) DESC, e.start_at ASC
      LIMIT 1
    ),

    -- ── Les attendus (connus avant l'ouverture) ──────────────────────────────
    'expected', jsonb_build_object(
      'tickets_sold', (
        SELECT COALESCE(sum(t.quantity), 0) FROM public.tickets t
         WHERE t.event_id = ANY(v_event_ids) AND t.status = 'paid'
      ),
      'guest_list', (
        SELECT count(*) FROM public.guest_list_entries gle
         WHERE gle.guest_list_id IN (
           SELECT gl.id FROM public.guest_lists gl WHERE gl.event_id = ANY(v_event_ids)
         )
      ),
      'vip_tables', (
        SELECT count(*) FROM public.table_reservations tr
         WHERE tr.event_id = ANY(v_event_ids) AND tr.status = 'paid'
      ),
      'capacity', (
        SELECT b.capacity FROM public.venue_hype_baseline b WHERE b.venue_id = v_venue
      )
    ),

    -- ── Le direct ────────────────────────────────────────────────────────────
    'live', jsonb_build_object(
      -- Entrées = PERSONNES, une seule définition (_door_headcount) partagée
      -- avec le compteur du videur : les deux écrans ne se contredisent plus.
      'entries', (public._door_headcount(v_event_ids, v_night_start)->>'entered')::int,
      'entries_last10', (public._door_headcount(v_event_ids, now() - interval '10 minutes')->>'entered')::int,
      'gl_scanned', (
        SELECT count(*) FROM public.guest_list_entries gle
         WHERE gle.guest_list_id IN (
           SELECT gl.id FROM public.guest_lists gl WHERE gl.event_id = ANY(v_event_ids)
         ) AND gle.entry_scanned = true
      ),
      'vip_arrived', (
        SELECT count(*) FROM public.table_reservations tr
         WHERE tr.event_id = ANY(v_event_ids) AND tr.status = 'paid'
           AND tr.checked_in_at IS NOT NULL
      ),
      'bar_backlog', (
        SELECT count(*) FROM public.orders o
         WHERE o.venue_id = v_venue AND o.status = 'paid'
           AND COALESCE(o.prep_requested, false)
           AND o.prep_status IN ('queue', 'preparing')
      ),
      'bar_oldest_min', (
        SELECT floor(extract(epoch FROM now() - min(o.created_at)) / 60)::int
          FROM public.orders o
         WHERE o.venue_id = v_venue AND o.status = 'paid'
           AND COALESCE(o.prep_requested, false)
           AND o.prep_status IN ('queue', 'preparing')
      ),
      'bar_ready', (
        SELECT count(*) FROM public.orders o
         WHERE o.venue_id = v_venue AND o.status = 'paid'
           AND o.prep_status = 'ready'
      ),
      'bar_served_tonight', (
        SELECT count(*) FROM public.orders o
         WHERE o.venue_id = v_venue AND o.served_at >= v_night_start
           AND o.status <> 'refunded'
      ),
      'out_of_stock', COALESCE((
        SELECT jsonb_agg(d.name ORDER BY d.name)
          FROM public.drinks d
         WHERE d.venue_id = v_venue AND d.out_of_stock = true
           AND COALESCE(d.active, true)
      ), '[]'::jsonb),
      'cloak_active', (
        SELECT count(*) FROM public.cloakroom_transactions ct
         WHERE ct.venue_id = v_venue AND ct.created_at >= v_night_start
           AND COALESCE(ct.retrieved, false) = false
      ),
      'cloak_retrieved', (
        SELECT count(*) FROM public.cloakroom_transactions ct
         WHERE ct.venue_id = v_venue AND ct.created_at >= v_night_start
           AND ct.retrieved = true
      ),
      'incidents', (
        SELECT count(*) FROM public.night_ops_events ne
         WHERE ne.venue_id = v_venue AND ne.created_at >= v_night_start
           AND ne.kind LIKE 'incident%'
      )
    ),

    -- ── L'équipe de la nuit (prises et fins de poste) ────────────────────────
    'team', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', s.reported_by,
        'name', COALESCE(NULLIF(p.staff_display_name, ''), NULLIF(p.first_name, ''), split_part(p.email, '@', 1)),
        'title', p.staff_title,
        'avatar_url', COALESCE(NULLIF(p.staff_avatar_url, ''), p.avatar_url),
        'role', s.role_note,
        'started_at', s.started_at,
        'ended_at', s.ended_at
      ) ORDER BY s.started_at)
      FROM (
        SELECT ne.reported_by,
               min(ne.created_at) FILTER (WHERE ne.kind = 'shift_start') AS started_at,
               max(ne.created_at) FILTER (WHERE ne.kind = 'shift_end')   AS ended_at,
               (array_agg(ne.note) FILTER (WHERE ne.kind = 'shift_start'))[1] AS role_note
          FROM public.night_ops_events ne
         WHERE ne.venue_id = v_venue AND ne.created_at >= v_night_start
           AND ne.kind IN ('shift_start', 'shift_end')
         GROUP BY ne.reported_by
      ) s
      JOIN public.profiles p ON p.id = s.reported_by
    ), '[]'::jsonb),

    -- ── La consigne du soir + accusés de lecture ─────────────────────────────
    'brief', (
      SELECT jsonb_build_object(
        'id', b.id,
        'body', b.body,
        'updated_at', b.updated_at,
        'read_by_me', EXISTS (
          SELECT 1 FROM public.staff_brief_reads r
           WHERE r.brief_id = b.id AND r.user_id = v_uid
        ),
        'readers', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'user_id', r.user_id,
            'name', COALESCE(NULLIF(rp.staff_display_name, ''), NULLIF(rp.first_name, ''), split_part(rp.email, '@', 1)),
            'read_at', r.read_at
          ) ORDER BY r.read_at)
          FROM public.staff_brief_reads r
          JOIN public.profiles rp ON rp.id = r.user_id
          WHERE r.brief_id = b.id
        ), '[]'::jsonb)
      )
      FROM public.staff_briefs b
      WHERE b.venue_id = v_venue AND b.night_date = v_night
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_staff_night_pulse(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_staff_night_pulse(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_live_view(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now        timestamptz := now();
  v_tz         text := 'Europe/Paris';
  v_day_start  timestamptz;
  v_event_ids  uuid[];
  v_gl_ids     uuid[];
  v_recent_ids uuid[];
  v_home       jsonb := null;
  v_release_id uuid;
  v_release    jsonb := null;
  v_visitors_now integer := 0;
  v_sessions_today integer := 0;
  v_points     jsonb := '[]'::jsonb;
  v_behavior   jsonb;
  v_pages      jsonb := '[]'::jsonb;
  v_locations  jsonb := '[]'::jsonb;
  v_sales      jsonb;
  v_feed       jsonb := '[]'::jsonb;
  v_lat        double precision;
  v_lng        double precision;
  v_home_name  text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      auth.uid() = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(auth.uid(), p_organizer_user_id, 'admin')
      or public.org_member_has_permission(auth.uid(), p_organizer_user_id, 'view_finance')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif p_venue_id is null
     or not (public.can_manage_venue(auth.uid(), p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── Portée : les soirées du club / de l'organisateur ────────────────────
  select coalesce(array_agg(e.id), '{}')
    into v_event_ids
  from public.events e
  where ((p_venue_id is not null and e.venue_id = p_venue_id)
     or (p_organizer_user_id is not null
         and (e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id or e.id in (select public.cohost_event_ids_org(p_organizer_user_id))))) and e.external_source is null;

  -- Soirées « vivantes » (pas finies depuis plus d'un jour) : ce sont celles
  -- que le front écoute en Realtime — une liste courte, jamais tout l'historique.
  select coalesce(array_agg(x.id order by x.start_at), '{}')
    into v_recent_ids
  from (
    select e.id, e.start_at
    from public.events e
    where e.id = any(v_event_ids)
      and e.end_at > v_now - interval '1 day'
    order by e.start_at
    limit 60
  ) x;

  select coalesce(array_agg(gl.id), '{}')
    into v_gl_ids
  from public.guest_lists gl
  where gl.event_id = any(v_recent_ids);

  -- ── Fuseau + point d'ancrage (le club) ────────────────────────────────
  if p_venue_id is not null then
    select coalesce(v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.venues v where v.id = p_venue_id;
  else
    -- Organisateur : le club de sa prochaine soirée (ou de la dernière), s'il y en a un.
    select coalesce(e.timezone, v.timezone, 'Europe/Paris'), v.latitude, v.longitude, v.name
      into v_tz, v_lat, v_lng, v_home_name
    from public.events e
    left join public.venues v on v.id = e.venue_id
    where e.id = any(v_event_ids)
    order by (e.end_at > v_now) desc, abs(extract(epoch from (e.start_at - v_now)))
    limit 1;
    v_tz := coalesce(v_tz, 'Europe/Paris');
  end if;
  if v_lat is not null and v_lng is not null then
    v_home := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'name', v_home_name);
  end if;
  v_day_start := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;

  -- ── Visiteurs en ce moment (battement < 75 s) + leurs points ───────────
  select count(distinct p.session_id)
    into v_visitors_now
  from public.live_visitor_pings p
  where p.last_seen > v_now - interval '75 seconds'
    and (
         (p_venue_id is not null and p.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
      or p.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'session', x.session_id,
           'stage', x.stage,
           'path', x.page_path,
           'seen', x.last_seen,
           'eventTitle', x.event_title,
           'city', x.city,
           'country', x.country,
           'countryCode', x.country_code,
           'lat', x.latitude,
           'lng', x.longitude,
           'device', x.device_type,
           'source', x.referrer_category
         ) order by x.last_seen desc), '[]'::jsonb)
    into v_points
  from (
    select distinct on (p.session_id)
           p.session_id, p.stage, p.page_path, p.last_seen, e.title as event_title,
           vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude, vs.device_type, vs.referrer_category
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    left join lateral (
      select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
      from public.visitor_sessions s
      where s.session_id = p.session_id
      order by s.visited_at desc
      limit 1
    ) vs on true
    where p.last_seen > v_now - interval '75 seconds'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Comportement des 10 dernières minutes (une session = son dernier stade) ──
  select jsonb_build_object(
           'browsing', count(*) filter (where x.stage = 'browsing'),
           'cart',     count(*) filter (where x.stage = 'cart'),
           'checkout', count(*) filter (where x.stage = 'checkout'),
           'paid',     count(*) filter (where x.stage = 'paid')
         )
    into v_behavior
  from (
    select distinct on (p.session_id) p.session_id, p.stage
    from public.live_visitor_pings p
    where p.last_seen > v_now - interval '10 minutes'
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    order by p.session_id, p.last_seen desc
  ) x;

  -- ── Pages regardées en ce moment ───────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', x.page_path, 'n', x.n, 'eventTitle', x.event_title
         ) order by x.n desc, x.page_path), '[]'::jsonb)
    into v_pages
  from (
    select p.page_path, count(distinct p.session_id) as n, max(e.title) as event_title
    from public.live_visitor_pings p
    left join public.events e on e.id = p.event_id
    where p.last_seen > v_now - interval '75 seconds'
      and p.page_path is not null
      and (
           (p_venue_id is not null and p.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and p.organizer_user_id = p_organizer_user_id)
        or p.event_id = any(v_event_ids)
      )
    group by p.page_path
    order by n desc
    limit 6
  ) x;

  -- ── Sessions du jour + villes ─────────────────────────────────────────
  select count(*)
    into v_sessions_today
  from public.visitor_sessions s
  where s.visited_at >= v_day_start
    and (
         (p_venue_id is not null and s.venue_id = p_venue_id)
      or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
      or s.event_id = any(v_event_ids)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
           'city', x.city, 'country', x.country, 'countryCode', x.country_code,
           'n', x.n, 'lat', x.lat, 'lng', x.lng
         ) order by x.n desc), '[]'::jsonb)
    into v_locations
  from (
    select coalesce(s.city, s.region, s.country) as city,
           s.country,
           max(s.country_code) as country_code,
           count(*) as n,
           avg(s.latitude) as lat,
           avg(s.longitude) as lng
    from public.visitor_sessions s
    where s.visited_at >= v_day_start
      and coalesce(s.city, s.region, s.country) is not null
      and (
           (p_venue_id is not null and s.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
        or s.event_id = any(v_event_ids)
      )
    group by coalesce(s.city, s.region, s.country), s.country
    order by n desc
    limit 8
  ) x;

  -- ── Ventes du jour (CA club, formules de fees.ts) ───────────────────────
  select jsonb_build_object(
    'tickets', (
      select jsonb_build_object(
        'orders', count(*),
        'qty', coalesce(sum(t.quantity), 0),
        'amount', coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
      )
      from public.tickets t
      where t.event_id = any(v_event_ids)
        and t.status in ('paid', 'used')
        and coalesce(t.paid_at, t.created_at) >= v_day_start
    ),
    'tables', (
      select jsonb_build_object(
        'orders', count(*),
        'guests', coalesce(sum(coalesce(r.guest_count, 0)), 0),
        'amount', coalesce(sum(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END)), 0)
      )
      from public.table_reservations r
      where r.event_id = any(v_event_ids)
        and r.status in ('paid', 'confirmed')
        and coalesce(r.paid_at, r.created_at) >= v_day_start
    ),
    'guestlist', (
      select jsonb_build_object('orders', count(*))
      from public.guest_list_entries gle
      join public.guest_lists gl on gl.id = gle.guest_list_id
      where gl.event_id = any(v_event_ids)
        and gle.status <> 'cancelled'
        and gle.created_at >= v_day_start
    ),
    'drinks', (
      select jsonb_build_object(
        'orders', count(*),
        'amount', coalesce(sum(o.total - coalesce(o.service_fee, 0)), 0)
      )
      from public.orders o
      where p_venue_id is not null
        and o.venue_id = p_venue_id
        and o.status in ('paid', 'served')
        and coalesce(o.paid_at, o.created_at) >= v_day_start
    )
  ) into v_sales;

  -- ── Flux d'activité : les 40 derniers faits des 24 dernières heures ────
  select coalesce(jsonb_agg(to_jsonb(f) order by f.ts desc), '[]'::jsonb)
    into v_feed
  from (
    select * from (
      (
        select 'visit'::text as kind,
               'visit:' || s.id::text as id,
               s.visited_at as ts,
               s.city, s.country, s.country_code as "countryCode",
               s.latitude as lat, s.longitude as lng,
               s.referrer_category as source,
               s.device_type as device,
               s.entry_page_type as "pageType",
               e.title as "eventTitle",
               null::numeric as amount,
               null::integer as qty,
               coalesce(s.is_returning, false) as returning
        from public.visitor_sessions s
        left join public.events e on e.id = s.event_id
        where s.visited_at > v_now - interval '24 hours'
          and (
               (p_venue_id is not null and s.venue_id = p_venue_id)
            or (p_organizer_user_id is not null and s.organizer_user_id = p_organizer_user_id)
            or s.event_id = any(v_event_ids)
          )
        order by s.visited_at desc
        limit 40
      )
      union all
      (
        select 'ticket', 'ticket:' || t.id::text, coalesce(t.paid_at, t.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(t.purchase_source, vs.referrer_category), vs.device_type, 'ticket',
               e.title,
               t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0),
               t.quantity, false
        from public.tickets t
        join public.events e on e.id = t.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where s.order_id is not null and s.order_id::text = t.id::text
          order by s.visited_at desc limit 1
        ) vs on true
        where t.event_id = any(v_event_ids)
          and t.status in ('paid', 'used')
          and coalesce(t.paid_at, t.created_at) > v_now - interval '24 hours'
        order by coalesce(t.paid_at, t.created_at) desc
        limit 40
      )
      union all
      (
        select 'table', 'table:' || r.id::text, coalesce(r.paid_at, r.created_at),
               vs.city, vs.country, vs.country_code, vs.latitude, vs.longitude,
               coalesce(r.purchase_source, vs.referrer_category), vs.device_type, 'table',
               e.title,
               r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END),
               coalesce(r.guest_count, 0), false
        from public.table_reservations r
        join public.events e on e.id = r.event_id
        left join lateral (
          select s.city, s.country, s.country_code, s.latitude, s.longitude, s.device_type, s.referrer_category
          from public.visitor_sessions s
          where s.order_id is not null and s.order_id::text = r.id::text
          order by s.visited_at desc limit 1
        ) vs on true
        where r.event_id = any(v_event_ids)
          and r.status in ('paid', 'confirmed')
          and coalesce(r.paid_at, r.created_at) > v_now - interval '24 hours'
        order by coalesce(r.paid_at, r.created_at) desc
        limit 40
      )
      union all
      (
        select 'guestlist', 'gl:' || gle.id::text, gle.created_at,
               null::text, null::text, null::text, null::double precision, null::double precision,
               case when gle.promoter_id is not null then 'promoter' else null end, null::text, 'guestlist',
               e.title, null::numeric, 1, false
        from public.guest_list_entries gle
        join public.guest_lists gl on gl.id = gle.guest_list_id
        join public.events e on e.id = gl.event_id
        where gl.event_id = any(v_event_ids)
          and gle.status <> 'cancelled'
          and gle.created_at > v_now - interval '24 hours'
        order by gle.created_at desc
        limit 40
      )
      union all
      (
        select 'order', 'order:' || o.id::text, coalesce(o.paid_at, o.created_at),
               null::text, null::text, null::text, null::double precision, null::double precision,
               o.purchase_source, null::text, 'order',
               e.title,
               o.total - coalesce(o.service_fee, 0),
               coalesce(jsonb_array_length(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end), 0),
               false
        from public.orders o
        left join public.events e on e.id = o.event_id
        where p_venue_id is not null
          and o.venue_id = p_venue_id
          and o.status in ('paid', 'served')
          and coalesce(o.paid_at, o.created_at) > v_now - interval '24 hours'
        order by coalesce(o.paid_at, o.created_at) desc
        limit 40
      )
    ) u
    order by u.ts desc
    limit 40
  ) f;

  -- ── Release en cours : la soirée qui vend le plus depuis une heure ──────
  select t.event_id
    into v_release_id
  from public.tickets t
  join public.events e on e.id = t.event_id
  where t.event_id = any(v_event_ids)
    and t.status in ('paid', 'used')
    and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
  group by t.event_id, e.start_at
  order by sum(t.quantity) desc, e.start_at
  limit 1;

  if v_release_id is null then
    -- Rien ne vend à l'instant : on suit la prochaine soirée qui a une billetterie.
    select e.id into v_release_id
    from public.events e
    where e.id = any(v_event_ids)
      and e.ticketing_enabled
      and e.status = 'active' and e.is_active and e.cancelled_at is null
      and e.end_at > v_now
    order by e.start_at
    limit 1;
  end if;

  if v_release_id is not null then
    select jsonb_build_object(
      'eventId', e.id,
      'title', e.title,
      'startAt', e.start_at,
      'endAt', e.end_at,
      'publishedAt', e.published_at,
      'poster', coalesce(e.poster_url, e.image_url),
      'ticketsSoldOut', e.tickets_sold_out,
      'maxTickets', e.max_tickets,
      'sales10m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '10 minutes'),
      'sales60m', (select coalesce(sum(t.quantity), 0) from public.tickets t
                   where t.event_id = e.id and t.status in ('paid', 'used')
                     and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'salesToday', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) >= v_day_start),
      'salesTotal', (select coalesce(sum(t.quantity), 0) from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')),
      'revenue60m', (select coalesce(sum(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)), 0)
                     from public.tickets t
                     where t.event_id = e.id and t.status in ('paid', 'used')
                       and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'),
      'tables60m', (select count(*) from public.table_reservations r
                    where r.event_id = e.id and r.status in ('paid', 'confirmed')
                      and coalesce(r.paid_at, r.created_at) > v_now - interval '60 minutes'),
      'guests60m', (select count(*) from public.guest_list_entries gle
                    join public.guest_lists gl on gl.id = gle.guest_list_id
                    where gl.event_id = e.id and gle.status <> 'cancelled'
                      and gle.created_at > v_now - interval '60 minutes'),
      'viewersNow', (select count(distinct p.session_id) from public.live_visitor_pings p
                     where p.event_id = e.id and p.last_seen > v_now - interval '75 seconds'),
      -- 60 cases : billets par minute, de la plus ancienne (il y a 59 min) à maintenant.
      'series', (
        select jsonb_agg(coalesce(c.n, 0) order by g.m desc)
        from generate_series(59, 0, -1) as g(m)
        left join (
          select floor(extract(epoch from (v_now - coalesce(t.paid_at, t.created_at))) / 60)::int as m,
                 sum(t.quantity) as n
          from public.tickets t
          where t.event_id = e.id and t.status in ('paid', 'used')
            and coalesce(t.paid_at, t.created_at) > v_now - interval '60 minutes'
          group by 1
        ) c on c.m = g.m
      ),
      'rounds', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', tr.id, 'name', tr.name, 'price', tr.price,
                 'sold', tr.tickets_sold, 'max', tr.max_tickets,
                 'active', tr.is_active, 'soldOut', tr.manually_sold_out or (tr.max_tickets > 0 and tr.tickets_sold >= tr.max_tickets)
               ) order by tr.position, tr.created_at), '[]'::jsonb)
        from public.ticket_rounds tr where tr.event_id = e.id
      )
    )
    into v_release
    from public.events e
    where e.id = v_release_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'now', v_now,
    'tz', v_tz,
    'dayStart', v_day_start,
    'home', v_home,
    'visitorsNow', v_visitors_now,
    'sessionsToday', v_sessions_today,
    'points', v_points,
    'behavior', v_behavior,
    'pages', v_pages,
    'locations', v_locations,
    'sales', v_sales,
    'feed', v_feed,
    'release', v_release,
    'watch', jsonb_build_object(
      'eventIds', to_jsonb(v_recent_ids),
      'guestListIds', to_jsonb(v_gl_ids)
    )
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.get_live_view(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_live_view(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.weekly_digest_email_targets()
 RETURNS TABLE(subject_type text, subject_id text, recipient uuid, recipient_email text, tz text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv)
  SELECT 'venue', v.id, v.owner_id, u.email, coalesce(v.timezone, 'Europe/Paris')
    FROM public.venues v CROSS JOIN d JOIN auth.users u ON u.id = v.owner_id
   WHERE v.owner_id IS NOT NULL AND v.decommissioned_at IS NULL AND NOT (v.id = ANY(d.dv))
     AND NOT public.is_demo_email(u.email)
     AND EXISTS (SELECT 1 FROM public.events e WHERE e.venue_id = v.id AND e.external_source IS NULL AND e.start_at >= now() - interval '60 days')
  UNION ALL
  SELECT 'organizer', o.user_id::text, o.user_id, u.email, 'Europe/Paris'
    FROM public.organizer_profiles o JOIN auth.users u ON u.id = o.user_id
   WHERE NOT public.is_demo_email(u.email)
     AND EXISTS (SELECT 1 FROM public.events e WHERE e.organizer_user_id = o.user_id AND e.external_source IS NULL AND e.start_at >= now() - interval '60 days')
$function$;
REVOKE ALL ON FUNCTION public.weekly_digest_email_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_digest_email_targets() TO service_role;

CREATE OR REPLACE FUNCTION public.weekly_digest_email_data(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope_ids uuid[]; v_tz text := 'Europe/Paris'; v_now timestamptz := now();
  v_cur uuid[]; v_prev uuid[]; v_cur_agg jsonb; v_prev_agg jsonb; v_upcoming jsonb; v_at_risk int; v_pillars int; v_name text;
BEGIN
  IF p_venue_id IS NOT NULL THEN
    SELECT coalesce(v.timezone, 'Europe/Paris'), v.name INTO v_tz, v_name FROM public.venues v WHERE v.id = p_venue_id;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE (x.venue_id = p_venue_id OR x.partner_venue_id = p_venue_id) AND x.external_source IS NULL;
  ELSE
    SELECT o.display_name INTO v_name FROM public.organizer_profiles o WHERE o.user_id = p_organizer_user_id;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE (x.organizer_user_id = p_organizer_user_id OR x.partner_organizer_id = p_organizer_user_id) AND x.external_source IS NULL;
  END IF;

  v_cur := public._an3_subject_ids(v_scope_ids, v_tz, NULL, v_now - interval '7 days', v_now);
  v_prev := public._an3_subject_ids(v_scope_ids, v_tz, NULL, v_now - interval '14 days', v_now - interval '7 days');
  -- Seules les soirées terminées comptent dans un bilan.
  SELECT coalesce(array_agg(e.id), '{}') INTO v_cur FROM public.events e WHERE e.id = ANY(v_cur) AND coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now;
  SELECT coalesce(array_agg(e.id), '{}') INTO v_prev FROM public.events e WHERE e.id = ANY(v_prev) AND coalesce(e.end_at, e.start_at + interval '8 hours') <= v_now;

  v_cur_agg := public._an3_aggregate(v_cur, p_venue_id, true, v_scope_ids);
  v_prev_agg := CASE WHEN cardinality(v_prev) > 0 THEN public._an3_aggregate(v_prev, p_venue_id, true, v_scope_ids) END;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.event_id, 'title', n.title, 'start_at', n.start_at, 'tickets', n.tickets, 'cap', n.cap, 'gl', n.gl_registered, 'tables', n.tables) ORDER BY n.start_at), '[]'::jsonb)
    INTO v_upcoming
    FROM public._an3_nights((SELECT coalesce(array_agg(e.id), '{}') FROM public.events e WHERE e.id = ANY(v_scope_ids) AND e.start_at BETWEEN v_now AND v_now + interval '7 days' AND e.cancelled_at IS NULL), p_venue_id, true) n;

  -- Le segment actionnable : les habitués qui décrochent (mêmes règles RFM que la page Clients).
  IF p_venue_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE r.rfm_segment = 'at_risk'), count(*) FILTER (WHERE r.rfm_segment IN ('champions', 'loyal'))
      INTO v_at_risk, v_pillars FROM public._venue_customer_rfm(p_venue_id) r;
  ELSE
    SELECT count(*) FILTER (WHERE r.rfm_segment = 'at_risk'), count(*) FILTER (WHERE r.rfm_segment IN ('champions', 'loyal'))
      INTO v_at_risk, v_pillars FROM public.get_organizer_customer_segments(p_organizer_user_id) r;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'name', v_name, 'tz', v_tz, 'venue_id', p_venue_id, 'organizer_user_id', p_organizer_user_id,
    'nights', (v_cur_agg ->> 'nights')::int, 'revenue', (v_cur_agg ->> 'revenue')::numeric, 'tickets', (v_cur_agg ->> 'tickets')::int,
    'entries', (v_cur_agg ->> 'entries')::int, 'expected', (v_cur_agg ->> 'expected')::int, 'customers', (v_cur_agg ->> 'customers')::int,
    'new_customers', (v_cur_agg ->> 'new_customers')::int,
    'prev', CASE WHEN v_prev_agg IS NULL THEN NULL ELSE jsonb_build_object('nights', (v_prev_agg ->> 'nights')::int, 'revenue', (v_prev_agg ->> 'revenue')::numeric, 'tickets', (v_prev_agg ->> 'tickets')::int, 'entries', (v_prev_agg ->> 'entries')::int) END,
    'upcoming', v_upcoming, 'at_risk', coalesce(v_at_risk, 0), 'pillars', coalesce(v_pillars, 0));
END;
$function$;
REVOKE ALL ON FUNCTION public.weekly_digest_email_data(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_digest_email_data(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.night_recap_data(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e          record;
  v_entered  integer;
  v_expected integer;
  v_revenue  numeric;
  v_prev     record;
  v_prev_entered integer := 0;
  v_prev_title   text;
  v_owner    uuid;
begin
  select ev.*, v.owner_id as venue_owner
    into e
  from public.events ev
  left join public.venues v on v.id = ev.venue_id
  where ev.id = p_event_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_owner := coalesce(e.venue_owner, e.organizer_user_id);
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_recipient');
  end if;

  -- La porte (même définition que get_event_report.totals.door).
  v_entered :=
      (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
        where t.event_id = p_event_id and t.status in ('paid', 'used')
          and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
    + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
        where r.event_id = p_event_id and r.status in ('paid', 'confirmed')
          and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
    + (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
        where l.event_id = p_event_id and g.status <> 'cancelled' and coalesce(g.entry_scanned, false));
  v_expected :=
      (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
        where t.event_id = p_event_id and t.status in ('paid', 'used'))
    + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
        where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
    + (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
        where l.event_id = p_event_id and g.status <> 'cancelled');

  -- CA club (fees.ts) : total − frais Yuno, remboursement déduit, avant Stripe.
  -- Le bar ne compte que pour le club qui porte la soirée.
  v_revenue :=
      (select coalesce(sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
              - least(greatest(coalesce(t.refund_amount, 0), 0),
                      greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0))), 0)
         from public.tickets t where t.event_id = p_event_id and t.status in ('paid', 'used'))
    + (select coalesce(sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
              - least(greatest(coalesce(r.refund_amount, 0), 0),
                      greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0))), 0)
         from public.table_reservations r where r.event_id = p_event_id and r.status in ('paid', 'confirmed'))
    + (select coalesce(sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
              - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))), 0)
         from public.orders o
        where o.event_id = p_event_id and o.status in ('paid', 'served')
          and e.venue_id is not null and o.venue_id = e.venue_id);

  -- La soirée précédente de la même portée qui a vu du monde à la porte.
  for v_prev in
    select x.id, x.title
    from public.events x
    where x.id <> p_event_id and x.cancelled_at is null and x.start_at < e.start_at and x.external_source is null and ((e.venue_id is not null and x.venue_id = e.venue_id)
        or (e.venue_id is null and x.organizer_user_id = e.organizer_user_id))
    order by x.start_at desc
    limit 5
  loop
    v_prev_entered :=
        (select coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) from public.tickets t
          where t.event_id = v_prev.id and t.status in ('paid', 'used')
            and (coalesce(t.entry_scanned, false) or coalesce(t.used, false) or t.status = 'used'))
      + (select coalesce(sum(greatest(coalesce(r.guest_count, 0), 1)), 0) from public.table_reservations r
          where r.event_id = v_prev.id and r.status in ('paid', 'confirmed')
            and (coalesce(r.entry_scanned, false) or r.checked_in_at is not null))
      + (select count(*) from public.guest_list_entries g join public.guest_lists l on l.id = g.guest_list_id
          where l.event_id = v_prev.id and g.status <> 'cancelled' and coalesce(g.entry_scanned, false));
    if v_prev_entered > 0 then
      v_prev_title := v_prev.title;
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'event_id', e.id,
    'title', e.title,
    'venue_id', e.venue_id,
    'organizer_user_id', case when e.venue_id is null then e.organizer_user_id end,
    'recipient', v_owner,
    'entered', v_entered,
    'expected', v_expected,
    'target', e.entry_target,
    'revenue', round(v_revenue, 2),
    'spend', case when v_entered > 0 and v_revenue > 0 then round(v_revenue / v_entered, 2) end,
    'prev_title', v_prev_title,
    'prev_entered', case when v_prev_title is not null then v_prev_entered end,
    -- La démo ne reçoit jamais de push réel (la cloche, oui).
    'demo', e.id = any (public.demo_event_ids())
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.night_recap_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.night_recap_data(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.night_recap_due()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id
  FROM public.events e
  WHERE extract(hour FROM now() AT TIME ZONE 'Europe/Paris') BETWEEN 11 AND 19
    AND e.end_at BETWEEN now() - interval '30 hours' AND now() - interval '3 hours'
       AND e.external_source IS NULL
    AND e.cancelled_at IS NULL
    AND coalesce(e.status, 'active') = 'active'
    AND (e.venue_id IS NOT NULL OR e.organizer_user_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.night_recap_log l WHERE l.event_id = e.id)
  ORDER BY e.end_at
  LIMIT 200;
$function$;
REVOKE ALL ON FUNCTION public.night_recap_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.night_recap_due() TO service_role;

CREATE OR REPLACE FUNCTION public.night_recap_email_data(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ev record; v_scope_ids uuid[]; v_venue text; v_org uuid; v_recipient uuid; v_email text;
  n record; v_ref record; v_ref_id uuid; v_new int; v_customers int; v_promo jsonb; v_demo boolean;
BEGIN
  SELECT e.id, e.title, e.start_at, e.venue_id, e.organizer_user_id, coalesce(nullif(e.timezone, ''), v.timezone, 'Europe/Paris') AS tz
    INTO v_ev FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id WHERE e.id = p_event_id;
  IF v_ev.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  v_demo := p_event_id = ANY(public.demo_event_ids());
  IF v_ev.venue_id IS NOT NULL THEN
    v_venue := v_ev.venue_id;
    SELECT v.owner_id INTO v_recipient FROM public.venues v WHERE v.id = v_venue;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE (x.venue_id = v_venue OR x.partner_venue_id = v_venue) AND x.external_source IS NULL;
  ELSE
    v_org := v_ev.organizer_user_id; v_recipient := v_org;
    SELECT coalesce(array_agg(x.id), '{}') INTO v_scope_ids FROM public.events x WHERE (x.organizer_user_id = v_org OR x.partner_organizer_id = v_org) AND x.external_source IS NULL;
  END IF;
  IF v_recipient IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_recipient'); END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_recipient;

  SELECT * INTO n FROM public._an3_nights(ARRAY[p_event_id], v_venue, true);

  SELECT c.event_id INTO v_ref_id FROM public._an3_comparables(p_event_id, v_scope_ids, 1) c LIMIT 1;
  IF v_ref_id IS NOT NULL THEN SELECT * INTO v_ref FROM public._an3_nights(ARRAY[v_ref_id], v_venue, true); END IF;

  SELECT count(DISTINCT p.email), count(DISTINCT p.email) FILTER (WHERE p.first_event = p_event_id)
    INTO v_customers, v_new FROM public._an3_people(v_scope_ids, v_venue) p WHERE p.event_id = p_event_id;

  SELECT jsonb_build_object('name', trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), 'orders', x.orders, 'amount', x.amount)
    INTO v_promo
    FROM (SELECT pc.promoter_id, count(*) AS orders, round(sum(coalesce(pc.amount, 0)), 2) AS amount
            FROM public.promoter_conversions pc WHERE pc.event_id = p_event_id AND pc.status IS DISTINCT FROM 'cancelled'
           GROUP BY pc.promoter_id ORDER BY 3 DESC, 2 DESC LIMIT 1) x
    JOIN public.promoters pr ON pr.id = x.promoter_id;

  RETURN jsonb_build_object(
    'ok', true, 'demo', v_demo, 'event_id', p_event_id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'tz', v_ev.tz,
    'venue_id', v_venue, 'organizer_user_id', v_org, 'recipient', v_recipient, 'recipient_email', v_email,
    'entered', n.entries, 'expected', n.expected, 'tickets', n.tickets, 'tables', n.tables, 'gl', n.gl_registered,
    'revenue', round(n.revenue, 2), 'rev_tickets', round(n.rev_tickets, 2), 'rev_tables', round(n.rev_tables, 2), 'rev_bar', round(n.rev_bar, 2),
    'per_head', CASE WHEN n.entries > 0 THEN round(n.revenue / n.entries, 2) END,
    'no_show_pct', CASE WHEN n.expected > 0 AND n.entries > 0 THEN round(100.0 * (n.expected - n.entries) / n.expected) END,
    'customers', v_customers, 'new_customers', v_new,
    'promoter', v_promo,
    'ref', CASE WHEN v_ref_id IS NULL THEN NULL ELSE jsonb_build_object('title', v_ref.title, 'start_at', v_ref.start_at, 'entered', v_ref.entries, 'revenue', round(v_ref.revenue, 2), 'tickets', v_ref.tickets) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.night_recap_email_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.night_recap_email_data(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.event_analytics_scope(p_event_id uuid)
 RETURNS TABLE(ok boolean, reason text, scope_venue text, scope_org uuid, money boolean, scope_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  e       record;
  v_venue text := null;
  v_org   uuid := null;
  v_money boolean := false;
  v_ids   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;
  SELECT ev.* INTO e FROM public.events ev WHERE ev.id = p_event_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;

  IF e.venue_id IS NOT NULL AND (public.can_manage_venue(v_uid, e.venue_id) OR public.is_super_admin()) THEN
    v_venue := e.venue_id;
  ELSIF e.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, e.partner_venue_id) THEN
    v_venue := e.partner_venue_id;
  ELSIF e.organizer_user_id IS NOT NULL AND (
          v_uid = e.organizer_user_id
          OR public.is_super_admin()
          OR public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) THEN
    v_org := e.organizer_user_id;
  ELSIF e.partner_organizer_id IS NOT NULL AND (
          v_uid = e.partner_organizer_id
          OR public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) THEN
    v_org := e.partner_organizer_id;
  ELSIF EXISTS (SELECT 1 FROM public.event_cohosts c
                 WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.organizer_user_id IS NOT NULL
                   AND (c.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) THEN
    SELECT c.organizer_user_id INTO v_org FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.organizer_user_id IS NOT NULL
       AND (c.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     ORDER BY (c.organizer_user_id = v_uid) DESC LIMIT 1;
  ELSIF EXISTS (SELECT 1 FROM public.event_cohosts c
                 WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.venue_id IS NOT NULL
                   AND public.can_manage_venue(v_uid, c.venue_id)) THEN
    SELECT c.venue_id INTO v_venue FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.venue_id IS NOT NULL
       AND public.can_manage_venue(v_uid, c.venue_id)
     LIMIT 1;
  ELSE
    RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;

  IF v_venue IS NOT NULL THEN
    v_money := (coalesce(v_venue = e.venue_id, false)
                OR public.coorg_cohost_sees_money(p_event_id, 'venue:' || v_venue)) AND (
      public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_venue AND v.owner_id = v_uid)
      OR EXISTS (
        SELECT 1 FROM public.manager_permissions mp
         WHERE mp.user_id = v_uid AND mp.venue_id = v_venue
           AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false))
      ));
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids
      FROM public.events x
     WHERE (x.venue_id = v_venue OR x.partner_venue_id = v_venue OR x.id IN (SELECT public.cohost_event_ids_venue(v_venue))) AND x.external_source IS NULL;
  ELSE
    v_money := (v_uid = v_org
      OR public.is_super_admin()
      OR public.org_member_has_permission(v_uid, v_org, 'view_finance'))
      AND (public.is_super_admin() OR public.coorg_sees_event_money(p_event_id, 'org:' || v_org::text));
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids
      FROM public.events x
     WHERE (x.organizer_user_id = v_org OR x.partner_organizer_id = v_org OR x.id IN (SELECT public.cohost_event_ids_org(v_org))) AND x.external_source IS NULL;
  END IF;

  RETURN QUERY SELECT true, null::text, v_venue, v_org, v_money, v_ids;
END;
$function$;
REVOKE ALL ON FUNCTION public.event_analytics_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_analytics_scope(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_analytics_benchmarks(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record; v_n int; v_res jsonb;
BEGIN
  SELECT * INTO g FROM public.analytics_scope_gate(p_venue_id, p_organizer_user_id);
  IF NOT g.ok THEN RETURN jsonb_build_object('ok', false, 'reason', g.reason); END IF;

  -- Un club contribue s'il a ≥ 3 soirées terminées avec ≥ 20 billets sur 90 jours (démo exclue).
  WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv),
  nights AS (
    SELECT e.venue_id, n.*
      FROM public.events e CROSS JOIN d
      JOIN LATERAL public._an3_nights(ARRAY[e.id], e.venue_id, true) n ON true
     WHERE e.venue_id IS NOT NULL AND e.external_source IS NULL AND NOT (e.venue_id = ANY(d.dv))
       AND e.start_at >= now() - interval '90 days' AND coalesce(e.end_at, e.start_at + interval '8 hours') <= now()
       AND e.cancelled_at IS NULL
  ),
  per_venue AS (
    SELECT venue_id,
           count(*) FILTER (WHERE tickets >= 20) AS nights_ok,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN expected > 0 AND entries > 0 THEN 100.0 * entries / expected END) AS attendance,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN cap > 0 THEN 100.0 * tickets / cap END) AS fill,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN entries > 0 THEN revenue / entries END) AS per_head
      FROM nights GROUP BY venue_id
  ),
  contributors AS (SELECT * FROM per_venue WHERE nights_ok >= 3)
  SELECT count(*), jsonb_build_object(
      'attendance', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY attendance)::numeric, 1),
      'fill', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY fill)::numeric, 1),
      'per_head', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY per_head)::numeric, 2))
    INTO v_n, v_res FROM contributors;

  RETURN jsonb_build_object('ok', true, 'contributors', v_n, 'ready', v_n >= 5, 'medians', CASE WHEN v_n >= 5 THEN v_res END);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_analytics_benchmarks(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_benchmarks(text, uuid) TO authenticated, service_role;
