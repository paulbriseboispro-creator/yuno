-- Suite de l'audit Yuno CRM du 18/10 — MAIL-03 (P2) : un lot accepté par
-- Resend ne repart jamais une deuxième fois.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- AVANT : la clé d'idempotence d'un lot était tirée de sa COMPOSITION
-- (campagne + adresses). Si Resend acceptait le lot puis que l'écriture
-- « envoyé » échouait (l'API répond 503 pendant ~21 s après chaque migration),
-- les lignes restaient « sending », `requeue_stale_campaign_claims` les rendait
-- à la file dix minutes plus tard, et la réclamation suivante les regroupait
-- autrement (quota du moment, budget de lissage, autres lignes devenues dues) :
-- autre composition, autre clé, Resend expédiait une deuxième fois.
--
-- MAINTENANT : la réclamation pose une clé de lot sur les lignes
-- (`batch_key`). Tant qu'un lot n'est pas soldé (envoyé, refusé ou abandonné),
-- la réclamation suivante reprend CE lot en entier, et seulement lui, avec la
-- même clé : Resend rend la réponse d'origine au lieu de ré-expédier. Le
-- worker lève la clé quand Resend a répondu par un refus (rien n'est parti)
-- pour que ces lignes repartent dans un lot neuf.
--
-- Réécrit depuis 20261021110000 (audit du 18/10, pas encore en prod) ; seuls
-- les blocs marqués « MAIL-03 » changent. La signature des paramètres ne
-- change pas ; le résultat gagne une colonne (`batch_key`), d'où DROP +
-- CREATE. Un worker d'avant lit ses colonnes par leur nom et ignore celle-ci.

ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS batch_key text;

COMMENT ON COLUMN public.email_campaign_recipients.batch_key IS
  'Clé d''idempotence Resend du lot qui a emporté cette ligne. Gardée tant que le lot n''est pas soldé : une ligne rendue à la file avec sa clé repart dans le MÊME lot, avec la MÊME clé (audit 18/10, MAIL-03).';

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_open_batch
  ON public.email_campaign_recipients (campaign_id, batch_key)
  WHERE batch_key IS NOT NULL AND status IN ('pending', 'sending');

DROP FUNCTION IF EXISTS public.claim_campaign_recipients(uuid, integer);

CREATE FUNCTION public.claim_campaign_recipients(p_campaign_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(email text, first_name text, last_name text, unsubscribe_token uuid, attempts integer, ab_variant text, batch_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gate boolean := false;
  -- audit 18/10
  c record;
  v_marketing boolean := true;
  v_ids uuid[];
  v_skipped integer := 0;
  v_scope text;
  -- MAIL-03
  v_key text;
  v_open record;
  v_want integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'claim_campaign_recipients: service_role only';
  END IF;

  -- Phase de test A/B en cours : seules les lignes avec variante sont
  -- réclamables. Le reste attend le gagnant.
  SELECT ec.venue_id, ec.organizer_user_id, ec.name,
         (ec.ab_enabled AND COALESCE(ec.subject_b, '') <> '' AND ec.ab_winner IS NULL) AS gate,
         -- audit 18/10 : marketing = tout sauf l'e-mail de service et l'e-mail pratique.
         (COALESCE(ec.type, 'promotional') <> 'informational' AND NOT COALESCE(ec.practical, false)) AS marketing
    INTO c
    FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  v_gate := COALESCE(c.gate, false);
  v_marketing := COALESCE(c.marketing, true);

  -- MAIL-03 : un lot déjà confié à Resend et pas encore soldé passe d'abord,
  -- en entier (quelle que soit p_limit : il a été dimensionné à sa première
  -- réclamation, ≤ 100), et seul. Il n'est repris que si TOUTES ses lignes
  -- sont rendues à la file et dues : une ligne encore « sending » veut dire
  -- qu'un autre worker l'a en main.
  FOR v_open IN
    SELECT r.batch_key AS k
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.batch_key IS NOT NULL
       AND r.status IN ('pending', 'sending')
     GROUP BY r.batch_key
    HAVING bool_and(r.status = 'pending' AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now()))
     ORDER BY min(r.created_at), r.batch_key
     LIMIT 5
  LOOP
    SELECT count(*) INTO v_want
      FROM public.email_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id AND r.batch_key = v_open.k AND r.status = 'pending';
    SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
      FROM (
        SELECT r.id
          FROM public.email_campaign_recipients r
         WHERE r.campaign_id = p_campaign_id AND r.batch_key = v_open.k AND r.status = 'pending'
         FOR UPDATE SKIP LOCKED
      ) x;
    IF v_ids IS NOT NULL AND cardinality(v_ids) = v_want THEN
      v_key := v_open.k;
      EXIT;
    END IF;
    v_ids := NULL; -- une partie du lot est verrouillée ailleurs : le suivant.
  END LOOP;

  IF v_key IS NULL THEN
    -- audit 18/10 : on verrouille d'abord le lot, on trie ensuite.
    SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
      FROM (
        SELECT r.id
          FROM public.email_campaign_recipients r
         WHERE r.campaign_id = p_campaign_id
           AND r.status = 'pending'
           AND r.batch_key IS NULL -- MAIL-03 : une ligne d'un lot ouvert repart avec son lot.
           AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
           AND (NOT v_gate OR r.ab_variant IS NOT NULL)
         ORDER BY r.id
         LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100))
         FOR UPDATE SKIP LOCKED
      ) x;
    IF v_ids IS NULL THEN
      RETURN;
    END IF;
    -- Clé neuve, unique : jamais deux lots différents sous la même clé.
    v_key := 'yb-' || left(p_campaign_id::text, 8) || '-' || replace(gen_random_uuid()::text, '-', '');
  END IF;

  -- audit 18/10 : l'accord se relit au moment de l'envoi, pas seulement à la
  -- mise en file.
  IF v_marketing THEN
    WITH bad AS (
      SELECT r.id,
             CASE WHEN EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = lower(r.email))
                  THEN 'policy:suppressed_after_queue'
                  ELSE 'policy:opted_out_after_queue' END AS reason
        FROM public.email_campaign_recipients r
       WHERE r.id = ANY (v_ids)
         AND (EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = lower(r.email))
              OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                          WHERE lower(ns.email) = lower(r.email) AND ns.opted_in = false
                            AND ns.venue_id IS NOT DISTINCT FROM c.venue_id
                            AND ns.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id)
              OR EXISTS (SELECT 1 FROM public.email_opt_outs o
                          WHERE lower(o.email) = lower(r.email)
                            AND o.venue_id IS NOT DISTINCT FROM c.venue_id
                            AND o.organizer_user_id IS NOT DISTINCT FROM c.organizer_user_id))
    ), upd AS (
      UPDATE public.email_campaign_recipients q
         SET status = 'skipped', error_message = bad.reason, claimed_at = NULL
        FROM bad
       WHERE q.id = bad.id
      RETURNING 1
    )
    SELECT count(*) INTO v_skipped FROM upd;

    IF v_skipped > 0 THEN
      UPDATE public.email_campaigns
         SET policy_skipped_count = COALESCE(policy_skipped_count, 0) + v_skipped
       WHERE id = p_campaign_id;
      v_scope := public.crm_scope_key(c.venue_id, c.organizer_user_id);
      IF v_scope IS NOT NULL AND public.crm_campaign_is_crm(p_campaign_id) THEN
        -- Débité à la mise en file, jamais parti : le Yunit revient.
        PERFORM public.crm_yunits_refund(v_scope, v_skipped, 'email', 'email_campaign', p_campaign_id::text, c.name);
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  UPDATE public.email_campaign_recipients r
     SET status = 'sending',
         claimed_at = now(),
         attempts = r.attempts + 1,
         batch_key = v_key -- MAIL-03
   WHERE r.id = ANY (v_ids)
     AND r.status = 'pending'
  RETURNING r.email, r.first_name, r.last_name, r.unsubscribe_token, r.attempts, r.ab_variant, r.batch_key;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, integer) TO service_role;
