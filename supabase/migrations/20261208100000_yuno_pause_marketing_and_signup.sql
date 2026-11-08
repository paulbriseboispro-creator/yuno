-- Yuno en pause (décision de Paul du 2026-11-08) : on ne garde que la vente de
-- billets et de guest lists. Trois coupures, toutes RÉVERSIBLES :
--   1. plus aucun envoi marketing (e-mail et SMS), quel que soit l'écrivain ;
--   2. inscription pro sur invitation seulement ;
--   3. ce qui a été éteint est noté, pour pouvoir le rallumer.
-- Les e-mails de billets, de guest list, de tables, de remboursement et de
-- connexion ne passent pas par email_campaigns : ils ne sont pas touchés.
-- Relancer = UPDATE platform_pause SET marketing_paused = false,
-- pro_signup_invite_only = false, puis rallumer depuis platform_pause_log.

CREATE TABLE IF NOT EXISTS public.platform_pause (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  marketing_paused boolean NOT NULL DEFAULT true,
  pro_signup_invite_only boolean NOT NULL DEFAULT true,
  paused_at timestamptz NOT NULL DEFAULT now(),
  note text
);
ALTER TABLE public.platform_pause ENABLE ROW LEVEL SECURITY;
INSERT INTO public.platform_pause (id, note)
VALUES (true, 'Pause du 2026-11-08 : billets + guest list seulement')
ON CONFLICT (id) DO NOTHING;

-- Ce qui a été éteint, pour le rallumer à l'identique.
CREATE TABLE IF NOT EXISTS public.platform_pause_log (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,          -- 'automation' | 'notification' | 'cron'
  ref text NOT NULL,
  previous jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_pause_log ENABLE ROW LEVEL SECURITY;

-- Emails autorisés à ouvrir un compte pro pendant la pause.
CREATE TABLE IF NOT EXISTS public.pro_signup_allowlist (
  email text PRIMARY KEY CHECK (email = lower(trim(email))),
  note text,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pro_signup_allowlist ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.marketing_paused()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT marketing_paused FROM public.platform_pause WHERE id), false)
$$;
REVOKE ALL ON FUNCTION public.marketing_paused() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_paused() TO authenticated, service_role;

-- ── 1. Envois marketing ─────────────────────────────────────────────────────
-- Garde unique : aucune campagne e-mail n'entre en envoi ni en programmation.
-- Une campagne lancée à la main est refusée (code stable) ; une campagne
-- enfant (automatisation, scénario, page, renvoi, relance) est mise en pause,
-- pour ne jamais faire tomber un collecteur.
CREATE OR REPLACE FUNCTION public.guard_marketing_paused_email()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('sending', 'scheduled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND public.marketing_paused() THEN
    IF NEW.automation_id IS NOT NULL OR NEW.parent_campaign_id IS NOT NULL OR NEW.child_kind IS NOT NULL THEN
      NEW.status := 'paused';
    ELSE
      RAISE EXCEPTION 'marketing_paused' USING ERRCODE = 'P0001',
        HINT = 'Les envois d''e-mails marketing sont en pause sur Yuno.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_0_marketing_paused ON public.email_campaigns;
CREATE TRIGGER trg_0_marketing_paused BEFORE INSERT OR UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketing_paused_email();

CREATE OR REPLACE FUNCTION public.guard_marketing_paused_sms()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('sending', 'scheduled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND public.marketing_paused() THEN
    RAISE EXCEPTION 'marketing_paused' USING ERRCODE = 'P0001',
      HINT = 'Les envois de SMS marketing sont en pause sur Yuno.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_0_marketing_paused ON public.sms_campaigns;
CREATE TRIGGER trg_0_marketing_paused BEFORE INSERT OR UPDATE ON public.sms_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketing_paused_sms();

-- Une recette ne se rallume pas pendant la pause.
CREATE OR REPLACE FUNCTION public.guard_marketing_paused_automation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF (NEW.enabled OR coalesce(NEW.sms_enabled, false))
     AND (TG_OP = 'INSERT' OR NOT OLD.enabled OR NOT coalesce(OLD.sms_enabled, false) AND coalesce(NEW.sms_enabled, false))
     AND public.marketing_paused() THEN
    RAISE EXCEPTION 'marketing_paused' USING ERRCODE = 'P0001',
      HINT = 'Les automatisations e-mail sont en pause sur Yuno.';
  END IF;
  RETURN NEW;
END $$;

-- Recettes allumées : notées puis éteintes (2 réelles chez Amoris, le reste démo).
INSERT INTO public.platform_pause_log (kind, ref, previous)
SELECT 'automation', id::text, jsonb_build_object('enabled', enabled, 'sms_enabled', sms_enabled)
  FROM public.email_automations
 WHERE enabled OR coalesce(sms_enabled, false);
UPDATE public.email_automations SET enabled = false, sms_enabled = false
 WHERE enabled OR coalesce(sms_enabled, false);

DROP TRIGGER IF EXISTS trg_0_marketing_paused ON public.email_automations;
CREATE TRIGGER trg_0_marketing_paused BEFORE INSERT OR UPDATE ON public.email_automations
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketing_paused_automation();

-- E-mails automatiques de Yuno (relance « on t'a manqué », recommandation,
-- bilan du lendemain et résumé hebdo par e-mail).
INSERT INTO public.platform_pause_log (kind, ref, previous)
SELECT 'notification', notification_key, jsonb_build_object('enabled', enabled)
  FROM public.platform_notification_settings
 WHERE notification_key IN ('email_missed_you', 'email_next_event_rec', 'email_night_recap', 'email_weekly_digest')
   AND enabled;
UPDATE public.platform_notification_settings SET enabled = false, updated_at = now()
 WHERE notification_key IN ('email_missed_you', 'email_next_event_rec', 'email_night_recap', 'email_weekly_digest');

-- ── 2. Inscription pro sur invitation ───────────────────────────────────────
-- Autorisé : adresse dans pro_signup_allowlist, invitation Yuno CRM
-- (offer_invite_id), compte préparé depuis un lien démo, compte démo.
CREATE OR REPLACE FUNCTION public._pro_signup_allowed(p_email text, p_offer uuid, p_source text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT coalesce((SELECT pro_signup_invite_only FROM public.platform_pause WHERE id), false)
      OR p_offer IS NOT NULL
      OR coalesce(p_source, '') = 'demo_preview'
      OR public.is_demo_email(p_email)
      OR public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.pro_signup_allowlist a WHERE a.email = lower(trim(coalesce(p_email, ''))))
$$;
REVOKE ALL ON FUNCTION public._pro_signup_allowed(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Lecture publique pour la landing : l'inscription est-elle ouverte ?
CREATE OR REPLACE FUNCTION public.pro_signup_is_open()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT coalesce((SELECT pro_signup_invite_only FROM public.platform_pause WHERE id), false)
$$;
REVOKE ALL ON FUNCTION public.pro_signup_is_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pro_signup_is_open() TO anon, authenticated, service_role;

-- Ajout d'une adresse par le super admin.
CREATE OR REPLACE FUNCTION public.admin_pro_signup_allow(p_email text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.pro_signup_allowlist (email, note)
  VALUES (lower(trim(p_email)), p_note)
  ON CONFLICT (email) DO UPDATE SET note = coalesce(EXCLUDED.note, pro_signup_allowlist.note);
END $$;
REVOKE ALL ON FUNCTION public.admin_pro_signup_allow(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pro_signup_allow(text, text) TO authenticated, service_role;

-- Patch ciblé des deux portes d'ouverture de compte (définitions vivantes).
DO $$
DECLARE
  v_def text;
  v_anchor text;
  v_guard text;
BEGIN
  v_def := pg_get_functiondef('public.complete_pro_signup(text)'::regprocedure);
  v_anchor := E'  IF v_row.kind NOT IN (''club'',''organizer'') THEN\n    RAISE EXCEPTION ''invalid_kind'' USING ERRCODE = ''22023'';\n  END IF;\n';
  v_guard := E'  -- Pause du 2026-11-08 : inscription pro sur invitation seulement.\n'
          || E'  IF NOT public._pro_signup_allowed((SELECT email FROM auth.users WHERE id = v_uid), v_row.offer_invite_id, v_row.source) THEN\n'
          || E'    RAISE EXCEPTION ''pro_signup_closed'' USING ERRCODE = ''42501'';\n  END IF;\n';
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'complete_pro_signup: anchor not found';
  END IF;
  IF position('pro_signup_closed' IN v_def) = 0 THEN
    EXECUTE replace(v_def, v_anchor, v_anchor || v_guard);
  END IF;

  v_def := pg_get_functiondef('public.open_product_on_my_account(text,text,uuid,text)'::regprocedure);
  v_anchor := E'  IF public.is_support_session() THEN RAISE EXCEPTION ''support_session_forbidden'' USING ERRCODE = ''42501''; END IF;\n';
  v_guard := E'  -- Pause du 2026-11-08 : un produit ne s''ajoute que sur invitation.\n'
          || E'  IF NOT public._pro_signup_allowed((SELECT email FROM auth.users WHERE id = v_uid),\n'
          || E'       (SELECT offer_invite_id FROM public.pro_signups WHERE client_key = p_signup_key AND p_signup_key IS NOT NULL), NULL) THEN\n'
          || E'    RAISE EXCEPTION ''pro_signup_closed'' USING ERRCODE = ''42501'';\n  END IF;\n';
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'open_product_on_my_account: anchor not found';
  END IF;
  IF position('pro_signup_closed' IN v_def) = 0 THEN
    EXECUTE replace(v_def, v_anchor, v_anchor || v_guard);
  END IF;
END $$;
