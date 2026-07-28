-- ============================================================================
-- Moteur des automations affiliées — la config ne ment plus.
--
-- `affiliate_notification_automations` (8 types, toggles par agence) n'était
-- lue par RIEN. Ce moteur l'exécute, 100 % SQL, zéro edge function :
--   · 2 triggers événementiels : new_event_published, event_sold_out
--   · 1 balayage pg_cron horaire : assignment_reminder, event_in_48h,
--     linktree_stale, weekly_top_promoter, weekly_recap, missing_ticket_url
--
-- Les envois équipe passent par INSERT affiliate_notifications → le fan-out
-- existant (trg_aff_team_message_fanout) les livre dans la cloche de chaque
-- membre. missing_ticket_url va au flux ADMIN (c'est une alerte de gestion).
-- Dédup : marqueur d'entité dans action_url, ou fenêtre horaire du balayage.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aff_auto_enabled(p_affiliate_id uuid, p_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT is_enabled FROM affiliate_notification_automations
    WHERE affiliate_id = p_affiliate_id AND automation_type = p_type
  ), true);
$$;

-- ----------------------------------------------------------------------------
-- Trigger 1 : soirée publiée → l'équipe est prévenue (à ajouter au linktree).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_notify_event_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('published', 'featured') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'featured') THEN RETURN NEW; END IF;
  IF NOT aff_auto_enabled(NEW.affiliate_id, 'new_event_published') THEN RETURN NEW; END IF;

  INSERT INTO affiliate_notifications
    (affiliate_id, target_member_id, type, automation_type, title, body, action_url)
  VALUES (
    NEW.affiliate_id, NULL, 'automation', 'new_event_published',
    'Nouvelle soirée : ' || NEW.name,
    to_char(NEW.event_date, 'DD/MM') || ' — ajoute-la à ton linktree et prépare ta promo.',
    '/affiliate/promoteur/linktree?event=' || NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_event_published ON public.affiliate_events;
CREATE TRIGGER trg_auto_event_published
  AFTER INSERT OR UPDATE OF status ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.auto_notify_event_published();

-- ----------------------------------------------------------------------------
-- Trigger 2 : soirée complète → l'équipe met ses stories à jour.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_notify_event_sold_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (NEW.is_sold_out = true AND COALESCE(OLD.is_sold_out, false) = false) THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('published', 'featured') THEN RETURN NEW; END IF;
  IF NOT aff_auto_enabled(NEW.affiliate_id, 'event_sold_out') THEN RETURN NEW; END IF;

  INSERT INTO affiliate_notifications
    (affiliate_id, target_member_id, type, automation_type, title, body, action_url)
  VALUES (
    NEW.affiliate_id, NULL, 'automation', 'event_sold_out',
    'Complet : ' || NEW.name,
    'La soirée affiche complet — mets tes stories et ton linktree à jour.',
    '/affiliate/promoteur/linktree?event=' || NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_event_sold_out ON public.affiliate_events;
CREATE TRIGGER trg_auto_event_sold_out
  AFTER UPDATE OF is_sold_out ON public.affiliate_events
  FOR EACH ROW EXECUTE FUNCTION public.auto_notify_event_sold_out();

-- ----------------------------------------------------------------------------
-- Balayage horaire. Chaque bloc est indépendant et gardé par son créneau ;
-- une erreur dans un bloc n'empêche pas les autres.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_affiliate_automation_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour int := extract(hour from now());
  v_dow int := extract(dow from now());  -- 1 = lundi
  r RECORD;
BEGIN
  -- 1. Rappel d'assignation : lien promo toujours pas soumis après 24 h.
  BEGIN
    FOR r IN
      SELECT a.id, a.member_id, ae.affiliate_id, ae.name
      FROM affiliate_event_assignments a
      JOIN affiliate_events ae ON ae.id = a.affiliate_event_id
      WHERE a.status = 'pending_url'
        AND a.member_id IS NOT NULL
        AND a.assigned_at < now() - interval '24 hours'
        AND ae.event_date >= current_date
        AND aff_auto_enabled(ae.affiliate_id, 'assignment_reminder')
        AND NOT EXISTS (
          SELECT 1 FROM affiliate_notifications n
          WHERE n.automation_type = 'assignment_reminder'
            AND n.action_url = '/affiliate/promoteur?reminder=' || a.id
        )
    LOOP
      INSERT INTO affiliate_notifications
        (affiliate_id, target_member_id, type, automation_type, title, body, action_url)
      VALUES (
        r.affiliate_id, r.member_id, 'automation', 'assignment_reminder',
        'Lien promo attendu',
        r.name || ' t''attend — soumets ton lien promo depuis ton espace.',
        '/affiliate/promoteur?reminder=' || r.id
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 2. J-2 : la soirée est dans 48 h (envoyé une fois, à 9 h UTC).
  IF v_hour = 9 THEN
    BEGIN
      FOR r IN
        SELECT ae.id, ae.affiliate_id, ae.name, ae.event_date
        FROM affiliate_events ae
        WHERE ae.status IN ('published', 'featured')
          AND ae.event_date = current_date + 2
          AND aff_auto_enabled(ae.affiliate_id, 'event_in_48h')
          AND NOT EXISTS (
            SELECT 1 FROM affiliate_notifications n
            WHERE n.automation_type = 'event_in_48h'
              AND n.action_url = '/affiliate/promoteur?j2=' || ae.id
          )
      LOOP
        INSERT INTO affiliate_notifications
          (affiliate_id, target_member_id, type, automation_type, title, body, action_url)
        VALUES (
          r.affiliate_id, NULL, 'automation', 'event_in_48h',
          'J-2 : ' || r.name,
          'La soirée est dans deux jours — dernier sprint de promo.',
          '/affiliate/promoteur?j2=' || r.id
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- 3. Lundi 9 h UTC : linktree endormi (approuvé mais aucune soirée à venir).
  IF v_dow = 1 AND v_hour = 9 THEN
    BEGIN
      FOR r IN
        SELECT m.id, m.affiliate_id
        FROM affiliate_members m
        WHERE m.is_active = true AND m.role = 'promoter'
          AND m.linktree_status = 'approved'
          AND aff_auto_enabled(m.affiliate_id, 'linktree_stale')
          AND NOT EXISTS (
            SELECT 1 FROM promoter_linktree_events ple
            JOIN affiliate_events ae ON ae.id = ple.affiliate_event_id
            WHERE ple.member_id = m.id AND ae.event_date >= current_date
          )
      LOOP
        INSERT INTO affiliate_notifications
          (affiliate_id, target_member_id, type, automation_type, title, body, action_url)
        VALUES (
          r.affiliate_id, r.id, 'automation', 'linktree_stale',
          'Ton linktree est vide',
          'Aucune soirée à venir sur ta page — ajoute celles de la semaine.',
          '/affiliate/promoteur/linktree'
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 4. Lundi 9 h UTC : top promoteur de la semaine (clics 7 jours).
    BEGIN
      FOR r IN
        SELECT DISTINCT ON (c.affiliate_id)
          c.affiliate_id, c.affiliate_member_id, count(*) AS clicks,
          trim(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
        FROM affiliate_clicks c
        JOIN affiliate_members m ON m.id = c.affiliate_member_id
        WHERE c.clicked_at >= now() - interval '7 days'
          AND c.is_internal = false
          AND c.affiliate_member_id IS NOT NULL
          AND aff_auto_enabled(c.affiliate_id, 'weekly_top_promoter')
        GROUP BY c.affiliate_id, c.affiliate_member_id, m.first_name, m.last_name
        ORDER BY c.affiliate_id, count(*) DESC
      LOOP
        IF r.clicks >= 3 THEN
          INSERT INTO affiliate_notifications
            (affiliate_id, target_member_id, type, automation_type, title, body, action_url)
          VALUES (
            r.affiliate_id, NULL, 'automation', 'weekly_top_promoter',
            'Top promoteur : ' || COALESCE(NULLIF(r.member_name, ''), 'un membre'),
            r.clicks || ' clics billetterie cette semaine. Qui le détrône ?',
            '/affiliate/analytics'
          );
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 5. Lundi 9 h UTC : récap perso de la semaine pour chaque promoteur actif.
    BEGIN
      FOR r IN
        SELECT m.id, m.affiliate_id,
          (SELECT count(*) FROM affiliate_visitor_sessions s
            WHERE s.affiliate_member_id = m.id AND s.is_internal = false
              AND s.visited_at >= now() - interval '7 days') AS views,
          (SELECT count(*) FROM affiliate_clicks c
            WHERE c.affiliate_member_id = m.id AND c.is_internal = false
              AND c.clicked_at >= now() - interval '7 days') AS clicks
        FROM affiliate_members m
        WHERE m.is_active = true AND m.role = 'promoter'
          AND aff_auto_enabled(m.affiliate_id, 'weekly_recap')
      LOOP
        IF r.views > 0 OR r.clicks > 0 THEN
          INSERT INTO affiliate_notifications
            (affiliate_id, target_member_id, type, automation_type, title, body, action_url)
          VALUES (
            r.affiliate_id, r.id, 'automation', 'weekly_recap',
            'Ta semaine en chiffres',
            r.views || ' vues et ' || r.clicks || ' clics sur tes pages ces 7 derniers jours.',
            '/affiliate/analytics'
          );
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- 6. Tous les jours 9 h UTC : soirées publiées sans lien billetterie → ADMIN.
  IF v_hour = 9 THEN
    BEGIN
      FOR r IN
        SELECT ae.id, ae.affiliate_id, ae.name, ae.event_date
        FROM affiliate_events ae
        WHERE ae.status IN ('published', 'featured')
          AND ae.external_ticket_url IS NULL
          AND ae.event_date BETWEEN current_date AND current_date + 7
          AND aff_auto_enabled(ae.affiliate_id, 'missing_ticket_url')
          AND NOT EXISTS (
            SELECT 1 FROM affiliate_app_notifications n
            WHERE n.notification_type = 'aff_missing_ticket_url'
              AND n.reference_id = ae.id
              AND n.created_at >= now() - interval '3 days'
          )
      LOOP
        PERFORM emit_affiliate_app_notification(
          r.affiliate_id, NULL,
          'aff_missing_ticket_url',
          'Lien billetterie manquant',
          r.name || ' (' || to_char(r.event_date, 'DD/MM') || ') est visible sans bouton de réservation.',
          'high', 'affiliate_event', r.id, '{}'
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.run_affiliate_automation_sweep() FROM PUBLIC, anon, authenticated;

-- Balayage horaire à :10 (les créneaux 9 h UTC internes font le reste).
DO $$
BEGIN
  PERFORM cron.unschedule('affiliate-automation-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'affiliate-automation-sweep',
  '10 * * * *',
  $$SELECT public.run_affiliate_automation_sweep()$$
);
