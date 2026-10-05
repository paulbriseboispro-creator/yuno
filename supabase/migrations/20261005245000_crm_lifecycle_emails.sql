-- Yuno CRM : les e-mails du cycle de vie que Yuno envoie LUI-MÊME aux pros
-- (Admin CRM › Réglages › E-mails du cycle de vie).
--
--   • crm_lifecycle_emails : un modèle par e-mail (textes FR / EN / ES),
--     un interrupteur, ÉTEINT par défaut. Allumer pose enabled_at : un e-mail
--     ne part jamais pour un fait antérieur à son allumage (pas de rafale sur
--     la base existante).
--   • crm_lifecycle_sends : le journal ET le registre anti-doublon (une ligne par
--     e-mail, compte et déclencheur, jamais deux fois). Une ligne écartée garde
--     sa raison (demo_no_send, suppressed, fatigue…).
--   • crm_lifecycle_collect() (service_role) : lit les faits en base, inscrit
--     les lignes dues et rend celles à envoyer ; l'envoi est fait par
--     process-scheduled-campaigns (_shared/crm-lifecycle-emails.ts), qui marque
--     chaque ligne par crm_lifecycle_mark().
--
-- Déclencheurs (tous lus en base) :
--   welcome        compte créé (crm_subscriptions) depuis l'allumage, < 48 h
--   connect_j1     compte créé il y a 24 à 72 h, aucune billetterie connectée
--   base_ready     première synchro réussie, < 48 h
--   trial_ending   essai qui se termine dans 1 à 2 jours (J-2)
--   payment_failed abonnement en retard de paiement (past_due / unpaid)
--   paused         compte passé en pause (fin d'essai sans abonnement)
--   low_balance    solde de Yunits sous le seuil low_balance (une fois par mois)
--   winback        30 jours après une pause ou une résiliation
-- En démo, rien ne part : la ligne est écrite 'skipped' / demo_no_send.

CREATE TABLE IF NOT EXISTS public.crm_lifecycle_emails (
  key         text PRIMARY KEY CHECK (key IN ('welcome', 'connect_j1', 'base_ready', 'trial_ending', 'payment_failed', 'paused', 'low_balance', 'winback')),
  position    integer NOT NULL DEFAULT 0,
  family      text NOT NULL CHECK (family IN ('onboarding', 'billing')),
  enabled     boolean NOT NULL DEFAULT false,
  enabled_at  timestamptz,
  copy        jsonb NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_lifecycle_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_lifecycle_emails FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_lifecycle_sends (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL REFERENCES public.crm_lifecycle_emails(key),
  scope_key    text NOT NULL,
  trigger_key  text NOT NULL,
  email        text,
  lang         text NOT NULL DEFAULT 'fr',
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped', 'failed')),
  reason       text,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  UNIQUE (key, scope_key, trigger_key)
);
CREATE INDEX IF NOT EXISTS crm_lifecycle_sends_queued_idx ON public.crm_lifecycle_sends (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS crm_lifecycle_sends_key_idx ON public.crm_lifecycle_sends (key, created_at DESC);
ALTER TABLE public.crm_lifecycle_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_lifecycle_sends FROM anon, authenticated;

INSERT INTO public.crm_lifecycle_emails (key, position, family, copy) VALUES
('welcome', 1, 'onboarding', $j${
 "fr": {"subject": "Bienvenue sur Yuno CRM", "title": "Votre console est prête", "body": "Votre essai commence aujourd’hui. Première étape : connectez votre billetterie, Yuno importe vos acheteurs et vos soirées tout seul.", "cta": "Ouvrir ma console"},
 "en": {"subject": "Welcome to Yuno CRM", "title": "Your console is ready", "body": "Your trial starts today. First step: connect your ticketing, Yuno imports your buyers and your nights on its own.", "cta": "Open my console"},
 "es": {"subject": "Bienvenido a Yuno CRM", "title": "Tu consola está lista", "body": "Tu prueba empieza hoy. Primer paso: conecta tu ticketera, Yuno importa tus compradores y tus noches solo.", "cta": "Abrir mi consola"}}$j$),
('connect_j1', 2, 'onboarding', $j${
 "fr": {"subject": "Connectez votre billetterie en 2 minutes", "title": "Il manque votre billetterie", "body": "Tant qu’elle n’est pas connectée, votre base reste vide. Collez votre clé Shotgun ou importez un fichier : c’est fait en deux minutes.", "cta": "Connecter ma billetterie"},
 "en": {"subject": "Connect your ticketing in 2 minutes", "title": "Your ticketing is missing", "body": "Until it is connected, your base stays empty. Paste your Shotgun key or import a file: it takes two minutes.", "cta": "Connect my ticketing"},
 "es": {"subject": "Conecta tu ticketera en 2 minutos", "title": "Falta tu ticketera", "body": "Mientras no esté conectada, tu base sigue vacía. Pega tu clave de Shotgun o importa un archivo: son dos minutos.", "cta": "Conectar mi ticketera"}}$j$),
('base_ready', 3, 'onboarding', $j${
 "fr": {"subject": "Votre base est prête", "title": "Vos clients sont arrivés", "body": "La première synchro est terminée : vos acheteurs et vos soirées sont dans Yuno. Allumez une recette, Yuno écrit au bon moment à la bonne personne.", "cta": "Voir mes clients"},
 "en": {"subject": "Your base is ready", "title": "Your customers are in", "body": "The first sync is done: your buyers and your nights are in Yuno. Turn on a recipe, Yuno writes to the right person at the right time.", "cta": "See my customers"},
 "es": {"subject": "Tu base está lista", "title": "Tus clientes ya están", "body": "La primera sincronización ha terminado: tus compradores y tus noches están en Yuno. Activa una receta, Yuno escribe a la persona adecuada en el momento adecuado.", "cta": "Ver mis clientes"}}$j$),
('trial_ending', 4, 'billing', $j${
 "fr": {"subject": "Votre essai se termine dans 2 jours", "title": "Plus que 2 jours d’essai", "body": "Abonnez-vous pour garder vos envois, vos automatisations et vos synchros. Sans abonnement, votre compte passe en pause : vos données restent lisibles et exportables.", "cta": "Choisir mon abonnement"},
 "en": {"subject": "Your trial ends in 2 days", "title": "2 days of trial left", "body": "Subscribe to keep your sends, automations and syncs. Without a subscription, your account is paused: your data stays readable and exportable.", "cta": "Choose my plan"},
 "es": {"subject": "Tu prueba termina en 2 días", "title": "Quedan 2 días de prueba", "body": "Suscríbete para mantener tus envíos, automatizaciones y sincronizaciones. Sin suscripción, tu cuenta queda en pausa: tus datos siguen legibles y exportables.", "cta": "Elegir mi suscripción"}}$j$),
('payment_failed', 5, 'billing', $j${
 "fr": {"subject": "Votre paiement n’est pas passé", "title": "Le paiement a échoué", "body": "Votre banque a refusé le dernier prélèvement de Yuno CRM. Mettez votre carte à jour pour ne rien interrompre.", "cta": "Mettre à jour ma carte"},
 "en": {"subject": "Your payment did not go through", "title": "The payment failed", "body": "Your bank declined the last Yuno CRM charge. Update your card so nothing stops.", "cta": "Update my card"},
 "es": {"subject": "Tu pago no se ha completado", "title": "El pago ha fallado", "body": "Tu banco ha rechazado el último cargo de Yuno CRM. Actualiza tu tarjeta para que nada se detenga.", "cta": "Actualizar mi tarjeta"}}$j$),
('paused', 6, 'billing', $j${
 "fr": {"subject": "Votre compte est en pause", "title": "Votre compte est en pause", "body": "Votre essai est terminé. Vos données restent lisibles et exportables ; les synchros et les envois reprennent dès que vous vous abonnez.", "cta": "Reprendre"},
 "en": {"subject": "Your account is paused", "title": "Your account is paused", "body": "Your trial is over. Your data stays readable and exportable; syncs and sends resume as soon as you subscribe.", "cta": "Resume"},
 "es": {"subject": "Tu cuenta está en pausa", "title": "Tu cuenta está en pausa", "body": "Tu prueba ha terminado. Tus datos siguen legibles y exportables; las sincronizaciones y los envíos se reanudan en cuanto te suscribes.", "cta": "Reanudar"}}$j$),
('low_balance', 7, 'billing', $j${
 "fr": {"subject": "Il vous reste peu de Yunits", "title": "Votre solde de Yunits est bas", "body": "Il vous reste {balance} Yunits. Rechargez pour que vos prochains envois partent sans attendre.", "cta": "Recharger"},
 "en": {"subject": "You are running low on Yunits", "title": "Your Yunit balance is low", "body": "You have {balance} Yunits left. Top up so your next sends go out without waiting.", "cta": "Top up"},
 "es": {"subject": "Te quedan pocos Yunits", "title": "Tu saldo de Yunits es bajo", "body": "Te quedan {balance} Yunits. Recarga para que tus próximos envíos salgan sin esperar.", "cta": "Recargar"}}$j$),
('winback', 8, 'onboarding', $j${
 "fr": {"subject": "On vous garde votre place", "title": "Vos données vous attendent", "body": "Votre base et vos soirées sont toujours là. Reprenez votre abonnement quand vous voulez : tout repart d’où vous l’aviez laissé.", "cta": "Revenir sur Yuno"},
 "en": {"subject": "We kept your place", "title": "Your data is waiting", "body": "Your base and your nights are still here. Resume your subscription whenever you like: everything picks up where you left it.", "cta": "Come back to Yuno"},
 "es": {"subject": "Te guardamos tu sitio", "title": "Tus datos te esperan", "body": "Tu base y tus noches siguen aquí. Retoma tu suscripción cuando quieras: todo sigue donde lo dejaste.", "cta": "Volver a Yuno"}}$j$)
ON CONFLICT (key) DO NOTHING;

-- ── Collecte (service_role) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_lifecycle_collect(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg jsonb := public.crm_pricing_config();
  v_low integer := COALESCE((cfg->>'low_balance')::int, 1000);
  v_rows jsonb;
  v_out jsonb;
  v_new integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_lifecycle_emails WHERE enabled) THEN
    RETURN jsonb_build_object('queued', '[]'::jsonb, 'copies', '{}'::jsonb);
  END IF;
  v_rows := public._crm_admin_rows(true);

  WITH acc AS (
    SELECT r->>'id' AS id, r->>'name' AS name, lower(r->>'email') AS email, r->>'state' AS state,
           (r->>'trial_ends_at')::timestamptz AS trial_ends_at, (r->>'balance')::int AS balance,
           (r->>'sub_created')::timestamptz AS sub_created, COALESCE((r->>'is_demo')::boolean, false) AS is_demo,
           r->>'sub_status' AS sub_status, r->>'sync' AS sync,
           COALESCE((SELECT NULLIF(p.preferred_language, '') FROM public.profiles p WHERE lower(p.email) = lower(r->>'email') LIMIT 1), 'fr') AS lang
      FROM jsonb_array_elements(v_rows) r
  ), sub AS (
    SELECT s.scope_key, s.updated_at FROM public.crm_subscriptions s
  ), conn AS (
    SELECT public.crm_scope_key(c.venue_id, c.organizer_user_id) AS id,
           (SELECT min(x.finished_at) FROM public.ticketing_sync_runs x WHERE x.connection_id = c.id AND x.status = 'ok') AS first_ok
      FROM public.ticketing_connections c
  ), en AS (
    SELECT key, enabled_at FROM public.crm_lifecycle_emails WHERE enabled
  ), due AS (
    SELECT 'welcome' AS key, a.*, 'once' AS tk, '{}'::jsonb AS meta FROM acc a, en
     WHERE en.key = 'welcome' AND a.sub_created >= en.enabled_at AND a.sub_created > now() - interval '48 hours'
    UNION ALL
    SELECT 'connect_j1', a.*, 'once', '{}'::jsonb FROM acc a, en
     WHERE en.key = 'connect_j1' AND a.sub_created >= en.enabled_at - interval '24 hours'
       AND a.sub_created BETWEEN now() - interval '72 hours' AND now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM conn c WHERE c.id = a.id) AND a.state IN ('trial', 'paid')
    UNION ALL
    SELECT 'base_ready', a.*, 'once', '{}'::jsonb FROM acc a JOIN conn c ON c.id = a.id, en
     WHERE en.key = 'base_ready' AND c.first_ok >= en.enabled_at AND c.first_ok > now() - interval '48 hours'
    UNION ALL
    SELECT 'trial_ending', a.*, 'trial:' || a.trial_ends_at::date, jsonb_build_object('ends', a.trial_ends_at) FROM acc a, en
     WHERE en.key = 'trial_ending' AND a.state = 'trial' AND a.trial_ends_at BETWEEN now() + interval '1 day' AND now() + interval '2 days'
    UNION ALL
    SELECT 'payment_failed', a.*, 'pd:' || COALESCE(s.updated_at::date::text, 'x'), '{}'::jsonb FROM acc a LEFT JOIN sub s ON s.scope_key = a.id, en
     WHERE en.key = 'payment_failed' AND a.state = 'late' AND COALESCE(s.updated_at, now()) >= en.enabled_at - interval '1 day'
    UNION ALL
    SELECT 'paused', a.*, 'pause:' || COALESCE(s.updated_at::date::text, a.trial_ends_at::date::text, 'x'), '{}'::jsonb FROM acc a LEFT JOIN sub s ON s.scope_key = a.id, en
     WHERE en.key = 'paused' AND a.state = 'paused' AND COALESCE(s.updated_at, a.trial_ends_at, now()) >= en.enabled_at - interval '1 day'
    UNION ALL
    SELECT 'low_balance', a.*, 'lb:' || to_char(now(), 'YYYY-MM'), jsonb_build_object('balance', a.balance) FROM acc a, en
     WHERE en.key = 'low_balance' AND a.state IN ('trial', 'paid', 'late') AND a.balance < v_low
    UNION ALL
    SELECT 'winback', a.*, 'wb:' || s.updated_at::date, '{}'::jsonb FROM acc a JOIN sub s ON s.scope_key = a.id, en
     WHERE en.key = 'winback' AND a.state IN ('paused', 'churned')
       AND s.updated_at BETWEEN now() - interval '33 days' AND now() - interval '30 days'
  ), ins AS (
    INSERT INTO public.crm_lifecycle_sends (key, scope_key, trigger_key, email, lang, status, reason, meta)
    SELECT d.key, d.id, d.tk, d.email, CASE WHEN d.lang IN ('fr', 'en', 'es') THEN d.lang ELSE 'fr' END,
           CASE WHEN d.is_demo OR public.is_demo_email(d.email) THEN 'skipped'
                WHEN d.email IS NULL OR position('@' in d.email) <= 1 THEN 'skipped'
                WHEN public.is_email_suppressed(d.email) THEN 'skipped'
                WHEN d.key IN ('welcome', 'connect_j1', 'base_ready', 'low_balance', 'winback')
                     AND public.email_send_policy(d.email, 'automation') IS NOT NULL THEN 'skipped'
                ELSE 'queued' END,
           CASE WHEN d.is_demo OR public.is_demo_email(d.email) THEN 'demo_no_send'
                WHEN d.email IS NULL OR position('@' in d.email) <= 1 THEN 'no_email'
                WHEN public.is_email_suppressed(d.email) THEN 'suppressed'
                WHEN d.key IN ('welcome', 'connect_j1', 'base_ready', 'low_balance', 'winback')
                     THEN public.email_send_policy(d.email, 'automation') END,
           d.meta || jsonb_build_object('name', d.name)
      FROM due d
    ON CONFLICT (key, scope_key, trigger_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;

  -- Les lignes à envoyer (nouvelles ou en échec de moins de 3 tentatives).
  WITH q AS (
    SELECT s.* FROM public.crm_lifecycle_sends s
      JOIN public.crm_lifecycle_emails e ON e.key = s.key AND e.enabled
     WHERE s.status = 'queued' AND s.attempts < 3 AND s.created_at > now() - interval '3 days'
     ORDER BY s.created_at LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
     FOR UPDATE OF s SKIP LOCKED
  ), up AS (
    UPDATE public.crm_lifecycle_sends s SET attempts = s.attempts + 1 FROM q WHERE s.id = q.id
    RETURNING s.id, s.key, s.scope_key, s.email, s.lang, s.meta
  )
  SELECT jsonb_build_object(
           'new', v_new, 'queued', COALESCE((SELECT jsonb_agg(to_jsonb(up)) FROM up), '[]'::jsonb),
           'copies', (SELECT jsonb_object_agg(key, copy) FROM public.crm_lifecycle_emails WHERE enabled))
    INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_lifecycle_collect(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_lifecycle_collect(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_lifecycle_mark(p_id uuid, p_ok boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.crm_lifecycle_sends
     SET status = CASE WHEN p_ok THEN 'sent' WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
         sent_at = CASE WHEN p_ok THEN now() ELSE sent_at END,
         reason = CASE WHEN p_ok THEN NULL ELSE left(p_reason, 200) END
   WHERE id = p_id AND status = 'queued';
$$;
REVOKE ALL ON FUNCTION public.crm_lifecycle_mark(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_lifecycle_mark(uuid, boolean, text) TO service_role;

-- ── Admin : lecture et interrupteur ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('at', now(), 'emails', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'key', e.key, 'family', e.family, 'enabled', e.enabled, 'enabled_at', e.enabled_at, 'copy', e.copy, 'updated_at', e.updated_at,
             'sent30', (SELECT count(*) FROM public.crm_lifecycle_sends s WHERE s.key = e.key AND s.status = 'sent' AND s.sent_at > now() - interval '30 days'),
             'sent', (SELECT count(*) FROM public.crm_lifecycle_sends s WHERE s.key = e.key AND s.status = 'sent'),
             'skipped30', (SELECT count(*) FROM public.crm_lifecycle_sends s WHERE s.key = e.key AND s.status = 'skipped' AND s.created_at > now() - interval '30 days'),
             'failed30', (SELECT count(*) FROM public.crm_lifecycle_sends s WHERE s.key = e.key AND s.status = 'failed' AND s.created_at > now() - interval '30 days'),
             'last_at', (SELECT max(s.sent_at) FROM public.crm_lifecycle_sends s WHERE s.key = e.key)
           ) ORDER BY e.position)
      FROM public.crm_lifecycle_emails e), '[]'::jsonb),
    'log', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
      SELECT jsonb_build_object('at', COALESCE(s.sent_at, s.created_at), 'key', s.key, 'scope', s.scope_key, 'status', s.status, 'reason', s.reason, 'name', s.meta->>'name') AS x
        FROM public.crm_lifecycle_sends s ORDER BY COALESCE(s.sent_at, s.created_at) DESC LIMIT 40) q), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_lifecycle() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_lifecycle() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_lifecycle_toggle(p_key text, p_enabled boolean, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  IF COALESCE(length(trim(p_reason)), 0) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_lifecycle_emails
     SET enabled = COALESCE(p_enabled, false),
         enabled_at = CASE WHEN COALESCE(p_enabled, false) AND NOT enabled THEN now() WHEN NOT COALESCE(p_enabled, false) THEN NULL ELSE enabled_at END,
         updated_by = auth.uid(), updated_at = now()
   WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_email' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN p_enabled THEN 'crm_lifecycle_on' ELSE 'crm_lifecycle_off' END, 'crm_lifecycle', p_key,
          jsonb_build_object('reason', left(trim(p_reason), 300)));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_lifecycle_toggle(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_lifecycle_toggle(text, boolean, text) TO authenticated, service_role;
