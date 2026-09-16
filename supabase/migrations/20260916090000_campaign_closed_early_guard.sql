-- ============================================================================
-- Une campagne « envoyée » avec des destinataires en attente (2026-09-16)
--
-- Le 10/09 à 11:10 UTC, « Invitation soirée La nuit 11/09 » (WOH, 9 597
-- destinataires) est passée `sent` avec 2 366 lignes `pending` jamais
-- réclamées. Cause : la clôture de `drainSlice` et le sweeper lisaient le
-- comptage des restants sans regarder l'erreur et prenaient un count null
-- pour une file vide (corrigé côté edge dans le même commit).
--
-- Ici, deux choses :
--   1. La file fantôme de cette campagne est fermée proprement : les 2 366
--      lignes passent `skipped` avec une raison explicite. La soirée est
--      passée, on ne renvoie pas une invitation périmée ; et le rapport de
--      Kevin dit désormais la vérité (rien « en attente »).
--   2. Le balayage d'alertes quotidien (`run_admin_alert_sweep`) émet
--      `admin_campaign_closed_early` dès qu'une campagne marquée envoyée
--      depuis moins de 30 jours garde des destinataires en attente — dedup
--      par campagne, comme tout émetteur périodique.
-- ============================================================================

-- ── 1. Réparation de la campagne WOH ────────────────────────────────────────
UPDATE public.email_campaign_recipients r
   SET status = 'skipped',
       error_message = 'closed_early: campagne fermée avant l''envoi (soirée passée, non renvoyé)'
 WHERE r.campaign_id = '42c3f105-9605-4f3b-80d2-8c635b05902a'
   AND r.status = 'pending'
   AND r.attempts = 0;

-- ── 2. L'alerte dans le balayage quotidien ──────────────────────────────────
-- Corps LIVE de run_admin_alert_sweep + le bloc « campagne fermée trop tôt »
-- juste avant le RETURN.
CREATE OR REPLACE FUNCTION public.run_admin_alert_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r            RECORD;
  v_days       INT;
  v_priority   TEXT;
  v_emitted    INT := 0;
  v_undated    INT;
  v_refunds    INT;
  v_refund_sum NUMERIC;
  v_stuck      INT;
BEGIN
  PERFORM public.assert_admin_or_backend();

  -- ── Échéances datées ──────────────────────────────────────────────────────
  FOR r IN
    SELECT * FROM public.admin_credential_deadlines
     WHERE is_active AND due_at IS NOT NULL
  LOOP
    v_days := r.due_at - CURRENT_DATE;

    IF v_days < 0 THEN
      PERFORM public.emit_admin_notification(
        'admin_credential_overdue',
        'Échéance dépassée : ' || r.label,
        r.label || ' (' || r.provider || ') a expiré il y a ' || (-v_days) || ' jour(s). ' ||
          COALESCE(r.description, ''),
        'urgent', 'credential_deadline', r.key,
        jsonb_build_object('key', r.key, 'due_at', r.due_at, 'days', v_days,
                           'provider', r.provider, 'console_url', r.console_url),
        'cred_overdue:' || r.key || ':' ||
          CASE WHEN r.severity = 'critical'
               THEN to_char(CURRENT_DATE, 'YYYY-MM-DD')
               ELSE to_char(CURRENT_DATE, 'IYYY-"W"IW') END
      );
      v_emitted := v_emitted + 1;

    ELSIF v_days = ANY (r.remind_days) THEN
      v_priority := CASE
        WHEN v_days <= 2 THEN 'urgent'
        WHEN v_days <= 7 THEN 'high'
        WHEN r.severity = 'critical' THEN 'high'
        ELSE 'normal'
      END;

      PERFORM public.emit_admin_notification(
        CASE WHEN v_days <= 2 THEN 'admin_credential_urgent' ELSE 'admin_credential_due' END,
        'À renouveler dans ' || v_days || ' jour(s) : ' || r.label,
        r.label || ' (' || r.provider || ') arrive à échéance le ' ||
          to_char(r.due_at, 'DD/MM/YYYY') || '. ' || COALESCE(r.description, ''),
        v_priority, 'credential_deadline', r.key,
        jsonb_build_object('key', r.key, 'due_at', r.due_at, 'days', v_days,
                           'provider', r.provider, 'console_url', r.console_url),
        'cred_due:' || r.key || ':' || r.due_at::text || ':' || v_days::text
      );
      v_emitted := v_emitted + 1;
    END IF;
  END LOOP;

  -- ── Échéances jamais datées ───────────────────────────────────────────────
  SELECT count(*) INTO v_undated
    FROM public.admin_credential_deadlines
   WHERE is_active AND due_at IS NULL;

  IF v_undated > 0 THEN
    PERFORM public.emit_admin_notification(
      'admin_credential_undated',
      v_undated || ' échéance(s) à dater',
      'Ces échéances sont enregistrées mais sans date : elles ne déclencheront aucun rappel tant qu''on ne leur en donne pas une.',
      'high', 'credential_deadline', NULL,
      jsonb_build_object('count', v_undated),
      'cred_undated:' || to_char(CURRENT_DATE, 'IYYY-"W"IW')
    );
    v_emitted := v_emitted + 1;
  END IF;

  -- ── Clubs bloqués sur l'onboarding Stripe ─────────────────────────────────
  FOR r IN
    SELECT v.id, v.name, v.city, v.created_at
      FROM public.venues v
     WHERE v.stripe_onboarding_complete IS NOT TRUE
       AND v.created_at < now() - interval '7 days'
       AND v.created_at > now() - interval '8 days'
  LOOP
    PERFORM public.emit_admin_notification(
      'admin_stripe_onboarding_stuck',
      'Club bloqué sans Stripe Connect',
      r.name || COALESCE(' (' || r.city || ')', '') ||
        ' est inscrit depuis 7 jours sans avoir terminé son onboarding Stripe : il ne peut encaisser ni billet, ni table, ni boisson.',
      'high', 'venue', r.id,
      jsonb_build_object('venue_id', r.id, 'name', r.name, 'created_at', r.created_at),
      'stripe_stuck:' || r.id
    );
    v_emitted := v_emitted + 1;
  END LOOP;

  -- ── Première vente d'un club ──────────────────────────────────────────────
  FOR r IN
    WITH jeunes AS (
      SELECT v.id, v.name
        FROM public.venues v
       WHERE v.created_at > now() - interval '180 days'
         AND NOT EXISTS (
           SELECT 1 FROM public.admin_notifications an
            WHERE an.notification_type = 'admin_venue_first_sale'
              AND an.reference_id = v.id
         )
    ),
    ventes AS (
      SELECT o.venue_id AS vid, min(o.paid_at) AS first_paid
        FROM public.orders o
        JOIN jeunes j ON j.id = o.venue_id
       WHERE o.paid_at IS NOT NULL
       GROUP BY o.venue_id
      UNION ALL
      SELECT e.venue_id, min(tk.paid_at)
        FROM public.tickets tk
        JOIN public.events e ON e.id = tk.event_id
        JOIN jeunes j ON j.id = e.venue_id
       WHERE tk.paid_at IS NOT NULL
       GROUP BY e.venue_id
      UNION ALL
      SELECT e.venue_id, min(tr.paid_at)
        FROM public.table_reservations tr
        JOIN public.events e ON e.id = tr.event_id
        JOIN jeunes j ON j.id = e.venue_id
       WHERE tr.paid_at IS NOT NULL
       GROUP BY e.venue_id
    )
    SELECT j.id, j.name, min(v.first_paid) AS first_paid
      FROM jeunes j
      JOIN ventes v ON v.vid = j.id
     GROUP BY j.id, j.name
    HAVING min(v.first_paid) > now() - interval '48 hours'
  LOOP
    PERFORM public.emit_admin_notification(
      'admin_venue_first_sale',
      'Première vente : ' || r.name,
      r.name || ' vient d''encaisser sa toute première vente sur Yuno. Le club est activé.',
      'normal', 'venue', r.id,
      jsonb_build_object('venue_id', r.id, 'name', r.name, 'first_paid_at', r.first_paid),
      'first_sale:' || r.id
    );
    v_emitted := v_emitted + 1;
  END LOOP;

  -- ── Pic de remboursements plateforme ──────────────────────────────────────
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_refunds, v_refund_sum
    FROM (
      SELECT COALESCE(refund_amount, 0) AS amount FROM public.orders
       WHERE refunded_at > now() - interval '24 hours'
      UNION ALL
      SELECT COALESCE(refund_amount, 0) FROM public.tickets
       WHERE refunded_at > now() - interval '24 hours'
      UNION ALL
      SELECT COALESCE(refund_amount, 0) FROM public.table_reservations
       WHERE refunded_at > now() - interval '24 hours'
    ) x;

  IF v_refunds >= 10 OR v_refund_sum >= 500 THEN
    PERFORM public.emit_admin_notification(
      'admin_refund_spike',
      'Pic de remboursements',
      v_refunds || ' remboursements en 24 h pour ' ||
        to_char(v_refund_sum, 'FM999999990.00') || ' €. Un club a peut-être annulé une soirée.',
      'high', 'refunds', NULL,
      jsonb_build_object('count', v_refunds, 'total', v_refund_sum),
      'refund_spike:' || to_char(CURRENT_DATE, 'YYYY-MM-DD')
    );
    v_emitted := v_emitted + 1;
  END IF;

  -- ── File de push promoteur qui ne se vide pas ─────────────────────────────
  SELECT count(*) INTO v_stuck
    FROM public.promoter_push_queue
   WHERE sent_at IS NULL
     AND not_before < now() - interval '2 hours';

  IF v_stuck > 0 THEN
    PERFORM public.emit_admin_notification(
      'admin_push_queue_stuck',
      'File de push promoteur bloquée',
      v_stuck || ' notification(s) promoteur attendent depuis plus de deux heures. Le cron process-scheduled-campaigns ne vidange plus.',
      'urgent', 'push_queue', NULL,
      jsonb_build_object('pending', v_stuck),
      'push_stuck:' || to_char(CURRENT_DATE, 'YYYY-MM-DD')
    );
    v_emitted := v_emitted + 1;
  END IF;

  -- ── Campagne « envoyée » avec des destinataires en attente ───────────────
  -- Une file qui reste après la clôture, c'est des gens jamais servis sans
  -- que personne ne le sache (WOH, 10/09 : 2 366 sur 9 597).
  FOR r IN
    SELECT c.id, c.name, c.venue_id, c.organizer_user_id, c.sent_at,
           count(x.id) AS stuck
      FROM public.email_campaigns c
      JOIN public.email_campaign_recipients x ON x.campaign_id = c.id AND x.status IN ('pending', 'sending')
     WHERE c.status = 'sent' AND c.sent_at > now() - interval '30 days'
     GROUP BY c.id, c.name, c.venue_id, c.organizer_user_id, c.sent_at
  LOOP
    PERFORM public.emit_admin_notification(
      'admin_campaign_closed_early',
      'Campagne fermée avec des destinataires en attente',
      '« ' || r.name || ' » est marquée envoyée depuis le ' || to_char(r.sent_at, 'DD/MM HH24:MI') ||
        ' mais ' || r.stuck || ' destinataire(s) n''ont jamais été servis. Vérifier send-campaign / le sweeper.',
      'high', 'email_campaign', r.id::text,
      jsonb_build_object('campaign_id', r.id, 'stuck', r.stuck, 'venue_id', r.venue_id,
                         'organizer_user_id', r.organizer_user_id),
      'closed_early:' || r.id
    );
    v_emitted := v_emitted + 1;
  END LOOP;

  RETURN jsonb_build_object('emitted', v_emitted, 'undated_deadlines', v_undated);
END;
$function$;
