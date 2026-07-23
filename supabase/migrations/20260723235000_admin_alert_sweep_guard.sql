-- ─────────────────────────────────────────────────────────────────────────────
-- Durcissement du balayage d'alertes super admin.
--
-- `run_admin_alert_sweep()` était exécutable par tout compte authentifié : elle
-- ne lit rien de sensible, mais elle ÉCRIT dans l'inbox admin. Un utilisateur
-- lambda pouvait donc la déclencher en boucle.
--
-- La garde ne peut pas être un `is_super_admin()` sec : sous pg_cron il n'y a
-- pas de JWT, donc pas d'email, et la fonction renverrait NULL. On discrimine
-- sur la présence d'une session utilisateur — pas de session (cron, service
-- role) : on laisse passer ; session présente : il faut être super admin.
--
-- Même correctif de forme sur les RPC du registre : `NOT is_super_admin()` vaut
-- NULL sans JWT, ce qui ne déclenche pas le RAISE. Aucun rôle sans JWT n'a le
-- droit d'exécution aujourd'hui, mais l'intention doit être lisible dans le
-- code plutôt que déduite de la table des GRANT.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assert_admin_or_backend()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.assert_admin_or_backend() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assert_admin_or_backend() TO authenticated;

-- ── Garde du balayage ────────────────────────────────────────────────────────
-- Le corps de la fonction est inchangé : on ne fait qu'insérer la garde en
-- tête, via un wrapper qui délègue au balayage existant renommé.
CREATE OR REPLACE FUNCTION public.run_admin_alert_sweep()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  RETURN jsonb_build_object('emitted', v_emitted, 'undated_deadlines', v_undated);
END;
$fn$;

-- ── Gardes explicites sur les RPC du registre ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_credential_renewed(
  p_key     TEXT,
  p_done_on DATE DEFAULT NULL
)
RETURNS public.admin_credential_deadlines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_done DATE := COALESCE(p_done_on, CURRENT_DATE);
  v_row  public.admin_credential_deadlines;
BEGIN
  IF public.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_credential_deadlines
     SET last_rotated_at = v_done,
         due_at          = (v_done + (interval_months || ' months')::interval)::date,
         updated_at      = now()
   WHERE key = p_key
  RETURNING * INTO v_row;

  IF v_row.key IS NULL THEN
    RAISE EXCEPTION 'unknown_deadline_key' USING ERRCODE = '22023';
  END IF;

  UPDATE public.admin_notifications
     SET read_at = COALESCE(read_at, now()),
         read_by = COALESCE(read_by, auth.uid())
   WHERE reference_type = 'credential_deadline'
     AND reference_id   = p_key
     AND read_at IS NULL;

  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_credential_due(
  p_key TEXT,
  p_due DATE
)
RETURNS public.admin_credential_deadlines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.admin_credential_deadlines;
BEGIN
  IF public.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_credential_deadlines
     SET due_at     = p_due,
         updated_at = now()
   WHERE key = p_key
  RETURNING * INTO v_row;

  IF v_row.key IS NULL THEN
    RAISE EXCEPTION 'unknown_deadline_key' USING ERRCODE = '22023';
  END IF;

  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_upsert_credential_deadline(
  p_key             TEXT,
  p_label           TEXT,
  p_provider        TEXT,
  p_interval_months INT,
  p_severity        TEXT    DEFAULT 'high',
  p_description     TEXT    DEFAULT NULL,
  p_console_url     TEXT    DEFAULT NULL,
  p_due_at          DATE    DEFAULT NULL,
  p_remind_days     INT[]   DEFAULT NULL,
  p_notes           TEXT    DEFAULT NULL,
  p_is_active       BOOLEAN DEFAULT NULL
)
RETURNS public.admin_credential_deadlines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.admin_credential_deadlines;
BEGIN
  IF public.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.admin_credential_deadlines AS d (
    key, label, provider, description, console_url,
    interval_months, severity, due_at, remind_days, notes, is_active, is_builtin
  ) VALUES (
    p_key, p_label, p_provider, p_description, p_console_url,
    p_interval_months, p_severity, p_due_at,
    COALESCE(p_remind_days, ARRAY[30, 14, 7, 2, 1]),
    p_notes, COALESCE(p_is_active, true), false
  )
  ON CONFLICT (key) DO UPDATE SET
    label           = CASE WHEN d.is_builtin THEN d.label       ELSE EXCLUDED.label       END,
    provider        = CASE WHEN d.is_builtin THEN d.provider    ELSE EXCLUDED.provider    END,
    description     = CASE WHEN d.is_builtin THEN d.description ELSE EXCLUDED.description END,
    console_url     = CASE WHEN d.is_builtin THEN d.console_url ELSE EXCLUDED.console_url END,
    interval_months = EXCLUDED.interval_months,
    severity        = EXCLUDED.severity,
    due_at          = COALESCE(p_due_at, d.due_at),
    remind_days     = COALESCE(p_remind_days, d.remind_days),
    notes           = COALESCE(p_notes, d.notes),
    is_active       = COALESCE(p_is_active, d.is_active),
    updated_at      = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_delete_credential_deadline(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted INT;
BEGIN
  IF public.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.admin_credential_deadlines
   WHERE key = p_key AND is_builtin = false;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$fn$;

-- Premier balayage : il pose l'alerte « N échéances à dater » pour que la page
-- ne s'ouvre pas sur un flux vide, et vérifie la chaîne registre → émission.
SELECT public.run_admin_alert_sweep();
