-- Base de contacts vivante : cache par portée (2026-09-29).
--
-- POURQUOI : contact_build_rows() reconstruisait TOUTE la base vivante
-- (fichiers importés ∪ clients Yuno ∪ engagement, contact_rows()) à CHAQUE
-- appel : 1 à 6 s sur les 12 300 contacts de l'organisateur démo, et la page
-- Contacts en lance deux en parallèle (vue d'ensemble + liste), plus un à chaque
-- recherche, filtre ou page. Sous charge, les deux dépassaient le
-- statement_timeout de 8 s : la page ne chargeait pas (500).
--
-- Ici : la base (identité, dépense, soirées, engagement) est gardée 2 minutes
-- par portée dans contact_base_cache. Le CONSENTEMENT (email_ok, phone_ok) reste
-- calculé EN DIRECT à chaque appel : un désabonnement compte tout de suite.
-- Un seul appel reconstruit (verrou consultatif par portée) ; l'autre attend
-- puis lit le cache. Une transaction en lecture seule (aperçu démo) n'écrit
-- rien et calcule comme avant. Les envois ne passent pas par ici : les
-- audiences lisent contact_rows() en direct (resolve_contact_segment_def).
--
-- Invalidation immédiate (triggers d'instruction) : fichier importé, fusion ou
-- retrait de liste, rafraîchissement de l'engagement. Le reste (une vente, une
-- inscription) apparaît dans les 2 minutes.

CREATE TABLE IF NOT EXISTS public.contact_base_cache AS
  SELECT NULL::text AS scope_key, r.*
    FROM public.contact_rows(NULL::text, NULL::uuid) r
  WITH NO DATA;
CREATE INDEX IF NOT EXISTS contact_base_cache_scope_idx ON public.contact_base_cache (scope_key);

CREATE TABLE IF NOT EXISTS public.contact_base_cache_state (
  scope_key text PRIMARY KEY,
  built_at  timestamptz NOT NULL
);

-- Tables internes : aucune policy, aucun droit client. Seules les fonctions
-- SECURITY DEFINER les lisent et les écrivent.
ALTER TABLE public.contact_base_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_base_cache_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_base_cache, public.contact_base_cache_state FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
$$;

CREATE OR REPLACE FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
  v_key text := public.contact_base_scope_key(p_venue_id, p_organizer_user_id);
  v_fresh boolean;
  v_read_only boolean := COALESCE(current_setting('transaction_read_only', true), 'off') = 'on';
BEGIN
  DROP TABLE IF EXISTS _cr;

  SELECT s.built_at > now() - interval '2 minutes' INTO v_fresh
    FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
  v_fresh := COALESCE(v_fresh, false);

  IF NOT v_fresh AND NOT v_read_only THEN
    -- Un seul reconstructeur par portée : l'appel parallèle attend ici puis
    -- trouve le cache frais.
    PERFORM pg_advisory_xact_lock(hashtext('contact_base_cache:' || v_key));
    SELECT s.built_at > now() - interval '2 minutes' INTO v_fresh
      FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
    v_fresh := COALESCE(v_fresh, false);
    IF NOT v_fresh THEN
      DELETE FROM public.contact_base_cache WHERE scope_key = v_key;
      INSERT INTO public.contact_base_cache
        SELECT v_key, r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r;
      INSERT INTO public.contact_base_cache_state (scope_key, built_at) VALUES (v_key, now())
        ON CONFLICT (scope_key) DO UPDATE SET built_at = EXCLUDED.built_at;
      v_fresh := true;
    END IF;
  END IF;

  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  WITH base AS (
    SELECT c.id,
           c.list_import_id,
           c.venue_id,
           c.organizer_user_id,
           c.email,
           c.phone_e164,
           c.first_name,
           c.last_name,
           c.country_code,
           c.country,
           c.region,
           c.city,
           c.postal_code,
           c.zone,
           c.age,
           c.gender,
           c.newsletter_opt_in,
           c.added_at,
           c.last_purchase_at,
           c.total_spent,
           c.event_count,
           c.extra,
           c.created_at,
           c.origin,
           c.user_id,
           c.imported_spent,
           c.imported_events,
           c.yuno_spent,
           c.yuno_events,
           c.yuno_first_at,
           c.yuno_last_at,
           c.ticket_count,
           c.table_count,
           c.order_count,
           c.guest_list_count,
           c.last_seen_at,
           c.eng_status,
           c.emails_sent,
           c.opens,
           c.clicks,
           c.last_opened_at,
           c.last_clicked_at,
           c.unsubscribed_at,
           c.bounced,
           c.subscribed,
           c.has_account
      FROM public.contact_base_cache c
     WHERE v_fresh AND c.scope_key = v_key
    UNION ALL
    SELECT r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r
     WHERE NOT v_fresh
  ), ok_e AS (
    SELECT DISTINCT lower(ns.email) AS e
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in
       AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id))
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS e FROM public.email_suppressions s
  ), ok_p AS (
    SELECT DISTINCT vc.phone_e164 AS p
      FROM public.venue_sms_contacts vc
     WHERE NOT vc.unsubscribed
       AND vc.sms_consent_at > now() - interval '36 months'
       AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id))
  )
  SELECT b.*,
         (b.email IS NOT NULL AND oe.e IS NOT NULL AND s.e IS NULL) AS email_ok,
         (b.phone_e164 IS NOT NULL AND op.p IS NOT NULL) AS phone_ok
    FROM base b
    LEFT JOIN ok_e oe ON oe.e = b.email
    LEFT JOIN sup s ON s.e = b.email
    LEFT JOIN ok_p op ON op.p = b.phone_e164;
  SELECT count(*) INTO v_n FROM _cr;
  RETURN v_n;
END;
$function$;

-- ─── Invalidation ──────────────────────────────────────────────────────────
-- Une alerte de cache ne doit jamais faire échouer l'écriture métier : tout est
-- enveloppé. Triggers d'INSTRUCTION avec table de transition : un import de
-- 1 000 lignes invalide sa portée une fois, pas 1 000 fois.
CREATE OR REPLACE FUNCTION public.contact_base_cache_invalidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      DELETE FROM public.contact_base_cache_state s
       WHERE s.scope_key IN (SELECT DISTINCT public.contact_base_scope_key(n.venue_id, n.organizer_user_id) FROM new_rows n);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      DELETE FROM public.contact_base_cache_state s
       WHERE s.scope_key IN (SELECT DISTINCT public.contact_base_scope_key(o.venue_id, o.organizer_user_id) FROM old_rows o);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['imported_contacts', 'contact_engagement', 'contact_list_imports'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS contact_base_cache_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS contact_base_cache_upd ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS contact_base_cache_del ON public.%I', t);
    EXECUTE format('CREATE TRIGGER contact_base_cache_ins AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.contact_base_cache_invalidate()', t);
    EXECUTE format('CREATE TRIGGER contact_base_cache_upd AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.contact_base_cache_invalidate()', t);
    EXECUTE format('CREATE TRIGGER contact_base_cache_del AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.contact_base_cache_invalidate()', t);
  END LOOP;
END;
$$;
