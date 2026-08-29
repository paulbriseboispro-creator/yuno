-- ───────────────────────────────────────────────────────────────────────────
-- Envoi de masse (2/3) — gouverneur d'envoi : warm-up, quotas, disjoncteur
--
-- Trois protections, dans cet ordre :
--
--   1. WARM-UP. Un expéditeur qui n'a jamais fait de masse ne part pas à
--      5 000 d'un coup. La rampe (300 → 600 → 1 200 → 2 500 → 5 000 → 10 000)
--      est ce qui rend le disjoncteur EFFICACE : elle laisse le temps aux
--      bounces et aux plaintes de remonter entre deux tranches. Sans elle, on
--      apprend qu'une liste est pourrie une fois les 5 000 partis.
--
--   2. QUOTA JOURNALIER, atomique, à deux étages : l'expéditeur ET la
--      plateforme. Le second protège yunoapp.eu — donc les confirmations de
--      billets de TOUS les clubs — d'un club qui déraperait.
--
--   3. DISJONCTEUR. Au-delà de 0,2 % de plaintes ou 5 % de bounces durs, la
--      campagne se met en pause TOUTE SEULE. Gmail coupe à 0,3 % de plaintes ;
--      on s'arrête avant, pas après.
--
-- Toutes les écritures de quota passent par des fonctions SECURITY DEFINER
-- réservées au service_role : un client ne peut pas s'auto-augmenter son cap.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. État d'un expéditeur (club ou organisateur) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.email_sender_state (
  scope_key text PRIMARY KEY,
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_send_at timestamptz,
  lifetime_sent bigint NOT NULL DEFAULT 0,
  daily_cap_override integer,
  trust_level text NOT NULL DEFAULT 'warming'
    CHECK (trust_level IN ('warming','trusted','restricted')),
  restricted_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_sender_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Senders read own state" ON public.email_sender_state;
CREATE POLICY "Senders read own state"
  ON public.email_sender_state FOR SELECT
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

-- ── 2. Compteur journalier ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_send_quota (
  scope_key text NOT NULL,
  day date NOT NULL DEFAULT CURRENT_DATE,
  sent integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, day)
);

ALTER TABLE public.email_send_quota ENABLE ROW LEVEL SECURITY;
-- Aucune policy : lecture via RPC uniquement.

-- ── 2 bis. Plafond plateforme aligné sur le PLAN RESEND ─────────────────────
-- Le gouverneur ne doit jamais laisser Yuno dépasser ce que le fournisseur
-- accepte : au-delà, Resend renvoie des 429 en rafale, les destinataires
-- repassent en file, épuisent leurs 3 tentatives et finissent en 'failed'.
-- Autrement dit, dépasser le plan ne ralentit pas l'envoi — il PERD des gens.
--
-- Valeur posée : plan GRATUIT (100 emails/jour, 3 000/mois, partagés avec TOUT
-- le transactionnel : billets, invitations, MFA, remboursements). On garde
-- 10 emails/jour de marge pour que les confirmations de billets passent
-- toujours avant une campagne.
--
--   ⚠️ APRÈS un passage en plan Pro (50 000/mois, pas de limite journalière) :
--      UPDATE public.email_sender_state
--         SET daily_cap_override = 25000, updated_at = now()
--       WHERE scope_key = 'platform';
--
-- Sous-dimensionner est réversible en une requête ; sur-dimensionner brûle des
-- destinataires et la réputation du domaine. On choisit le sens sûr.
INSERT INTO public.email_sender_state (scope_key, trust_level, daily_cap_override)
VALUES ('platform', 'trusted', 90)
ON CONFLICT (scope_key) DO NOTHING;

-- ── 3. Plafond du jour ──────────────────────────────────────────────────────
-- Rampe de warm-up indexée sur le nombre de jours depuis le premier envoi de
-- masse. Un override manuel (super admin) gagne toujours ; 'restricted' coupe.
CREATE OR REPLACE FUNCTION public.email_sender_daily_cap(p_scope_key text)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_days integer;
BEGIN
  SELECT * INTO v FROM public.email_sender_state WHERE scope_key = p_scope_key;

  -- Plateforme : plafond global, généreux mais fini.
  IF p_scope_key = 'platform' THEN
    RETURN COALESCE(v.daily_cap_override, 25000);
  END IF;

  IF v IS NULL THEN
    RETURN 300;                       -- tout premier envoi
  END IF;
  IF v.daily_cap_override IS NOT NULL THEN
    RETURN GREATEST(0, v.daily_cap_override);
  END IF;
  IF v.trust_level = 'restricted' THEN
    RETURN 0;
  END IF;
  IF v.trust_level = 'trusted' THEN
    RETURN 50000;
  END IF;
  IF v.first_send_at IS NULL THEN
    RETURN 300;
  END IF;

  v_days := GREATEST(0, (CURRENT_DATE - v.first_send_at::date));
  RETURN CASE
    WHEN v_days = 0 THEN 300
    WHEN v_days = 1 THEN 600
    WHEN v_days = 2 THEN 1200
    WHEN v_days = 3 THEN 2500
    WHEN v_days = 4 THEN 5000
    WHEN v_days = 5 THEN 10000
    ELSE 25000
  END;
END;
$$;

-- ── 4. Consommation atomique du quota ───────────────────────────────────────
-- Renvoie le nombre d'emails RÉELLEMENT autorisés (0 si le plafond est atteint).
-- Verrouillage dans un ordre fixe (plateforme puis expéditeur) : pas d'interblocage
-- entre deux campagnes concurrentes. Si l'expéditeur accorde moins que la
-- plateforme, la différence est rendue — un quota plateforme ne se perd pas.
CREATE OR REPLACE FUNCTION public.consume_email_send_quota(
  p_scope_key text,
  p_requested integer,
  p_venue_id text DEFAULT NULL,
  p_organizer_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req integer := GREATEST(0, COALESCE(p_requested, 0));
  v_platform integer;
  v_granted integer;
  v_sent integer;
  v_cap integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'consume_email_send_quota: service_role only';
  END IF;
  IF v_req = 0 THEN RETURN 0; END IF;

  -- Étage 1 : plateforme. L'upsert DO UPDATE crée ET verrouille la ligne en un
  -- seul aller-retour : pas de fenêtre où deux workers liraient 0 en même temps.
  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES ('platform', CURRENT_DATE, 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_sent;
  v_cap := public.email_sender_daily_cap('platform');
  v_platform := GREATEST(0, LEAST(v_req, v_cap - v_sent));
  IF v_platform = 0 THEN RETURN 0; END IF;

  UPDATE public.email_send_quota SET sent = sent + v_platform, updated_at = now()
   WHERE scope_key = 'platform' AND day = CURRENT_DATE;

  -- Étage 2 : expéditeur
  INSERT INTO public.email_sender_state (scope_key, venue_id, organizer_user_id)
  VALUES (p_scope_key, p_venue_id, p_organizer_user_id)
  ON CONFLICT (scope_key) DO NOTHING;

  INSERT INTO public.email_send_quota (scope_key, day, sent)
  VALUES (p_scope_key, CURRENT_DATE, 0)
  ON CONFLICT (scope_key, day) DO UPDATE SET updated_at = now()
  RETURNING sent INTO v_sent;
  v_cap := public.email_sender_daily_cap(p_scope_key);
  v_granted := GREATEST(0, LEAST(v_platform, v_cap - v_sent));

  IF v_granted < v_platform THEN
    -- Rendre à la plateforme ce que l'expéditeur n'a pas pris.
    UPDATE public.email_send_quota SET sent = sent - (v_platform - v_granted)
     WHERE scope_key = 'platform' AND day = CURRENT_DATE;
  END IF;
  IF v_granted = 0 THEN RETURN 0; END IF;

  UPDATE public.email_send_quota SET sent = sent + v_granted, updated_at = now()
   WHERE scope_key = p_scope_key AND day = CURRENT_DATE;

  UPDATE public.email_sender_state
     SET first_send_at = COALESCE(first_send_at, now()),
         lifetime_sent = lifetime_sent + v_granted,
         updated_at = now()
   WHERE scope_key = p_scope_key;

  RETURN v_granted;
END;
$$;

-- Restitution : le worker demande son quota AVANT de réserver (sinon une file
-- vide brûlerait du quota). Quand la file rend moins que le quota accordé, la
-- différence revient. Sans ça, un pro perdrait son plafond du jour sur des
-- réservations vides.
CREATE OR REPLACE FUNCTION public.refund_email_send_quota(
  p_scope_key text,
  p_amount integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount integer := GREATEST(0, COALESCE(p_amount, 0));
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'refund_email_send_quota: service_role only';
  END IF;
  IF v_amount = 0 THEN RETURN; END IF;

  UPDATE public.email_send_quota
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = p_scope_key AND day = CURRENT_DATE;

  UPDATE public.email_send_quota
     SET sent = GREATEST(0, sent - v_amount), updated_at = now()
   WHERE scope_key = 'platform' AND day = CURRENT_DATE;

  UPDATE public.email_sender_state
     SET lifetime_sent = GREATEST(0, lifetime_sent - v_amount)
   WHERE scope_key = p_scope_key;
END;
$$;

-- ── 5. Disjoncteur ──────────────────────────────────────────────────────────
-- Seuils : plainte > 0,2 % (Gmail coupe à 0,3 %), bounce dur > 5 %.
-- Échantillon minimum de 200 signaux : sur 20 envois, 1 bounce ferait 5 % et
-- mettrait en pause une campagne parfaitement saine.
CREATE OR REPLACE FUNCTION public.campaign_circuit_breaker(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_signals integer;
  v_bounce_rate numeric := 0;
  v_complaint_rate numeric := 0;
  v_reason text := NULL;
BEGIN
  SELECT id, status, recipients_count, bounced_count, complained_count
    INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  v_signals := GREATEST(c.recipients_count, 0);
  IF v_signals >= 200 THEN
    v_bounce_rate    := ROUND((c.bounced_count::numeric    / v_signals) * 100, 3);
    v_complaint_rate := ROUND((c.complained_count::numeric / v_signals) * 100, 3);
    IF v_complaint_rate > 0.2 THEN
      v_reason := 'complaint_rate';
    ELSIF v_bounce_rate > 5 THEN
      v_reason := 'bounce_rate';
    END IF;
  END IF;

  IF v_reason IS NOT NULL AND c.status = 'sending' THEN
    UPDATE public.email_campaigns
       SET status = 'paused',
           paused_reason = v_reason,
           error_message = CASE v_reason
             WHEN 'complaint_rate' THEN 'Pause automatique : ' || v_complaint_rate || ' % de plaintes'
             ELSE 'Pause automatique : ' || v_bounce_rate || ' % d''adresses invalides'
           END
     WHERE id = p_campaign_id AND status = 'sending';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'signals', v_signals,
    'bounce_rate', v_bounce_rate,
    'complaint_rate', v_complaint_rate,
    'paused', v_reason IS NOT NULL,
    'reason', v_reason
  );
END;
$$;

-- ── 6. Constitution de la file (une seule fois par campagne) ────────────────
-- Résout l'audience, retire les adresses supprimées, insère les destinataires
-- en 'pending'. Ré-appelable : ON CONFLICT DO NOTHING, donc relancer une
-- campagne bloquée ne re-crée jamais un destinataire déjà servi.
CREATE OR REPLACE FUNCTION public.enqueue_campaign_recipients(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queued integer := 0;
  v_suppressed integer := 0;
  v_total integer := 0;
  v_sent integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients: service_role only';
  END IF;

  -- Une seule instruction : pas de table temporaire (une RPC rejouée dans la
  -- même transaction la trouverait déjà créée). Les deux INSERT visent des
  -- sous-ensembles DISJOINTS (supprimées / non supprimées), donc aucun conflit
  -- croisé entre les deux CTE.
  WITH aud AS (
    SELECT DISTINCT ON (lower(a.email))
           lower(a.email) AS addr, a.first_name AS fname, a.last_name AS lname,
           a.unsubscribe_token AS tok
      FROM public.resolve_campaign_audience(p_campaign_id) a
     WHERE a.email IS NOT NULL AND position('@' in a.email) > 1
     ORDER BY lower(a.email)
  ), flagged AS (
    SELECT addr, fname, lname, tok, public.is_email_suppressed(addr) AS supp FROM aud
  ), ins AS (
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, unsubscribe_token, status)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, f.tok, 'pending'
      FROM flagged f WHERE NOT f.supp
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  ), sup AS (
    -- Trace des adresses écartées : l'owner doit pouvoir expliquer l'écart
    -- entre « ma liste fait 5 000 » et « 4 812 envoyés ».
    INSERT INTO public.email_campaign_recipients
      (campaign_id, email, first_name, last_name, status, error_message)
    SELECT p_campaign_id, f.addr, f.fname, f.lname, 'suppressed',
           'Adresse sur la liste de suppression (bounce ou plainte)'
      FROM flagged f WHERE f.supp
    ON CONFLICT (campaign_id, lower(email)) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins), (SELECT count(*) FROM flagged WHERE supp)
    INTO v_queued, v_suppressed;

  -- Personnalisation des contacts importés : resolve_campaign_audience lit les
  -- prénoms dans `profiles` via user_id, or un contact importé n'a pas de
  -- profil. On complète depuis la fiche d'abonnement, qui elle les porte.
  UPDATE public.email_campaign_recipients r
     SET first_name = COALESCE(r.first_name, ns.first_name),
         last_name  = COALESCE(r.last_name,  ns.last_name)
    FROM public.email_campaigns c
    JOIN public.newsletter_subscriptions ns
      ON ((c.venue_id IS NOT NULL AND ns.venue_id = c.venue_id)
       OR (c.organizer_user_id IS NOT NULL AND ns.organizer_user_id = c.organizer_user_id))
   WHERE c.id = p_campaign_id
     AND r.campaign_id = p_campaign_id
     AND lower(ns.email) = lower(r.email)
     AND (r.first_name IS NULL OR r.last_name IS NULL)
     AND (ns.first_name IS NOT NULL OR ns.last_name IS NOT NULL);

  SELECT count(*), count(*) FILTER (WHERE status = 'sent')
    INTO v_total, v_sent
    FROM public.email_campaign_recipients
   WHERE campaign_id = p_campaign_id AND status <> 'suppressed';

  UPDATE public.email_campaigns
     SET total_recipients = v_total,
         suppressed_count = v_suppressed,
         recipients_count = v_sent,
         send_started_at = COALESCE(send_started_at, now()),
         status = CASE WHEN v_total > v_sent THEN 'sending' ELSE status END,
         paused_reason = NULL,
         error_message = NULL
   WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'queued', v_queued, 'suppressed', v_suppressed,
    'total', v_total, 'already_sent', v_sent, 'remaining', v_total - v_sent
  );
END;
$$;

-- ── 7. Progression, lisible par le pro ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_campaign_send_progress(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_auth boolean := false;
  v_counts jsonb;
  v_cap integer;
  v_used integer;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  IF c.venue_id IS NOT NULL THEN
    v_auth := public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin();
  ELSIF c.organizer_user_id IS NOT NULL THEN
    v_auth := (c.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN v_auth := true; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT jsonb_object_agg(status, n) INTO v_counts
    FROM (SELECT status, count(*) AS n
            FROM public.email_campaign_recipients
           WHERE campaign_id = p_campaign_id GROUP BY status) s;

  SELECT public.email_sender_daily_cap(
           CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id
                ELSE 'org:' || c.organizer_user_id::text END)
    INTO v_cap;
  SELECT COALESCE(sent, 0) INTO v_used FROM public.email_send_quota
   WHERE scope_key = CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id
                          ELSE 'org:' || c.organizer_user_id::text END
     AND day = CURRENT_DATE;

  RETURN jsonb_build_object(
    'status', c.status,
    'paused_reason', c.paused_reason,
    'error_message', c.error_message,
    'total', c.total_recipients,
    'sent', c.recipients_count,
    'delivered', c.delivered_count,
    'bounced', c.bounced_count,
    'complained', c.complained_count,
    'failed', c.failed_count,
    'suppressed', c.suppressed_count,
    'opens', c.opens_count,
    'clicks', c.clicks_count,
    'by_status', COALESCE(v_counts, '{}'::jsonb),
    'daily_cap', v_cap,
    'daily_used', COALESCE(v_used, 0),
    'send_started_at', c.send_started_at,
    'last_slice_at', c.last_slice_at
  );
END;
$$;

-- ── 8. Pause / reprise / annulation par le pro ──────────────────────────────
-- La PAUSE reste ouverte en session support : couper un envoi qui dérape est
-- une action protectrice. La REPRISE, elle, est bloquée — relancer un envoi de
-- masse au nom du pro n'appartient qu'au pro.
CREATE OR REPLACE FUNCTION public.set_email_campaign_send_state(
  p_campaign_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_auth boolean := false;
BEGIN
  IF p_action NOT IN ('pause','resume','cancel') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;

  IF c.venue_id IS NOT NULL THEN
    v_auth := public.is_venue_owner(auth.uid(), c.venue_id) OR public.is_super_admin();
  ELSIF c.organizer_user_id IS NOT NULL THEN
    v_auth := (c.organizer_user_id = auth.uid()) OR public.is_super_admin();
  END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF p_action IN ('resume') AND public.is_support_session() THEN
    RAISE EXCEPTION 'Action indisponible en session support';
  END IF;

  IF p_action = 'pause' THEN
    UPDATE public.email_campaigns
       SET status = 'paused', paused_reason = 'manual'
     WHERE id = p_campaign_id AND status = 'sending';
  ELSIF p_action = 'resume' THEN
    UPDATE public.email_campaigns
       SET status = 'sending', paused_reason = NULL, error_message = NULL
     WHERE id = p_campaign_id AND status IN ('paused','failed');
  ELSE
    UPDATE public.email_campaigns
       SET status = 'cancelled', paused_reason = 'cancelled'
     WHERE id = p_campaign_id AND status IN ('sending','paused','scheduled');
    UPDATE public.email_campaign_recipients
       SET status = 'skipped', claimed_at = NULL,
           error_message = 'Campagne annulée'
     WHERE campaign_id = p_campaign_id AND status IN ('pending','sending');
  END IF;

  SELECT status INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'status', c.status);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_email_send_quota(text, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_email_send_quota(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_campaign_recipients(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campaign_circuit_breaker(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_email_send_quota(text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_email_send_quota(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_campaign_recipients(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.campaign_circuit_breaker(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_sender_daily_cap(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_send_progress(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_email_campaign_send_state(uuid, text) TO authenticated;
