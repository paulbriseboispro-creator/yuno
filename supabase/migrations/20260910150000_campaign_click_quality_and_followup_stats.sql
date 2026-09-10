-- Qualité des chiffres de clic + bilan complet de la relance après clic.
--
-- 1. UN CLIC N'EST PAS UNE PERSONNE. `clicks_count` compte les ÉVÉNEMENTS
--    (voulu : savoir combien de fois on a cliqué), tandis que delivered /
--    opened comptent des destinataires UNIQUES. Le rapport divisait donc des
--    événements par des destinataires et affichait « 600 % de taux de clic »
--    pour 36 clics de 5 personnes. On ajoute `clickers_count` (personnes
--    uniques ayant cliqué) : le taux se calcule dessus, le nombre total de
--    clics reste affiché en dessous.
--
-- 2. La relance après clic mérite un vrai bilan dans le rapport de la mère :
--    combien de premiers clics repérés, combien de relances programmées,
--    envoyées, ouvertes, cliquées, et par qui — plus ce qui reste en attente.
--
-- 3. Le moteur ne doit lire QUE les clics de vrais destinataires de la
--    campagne. Un envoi de TEST porte le même tag `campaign_id` : sans ce
--    filtre, le pro qui teste son propre email s'inscrit lui-même en relance
--    (et brûle la place unique de son adresse pour cette soirée).

-- ── 1. Clics uniques ────────────────────────────────────────────────────────
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS clickers_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.email_campaigns.clickers_count IS
  'Destinataires UNIQUES ayant cliqué (clicks_count compte les événements).';

CREATE OR REPLACE FUNCTION public.recount_campaign_email_counters(p_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.email_campaigns c SET
    delivered_count  = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'delivered'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    bounced_count    = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'bounced'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    complained_count = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'complained'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    opens_count      = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'opened'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    clicks_count     = (SELECT count(*) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'clicked'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email))),
    clickers_count   = (SELECT count(DISTINCT lower(e.recipient_email)) FROM public.email_campaign_events e
                        WHERE e.campaign_id = p_campaign_id AND e.event_type = 'clicked'
                          AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                      WHERE r.campaign_id = e.campaign_id AND lower(r.email) = lower(e.recipient_email)))
  WHERE c.id = p_campaign_id;
$$;
REVOKE ALL ON FUNCTION public.recount_campaign_email_counters(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recount_campaign_email_counters(uuid) TO service_role;

-- Guérison immédiate : toute campagne ayant des clics repart avec son compte
-- de personnes (sinon la colonne reste à 0 jusqu'au prochain webhook).
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT DISTINCT campaign_id FROM public.email_campaign_events WHERE campaign_id IS NOT NULL LOOP
    PERFORM public.recount_campaign_email_counters(v_id);
  END LOOP;
END $$;

-- ── 2. Le moteur ne lit que les clics de vrais destinataires ────────────────
CREATE OR REPLACE FUNCTION public.collect_campaign_followups()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  tpl RECORD;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
  v_parents integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_followups: service_role only';
  END IF;

  FOR p IN
    SELECT c.id, c.name, c.venue_id, c.organizer_user_id, c.event_id, c.quiet_hours,
           c.followup_delay_hours AS delay_h, c.followup_template_id, c.followup_campaign_id,
           e.start_at
      FROM public.email_campaigns c
      JOIN public.events e ON e.id = c.event_id
     WHERE c.followup_enabled
       AND c.parent_campaign_id IS NULL
       AND c.followup_template_id IS NOT NULL
       AND c.event_id IS NOT NULL
       AND c.status IN ('sent', 'sending', 'paused')
       AND c.type = 'promotional'
       -- Une soirée finie depuis plus d'une semaine n'a plus rien à relancer.
       AND e.start_at > now() - interval '7 days'
  LOOP
    v_parents := v_parents + 1;

    -- 3a. Premiers clics dus, évalués maintenant, avec leur raison d'exclusion.
    WITH clicks AS (
      SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS first_click
        FROM public.email_campaign_events ev
       WHERE ev.campaign_id = p.id
         AND ev.event_type = 'clicked'
         AND COALESCE(ev.metadata->'click'->>'link', ev.metadata->>'link', '')
             ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)'
         -- Le tag `campaign_id` est aussi posé sur les envois de TEST : sans ce
         -- filtre, le pro qui clique dans son propre test se relance lui-même.
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                      WHERE r.campaign_id = p.id AND lower(r.email) = lower(ev.recipient_email))
       GROUP BY lower(ev.recipient_email)
    ),
    due AS (
      SELECT c.em, c.first_click, c.first_click + make_interval(hours => p.delay_h) AS due_at
        FROM clicks c
       WHERE c.first_click + make_interval(hours => p.delay_h) <= now()
         AND NOT EXISTS (SELECT 1 FROM public.email_campaign_followups f
                          WHERE f.parent_campaign_id = p.id AND lower(f.email) = c.em)
    ),
    judged AS (
      SELECT d.em, d.first_click, d.due_at,
             CASE
               WHEN d.due_at >= p.start_at THEN 'event_over'
               WHEN public.is_email_suppressed(d.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = d.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
               ) THEN 'unsubscribed'
               WHEN EXISTS (
                 SELECT 1 FROM public.tickets t
                  WHERE t.event_id = p.event_id AND t.status = 'paid' AND lower(t.user_email) = d.em
               ) OR EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = p.event_id AND r.status = 'paid' AND lower(r.user_email) = d.em
               ) THEN 'bought'
               WHEN EXISTS (
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
    ins AS (
      INSERT INTO public.email_campaign_followups
        (parent_campaign_id, event_id, email, clicked_at, due_at, status, skip_reason)
      SELECT p.id, p.event_id, j.em, j.first_click, j.due_at,
             CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason
        FROM judged j
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

    -- 3b. Rien à envoyer pour cette mère ? Suivante.
    SELECT count(*) INTO v_new
      FROM public.email_campaign_followups f
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;
    IF v_new = 0 THEN CONTINUE; END IF;

    -- 3c. La campagne enfant, montée depuis le modèle au premier contact dû.
    v_child := p.followup_campaign_id;
    IF v_child IS NULL THEN
      SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = p.followup_template_id;
      IF tpl.id IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.email_campaigns
        (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
         theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
         quiet_hours, parent_campaign_id, total_recipients, created_by)
      VALUES
        (p.venue_id, p.organizer_user_id, 'Relance · ' || p.name, 'promotional',
         COALESCE(NULLIF(tpl.subject, ''), 'Relance'), COALESCE(tpl.preheader, ''),
         COALESCE(tpl.blocks_json, '[]'::jsonb), 2,
         COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
         p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
         p.quiet_hours, p.id, 0, tpl.created_by)
      RETURNING id INTO v_child;
      UPDATE public.email_campaigns SET followup_campaign_id = v_child WHERE id = p.id;
    END IF;

    -- 3d. File de l'enfant : les contacts dus, avec prénom et jeton de
    --     désinscription du registre de consentement.
    WITH todo AS (
      SELECT f.id, lower(f.email) AS em
        FROM public.email_campaign_followups f
       WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL
    ),
    ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
        FROM todo t
        LEFT JOIN LATERAL (
          SELECT s.first_name, s.last_name, s.unsubscribe_token
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = t.em
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
           LIMIT 1
        ) s ON true
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    UPDATE public.email_campaign_followups f
       SET followup_campaign_id = v_child
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;

    -- L'enfant repasse en vol (le worker l'avait posé en 'sent' quand sa
    -- file s'est vidée) ; le balayage du cron reprend une tranche.
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
$$;
REVOKE ALL ON FUNCTION public.collect_campaign_followups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_campaign_followups() TO service_role;

-- ── 3. Bilan complet de la relance ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_campaign_followup_stats(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  parent_id uuid;
  child RECORD;
  parent RECORD;
  v_skips jsonb;
  v_seen integer;
  v_queued integer;
  v_pending integer;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  IF c.venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  ELSIF c.organizer_user_id IS NOT NULL THEN
    IF NOT (c.organizer_user_id = auth.uid() OR public.is_super_admin()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  ELSIF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  parent_id := COALESCE(c.parent_campaign_id, c.id);
  SELECT id, name, followup_enabled, followup_delay_hours, followup_campaign_id
    INTO parent FROM public.email_campaigns WHERE id = parent_id;
  IF NOT parent.followup_enabled AND parent.followup_campaign_id IS NULL THEN RETURN NULL; END IF;

  -- Un premier clic repéré = une ligne du registre, quelle que soit l'issue.
  SELECT count(*),
         count(*) FILTER (WHERE status = 'queued'),
         count(*) FILTER (WHERE status = 'queued' AND followup_campaign_id IS NULL)
    INTO v_seen, v_queued, v_pending
    FROM public.email_campaign_followups f WHERE f.parent_campaign_id = parent_id;
  SELECT COALESCE(jsonb_object_agg(skip_reason, n), '{}'::jsonb) INTO v_skips
    FROM (SELECT skip_reason, count(*) AS n FROM public.email_campaign_followups
           WHERE parent_campaign_id = parent_id AND status = 'skipped' GROUP BY skip_reason) s;

  SELECT id, name, status, recipients_count, delivered_count, opens_count,
         clicks_count, clickers_count, unsubscribes_count, bounced_count
    INTO child FROM public.email_campaigns WHERE id = parent.followup_campaign_id;

  RETURN jsonb_build_object(
    'parent_id', parent.id,
    'parent_name', parent.name,
    'is_child', c.parent_campaign_id IS NOT NULL,
    'enabled', COALESCE(parent.followup_enabled, false),
    'delay_hours', parent.followup_delay_hours,
    'clicks_seen', COALESCE(v_seen, 0),
    'queued', COALESCE(v_queued, 0),
    'pending', COALESCE(v_pending, 0),
    'skipped', v_skips,
    'child', CASE WHEN child.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', child.id, 'name', child.name, 'status', child.status,
      'sent', COALESCE(child.recipients_count, 0), 'delivered', COALESCE(child.delivered_count, 0),
      'opens', COALESCE(child.opens_count, 0), 'clicks', COALESCE(child.clicks_count, 0),
      'clickers', COALESCE(child.clickers_count, 0),
      'unsubscribes', COALESCE(child.unsubscribes_count, 0),
      'bounced', COALESCE(child.bounced_count, 0)
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_followup_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_followup_stats(uuid) TO authenticated, service_role;
