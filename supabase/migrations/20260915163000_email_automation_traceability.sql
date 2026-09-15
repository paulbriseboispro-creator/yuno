-- ─────────────────────────────────────────────────────────────────────────────
-- Automatisations email v2 — traçabilité pour le pro.
--
--   · get_email_automation_stats(portée, p_days) : le bilan par recette
--     accepte une FENÊTRE (7 j = « cette semaine ») ; sans fenêtre, le cumul.
--     Ajoute in_flight (en attente d'envoi dans les campagnes enfants) et le
--     seuil de palier.
--   · get_customer_automation_emails(portée, email) : ce que la personne a
--     reçu (ou pourquoi elle a été écartée) — pour la fiche client du CRM.
--   · email_automation_weekly_digest(sujet) : « automatisations : X emails,
--     Y ventes attribuées » pour le récap hebdo poussé au pro (service_role).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Bilan par recette, avec fenêtre ──────────────────────────────────────
-- La signature change (paramètre optionnel) : on DROP l'ancienne pour qu'un
-- appel à deux arguments ne devienne pas ambigu.
DROP FUNCTION IF EXISTS public.get_email_automation_stats(text, uuid);
CREATE OR REPLACE FUNCTION public.get_email_automation_stats(p_venue_id text, p_organizer_user_id uuid, p_days integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_from timestamptz := CASE WHEN p_days IS NULL THEN '-infinity'::timestamptz ELSE now() - make_interval(days => p_days) END;
  v_all boolean := p_days IS NULL;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.kind), '[]'::jsonb) INTO result
    FROM (
      SELECT a.id, a.kind, a.enabled, a.enabled_at, a.delay_hours, a.threshold_pct, a.template_id, a.subject,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL) AS pending,
             -- En attente d'envoi dans une campagne enfant (file, quota, nuit).
             (SELECT count(*) FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c ON c.id = r.campaign_id
               WHERE c.automation_id = a.id AND r.status = 'pending') AS in_flight,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.created_at >= v_from) AS queued,
             (SELECT COALESCE(jsonb_object_agg(x.skip_reason, x.n), '{}'::jsonb)
                FROM (SELECT l.skip_reason, count(*) AS n FROM public.email_automation_sends l
                       WHERE l.automation_id = a.id AND l.status = 'skipped' AND l.created_at >= v_from
                       GROUP BY l.skip_reason) x) AS skipped,
             (SELECT max(l.created_at) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued') AS last_queued_at,
             (SELECT count(*) FROM public.email_campaigns c
               WHERE c.automation_id = a.id
                 AND (v_all OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                        WHERE r.campaign_id = c.id AND r.status = 'sent' AND r.sent_at >= v_from))) AS campaigns,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.recipients_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id = r.campaign_id
                         WHERE c.automation_id = a.id AND r.status = 'sent' AND r.sent_at >= v_from) END AS sent,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.delivered_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'delivered' AND ev.created_at >= v_from) END AS delivered,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.opens_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'opened' AND ev.created_at >= v_from) END AS opens,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.clickers_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(DISTINCT lower(ev.recipient_email)) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'clicked' AND ev.created_at >= v_from) END AS clickers,
             CASE WHEN v_all
                  THEN (SELECT COALESCE(sum(c.unsubscribes_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id)
                  ELSE (SELECT count(*) FROM public.email_campaign_events ev JOIN public.email_campaigns c ON c.id = ev.campaign_id
                         WHERE c.automation_id = a.id AND ev.event_type = 'unsubscribed' AND ev.created_at >= v_from) END AS unsubscribes,
             (SELECT COALESCE(jsonb_agg(c.id), '[]'::jsonb) FROM public.email_campaigns c
               WHERE c.automation_id = a.id
                 AND (v_all OR EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                        WHERE r.campaign_id = c.id AND r.status = 'sent' AND r.sent_at >= v_from))) AS campaign_ids
        FROM public.email_automations a
       WHERE (p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id)
          OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL AND a.venue_id IS NULL AND a.organizer_user_id IS NULL)
    ) s;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_automation_stats(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_automation_stats(text, uuid, integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_email_automation_stats(text, uuid, integer) IS
  'Bilan par recette. p_days NULL = cumul (compteurs des campagnes enfants) ; p_days = fenêtre glissante (envois, ouvertures, clics, désabonnements datés dans la fenêtre).';

-- ── 2. Les emails automatiques reçus par une personne (fiche client CRM) ────
CREATE OR REPLACE FUNCTION public.get_customer_automation_emails(p_venue_id text, p_organizer_user_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);
  IF p_email IS NULL OR position('@' in p_email) <= 1 THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb) INTO result
    FROM (
      SELECT l.kind, l.status, l.skip_reason, l.created_at, l.due_at, l.campaign_id,
             e.title AS event_title,
             r.sent_at,
             (r.sent_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.email_campaign_events ev
                WHERE ev.campaign_id = l.campaign_id AND lower(ev.recipient_email) = lower(l.email) AND ev.event_type = 'opened')) AS opened,
             (r.sent_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.email_campaign_events ev
                WHERE ev.campaign_id = l.campaign_id AND lower(ev.recipient_email) = lower(l.email) AND ev.event_type = 'clicked')) AS clicked
        FROM public.email_automation_sends l
        LEFT JOIN public.events e ON e.id = COALESCE(l.trigger_event_id, l.bind_event_id)
        LEFT JOIN public.email_campaign_recipients r
          ON r.campaign_id = l.campaign_id AND lower(r.email) = lower(l.email)
       WHERE lower(l.email) = lower(p_email)
         AND ((p_venue_id IS NOT NULL AND l.venue_id = p_venue_id)
           OR (p_organizer_user_id IS NOT NULL AND l.organizer_user_id = p_organizer_user_id))
       ORDER BY l.created_at DESC
       LIMIT 50
    ) x;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_customer_automation_emails(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_automation_emails(text, uuid, text) TO authenticated, service_role;

-- ── 3. Récap hebdo : « automatisations : X emails, Y ventes attribuées » ────
-- Même règle d'attribution que les campagnes (clic → achat sous 72 h, net
-- fees.ts), restreinte aux campagnes ENFANTS et aux ventes des 7 derniers
-- jours. Lue par audience-weekly-recap.ts (service_role).
CREATE OR REPLACE FUNCTION public.email_automation_weekly_digest(p_subject_type text, p_subject_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_from timestamptz := now() - interval '7 days';
BEGIN
  IF p_subject_type NOT IN ('venue', 'organizer') OR p_subject_id IS NULL THEN
    RETURN jsonb_build_object('emails', 0, 'sales', 0, 'revenue', 0);
  END IF;

  WITH children AS (
    SELECT c.id FROM public.email_campaigns c
     WHERE c.automation_id IS NOT NULL
       AND CASE WHEN p_subject_type = 'venue' THEN c.venue_id = p_subject_id
                ELSE c.organizer_user_id::text = p_subject_id END
  ),
  sent AS (
    SELECT count(*) AS n FROM public.email_campaign_recipients r
     WHERE r.campaign_id IN (SELECT id FROM children) AND r.status = 'sent' AND r.sent_at >= v_from
  ),
  scoped_events AS (
    SELECT e.id FROM public.events e
     WHERE CASE WHEN p_subject_type = 'venue'
                THEN (e.venue_id = p_subject_id OR e.partner_venue_id = p_subject_id)
                ELSE (e.organizer_user_id::text = p_subject_id OR e.partner_organizer_id::text = p_subject_id)
           END
  ),
  clicks AS (
    SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS click_at
      FROM public.email_campaign_events ev
     WHERE ev.campaign_id IN (SELECT id FROM children)
       AND ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
       AND ev.created_at >= v_from - interval '72 hours'
     GROUP BY lower(ev.recipient_email)
  ),
  sales AS (
    SELECT 'ticket:' || t.id::text AS sale_key, lower(t.user_email) AS em, t.created_at,
           (t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0)
              - coalesce(t.refund_amount, 0) - (t.total_price * 0.015 + 0.25)) AS net
      FROM public.tickets t
     WHERE t.event_id IN (SELECT id FROM scoped_events) AND t.status = 'paid' AND t.user_email IS NOT NULL
       AND t.created_at >= v_from
    UNION ALL
    SELECT 'table:' || r.id::text, lower(r.user_email), r.created_at,
           (r.total_price - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0)
              - coalesce(r.refund_amount, 0) - (r.total_price * 0.015 + 0.25))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT id FROM scoped_events) AND r.status = 'paid' AND r.user_email IS NOT NULL
       AND r.created_at >= v_from
    UNION ALL
    SELECT 'order:' || o.id::text, lower(o.user_email), o.created_at,
           (o.total - coalesce(o.service_fee, 0) - coalesce(o.refund_amount, 0) - (o.total * 0.015 + 0.25))
      FROM public.orders o
     WHERE o.status IN ('paid', 'served') AND o.user_email IS NOT NULL AND o.created_at >= v_from
       AND CASE WHEN p_subject_type = 'venue' THEN o.venue_id = p_subject_id
                ELSE o.event_id IN (SELECT id FROM scoped_events) END
  ),
  attributed AS (
    SELECT DISTINCT s.sale_key, s.net
      FROM clicks c JOIN sales s ON s.em = c.em
       AND s.created_at >= c.click_at AND s.created_at < c.click_at + interval '72 hours'
  )
  SELECT jsonb_build_object(
    'emails', (SELECT n FROM sent),
    'sales', (SELECT count(*) FROM attributed),
    'revenue', round(COALESCE((SELECT sum(net) FROM attributed), 0)::numeric, 0)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.email_automation_weekly_digest(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_automation_weekly_digest(text, text) TO service_role;
