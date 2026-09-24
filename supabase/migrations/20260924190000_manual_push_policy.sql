-- Push MANUELS des pros (club, organisateur, agence) : la politique client.
--
-- Jusqu'ici, seul le plafond « 4 campagnes / 24 h par expéditeur » bornait un
-- push composé à la main. Un client qui suit trois clubs pouvait donc en
-- recevoir douze le même soir, à 3 h du matin, même après avoir coupé les
-- notifications marketing. Les push AUTOMATIQUES passent déjà par
-- `client_push_policy()` ; les manuels passent désormais par la même doctrine,
-- en deux familles :
--
--   • 'marketing' — audiences larges (abonnés, tous les clients, segments,
--     RFM, abonnés d'une agence) : opt-out `marketing`, heures calmes
--     22 h → 10 h Paris (évaluées à l'heure d'ENVOI, planifiée ou non),
--     1 non-transactionnelle par 24 h et 3 par 7 jours, tous expéditeurs
--     confondus (`notification_log`, types 'marketing' et 'campaign').
--   • 'event' — les gens qui ont une place pour CETTE soirée (acheteurs,
--     clients entrés) : la notification parle d'une nuit qu'ils ont achetée,
--     elle doit pouvoir partir à 1 h du matin pendant la soirée. Seul
--     l'opt-out `marketing` s'applique — comme les rappels de soirées
--     achetées, elle ne consomme pas de place dans les plafonds des autres.
--
-- Ensembliste (une requête pour tout le lot), jamais un appel par personne.

create or replace function public.filter_manual_push_recipients(
  p_user_ids uuid[],
  p_kind text,
  p_at timestamptz default now()
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select distinct u.id from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u(id)
  ),
  quiet as (
    select extract(hour from coalesce(p_at, now()) at time zone 'Europe/Paris')::int as h
  )
  select i.id
  from ids i
  join public.profiles p on p.id = i.id
  cross join quiet q
  where coalesce(p.notification_prefs ->> 'marketing', 'true') <> 'false'
    and (
      p_kind = 'event'
      or (
        p_kind = 'marketing'
        and q.h >= 10 and q.h < 22
        and not exists (
          select 1 from public.notification_log l
          where l.user_id = i.id
            and l.notification_type in ('marketing', 'campaign')
            and l.sent_at > now() - interval '24 hours'
        )
        and (
          select count(*) from public.notification_log l
          where l.user_id = i.id
            and l.notification_type in ('marketing', 'campaign')
            and l.sent_at > now() - interval '7 days'
        ) < 3
      )
    );
$$;

revoke all on function public.filter_manual_push_recipients(uuid[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.filter_manual_push_recipients(uuid[], text, timestamptz) to service_role;

comment on function public.filter_manual_push_recipients(uuid[], text, timestamptz) is
  'Politique des push manuels pros : marketing = opt-out + heures calmes 22h-10h Paris à p_at + 1/24h + 3/7j ; event = opt-out seul.';

-- Le journal anti-spam distingue désormais un push de soirée achetée
-- ('event_campaign', texte libre) : il n'entre dans aucun plafond, sans quoi un
-- « happy hour au bar » envoyé aux clients entrés les priverait des
-- notifications du lendemain.
