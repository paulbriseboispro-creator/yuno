-- =============================================================================
-- Plan Shotgun, lot G — goûts du réseau + accusés de réception push
-- =============================================================================
--
-- 1. Communauté › Goûts — « Qu'est-ce qu'ils écoutent ? »
--    `get_community_tastes(p_venue_id, p_organizer_user_id)` : les genres de
--    la communauté d'un club ou d'un organisateur (personnes AVEC compte Yuno
--    venues à une soirée de la portée — billet payé, table payée/confirmée,
--    guest list non annulée — ou abonnées à sa page). Deux sources par
--    personne, réunies :
--      • DÉCLARÉ : les genres du quiz de goûts (`user_taste_profiles.genres`) ;
--      • DU RÉSEAU : les genres des soirées où la personne est allée sur TOUT
--        Yuno depuis 18 mois (pas seulement chez l'appelant).
--    Garde-fous (décision du 24/09 + mention dans la politique de
--    confidentialité) : aucune ligne par personne, un genre ne sort que s'il
--    réunit AU MOINS 10 personnes (et ses deux sous-comptes aussi, sinon ils
--    restent vides), et toute personne qui a coupé les recommandations
--    personnalisées (`profiles.personalization_opt_out`) est exclue du calcul.
--    Sous le seuil, l'écran dit « pas encore assez de monde » : la vue est
--    PRÊTE mais ne s'allume qu'au-dessus du seuil.
--
-- 2. Accusés de réception push (partie serveur)
--    Apple ne dit pas si une notification est AFFICHÉE ; seul le code de
--    l'app peut le dire, dans une Notification Service Extension (NSE) — une
--    cible native qui n'arrive qu'avec une nouvelle version App Store.
--    Tout ce qui est côté serveur est posé ici pour qu'elle n'ait qu'à appeler
--    une RPC :
--      • `push_campaign_events.event_type` accepte `delivered` ;
--      • `ack_push_delivery(p_campaign_id, p_subscription_id)` (anon, SECURITY
--        DEFINER) : l'extension renvoie les deux identifiants que
--        `send-push-notification` place dans le payload (`yr: {c, s}`, avec
--        `mutable-content: 1`). L'id d'abonnement est un uuid que seul
--        l'appareil reçoit : impossible de gonfler un compteur sans lui.
--        Une campagne de plus de 3 jours n'accepte plus d'accusé ;
--      • `get_push_delivery_counts(p_campaign_ids)` : « reçus » par campagne,
--        avec la même porte que `get_push_campaigns`.
--    Tant que l'extension n'est pas dans le binaire, aucun accusé n'arrive et
--    l'écran n'affiche pas la colonne (elle ne s'allume qu'avec un premier
--    reçu) : rien ne ment.
-- =============================================================================

-- ── 1. Goûts de la communauté ───────────────────────────────────────────────

create or replace function public.get_community_tastes(
  p_venue_id text default null,
  p_organizer_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_venue     text;
  v_org       uuid;
  v_threshold integer := 10;
  v_result    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    if not (
      v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.is_org_team_member(v_uid, p_organizer_user_id, 'editor')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_org := p_organizer_user_id;
  elsif p_venue_id is null
     or not (public.can_manage_venue(v_uid, p_venue_id) or public.is_super_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  else
    v_venue := p_venue_id;
  end if;

  with
  ev as materialized (
    select e.id
    from public.events e
    where ((v_venue is not null and (e.venue_id = v_venue or e.partner_venue_id = v_venue))
        or (v_org is not null and (e.organizer_user_id = v_org or e.partner_organizer_id = v_org)))
  ),
  people as materialized (
    select distinct x.user_id
    from (
      select t.user_id from public.tickets t join ev on ev.id = t.event_id
      where t.user_id is not null and t.status in ('paid', 'used')
      union all
      select r.user_id from public.table_reservations r join ev on ev.id = r.event_id
      where r.user_id is not null and r.status in ('paid', 'confirmed')
      union all
      select g.user_id from public.guest_list_entries g
      join public.guest_lists gl on gl.id = g.guest_list_id
      join ev on ev.id = gl.event_id
      where g.user_id is not null and g.status <> 'cancelled'
      union all
      select fv.user_id from public.favorites fv
      where v_venue is not null and fv.favorite_type = 'club' and fv.venue_id = v_venue
      union all
      select opf.user_id from public.organizer_profile_followers opf
      where v_org is not null and opf.organizer_user_id = v_org
    ) x
    join public.profiles p on p.id = x.user_id
    where not coalesce(p.personalization_opt_out, false)
  ),
  declared as (
    select distinct utp.user_id, g.genre
    from public.user_taste_profiles utp
    join people pp on pp.user_id = utp.user_id
    cross join lateral unnest(public.canonical_music_genres(coalesce(utp.genres, '{}'::text[]))) as g(genre)
  ),
  -- Où la personne est allée sur TOUT Yuno (le « réseau ») depuis 18 mois.
  went as materialized (
    select distinct y.user_id, y.event_id
    from (
      select t.user_id, t.event_id from public.tickets t
      join people pp on pp.user_id = t.user_id
      where t.status in ('paid', 'used') and coalesce(t.paid_at, t.created_at) > now() - interval '18 months'
      union all
      select r.user_id, r.event_id from public.table_reservations r
      join people pp on pp.user_id = r.user_id
      where r.status in ('paid', 'confirmed') and coalesce(r.paid_at, r.created_at) > now() - interval '18 months'
      union all
      select g.user_id, gl.event_id from public.guest_list_entries g
      join public.guest_lists gl on gl.id = g.guest_list_id
      join people pp on pp.user_id = g.user_id
      where g.status <> 'cancelled' and g.created_at > now() - interval '18 months'
    ) y
  ),
  attended as (
    select distinct w.user_id, g.genre
    from went w
    join public.events e on e.id = w.event_id and e.cancelled_at is null
    cross join lateral unnest(public.canonical_music_genres(coalesce(e.music_genres, '{}'::text[]))) as g(genre)
  ),
  person_genre as (
    select z.user_id, z.genre, bool_or(z.src = 'd') as is_declared, bool_or(z.src = 'a') as is_attended
    from (
      select d.user_id, d.genre, 'd'::text as src from declared d
      union all
      select a.user_id, a.genre, 'a'::text from attended a
    ) z
    where z.genre is not null and btrim(z.genre) <> ''
    group by 1, 2
  ),
  per_genre as (
    select pg.genre,
           count(*) as n,
           count(*) filter (where pg.is_declared) as n_declared,
           count(*) filter (where pg.is_attended) as n_attended
    from person_genre pg
    group by pg.genre
  )
  select jsonb_build_object(
    'ok', true,
    'threshold', v_threshold,
    'people', (select count(*) from people),
    'known', (select count(distinct pg.user_id) from person_genre pg),
    'declaredKnown', (select count(distinct d.user_id) from declared d),
    'genres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'genre', g.genre,
               'n', g.n,
               'declared', case when g.n_declared >= v_threshold then g.n_declared end,
               'attended', case when g.n_attended >= v_threshold then g.n_attended end
             ) order by g.n desc, g.genre)
      from per_genre g
      where g.n >= v_threshold
    ), '[]'::jsonb),
    'hidden', (select count(*) from per_genre g where g.n < v_threshold)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_community_tastes(text, uuid) from public, anon;
grant execute on function public.get_community_tastes(text, uuid) to authenticated;

comment on function public.get_community_tastes(text, uuid) is
  'Genres musicaux de la communauté d''un club ou d''un organisateur : quiz de goûts ∪ genres des soirées fréquentées sur tout Yuno (18 mois). Agrégé, au moins 10 personnes par ligne, opt-out personnalisation exclu.';

-- ── 2. Accusés de réception push ────────────────────────────────────────────

alter table public.push_campaign_events
  drop constraint if exists push_campaign_events_event_type_check;
alter table public.push_campaign_events
  add constraint push_campaign_events_event_type_check
  check (event_type in ('sent', 'failed', 'clicked', 'delivered'));

create or replace function public.ack_push_delivery(
  p_campaign_id uuid,
  p_subscription_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user     uuid;
  v_platform text;
begin
  if p_campaign_id is null or p_subscription_id is null then
    return false;
  end if;

  select ps.user_id, ps.platform into v_user, v_platform
  from public.push_subscriptions ps
  where ps.id = p_subscription_id;
  if v_user is null then
    return false;
  end if;

  -- Seulement une campagne récente, déjà partie vers cette personne.
  if not exists (
    select 1 from public.push_campaigns pc
    where pc.id = p_campaign_id
      and pc.created_at > now() - interval '3 days'
      and coalesce(pc.status, '') <> 'scheduled'
  ) then
    return false;
  end if;

  insert into public.push_campaign_events (campaign_id, user_id, event_type, platform)
  values (p_campaign_id, v_user, 'delivered', v_platform)
  on conflict (campaign_id, user_id, event_type) do nothing;

  return true;
exception when others then
  -- Un accusé perdu n'est jamais une erreur pour l'appareil.
  return false;
end;
$$;

revoke all on function public.ack_push_delivery(uuid, uuid) from public;
grant execute on function public.ack_push_delivery(uuid, uuid) to anon, authenticated;

comment on function public.ack_push_delivery(uuid, uuid) is
  'Accusé de réception d''une notification de campagne, appelé par la Notification Service Extension iOS avec les identifiants du payload (yr.c, yr.s). Idempotent, campagnes < 3 jours.';

create or replace function public.get_push_delivery_counts(p_campaign_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return '{}'::jsonb;
  end if;

  return coalesce((
    select jsonb_object_agg(pc.id::text, (
             select count(*) from public.push_campaign_events pce
             where pce.campaign_id = pc.id and pce.event_type = 'delivered'))
    from public.push_campaigns pc
    where pc.id = any(coalesce(p_campaign_ids, '{}'::uuid[]))
      and (
        public.is_super_admin()
        or (pc.venue_id is not null and (
              public.is_venue_owner(v_uid, pc.venue_id)
              or exists (
                select 1 from public.manager_permissions mp
                where mp.user_id = v_uid and mp.venue_id = pc.venue_id
                  and (coalesce(mp.can_manage_crm, false) or coalesce(mp.can_view_analytics, false))
              )))
        or (pc.organizer_user_id is not null and (
              v_uid = pc.organizer_user_id
              or public.is_org_team_member(v_uid, pc.organizer_user_id, 'admin')))
      )
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.get_push_delivery_counts(uuid[]) from public, anon;
grant execute on function public.get_push_delivery_counts(uuid[]) to authenticated;

comment on function public.get_push_delivery_counts(uuid[]) is
  'Nombre d''accusés de réception (« reçus ») par campagne push, même porte que get_push_campaigns. Vide tant que l''extension iOS n''est pas livrée.';
