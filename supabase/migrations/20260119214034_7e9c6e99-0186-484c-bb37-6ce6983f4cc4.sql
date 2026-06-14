-- =====================================================
-- DJs : Ajouter SELECT pour les managers
-- =====================================================
CREATE POLICY "Managers can view djs"
  ON public.djs FOR SELECT
  USING (manager_has_permission(auth.uid(), venue_id, 'djs'));

-- =====================================================
-- DJ Sets : Ajouter politiques complètes pour managers
-- =====================================================
CREATE POLICY "Managers can view dj_sets"
  ON public.dj_sets FOR SELECT
  USING (manager_has_permission(auth.uid(), venue_id, 'djs'));

CREATE POLICY "Managers can insert dj_sets"
  ON public.dj_sets FOR INSERT
  WITH CHECK (manager_has_permission(auth.uid(), venue_id, 'djs'));

CREATE POLICY "Managers can update dj_sets"
  ON public.dj_sets FOR UPDATE
  USING (manager_has_permission(auth.uid(), venue_id, 'djs'));

CREATE POLICY "Managers can delete dj_sets"
  ON public.dj_sets FOR DELETE
  USING (manager_has_permission(auth.uid(), venue_id, 'djs'));

-- =====================================================
-- DJ Payments : Ajouter politiques complètes pour managers
-- =====================================================
CREATE POLICY "Managers can view dj_payments"
  ON public.dj_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM djs d
      WHERE d.id = dj_payments.dj_id
      AND manager_has_permission(auth.uid(), d.venue_id, 'djs')
    )
  );

CREATE POLICY "Managers can insert dj_payments"
  ON public.dj_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM djs d
      WHERE d.id = dj_payments.dj_id
      AND manager_has_permission(auth.uid(), d.venue_id, 'djs')
    )
  );

CREATE POLICY "Managers can update dj_payments"
  ON public.dj_payments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM djs d
      WHERE d.id = dj_payments.dj_id
      AND manager_has_permission(auth.uid(), d.venue_id, 'djs')
    )
  );

CREATE POLICY "Managers can delete dj_payments"
  ON public.dj_payments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM djs d
      WHERE d.id = dj_payments.dj_id
      AND manager_has_permission(auth.uid(), d.venue_id, 'djs')
    )
  );

-- =====================================================
-- Promoters : Ajouter SELECT pour les managers
-- =====================================================
CREATE POLICY "Managers can view promoters"
  ON public.promoters FOR SELECT
  USING (manager_has_permission(auth.uid(), venue_id, 'promoters'));

-- =====================================================
-- Promoter Clicks : Ajouter SELECT pour managers
-- =====================================================
CREATE POLICY "Managers can view promoter_clicks"
  ON public.promoter_clicks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM promoters p
      WHERE p.id = promoter_clicks.promoter_id
      AND manager_has_permission(auth.uid(), p.venue_id, 'promoters')
    )
  );

-- =====================================================
-- Promoter Conversions : Ajouter SELECT/UPDATE pour managers
-- =====================================================
CREATE POLICY "Managers can view promoter_conversions"
  ON public.promoter_conversions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM promoters p
      WHERE p.id = promoter_conversions.promoter_id
      AND manager_has_permission(auth.uid(), p.venue_id, 'promoters')
    )
  );

CREATE POLICY "Managers can update promoter_conversions"
  ON public.promoter_conversions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM promoters p
      WHERE p.id = promoter_conversions.promoter_id
      AND manager_has_permission(auth.uid(), p.venue_id, 'promoters')
    )
  );

-- =====================================================
-- Promoter Announcements : Ajouter politiques pour managers
-- =====================================================
CREATE POLICY "Managers can view promoter_announcements"
  ON public.promoter_announcements FOR SELECT
  USING (manager_has_permission(auth.uid(), venue_id, 'promoters'));

CREATE POLICY "Managers can insert promoter_announcements"
  ON public.promoter_announcements FOR INSERT
  WITH CHECK (manager_has_permission(auth.uid(), venue_id, 'promoters'));

CREATE POLICY "Managers can update promoter_announcements"
  ON public.promoter_announcements FOR UPDATE
  USING (manager_has_permission(auth.uid(), venue_id, 'promoters'));

CREATE POLICY "Managers can delete promoter_announcements"
  ON public.promoter_announcements FOR DELETE
  USING (manager_has_permission(auth.uid(), venue_id, 'promoters'));