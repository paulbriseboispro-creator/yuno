-- ============================================================
-- YUNO - CORRECTIF COMPATIBILITE EMAIL / NEWSLETTER / CRON
-- A lancer UNE FOIS dans le SQL Editor, avec le bouton RUN.
-- Ce fichier est idempotent : il peut être relancé sans casser les données.
-- ============================================================

-- 0) Extensions et schémas nécessaires aux tâches automatiques
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Important : une ancienne version de cette fonction existe avec des noms de paramètres différents.
-- PostgreSQL refuse de renommer les paramètres avec CREATE OR REPLACE, donc on la supprime d'abord.
DROP FUNCTION IF EXISTS private.reschedule_edge_cron(text, text, text);
DROP FUNCTION IF EXISTS private.get_cron_secret();

CREATE OR REPLACE FUNCTION private.get_cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name IN ('cron_secret', 'CRON_SECRET')
  ORDER BY CASE WHEN name = 'cron_secret' THEN 0 ELSE 1 END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.get_cron_secret() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.reschedule_edge_cron(
  p_job_name text,
  p_schedule text,
  p_function_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_url text := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/' || p_function_path;
  v_command text;
BEGIN
  BEGIN
    PERFORM cron.unschedule(p_job_name);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  v_command := format($cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', private.get_cron_secret()
      ),
      body := jsonb_build_object('triggered_at', now())
    );
  $cmd$, v_url);

  PERFORM cron.schedule(p_job_name, p_schedule, v_command);
END;
$$;

REVOKE ALL ON FUNCTION private.reschedule_edge_cron(text, text, text) FROM PUBLIC, anon, authenticated;

-- 1) Table des modèles d'e-mails admin
CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  subject text NOT NULL,
  html_content text NOT NULL,
  preview_text text,
  is_active boolean NOT NULL DEFAULT true,
  category text DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage email templates" ON public.email_templates;
CREATE POLICY "Super admins manage email templates"
  ON public.email_templates FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 2) Tables campagnes/newsletter, créées si elles manquent
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'promotional',
  subject text NOT NULL,
  preheader text,
  blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  html_body text,
  audience_type text DEFAULT 'all_subscribers',
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipients_count integer NOT NULL DEFAULT 0,
  opens_count integer NOT NULL DEFAULT 0,
  clicks_count integer NOT NULL DEFAULT 0,
  unsubscribes_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  theme_json jsonb DEFAULT '{}'::jsonb,
  social_links_json jsonb DEFAULT '{}'::jsonb,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS audience_type text DEFAULT 'all_subscribers',
  ADD COLUMN IF NOT EXISTS theme_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS social_links_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'promotional',
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS preheader text,
  ADD COLUMN IF NOT EXISTS blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS html_body text,
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipients_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opens_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribes_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.email_campaigns ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_type_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_type_check
  CHECK (type IN ('promotional','informational'));

ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_status_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_status_check
  CHECK (status IN ('draft','scheduled','sending','sent','failed'));

ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_audience_type_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_audience_type_check
  CHECK (audience_type IN (
    'all_subscribers','event_subscribers','event_buyers',
    'event_table_buyers','event_all_buyers',
    'vip','big_spenders','regulars','new_customers','dormant'
  ));

ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_owner_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_owner_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_email_campaigns_venue ON public.email_campaigns(venue_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_organizer ON public.email_campaigns(organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status_scheduled ON public.email_campaigns(status, scheduled_at) WHERE status = 'scheduled';

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue owners manage email campaigns" ON public.email_campaigns;
DROP POLICY IF EXISTS "Owners manage email campaigns" ON public.email_campaigns;
CREATE POLICY "Owners manage email campaigns"
  ON public.email_campaigns FOR ALL TO authenticated
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  )
  WITH CHECK (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

CREATE TABLE IF NOT EXISTS public.newsletter_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text NOT NULL,
  opted_in boolean NOT NULL DEFAULT true,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  opted_out_at timestamptz,
  source text DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unsubscribe_token)
);

ALTER TABLE public.newsletter_subscriptions
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.newsletter_subscriptions ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.newsletter_subscriptions DROP CONSTRAINT IF EXISTS newsletter_subscriptions_email_venue_id_key;
ALTER TABLE public.newsletter_subscriptions DROP CONSTRAINT IF EXISTS newsletter_subscriptions_owner_check;
ALTER TABLE public.newsletter_subscriptions
  ADD CONSTRAINT newsletter_subscriptions_owner_check
  CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_venue
  ON public.newsletter_subscriptions(lower(email), venue_id) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_organizer
  ON public.newsletter_subscriptions(lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_venue_optin ON public.newsletter_subscriptions(venue_id, opted_in);
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_organizer_optin ON public.newsletter_subscriptions(organizer_user_id, opted_in) WHERE organizer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_subs_email ON public.newsletter_subscriptions(lower(email));

ALTER TABLE public.newsletter_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue owners view newsletter subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Venue owners manage subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Owners view newsletter subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Owners manage newsletter subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Users view own subs" ON public.newsletter_subscriptions;
DROP POLICY IF EXISTS "Users update own subs" ON public.newsletter_subscriptions;

CREATE POLICY "Owners view newsletter subs"
  ON public.newsletter_subscriptions FOR SELECT TO authenticated
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR user_id = auth.uid()
    OR public.is_super_admin()
  );

CREATE POLICY "Owners manage newsletter subs"
  ON public.newsletter_subscriptions FOR ALL TO authenticated
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  )
  WITH CHECK (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

CREATE TABLE IF NOT EXISTS public.email_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  event_type text NOT NULL,
  resend_email_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign ON public.email_campaign_events(campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_campaign_events_created ON public.email_campaign_events(created_at);
ALTER TABLE public.email_campaign_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue owners view campaign events" ON public.email_campaign_events;
DROP POLICY IF EXISTS "Owners view campaign events" ON public.email_campaign_events;
CREATE POLICY "Owners view campaign events"
  ON public.email_campaign_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.email_campaigns c
      WHERE c.id = campaign_id
        AND (
          (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid())
          OR public.is_super_admin()
        )
    )
  );

CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  user_id uuid,
  unsubscribe_token uuid,
  status text NOT NULL DEFAULT 'pending',
  resend_email_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_recipient_email
  ON public.email_campaign_recipients(campaign_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status
  ON public.email_campaign_recipients(campaign_id, status);
ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners view campaign recipients" ON public.email_campaign_recipients;
CREATE POLICY "Owners view campaign recipients"
  ON public.email_campaign_recipients FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.email_campaigns c
      WHERE c.id = campaign_id
        AND (
          (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid())
          OR public.is_super_admin()
        )
    )
  );

-- 3) Triggers updated_at seulement si la fonction existe déjà
DO $$
BEGIN
  IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON public.email_templates;
    CREATE TRIGGER trg_email_templates_updated_at
      BEFORE UPDATE ON public.email_templates
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS trg_email_campaigns_updated_at ON public.email_campaigns;
    CREATE TRIGGER trg_email_campaigns_updated_at
      BEFORE UPDATE ON public.email_campaigns
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS trg_newsletter_subs_updated_at ON public.newsletter_subscriptions;
    CREATE TRIGGER trg_newsletter_subs_updated_at
      BEFORE UPDATE ON public.newsletter_subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- 4) Auto-abonnement newsletter après achat ticket/table
CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue_id text;
  v_organizer_user_id uuid;
  v_email text;
  v_user_id uuid;
  v_optin boolean;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT venue_id, organizer_user_id INTO v_venue_id, v_organizer_user_id
    FROM public.events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'table_reservations' THEN
    v_email := NEW.user_email;
    v_user_id := NEW.user_id;
    v_optin := COALESCE(NEW.newsletter_opt_in, false);
    SELECT e.venue_id, e.organizer_user_id INTO v_venue_id, v_organizer_user_id
    FROM public.events e WHERE e.id = NEW.event_id;
  END IF;

  IF NOT v_optin OR v_email IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
    VALUES (v_user_id, v_venue_id, LOWER(v_email), true, 'purchase')
    ON CONFLICT DO NOTHING;
  ELSIF v_organizer_user_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source)
    VALUES (v_user_id, v_organizer_user_id, LOWER(v_email), true, 'purchase')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_auto_subscribe ON public.tickets;
CREATE TRIGGER trg_tickets_auto_subscribe
  AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.auto_subscribe_newsletter_on_purchase();

DO $$
BEGIN
  IF to_regclass('public.table_reservations') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_reservations_auto_subscribe ON public.table_reservations;
    CREATE TRIGGER trg_reservations_auto_subscribe
      AFTER INSERT ON public.table_reservations
      FOR EACH ROW EXECUTE FUNCTION public.auto_subscribe_newsletter_on_purchase();
  END IF;
END $$;

-- 5) RPC de désabonnement compatibles club + organisateur
DROP FUNCTION IF EXISTS public.preview_unsubscribe(uuid);
CREATE OR REPLACE FUNCTION public.preview_unsubscribe(p_token uuid)
RETURNS TABLE(email text, scope_name text, already_unsubscribed boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ns.email,
         COALESCE(v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text AS scope_name,
         NOT ns.opted_in AS already_unsubscribed
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.unsubscribe_by_token(uuid);
CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(p_token uuid)
RETURNS TABLE(success boolean, scope_name text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id uuid;
  v_email text;
  v_scope_name text;
BEGIN
  SELECT ns.id, ns.email, COALESCE(v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text
    INTO v_sub_id, v_email, v_scope_name
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;

  IF v_sub_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE public.newsletter_subscriptions
  SET opted_in = false, opted_out_at = now(), updated_at = now()
  WHERE id = v_sub_id;

  RETURN QUERY SELECT true, v_scope_name, v_email;
END;
$$;

-- 6) RPC campagnes : compteur club
CREATE OR REPLACE FUNCTION public.count_campaign_recipients(
  p_venue_id text,
  p_type text,
  p_audience_type text,
  p_event_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.tickets
    WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(user_email)) INTO v_count
    FROM public.table_reservations
    WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL;
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id = p_event_id AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id = p_event_id AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE venue_id = p_venue_id AND opted_in = true;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.venue_id = p_venue_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true;
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc
        ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = p_venue_id
      WHERE ns.venue_id = p_venue_id AND ns.opted_in = true
        AND CASE p_audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

-- 7) RPC campagnes : compteur organisateur
CREATE OR REPLACE FUNCTION public.count_campaign_recipients_org(
  p_organizer_user_id uuid,
  p_type text,
  p_audience_type text,
  p_event_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.event_id = p_event_id AND t.status = 'paid' AND t.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_table_buyers' AND p_event_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT LOWER(tr.user_email)) INTO v_count
    FROM public.table_reservations tr
    JOIN public.events e ON e.id = tr.event_id
    WHERE tr.event_id = p_event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL
      AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    RETURN v_count;
  END IF;

  IF p_type = 'informational' AND p_audience_type = 'event_all_buyers' AND p_event_id IS NOT NULL THEN
    WITH allowed AS (
      SELECT id FROM public.events
      WHERE id = p_event_id
        AND (organizer_user_id = p_organizer_user_id OR partner_organizer_id = p_organizer_user_id)
    ), emails AS (
      SELECT LOWER(user_email) AS e FROM public.tickets WHERE event_id IN (SELECT id FROM allowed) AND status = 'paid' AND user_email IS NOT NULL
      UNION
      SELECT LOWER(user_email) FROM public.table_reservations WHERE event_id IN (SELECT id FROM allowed) AND status = 'confirmed' AND user_email IS NOT NULL
    )
    SELECT COUNT(*) INTO v_count FROM emails;
    RETURN v_count;
  END IF;

  IF p_type = 'promotional' THEN
    IF p_audience_type = 'all_subscribers' THEN
      SELECT COUNT(*) INTO v_count FROM public.newsletter_subscriptions
      WHERE organizer_user_id = p_organizer_user_id AND opted_in = true;
    ELSIF p_audience_type = 'event_subscribers' AND p_event_id IS NOT NULL THEN
      SELECT COUNT(DISTINCT LOWER(t.user_email)) INTO v_count
      FROM public.tickets t
      JOIN public.newsletter_subscriptions ns
        ON LOWER(ns.email) = LOWER(t.user_email) AND ns.organizer_user_id = p_organizer_user_id
      JOIN public.events e ON e.id = t.event_id
      WHERE t.event_id = p_event_id AND t.status = 'paid' AND ns.opted_in = true
        AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id);
    ELSIF p_audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
      WITH agg AS (
        SELECT LOWER(t.user_email) AS email,
               SUM(t.total_price)::numeric AS spent,
               COUNT(DISTINCT t.event_id) AS visits,
               MAX(t.created_at) AS last_seen
        FROM public.tickets t
        JOIN public.events e ON e.id = t.event_id
        WHERE t.status = 'paid' AND t.user_email IS NOT NULL
          AND (e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id)
        GROUP BY LOWER(t.user_email)
      )
      SELECT COUNT(*) INTO v_count
      FROM public.newsletter_subscriptions ns
      JOIN agg a ON a.email = LOWER(ns.email)
      WHERE ns.organizer_user_id = p_organizer_user_id AND ns.opted_in = true
        AND CASE p_audience_type
          WHEN 'vip' THEN a.spent >= 500
          WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
          WHEN 'new_customers' THEN a.visits = 1
          WHEN 'big_spenders' THEN a.spent >= 1000
          WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
          ELSE FALSE
        END;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

-- 8) RPC campagnes : résolution des destinataires
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := (v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT LOWER(t.user_email) AS email,
             SUM(t.total_price)::numeric AS spent,
             COUNT(DISTINCT t.event_id) AS visits,
             MAX(t.created_at) AS last_seen,
             MAX(t.full_name) AS full_name
      FROM public.tickets t
      JOIN public.events e ON e.id = t.event_id
      WHERE t.status = 'paid' AND t.user_email IS NOT NULL
        AND (e.organizer_user_id = v_campaign.organizer_user_id OR e.partner_organizer_id = v_campaign.organizer_user_id)
      GROUP BY LOWER(t.user_email)
    )
    SELECT a.email::text,
           SPLIT_PART(COALESCE(a.full_name,''), ' ', 1)::text,
           NULLIF(REGEXP_REPLACE(COALESCE(a.full_name,''), '^\S+\s*', ''), '')::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
  END IF;
END;
$$;

-- 9) Backfill opt-ins existants, sans bloquer si déjà présents
INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source)
SELECT DISTINCT ON (LOWER(t.user_email), e.venue_id)
  t.user_id, e.venue_id, LOWER(t.user_email), true, 'ticket_purchase'
FROM public.tickets t
JOIN public.events e ON e.id = t.event_id
WHERE t.newsletter_opt_in = true
  AND t.user_email IS NOT NULL
  AND e.venue_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source)
SELECT DISTINCT ON (LOWER(t.user_email), e.organizer_user_id)
  t.user_id, e.organizer_user_id, LOWER(t.user_email), true, 'ticket_purchase'
FROM public.tickets t
JOIN public.events e ON e.id = t.event_id
WHERE t.newsletter_opt_in = true
  AND t.user_email IS NOT NULL
  AND e.venue_id IS NULL
  AND e.organizer_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 10) Reprogrammation des tâches automatiques protégées par CRON_SECRET
SELECT private.reschedule_edge_cron('archive-expired-orders-hourly',     '0 * * * *',     'archive-expired-orders');
SELECT private.reschedule_edge_cron('cart-abandonment-check',            '*/30 * * * *', 'cart-abandonment-check');
SELECT private.reschedule_edge_cron('cleanup-expired-orders-hourly',     '0 * * * *',     'cleanup-expired-orders');
SELECT private.reschedule_edge_cron('cleanup-expired-invoices-daily',    '0 3 * * *',     'cleanup-expired-invoices');
SELECT private.reschedule_edge_cron('cleanup-pending-purchases',         '*/15 * * * *', 'cleanup-pending-purchases');
SELECT private.reschedule_edge_cron('event-reminder-hourly',             '0 * * * *',     'event-reminder');
SELECT private.reschedule_edge_cron('inactivity-reminder-weekly',        '0 14 * * 1',    'inactivity-reminder');
SELECT private.reschedule_edge_cron('process-scheduled-campaigns',       '*/5 * * * *',  'process-scheduled-campaigns');
SELECT private.reschedule_edge_cron('send-event-recap-hourly',           '0 * * * *',     'send-event-recap');
SELECT private.reschedule_edge_cron('send-low-ticket-alert-hourly',      '0 * * * *',     'send-low-ticket-alert');
SELECT private.reschedule_edge_cron('send-missed-you-weekly',            '0 15 * * 3',    'send-missed-you');
SELECT private.reschedule_edge_cron('send-next-event-recommendation',    '0 10 * * *',    'send-next-event-recommendation');
SELECT private.reschedule_edge_cron('send-owner-night-summary',          '0 8 * * *',     'send-owner-night-summary');
SELECT private.reschedule_edge_cron('send-owner-weekly-report',          '0 9 * * 1',     'send-owner-weekly-report');
SELECT private.reschedule_edge_cron('send-pre-night-checklist',          '0 16 * * *',    'send-pre-night-checklist');
SELECT private.reschedule_edge_cron('send-upsell-email',                 '*/30 * * * *', 'send-upsell-email');
SELECT private.reschedule_edge_cron('weekly-digest',                     '0 10 * * 1',    'weekly-digest');

DO $$
BEGIN
  PERFORM cron.unschedule('process-scheduled-campaigns-every-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 11) Vérification lisible : doit afficher OK partout
SELECT
  CASE WHEN to_regclass('public.email_templates') IS NOT NULL THEN 'OK' ELSE 'MANQUE' END AS email_templates,
  CASE WHEN to_regclass('public.email_campaigns') IS NOT NULL THEN 'OK' ELSE 'MANQUE' END AS email_campaigns,
  CASE WHEN to_regclass('public.newsletter_subscriptions') IS NOT NULL THEN 'OK' ELSE 'MANQUE' END AS newsletter_subscriptions,
  CASE WHEN to_regprocedure('private.reschedule_edge_cron(text,text,text)') IS NOT NULL THEN 'OK' ELSE 'MANQUE' END AS reschedule_edge_cron;
