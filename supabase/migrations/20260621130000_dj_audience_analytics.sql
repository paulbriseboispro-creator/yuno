-- DJ audience analytics.
-- Aggregated demographics of a DJ's subscribers (the "S'abonner" bell → favorites
-- rows of favorite_type='dj'). Returns COUNTS ONLY — never individual rows / PII —
-- so a DJ understands their audience without seeing who each fan is.
--
-- Demographics come from `profiles` (birth_date → age, city, preferred_language,
-- party_persona) and `user_taste_profiles` (music_style). Gender is not stored on
-- profiles, so it's derived from the most recent guest-list entry that matches the
-- subscriber (by user_id or email); coverage is reported back so the UI can be honest.
--
-- Authorization: the calling DJ (auth.uid()) or an active team member of the target
-- DJ. SECURITY DEFINER so it can read the otherwise-locked profile tables, scoped
-- strictly to the target DJ's own subscribers.

create or replace function public.dj_audience_analytics(p_dj_user_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  effective uuid := coalesce(p_dj_user_id, auth.uid());
  result jsonb;
begin
  if effective is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if effective <> auth.uid() and not exists (
    select 1 from public.dj_team_members
    where member_user_id = auth.uid() and dj_user_id = effective and status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with dj_ids as (
    select id from public.djs where user_id = effective
  ),
  subs as (
    -- one row per distinct subscriber, keeping their earliest subscription date
    select distinct on (f.user_id)
      f.user_id, f.created_at, f.notify_all_locations
    from public.favorites f
    where f.favorite_type = 'dj'
      and f.dj_id in (select id from dj_ids)
    order by f.user_id, f.created_at asc
  ),
  enriched as (
    select
      s.user_id,
      s.created_at,
      s.notify_all_locations,
      p.email,
      p.birth_date,
      nullif(trim(p.city), '') as city,
      p.preferred_language,
      p.party_persona,
      tp.music_style,
      g.gender
    from subs s
    left join public.profiles p on p.id = s.user_id
    left join public.user_taste_profiles tp on tp.user_id = s.user_id
    left join lateral (
      select gle.gender
      from public.guest_list_entries gle
      where gle.gender is not null
        and (gle.user_id = s.user_id or (p.email is not null and lower(gle.email) = lower(p.email)))
      order by gle.created_at desc
      limit 1
    ) g on true
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from subs),
    'notify_all', (select count(*) from enriched where notify_all_locations),
    'age_known', (select count(*) from enriched where birth_date is not null),
    'gender_known', (select count(*) from enriched where gender is not null),
    'recent_30d', (select count(*) from enriched where created_at >= now() - interval '30 days'),
    'growth', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'count', c) order by m)
      from (
        select to_char(date_trunc('month', created_at), 'YYYY-MM') as m, count(*) c
        from enriched group by 1
      ) gm
    ), '[]'::jsonb),
    'age_buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', c) order by ord)
      from (
        select bucket, ord, count(*) c
        from (
          select
            case
              when age < 18 then '<18'
              when age between 18 and 24 then '18-24'
              when age between 25 and 34 then '25-34'
              when age between 35 and 44 then '35-44'
              else '45+'
            end as bucket,
            case
              when age < 18 then 0 when age between 18 and 24 then 1
              when age between 25 and 34 then 2 when age between 35 and 44 then 3 else 4
            end as ord
          from (
            select date_part('year', age(birth_date))::int as age
            from enriched where birth_date is not null
          ) a
        ) b group by bucket, ord
      ) ab
    ), '[]'::jsonb),
    'gender', coalesce((
      select jsonb_agg(jsonb_build_object('label', gender, 'count', c) order by c desc)
      from (select gender, count(*) c from enriched where gender is not null group by gender) gg
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('city', city, 'count', c) order by c desc)
      from (
        select city, count(*) c from enriched where city is not null
        group by city order by c desc limit 8
      ) cc
    ), '[]'::jsonb),
    'languages', coalesce((
      select jsonb_agg(jsonb_build_object('lang', preferred_language, 'count', c) order by c desc)
      from (
        select preferred_language, count(*) c from enriched
        where preferred_language is not null group by preferred_language
      ) ll
    ), '[]'::jsonb),
    'personas', coalesce((
      select jsonb_agg(jsonb_build_object('persona', party_persona, 'count', c) order by c desc)
      from (
        select party_persona, count(*) c from enriched
        where party_persona is not null group by party_persona order by c desc limit 6
      ) pp
    ), '[]'::jsonb),
    'music', coalesce((
      select jsonb_agg(jsonb_build_object('style', music_style, 'count', c) order by c desc)
      from (
        select music_style, count(*) c from enriched
        where music_style is not null group by music_style order by c desc limit 6
      ) ms
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.dj_audience_analytics(uuid) to authenticated;
