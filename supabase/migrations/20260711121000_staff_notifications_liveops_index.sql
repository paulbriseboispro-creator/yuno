-- ────────────────────────────────────────────────────────────────────────────
--  Index de dédup des alertes live ops
--  Le moteur d'alertes du cron 5 min appelle notifAlreadySent (venue_id +
--  notification_type + reference_id + created_at) jusqu'à ~10 fois par event
--  actif à chaque run. Sans index dédié, chaque check parcourt les
--  notifications du venue.
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_staff_notifications_liveops_dedup
  ON public.staff_notifications (venue_id, notification_type, reference_id, created_at DESC);
