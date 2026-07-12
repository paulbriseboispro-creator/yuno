-- Système de vente boissons — upsell post-checkout + push AUTO jour J.
-- Voir docs/SYSTEME_VENTE_BOISSONS.md.
--
-- 1) venues.post_checkout_upsell_enabled : la page /order/upsell (boissons au
--    prix presale juste après l'achat d'un billet) est opt-OUT — activée par
--    défaut, le club peut la couper depuis /owner/menu. Lue uniquement par des
--    utilisateurs connectés (les invités gardent l'écran création de compte),
--    donc pas de GRANT anon nécessaire (authenticated garde le SELECT table).
--
-- 2) orders.purchase_source : attribution du canal d'achat boissons
--    ('post_checkout_upsell' posé par la page upsell via create-checkout).
--    Mesure le taux d'attache boissons/billet par canal.
--
-- 3) 5e automatisation push 'drinks_preorder' : le jour J, fenêtre
--    [start-9h, start-6h) (après-midi pour une soirée à 23h), audience
--    acheteurs (billets + tables), seulement si la vente de boissons est
--    active (menu_enabled). Même mécanique de dédup que les 4 existantes
--    (index unique uq_push_campaigns_auto_event, NOT EXISTS).

-- 1) Toggle upsell post-achat ---------------------------------------------------

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS post_checkout_upsell_enabled boolean NOT NULL DEFAULT true;

-- 2) Attribution du canal d'achat ----------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS purchase_source text;

-- 3) Automatisation push drinks_preorder ----------------------------------------

ALTER TABLE public.venue_push_automations
  DROP CONSTRAINT IF EXISTS venue_push_automations_automation_key_check;
ALTER TABLE public.venue_push_automations
  ADD CONSTRAINT venue_push_automations_automation_key_check CHECK (automation_key IN (
    'reminder_day_of', 'event_live', 'thank_you', 'almost_sold_out', 'drinks_preorder'
  ));

-- Fenêtres de tir (inchangées pour les 4 existantes) :
--   reminder_day_of : [start-6h, start)              → acheteurs (billets+tables)
--   event_live      : [start, start+3h)              → acheteurs
--   thank_you       : [end+1h, end+8h)               → clients entrés (scannés)
--   almost_sold_out : avant start, ≥85 % de max_tickets → followers du club
--   drinks_preorder : [start-9h, start-6h), menu_enabled → acheteurs

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
      OR (a.automation_key = 'drinks_preorder'
        -- NULL = activé, comme le front (menu_enabled !== false).
        AND v.menu_enabled IS DISTINCT FROM false
        AND now() >= e.start_at - interval '9 hours'
        AND now() <  e.start_at - interval '6 hours')
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
