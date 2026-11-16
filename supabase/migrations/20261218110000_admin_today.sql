-- Admin unique, lot 1 : la rubrique « Aujourd'hui » (docs/designs/ADMIN_REBUILD_PLAN.md).
--
-- UNE file de ce qui demande une décision du super admin, assemblée depuis
-- les sources qui existent déjà (rien n'est recalculé autrement) :
--
--   famille     source                                              où agir
--   signup      admin_pro_signups(60) : personnes bloquées ou       /admin/pilot/signups
--               en demande, joignables, jamais contactées ;
--               compte ouvert qui redonne ses coordonnées
--   lead        links_pro_leads non contactés                       /admin/comms/links
--   prospect    crm_prospects dont la prochaine action est due      /admin/pros/sales
--   trial       _crm_admin_rows : essai CRM qui finit sous 3 jours  /admin/pros/crm?open=
--   sync        _crm_admin_rows : synchro billetterie en échec      idem
--   billing     _crm_admin_rows : paiement CRM en retard            idem
--   frozen      _crm_admin_rows : envois gelés                      idem
--   silent      _crm_admin_rows : compte payant muet depuis 30 j    idem
--   yunits      _crm_admin_rows : solde < 500 Yunits                idem
--   deletion    _crm_admin_rows : suppression de compte demandée    idem
--   moderation  soirées À VENIR en attente de modération            /admin/clients/events
--   feedback    feedback_issues ouvertes (support compris)          /admin/today/feedback
--   transfer    admin_coorg_transfer_issues : litige ou retard      /admin/today/alerts
--   alert       admin_notifications non lues, priorité urgente      lien de l'alerte
--               ou haute, hors types déjà couverts ci-dessus
--   deadline    admin_credential_deadlines échues, sous 30 j,       /admin/legal/deadlines
--               ou sans date
--   support     admin_support_grants en attente                     /admin/pros/support
--   claim       showcase_claim_requests en attente                  /admin/pros/demo
--   incident    crm_incidents ouverts, CNIL pas prévenue (72 h)     /admin/legal
--
-- Une chose n'apparaît qu'une fois (clé stable par famille). Une ligne dont
-- la cause a disparu sort seule : la file est relue à chaque appel. La clé
-- porte la version de la cause quand elle peut revenir (date de l'erreur de
-- synchro, date de fin d'essai…) : « Traité » ne masque pas la prochaine.
--
-- Urgence : 1 = maintenant, 2 = cette semaine, 3 = quand possible.
--
-- Six chiffres de la semaine (p_with_kpis), sept derniers jours contre les
-- sept d'avant. Ventes de la plateforme : lues dans admin_cockpit (front).
-- Ici, ceux qui n'existaient pas tels quels :
--   revenue  Commissions Yuno : frais de service + assurance (billets), frais
--            de service + frais de gestion (tables), frais de service
--            (commandes) des ventes payées ; formule d'admin_cockpit.
--   mrr      MRR Yuno CRM = somme des `mrr` de _crm_admin_rows ; la semaine
--            d'avant = abonnements payants déjà souscrits il y a 7 jours
--            (pas d'historique des résiliations : approximation, comme
--            l'Admin CRM).
--   new_pros Nouveaux pros = clubs, organisations (hors vitrines) et agences
--            créés pendant la semaine, démo exclue.
--   active   Pros actifs = clubs et organisations dont une soirée a eu une
--            vente payée ou une inscription guest list pendant la semaine,
--            ou qui ont envoyé une campagne e-mail.
--   buyers   Acheteurs = adresses e-mail distinctes qui ont payé un billet ou
--            une table pendant la semaine (guest list exclue).
--
-- STABLE, sans table temporaire, sans lecture de cron.job_run_details.

-- ── Marques « traité / plus tard » ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_today_marks (
  key        text PRIMARY KEY CHECK (length(key) BETWEEN 3 AND 300),
  status     text NOT NULL CHECK (status IN ('done', 'snoozed')),
  until      timestamptz,
  reason     text CHECK (reason IS NULL OR length(reason) <= 500),
  marked_by  uuid,
  marked_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_today_marks ENABLE ROW LEVEL SECURITY;
-- Aucune policy : tout passe par admin_today / admin_today_mark.
REVOKE ALL ON public.admin_today_marks FROM PUBLIC, anon, authenticated;

-- ── La file ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_today(p_include_demo boolean DEFAULT false, p_with_kpis boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows    jsonb;
  v_signups jsonb;
  v_items   jsonb;
  v_kpis    jsonb := NULL;
  v_7d      timestamptz := now() - interval '7 days';
  v_14d     timestamptz := now() - interval '14 days';
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_rows    := COALESCE(public._crm_admin_rows(p_include_demo), '[]'::jsonb);
  v_signups := COALESCE(public.admin_pro_signups(60, p_include_demo) -> 'people', '[]'::jsonb);

  WITH d AS MATERIALIZED (
    SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv,
           CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
  ),
  crm AS MATERIALIZED (
    SELECT r FROM jsonb_array_elements(v_rows) r
     WHERE (p_include_demo OR NOT COALESCE((r->>'is_demo')::boolean, false))
       AND r->>'state' IS DISTINCT FROM 'churned'
  ),
  raw AS (
    -- Pros à rappeler (personnes, pas parcours).
    SELECT 'signup'::text AS family,
           CASE WHEN COALESCE((p->>'retries_after_account')::int, 0) > 0 THEN 'signup_cant_login'
                WHEN p->>'outcome' = 'request' THEN 'signup_request' ELSE 'signup_blocked' END AS kind,
           'signup:' || (p->>'key') AS key,
           COALESCE(NULLIF(p->>'org_name', ''), NULLIF(trim(concat_ws(' ', p->>'first_name', p->>'last_name')), ''), p->>'email') AS name,
           'signup'::text AS subject_kind, p->>'key' AS subject_id,
           concat_ws(' · ', NULLIF(trim(concat_ws(' ', p->>'first_name', p->>'last_name')), ''), p->>'city', p->>'email') AS detail,
           (p->>'last_at')::timestamptz AS at, NULL::timestamptz AS due_at,
           CASE WHEN COALESCE((p->>'retries_after_account')::int, 0) > 0 THEN 1
                WHEN (p->>'last_at')::timestamptz > now() - interval '48 hours' THEN 1 ELSE 2 END AS urgency,
           '/admin/pilot/signups'::text AS href,
           jsonb_build_object('step', p->>'furthest_step', 'kind', p->>'kind') AS params
      FROM jsonb_array_elements(v_signups) p
     WHERE (p->>'contacted_at') IS NULL
       AND ((p->>'outcome' IN ('blocked', 'request')
             AND ((p->>'email') IS NOT NULL OR jsonb_array_length(COALESCE(p->'phones', '[]'::jsonb)) > 0))
         OR COALESCE((p->>'retries_after_account')::int, 0) > 0)

    UNION ALL
    -- Demandes de la page Links jamais contactées.
    SELECT 'lead', 'lead', 'lead:' || l.id,
           COALESCE(NULLIF(l.org_name, ''), NULLIF(l.name, ''), l.email), 'lead', l.id::text,
           concat_ws(' · ', NULLIF(l.name, ''), l.city, l.org_type), l.created_at, NULL,
           CASE WHEN l.created_at > now() - interval '7 days' THEN 2 ELSE 3 END,
           '/admin/comms/links', '{}'::jsonb
      FROM public.links_pro_leads l
     WHERE l.contacted_at IS NULL
       AND (p_include_demo OR l.email IS NULL OR NOT public.is_demo_email(l.email))

    UNION ALL
    -- Prospects CRM dont la prochaine action est due.
    SELECT 'prospect', 'prospect', 'prospect:' || pr.id || ':' || pr.next_at,
           pr.name, 'prospect', pr.id::text, concat_ws(' · ', pr.next_action, pr.contact, pr.city),
           pr.stage_changed_at, pr.next_at::timestamptz,
           CASE WHEN pr.next_at < CURRENT_DATE THEN 1 ELSE 2 END,
           '/admin/pros/sales', jsonb_build_object('stage', pr.stage)
      FROM public.crm_prospects pr
     WHERE pr.next_at IS NOT NULL AND pr.next_at <= CURRENT_DATE
       AND NOT COALESCE(pr.opposed, false)
       AND pr.stage IS DISTINCT FROM 'lost'

    UNION ALL
    -- Comptes Yuno CRM (ligne unique de l'Admin CRM).
    SELECT 'trial',
           CASE WHEN r->>'sync' = 'none' THEN 'trial_no_conn' ELSE 'trial_ending' END,
           'trial:' || (r->>'id') || ':' || ((r->>'trial_ends_at')::timestamptz)::date,
           r->>'name', 'crm', r->>'id', concat_ws(' · ', r->>'contact', r->>'city'),
           (r->>'signup_at')::timestamptz, (r->>'trial_ends_at')::timestamptz,
           CASE WHEN (r->>'trial_ends_at')::timestamptz <= now() + interval '1 day' OR r->>'sync' = 'none' THEN 1 ELSE 2 END,
           '/admin/pros/crm?open=' || (r->>'id'), jsonb_build_object('days', r->>'trial_left')
      FROM crm
     WHERE r->>'state' = 'trial'
       AND (r->>'trial_ends_at')::timestamptz > now()
       AND (r->>'trial_ends_at')::timestamptz <= now() + interval '3 days'
    UNION ALL
    SELECT 'sync', 'sync_error', 'sync:' || (r->>'id') || ':' || COALESCE(r->>'sync_error_at', ''),
           r->>'name', 'crm', r->>'id', left(r->>'sync_error', 200),
           (r->>'sync_error_at')::timestamptz, NULL, 1,
           '/admin/pros/crm?open=' || (r->>'id'), jsonb_build_object('provider', r->>'provider')
      FROM crm WHERE r->>'sync' = 'error'
    UNION ALL
    SELECT 'billing', 'billing_late', 'billing:' || (r->>'id') || ':' || COALESCE(r->>'period_end', ''),
           r->>'name', 'crm', r->>'id', concat_ws(' · ', r->>'contact', r->>'email'),
           (r->>'period_end')::timestamptz, NULL, 1,
           '/admin/pros/crm?open=' || (r->>'id'), '{}'::jsonb
      FROM crm WHERE r->>'state' = 'late'
    UNION ALL
    SELECT 'frozen', 'frozen', 'frozen:' || (r->>'id') || ':' || (r->>'frozen_at'),
           r->>'name', 'crm', r->>'id', left(r->>'frozen_reason', 200),
           (r->>'frozen_at')::timestamptz, NULL, 3,
           '/admin/pros/crm?open=' || (r->>'id'), '{}'::jsonb
      FROM crm WHERE r->>'frozen_at' IS NOT NULL
    UNION ALL
    SELECT 'silent', 'silent_paid', 'silent:' || (r->>'id') || ':' || COALESCE(left(r->>'last_send_at', 10), 'never'),
           r->>'name', 'crm', r->>'id', concat_ws(' · ', r->>'contact', r->>'email'),
           (r->>'last_send_at')::timestamptz, NULL, 2,
           '/admin/pros/crm?open=' || (r->>'id'),
           jsonb_build_object('days', CASE WHEN r->>'last_send_at' IS NOT NULL
             THEN floor(extract(epoch FROM now() - (r->>'last_send_at')::timestamptz) / 86400)::int END)
      FROM crm
     WHERE r->>'state' = 'paid'
       AND CASE WHEN r->>'last_send_at' IS NULL
                THEN (r->>'signup_at')::timestamptz < now() - interval '14 days'
                ELSE (r->>'last_send_at')::timestamptz < now() - interval '30 days' END
    UNION ALL
    SELECT 'yunits', 'yunits_low', 'yunits:' || (r->>'id') || ':' || to_char(now(), 'IYYY-IW'),
           r->>'name', 'crm', r->>'id', NULL, NULL, NULL, 3,
           '/admin/pros/crm?open=' || (r->>'id'), jsonb_build_object('balance', r->>'balance')
      FROM crm
     WHERE r->>'state' IN ('paid', 'trial') AND COALESCE((r->>'balance')::numeric, 0) < 500
    UNION ALL
    SELECT 'deletion', 'deletion', 'deletion:' || (r->>'id') || ':' || (r->>'deletion_requested_at'),
           r->>'name', 'crm', r->>'id', concat_ws(' · ', r->>'contact', r->>'email'),
           (r->>'deletion_requested_at')::timestamptz,
           (r->>'deletion_requested_at')::timestamptz + interval '30 days', 2,
           '/admin/pros/crm?open=' || (r->>'id'), '{}'::jsonb
      FROM crm WHERE r->>'deletion_requested_at' IS NOT NULL

    UNION ALL
    -- Soirées à venir en attente de modération.
    SELECT 'moderation', 'moderation', 'moderation:' || e.id,
           e.title, 'event', e.id::text,
           concat_ws(' · ', COALESCE(v.name, e.location_name), COALESCE(v.city, e.location_city)),
           COALESCE(e.published_at, e.created_at), e.start_at,
           CASE WHEN e.start_at < now() + interval '3 days' THEN 1 ELSE 2 END,
           '/admin/clients/events?q=' || replace(COALESCE(e.title, ''), ' ', '%20'), '{}'::jsonb
      FROM public.events e CROSS JOIN d
      LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
     WHERE e.discovery_status::text = 'pending'
       AND COALESCE(e.end_at, e.start_at + interval '8 hours') >= now()
       AND e.cancelled_at IS NULL
       AND NOT COALESCE(e.id = ANY (d.de), false)

    UNION ALL
    -- Retours et demandes de support ouverts.
    SELECT 'feedback', 'feedback',
           'feedback:' || f.id, f.title, 'venue', f.venue_id, left(f.description, 200),
           f.created_at, NULL,
           CASE WHEN f.priority IN ('urgent', 'critical', 'high') THEN 1 WHEN f.priority = 'low' THEN 3 ELSE 2 END,
           '/admin/today/feedback?id=' || f.id, jsonb_build_object('priority', f.priority, 'status', f.status, 'category', f.category)
      FROM public.feedback_issues f CROSS JOIN d
     WHERE f.status IN ('open', 'in_progress')
       AND NOT COALESCE(f.venue_id = ANY (d.dv), false)

    UNION ALL
    -- Virements entre parties en litige ou en retard.
    SELECT 'transfer', CASE WHEN t->>'status' = 'disputed' THEN 'transfer_disputed' ELSE 'transfer_late' END,
           'transfer:' || (t->>'id') || ':' || (t->>'status'),
           t->>'event_title', 'event', t->>'event_id',
           concat_ws(' → ', t->>'from_name', t->>'to_name'),
           COALESCE((t->>'disputed_at')::timestamptz, (t->>'due_at')::timestamptz), (t->>'due_at')::timestamptz,
           CASE WHEN t->>'status' = 'disputed' THEN 1 ELSE 2 END,
           '/admin/today/alerts',
           jsonb_build_object('amount', t->'amount', 'days', t->'days_late')
      FROM jsonb_array_elements(public.admin_coorg_transfer_issues()) t CROSS JOIN d
     WHERE NOT COALESCE((t->>'event_id')::uuid = ANY (d.de), false)

    UNION ALL
    -- Alertes plateforme urgentes non lues (hors familles déjà couvertes).
    SELECT 'alert', 'alert', 'alert:' || n.id, n.title, NULL, n.reference_id, left(n.message, 240),
           n.created_at, NULL, CASE WHEN n.priority = 'urgent' THEN 1 ELSE 2 END,
           '/admin/today/alerts',
           jsonb_build_object('type', n.notification_type, 'reference_id', n.reference_id,
                              'reference_type', n.reference_type, 'event_id', n.event_id, 'metadata', n.metadata)
      FROM public.admin_notifications n
     WHERE n.read_at IS NULL AND n.scope = 'platform'
       AND n.priority IN ('urgent', 'high')
       AND n.notification_type NOT LIKE 'admin\_pro\_signup%'
       AND n.notification_type NOT LIKE 'admin\_credential\_%'
       AND n.notification_type NOT LIKE 'admin\_coorg\_transfer%'
       AND n.notification_type NOT IN ('admin_pro_lead', 'admin_links_pro_lead', 'admin_crm_incident_deadline')

    UNION ALL
    -- Échéances (secrets, certificats) échues, proches, ou sans date.
    SELECT 'deadline', CASE WHEN cd.due_at IS NULL THEN 'deadline_undated'
                            WHEN cd.due_at < CURRENT_DATE THEN 'deadline_overdue' ELSE 'deadline_soon' END,
           'deadline:' || cd.key || ':' || COALESCE(cd.due_at::text, 'none'),
           cd.label, 'deadline', cd.key, cd.provider, NULL, cd.due_at::timestamptz,
           CASE WHEN cd.due_at IS NULL THEN 3 WHEN cd.due_at <= CURRENT_DATE + 7 THEN 1 ELSE 2 END,
           '/admin/legal/deadlines', jsonb_build_object('days', cd.due_at - CURRENT_DATE)
      FROM public.admin_credential_deadlines cd
     WHERE cd.is_active AND (cd.due_at IS NULL OR cd.due_at <= CURRENT_DATE + 30)

    UNION ALL
    -- Accès assisté demandé, pas encore accordé par le pro.
    SELECT 'support', 'support_pending', 'support:' || g.id,
           COALESCE(NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.email),
           'person', g.target_user_id::text, left(g.reason, 200), g.created_at, NULL,
           CASE WHEN g.created_at < now() - interval '3 days' THEN 2 ELSE 3 END,
           '/admin/pros/support', '{}'::jsonb
      FROM public.admin_support_grants g
      LEFT JOIN public.profiles pr ON pr.id = g.target_user_id
     WHERE g.status = 'pending'
       AND (p_include_demo OR pr.email IS NULL OR NOT public.is_demo_email(pr.email))

    UNION ALL
    -- Réclamations d'une page vitrine.
    SELECT 'claim', 'claim', 'claim:' || c.id, COALESCE(v.name, c.requested_email),
           'venue', c.venue_id, c.requested_email, c.created_at, NULL, 2,
           '/admin/pros/demo', '{}'::jsonb
      FROM public.showcase_claim_requests c
      LEFT JOIN public.venues v ON v.id = c.venue_id
     WHERE c.status = 'pending'
       AND (p_include_demo OR NOT public.is_demo_email(c.requested_email))

    UNION ALL
    -- Incidents de données ouverts : la CNIL se prévient sous 72 h.
    SELECT 'incident', 'incident', 'incident:' || i.id, left(i.nature, 120), 'incident', i.id::text,
           left(i.measures, 200), i.discovered_at, i.discovered_at + interval '72 hours',
           CASE WHEN i.discovered_at + interval '72 hours' <= now() + interval '24 hours' THEN 1 ELSE 2 END,
           '/admin/legal', jsonb_build_object('accounts', COALESCE(array_length(i.accounts, 1), 0))
      FROM public.crm_incidents i
     WHERE i.closed_at IS NULL AND i.cnil_notified_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'family', r.family, 'kind', r.kind, 'key', r.key, 'name', r.name,
           'subject_kind', r.subject_kind, 'subject_id', r.subject_id, 'detail', NULLIF(r.detail, ''),
           'at', r.at, 'due_at', r.due_at, 'urgency', r.urgency, 'href', r.href, 'params', r.params,
           'mark', CASE WHEN m.key IS NOT NULL AND (m.status = 'done' OR m.until > now())
                        THEN jsonb_build_object('status', m.status, 'until', m.until, 'at', m.marked_at, 'reason', m.reason) END
         ) ORDER BY r.urgency, r.due_at NULLS LAST, r.at DESC NULLS LAST), '[]'::jsonb)
    INTO v_items
    FROM (SELECT DISTINCT ON (raw.key) raw.* FROM raw ORDER BY raw.key, raw.urgency) r
    LEFT JOIN public.admin_today_marks m ON m.key = r.key;

  IF p_with_kpis THEN
    WITH d AS MATERIALIZED (
      SELECT CASE WHEN p_include_demo THEN '{}'::text[] ELSE public.demo_venue_ids() END AS dv,
             CASE WHEN p_include_demo THEN '{}'::uuid[] ELSE public.demo_event_ids() END AS de
    ),
    -- Mêmes définitions qu'admin_cockpit (bloc `act`), restreintes à 14 jours.
    act AS (
      SELECT t.created_at, t.event_id, lower(t.user_email) AS em, true AS paid,
             COALESCE(t.service_fee, 0)::numeric + COALESCE(t.insurance_fee, 0)::numeric AS yuno
        FROM public.tickets t CROSS JOIN d
       WHERE t.created_at >= v_14d AND t.paid_at IS NOT NULL AND t.status IN ('paid', 'used')
         AND NOT COALESCE(t.event_id = ANY (d.de), false)
         AND (p_include_demo OR NOT public.is_demo_email(t.user_email))
      UNION ALL
      SELECT tr.created_at, tr.event_id, lower(tr.user_email), true,
             COALESCE(tr.service_fee, 0)::numeric + COALESCE(tr.management_fee, 0)::numeric
        FROM public.table_reservations tr CROSS JOIN d
       WHERE tr.created_at >= v_14d AND tr.status IN ('paid', 'confirmed')
         AND NOT COALESCE(tr.event_id = ANY (d.de), false)
         AND (p_include_demo OR NOT public.is_demo_email(tr.user_email))
      UNION ALL
      SELECT o.created_at, o.event_id, NULL, false, COALESCE(o.service_fee, 0)::numeric
        FROM public.orders o CROSS JOIN d
       WHERE o.created_at >= v_14d AND o.status IN ('paid', 'served')
         AND NOT COALESCE(o.venue_id = ANY (d.dv), false)
         AND (p_include_demo OR NOT public.is_demo_email(o.user_email))
      UNION ALL
      SELECT ge.created_at, gl.event_id, NULL, false, 0
        FROM public.guest_list_entries ge
        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
       CROSS JOIN d
       WHERE ge.created_at >= v_14d AND ge.status IS DISTINCT FROM 'cancelled'
         AND NOT COALESCE(gl.event_id = ANY (d.de), false)
         AND (p_include_demo OR NOT public.is_demo_email(ge.email))
    ),
    pro_act AS (
      SELECT a.created_at AS at, 'v:' || e.venue_id AS pro
        FROM act a JOIN public.events e ON e.id = a.event_id WHERE e.venue_id IS NOT NULL
      UNION ALL
      SELECT a.created_at, 'o:' || e.organizer_user_id
        FROM act a JOIN public.events e ON e.id = a.event_id WHERE e.organizer_user_id IS NOT NULL
      UNION ALL
      SELECT c.sent_at, COALESCE('v:' || c.venue_id, 'o:' || c.organizer_user_id)
        FROM public.email_campaigns c CROSS JOIN d
       WHERE c.sent_at >= v_14d AND c.status IN ('sent', 'sending')
         AND (c.venue_id IS NOT NULL OR c.organizer_user_id IS NOT NULL)
         AND NOT COALESCE(c.venue_id = ANY (d.dv), false)
         AND (p_include_demo OR c.organizer_user_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM auth.users u WHERE u.id = c.organizer_user_id AND public.is_demo_email(u.email)))
    ),
    pros_new AS (
      SELECT v.created_at FROM public.venues v CROSS JOIN d
       WHERE v.created_at >= v_14d AND NOT COALESCE(v.id = ANY (d.dv), false)
      UNION ALL
      SELECT op.created_at FROM public.organizer_profiles op
        LEFT JOIN public.profiles pr ON pr.id = op.user_id
       WHERE op.created_at >= v_14d AND NOT COALESCE(op.is_showcase_shadow, false)
         AND (p_include_demo OR NOT public.is_demo_email(pr.email))
      UNION ALL
      SELECT ag.created_at FROM public.agencies ag
        LEFT JOIN public.profiles pr ON pr.id = ag.owner_user_id
       WHERE ag.created_at >= v_14d AND (p_include_demo OR NOT public.is_demo_email(pr.email))
    ),
    crm AS (
      SELECT r FROM jsonb_array_elements(v_rows) r
       WHERE (p_include_demo OR NOT COALESCE((r->>'is_demo')::boolean, false))
    )
    SELECT jsonb_build_object(
      'revenue',  jsonb_build_object('cur', round(COALESCE((SELECT sum(yuno) FROM act WHERE created_at >= v_7d), 0), 2),
                                     'prev', round(COALESCE((SELECT sum(yuno) FROM act WHERE created_at < v_7d), 0), 2)),
      'mrr',      jsonb_build_object('cur', (SELECT COALESCE(sum((r->>'mrr')::numeric), 0) FROM crm),
                                     'prev', (SELECT COALESCE(sum((r->>'mrr')::numeric), 0) FROM crm
                                               WHERE r->>'state' IN ('paid', 'late')
                                                 AND (r->>'sub_created')::timestamptz < v_7d)),
      'new_pros', jsonb_build_object('cur', (SELECT count(*) FROM pros_new WHERE created_at >= v_7d),
                                     'prev', (SELECT count(*) FROM pros_new WHERE created_at < v_7d)),
      'active',   jsonb_build_object('cur', (SELECT count(DISTINCT pro) FROM pro_act WHERE at >= v_7d),
                                     'prev', (SELECT count(DISTINCT pro) FROM pro_act WHERE at < v_7d)),
      'buyers',   jsonb_build_object('cur', (SELECT count(DISTINCT em) FROM act WHERE paid AND em IS NOT NULL AND created_at >= v_7d),
                                     'prev', (SELECT count(DISTINCT em) FROM act WHERE paid AND em IS NOT NULL AND created_at < v_7d))
    ) INTO v_kpis;
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'items', v_items,
    'open_urgent', (SELECT count(*) FROM jsonb_array_elements(v_items) i WHERE (i->>'urgency')::int = 1 AND i->'mark' = 'null'::jsonb),
    'kpis', v_kpis
  );
END
$function$;

REVOKE ALL ON FUNCTION public.admin_today(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_today(boolean, boolean) TO authenticated;

-- ── Traité / plus tard / rouvrir ─────────────────────────────────────────────
-- p_status : 'done' (masquée tant que sa cause reste la même), 'snoozed'
-- (masquée p_days jours, 1 à 30), 'open' (retire la marque). Une alerte
-- marquée traitée est aussi lue. Chaque geste entre au journal d'audit.
CREATE OR REPLACE FUNCTION public.admin_today_mark(p_key text, p_status text, p_days integer DEFAULT 1, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key    text := btrim(COALESCE(p_key, ''));
  v_reason text := NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '');
  v_until  timestamptz;
  v_alert  uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF length(v_key) < 3 OR length(v_key) > 300 THEN
    RAISE EXCEPTION 'invalid_key' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('done', 'snoozed', 'open') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'open' THEN
    DELETE FROM public.admin_today_marks WHERE key = v_key;
  ELSE
    v_until := CASE WHEN p_status = 'snoozed'
                    THEN now() + make_interval(days => greatest(1, least(COALESCE(p_days, 1), 30))) END;
    INSERT INTO public.admin_today_marks (key, status, until, reason, marked_by, marked_at)
    VALUES (v_key, p_status, v_until, v_reason, auth.uid(), now())
    ON CONFLICT (key) DO UPDATE
      SET status = EXCLUDED.status, until = EXCLUDED.until, reason = EXCLUDED.reason,
          marked_by = EXCLUDED.marked_by, marked_at = EXCLUDED.marked_at;

    IF p_status = 'done' AND v_key LIKE 'alert:%' THEN
      BEGIN
        v_alert := substr(v_key, 7)::uuid;
        UPDATE public.admin_notifications SET read_at = now(), read_by = auth.uid()
         WHERE id = v_alert AND read_at IS NULL;
      EXCEPTION WHEN invalid_text_representation THEN NULL;
      END;
    END IF;
  END IF;

  -- Une marque vieille de 90 jours n'a plus de cause à masquer.
  DELETE FROM public.admin_today_marks WHERE marked_at < now() - interval '90 days';

  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'today_' || p_status, 'admin_today', v_key,
          jsonb_build_object('until', v_until, 'reason', v_reason));

  RETURN jsonb_build_object('key', v_key, 'status', p_status, 'until', v_until);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_today_mark(text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_today_mark(text, text, integer, text) TO authenticated;
