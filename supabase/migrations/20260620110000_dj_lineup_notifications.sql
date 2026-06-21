-- A2 — Notif cross-club : prévenir les followers d'un DJ quand il rejoint un line-up.
-- Filtré par lieu : un follower n'est notifié que si la ville du gig correspond à SA
-- ville (tolérant), OU s'il a opté pour "tous ses gigs". SILENCIEUX si on ne connaît
-- pas sa ville (zéro spam — le Madrid→Toulouse). Idempotent par (follower, soirée, DJ).

-- =============================================================================
-- 1. Opt-in superfan "tous ses gigs" (défaut: filtré par ville)
-- =============================================================================
ALTER TABLE public.favorites
  ADD COLUMN IF NOT EXISTS notify_all_locations boolean NOT NULL DEFAULT false;

-- favorites n'avait que SELECT/INSERT/DELETE : sans policy UPDATE, basculer l'opt-in
-- échouerait en silence sous RLS. On autorise l'utilisateur à modifier SES favoris.
DROP POLICY IF EXISTS "Users can update their own favorites" ON public.favorites;
CREATE POLICY "Users can update their own favorites"
  ON public.favorites FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- 2. Ledger de dédup — empêche de re-notifier (le line-up est delete+reinsert à
--    chaque édition de soirée, donc l'insert event_djs n'est PAS une preuve de
--    nouveauté ; ce ledger l'est).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_lineup_notifications (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL,
  event_id  uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  dj_id     uuid NOT NULL REFERENCES public.djs(id) ON DELETE CASCADE,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id, dj_id)
);

ALTER TABLE public.dj_lineup_notifications ENABLE ROW LEVEL SECURITY;
-- Écrit/lu uniquement par l'edge function (service role). Aucun accès authenticated.
DROP POLICY IF EXISTS dj_lineup_notifications_service ON public.dj_lineup_notifications;
CREATE POLICY dj_lineup_notifications_service ON public.dj_lineup_notifications
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dj_lineup_notif_lookup
  ON public.dj_lineup_notifications(user_id, event_id, dj_id);

-- =============================================================================
-- 3. RPC destinataires — calcule QUI notifier (filtre géo + opt-in + dédup).
--    SENSIBLE : renvoie des abonnements push (secrets) → verrouillée service_role.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_dj_lineup_notification_targets(
  p_event_id uuid,
  p_dj_id    uuid
) RETURNS TABLE (
  user_id  uuid,
  endpoint text,
  p256dh   text,
  auth     text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_city text;
  v_ok   boolean;
BEGIN
  -- N'agit que sur une soirée publique, active et à venir.
  SELECT e.location_city,
         (e.is_active AND e.end_at >= now() AND e.visibility = 'public')
    INTO v_city, v_ok
  FROM public.events e WHERE e.id = p_event_id;

  IF NOT FOUND OR v_ok IS NOT TRUE THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT f.user_id, ps.endpoint, ps.p256dh, ps.auth
  FROM public.favorites f
  JOIN public.push_subscriptions ps ON ps.user_id = f.user_id
  LEFT JOIN public.profiles pr ON pr.id = f.user_id
  WHERE f.dj_id = p_dj_id
    AND f.favorite_type = 'dj'
    AND (
      f.notify_all_locations = true
      OR (
        v_city IS NOT NULL AND pr.city IS NOT NULL AND (
          lower(btrim(pr.city)) = lower(btrim(v_city))
          OR position(lower(btrim(v_city)) IN lower(btrim(pr.city))) > 0
          OR position(lower(btrim(pr.city)) IN lower(btrim(v_city))) > 0
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.dj_lineup_notifications n
      WHERE n.user_id = f.user_id AND n.event_id = p_event_id AND n.dj_id = p_dj_id
    );
END; $$;

REVOKE ALL ON FUNCTION public.get_dj_lineup_notification_targets(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dj_lineup_notification_targets(uuid,uuid) TO service_role;
