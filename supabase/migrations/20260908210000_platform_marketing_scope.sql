-- ───────────────────────────────────────────────────────────────────────────
-- Marketing plateforme (super admin) — TROISIÈME PORTÉE, pas un second système.
--
-- Le club et l'organisateur envoient déjà email et SMS avec le même moteur
-- (Email Studio + file d'envoi + gouverneur de quota + liste de suppression
-- d'un côté, file SMS + Twilio + STOP de l'autre). Yuno, lui, n'avait AUCUN
-- moyen d'écrire à ses propres inscrits, ses prospects pros ou sa liste
-- d'attente : le seul canal plateforme était le push.
--
-- On ouvre donc la portée « plateforme » = les deux colonnes de portée à NULL
-- (`venue_id IS NULL AND organizer_user_id IS NULL`). Ce n'est pas un hasard :
-- `email_campaigns_owner_check` et `newsletter_subscriptions_owner_check`
-- autorisaient DÉJÀ ce créneau, et leurs policies RLS portent déjà
-- `is_super_admin()`. Cette migration aligne le reste (SMS, imports, segments)
-- sur le même créneau et pose les index d'unicité qui manquaient.
--
-- INVARIANT : la portée plateforme n'est JAMAIS atteignable par un pro. Les
-- deux colonnes à NULL ne satisfont ni la branche club ni la branche
-- organisateur d'aucune policy — seul `is_super_admin()` (ou `service_role`)
-- passe. Ne jamais écrire une policy qui accorde la portée plateforme sur un
-- autre critère.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. La porte unique de comparaison de portée ────────────────────────────
-- Dix fonctions répétaient le même prédicat à la main
--   (p_venue_id IS NOT NULL AND x.venue_id = p_venue_id)
--   OR (p_organizer_user_id IS NOT NULL AND x.organizer_user_id = ...)
-- qui est FAUX quand les deux paramètres sont NULL — donc muet, jamais en
-- erreur, sur toute la portée plateforme. Une seule fonction porte désormais
-- la règle. SQL + IMMUTABLE : le planificateur l'inline, aucun coût.
CREATE OR REPLACE FUNCTION public.marketing_scope_match(
  p_row_venue_id text,
  p_row_organizer_user_id uuid,
  p_venue_id text,
  p_organizer_user_id uuid
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_venue_id IS NOT NULL         THEN p_row_venue_id = p_venue_id
    WHEN p_organizer_user_id IS NOT NULL THEN p_row_organizer_user_id = p_organizer_user_id
    ELSE p_row_venue_id IS NULL AND p_row_organizer_user_id IS NULL
  END;
$$;

COMMENT ON FUNCTION public.marketing_scope_match(text, uuid, text, uuid) IS
  'Une ligne appartient-elle à la portée demandée ? Les deux paramètres à NULL = portée plateforme (super admin).';

-- ── 2. Les contraintes XOR deviennent « au plus un propriétaire » ──────────
ALTER TABLE public.email_list_imports        DROP CONSTRAINT IF EXISTS email_list_imports_owner_check;
ALTER TABLE public.email_list_imports        ADD  CONSTRAINT email_list_imports_owner_check
  CHECK (venue_id IS NULL OR organizer_user_id IS NULL);

ALTER TABLE public.email_campaign_templates  DROP CONSTRAINT IF EXISTS email_campaign_templates_owner_check;
ALTER TABLE public.email_campaign_templates  ADD  CONSTRAINT email_campaign_templates_owner_check
  CHECK (venue_id IS NULL OR organizer_user_id IS NULL);

ALTER TABLE public.contact_segments          DROP CONSTRAINT IF EXISTS contact_segments_owner_check;
ALTER TABLE public.contact_segments          ADD  CONSTRAINT contact_segments_owner_check
  CHECK (venue_id IS NULL OR organizer_user_id IS NULL);

ALTER TABLE public.contact_list_imports      DROP CONSTRAINT IF EXISTS contact_list_imports_owner_check;
ALTER TABLE public.contact_list_imports      ADD  CONSTRAINT contact_list_imports_owner_check
  CHECK (venue_id IS NULL OR organizer_user_id IS NULL);

ALTER TABLE public.sms_list_imports          DROP CONSTRAINT IF EXISTS sms_list_imports_owner_check;
ALTER TABLE public.sms_list_imports          ADD  CONSTRAINT sms_list_imports_owner_check
  CHECK (venue_id IS NULL OR organizer_user_id IS NULL);

ALTER TABLE public.venue_sms_contacts        DROP CONSTRAINT IF EXISTS venue_sms_contacts_scope_xor;
ALTER TABLE public.venue_sms_contacts        ADD  CONSTRAINT venue_sms_contacts_scope_xor
  CHECK (venue_id IS NULL OR organizer_user_id IS NULL);

ALTER TABLE public.sms_campaigns             DROP CONSTRAINT IF EXISTS sms_campaign_scope_xor;
ALTER TABLE public.sms_campaigns             ADD  CONSTRAINT sms_campaign_scope_xor
  CHECK (venue_id IS NULL OR organizer_id IS NULL);

-- ── 3. Unicité du créneau plateforme ───────────────────────────────────────
-- Les index d'unicité existants sont PARTIELS (WHERE venue_id IS NOT NULL /
-- organizer_user_id IS NOT NULL) : sans ces trois-là, la base plateforme
-- accepterait le même email ou le même numéro autant de fois qu'on l'importe.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subs_email_platform
  ON public.newsletter_subscriptions (lower(email))
  WHERE venue_id IS NULL AND organizer_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sms_contacts_platform_phone
  ON public.venue_sms_contacts (phone_e164)
  WHERE venue_id IS NULL AND organizer_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_segments_platform_name
  ON public.contact_segments (lower(name))
  WHERE venue_id IS NULL AND organizer_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_subs_platform
  ON public.newsletter_subscriptions (opted_in, source)
  WHERE venue_id IS NULL AND organizer_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_contacts_platform
  ON public.venue_sms_contacts (phone_e164)
  WHERE venue_id IS NULL AND organizer_user_id IS NULL AND NOT unsubscribed;

-- ── 4. RLS : la portée plateforme côté SMS ─────────────────────────────────
-- Côté email, les policies portent déjà `OR is_super_admin()` et couvrent donc
-- le créneau. Côté SMS, elles ne testent que club/organisateur : deux policies
-- à ajouter, aucune à élargir.
DROP POLICY IF EXISTS sms_contacts_platform_all ON public.venue_sms_contacts;
CREATE POLICY sms_contacts_platform_all ON public.venue_sms_contacts
  FOR ALL
  USING (venue_id IS NULL AND organizer_user_id IS NULL AND public.is_super_admin())
  WITH CHECK (venue_id IS NULL AND organizer_user_id IS NULL AND public.is_super_admin());

DROP POLICY IF EXISTS sms_camp_platform_all ON public.sms_campaigns;
CREATE POLICY sms_camp_platform_all ON public.sms_campaigns
  FOR ALL
  USING (venue_id IS NULL AND organizer_id IS NULL AND public.is_super_admin())
  WITH CHECK (venue_id IS NULL AND organizer_id IS NULL AND public.is_super_admin());

-- ── 5. Le quota de l'expéditeur Yuno ───────────────────────────────────────
-- ATTENTION : `scope_key = 'platform'` est DÉJÀ pris — c'est l'étage 1 de
-- `consume_email_send_quota`, le pool global de la plateforme. Réutiliser cette
-- clé pour l'expéditeur Yuno ferait consommer DEUX FOIS le même compteur dans
-- le même appel (étage 1 puis étage 2 sur la même ligne). L'expéditeur Yuno
-- porte donc sa propre clé : 'yuno'.
CREATE OR REPLACE FUNCTION public.email_sender_monthly_free(p_scope_key text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_override integer;
BEGIN
  SELECT monthly_cap_override INTO v_override
    FROM public.email_sender_state WHERE scope_key = p_scope_key;
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v_override, 40000);   -- pool marketing (plan 50k − réserve 10k)
  END IF;
  IF p_scope_key = 'yuno' THEN
    -- Le marketing de Yuno n'a pas de forfait « offert » à lui : il puise dans
    -- le pool plateforme, déjà plafonné à l'étage 1. Le rendre égal au pool
    -- évite un second plafond qui n'aurait aucun sens économique.
    RETURN COALESCE(v_override, 40000);
  END IF;
  RETURN COALESCE(v_override, 15000);     -- offert par compte pro
END;
$function$;

-- Le warm-up quotidien reste celui de tout le monde pour 'yuno' : c'est une
-- identité d'expédition NEUVE (yuno@news.yunoapp.eu), elle chauffe comme les
-- autres — 300 le premier jour, 25 000 au bout de six.
INSERT INTO public.email_sender_state (scope_key, venue_id, organizer_user_id)
VALUES ('yuno', NULL, NULL)
ON CONFLICT (scope_key) DO NOTHING;

-- Le statut de quota s'ouvre à la portée plateforme. Il rend en plus l'état du
-- POOL global (étage 1) : c'est le seul écran où quelqu'un peut voir combien
-- il reste de marketing pour tout le monde ce mois-ci.
CREATE OR REPLACE FUNCTION public.get_email_quota_status(
  p_venue_id text DEFAULT NULL::text,
  p_organizer_user_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text;
  v_month date := date_trunc('month', CURRENT_DATE)::date;
  v_used integer;
  v_free integer;
  v_credits integer;
  v_pool_used integer;
  v_pool_cap integer;
  v_day_used integer;
  v_day_cap integer;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'get_email_quota_status: une seule portée à la fois';
  END IF;

  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'venue:' || p_venue_id;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'org:' || p_organizer_user_id::text;
  ELSE
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    v_scope := 'yuno';
  END IF;

  SELECT COALESCE(sent, 0) INTO v_used
    FROM public.email_send_quota_month
   WHERE scope_key = v_scope AND month = v_month;
  v_used := COALESCE(v_used, 0);

  v_free := public.email_sender_monthly_free(v_scope);

  SELECT COALESCE(credit_balance, 0) INTO v_credits
    FROM public.email_sender_state WHERE scope_key = v_scope;
  v_credits := COALESCE(v_credits, 0);

  SELECT COALESCE(sent, 0) INTO v_pool_used
    FROM public.email_send_quota_month WHERE scope_key = 'platform' AND month = v_month;
  v_pool_cap := public.email_sender_monthly_free('platform');

  SELECT COALESCE(sent, 0) INTO v_day_used
    FROM public.email_send_quota WHERE scope_key = v_scope AND day = CURRENT_DATE;
  v_day_cap := public.email_sender_daily_cap(v_scope);

  RETURN jsonb_build_object(
    'used', v_used,
    'free', v_free,
    'credits', v_credits,
    'remaining', GREATEST(0, v_free - v_used) + v_credits,
    'resets_on', (v_month + interval '1 month')::date,
    'day_used', COALESCE(v_day_used, 0),
    'day_cap', COALESCE(v_day_cap, 0),
    'pool_used', COALESCE(v_pool_used, 0),
    'pool_cap', COALESCE(v_pool_cap, 0)
  );
END;
$function$;
