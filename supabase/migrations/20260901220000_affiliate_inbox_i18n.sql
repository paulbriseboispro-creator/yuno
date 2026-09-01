-- ============================================================================
-- Inbox affiliée trilingue (FR/EN/ES).
--
-- Jusqu'ici, tous les triggers de l'inbox affiliée écrivaient title/message en
-- français en dur : un promoteur madrilène (Amoris) lisait du français dans sa
-- cloche. La langue du destinataire vit dans profiles.preferred_language
-- (synchronisée par le client : langue du téléphone au 1er login, puis chaque
-- changement manuel).
--
-- Modèle :
-- - Les émissions DIRECTES (assignation, revue du linktree, lien soumis,
--   contrats, lien billetterie manquant) rendent le texte dans la langue du
--   destinataire (membre ou chef d'agence) au moment de l'émission.
-- - Les AUTOMATIONS continuent d'écrire un texte canonique FRANÇAIS dans
--   affiliate_notifications (c'est l'historique de communication côté agence,
--   une seule ligne ne peut porter qu'une langue) MAIS y joignent désormais
--   auto_params ; le fan-out vers les flux personnels re-rend alors le texte
--   dans la langue de CHAQUE membre via aff_render_auto(). Les lignes
--   antérieures (auto_params NULL) restent recopiées telles quelles.
--
-- Fallback : 'en' (défaut du site) — divergence assumée avec resolveUserLang()
-- des push (fallback 'fr') : preferred_language étant auto-rempli au premier
-- login, le NULL ne concerne que des comptes jamais ouverts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers de langue.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aff_user_lang(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE WHEN p.preferred_language IN ('fr', 'es') THEN p.preferred_language ELSE 'en' END
    FROM public.profiles p
    WHERE p.id = p_user_id
  ), 'en');
$$;

CREATE OR REPLACE FUNCTION public.aff_member_lang(p_member_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.aff_user_lang((
    SELECT m.user_id FROM public.affiliate_members m WHERE m.id = p_member_id
  ));
$$;

CREATE OR REPLACE FUNCTION public.aff_admin_lang(p_affiliate_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.aff_user_lang((
    SELECT a.user_id FROM public.affiliates a WHERE a.id = p_affiliate_id
  ));
$$;

REVOKE ALL ON FUNCTION public.aff_user_lang(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aff_member_lang(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aff_admin_lang(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- auto_params : les paramètres bruts d'une automation, pour re-rendre le texte
-- dans la langue du destinataire au fan-out.
-- ----------------------------------------------------------------------------
ALTER TABLE public.affiliate_notifications
  ADD COLUMN IF NOT EXISTS auto_params jsonb;

-- ----------------------------------------------------------------------------
-- Rendu localisé des textes d'automation. Type inconnu ou params NULL →
-- (NULL, NULL) : le fan-out recopie alors le texte canonique tel quel.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aff_render_auto(
  p_type text,
  p_params jsonb,
  p_lang text,
  OUT o_title text,
  OUT o_body text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := p_params ->> 'name';
  v_date text := p_params ->> 'date';
  v_member text := NULLIF(p_params ->> 'member_name', '');
  v_views text := COALESCE(p_params ->> 'views', '0');
  v_clicks text := COALESCE(p_params ->> 'clicks', '0');
BEGIN
  o_title := NULL;
  o_body := NULL;
  IF p_type IS NULL OR p_params IS NULL THEN RETURN; END IF;

  IF p_type = 'new_event_published' THEN
    IF p_lang = 'fr' THEN
      o_title := 'Nouvelle soirée : ' || v_name;
      o_body := v_date || ' — ajoute-la à ton linktree et prépare ta promo.';
    ELSIF p_lang = 'es' THEN
      o_title := 'Nueva noche: ' || v_name;
      o_body := v_date || ' — añádela a tu linktree y prepara tu promo.';
    ELSE
      o_title := 'New night: ' || v_name;
      o_body := v_date || ' — add it to your linktree and get your promo ready.';
    END IF;

  ELSIF p_type = 'event_sold_out' THEN
    IF p_lang = 'fr' THEN
      o_title := 'Complet : ' || v_name;
      o_body := 'La soirée affiche complet — mets tes stories et ton linktree à jour.';
    ELSIF p_lang = 'es' THEN
      o_title := 'Agotado: ' || v_name;
      o_body := 'La noche está agotada — actualiza tus stories y tu linktree.';
    ELSE
      o_title := 'Sold out: ' || v_name;
      o_body := 'The night is sold out — update your stories and your linktree.';
    END IF;

  ELSIF p_type = 'assignment_reminder' THEN
    IF p_lang = 'fr' THEN
      o_title := 'Lien promo attendu';
      o_body := v_name || ' t''attend — soumets ton lien promo depuis ton espace.';
    ELSIF p_lang = 'es' THEN
      o_title := 'Enlace promo pendiente';
      o_body := v_name || ' te espera — envía tu enlace promo desde tu espacio.';
    ELSE
      o_title := 'Promo link expected';
      o_body := v_name || ' is waiting — submit your promo link from your space.';
    END IF;

  ELSIF p_type = 'event_in_48h' THEN
    IF p_lang = 'fr' THEN
      o_title := 'J-2 : ' || v_name;
      o_body := 'La soirée est dans deux jours — dernier sprint de promo.';
    ELSIF p_lang = 'es' THEN
      o_title := 'Quedan 2 días: ' || v_name;
      o_body := 'La noche es en dos días — último sprint de promo.';
    ELSE
      o_title := '2 days to go: ' || v_name;
      o_body := 'The night is in two days — final promo sprint.';
    END IF;

  ELSIF p_type = 'linktree_stale' THEN
    IF p_lang = 'fr' THEN
      o_title := 'Ton linktree est vide';
      o_body := 'Aucune soirée à venir sur ta page — ajoute celles de la semaine.';
    ELSIF p_lang = 'es' THEN
      o_title := 'Tu linktree está vacío';
      o_body := 'No hay noches próximas en tu página — añade las de la semana.';
    ELSE
      o_title := 'Your linktree is empty';
      o_body := 'No upcoming nights on your page — add this week''s.';
    END IF;

  ELSIF p_type = 'weekly_top_promoter' THEN
    IF p_lang = 'fr' THEN
      o_title := 'Top promoteur : ' || COALESCE(v_member, 'un membre');
      o_body := v_clicks || ' clics billetterie cette semaine. Qui le détrône ?';
    ELSIF p_lang = 'es' THEN
      o_title := 'Top promotor: ' || COALESCE(v_member, 'un miembro');
      o_body := v_clicks || ' clics de entradas esta semana. ¿Quién le destrona?';
    ELSE
      o_title := 'Top promoter: ' || COALESCE(v_member, 'a member');
      o_body := v_clicks || ' ticket clicks this week. Who takes the crown?';
    END IF;

  ELSIF p_type = 'weekly_recap' THEN
    IF p_lang = 'fr' THEN
      o_title := 'Ta semaine en chiffres';
      o_body := v_views || ' vues et ' || v_clicks || ' clics sur tes pages ces 7 derniers jours.';
    ELSIF p_lang = 'es' THEN
      o_title := 'Tu semana en cifras';
      o_body := v_views || ' vistas y ' || v_clicks || ' clics en tus páginas en los últimos 7 días.';
    ELSE
      o_title := 'Your week in numbers';
      o_body := v_views || ' views and ' || v_clicks || ' clicks on your pages in the last 7 days.';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.aff_render_auto(text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. Nouvelle assignation → texte dans la langue de chaque promoteur visé.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_affiliate_assignment_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_member RECORD;
  v_lang text;
  v_title text;
  v_msg text;
BEGIN
  SELECT ae.id, ae.name, ae.event_date, ae.affiliate_id
  INTO v_event
  FROM affiliate_events ae
  WHERE ae.id = NEW.affiliate_event_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.member_id IS NOT NULL THEN
    v_lang := aff_member_lang(NEW.member_id);
    IF v_lang = 'fr' THEN
      v_title := 'Nouvelle soirée à promouvoir';
      v_msg := v_event.name || ' — soumets ton lien promo depuis ton espace.';
    ELSIF v_lang = 'es' THEN
      v_title := 'Nueva noche para promocionar';
      v_msg := v_event.name || ' — envía tu enlace promo desde tu espacio.';
    ELSE
      v_title := 'New night to promote';
      v_msg := v_event.name || ' — submit your promo link from your space.';
    END IF;
    PERFORM emit_affiliate_app_notification(
      v_event.affiliate_id, NEW.member_id,
      'aff_new_assignment', v_title, v_msg,
      'normal', 'affiliate_event', v_event.id,
      jsonb_build_object('event_id', v_event.id)
    );
  ELSE
    FOR v_member IN
      SELECT id FROM affiliate_members
      WHERE affiliate_id = v_event.affiliate_id
        AND is_active = true AND role = 'promoter'
    LOOP
      v_lang := aff_member_lang(v_member.id);
      IF v_lang = 'fr' THEN
        v_title := 'Nouvelle soirée à promouvoir';
        v_msg := v_event.name || ' — soumets ton lien promo depuis ton espace.';
      ELSIF v_lang = 'es' THEN
        v_title := 'Nueva noche para promocionar';
        v_msg := v_event.name || ' — envía tu enlace promo desde tu espacio.';
      ELSE
        v_title := 'New night to promote';
        v_msg := v_event.name || ' — submit your promo link from your space.';
      END IF;
      PERFORM emit_affiliate_app_notification(
        v_event.affiliate_id, v_member.id,
        'aff_new_assignment', v_title, v_msg,
        'normal', 'affiliate_event', v_event.id,
        jsonb_build_object('event_id', v_event.id)
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une notification ne doit jamais faire échouer l'écriture métier.
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Lien promo soumis → flux admin, langue du chef d'agence.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_affiliate_assignment_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_member_name text;
  v_lang text;
  v_title text;
  v_msg text;
BEGIN
  IF NEW.status <> 'url_submitted' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT ae.id, ae.name, ae.affiliate_id
  INTO v_event
  FROM affiliate_events ae
  WHERE ae.id = NEW.affiliate_event_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
  INTO v_member_name
  FROM affiliate_members WHERE id = NEW.member_id;

  v_lang := aff_admin_lang(v_event.affiliate_id);
  IF v_lang = 'fr' THEN
    v_title := 'Lien promo soumis';
    v_msg := COALESCE(NULLIF(v_member_name, ''), 'Un promoteur') || ' a soumis son lien pour ' || v_event.name || '.';
  ELSIF v_lang = 'es' THEN
    v_title := 'Enlace promo enviado';
    v_msg := COALESCE(NULLIF(v_member_name, ''), 'Un promotor') || ' ha enviado su enlace para ' || v_event.name || '.';
  ELSE
    v_title := 'Promo link submitted';
    v_msg := COALESCE(NULLIF(v_member_name, ''), 'A promoter') || ' submitted their link for ' || v_event.name || '.';
  END IF;

  PERFORM emit_affiliate_app_notification(
    v_event.affiliate_id, NULL,
    'aff_url_submitted', v_title, v_msg,
    'normal', 'affiliate_event', v_event.id,
    jsonb_build_object('event_id', v_event.id, 'member_id', NEW.member_id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Cycle de révision du linktree : admin dans SA langue, membre dans la
--    sienne.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_affiliate_linktree_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_name text;
  v_lang text;
  v_title text;
  v_msg text;
BEGIN
  IF NEW.linktree_status IS NOT DISTINCT FROM OLD.linktree_status THEN
    RETURN NEW;
  END IF;

  v_member_name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));

  IF NEW.linktree_status = 'pending_review' THEN
    v_lang := aff_admin_lang(NEW.affiliate_id);
    IF v_lang = 'fr' THEN
      v_title := 'Linktree à valider';
      v_msg := COALESCE(NULLIF(v_member_name, ''), 'Un promoteur') || ' a soumis son linktree pour révision.';
    ELSIF v_lang = 'es' THEN
      v_title := 'Linktree por validar';
      v_msg := COALESCE(NULLIF(v_member_name, ''), 'Un promotor') || ' ha enviado su linktree para revisión.';
    ELSE
      v_title := 'Linktree to review';
      v_msg := COALESCE(NULLIF(v_member_name, ''), 'A promoter') || ' submitted their linktree for review.';
    END IF;
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NULL,
      'aff_linktree_pending', v_title, v_msg,
      'high', 'affiliate_member', NEW.id,
      jsonb_build_object('member_id', NEW.id)
    );
  ELSIF NEW.linktree_status = 'approved' AND OLD.linktree_status = 'pending_review' THEN
    v_lang := aff_member_lang(NEW.id);
    IF v_lang = 'fr' THEN
      v_title := 'Linktree approuvé';
      v_msg := 'Ta page publique est validée et en ligne.';
    ELSIF v_lang = 'es' THEN
      v_title := 'Linktree aprobado';
      v_msg := 'Tu página pública está validada y en línea.';
    ELSE
      v_title := 'Linktree approved';
      v_msg := 'Your public page is approved and live.';
    END IF;
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NEW.id,
      'aff_linktree_approved', v_title, v_msg,
      'normal', 'affiliate_member', NEW.id, '{}'
    );
  ELSIF NEW.linktree_status = 'draft' AND OLD.linktree_status = 'pending_review' THEN
    v_lang := aff_member_lang(NEW.id);
    IF v_lang = 'fr' THEN
      v_title := 'Linktree à retravailler';
      v_msg := 'Ta page publique a été renvoyée en brouillon — vois avec ton manager ce qui bloque.';
    ELSIF v_lang = 'es' THEN
      v_title := 'Linktree por retocar';
      v_msg := 'Tu página pública ha vuelto a borrador — habla con tu manager para ver qué falta.';
    ELSE
      v_title := 'Linktree needs changes';
      v_msg := 'Your public page was sent back to draft — check with your manager what to fix.';
    END IF;
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NEW.id,
      'aff_linktree_rejected', v_title, v_msg,
      'high', 'affiliate_member', NEW.id, '{}'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Fan-out des messages d'équipe : une automation (auto_params non NULL)
--    est re-rendue dans la langue de CHAQUE membre ; un message humain est
--    recopié tel quel (on ne traduit pas la prose de l'agence).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fanout_affiliate_team_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member RECORD;
  v_title text;
  v_body text;
BEGIN
  IF NEW.target_member_id IS NOT NULL THEN
    SELECT o_title, o_body INTO v_title, v_body
    FROM aff_render_auto(NEW.automation_type, NEW.auto_params, aff_member_lang(NEW.target_member_id));
    PERFORM emit_affiliate_app_notification(
      NEW.affiliate_id, NEW.target_member_id,
      'aff_team_message',
      COALESCE(left(v_title, 200), left(NEW.title, 200)),
      COALESCE(left(v_body, 500), left(COALESCE(NEW.body, ''), 500)),
      'normal', 'affiliate_notification', NEW.id,
      jsonb_build_object('action_url', NEW.action_url, 'automation_type', NEW.automation_type)
    );
  ELSE
    FOR v_member IN
      SELECT id FROM affiliate_members
      WHERE affiliate_id = NEW.affiliate_id AND is_active = true
    LOOP
      SELECT o_title, o_body INTO v_title, v_body
      FROM aff_render_auto(NEW.automation_type, NEW.auto_params, aff_member_lang(v_member.id));
      PERFORM emit_affiliate_app_notification(
        NEW.affiliate_id, v_member.id,
        'aff_team_message',
        COALESCE(left(v_title, 200), left(NEW.title, 200)),
        COALESCE(left(v_body, 500), left(COALESCE(NEW.body, ''), 500)),
        'normal', 'affiliate_notification', NEW.id,
        jsonb_build_object('action_url', NEW.action_url, 'automation_type', NEW.automation_type)
      );
    END LOOP;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Contrats du bras Yuno → flux admin, langue du chef d'agence.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_agency_contract_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affiliate_id uuid;
  v_scope text;
  v_lang text;
BEGIN
  SELECT id INTO v_affiliate_id FROM affiliates WHERE agency_id = NEW.agency_id;
  IF v_affiliate_id IS NULL THEN RETURN NEW; END IF;

  v_lang := aff_admin_lang(v_affiliate_id);

  SELECT COALESCE(v.name,
    CASE v_lang WHEN 'fr' THEN 'Organisateur' WHEN 'es' THEN 'Organizador' ELSE 'Organizer' END)
  INTO v_scope
  FROM (SELECT NEW.venue_id) t
  LEFT JOIN venues v ON v.id = NEW.venue_id;

  -- Le club vient de signer.
  IF NEW.club_signed_at IS NOT NULL AND OLD.club_signed_at IS NULL THEN
    PERFORM emit_affiliate_app_notification(
      v_affiliate_id, NULL,
      'aff_contract_signed',
      CASE v_lang WHEN 'fr' THEN 'Contrat signé' WHEN 'es' THEN 'Contrato firmado' ELSE 'Contract signed' END,
      CASE v_lang
        WHEN 'fr' THEN v_scope || ' a signé votre contrat — vos promoteurs peuvent vendre.'
        WHEN 'es' THEN v_scope || ' ha firmado vuestro contrato — vuestros promotores pueden vender.'
        ELSE v_scope || ' signed your contract — your promoters can sell.'
      END,
      'high', 'agency_contract', NEW.id, '{}'
    );
  -- Changement d'état notable (pause, fin, annulation).
  ELSIF NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('paused', 'ended', 'cancelled') THEN
    PERFORM emit_affiliate_app_notification(
      v_affiliate_id, NULL,
      'aff_contract_status',
      CASE v_lang
        WHEN 'fr' THEN 'Contrat ' || CASE NEW.status WHEN 'paused' THEN 'en pause' WHEN 'ended' THEN 'terminé' ELSE 'annulé' END
        WHEN 'es' THEN 'Contrato ' || CASE NEW.status WHEN 'paused' THEN 'en pausa' WHEN 'ended' THEN 'terminado' ELSE 'cancelado' END
        ELSE 'Contract ' || CASE NEW.status WHEN 'paused' THEN 'paused' WHEN 'ended' THEN 'ended' ELSE 'cancelled' END
      END,
      CASE v_lang
        WHEN 'fr' THEN v_scope || ' — le contrat est passé à « ' || NEW.status || ' ».'
        WHEN 'es' THEN v_scope || ' — el contrato ha pasado a « ' || NEW.status || ' ».'
        ELSE v_scope || ' — the contract is now "' || NEW.status || '".'
      END,
      'normal', 'agency_contract', NEW.id, '{}'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Automations : mêmes textes canoniques FR, plus auto_params pour le rendu
--    localisé au fan-out.
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
    (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
  VALUES (
    NEW.affiliate_id, NULL, 'automation', 'new_event_published',
    'Nouvelle soirée : ' || NEW.name,
    to_char(NEW.event_date, 'DD/MM') || ' — ajoute-la à ton linktree et prépare ta promo.',
    '/affiliate/promoteur/linktree?event=' || NEW.id,
    jsonb_build_object('name', NEW.name, 'date', to_char(NEW.event_date, 'DD/MM'))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

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
    (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
  VALUES (
    NEW.affiliate_id, NULL, 'automation', 'event_sold_out',
    'Complet : ' || NEW.name,
    'La soirée affiche complet — mets tes stories et ton linktree à jour.',
    '/affiliate/promoteur/linktree?event=' || NEW.id,
    jsonb_build_object('name', NEW.name)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_affiliate_automation_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour int := extract(hour from now());
  v_dow int := extract(dow from now());  -- 1 = lundi
  v_lang text;
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
        (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
      VALUES (
        r.affiliate_id, r.member_id, 'automation', 'assignment_reminder',
        'Lien promo attendu',
        r.name || ' t''attend — soumets ton lien promo depuis ton espace.',
        '/affiliate/promoteur?reminder=' || r.id,
        jsonb_build_object('name', r.name)
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
          (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
        VALUES (
          r.affiliate_id, NULL, 'automation', 'event_in_48h',
          'J-2 : ' || r.name,
          'La soirée est dans deux jours — dernier sprint de promo.',
          '/affiliate/promoteur?j2=' || r.id,
          jsonb_build_object('name', r.name)
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
          (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
        VALUES (
          r.affiliate_id, r.id, 'automation', 'linktree_stale',
          'Ton linktree est vide',
          'Aucune soirée à venir sur ta page — ajoute celles de la semaine.',
          '/affiliate/promoteur/linktree',
          '{}'::jsonb
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
            (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
          VALUES (
            r.affiliate_id, NULL, 'automation', 'weekly_top_promoter',
            'Top promoteur : ' || COALESCE(NULLIF(r.member_name, ''), 'un membre'),
            r.clicks || ' clics billetterie cette semaine. Qui le détrône ?',
            '/affiliate/analytics',
            jsonb_build_object('member_name', r.member_name, 'clicks', r.clicks)
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
            (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
          VALUES (
            r.affiliate_id, r.id, 'automation', 'weekly_recap',
            'Ta semaine en chiffres',
            r.views || ' vues et ' || r.clicks || ' clics sur tes pages ces 7 derniers jours.',
            '/affiliate/analytics',
            jsonb_build_object('views', r.views, 'clicks', r.clicks)
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
        v_lang := aff_admin_lang(r.affiliate_id);
        PERFORM emit_affiliate_app_notification(
          r.affiliate_id, NULL,
          'aff_missing_ticket_url',
          CASE v_lang WHEN 'fr' THEN 'Lien billetterie manquant' WHEN 'es' THEN 'Falta el enlace de entradas' ELSE 'Missing ticketing link' END,
          CASE v_lang
            WHEN 'fr' THEN r.name || ' (' || to_char(r.event_date, 'DD/MM') || ') est visible sans bouton de réservation.'
            WHEN 'es' THEN r.name || ' (' || to_char(r.event_date, 'DD/MM') || ') está visible sin botón de reserva.'
            ELSE r.name || ' (' || to_char(r.event_date, 'DD/MM') || ') is live without a booking button.'
          END,
          'high', 'affiliate_event', r.id, '{}'
        );
      END LOOP;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.run_affiliate_automation_sweep() FROM PUBLIC, anon, authenticated;
