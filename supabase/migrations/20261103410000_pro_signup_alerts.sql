-- ═══════════════════════════════════════════════════════════════════════════
-- Alertes d'inscription pro : Paul est prévenu sur son téléphone (Cockpit)
-- à chaque pro qui arrive SANS invitation de sa part (demande du 19/10/2026,
-- après Poupée et Lillo Bacio, inscrits seuls depuis la landing).
--
-- Une seule source : les alertes plateforme déjà émises (`admin_notifications`).
-- Un déclencheur met chaque alerte d'inscription dans une file
-- (`pro_signup_alerts`) puis réveille tout de suite la fonction
-- process-scheduled-campaigns (tâche `pro_signup_alerts`), qui :
--   1. construit la fiche (`pro_signup_alert_payload`) et l'envoie au Cockpit
--      de Paul, qui crée ou met à jour le prospect et pousse la notification ;
--   2. cherche sur le web qui est la structure (nom + ville + type, jamais le
--      téléphone ni l'e-mail complet) et complète la fiche.
-- Le passage régulier du cron reprend ce que l'appel immédiat a raté.
--
-- Ce qui part : compte créé (`admin_pro_signup`), demande promoteur / autre
-- (`admin_pro_signup_lead`), formulaire « ouvrir un club » de l'app
-- (`admin_pro_lead`), formulaire pro de Yuno Links, formulaire de contact de
-- la landing (`admin_landing_contact`, nouveau), inscription BLOQUÉE
-- (`admin_pro_signup_stalled`, nouveau, balayage toutes les 15 min) et compte
-- pro supprimé (`admin_pro_account_deleted`, nouveau, posé par delete-account).
-- Ce qui ne part pas : une inscription née d'une invitation de Paul
-- (invitation Yuno CRM, lien démo « compte à créer »), un compte démo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La file ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pro_signup_alerts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  notification_id  uuid,
  kind             text        NOT NULL CHECK (kind IN
                     ('account','lead','app_lead','links_lead','contact','stalled','retry','deleted')),
  signup_id        uuid        REFERENCES public.pro_signups(id) ON DELETE SET NULL,
  email            text,
  dedup_key        text        NOT NULL UNIQUE,
  status           text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','failed')),
  attempts         integer     NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  last_error       text,
  sent_at          timestamptz,
  cockpit          jsonb,
  research_status  text        NOT NULL DEFAULT 'pending'
                     CHECK (research_status IN ('pending','running','done','failed','skipped')),
  research         jsonb,
  research_at      timestamptz,
  -- E-mail de secours à Paul quand le Cockpit n'a joint aucun téléphone.
  email_sent_at    timestamptz
);

CREATE INDEX IF NOT EXISTS pro_signup_alerts_due_idx
  ON public.pro_signup_alerts (next_attempt_at)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS pro_signup_alerts_research_idx
  ON public.pro_signup_alerts (created_at)
  WHERE status = 'sent' AND research_status = 'pending';

-- Données personnelles de prospects : aucune policy, tout passe par les
-- fonctions ci-dessous (service_role).
ALTER TABLE public.pro_signup_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pro_signup_alerts FROM PUBLIC, anon, authenticated;

-- ── 2. Petites portes ───────────────────────────────────────────────────────
-- L'étape la plus avancée d'un parcours (last_step dit seulement la dernière
-- étape APPELÉE : une page rechargée la ramenait à « ouverture »).
CREATE OR REPLACE FUNCTION public._pro_signup_furthest_step(p_steps jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT s
    FROM unnest(ARRAY['console','created','lead','account','structure','role','opened'])
         WITH ORDINALITY AS x(s, o)
   WHERE coalesce(p_steps, '{}'::jsonb) ? s
   ORDER BY o
   LIMIT 1
$$;

-- Un parcours né d'une invitation de Paul : invitation Yuno CRM (offre
-- fondateurs ou essai), lien démo « compte à créer », compte démo.
CREATE OR REPLACE FUNCTION public._pro_signup_invited(p_signup_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT ps.offer_invite_id IS NOT NULL
        OR coalesce(ps.source, '') IN ('demo_preview', 'crm_invite')
        OR (ps.email IS NOT NULL AND public.is_demo_email(ps.email))
      FROM public.pro_signups ps
     WHERE ps.id = p_signup_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public._pro_signup_invited(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Mise en file + réveil immédiat ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_pro_signup_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_kind   text;
  v_signup uuid;
  v_email  text := lower(nullif(trim(coalesce(NEW.metadata->>'email', '')), ''));
BEGIN
  v_kind := CASE NEW.notification_type
    WHEN 'admin_pro_signup'          THEN 'account'
    WHEN 'admin_pro_signup_lead'     THEN 'lead'
    WHEN 'admin_pro_lead'            THEN 'app_lead'
    WHEN 'admin_links_pro_lead'      THEN 'links_lead'
    WHEN 'admin_landing_contact'     THEN 'contact'
    WHEN 'admin_pro_signup_stalled'  THEN
      CASE WHEN NEW.metadata->>'kind' = 'retry' THEN 'retry' ELSE 'stalled' END
    WHEN 'admin_pro_account_deleted' THEN 'deleted'
  END;
  IF v_kind IS NULL THEN RETURN NEW; END IF;

  IF NEW.reference_type = 'pro_signup'
     AND NEW.reference_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_signup := NEW.reference_id::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.pro_signups WHERE id = v_signup) THEN v_signup := NULL; END IF;
  END IF;

  -- Ce que Paul a provoqué lui-même ne lui est pas annoncé (sauf un compte
  -- supprimé : un client invité qui s'en va, Paul doit le savoir aussi).
  IF v_kind <> 'deleted' AND v_signup IS NOT NULL AND public._pro_signup_invited(v_signup) THEN
    RETURN NEW;
  END IF;
  IF v_email IS NOT NULL AND public.is_demo_email(v_email) THEN RETURN NEW; END IF;

  INSERT INTO public.pro_signup_alerts (notification_id, kind, signup_id, email, dedup_key)
  VALUES (NEW.id, v_kind, v_signup, v_email, 'n:' || NEW.id::text)
  ON CONFLICT (dedup_key) DO NOTHING;

  -- Réveil immédiat (pg_net part au COMMIT). Le cron rattrape un échec.
  BEGIN
    PERFORM net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/process-scheduled-campaigns',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('task', 'pro_signup_alerts'),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Une alerte ne fait jamais échouer l'écriture qu'elle observe.
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enqueue_pro_signup_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enqueue_pro_signup_alert ON public.admin_notifications;
CREATE TRIGGER trg_enqueue_pro_signup_alert
  AFTER INSERT ON public.admin_notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_pro_signup_alert();

-- ── 4. Le formulaire de contact de la landing n'alertait personne ──────────
-- (les demandes du parcours d'inscription, source « landing-signup:… », ont
-- déjà leur alerte : elles ne sont pas doublées).
CREATE OR REPLACE FUNCTION public.notify_admin_landing_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF coalesce(NEW.source, '') LIKE 'landing-signup%' THEN RETURN NEW; END IF;
  PERFORM public.emit_admin_notification(
    'admin_landing_contact',
    'Message depuis la landing',
    NEW.name || coalesce(' (' || NEW.company || ')', '') || ' — ' || NEW.email
      || coalesce(' · ' || NEW.phone, '')
      || coalesce(E'\n« ' || left(NEW.message, 400) || ' »', ''),
    'high', 'landing_contact', NEW.id::text,
    jsonb_build_object('lead_id', NEW.id, 'name', NEW.name, 'email', NEW.email,
                       'phone', NEW.phone, 'company', NEW.company, 'role', NEW.role,
                       'segment', NEW.segment, 'source', NEW.source,
                       'message', left(NEW.message, 2000)),
    'landing_contact:' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notify_admin_landing_contact() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_admin_landing_contact ON public.landing_contact_leads;
CREATE TRIGGER trg_notify_admin_landing_contact
  AFTER INSERT ON public.landing_contact_leads
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_landing_contact();

-- ── 5. Inscriptions bloquées ────────────────────────────────────────────────
-- Toutes les 15 min : un parcours club / organisateur qui a laissé son e-mail
-- sans aboutir depuis 20 min. Deux cas :
--   • `retry` : l'adresse a DÉJÀ un compte Yuno → la personne retente de
--     s'inscrire au lieu de se connecter, elle est sans doute bloquée
--     (Poupée, 19/10 : quatre parcours après son compte) ;
--   • `stalled` : pas de compte → inscription abandonnée à l'étape X.
-- Une alerte par adresse et par jour (Paris). Rien si un compte a été créé
-- APRÈS le début du parcours (la personne a fini ailleurs).
CREATE OR REPLACE FUNCTION public.pro_signup_stalled_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_user record;
  v_kind text;
  v_step text;
  v_who  text;
  v_n    integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (lower(ps.email)) ps.*
      FROM public.pro_signups ps
     WHERE ps.email IS NOT NULL
       AND ps.kind IN ('club', 'organizer')
       AND ps.user_id IS NULL
       AND ps.account_created_at IS NULL
       AND ps.updated_at < now() - interval '20 minutes'
       AND ps.updated_at > now() - interval '48 hours'
       AND NOT public._pro_signup_invited(ps.id)
     ORDER BY lower(ps.email), ps.updated_at DESC
  LOOP
    SELECT u.id, u.created_at, u.last_sign_in_at INTO v_user
      FROM auth.users u
     WHERE lower(u.email) = lower(r.email)
     LIMIT 1;
    IF v_user.id IS NOT NULL AND v_user.created_at >= r.created_at THEN
      CONTINUE;
    END IF;
    v_kind := CASE WHEN v_user.id IS NOT NULL THEN 'retry' ELSE 'stalled' END;
    v_step := public._pro_signup_furthest_step(r.steps);
    v_who := coalesce(nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''), r.email);

    IF public.emit_admin_notification(
      'admin_pro_signup_stalled',
      CASE WHEN v_kind = 'retry'
           THEN 'Un pro inscrit retente de s''inscrire'
           ELSE 'Inscription pro bloquée' END,
      coalesce(r.org_name, '?') || coalesce(' (' || r.city || ')', '') || ' · ' || v_who
        || coalesce(' · ' || r.phone, '')
        || CASE WHEN v_kind = 'retry'
                THEN ' · a déjà un compte, sans doute bloqué à la connexion.'
                ELSE ' · arrêté à l''étape « ' || coalesce(v_step, 'opened') || ' ».' END,
      'high', 'pro_signup', r.id::text,
      jsonb_build_object('kind', v_kind, 'step', v_step, 'email', lower(r.email),
                         'phone', r.phone, 'org_name', r.org_name, 'city', r.city,
                         'signup_kind', r.kind, 'user_id', v_user.id),
      'pro_signup_stalled:' || lower(r.email) || ':'
        || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
    ) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pro_signup_stalled_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_signup_stalled_sweep() TO service_role;

-- ── 6. La fiche ─────────────────────────────────────────────────────────────
-- Tout ce que Yuno sait sur la personne et sa structure, relu AU MOMENT de
-- l'envoi (si la Console a été ouverte entre-temps, la fiche le dit).
CREATE OR REPLACE FUNCTION public.pro_signup_alert_payload(p_alert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  a          public.pro_signup_alerts%ROWTYPE;
  n          public.admin_notifications%ROWTYPE;
  ps         public.pro_signups%ROWTYPE;
  m          jsonb;
  v_email    text;
  v_phone    text;
  v_digits   text;
  v_user     record;
  v_venue    record;
  v_org      record;
  v_events   integer := 0;
  v_live     boolean := false;
  v_payments boolean := false;
  v_attempts jsonb;
  v_leads    jsonb;
  v_lead     record;
BEGIN
  SELECT * INTO a FROM public.pro_signup_alerts WHERE id = p_alert_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO n FROM public.admin_notifications WHERE id = a.notification_id;
  m := coalesce(n.metadata, '{}'::jsonb);
  IF a.signup_id IS NOT NULL THEN
    SELECT * INTO ps FROM public.pro_signups WHERE id = a.signup_id;
  END IF;

  v_email := lower(coalesce(ps.email, a.email, nullif(m->>'email', '')));
  v_phone := coalesce(nullif(ps.phone, ''), nullif(m->>'phone', ''));
  v_digits := right(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), 9);

  -- Le compte Yuno de cette adresse (s'il existe).
  -- (Chaque SELECT INTO s'exécute toujours : un record jamais assigné lève
  -- une erreur à la lecture d'un champ.)
  SELECT u.id, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
         p.profile_type, p.first_name, p.last_name, p.phone
    INTO v_user
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE v_email IS NOT NULL AND lower(u.email) = v_email
   LIMIT 1;
  SELECT vn.id, vn.name, vn.city, vn.is_hidden, vn.instagram_url,
         coalesce(vn.stripe_charges_enabled, false) AS charges
    INTO v_venue
    FROM public.venues vn
   WHERE vn.owner_id = v_user.id AND vn.decommissioned_at IS NULL
   ORDER BY vn.created_at LIMIT 1;
  SELECT op.display_name, op.city, op.slug, op.product INTO v_org
    FROM public.organizer_profiles op WHERE op.user_id = v_user.id;
  SELECT l.name, l.company, l.message INTO v_lead
    FROM public.landing_contact_leads l
   WHERE a.kind = 'contact' AND l.id::text = n.reference_id;
  IF v_user.id IS NOT NULL THEN
    IF v_venue.id IS NOT NULL THEN
      SELECT count(*) INTO v_events FROM public.events e WHERE e.venue_id = v_venue.id;
      v_live := NOT coalesce(v_venue.is_hidden, true);
      v_payments := v_venue.charges;
    ELSE
      SELECT count(*), coalesce(bool_or(e.published_at IS NOT NULL), false)
        INTO v_events, v_live
        FROM public.events e WHERE e.organizer_user_id = v_user.id;
      SELECT coalesce(pr.stripe_connect_account_id IS NOT NULL, false) INTO v_payments
        FROM public.profiles pr WHERE pr.id = v_user.id;
    END IF;
  END IF;

  -- Tous ses parcours d'inscription des 60 derniers jours (même e-mail ou
  -- même numéro) : c'est là qu'on voit qu'une personne a ramé.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'at', x.created_at, 'updated_at', x.updated_at,
           'kind', x.kind, 'product', x.product, 'org_name', x.org_name,
           'phone', x.phone, 'source', x.source, 'utm_source', x.utm_source,
           'referrer_host', x.referrer_host, 'device', x.device,
           'step', public._pro_signup_furthest_step(x.steps),
           'account_created_at', x.account_created_at,
           'account_deleted', x.account_created_at IS NOT NULL AND x.user_id IS NULL
         ) ORDER BY x.created_at), '[]'::jsonb)
    INTO v_attempts
    FROM (
      SELECT * FROM public.pro_signups x
       WHERE x.created_at > now() - interval '60 days'
         AND ((v_email IS NOT NULL AND lower(x.email) = v_email)
              OR (length(v_digits) = 9
                  AND right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 9) = v_digits))
       ORDER BY x.created_at DESC
       LIMIT 12
    ) x;

  -- Les formulaires « ouvrir un club » de l'app laissés par la même adresse.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'at', l.created_at, 'name', l.name, 'club_name', l.club_name,
           'city', l.city, 'phone', l.phone, 'message', left(l.message, 400)
         ) ORDER BY l.created_at), '[]'::jsonb)
    INTO v_leads
    FROM public.pro_contact_leads l
   WHERE v_email IS NOT NULL AND lower(l.email) = v_email
     AND l.created_at > now() - interval '60 days';

  RETURN jsonb_build_object(
    'alert_id', a.id,
    'kind', a.kind,
    'at', coalesce(n.created_at, a.created_at),
    'title', n.title,
    'message', n.message,
    'person', jsonb_build_object(
      'first_name', coalesce(ps.first_name, v_user.first_name,
                             split_part(coalesce(m->>'name', v_lead.name, ''), ' ', 1)),
      'last_name',  coalesce(ps.last_name, v_user.last_name),
      'full_name',  coalesce(nullif(trim(coalesce(ps.first_name, '') || ' ' || coalesce(ps.last_name, '')), ''),
                             nullif(m->>'name', ''), v_lead.name,
                             nullif(trim(coalesce(v_user.first_name, '') || ' ' || coalesce(v_user.last_name, '')), '')),
      'email', v_email,
      'phone', v_phone,
      'profile_phone', v_user.phone,
      'lang', coalesce(ps.lang, m->>'lang')
    ),
    'org', jsonb_build_object(
      'kind', coalesce(ps.kind, m->>'signup_kind',
                       CASE WHEN a.kind NOT IN ('stalled', 'retry') THEN m->>'kind' END,
                       CASE v_user.profile_type WHEN 'organizer' THEN 'organizer' WHEN 'club' THEN 'club' END,
                       CASE a.kind WHEN 'app_lead' THEN 'club' END,
                       nullif(m->>'segment', ''), nullif(m->>'org_type', '')),
      'name', coalesce(v_venue.name, v_org.display_name, ps.org_name, nullif(m->>'org_name', ''),
                       nullif(m->>'club_name', ''), nullif(m->>'company', ''), v_lead.company),
      'city', coalesce(v_venue.city, v_org.city, ps.city, nullif(m->>'city', '')),
      'country', coalesce(ps.country, ps.geo_country),
      'size_band', ps.size_band,
      'frequency', ps.frequency,
      'pillars', to_jsonb(ps.pillars),
      'current_tool', ps.current_tool,
      'next_night', ps.next_night,
      'product', coalesce(ps.product, m->>'product'),
      'instagram', v_venue.instagram_url,
      'message', coalesce(nullif(m->>'message', ''), v_lead.message)
    ),
    'origin', jsonb_build_object(
      'source', coalesce(ps.source, nullif(m->>'source', ''),
                         CASE a.kind WHEN 'app_lead' THEN 'app_form'
                                     WHEN 'links_lead' THEN 'yuno_links'
                                     WHEN 'contact' THEN 'landing_contact' END),
      'utm_source', ps.utm_source,
      'utm_medium', ps.utm_medium,
      'utm_campaign', ps.utm_campaign,
      'referrer_host', ps.referrer_host,
      'device', ps.device,
      'geo_country', ps.geo_country,
      'started_at', ps.created_at,
      'account_at', ps.account_created_at,
      'steps', ps.steps,
      'step', public._pro_signup_furthest_step(ps.steps)
    ),
    'account', jsonb_build_object(
      'exists', v_user.id IS NOT NULL,
      'user_id', v_user.id,
      'created_at', v_user.created_at,
      'last_sign_in_at', v_user.last_sign_in_at,
      'email_confirmed', v_user.email_confirmed_at IS NOT NULL,
      'profile_type', v_user.profile_type,
      'venue_id', v_venue.id,
      'console_opened_at', ps.console_opened_at,
      'events', coalesce(v_events, 0),
      'payments', coalesce(v_payments, false),
      'live', coalesce(v_live, false),
      'deleted', a.kind = 'deleted' OR (ps.account_created_at IS NOT NULL AND ps.user_id IS NULL
                                        AND v_user.id IS NULL)
    ),
    'attempts', v_attempts,
    'app_leads', v_leads,
    'stalled', CASE WHEN a.kind IN ('stalled', 'retry')
                    THEN jsonb_build_object('step', m->>'step') END,
    'deleted', CASE WHEN a.kind = 'deleted' THEN m END,
    'admin_url', CASE
      WHEN v_venue.id IS NOT NULL THEN 'https://yunoapp.eu/admin/venues/' || v_venue.id
      WHEN v_user.id IS NOT NULL THEN 'https://yunoapp.eu/admin/people/' || v_user.id
      ELSE 'https://yunoapp.eu/admin/signups' END,
    'signups_url', 'https://yunoapp.eu/admin/signups'
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.pro_signup_alert_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_signup_alert_payload(uuid) TO service_role;

-- ── 7. Les portes du travailleur (service_role) ────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_pro_signup_alerts(p_limit integer DEFAULT 5)
RETURNS SETOF public.pro_signup_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.pro_signup_alerts a
     SET status = 'sending',
         attempts = a.attempts + 1,
         locked_until = now() + interval '3 minutes'
   WHERE a.id IN (
     SELECT x.id FROM public.pro_signup_alerts x
      WHERE (x.status IN ('pending', 'failed')
             OR (x.status = 'sending' AND x.locked_until < now()))
        AND x.next_attempt_at <= now()
        AND x.attempts < 8
        AND x.created_at > now() - interval '3 days'
      ORDER BY x.created_at
      LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING a.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_pro_signup_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pro_signup_alerts(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_pro_signup_alert(
  p_id uuid, p_ok boolean, p_error text DEFAULT NULL, p_cockpit jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pro_signup_alerts
     SET status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END,
         sent_at = CASE WHEN p_ok THEN now() ELSE sent_at END,
         cockpit = coalesce(p_cockpit, cockpit),
         last_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END,
         locked_until = NULL,
         -- 1, 2, 4, 8… minutes, plafonné à une heure.
         next_attempt_at = CASE WHEN p_ok THEN next_attempt_at
                                ELSE now() + least(interval '60 minutes',
                                                   interval '1 minute' * power(2, greatest(attempts - 1, 0)))
                           END
   WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.finish_pro_signup_alert(uuid, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_pro_signup_alert(uuid, boolean, text, jsonb) TO service_role;

-- Recherche sur la structure : réclamée une fois (une IA coûte, et une
-- recherche ratée ne se retente pas en boucle).
CREATE OR REPLACE FUNCTION public.claim_pro_signup_research(p_limit integer DEFAULT 3)
RETURNS SETOF public.pro_signup_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.pro_signup_alerts a
     SET research_status = 'running', research_at = now()
   WHERE a.id IN (
     SELECT x.id FROM public.pro_signup_alerts x
      WHERE x.status = 'sent' AND x.research_status = 'pending'
        AND x.created_at > now() - interval '2 days'
      ORDER BY x.created_at
      LIMIT greatest(1, least(coalesce(p_limit, 3), 10))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING a.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_pro_signup_research(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pro_signup_research(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.save_pro_signup_research(p_id uuid, p_status text, p_research jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pro_signup_alerts
     SET research_status = CASE WHEN p_status IN ('done', 'failed', 'skipped') THEN p_status ELSE 'failed' END,
         research = p_research,
         research_at = now()
   WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.save_pro_signup_research(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_pro_signup_research(uuid, text, jsonb) TO service_role;

-- E-mail de secours : seulement quand le Cockpit a répondu sans joindre aucun
-- téléphone (aucun appareil abonné), une fois la recherche faite ou abandonnée
-- (3 min au plus). Réclamé une fois ; un envoi raté rend la main.
CREATE OR REPLACE FUNCTION public.claim_pro_signup_emails(p_limit integer DEFAULT 5)
RETURNS SETOF public.pro_signup_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.pro_signup_alerts a
     SET email_sent_at = now()
   WHERE a.id IN (
     SELECT x.id FROM public.pro_signup_alerts x
      WHERE x.status = 'sent' AND x.email_sent_at IS NULL
        AND jsonb_typeof(x.cockpit->'push') = 'object'
        AND coalesce((x.cockpit->'push'->>'sent')::int, 0) = 0
        AND (x.research_status IN ('done', 'failed', 'skipped') OR x.sent_at < now() - interval '3 minutes')
        AND x.created_at > now() - interval '2 days'
      ORDER BY x.created_at
      LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING a.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_pro_signup_emails(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pro_signup_emails(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_pro_signup_email(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pro_signup_alerts SET email_sent_at = NULL WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.release_pro_signup_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_pro_signup_email(uuid) TO service_role;

-- Recherche déjà faite pour la même structure (deux parcours de Lillo Bacio =
-- une seule recherche) : on la réutilise.
CREATE OR REPLACE FUNCTION public.find_pro_signup_research(p_org text, p_city text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.research
    FROM public.pro_signup_alerts a
    LEFT JOIN public.pro_signups ps ON ps.id = a.signup_id
   WHERE a.research_status = 'done'
     AND a.research_at > now() - interval '30 days'
     AND lower(trim(coalesce(a.research->>'org_name', ps.org_name, ''))) = lower(trim(coalesce(p_org, '')))
     AND lower(trim(coalesce(a.research->>'city', ps.city, ''))) = lower(trim(coalesce(p_city, '')))
   ORDER BY a.research_at DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.find_pro_signup_research(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_pro_signup_research(text, text) TO service_role;

-- ── 8. Balayage toutes les 15 min (SQL seul, quelques lignes) ──────────────
DO $cron$
BEGIN
  PERFORM cron.unschedule('pro-signup-stalled-sweep')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pro-signup-stalled-sweep');
  PERFORM cron.schedule('pro-signup-stalled-sweep', '4,19,34,49 * * * *',
                        'SELECT public.pro_signup_stalled_sweep()');
END
$cron$;

-- ── 9. Tableau admin des inscriptions : l'étape la plus avancée et le compte
-- supprimé (Lillo Bacio, 19/10 : « Arrêté à : adm.signups.step.console » sur un
-- parcours dont le compte avait été supprimé puis recréé).
CREATE OR REPLACE FUNCTION public.admin_pro_signups(p_days integer DEFAULT 30, p_include_demo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)));
  v      jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH s AS MATERIALIZED (
    SELECT ps.*
      FROM public.pro_signups ps
     WHERE ps.created_at >= v_from
       AND (p_include_demo OR ps.email IS NULL OR NOT public.is_demo_email(ps.email))
  ),
  prog AS (
    SELECT s.id,
           CASE
             WHEN s.kind = 'club' AND s.venue_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.venue_id = s.venue_id)
             WHEN s.kind = 'organizer' AND s.user_id IS NOT NULL THEN
               (SELECT count(*) FROM public.events e WHERE e.organizer_user_id = s.user_id)
             ELSE 0
           END AS events,
           CASE
             WHEN s.kind = 'club' AND s.venue_id IS NOT NULL THEN
               coalesce((SELECT vn.stripe_charges_enabled OR vn.stripe_onboarding_complete
                           FROM public.venues vn WHERE vn.id = s.venue_id), false)
             WHEN s.kind = 'organizer' AND s.user_id IS NOT NULL THEN
               coalesce((SELECT pr.stripe_connect_account_id IS NOT NULL
                           FROM public.profiles pr WHERE pr.id = s.user_id), false)
             ELSE false
           END AS payments,
           CASE
             WHEN s.kind = 'club' AND s.venue_id IS NOT NULL THEN
               coalesce((SELECT NOT vn.is_hidden FROM public.venues vn WHERE vn.id = s.venue_id), false)
             WHEN s.kind = 'organizer' AND s.user_id IS NOT NULL THEN
               EXISTS (SELECT 1 FROM public.events e
                        WHERE e.organizer_user_id = s.user_id AND e.published_at IS NOT NULL)
             ELSE false
           END AS live
      FROM s
     WHERE s.user_id IS NOT NULL
  ),
  funnel AS (
    SELECT
      count(*)                                                        AS opened,
      count(*) FILTER (WHERE s.kind IS NOT NULL)                      AS role,
      count(*) FILTER (WHERE s.steps ? 'structure' OR s.steps ? 'lead') AS structure,
      count(*) FILTER (WHERE s.email IS NOT NULL)                     AS email,
      count(*) FILTER (WHERE s.user_id IS NOT NULL)                   AS created,
      count(*) FILTER (WHERE s.console_opened_at IS NOT NULL)         AS console,
      (SELECT count(*) FROM prog WHERE prog.events > 0)               AS first_event,
      (SELECT count(*) FROM prog WHERE prog.payments)                 AS payments,
      (SELECT count(*) FROM prog WHERE prog.live)                     AS live,
      count(*) FILTER (WHERE s.user_id IS NOT NULL AND s.kind = 'club')      AS clubs,
      count(*) FILTER (WHERE s.user_id IS NOT NULL AND s.kind = 'organizer') AS organizers,
      count(*) FILTER (WHERE s.user_id IS NULL AND s.email IS NOT NULL)      AS leads,
      count(*) FILTER (WHERE s.user_id IS NULL AND s.email IS NOT NULL AND s.contacted_at IS NULL) AS to_contact
    FROM s
  ),
  days AS (
    SELECT d::date AS d
      FROM generate_series(date_trunc('day', v_from), date_trunc('day', now()), interval '1 day') d
  ),
  by_day AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'd', days.d,
             'started', (SELECT count(*) FROM s WHERE s.created_at::date = days.d AND s.kind IS NOT NULL),
             'created', (SELECT count(*) FROM s WHERE s.account_created_at::date = days.d)
           ) ORDER BY days.d), '[]'::jsonb) AS j
      FROM days
  ),
  by_source AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('source', src, 'started', started, 'created', created)
                              ORDER BY started DESC), '[]'::jsonb) AS j
      FROM (
        SELECT coalesce(nullif(s.utm_source, ''), nullif(s.source, ''), 'direct') AS src,
               count(*) FILTER (WHERE s.kind IS NOT NULL) AS started,
               count(*) FILTER (WHERE s.user_id IS NOT NULL) AS created
          FROM s GROUP BY 1
      ) x
     WHERE started > 0
  ),
  rows AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'created_at', s.created_at, 'updated_at', s.updated_at,
             'kind', s.kind, 'lang', s.lang,
             'first_name', s.first_name, 'last_name', s.last_name,
             'email', s.email, 'phone', s.phone,
             'org_name', s.org_name, 'city', s.city, 'country', coalesce(s.country, s.geo_country),
             'size_band', s.size_band, 'frequency', s.frequency, 'pillars', to_jsonb(s.pillars),
             'current_tool', s.current_tool, 'next_night', s.next_night,
             'source', s.source, 'utm_source', s.utm_source, 'utm_campaign', s.utm_campaign,
             'last_step', s.last_step,
             'furthest_step', public._pro_signup_furthest_step(s.steps),
             'account_deleted', s.account_created_at IS NOT NULL AND s.user_id IS NULL,
             'user_id', s.user_id, 'venue_id', s.venue_id,
             'account_created_at', s.account_created_at, 'console_opened_at', s.console_opened_at,
             'contacted_at', s.contacted_at, 'admin_notes', s.admin_notes,
             'events', coalesce(p.events, 0), 'payments', coalesce(p.payments, false),
             'live', coalesce(p.live, false)
           ) ORDER BY coalesce(s.account_created_at, s.updated_at) DESC), '[]'::jsonb) AS j
      FROM (SELECT * FROM s WHERE s.email IS NOT NULL
             ORDER BY coalesce(s.account_created_at, s.updated_at) DESC LIMIT 300) s
      LEFT JOIN prog p ON p.id = s.id
  )
  SELECT jsonb_build_object(
    'funnel', (SELECT to_jsonb(funnel) FROM funnel),
    'by_day', (SELECT j FROM by_day),
    'by_source', (SELECT j FROM by_source),
    'rows', (SELECT j FROM rows),
    'from', v_from
  ) INTO v;

  RETURN v;
END $function$;
