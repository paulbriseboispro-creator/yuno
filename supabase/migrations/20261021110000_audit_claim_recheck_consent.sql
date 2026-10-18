-- Audit de préparation Yuno CRM (18/10) — lot envois.
-- Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md (MAIL-02, MAIL-06).
-- Réécrit depuis pg_get_functiondef de la prod (18/10) ; seuls les blocs
-- marqués « audit 18/10 » changent.
--
-- 1. MAIL-02 (P1) — un désabonnement, une plainte ou un rebond définitif
--    n'était appliqué qu'à la MISE EN FILE. Une campagne déjà en file (envoi
--    échelonné par vagues, rodage du domaine sur plusieurs jours, enfant
--    d'automatisation retenu par les heures calmes, étape de scénario)
--    continuait d'écrire à la personne. La réclamation revérifie maintenant,
--    juste avant l'envoi, pour le MARKETING seulement (un e-mail de service ou
--    un e-mail pratique aux détenteurs d'une soirée passe) : adresse dans la
--    liste de suppression (globale), accord retiré dans l'espace de la
--    campagne, adresse dans le repoussoir de l'espace. La ligne passe
--    « skipped » avec sa raison, compte dans les « protégés par les règles
--    Yuno » et, pour une campagne CRM, son Yunit revient.
--
-- 2. MAIL-06 — un envoi abandonné après 3 tentatives (worker interrompu)
--    passait « failed » sans compter dans failed_count : le compteur dérivait
--    et le Yunit débité à la mise en file ne revenait jamais.

CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(p_campaign_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(email text, first_name text, last_name text, unsubscribe_token uuid, attempts integer, ab_variant text)
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

  -- audit 18/10 : on verrouille d'abord le lot, on trie ensuite.
  SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
    FROM (
      SELECT r.id
        FROM public.email_campaign_recipients r
       WHERE r.campaign_id = p_campaign_id
         AND r.status = 'pending'
         AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
         AND (NOT v_gate OR r.ab_variant IS NOT NULL)
       ORDER BY r.id
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100))
       FOR UPDATE SKIP LOCKED
    ) x;
  IF v_ids IS NULL THEN
    RETURN;
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
         attempts = r.attempts + 1
   WHERE r.id = ANY (v_ids)
     AND r.status = 'pending'
  RETURNING r.email, r.first_name, r.last_name, r.unsubscribe_token, r.attempts, r.ab_variant;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.requeue_stale_campaign_claims(p_stale_minutes integer DEFAULT 10, p_max_attempts integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  -- audit 18/10
  v_per jsonb;
  g record;
  c record;
  v_scope text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'requeue_stale_campaign_claims: service_role only';
  END IF;

  WITH upd AS (
    UPDATE public.email_campaign_recipients r
       SET status = CASE WHEN r.attempts >= p_max_attempts THEN 'failed' ELSE 'pending' END,
           claimed_at = NULL,
           error_message = CASE WHEN r.attempts >= p_max_attempts
                                THEN 'Abandon après ' || r.attempts || ' tentatives (worker interrompu)'
                                ELSE r.error_message END
     WHERE r.status = 'sending'
       AND r.claimed_at IS NOT NULL
       AND r.claimed_at < now() - make_interval(mins => GREATEST(1, p_stale_minutes))
    RETURNING r.campaign_id, (r.status = 'failed') AS gave_up
  )
  -- audit 18/10 : un abandon compte comme un échec, par campagne.
  SELECT COALESCE(sum(n_all), 0)::integer,
         COALESCE(jsonb_agg(jsonb_build_object('campaign_id', campaign_id, 'n', n_failed))
                    FILTER (WHERE n_failed > 0), '[]'::jsonb)
    INTO v_count, v_per
    FROM (SELECT campaign_id, count(*) AS n_all, count(*) FILTER (WHERE gave_up) AS n_failed
            FROM upd GROUP BY campaign_id) per;

  FOR g IN SELECT (e->>'campaign_id')::uuid AS campaign_id, (e->>'n')::integer AS n
             FROM jsonb_array_elements(v_per) e LOOP
    UPDATE public.email_campaigns
       SET failed_count = COALESCE(failed_count, 0) + g.n
     WHERE id = g.campaign_id
    RETURNING venue_id, organizer_user_id, name INTO c;
    v_scope := public.crm_scope_key(c.venue_id, c.organizer_user_id);
    IF v_scope IS NOT NULL AND public.crm_campaign_is_crm(g.campaign_id) THEN
      PERFORM public.crm_yunits_refund(v_scope, g.n, 'email', 'email_campaign', g.campaign_id::text, c.name);
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.requeue_stale_campaign_claims(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stale_campaign_claims(integer, integer) TO service_role;
