-- Yuno CRM : relance après clic, aussi pour « Vos clients » (décision de Paul, 03/11).
-- Une campagne marketing du CRM peut relancer ceux qui ont cliqué sur la page de la
-- soirée sans y prendre de place, qu'ils aient reçu la campagne au titre de leur
-- accord ou au titre de l'exception clients (L34-5 al. 2). Paul a tranché en
-- connaissance du risque signalé le 03/11 (recommandation CNIL 2026-042 : mesure
-- individuelle des clics hors consentement), pour la campagne Act III de 3 AM.
--
--   1. La Console ne distingue plus l'accord de la relation client : l'export, la
--      liste et la fiche ne rendent plus `email_basis` (la différence reste en base).
--   2. `_crm_customer_auto` et la garde acceptent `followup_enabled` sur une campagne
--      « Vos clients », et la campagne ENFANT de relance quand sa mère l'est.
--      Renvoi aux non-ouvreurs, recettes et scénarios restent refusés.
--   3. collect_campaign_followups :
--      - un clic compte aussi sur la page billetterie de la soirée (Shotgun), comparée
--        par _link_base à `events.external_ticket_url` (avant, seuls les liens
--        yunoapp.eu comptaient : aucune relance du CRM ne pouvait partir) ;
--      - CRM : jamais dans les 2 h avant la soirée (`too_late`) ;
--      - client « Vos clients » : seulement si la mère lui a VRAIMENT été envoyée sous
--        base clients, base ouverte, modèle limité aux soirées du compte, personne
--        encore éligible, au plus `max_per_30d` e-mails « clients » sur 30 jours (la
--        relance compte) ; sinon écarté AVEC sa raison. La montée progressive du
--        jour reporte au passage suivant, elle n'écarte personne ;
--      - chaque destinataire de la relance porte sa base légale et le jeton de sa base.
-- Aucun envoi, aucune donnée touchée.

SET lock_timeout = '3s';

-- ── 1. Plus d'étiquette d'accord dans la Console ────────────────────────────
CREATE TEMP TABLE _patch2 (fn text, ord int, old text, new text);
INSERT INTO _patch2 (fn, ord, old, new) VALUES
  ('crm_clients_export__core', 1, $o$, CASE WHEN p.email_ok THEN 'consent' WHEN p.email_cust THEN 'customer' END)$o$, $n$)$n$),
  ('crm_clients_export__core', 2, $o$"source","tags","email_basis"]$o$, $n$"source","tags"]$n$),
  ('crm_clients_list__core', 1, $o$, 'email_basis', CASE WHEN p.email_ok THEN 'consent' WHEN p.email_cust THEN 'customer' END,$o$, $n$,$n$),
  ('crm_client__core', 1, $o$, 'email_basis', CASE WHEN v_p.email_ok THEN 'consent' WHEN v_p.email_cust THEN 'customer' END,$o$, $n$,$n$);

DO $$
DECLARE r record; q record; v_oid oid; v_def text; v_new text;
BEGIN
  FOR r IN SELECT DISTINCT fn FROM _patch2 LOOP
    SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.fn;
    v_def := pg_get_functiondef(v_oid);
    IF position('email_basis' IN v_def) = 0 THEN CONTINUE; END IF;   -- déjà retiré
    v_new := v_def;
    FOR q IN SELECT * FROM _patch2 WHERE fn = r.fn ORDER BY ord LOOP
      IF position(q.old IN v_new) = 0 THEN RAISE EXCEPTION '% : repère introuvable : %', r.fn, q.old; END IF;
      v_new := replace(v_new, q.old, q.new);
    END LOOP;
    EXECUTE v_new;
  END LOOP;
END $$;
DROP TABLE _patch2;

-- ── 2. La relance est admise sur une campagne « Vos clients » ───────────────
CREATE OR REPLACE FUNCTION public._crm_customer_auto(c public.email_campaigns)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_issues jsonb;
BEGIN
  IF c.product IS DISTINCT FROM 'crm' OR COALESCE(c.practical, false) OR c.type IS NOT DISTINCT FROM 'informational'
     OR (c.venue_id IS NULL AND c.organizer_user_id IS NULL) THEN
    RETURN jsonb_build_object('include', false, 'reason', 'scope');
  END IF;
  -- Renvoi aux non-ouvreurs, recettes, scénarios : jamais (lot 5). La relance après
  -- clic oui (20261119120000) ; son enfant suit la base de sa mère.
  IF COALESCE(c.resend_enabled, false) OR c.automation_id IS NOT NULL
     OR (c.child_kind IS NOT NULL AND c.child_kind <> 'followup')
     OR (c.child_kind IS NULL AND c.parent_campaign_id IS NOT NULL)
     OR (c.child_kind = 'followup' AND NOT EXISTS (
           SELECT 1 FROM public.email_campaigns m WHERE m.id = c.parent_campaign_id AND m.legal_basis = 'customer')) THEN
    RETURN jsonb_build_object('include', false, 'reason', 'feature');
  END IF;
  IF NOT public.crm_customer_basis_open(c.venue_id, c.organizer_user_id) THEN
    RETURN jsonb_build_object('include', false, 'reason', 'closed');
  END IF;
  v_issues := public._crm_customer_content_issues(c.blocks_json, c.event_id, c.venue_id, c.organizer_user_id);
  IF jsonb_array_length(v_issues) > 0 THEN
    RETURN jsonb_build_object('include', false, 'reason', 'content', 'issues', v_issues);
  END IF;
  RETURN jsonb_build_object('include', true, 'reason', NULL);
END;
$$;

DO $$
DECLARE
  v_def text; v_new text;
  v_old text := E'  IF COALESCE(NEW.resend_enabled, false) OR COALESCE(NEW.followup_enabled, false)\n     OR NEW.automation_id IS NOT NULL OR NEW.child_kind IS NOT NULL OR NEW.parent_campaign_id IS NOT NULL THEN';
BEGIN
  v_def := pg_get_functiondef('public.guard_crm_customer_basis()'::regprocedure);
  IF position('child_kind <> ''followup''' IN v_def) > 0 THEN RETURN; END IF;   -- déjà posé
  IF position(v_old IN v_def) = 0 THEN RAISE EXCEPTION 'guard_crm_customer_basis : repère « feature » introuvable'; END IF;
  v_new := replace(v_def, v_old,
E'  -- Relance après clic admise (20261119120000) ; renvoi, recettes, scénarios : non.
  IF COALESCE(NEW.resend_enabled, false) OR NEW.automation_id IS NOT NULL
     OR (NEW.child_kind IS NOT NULL AND NEW.child_kind <> ''followup'')
     OR (NEW.child_kind IS NULL AND NEW.parent_campaign_id IS NOT NULL)
     OR (NEW.child_kind = ''followup'' AND NOT EXISTS (
           SELECT 1 FROM public.email_campaigns m WHERE m.id = NEW.parent_campaign_id AND m.legal_basis = ''customer'')) THEN');
  EXECUTE v_new;
END $$;

-- ── 3. Le moteur de relance ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collect_campaign_followups()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  tpl RECORD;
  v_set public.crm_customer_basis_settings%ROWTYPE;
  v_child uuid;
  v_child_lb text;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
  v_parents integer := 0;
  v_crm boolean;
  v_key text;
  -- « Vos clients » (20261119120000) : la mère est « customer », et la relance peut-elle
  -- leur partir (base ouverte, modèle limité aux soirées du compte, enfant « customer ») ?
  v_cust boolean;
  v_cust_reason text;
  v_room integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_followups: service_role only';
  END IF;
  SELECT * INTO v_set FROM public.crm_customer_basis_settings WHERE id = 1;

  FOR p IN
    SELECT c.id, c.name, c.venue_id, c.organizer_user_id, c.event_id, c.quiet_hours,
           c.followup_delay_hours AS delay_h, c.followup_template_id, c.followup_campaign_id,
           c.resend_campaign_id, c.legal_basis AS lb,
           e.start_at, e.external_ticket_url AS ext_url
      FROM public.email_campaigns c
      JOIN public.events e ON e.id = c.event_id
     WHERE c.followup_enabled
       AND c.parent_campaign_id IS NULL
       AND c.followup_template_id IS NOT NULL
       AND c.event_id IS NOT NULL
       AND c.status IN ('sent', 'sending', 'paused')
       AND c.type = 'promotional'
       AND e.start_at > now() - interval '7 days'
  LOOP
    v_parents := v_parents + 1;
    v_crm := COALESCE(public.crm_campaign_is_crm(p.id), false);
    v_key := public.crm_scope_key(p.venue_id, p.organizer_user_id);
    SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = p.followup_template_id;
    IF tpl.id IS NULL THEN CONTINUE; END IF;

    v_cust := v_crm AND p.lb = 'customer';
    v_cust_reason := NULL;
    v_room := 0;
    IF v_cust THEN
      SELECT ec.legal_basis INTO v_child_lb FROM public.email_campaigns ec WHERE ec.id = p.followup_campaign_id;
      IF NOT public.crm_customer_basis_open(p.venue_id, p.organizer_user_id) THEN
        v_cust_reason := 'customer_closed';
      ELSIF jsonb_array_length(public._crm_customer_content_issues(tpl.blocks_json, p.event_id, p.venue_id, p.organizer_user_id)) > 0 THEN
        v_cust_reason := 'customer_content';
      ELSIF p.followup_campaign_id IS NOT NULL AND v_child_lb IS DISTINCT FROM 'customer' THEN
        v_cust_reason := 'customer_closed';
      END IF;
      -- Montée progressive : ce que l'espace peut encore envoyer aujourd'hui à sa base clients.
      SELECT GREATEST(0, GREATEST(1, COALESCE(b.ramp_cap, s2.ramp_start)) - (
               SELECT count(*) FROM public.email_campaign_recipients r JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE r.legal_basis = 'customer' AND c2.venue_id IS NOT DISTINCT FROM p.venue_id
                  AND c2.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
                  AND r.status IN ('pending', 'sending', 'sent', 'bounced', 'complained')
                  AND (COALESCE(r.sent_at, r.next_attempt_at, now()) AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date))
        INTO v_room
        FROM public.crm_customer_basis_settings s2
        LEFT JOIN public.crm_customer_basis b ON b.scope_key = v_key
       WHERE s2.id = 1;
    END IF;

    WITH clicks AS (
      SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS first_click
        FROM public.email_campaign_events ev
       WHERE ev.campaign_id IN (p.id, p.resend_campaign_id)
         AND ev.event_type = 'clicked'
         AND (COALESCE(ev.metadata->'click'->>'link', ev.metadata->>'link', '')
                ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)'
              -- La page de CETTE soirée sur la billetterie connectée (bouton d'un e-mail CRM).
              OR (p.ext_url IS NOT NULL
                  AND public._link_base(COALESCE(ev.metadata->'click'->>'link', ev.metadata->>'link')) = public._link_base(p.ext_url)))
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                      WHERE r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email))
       GROUP BY lower(ev.recipient_email)
    ),
    due AS (
      SELECT c.em, c.first_click, c.first_click + make_interval(hours => p.delay_h) AS due_at,
             mr.legal_basis AS rb, mr.status AS rs
        FROM clicks c
        LEFT JOIN LATERAL (
          SELECT r.legal_basis, r.status FROM public.email_campaign_recipients r
           WHERE r.campaign_id = p.id AND lower(r.email) = c.em
           ORDER BY (r.status = 'sent') DESC LIMIT 1
        ) mr ON true
       WHERE c.first_click + make_interval(hours => p.delay_h) <= now()
         AND NOT EXISTS (SELECT 1 FROM public.email_campaign_followups f
                          WHERE f.parent_campaign_id = p.id AND lower(f.email) = c.em)
    ),
    judged AS (
      SELECT d.em, d.first_click, d.due_at, (v_cust AND d.rb = 'customer') AS cust,
             CASE
               WHEN d.due_at >= p.start_at THEN 'event_over'
               -- CRM : jamais dans les 2 h avant la soirée.
               WHEN v_crm AND d.due_at >= p.start_at - interval '2 hours' THEN 'too_late'
               WHEN public.is_email_suppressed(d.em) THEN 'suppressed'
               -- Reçue au titre de l'accord : l'accord doit tenir encore.
               WHEN NOT (v_cust AND d.rb = 'customer') AND NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = d.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND s.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
               ) THEN 'unsubscribed'
               -- Reçue au titre de « Vos clients » : envoyée pour de vrai, base ouverte,
               -- modèle propre, personne encore éligible, plafond de 30 jours.
               WHEN v_cust AND d.rb = 'customer' AND d.rs IS DISTINCT FROM 'sent' THEN 'not_sent'
               WHEN v_cust AND d.rb = 'customer' AND v_cust_reason IS NOT NULL THEN v_cust_reason
               WHEN v_cust AND d.rb = 'customer' AND NOT EXISTS (
                 SELECT 1 FROM public.crm_customer_contacts cc
                  WHERE cc.scope_key = v_key AND cc.email = d.em AND cc.state = 'eligible'
               ) THEN 'unsubscribed'
               WHEN v_cust AND d.rb = 'customer' AND (
                 SELECT count(*) FROM public.email_campaign_recipients r2
                   JOIN public.email_campaigns c2 ON c2.id = r2.campaign_id
                  WHERE r2.legal_basis = 'customer' AND lower(r2.email) = d.em
                    AND c2.venue_id IS NOT DISTINCT FROM p.venue_id AND c2.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id
                    AND r2.status IN ('sent', 'bounced', 'complained') AND r2.sent_at > now() - interval '30 days'
               ) >= v_set.max_per_30d THEN 'customer_pressure_30d'
               WHEN EXISTS (
                 SELECT 1 FROM public.tickets t
                  WHERE NOT v_crm AND t.event_id = p.event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = d.em
               ) OR EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE NOT v_crm AND r.event_id = p.event_id AND r.status IN ('paid', 'confirmed') AND lower(r.user_email) = d.em
               ) OR EXISTS (
                 SELECT 1 FROM public.external_tickets xt
                  WHERE v_crm AND xt.event_id = p.event_id AND xt.status IN ('valid', 'transferred') AND lower(xt.buyer_email) = d.em
               ) THEN 'bought'
               WHEN NOT v_crm AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                  JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = p.event_id AND lower(ge.email) = d.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               WHEN EXISTS (
                 SELECT 1 FROM public.email_campaign_followups f2
                  WHERE f2.event_id = p.event_id AND lower(f2.email) = d.em AND f2.status = 'queued'
               ) THEN 'already_event'
               ELSE NULL
             END AS reason
        FROM due d
    ),
    ranked AS (
      -- Montée progressive : au-delà de ce que l'espace peut encore envoyer aujourd'hui,
      -- la personne n'est pas jugée (elle le sera au passage suivant), jamais écartée.
      SELECT j.*, CASE WHEN j.cust AND j.reason IS NULL
                       THEN row_number() OVER (PARTITION BY (j.cust AND j.reason IS NULL) ORDER BY j.first_click DESC) END AS rk
        FROM judged j
    ),
    ins AS (
      INSERT INTO public.email_campaign_followups
        (parent_campaign_id, event_id, email, clicked_at, due_at, status, skip_reason)
      SELECT p.id, p.event_id, j.em, j.first_click, j.due_at,
             CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason
        FROM ranked j
       WHERE j.rk IS NULL OR j.rk <= v_room
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

    SELECT count(*) INTO v_new
      FROM public.email_campaign_followups f
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;
    IF v_new = 0 THEN CONTINUE; END IF;

    v_child := p.followup_campaign_id;
    IF v_child IS NULL THEN
      -- L'enfant d'une mère « Vos clients » l'est aussi ; la garde la redescend à
      -- l'accord si la base est fermée ou le modèle hors de vos soirées.
      INSERT INTO public.email_campaigns
        (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
         theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
         quiet_hours, parent_campaign_id, child_kind, total_recipients, created_by, product, legal_basis)
      VALUES
        (p.venue_id, p.organizer_user_id, 'Relance · ' || p.name, 'promotional',
         COALESCE(NULLIF(tpl.subject, ''), 'Relance'), COALESCE(tpl.preheader, ''),
         COALESCE(tpl.blocks_json, '[]'::jsonb), 2,
         COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
         p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
         p.quiet_hours, p.id, 'followup', 0, tpl.created_by, CASE WHEN v_crm THEN 'crm' END,
         CASE WHEN v_cust THEN 'customer' ELSE 'consent' END)
      RETURNING id, legal_basis INTO v_child, v_child_lb;
      UPDATE public.email_campaigns SET followup_campaign_id = v_child WHERE id = p.id;
      -- Base fermée entre-temps : les clients mis en file à ce passage ne partent pas.
      IF v_cust AND v_child_lb IS DISTINCT FROM 'customer' THEN
        UPDATE public.email_campaign_followups f SET status = 'skipped', skip_reason = 'customer_closed'
         WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL
           AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                        WHERE r.campaign_id = p.id AND lower(r.email) = lower(f.email) AND r.legal_basis = 'customer');
      END IF;
    END IF;

    WITH todo AS (
      SELECT f.id, lower(f.email) AS em,
             (v_cust AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                  WHERE r.campaign_id = p.id AND lower(r.email) = lower(f.email) AND r.legal_basis = 'customer')) AS cust
        FROM public.email_campaign_followups f
       WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL
    ),
    ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, status, legal_basis)
      SELECT v_child, t.em,
             CASE WHEN t.cust THEN cc.first_name ELSE s.first_name END,
             CASE WHEN t.cust THEN cc.last_name ELSE s.last_name END,
             CASE WHEN t.cust THEN cc.unsubscribe_token ELSE s.unsubscribe_token END,
             'pending',
             CASE WHEN t.cust THEN 'customer' WHEN v_cust THEN 'consent' END
        FROM todo t
        LEFT JOIN LATERAL (
          SELECT s.first_name, s.last_name, s.unsubscribe_token
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = t.em
             AND s.product IS NOT DISTINCT FROM CASE WHEN v_crm THEN 'crm' END
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
           LIMIT 1
        ) s ON true
        LEFT JOIN public.crm_customer_contacts cc
          ON t.cust AND cc.scope_key = v_key AND cc.email = t.em AND cc.state = 'eligible'
       WHERE NOT t.cust OR cc.email IS NOT NULL
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    UPDATE public.email_campaign_followups f
       SET followup_campaign_id = v_child
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;

    UPDATE public.email_campaigns
       SET status = 'sending', paused_reason = NULL, error_message = NULL,
           total_recipients = COALESCE(total_recipients, 0) + v_new
     WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

    v_enqueued := v_enqueued + v_new;
    v_children := array_append(v_children, v_child);
  END LOOP;

  RETURN jsonb_build_object(
    'parents', v_parents, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children)
  );
END;
$function$;
-- CREATE OR REPLACE garde les droits (service_role seul, posés à la création).
