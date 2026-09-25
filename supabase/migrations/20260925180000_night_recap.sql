-- ═══════════════════════════════════════════════════════════════════════════
-- Plan de simplification de l'analyse, lot 7 — le chiffre vient à toi.
--
-- Le lendemain d'une soirée, à partir de 11 h (heure de Paris), le pro reçoit
-- son bilan en une notification : entrées / attendus, CA, dépense par tête, et
-- l'écart avec la soirée précédente — un lien, le Rapport de soirée.
-- Deux canaux, un seul texte : la cloche de la Console (staff_notifications
-- côté club, organizer_notifications côté organisateur) et un push sur Yuno
-- Pro (clé AUTO_PUSH `night_recap`, audience « pro », pilotée depuis
-- /admin/notifications).
--
-- L'ENVOI est fait côté edge (`_shared/night-recap.ts`, drainé par
-- process-scheduled-campaigns). Ici : le journal de dédup (une fois par
-- soirée, réclamé AVANT l'envoi), la liste des soirées dues et les chiffres —
-- mêmes formules que get_event_report (porte, CA club de fees.ts,
-- remboursements déduits).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.night_recap_log (
  event_id   uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS sans policy : seul le service_role (le dispatcher) y écrit et y lit.
ALTER TABLE public.night_recap_log ENABLE ROW LEVEL SECURITY;

-- Soirées dont le bilan est dû : terminées depuis 3 à 30 h, pas annulées, pas
-- encore récapitulées, et seulement entre 11 h et 20 h à Paris (un bilan à
-- 6 h du matin réveille ; après 20 h, il arrive trop tard pour servir).
CREATE OR REPLACE FUNCTION public.night_recap_due()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id
  FROM public.events e
  WHERE extract(hour FROM now() AT TIME ZONE 'Europe/Paris') BETWEEN 11 AND 19
    AND e.end_at BETWEEN now() - interval '30 hours' AND now() - interval '3 hours'
    AND e.cancelled_at IS NULL
    AND (e.venue_id IS NOT NULL OR e.organizer_user_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.night_recap_log l WHERE l.event_id = e.id)
  ORDER BY e.end_at
  LIMIT 200;
$$;

-- Les chiffres du bilan d'UNE soirée. Destinataire : le propriétaire du club
-- qui porte la soirée, sinon l'organisateur (le partenaire d'une co-soirée
-- ouvre son rapport depuis la sienne ; un seul bilan par soirée).
CREATE OR REPLACE FUNCTION public.night_recap_data(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    + (select coalesce(sum(greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0)
              - least(greatest(coalesce(r.refund_amount, 0), 0),
                      greatest(r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0), 0))), 0)
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
    where x.id <> p_event_id and x.cancelled_at is null and x.start_at < e.start_at
      and ((e.venue_id is not null and x.venue_id = e.venue_id)
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
$$;

REVOKE ALL ON FUNCTION public.night_recap_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.night_recap_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.night_recap_due() TO service_role;
GRANT EXECUTE ON FUNCTION public.night_recap_data(uuid) TO service_role;

-- La clé au registre des push automatiques (/admin/notifications), ÉTEINTE :
-- le premier push de ce type à de vrais clubs part quand le super admin
-- l'allume. La cloche de la Console, elle, reçoit le bilan dès maintenant.
INSERT INTO public.platform_notification_settings (notification_key, category, enabled)
VALUES ('night_recap', 'engagement', false)
ON CONFLICT (notification_key) DO NOTHING;
