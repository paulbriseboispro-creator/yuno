-- Démo : le tunnel d'achat, l'engagement des pages et le CRM des soirées
-- (Analytics › Trafic › Par soirée, Communauté › Par soirée).
--
-- Rejouable, BORNÉ à `demo_event_ids()` : il n'écrit que dans le périmètre
-- démo (club `womber`, organisateurs @womber.fr, leurs soirées). Il efface ses
-- propres lignes avant de les recréer.
--
--   1. `event_funnel_events` : une session de tunnel par visite de page soirée
--      déjà semée (`visitor_sessions`), avec un entonnoir réaliste — 30 % des
--      visites choisissent, 66 % de ceux-là passent au paiement, le mobile perd
--      plus aux coordonnées que l'ordinateur, 7 % des paiements échouent avec
--      un motif. Les lignes choisies sont de vrais paliers / formules.
--   2. `visitor_sessions` : durée et profondeur de défilement des visites démo
--      qui n'en ont pas (la durée est écrite à la sortie de la page).
--   3. `newsletter_subscriptions` : ~55 % des acheteurs démo abonnés à l'email
--      du club, à l'heure de leur premier achat (source `seed.event_funnel`).
--   4. `audience_follow_events` : quelques abonnements depuis la page soirée
--      (source `event_page`) pendant les ventes des dernières soirées du club.
--      Les abonnés sont des uuid fictifs : `delete from audience_follow_events
--      where follower_user_id not in (select id from profiles) and source in
--      ('event_page','organizer_page','rp_page')` les retire.
--
-- À relancer quand les dates passent, comme `seed-upcoming-sales.sql`.

begin;

-- ── 0. Ses propres lignes d'abord ───────────────────────────────────────────
delete from public.event_funnel_events
 where event_id = any (demo_event_ids()) and session_id like 'seed.%';
delete from public.newsletter_subscriptions where source = 'seed.event_funnel';
delete from public.audience_follow_events
 where follower_user_id not in (select id from public.profiles)
   and source in ('event_page', 'organizer_page', 'rp_page')
   and subject_id in ('womber');

-- ── 1. Le tunnel ─────────────────────────────────────────────────────────────
with v as materialized (
  select s.id, s.event_id, s.visited_at,
         coalesce(nullif(s.referrer_category, ''), 'direct') as src,
         case when s.device_type in ('mobile', 'tablet', 'desktop') then s.device_type else 'mobile' end as dev,
         (abs(hashtextextended(s.id::text, 1)) % 1000) / 1000.0 as r_sel,
         (abs(hashtextextended(s.id::text, 2)) % 1000) / 1000.0 as r_co,
         (abs(hashtextextended(s.id::text, 3)) % 1000) / 1000.0 as r_det,
         (abs(hashtextextended(s.id::text, 4)) % 1000) / 1000.0 as r_buy,
         (abs(hashtextextended(s.id::text, 5)) % 1000) / 1000.0 as r_fail,
         (abs(hashtextextended(s.id::text, 6)) % 1000) / 1000.0 as r_why,
         (abs(hashtextextended(s.id::text, 7)) % 1000) / 1000.0 as r_pillar,
         (abs(hashtextextended(s.id::text, 8)) % 100) as jitter
    from public.visitor_sessions s
   where s.event_id = any (demo_event_ids())
),
j as materialized (
  select v.*,
         case when v.r_pillar < 0.68 then 'tickets' when v.r_pillar < 0.86 then 'tables' else 'guest_list' end as pillar,
         -- La source de la vente, le palier ou la formule (vrais identifiants).
         (select tr.id::text from public.ticket_rounds tr where tr.event_id = v.event_id
           order by md5(tr.id::text || v.id::text) limit 1) as round_id,
         (select tp.id::text from public.table_packs tp
            join public.events ev on ev.id = v.event_id and tp.venue_id = coalesce(ev.venue_id, ev.partner_venue_id)
           order by md5(tp.id::text || v.id::text) limit 1) as pack_id,
         (v.r_sel < 0.30) as did_select,
         (v.r_sel < 0.30 and v.r_co < 0.66) as did_checkout,
         (v.r_sel < 0.30 and v.r_co < 0.66 and v.r_det < (case when v.dev = 'mobile' then 0.56 else 0.80 end)) as did_details
    from v
),
k as materialized (
  select j.*, (j.did_details and j.r_buy < 0.80) as did_buy,
         (j.did_checkout and j.r_fail < 0.07) as did_fail
    from j
)
insert into public.event_funnel_events (session_id, event_id, step, pillar, ref_id, quantity, amount_cents, reason, device, source, created_at)
select 'seed.' || k.id, k.event_id, 'viewed', null, null, null, null, null, k.dev, k.src, k.visited_at from k
union all
select 'seed.' || k.id, k.event_id, 'selected', k.pillar,
       case k.pillar when 'tickets' then k.round_id when 'tables' then k.pack_id end,
       case k.pillar when 'tickets' then 1 + (k.jitter % 4) when 'tables' then 4 + (k.jitter % 5) else 1 end,
       case k.pillar when 'tickets' then 1500 * (1 + (k.jitter % 4)) when 'tables' then 25000 else null end,
       null, k.dev, k.src, k.visited_at + make_interval(secs => 20 + k.jitter)
  from k where k.did_select
union all
select 'seed.' || k.id, k.event_id, 'checkout', k.pillar, null, null, null, null, k.dev, k.src, k.visited_at + make_interval(secs => 50 + k.jitter)
  from k where k.did_checkout
union all
select 'seed.' || k.id, k.event_id, 'details', k.pillar, null, null, null, null, k.dev, k.src, k.visited_at + make_interval(secs => 110 + k.jitter * 2)
  from k where k.did_details and k.pillar <> 'guest_list'
union all
select 'seed.' || k.id, k.event_id, 'purchased', k.pillar, null, null, null, null, k.dev, k.src, k.visited_at + make_interval(secs => 170 + k.jitter * 3)
  from k where k.did_buy
union all
select 'seed.' || k.id, k.event_id, 'failed', k.pillar, null, null, null,
       case when k.r_why < 0.45 then 'network' when k.r_why < 0.75 then 'validation' when k.r_why < 0.92 then 'server' else 'sold_out' end,
       k.dev, k.src, k.visited_at + make_interval(secs => 90 + k.jitter)
  from k where k.did_fail;

-- ── 2. Engagement des pages (écrit à la sortie de la page) ──────────────────
update public.visitor_sessions s
   set duration_seconds = 8 + (abs(hashtextextended(s.id::text, 9)) % 300),
       scroll_depth_max = abs(hashtextextended(s.id::text, 10)) % 101
 where s.event_id = any (demo_event_ids())
   and coalesce(s.duration_seconds, 0) = 0;

-- ── 3. Le CRM : des acheteurs démo abonnés à l'email du club ────────────────
insert into public.newsletter_subscriptions
  (venue_id, email, opted_in, source, created_at, updated_at, consent_source, consent_recorded_at)
select 'womber', p.e, true, 'seed.event_funnel', p.first_at, p.first_at, 'checkout', p.first_at
  from (
    select lower(t.user_email) as e, min(coalesce(t.paid_at, t.created_at)) as first_at
      from public.tickets t
     where t.event_id = any (demo_event_ids()) and t.status in ('paid', 'used')
       and t.user_email ilike '%@demo.womber.fr'
     group by 1
  ) p
 where abs(hashtextextended(p.e, 3)) % 100 < 55
on conflict do nothing;

-- ── 4. Des abonnés gagnés depuis la page soirée, sur les dernières soirées ──
insert into public.audience_follow_events (subject_type, subject_id, follower_user_id, action, source, created_at)
select 'venue', 'womber', gen_random_uuid(), 'follow',
       case when g % 5 < 2 then 'event_page' when g % 5 = 2 then 'organizer_page' else 'rp_page' end,
       e.start_at - make_interval(days => (g * 3) % 14, hours => (g * 5) % 20)
  from (
    select ev.id, ev.start_at
      from public.events ev
     where ev.id = any (demo_event_ids()) and ev.venue_id = 'womber' and ev.start_at < now() + interval '14 days'
     order by ev.start_at desc limit 20
  ) e
  cross join generate_series(1, 6) g
 where abs(hashtextextended(e.id::text || g::text, 11)) % 100 < 70;

commit;
