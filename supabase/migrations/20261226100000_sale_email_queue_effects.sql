-- Tables VIP, vague C1 — P2.6 (D6) file des e-mails de vente, P2.7 effets rejouables après paiement, P6.6 observabilité.
--
-- D6 : Resend reste gratuit. Un e-mail de vente (confirmation de billet, e-mail d'une table) que Resend refuse pour quota (429)
-- ou panne (5xx, délai) n'est jamais perdu : la vente entre dans `sale_email_queue`, rejouée par le passage existant
-- process-scheduled-campaigns (+15 min, +1 h, puis le lendemain 8 h Paris, 4 tentatives au plus), avec une alerte super admin
-- `admin_sale_email_quota` (une par jour, dedup). Jamais pour la démo. Le client a toujours son QR sur la page de confirmation.
-- Idempotence : un e-mail plus récent déjà parti pour la même vente (sale_email_deliveries.sent_at >= création de la ligne) la
-- rend inutile (`dropped`).
--
-- P2.7 : `verify-table-payment` pose un marqueur par effet réussi (`table_effects`). Un rejeu (webhook, cron) qui trouve la table
-- `paid` avec des effets manquants relance SEULEMENT ceux-là. Les tables payées avant cette migration n'ont pas de ligne
-- 'started' : jamais rejouées (pas de doublon rétroactif).
--
-- P6.6 : `sale_effects_sweep()` (appelé par process-scheduled-campaigns, pas de nouveau cron) alerte une fois par vente quand une
-- table est payée depuis plus de 30 min sans e-mail parti ni en file.
--
-- Tables sans policy : tout passe par les RPC ci-dessous, réservées à service_role.

-- ── 1. File des e-mails de vente ────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_email_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL CHECK (kind IN ('ticket', 'table')),
  sale_id         uuid        NOT NULL,
  email_type      text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dropped', 'failed')),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_email_queue_pending
  ON public.sale_email_queue (kind, sale_id, email_type) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sale_email_queue_due
  ON public.sale_email_queue (next_attempt_at) WHERE status = 'pending';
ALTER TABLE public.sale_email_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_email_queue FROM anon, authenticated;

-- Prochaine tentative après l'échec n° p_attempts (1 → +1 h ; 2 → 8 h Paris, aujourd'hui si c'est assez loin, sinon demain).
CREATE OR REPLACE FUNCTION public._sale_email_next_attempt(p_attempts integer)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_attempts <= 1 THEN now() + interval '1 hour'
    ELSE (
      SELECT CASE WHEN c <= now() + interval '1 hour' THEN c + interval '1 day' ELSE c END
        FROM (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '8 hours') AT TIME ZONE 'Europe/Paris' AS c) s
    )
  END;
$$;

-- Adresse de la démo (domaine womber.fr et sous-domaines, motifs de is_demo_email()).
CREATE OR REPLACE FUNCTION public._is_demo_mail(p_email text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT p_email IS NOT NULL AND (
    lower(btrim(p_email)) ~ '@([a-z0-9-]+\.)*womber\.fr$'
    OR public.is_demo_email(lower(btrim(p_email)))
  );
$$;

-- Mise en file : appelée par send-vip-confirmation / send-ticket-confirmation quand Resend refuse. Rend l'id de la ligne, NULL
-- pour la démo (jamais de file ni d'alerte). Une ligne en attente par (vente, type) : un second échec ne la double pas.
CREATE OR REPLACE FUNCTION public.enqueue_sale_email(
  p_kind text, p_sale_id uuid, p_email_type text, p_payload jsonb, p_error text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event uuid;
  v_email text;
  v_id    uuid;
BEGIN
  IF p_kind NOT IN ('ticket', 'table') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'table' THEN
    SELECT event_id, user_email INTO v_event, v_email FROM public.table_reservations WHERE id = p_sale_id;
  ELSE
    SELECT event_id INTO v_event FROM public.tickets WHERE id = p_sale_id;
    v_email := p_payload->>'email';
  END IF;

  IF public._is_demo_mail(v_email) OR (v_event IS NOT NULL AND v_event = ANY (public.demo_event_ids())) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.sale_email_queue (kind, sale_id, email_type, payload, next_attempt_at, last_error)
  VALUES (p_kind, p_sale_id, COALESCE(NULLIF(p_email_type, ''), 'confirmation'), COALESCE(p_payload, '{}'::jsonb),
          now() + interval '15 minutes', left(p_error, 500))
  ON CONFLICT (kind, sale_id, email_type) WHERE status = 'pending'
  DO UPDATE SET last_error = EXCLUDED.last_error, updated_at = now()
  RETURNING id INTO v_id;

  -- Alerte super admin : une par jour (Paris), quel que soit le nombre d'e-mails en file.
  BEGIN
    PERFORM public.emit_admin_notification(
      'admin_sale_email_quota',
      'E-mails de vente en attente (Resend)',
      'Resend a refusé un e-mail de vente (' || p_kind || ' ' || p_sale_id || ') : il est rejoué à +15 min, +1 h, puis demain 8 h. '
        || 'Si cela se répète, le quota gratuit est atteint : vérifier le plan Resend. Le client garde son QR sur la page de confirmation.',
      'high', 'sale_email', p_sale_id::text,
      jsonb_build_object('kind', p_kind, 'sale_id', p_sale_id, 'email_type', p_email_type, 'error', left(p_error, 300)),
      'sale_email_quota:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
      v_event);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_sale_email alert failed: %', SQLERRM;
  END;

  RETURN v_id;
END;
$$;

-- Réclamation par le passage : les lignes dues, bail de 10 min (un second passage ne les reprend pas). Les e-mails devenus
-- inutiles (un plus récent est parti pour la vente) sont clos sans envoi.
CREATE OR REPLACE FUNCTION public.claim_sale_email_queue(p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, kind text, sale_id uuid, email_type text, payload jsonb, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.sale_email_queue q
     SET status = 'dropped', last_error = 'superseded', updated_at = now()
   WHERE q.status = 'pending'
     AND q.next_attempt_at <= now()
     AND EXISTS (SELECT 1 FROM public.sale_email_deliveries d
                  WHERE d.kind = q.kind AND d.sale_id = q.sale_id AND d.sent_at >= q.created_at);

  RETURN QUERY
  WITH due AS (
    SELECT q.id FROM public.sale_email_queue q
     WHERE q.status = 'pending' AND q.next_attempt_at <= now()
     ORDER BY q.next_attempt_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sale_email_queue q
     SET next_attempt_at = now() + interval '10 minutes', updated_at = now()
    FROM due
   WHERE q.id = due.id
  RETURNING q.id, q.kind, q.sale_id, q.email_type, q.payload, q.attempts;
END;
$$;

-- Résultat d'un rejeu : 'sent' | 'dropped' (état qui ne correspond plus, vente disparue) | 'retry'.
CREATE OR REPLACE FUNCTION public.finish_sale_email_queue(p_id uuid, p_result text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q public.sale_email_queue%ROWTYPE;
  v_attempts integer;
BEGIN
  SELECT * INTO q FROM public.sale_email_queue WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR q.status <> 'pending' THEN RETURN; END IF;

  IF p_result = 'sent' THEN
    UPDATE public.sale_email_queue SET status = 'sent', sent_at = now(), updated_at = now(), last_error = NULL WHERE id = p_id;
  ELSIF p_result = 'dropped' THEN
    UPDATE public.sale_email_queue SET status = 'dropped', updated_at = now(), last_error = left(p_error, 500) WHERE id = p_id;
  ELSE
    v_attempts := q.attempts + 1;
    IF v_attempts >= 3 THEN
      UPDATE public.sale_email_queue
         SET status = 'failed', attempts = v_attempts, updated_at = now(), last_error = left(p_error, 500)
       WHERE id = p_id;
      BEGIN
        PERFORM public.emit_admin_notification(
          'admin_sale_email_quota',
          'E-mail de vente abandonné après 4 tentatives',
          'L''e-mail ' || q.email_type || ' (' || q.kind || ' ' || q.sale_id || ') n''a pas pu partir après 4 tentatives : le renvoyer à la main '
            || '(le client a son QR sur la page de confirmation). Dernière erreur : ' || COALESCE(left(p_error, 200), '?'),
          'high', 'sale_email', q.sale_id::text,
          jsonb_build_object('kind', q.kind, 'sale_id', q.sale_id, 'email_type', q.email_type),
          'sale_email_failed:' || q.id, NULL);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'finish_sale_email_queue alert failed: %', SQLERRM;
      END;
    ELSE
      UPDATE public.sale_email_queue
         SET attempts = v_attempts, next_attempt_at = public._sale_email_next_attempt(v_attempts),
             updated_at = now(), last_error = left(p_error, 500)
       WHERE id = p_id;
    END IF;
  END IF;
END;
$$;

-- ── 2. Effets d'une table payée ───────────────────────────────────────────────────────────────────────────────────────
-- Une ligne par effet réussi. 'started' = la transition paid a eu lieu sous le nouveau code (les tables d'avant n'en ont pas).
CREATE TABLE IF NOT EXISTS public.table_effects (
  reservation_id uuid        NOT NULL REFERENCES public.table_reservations(id) ON DELETE CASCADE,
  key            text        NOT NULL CHECK (key IN ('started', 'notify', 'promoter', 'email')),
  done_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, key)
);
ALTER TABLE public.table_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_effects FROM anon, authenticated;

-- Réclamation des rejeux : tables payées (sous le nouveau code), 10 min à 3 jours, avec un effet manquant, 3 rejeux au plus.
CREATE TABLE IF NOT EXISTS public.table_effects_replays (
  reservation_id uuid        PRIMARY KEY REFERENCES public.table_reservations(id) ON DELETE CASCADE,
  replays        integer     NOT NULL DEFAULT 0,
  last_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.table_effects_replays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_effects_replays FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.table_effect_done(p_reservation_id uuid, p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.table_effects (reservation_id, key) VALUES (p_reservation_id, p_key)
  ON CONFLICT (reservation_id, key) DO NOTHING;
$$;

-- Les effets déjà faits d'une table payée (le rejeu ne relance que les autres).
CREATE OR REPLACE FUNCTION public.table_effects_done(p_reservation_id uuid)
RETURNS text[]
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(key), '{}'::text[]) FROM public.table_effects WHERE reservation_id = p_reservation_id;
$$;

CREATE OR REPLACE FUNCTION public.claim_table_effects_replays(p_limit integer DEFAULT 10)
RETURNS TABLE (reservation_id uuid, stripe_session_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH cand AS (
    SELECT r.id AS rid, r.stripe_session_id AS sid
      FROM public.table_reservations r
     WHERE r.status = 'paid'
       AND r.stripe_session_id IS NOT NULL
       AND r.paid_at BETWEEN now() - interval '3 days' AND now() - interval '10 minutes'
       AND EXISTS (SELECT 1 FROM public.table_effects s WHERE s.reservation_id = r.id AND s.key = 'started')
       AND (SELECT count(*) FROM public.table_effects e WHERE e.reservation_id = r.id AND e.key IN ('notify', 'promoter', 'email')) < 3
       AND COALESCE((SELECT p.replays FROM public.table_effects_replays p WHERE p.reservation_id = r.id), 0) < 3
       AND COALESCE((SELECT p.last_at FROM public.table_effects_replays p WHERE p.reservation_id = r.id), '-infinity'::timestamptz)
           < now() - interval '10 minutes'
       AND NOT public._is_demo_mail(r.user_email)
     ORDER BY r.paid_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
  ), bumped AS (
    INSERT INTO public.table_effects_replays AS p (reservation_id, replays, last_at)
    SELECT rid, 1, now() FROM cand
    ON CONFLICT (reservation_id) DO UPDATE SET replays = p.replays + 1, last_at = now()
    RETURNING p.reservation_id
  )
  SELECT c.rid, c.sid FROM cand c JOIN bumped b ON b.reservation_id = c.rid;
END;
$$;

-- ── 2 bis. Un seul envoi à la fois par vente (rejeu des effets) ─────────────────────────────────────────────────────
-- Webhook relivré + passage du cron en même temps : les deux voient « pas encore parti » puis envoient. Un bail de 3 min par (vente, type d'e-mail),
-- pris atomiquement, ferme la fenêtre ; si l'envoi échoue, le bail expire et le rejeu suivant reprend.
CREATE TABLE IF NOT EXISTS public.sale_email_claims (
  kind text NOT NULL,
  sale_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, sale_id)
);
ALTER TABLE public.sale_email_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_email_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sale_email_claims TO service_role;

CREATE OR REPLACE FUNCTION public.claim_sale_email_send(p_kind text, p_sale_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.sale_email_claims (kind, sale_id, claimed_at) VALUES (p_kind, p_sale_id, now())
  ON CONFLICT (kind, sale_id) DO UPDATE SET claimed_at = now() WHERE public.sale_email_claims.claimed_at < now() - interval '3 minutes';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_sale_email_send(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sale_email_send(text, uuid) TO service_role;

-- ── 3. P6.6 : une table payée sans e-mail au bout de 30 min ───────────────────────────────────────────────────────────
-- Une alerte par vente (dedup). Ni la démo, ni une réservation sans adresse (ajout manuel), ni un e-mail passé par la file, quel que
-- soit son état (l'alerte de quota ou de refus définitif le dit déjà). Appelée par process-scheduled-campaigns (aucun nouveau cron).
CREATE OR REPLACE FUNCTION public.sale_effects_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT tr.id, tr.event_id, tr.full_name, tr.user_email, tr.paid_at
      FROM public.table_reservations tr
     WHERE tr.status = 'paid'
       AND tr.paid_at BETWEEN now() - interval '7 days' AND now() - interval '30 minutes'
       AND COALESCE(btrim(tr.user_email), '') <> ''
       AND tr.payment_mode = 'online'
       AND tr.stripe_session_id IS NOT NULL            -- paiement en ligne seulement (jamais un ajout manuel du pro)
       AND NOT EXISTS (SELECT 1 FROM public.sale_email_deliveries d WHERE d.kind = 'table' AND d.sale_id = tr.id)
       AND NOT EXISTS (SELECT 1 FROM public.sale_email_queue q WHERE q.kind = 'table' AND q.sale_id = tr.id)  -- en file, partie, abandonnée (alerte de quota) ou refusée : déjà dite
       AND NOT public._is_demo_mail(tr.user_email)
       AND NOT (tr.event_id = ANY (public.demo_event_ids()))
     ORDER BY tr.paid_at
     LIMIT 50
  LOOP
    BEGIN
      PERFORM public.emit_admin_notification(
        'admin_table_paid_no_email',
        'Table payée sans e-mail de confirmation',
        COALESCE(r.full_name, 'Client') || ' a payé sa table (' || r.id || ') il y a plus de 30 min et n''a reçu aucun e-mail : '
          || 'renvoyer la confirmation (send-vip-confirmation, type confirmed) ou prévenir le client.',
        'high', 'table_reservation', r.id::text,
        jsonb_build_object('reservation_id', r.id, 'paid_at', r.paid_at),
        'table_paid_no_email:' || r.id, r.event_id);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sale_effects_sweep alert failed: %', SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── 4. Droits : service_role seul ─────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._sale_email_next_attempt(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._is_demo_mail(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_sale_email(text, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_sale_email_queue(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_sale_email_queue(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.table_effect_done(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.table_effects_done(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_table_effects_replays(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_effects_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sale_email_next_attempt(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public._is_demo_mail(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_sale_email(text, uuid, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_sale_email_queue(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_sale_email_queue(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_effect_done(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_effects_done(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_table_effects_replays(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sale_effects_sweep() TO service_role;
