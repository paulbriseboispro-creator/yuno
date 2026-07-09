-- Notifications push AUTOMATIQUES — activables par le club, déclenchées par le
-- cycle de vie des soirées (avant / pendant / après) + scarcity billetterie.
--
-- Deux familles de push désormais séparées côté produit :
--   • MANUELLES  : l'owner compose et envoie (promo, happy hour, VIP, guest list…)
--                  → edge function send-push-campaign, cap 4/24 h.
--   • AUTO       : l'owner active une fois, Yuno envoie au bon moment.
--                  → dispatcher dans process-scheduled-campaigns (cron */5 min),
--                    via get_due_push_automations() ci-dessous.
--
-- Les campagnes AUTO n'entament PAS le cap manuel (colonne source ci-dessous,
-- filtrée dans send-push-campaign). Dédup : un index unique garantit UN seul
-- push par soirée et par automatisation, même si deux runs de cron se croisent.

-- 1) Distinguer campagnes manuelles / automatiques -----------------------------

ALTER TABLE public.push_campaigns
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto'));

-- Dédup automatisations : une campagne AUTO par (soirée, type d'automatisation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_campaigns_auto_event
  ON public.push_campaigns (event_id, template_key)
  WHERE source = 'auto' AND event_id IS NOT NULL;

-- 2) Toggles d'automatisation par club ----------------------------------------

CREATE TABLE IF NOT EXISTS public.venue_push_automations (
  venue_id       text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  automation_key text NOT NULL CHECK (automation_key IN (
    'reminder_day_of', 'event_live', 'thank_you', 'almost_sold_out'
  )),
  enabled        boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, automation_key)
);

ALTER TABLE public.venue_push_automations ENABLE ROW LEVEL SECURITY;

-- L'owner gère les automatisations de SON club (lecture + upsert du toggle).
CREATE POLICY "Venue owners manage own push automations"
  ON public.venue_push_automations FOR ALL
  USING (public.is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (public.is_venue_owner(auth.uid(), venue_id));

-- 3) Automatisations « dues » à envoyer maintenant ----------------------------
--
-- Renvoie, pour chaque (club, soirée, automatisation activée), les soirées qui
-- viennent d'entrer dans leur fenêtre de tir ET qui n'ont pas encore été
-- notifiées (NOT EXISTS sur une campagne AUTO du même type). Le dispatcher
-- (process-scheduled-campaigns) résout l'audience, localise par destinataire,
-- crée la campagne (source='auto') et fan-out vers send-push-notification.
--
-- Fenêtres de tir (le NOT EXISTS + l'index unique garantissent UN seul envoi) :
--   reminder_day_of : [start-6h, start)              → acheteurs (billets+tables)
--   event_live      : [start, start+3h)              → acheteurs
--   thank_you       : [end+1h, end+8h)               → clients entrés (scannés)
--   almost_sold_out : avant start, ≥85 % de max_tickets → followers du club

CREATE OR REPLACE FUNCTION public.get_due_push_automations()
RETURNS TABLE (
  venue_id       text,
  venue_name     text,
  event_id       uuid,
  event_title    text,
  event_slug     text,
  automation_key text,
  start_at       timestamptz,
  end_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.venue_id,
    v.name,
    e.id,
    e.title,
    e.slug,
    a.automation_key,
    e.start_at,
    e.end_at
  FROM public.venue_push_automations a
  JOIN public.venues v ON v.id = a.venue_id
  JOIN public.events e ON e.venue_id = a.venue_id
  WHERE a.enabled = true
    AND e.venue_id IS NOT NULL
    AND e.is_active = true
    AND e.cancelled_at IS NULL
    -- Bornage pour garder la jointure petite (le cron passe toutes les 5 min).
    AND e.end_at   > now() - interval '12 hours'
    AND e.start_at < now() + interval '30 days'
    AND (
      (a.automation_key = 'reminder_day_of'
        AND now() >= e.start_at - interval '6 hours'
        AND now() <  e.start_at)
      OR (a.automation_key = 'event_live'
        AND now() >= e.start_at
        AND now() <  e.start_at + interval '3 hours')
      OR (a.automation_key = 'thank_you'
        AND now() >= e.end_at + interval '1 hour'
        AND now() <  e.end_at + interval '8 hours')
      OR (a.automation_key = 'almost_sold_out'
        AND e.start_at > now()
        AND e.max_tickets IS NOT NULL
        AND e.max_tickets > 0
        AND (
          SELECT count(*) FROM public.tickets t
          WHERE t.event_id = e.id AND t.status = 'paid'
        ) >= (e.max_tickets * 0.85))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.push_campaigns pc
      WHERE pc.event_id = e.id
        AND pc.template_key = a.automation_key
        AND pc.source = 'auto'
    );
$$;

-- Réservé au service_role (appelée par le dispatcher cron), jamais exposée au client.
REVOKE ALL ON FUNCTION public.get_due_push_automations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_push_automations() TO service_role;
