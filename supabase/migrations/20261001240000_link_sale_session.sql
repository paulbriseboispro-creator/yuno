-- Analytics v3 — le lien session ↔ vente, côté serveur.
--
-- Le client (page de retour Stripe) tentait un UPDATE direct de
-- visitor_sessions.order_id ; en prod cette colonne est restée vide sur
-- 36 000 sessions (RLS, portée, scope changé entre la page soirée et le retour).
-- Une seule porte désormais : `link_sale_session(session, kind, sale)`,
-- SECURITY DEFINER, qui
--   1. retrouve la session par son id (quelle que soit sa portée),
--   2. vérifie que la vente existe, est payée et récente (< 24 h),
--   3. pose completed_order / order_id sur la session,
--   4. complète l'attribution de la vente avec la source de la session quand
--      la vente n'avait que « direct » (jamais par-dessus promoteur, lien,
--      code promo ou email — la priorité de la spec tient).
-- Anti-abus : un id de session est un secret d'onglet (uuid), la vente doit
-- être payée, et une session déjà reliée ne bouge plus.

CREATE OR REPLACE FUNCTION public.link_sale_session(p_session_id text, p_kind text, p_sale_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sess record; v_event uuid; v_at timestamptz; v_src text; v_cur text;
BEGIN
  IF p_session_id IS NULL OR length(p_session_id) < 8 OR p_sale_id IS NULL THEN RETURN false; END IF;
  SELECT s.id, s.session_id, s.referrer_category, s.referrer_domain, s.utm_source, s.utm_medium, s.order_id
    INTO v_sess FROM public.visitor_sessions s WHERE s.session_id = p_session_id ORDER BY s.visited_at DESC LIMIT 1;
  IF v_sess.id IS NULL THEN RETURN false; END IF;

  IF p_kind = 'ticket' THEN
    SELECT t.event_id, coalesce(t.paid_at, t.created_at), t.attribution_source INTO v_event, v_at, v_cur FROM public.tickets t WHERE t.id = p_sale_id AND t.status IN ('paid', 'used');
  ELSIF p_kind = 'table' THEN
    SELECT r.event_id, coalesce(r.paid_at, r.created_at), r.attribution_source INTO v_event, v_at, v_cur FROM public.table_reservations r WHERE r.id = p_sale_id AND r.status IN ('paid', 'confirmed');
  ELSIF p_kind = 'order' THEN
    SELECT o.event_id, coalesce(o.paid_at, o.created_at), o.attribution_source INTO v_event, v_at, v_cur FROM public.orders o WHERE o.id = p_sale_id AND o.status IN ('paid', 'served');
  ELSE
    RETURN false;
  END IF;
  IF v_at IS NULL OR v_at < now() - interval '24 hours' THEN RETURN false; END IF;

  -- 3. La session porte la vente (une fois).
  UPDATE public.visitor_sessions SET completed_order = true, order_id = p_sale_id
   WHERE id = v_sess.id AND order_id IS NULL;

  -- 4. La source de la session complète une attribution « direct ».
  v_src := public.attribution_from_session(v_sess.referrer_category, v_sess.referrer_domain, v_sess.utm_source, v_sess.utm_medium);
  IF v_src IS NOT NULL AND v_src <> 'direct' AND coalesce(v_cur, 'direct') = 'direct' THEN
    IF p_kind = 'ticket' THEN
      UPDATE public.tickets SET attribution_source = v_src, attribution_ref = 'session' WHERE id = p_sale_id AND coalesce(attribution_source, 'direct') = 'direct';
    ELSIF p_kind = 'table' THEN
      UPDATE public.table_reservations SET attribution_source = v_src, attribution_ref = 'session' WHERE id = p_sale_id AND coalesce(attribution_source, 'direct') = 'direct';
    ELSE
      UPDATE public.orders SET attribution_source = v_src, attribution_ref = 'session' WHERE id = p_sale_id AND coalesce(attribution_source, 'direct') = 'direct';
    END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.link_sale_session(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_sale_session(text, text, uuid) TO anon, authenticated;

-- Le tunnel : (event, step, session) sert au dénombrement par étape.
CREATE INDEX IF NOT EXISTS idx_event_funnel_event_step_session ON public.event_funnel_events (event_id, step, session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_event_session ON public.visitor_sessions (event_id, session_id) WHERE event_id IS NOT NULL;
