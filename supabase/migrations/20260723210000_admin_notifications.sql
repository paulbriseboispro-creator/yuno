-- ─────────────────────────────────────────────────────────────────────────────
-- Boîte de réception super admin.
--
-- Les clubs ont `staff_notifications` (venue-scopé), les organisateurs ont
-- `organizer_notifications` (user-scopé). Le super admin n'a rien : les seules
-- choses qui remontent aujourd'hui sont celles qu'on va chercher à la main dans
-- une page ou un dashboard Stripe. Cette table est le troisième flux, de même
-- forme que les deux autres pour que le front les rende avec les mêmes
-- composants (bell + inbox).
--
-- Deux familles d'alertes :
--
--   1. ÉCHÉANCES (`admin_credential_deadlines`) — les choses qui cassent toutes
--      seules si personne ne les renouvelle. Le cas d'école : le secret OAuth
--      Sign in with Apple, qu'Apple force à régénérer tous les 6 mois. Passé le
--      délai, le bouton « Continuer avec Apple » du web casse du jour au
--      lendemain, et comme le natif continue de marcher la panne passe
--      inaperçue. Un registre daté + un balayage quotidien transforment ça en
--      trois rappels (J-30, J-14, J-7, J-2, J-1) plutôt qu'en incident.
--
--   2. ÉVÉNEMENTS PLATEFORME — un club s'inscrit, un promoteur conteste un
--      règlement, un feedback critique arrive, le mode maintenance s'allume.
--      Émis par des triggers SECURITY DEFINER au moment où ça se produit.
--
-- Ce flux est IN-APP uniquement (cloche + page /admin/alerts). Il ne passe
-- volontairement PAS par `platform_notification_settings` : ce registre-là
-- pilote les push envoyés AUX UTILISATEURS, et une alerte super admin n'a rien
-- à faire dans une liste que le super admin peut couper.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══ 1. Le flux ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Colonne de scope constante : il n'y a qu'un flux plateforme, mais la
  -- garder rend la config front identique aux deux autres inbox (une colonne
  -- de filtre + une valeur) et laisse la porte ouverte à un scope régional.
  scope             TEXT NOT NULL DEFAULT 'platform',
  event_id          UUID REFERENCES public.events(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL,
  title             TEXT NOT NULL,
  message           TEXT NOT NULL,
  reference_type    TEXT,
  -- TEXT et non UUID : côté plateforme une référence est tantôt un uuid
  -- (utilisateur, paiement), tantôt un id texte (venues.id est un slug),
  -- tantôt une clé d'échéance.
  reference_id      TEXT,
  priority          TEXT NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  -- Porte anti-répétition pour tout ce qui vient d'un balayage périodique :
  -- le balayage réinsère la même ligne chaque jour, l'index unique partiel la
  -- refuse. La granularité vit dans la clé (…:2026-07-23, …:2026-W30).
  dedup_key         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at           TIMESTAMPTZ,
  read_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_feed
  ON public.admin_notifications (scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
  ON public.admin_notifications (scope) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_notifications_dedup
  ON public.admin_notifications (dedup_key) WHERE dedup_key IS NOT NULL;

-- Realtime (idempotent — ajouter une table déjà publiée lève une erreur).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Lecture et marquage-lu réservés au super admin. Aucune policy INSERT : tout
-- passe par les triggers SECURITY DEFINER et le balayage cron, qui contournent
-- RLS. Un client ne fabrique jamais une alerte admin.
DROP POLICY IF EXISTS admin_notifications_select ON public.admin_notifications;
CREATE POLICY admin_notifications_select
  ON public.admin_notifications FOR SELECT
  USING (public.is_super_admin());

DROP POLICY IF EXISTS admin_notifications_update ON public.admin_notifications;
CREATE POLICY admin_notifications_update
  ON public.admin_notifications FOR UPDATE
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS admin_notifications_delete ON public.admin_notifications;
CREATE POLICY admin_notifications_delete
  ON public.admin_notifications FOR DELETE
  USING (public.is_super_admin());

-- ── Émetteur unique ──────────────────────────────────────────────────────────
-- Tous les producteurs (triggers + balayage) passent par ici, pour que la
-- déduplication et le contournement RLS soient écrits une seule fois.
CREATE OR REPLACE FUNCTION public.emit_admin_notification(
  p_type           TEXT,
  p_title          TEXT,
  p_message        TEXT,
  p_priority       TEXT  DEFAULT 'normal',
  p_reference_type TEXT  DEFAULT NULL,
  p_reference_id   TEXT  DEFAULT NULL,
  p_metadata       JSONB DEFAULT '{}'::jsonb,
  p_dedup_key      TEXT  DEFAULT NULL,
  p_event_id       UUID  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.admin_notifications (
    notification_type, title, message, priority,
    reference_type, reference_id, metadata, dedup_key, event_id
  ) VALUES (
    p_type, p_title, p_message, COALESCE(p_priority, 'normal'),
    p_reference_type, p_reference_id, COALESCE(p_metadata, '{}'::jsonb),
    p_dedup_key, p_event_id
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.emit_admin_notification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, UUID)
  FROM public, anon, authenticated;

-- ══ 2. Registre des échéances ════════════════════════════════════════════════
-- Une ligne = une chose qui expire. `due_at` NULL veut dire « pas encore datée »
-- : on ne devine pas la date de création d'un secret qu'on n'a pas vu naître,
-- donc les entrées livrées arrivent vides et une alerte hebdomadaire rappelle
-- de les dater. Un clic sur « Fait aujourd'hui » pose la date et la reconduit.

CREATE TABLE IF NOT EXISTS public.admin_credential_deadlines (
  key              TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  provider         TEXT NOT NULL,
  description      TEXT,
  console_url      TEXT,
  -- Périodicité de reconduction. 6 pour le secret Apple, 12 pour la plupart.
  interval_months  INT  NOT NULL DEFAULT 12 CHECK (interval_months BETWEEN 1 AND 60),
  due_at           DATE,
  last_rotated_at  DATE,
  -- Jours de préavis. Ordre décroissant par convention (lecture humaine).
  remind_days      INT[] NOT NULL DEFAULT ARRAY[30, 14, 7, 2, 1],
  -- `critical` = si ça expire, un flux utilisateur casse. Relance quotidienne
  -- en retard au lieu d'hebdomadaire, et priorité rehaussée d'un cran.
  severity         TEXT NOT NULL DEFAULT 'high'
                   CHECK (severity IN ('normal', 'high', 'critical')),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  -- Les entrées livrées avec la plateforme ne sont pas supprimables (on peut
  -- les désactiver). Celles ajoutées à la main, oui.
  is_builtin       BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_credential_deadlines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_credential_deadlines_all ON public.admin_credential_deadlines;
CREATE POLICY admin_credential_deadlines_all
  ON public.admin_credential_deadlines FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Les vraies échéances de Yuno. `due_at` reste NULL : à dater depuis
-- /admin/alerts, une fois qu'on sait quand chaque secret a été posé.
INSERT INTO public.admin_credential_deadlines
  (key, label, provider, description, console_url, interval_months, severity, is_builtin, remind_days)
VALUES
  ('apple_oauth_client_secret',
   'Secret OAuth Sign in with Apple',
   'Apple / Supabase',
   'Le client secret Apple est un JWT signé par la clé .p8 : Apple lui impose une durée de vie de 6 mois maximum. Quand il expire, le bouton « Continuer avec Apple » du site web casse net alors que la connexion native iOS, elle, continue de marcher — la panne ne se voit donc que sur le web. Régénérer depuis Supabase → Authentication → Providers → Apple (Team ID + Key ID + contenu du .p8).',
   'https://supabase.com/dashboard/project/fulawxvdlwtdlpkycixe/auth/providers',
   6, 'critical', true, ARRAY[30, 14, 7, 2, 1]),

  ('apple_developer_program',
   'Adhésion Apple Developer Program',
   'Apple',
   'Cotisation annuelle. Si elle expire, les apps sont retirées de l''App Store et les certificats deviennent invalides.',
   'https://developer.apple.com/account',
   12, 'critical', true, ARRAY[60, 30, 14, 7, 2, 1]),

  ('apple_distribution_certificate',
   'Certificat de distribution iOS + provisioning profiles',
   'Apple',
   'Les certificats de distribution et les provisioning profiles expirent au bout d''un an. Sans renouvellement, plus aucune build ne part vers TestFlight ou l''App Store.',
   'https://developer.apple.com/account/resources/certificates/list',
   12, 'high', true, ARRAY[30, 14, 7, 1]),

  ('apns_push_key',
   'Clé APNs (.p8) — push iOS',
   'Apple',
   'La clé APNs n''expire pas, mais elle mérite un audit périodique : vérifier qu''elle est toujours valide côté Apple, que le Key ID enregistré dans les secrets Supabase correspond, et qu''aucune copie ne traîne hors du gestionnaire de secrets.',
   'https://developer.apple.com/account/resources/authkeys/list',
   24, 'normal', true, ARRAY[30, 7]),

  ('google_play_service_account',
   'Clé du compte de service Play Console',
   'Google',
   'La clé JSON du compte de service qui publie sur Google Play. À faire tourner une fois par an.',
   'https://play.google.com/console',
   12, 'high', true, ARRAY[30, 14, 7, 1]),

  ('domain_yunoapp_eu',
   'Renouvellement du domaine yunoapp.eu',
   'Registrar',
   'Le domaine porte le site, les emails Resend et le CORS-lock des edge functions. S''il tombe, toute la plateforme tombe avec.',
   NULL,
   12, 'critical', true, ARRAY[60, 30, 14, 7, 2, 1]),

  ('stripe_api_keys',
   'Rotation des clés API Stripe',
   'Stripe',
   'Faire tourner la clé secrète et les clés restreintes utilisées par les edge functions. Vérifier au passage que les webhooks pointent toujours sur les bonnes URLs.',
   'https://dashboard.stripe.com/apikeys',
   12, 'high', true, ARRAY[30, 7, 1]),

  ('supabase_service_role_key',
   'Rotation des clés Supabase (service_role / anon)',
   'Supabase',
   'La service_role contourne RLS : une fuite est totale. Rotation annuelle, et immédiate au moindre doute.',
   'https://supabase.com/dashboard/project/fulawxvdlwtdlpkycixe/settings/api',
   12, 'high', true, ARRAY[30, 7, 1]),

  ('mapbox_token',
   'Rotation du token Mapbox',
   'Mapbox',
   'Token public exposé dans le bundle front. Le faire tourner une fois par an et vérifier que les restrictions d''URL couvrent bien yunoapp.eu uniquement.',
   'https://console.mapbox.com/account/access-tokens',
   12, 'normal', true, ARRAY[30, 7]),

  ('resend_api_key',
   'Rotation de la clé API Resend',
   'Resend',
   'Clé d''envoi des emails transactionnels. Vérifier aussi que les enregistrements SPF/DKIM du domaine sont toujours valides.',
   'https://resend.com/api-keys',
   12, 'normal', true, ARRAY[30, 7]),

  ('openai_api_key',
   'Rotation de la clé OpenAI (assistants Yuno)',
   'OpenAI',
   'Clé utilisée par yuno-assistant et owner-assistant. Vérifier au passage le plafond de dépense.',
   'https://platform.openai.com/api-keys',
   12, 'normal', true, ARRAY[30, 7]),

  ('vapid_web_push_keys',
   'Audit des clés VAPID (push web)',
   'Yuno',
   'Les clés VAPID n''expirent pas, mais les faire tourner invalide TOUS les abonnements push web existants. Audit périodique sans rotation, sauf incident.',
   NULL,
   24, 'normal', true, ARRAY[30]),

  ('rgpd_retention_review',
   'Revue de la politique de rétention RGPD',
   'Yuno',
   'Vérifier une fois par an que les durées de purge appliquées par purge_expired_personal_data correspondent toujours à ce qui est annoncé dans la politique de confidentialité.',
   NULL,
   12, 'high', true, ARRAY[30, 7]),

  ('legal_terms_review',
   'Revue des CGV, CGU et mentions légales',
   'Yuno',
   'Les conditions doivent refléter les fonctionnalités réellement vendues (billetterie, tables VIP, boissons, commissions promoteur). Toute évolution du modèle de frais impose une relecture.',
   NULL,
   12, 'high', true, ARRAY[30, 7])
ON CONFLICT (key) DO NOTHING;

-- ── Gestion depuis /admin/alerts ─────────────────────────────────────────────

-- Reconduit une échéance : pose la date de réalisation et repousse la suivante
-- d'une période. Solde aussi les alertes en cours pour cette clé — renouveler
-- doit vider l'inbox, pas laisser trois rappels périmés à cocher à la main.
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
  IF NOT public.is_super_admin() THEN
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

-- Pose une date d'échéance connue sans repartir d'aujourd'hui (cas : le secret
-- a été créé il y a deux mois, l'échéance réelle est dans quatre).
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
  IF NOT public.is_super_admin() THEN
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

-- Création / édition d'une échéance maison (un contrat, une assurance, un
-- audit). Les entrées livrées gardent leur libellé et leur description : seuls
-- la périodicité, la sévérité, les préavis et les notes restent modifiables.
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
  IF NOT public.is_super_admin() THEN
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
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Une échéance livrée se désactive, elle ne se supprime pas : la reperdre
  -- de vue est précisément le risque qu'on cherche à couvrir.
  DELETE FROM public.admin_credential_deadlines
   WHERE key = p_key AND is_builtin = false;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_mark_credential_renewed(TEXT, DATE) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_set_credential_due(TEXT, DATE) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_credential_deadline(TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, DATE, INT[], TEXT, BOOLEAN) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_delete_credential_deadline(TEXT) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.admin_mark_credential_renewed(TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_credential_due(TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_credential_deadline(TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, DATE, INT[], TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_credential_deadline(TEXT) TO authenticated;

-- ══ 3. Triggers — les événements plateforme ══════════════════════════════════
--
-- Tous les corps sont enveloppés d'un EXCEPTION WHEN OTHERS qui laisse passer
-- l'écriture métier. Une alerte d'observabilité ne doit JAMAIS empêcher un club
-- de s'inscrire ou un feedback d'être déposé.

-- ── Nouveau club ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_new_venue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emit_admin_notification(
    'admin_new_venue',
    'Nouveau club sur Yuno',
    NEW.name || ' vient d''être créé (' || COALESCE(NEW.city, 'ville non renseignée') || ').',
    'normal', 'venue', NEW.id,
    jsonb_build_object('venue_id', NEW.id, 'name', NEW.name, 'city', NEW.city),
    'new_venue:' || NEW.id
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_new_venue ON public.venues;
CREATE TRIGGER trg_notify_admin_new_venue
  AFTER INSERT ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_venue();

-- ── Nouvel organisateur ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_new_organizer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emit_admin_notification(
    'admin_new_organizer',
    'Nouvel organisateur',
    NEW.display_name || ' a créé son profil organisateur' ||
      COALESCE(' (' || NEW.city || ')', '') || '.',
    'normal', 'organizer', NEW.user_id::text,
    jsonb_build_object('user_id', NEW.user_id, 'display_name', NEW.display_name, 'city', NEW.city),
    'new_organizer:' || NEW.user_id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_new_organizer ON public.organizer_profiles;
CREATE TRIGGER trg_notify_admin_new_organizer
  AFTER INSERT ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_organizer();

-- ── Nouvelle agence ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_new_agency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emit_admin_notification(
    'admin_new_agency',
    'Nouvelle agence de promoteurs',
    NEW.name || ' vient d''être créée' || COALESCE(' (' || NEW.city || ')', '') || '.',
    'normal', 'agency', NEW.id::text,
    jsonb_build_object('agency_id', NEW.id, 'name', NEW.name, 'city', NEW.city),
    'new_agency:' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_new_agency ON public.agencies;
CREATE TRIGGER trg_notify_admin_new_agency
  AFTER INSERT ON public.agencies
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_agency();

-- ── Inscription waitlist ─────────────────────────────────────────────────────
-- Priorité basse : c'est un signal de traction, pas une action à faire.
CREATE OR REPLACE FUNCTION public.notify_admin_waitlist_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emit_admin_notification(
    'admin_waitlist_signup',
    'Inscription à la liste d''attente',
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), ''), NEW.email) ||
      COALESCE(' — ' || NEW.city, '') || '.',
    'low', 'waitlist', NEW.id::text,
    jsonb_build_object('email', NEW.email, 'city', NEW.city),
    'waitlist:' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_waitlist_signup ON public.launch_waitlist;
CREATE TRIGGER trg_notify_admin_waitlist_signup
  AFTER INSERT ON public.launch_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_waitlist_signup();

-- ── Feedback / bug ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_critical BOOLEAN := NEW.priority IN ('critical', 'high');
  v_venue    TEXT;
BEGIN
  IF NEW.venue_id IS NOT NULL THEN
    SELECT name INTO v_venue FROM public.venues WHERE id = NEW.venue_id;
  END IF;

  PERFORM public.emit_admin_notification(
    CASE WHEN v_critical THEN 'admin_feedback_critical' ELSE 'admin_feedback_new' END,
    CASE WHEN v_critical THEN 'Feedback prioritaire' ELSE 'Nouveau feedback' END,
    NEW.title || COALESCE(' — ' || v_venue, '') ||
      ' (' || NEW.category || ', priorité ' || NEW.priority || ').',
    CASE WHEN NEW.priority = 'critical' THEN 'urgent'
         WHEN NEW.priority = 'high'     THEN 'high'
         ELSE 'normal' END,
    'feedback', NEW.id::text,
    jsonb_build_object('category', NEW.category, 'priority', NEW.priority, 'venue_id', NEW.venue_id),
    'feedback:' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_feedback ON public.feedback_issues;
CREATE TRIGGER trg_notify_admin_feedback
  AFTER INSERT ON public.feedback_issues
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_feedback();

-- ── Litige de règlement promoteur ────────────────────────────────────────────
-- Le seul cas où de l'argent est bloqué entre deux tiers et où Yuno arbitre.
CREATE OR REPLACE FUNCTION public.notify_admin_payout_disputed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue TEXT;
BEGIN
  IF NEW.status <> 'disputed' OR OLD.status = 'disputed' THEN RETURN NEW; END IF;

  IF NEW.venue_id IS NOT NULL THEN
    SELECT name INTO v_venue FROM public.venues WHERE id = NEW.venue_id;
  END IF;

  PERFORM public.emit_admin_notification(
    'admin_payout_disputed',
    'Règlement promoteur contesté',
    'Un promoteur conteste un règlement de ' || to_char(NEW.amount, 'FM999999990.00') || ' €' ||
      COALESCE(' chez ' || v_venue, '') || '. ' ||
      COALESCE('Motif : ' || NEW.dispute_reason, 'Aucun motif renseigné') || '.',
    'urgent', 'promoter_payout', NEW.id::text,
    jsonb_build_object(
      'payout_id', NEW.id, 'promoter_id', NEW.promoter_id, 'amount', NEW.amount,
      'venue_id', NEW.venue_id, 'organizer_user_id', NEW.organizer_user_id,
      'dispute_reason', NEW.dispute_reason
    ),
    'payout_disputed:' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_payout_disputed ON public.promoter_payouts;
CREATE TRIGGER trg_notify_admin_payout_disputed
  AFTER UPDATE OF status ON public.promoter_payouts
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_payout_disputed();

-- ── Demande de désactivation MFA ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_mfa_reset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emit_admin_notification(
    'admin_mfa_reset_requested',
    'Demande de désactivation MFA',
    NEW.email || ' demande la désactivation de sa double authentification.',
    'high', 'user', NEW.user_id::text,
    jsonb_build_object('email', NEW.email, 'user_id', NEW.user_id),
    'mfa_reset:' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_mfa_reset ON public.mfa_disable_requests;
CREATE TRIGGER trg_notify_admin_mfa_reset
  AFTER INSERT ON public.mfa_disable_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_mfa_reset();

-- ── Mode maintenance / paiements coupés ──────────────────────────────────────
-- Une bascule d'interrupteur global laisse une trace : c'est ce qui évite de
-- découvrir trois jours plus tard que la plateforme est restée fermée.
CREATE OR REPLACE FUNCTION public.notify_admin_platform_switch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.maintenance_mode IS DISTINCT FROM OLD.maintenance_mode THEN
    PERFORM public.emit_admin_notification(
      'admin_maintenance_mode',
      CASE WHEN NEW.maintenance_mode THEN 'Mode maintenance ACTIVÉ' ELSE 'Mode maintenance levé' END,
      CASE WHEN NEW.maintenance_mode
           THEN 'La plateforme est fermée au public. Seuls le super admin et les porteurs du mot de passe passent.'
           ELSE 'La plateforme est de nouveau ouverte au public.' END,
      CASE WHEN NEW.maintenance_mode THEN 'urgent' ELSE 'normal' END,
      'app_settings', NEW.id::text,
      jsonb_build_object('maintenance_mode', NEW.maintenance_mode),
      'maintenance:' || NEW.maintenance_mode::text || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI')
    );
  END IF;

  IF NEW.payments_disabled IS DISTINCT FROM OLD.payments_disabled THEN
    PERFORM public.emit_admin_notification(
      'admin_payments_switch',
      CASE WHEN NEW.payments_disabled THEN 'Paiements COUPÉS' ELSE 'Paiements rétablis' END,
      CASE WHEN NEW.payments_disabled
           THEN 'Plus aucun paiement ne peut aboutir sur la plateforme : ni billet, ni table, ni boisson.'
           ELSE 'Les paiements sont de nouveau acceptés.' END,
      CASE WHEN NEW.payments_disabled THEN 'urgent' ELSE 'normal' END,
      'app_settings', NEW.id::text,
      jsonb_build_object('payments_disabled', NEW.payments_disabled),
      'payments:' || NEW.payments_disabled::text || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI')
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_platform_switch ON public.app_settings;
CREATE TRIGGER trg_notify_admin_platform_switch
  AFTER UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_platform_switch();

-- ── Abonnement club ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_subscription_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_venue TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_venue FROM public.venues WHERE id = NEW.venue_id;

  PERFORM public.emit_admin_notification(
    'admin_subscription_changed',
    CASE NEW.status
      WHEN 'active'   THEN 'Nouvel abonnement actif'
      WHEN 'canceled' THEN 'Abonnement résilié'
      WHEN 'past_due' THEN 'Abonnement impayé'
      ELSE 'Abonnement mis à jour'
    END,
    COALESCE(v_venue, NEW.venue_id) || ' : ' ||
      COALESCE(OLD.status, 'inconnu') || ' → ' || NEW.status || '.',
    CASE WHEN NEW.status IN ('past_due', 'unpaid', 'canceled') THEN 'high' ELSE 'normal' END,
    'venue', NEW.venue_id,
    jsonb_build_object('venue_id', NEW.venue_id, 'from', OLD.status, 'to', NEW.status),
    'subscription:' || NEW.venue_id || ':' || NEW.status || ':' || to_char(now(), 'YYYY-MM-DD')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_subscription_changed ON public.venue_subscriptions;
CREATE TRIGGER trg_notify_admin_subscription_changed
  AFTER UPDATE OF status ON public.venue_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_subscription_changed();

-- ── Rafale d'échecs d'authentification ───────────────────────────────────────
-- Le compte n'est fait QUE sur un échec : les succès (le cas courant) sortent
-- immédiatement sans toucher à l'index.
CREATE OR REPLACE FUNCTION public.notify_admin_security_burst()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_fails INT;
BEGIN
  IF NEW.success IS NOT FALSE THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_fails
    FROM public.security_logs
   WHERE success IS FALSE
     AND created_at > now() - interval '15 minutes';

  IF v_fails < 10 THEN RETURN NEW; END IF;

  PERFORM public.emit_admin_notification(
    'admin_security_burst',
    'Rafale d''échecs d''authentification',
    v_fails || ' tentatives échouées sur les 15 dernières minutes. Vérifier le journal d''audit avant de conclure à un utilisateur maladroit.',
    'urgent', 'security_log', NEW.id::text,
    jsonb_build_object('failures_15min', v_fails, 'last_action', NEW.action, 'ip', NEW.ip_address),
    'security_burst:' || to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_notify_admin_security_burst ON public.security_logs;
CREATE TRIGGER trg_notify_admin_security_burst
  AFTER INSERT ON public.security_logs
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_security_burst();

-- ══ 4. Balayage quotidien ════════════════════════════════════════════════════
-- Tout ce qui ne se déclenche pas sur une écriture : les échéances, et les
-- situations qui se constatent en regardant l'état du système plutôt qu'un
-- événement (un club bloqué, une première vente, une file qui ne se vide pas).

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
  -- ── 4.1 Échéances datées ──────────────────────────────────────────────────
  FOR r IN
    SELECT * FROM public.admin_credential_deadlines
     WHERE is_active AND due_at IS NOT NULL
  LOOP
    v_days := r.due_at - CURRENT_DATE;

    IF v_days < 0 THEN
      -- Dépassée. Une échéance critique relance tous les jours (un flux
      -- utilisateur est déjà cassé), les autres une fois par semaine.
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

  -- ── 4.2 Échéances jamais datées ───────────────────────────────────────────
  -- Une échéance sans date ne surveille rien. Rappel hebdomadaire tant qu'il en
  -- reste, avec le compte : c'est le seul angle mort du système.
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

  -- ── 4.3 Clubs bloqués sur l'onboarding Stripe ─────────────────────────────
  -- Un club sans Stripe Connect terminé ne peut rien encaisser. Alerte unique
  -- au 7e jour : au-delà c'est un lead à rappeler, pas une notification à
  -- répéter tous les matins.
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

  -- ── 4.4 Première vente d'un club ──────────────────────────────────────────
  -- Le signal d'activation d'un SaaS : le jour où un club encaisse pour la
  -- première fois. Restreint aux clubs de moins de 180 jours pour ne pas
  -- balayer tout l'historique chaque nuit.
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

  -- ── 4.5 Pic de remboursements plateforme ──────────────────────────────────
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

  -- ── 4.6 File de push promoteur qui ne se vide pas ─────────────────────────
  -- La file est vidangée toutes les 5 min par le cron edge. Des lignes dues
  -- depuis plus de deux heures veulent dire que le cron ne tourne plus.
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

REVOKE ALL ON FUNCTION public.run_admin_alert_sweep() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.run_admin_alert_sweep() TO authenticated;

-- ── Purge ────────────────────────────────────────────────────────────────────
-- L'inbox ne lit que 30 jours ; garder 180 jours laisse de quoi remonter le fil
-- d'un incident sans faire grossir la table indéfiniment.
CREATE OR REPLACE FUNCTION public.purge_admin_notifications()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted INT;
BEGIN
  WITH gone AS (
    DELETE FROM public.admin_notifications
     WHERE created_at < now() - interval '180 days'
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM gone;
  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.purge_admin_notifications() FROM public, anon, authenticated;

-- ══ 5. Planification ═════════════════════════════════════════════════════════
-- 07:00 UTC ≈ 9 h à Paris : les rappels sont là au réveil, pas au milieu de la
-- nuit quand les clubs sont encore en service.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('admin-alert-sweep')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-alert-sweep');
    PERFORM cron.unschedule('admin-notifications-purge')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-notifications-purge');

    PERFORM cron.schedule('admin-alert-sweep', '0 7 * * *',
      $cron$ SELECT public.run_admin_alert_sweep(); $cron$);

    PERFORM cron.schedule('admin-notifications-purge', '40 4 * * *',
      $cron$ SELECT public.purge_admin_notifications(); $cron$);
  END IF;
END $$;
