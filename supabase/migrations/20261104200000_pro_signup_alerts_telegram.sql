-- ═══════════════════════════════════════════════════════════════════════════
-- Alertes d'inscription pro → Telegram de Paul (demande du 20/10/2026), en
-- plus du Cockpit. Et une correction : une inscription bloquée ré-alertait
-- chaque jour tant qu'elle restait dans la fenêtre de 48 h (Poupée, 19/10 à
-- 21 h 49 puis 22 h 04 UTC, le jour de Paris ayant changé).
--
-- Telegram :
--   • le jeton du bot est le secret TELEGRAM_BOT_TOKEN (posé par Paul) ;
--   • le chat est retenu UNE fois (`ops_telegram_chat`) : la fonction lit les
--     derniers messages du bot (getUpdates) et garde le premier chat privé qui
--     a envoyé /start. Rien ne part ailleurs ; changer de chat = vider la table ;
--   • chaque alerte part en un message (fiche + boutons), puis la recherche sur
--     la structure en réponse à ce message ;
--   • l'e-mail de secours ne part plus quand Telegram a reçu l'alerte.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pro_signup_alerts
  ADD COLUMN IF NOT EXISTS telegram jsonb,
  ADD COLUMN IF NOT EXISTS telegram_sent_at timestamptz;

-- ── Le chat de Paul ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_telegram_chat (
  id         smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  chat_id    bigint      NOT NULL,
  username   text,
  first_name text,
  linked_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ops_telegram_chat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_telegram_chat FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_telegram_chat_get()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT chat_id FROM public.ops_telegram_chat WHERE id = 1
$$;
REVOKE ALL ON FUNCTION public.ops_telegram_chat_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_chat_get() TO service_role;

-- Le premier chat qui a dit /start gagne ; jamais réécrit ensuite.
CREATE OR REPLACE FUNCTION public.ops_telegram_chat_link(p_chat_id bigint, p_username text, p_first_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.ops_telegram_chat (id, chat_id, username, first_name)
  VALUES (1, p_chat_id, left(p_username, 64), left(p_first_name, 64))
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ops_telegram_chat_link(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_telegram_chat_link(bigint, text, text) TO service_role;

-- ── File Telegram ───────────────────────────────────────────────────────────
-- La fiche : une fois par alerte partie au Cockpit (2 jours au plus : au
-- branchement, les alertes récentes arrivent aussi).
CREATE OR REPLACE FUNCTION public.claim_pro_signup_telegram(p_limit integer DEFAULT 5)
RETURNS SETOF public.pro_signup_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.pro_signup_alerts a
     SET telegram_sent_at = now()
   WHERE a.id IN (
     SELECT x.id FROM public.pro_signup_alerts x
      WHERE x.status = 'sent' AND x.telegram_sent_at IS NULL
        AND x.created_at > now() - interval '2 days'
      ORDER BY x.created_at
      LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING a.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_pro_signup_telegram(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pro_signup_telegram(integer) TO service_role;

-- Résultat d'un envoi : fusionné dans `telegram` ; un échec rend la main.
CREATE OR REPLACE FUNCTION public.save_pro_signup_telegram(p_id uuid, p_ok boolean, p_patch jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pro_signup_alerts
     SET telegram = coalesce(telegram, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
         telegram_sent_at = CASE WHEN p_ok THEN telegram_sent_at ELSE NULL END
   WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.save_pro_signup_telegram(uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_pro_signup_telegram(uuid, boolean, jsonb) TO service_role;

-- La recherche, en réponse au message de la fiche, une fois qu'elle est faite.
CREATE OR REPLACE FUNCTION public.claim_pro_signup_telegram_research(p_limit integer DEFAULT 5)
RETURNS SETOF public.pro_signup_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  UPDATE public.pro_signup_alerts a
     SET telegram = a.telegram || jsonb_build_object('research_claimed_at', now())
   WHERE a.id IN (
     SELECT x.id FROM public.pro_signup_alerts x
      WHERE x.telegram->>'ok' = 'true'
        AND x.telegram->>'research_claimed_at' IS NULL
        AND x.research_status IN ('done', 'failed', 'skipped')
        AND x.created_at > now() - interval '2 days'
      ORDER BY x.created_at
      LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING a.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_pro_signup_telegram_research(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pro_signup_telegram_research(integer) TO service_role;

-- ── L'e-mail de secours se tait quand Telegram a reçu l'alerte ─────────────
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
        AND coalesce(x.telegram->>'ok', 'false') <> 'true'
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

-- ── Inscriptions bloquées : une alerte par PARCOURS, et 20 h entre deux ────
-- alertes pour la même adresse (avant : une par jour de Paris, si bien que le
-- même parcours ré-alertait après minuit).
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
    IF EXISTS (
      SELECT 1 FROM public.admin_notifications n
       WHERE n.notification_type = 'admin_pro_signup_stalled'
         AND lower(n.metadata->>'email') = lower(r.email)
         AND (n.created_at > now() - interval '20 hours' OR n.reference_id = r.id::text)
    ) THEN
      CONTINUE;
    END IF;

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
      'pro_signup_stalled:' || r.id::text
    ) IS NOT NULL THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.pro_signup_stalled_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pro_signup_stalled_sweep() TO service_role;
