-- =============================================================================
-- Push de la Console — historique complet, club ET organisateur (plan Shotgun, lot D)
-- =============================================================================
-- Chez Shotgun, l'organisateur voit chaque push parti vers ses abonnés
-- (« Publication – soirée ») avec reçues / vues / revenu. Chez Yuno :
--   - le push « nouvelle soirée » partait déjà vers les abonnés d'un
--     organisateur, mais la ligne `push_campaigns` n'avait AUCUNE colonne qui
--     la rattache à lui (venue_id NULL) : invisible, sans chiffres ;
--   - l'organisateur ne pouvait ni envoyer ni annuler un push ;
--   - le club ne voyait que les 20 derniers, sans « ciblés », sans acheteurs.
--
-- Cette migration :
--   1. ajoute `push_campaigns.organizer_user_id` (portée organisateur) et y
--      range les « nouvelle soirée » déjà parties vers ses abonnés ;
--   2. ouvre `cancel_scheduled_push_campaign` à l'organisateur ;
--   3. pose UNE RPC, `get_push_campaigns`, qui sert l'historique complet
--      paginé des deux portées : ciblés, envoyés, ouverts (tap sur la
--      notification, seul signal mesurable), taux, acheteurs, inscrits et CA
--      attribué (1er tap → achat d'une soirée de la portée < 72 h, CA club de
--      fees.ts), plus le résumé 30 jours et les abonnés (total, joignables,
--      nouveaux) pour le bandeau « plus d'abonnés, plus de monde touché ».
--
-- « Envoyés » = accepté par Apple (APNs), pas « reçu sur le téléphone » :
-- un vrai accusé de réception demande une Notification Service Extension
-- native (lot G). On ne l'appelle donc jamais « reçues ».
-- =============================================================================

alter table public.push_campaigns
  add column if not exists organizer_user_id uuid;

create index if not exists idx_push_campaigns_organizer
  on public.push_campaigns (organizer_user_id, created_at desc)
  where organizer_user_id is not null;

-- Les annonces automatiques déjà parties pour une soirée d'organisateur sans
-- club : elles sont à lui.
update public.push_campaigns pc
   set organizer_user_id = e.organizer_user_id
  from public.events e
 where pc.event_id = e.id
   and pc.venue_id is null
   and pc.agency_id is null
   and pc.organizer_user_id is null
   and e.organizer_user_id is not null;

-- ── Annulation d'un push programmé : club OU organisateur ─────────────────
create or replace function public.cancel_scheduled_push_campaign(p_campaign_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_venue_id text;
  v_org_id   uuid;
begin
  select pc.venue_id, pc.organizer_user_id into v_venue_id, v_org_id
  from push_campaigns pc
  where pc.id = p_campaign_id and pc.status = 'scheduled';

  if v_venue_id is null and v_org_id is null then
    return false; -- introuvable, déjà partie, ou campagne admin / agence
  end if;

  if v_venue_id is not null then
    if not (is_super_admin()
            or is_venue_owner(auth.uid(), v_venue_id)
            or exists (
              select 1 from manager_permissions mp
              where mp.user_id = auth.uid() and mp.venue_id = v_venue_id and mp.can_manage_crm = true
            )) then
      raise exception 'Not authorized for venue %', v_venue_id using errcode = '42501';
    end if;
  else
    if not (is_super_admin()
            or auth.uid() = v_org_id
            or is_org_team_member(auth.uid(), v_org_id, 'admin')) then
      raise exception 'Not authorized for organizer %', v_org_id using errcode = '42501';
    end if;
  end if;

  delete from push_campaigns pc
  where pc.id = p_campaign_id and pc.status = 'scheduled';

  return found;
end;
$$;

grant execute on function public.cancel_scheduled_push_campaign(uuid) to authenticated;
revoke all on function public.cancel_scheduled_push_campaign(uuid) from anon;

-- ── Historique + chiffres ──────────────────────────────────────────────────
drop function if exists public.get_push_campaigns(text, uuid, text, uuid, integer, integer);

create or replace function public.get_push_campaigns(
  p_venue_id text default null,
  p_organizer_user_id uuid default null,
  p_filter text default 'all',        -- all | manual | auto | scheduled
  p_event_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_money     boolean := false;
  v_event_ids uuid[];
  v_limit     integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset    integer := greatest(coalesce(p_offset, 0), 0);
  v_result    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_organizer_user_id is not null then
    -- Marketing d'une organisation : fondateur ou admin d'équipe (capacité
    -- `marketing` de capabilitiesFor), comme l'envoi.
    if not (v_uid = p_organizer_user_id
            or public.is_super_admin()
            or public.is_org_team_member(v_uid, p_organizer_user_id, 'admin')) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := v_uid = p_organizer_user_id
      or public.is_super_admin()
      or public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    select coalesce(array_agg(e.id), '{}') into v_event_ids
    from public.events e
    where e.organizer_user_id = p_organizer_user_id or e.partner_organizer_id = p_organizer_user_id;
  elsif p_venue_id is not null then
    if not (public.is_super_admin()
            or public.is_venue_owner(v_uid, p_venue_id)
            or exists (
              select 1 from public.manager_permissions mp
              where mp.user_id = v_uid and mp.venue_id = p_venue_id
                and (coalesce(mp.can_manage_crm, false) or coalesce(mp.can_view_analytics, false))
            )) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_money := public.is_super_admin()
      or exists (select 1 from public.venues v where v.id = p_venue_id and v.owner_id = v_uid)
      or exists (
        select 1 from public.manager_permissions mp
        where mp.user_id = v_uid and mp.venue_id = p_venue_id
          and (coalesce(mp.can_view_analytics, false) or coalesce(mp.can_view_finance, false))
      );
    select coalesce(array_agg(e.id), '{}') into v_event_ids
    from public.events e
    where e.venue_id = p_venue_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with
  scoped as materialized (
    select pc.*
    from public.push_campaigns pc
    where ((p_venue_id is not null and pc.venue_id = p_venue_id)
        or (p_organizer_user_id is not null and pc.organizer_user_id = p_organizer_user_id))
  ),
  filtered as (
    select s.* from scoped s
    where (p_event_id is null or s.event_id = p_event_id)
      and case coalesce(p_filter, 'all')
            when 'manual' then coalesce(s.source, 'manual') <> 'auto'
            when 'auto' then s.source = 'auto'
            when 'scheduled' then s.status = 'scheduled'
            else true end
  ),
  page as materialized (
    select f.* from filtered f
    order by coalesce(f.scheduled_at, f.created_at) desc, f.created_at desc
    limit v_limit offset v_offset
  ),
  -- Ventes de la portée, une ligne par transaction, attribuables par user_id.
  sales as materialized (
    select 'tickets'::text as pillar, t.id, t.user_id,
           coalesce(t.paid_at, t.created_at) as at_ts,
           greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
             - least(greatest(coalesce(t.refund_amount, 0), 0),
                     greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)) as amount
    from public.tickets t
    where t.event_id = any(v_event_ids) and t.status in ('paid', 'used') and t.user_id is not null
      and coalesce(t.paid_at, t.created_at) > now() - interval '400 days'
    union all
    select 'tables', r.id, r.user_id, coalesce(r.paid_at, r.created_at),
           greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
             - least(greatest(coalesce(r.refund_amount, 0), 0),
                     greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))
    from public.table_reservations r
    where r.event_id = any(v_event_ids) and r.status in ('paid', 'confirmed') and r.user_id is not null
      and coalesce(r.paid_at, r.created_at) > now() - interval '400 days'
    union all
    select 'drinks', o.id, o.user_id, coalesce(o.paid_at, o.created_at),
           greatest(o.total - coalesce(o.service_fee, 0), 0)
             - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
    from public.orders o
    where p_venue_id is not null and o.venue_id = p_venue_id
      and o.status in ('paid', 'served') and o.user_id is not null
      and coalesce(o.paid_at, o.created_at) > now() - interval '400 days'
    union all
    select 'guestlist', g.id, g.user_id, g.created_at, 0
    from public.guest_list_entries g
    join public.guest_lists gl on gl.id = g.guest_list_id
    where gl.event_id = any(v_event_ids) and g.status <> 'cancelled' and g.user_id is not null
      and g.created_at > now() - interval '400 days'
  ),
  -- Premier tap par (campagne, personne) : sur la page ET sur les 30 derniers jours.
  taps as materialized (
    select pce.campaign_id, pce.user_id, min(pce.created_at) as tap_at
    from public.push_campaign_events pce
    where pce.event_type = 'clicked' and pce.user_id is not null
      and (pce.campaign_id in (select id from page)
           or pce.campaign_id in (select id from scoped where created_at >= now() - interval '30 days'))
    group by 1, 2
  ),
  attributed as materialized (
    select t.campaign_id, s.pillar, s.id as sale_id, s.user_id, s.amount
    from taps t
    join sales s on s.user_id = t.user_id
                and s.at_ts >= t.tap_at and s.at_ts < t.tap_at + interval '72 hours'
  )
  select jsonb_build_object(
    'ok', true,
    'money', v_money,
    'total', (select count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'summary', (
      select jsonb_build_object(
        'campaigns', count(*),
        'sent', coalesce(sum(sc.sent_count), 0),
        'taps', (select count(*) from taps t where t.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')),
        'buyers', (select count(distinct a.user_id) from attributed a
                   where a.pillar <> 'guestlist' and a.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')),
        'revenue', case when v_money then round(coalesce((
                     select sum(d.amount) from (
                       select distinct a.sale_id, a.amount from attributed a
                       where a.campaign_id in (select id from scoped where created_at >= now() - interval '30 days')
                     ) d), 0)::numeric, 2) else null end
      )
      from scoped sc
      where sc.created_at >= now() - interval '30 days' and sc.status <> 'scheduled'
    ),
    'followers', (
      with f as (
        select fv.user_id, fv.created_at
        from public.favorites fv
        where p_venue_id is not null and fv.favorite_type = 'club' and fv.venue_id = p_venue_id
        union
        select opf.user_id, opf.created_at
        from public.organizer_profile_followers opf
        where p_organizer_user_id is not null and opf.organizer_user_id = p_organizer_user_id
      )
      select jsonb_build_object(
        'total', count(distinct f.user_id),
        'reachable', count(distinct f.user_id) filter (where exists (
          select 1 from public.push_subscriptions ps where ps.user_id = f.user_id and ps.platform = 'ios')),
        'new30d', count(distinct f.user_id) filter (where f.created_at >= now() - interval '30 days')
      ) from f
    ),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'title', p.title,
               'body', p.body,
               'templateKey', p.template_key,
               'source', coalesce(p.source, 'manual'),
               'status', p.status,
               'createdAt', p.created_at,
               'scheduledAt', p.scheduled_at,
               'eventId', p.event_id,
               'eventTitle', e.title,
               'targeted', coalesce(p.targeted_count, 0),
               'sent', coalesce(p.sent_count, 0),
               'failed', coalesce(p.failed_count, 0),
               'taps', coalesce((select count(*) from taps t where t.campaign_id = p.id), 0),
               'buyers', coalesce((select count(distinct a.user_id) from attributed a where a.campaign_id = p.id and a.pillar <> 'guestlist'), 0),
               'orders', coalesce((select count(*) from attributed a where a.campaign_id = p.id and a.pillar <> 'guestlist'), 0),
               'entries', coalesce((select count(*) from attributed a where a.campaign_id = p.id and a.pillar = 'guestlist'), 0),
               'revenue', case when v_money then round(coalesce((select sum(a.amount) from attributed a where a.campaign_id = p.id), 0)::numeric, 2) else null end
             ) order by coalesce(p.scheduled_at, p.created_at) desc, p.created_at desc)
      from page p
      left join public.events e on e.id = p.event_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_push_campaigns(text, uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.get_push_campaigns(text, uuid, text, uuid, integer, integer) to authenticated;

comment on function public.get_push_campaigns(text, uuid, text, uuid, integer, integer) is
  'Historique paginé des push d''un club ou d''un organisateur (manuels, automatiques, programmés) : ciblés, envoyés (acceptés par Apple), ouverts (taps), acheteurs, inscrits, CA attribué (1er tap → achat < 72 h, CA club). Résumé 30 j + abonnés (total, joignables, nouveaux). Montants seulement pour qui voit l''argent.';
