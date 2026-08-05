-- ============================================================================
-- Perf P0 — le système d'audience (5 RPC par chargement) et get_public_favorite_counts
-- (chaque carte Explore) seq-scannaient `favorites` : la table n'a que des UNIQUE
-- menant par user_id, aucun index menant par venue_id/dj_id. Idem tickets/tables
-- (pas d'index event_id) et la résolution guest-checkout par lower(email).
--
-- Index partiels COUVRANTS pour la résolution des abonnés. CREATE INDEX simple
-- (pas CONCURRENTLY) : tables encore petites au lancement, lock bref acceptable ;
-- passer à CONCURRENTLY hors transaction si le volume grossit.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_favorites_club_person
  ON public.favorites (venue_id, user_id) WHERE favorite_type = 'club';
CREATE INDEX IF NOT EXISTS idx_favorites_dj_person
  ON public.favorites (dj_id, user_id) WHERE favorite_type = 'dj';
CREATE INDEX IF NOT EXISTS idx_djs_user_id
  ON public.djs (user_id);

CREATE INDEX IF NOT EXISTS idx_tickets_event_status
  ON public.tickets (event_id, status);
CREATE INDEX IF NOT EXISTS idx_table_reservations_event_status
  ON public.table_reservations (event_id, status);

CREATE INDEX IF NOT EXISTS idx_profiles_lower_email
  ON public.profiles (lower(email));

CREATE INDEX IF NOT EXISTS idx_pce_user_created
  ON public.push_campaign_events (user_id, created_at DESC);
