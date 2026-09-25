-- ════════════════════════════════════════════════════════════════════════════
-- Entrepôt PostHog — l'offre de la marketplace, en lecture seule, sans PII.
--
-- PostHog (Data Warehouse) copie ces vues une fois par jour pour la section
-- « Offre » du dashboard « Yuno — Pilotage ». Règles :
--   • Un schéma à part (`analytics_wh`), des VUES seulement. Le rôle
--     `posthog_reader` n'a AUCUN droit sur `public` : il ne voit que ce schéma.
--   • Aucune colonne personnelle : ni email, ni nom, ni téléphone, ni adresse
--     IP, ni QR, ni remarque. L'acheteur est une clé opaque (`buyer_key` =
--     md5 salé par un sel tiré au hasard ici, jamais versionné, illisible par
--     le rôle) — elle permet de compter les acheteurs uniques et les
--     revenants, pas de retrouver quelqu'un.
--   • La démo est retirée du CALCUL (porte unique `demo_venue_ids()`,
--     `demo_event_ids()`, `is_demo_email()`), matérialisée une fois par
--     requête (CTE MATERIALIZED), jamais appelée ligne à ligne.
--   • Montants au format de `src/utils/fees.ts` : `club_revenue` = brut −
--     frais de service − assurance / gestion, remboursement exposé à part.
--   • Le pays du marché (`market_country`) = fuseau, ville en repli : miroir
--     SQL de `src/lib/geo.ts` et `_shared/geo.ts`.
--
-- Le mot de passe du rôle n'est PAS dans ce fichier : il est posé à part
-- (ALTER ROLE … PASSWORD) au moment de brancher la source dans PostHog.
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS analytics_wh;
CREATE SCHEMA IF NOT EXISTS analytics_wh_private;
REVOKE ALL ON SCHEMA analytics_wh_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA analytics_wh FROM PUBLIC, anon, authenticated;

-- Sel des clés opaques : tiré au hasard, jamais exposé.
CREATE TABLE IF NOT EXISTS analytics_wh_private.salt (
  id    boolean PRIMARY KEY DEFAULT true CHECK (id),
  value text NOT NULL
);
INSERT INTO analytics_wh_private.salt (value)
VALUES (encode(extensions.gen_random_bytes(24), 'hex'))
ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON analytics_wh_private.salt FROM PUBLIC, anon, authenticated;

-- ── Marché (miroir de src/lib/geo.ts) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION analytics_wh.market_country(p_tz text, p_city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    CASE trim(coalesce(p_tz, ''))
      WHEN 'Europe/Paris' THEN 'FR'
      WHEN 'Europe/Madrid' THEN 'ES' WHEN 'Africa/Ceuta' THEN 'ES' WHEN 'Atlantic/Canary' THEN 'ES'
      WHEN 'Europe/London' THEN 'GB' WHEN 'Europe/Brussels' THEN 'BE'
      WHEN 'Europe/Lisbon' THEN 'PT' WHEN 'Europe/Berlin' THEN 'DE'
      WHEN 'Europe/Rome' THEN 'IT' WHEN 'Europe/Amsterdam' THEN 'NL'
      WHEN 'Europe/Zurich' THEN 'CH' WHEN 'Europe/Luxembourg' THEN 'LU'
      WHEN 'Europe/Monaco' THEN 'MC' WHEN 'Europe/Dublin' THEN 'IE'
      WHEN 'America/Guadeloupe' THEN 'GP' WHEN 'America/Martinique' THEN 'MQ'
      WHEN 'Indian/Reunion' THEN 'RE'
    END,
    CASE lower(trim(translate(split_part(coalesce(p_city, ''), ',', 1),
                              'áàâäãéèêëíìîïóòôöõúùûüçñÁÀÂÄÉÈÊËÍÎÏÓÔÖÚÙÛÜÇÑ',
                              'aaaaaeeeeiiiiooooouuuucnAAAAEEEEIIIOOOUUUUCN')))
      WHEN 'paris' THEN 'FR' WHEN 'lyon' THEN 'FR' WHEN 'marseille' THEN 'FR'
      WHEN 'toulouse' THEN 'FR' WHEN 'bordeaux' THEN 'FR' WHEN 'lille' THEN 'FR'
      WHEN 'nice' THEN 'FR' WHEN 'nantes' THEN 'FR' WHEN 'montpellier' THEN 'FR'
      WHEN 'strasbourg' THEN 'FR' WHEN 'rennes' THEN 'FR' WHEN 'grenoble' THEN 'FR'
      WHEN 'cannes' THEN 'FR' WHEN 'biarritz' THEN 'FR' WHEN 'annecy' THEN 'FR'
      WHEN 'aix-en-provence' THEN 'FR' WHEN 'dijon' THEN 'FR' WHEN 'saint-tropez' THEN 'FR'
      WHEN 'madrid' THEN 'ES' WHEN 'barcelona' THEN 'ES' WHEN 'barcelone' THEN 'ES'
      WHEN 'valencia' THEN 'ES' WHEN 'valence' THEN 'ES' WHEN 'sevilla' THEN 'ES'
      WHEN 'seville' THEN 'ES' WHEN 'malaga' THEN 'ES' WHEN 'ibiza' THEN 'ES'
      WHEN 'eivissa' THEN 'ES' WHEN 'bilbao' THEN 'ES' WHEN 'marbella' THEN 'ES'
      WHEN 'palma' THEN 'ES' WHEN 'palma de mallorca' THEN 'ES' WHEN 'alicante' THEN 'ES'
      WHEN 'granada' THEN 'ES' WHEN 'zaragoza' THEN 'ES' WHEN 'salamanca' THEN 'ES'
      WHEN 'london' THEN 'GB' WHEN 'londres' THEN 'GB'
      WHEN 'brussels' THEN 'BE' WHEN 'bruxelles' THEN 'BE'
      WHEN 'lisbon' THEN 'PT' WHEN 'lisbonne' THEN 'PT' WHEN 'lisboa' THEN 'PT'
      WHEN 'geneva' THEN 'CH' WHEN 'geneve' THEN 'CH' WHEN 'monaco' THEN 'MC'
      WHEN 'luxembourg' THEN 'LU' WHEN 'berlin' THEN 'DE' WHEN 'amsterdam' THEN 'NL'
    END
  );
$$;

CREATE OR REPLACE FUNCTION analytics_wh.market_city(p_city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(initcap(trim(regexp_replace(split_part(coalesce(p_city, ''), ',', 1), '\m\d{4,5}\M', '', 'g'))), '');
$$;

-- Clé opaque d'une personne / d'un appareil (sel privé).
CREATE OR REPLACE FUNCTION analytics_wh_private.opaque_key(p_raw text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN nullif(trim(p_raw), '') IS NULL THEN NULL
              ELSE md5((SELECT value FROM analytics_wh_private.salt) || ':' || lower(trim(p_raw))) END;
$$;
REVOKE ALL ON FUNCTION analytics_wh_private.opaque_key(text) FROM PUBLIC, anon, authenticated;

-- ── Vues ───────────────────────────────────────────────────────────────────
-- Les vues tournent avec les droits de leur propriétaire (pas de
-- security_invoker) : le rôle lecteur n'a besoin d'aucun droit sur `public`.

CREATE OR REPLACE VIEW analytics_wh.venues AS
WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv)
SELECT v.id                                   AS venue_id,
       v.created_at,
       v.timezone,
       analytics_wh.market_country(v.timezone, v.city) AS market_country,
       analytics_wh.market_city(v.city)                AS market_city,
       (NOT coalesce(v.is_hidden, false) AND v.decommissioned_at IS NULL) AS is_live,
       v.decommissioned_at IS NOT NULL                 AS is_decommissioned,
       coalesce(v.stripe_charges_enabled, false)       AS stripe_ready,
       coalesce(v.menu_enabled, false)                 AS drinks_menu_enabled,
       v.music_genre
FROM public.venues v
CROSS JOIN d
WHERE NOT (v.id = ANY (d.dv));

CREATE OR REPLACE VIEW analytics_wh.organizers AS
SELECT o.user_id                                AS organizer_user_id,
       o.created_at,
       analytics_wh.market_country(NULL, o.city) AS market_country,
       analytics_wh.market_city(o.city)          AS market_city,
       coalesce(o.is_public, false)              AS is_public,
       coalesce(o.bde_verified, false)           AS is_bde
FROM public.organizer_profiles o
LEFT JOIN public.profiles p ON p.id = o.user_id
WHERE NOT coalesce(o.is_showcase_shadow, false)
  AND NOT coalesce(public.is_demo_email(p.email), false);

CREATE OR REPLACE VIEW analytics_wh.events AS
WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
SELECT e.id                                     AS event_id,
       e.venue_id,
       e.partner_venue_id,
       e.organizer_user_id,
       e.partner_organizer_id,
       e.created_at,
       e.published_at,
       e.start_at,
       e.end_at,
       e.status,
       coalesce(e.is_active, false)             AS is_active,
       e.cancelled_at,
       coalesce(e.ticketing_enabled, false)     AS ticketing_enabled,
       coalesce(e.tables_enabled, false)        AS tables_enabled,
       EXISTS (SELECT 1 FROM public.guest_lists g WHERE g.event_id = e.id AND coalesce(g.is_active, false)) AS guest_list_enabled,
       e.max_tickets,
       e.event_mode::text                       AS event_mode,
       e.event_kind::text                       AS event_kind,
       e.visibility::text                       AS visibility,
       coalesce(e.requires_access_code, false)  AS requires_access_code,
       e.music_genre,
       coalesce(e.tickets_sold_out, false)      AS tickets_sold_out,
       coalesce(e.tables_sold_out, false)       AS tables_sold_out,
       coalesce(e.guest_list_sold_out, false)   AS guest_list_sold_out,
       coalesce(e.timezone, v.timezone)         AS timezone,
       analytics_wh.market_country(coalesce(e.timezone, v.timezone), coalesce(e.location_city, v.city)) AS market_country,
       analytics_wh.market_city(coalesce(e.location_city, v.city)) AS market_city,
       (e.status = 'active' AND coalesce(e.is_active, false) AND e.cancelled_at IS NULL AND e.published_at IS NOT NULL) AS is_published
FROM public.events e
LEFT JOIN public.venues v ON v.id = coalesce(e.venue_id, e.partner_venue_id)
CROSS JOIN d
WHERE NOT (e.id = ANY (d.de));

CREATE OR REPLACE VIEW analytics_wh.ticket_rounds AS
WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
SELECT r.id AS ticket_round_id, r.event_id, r.created_at, r.price, r.max_tickets,
       coalesce(r.tickets_sold, 0) AS tickets_sold, coalesce(r.is_active, false) AS is_active,
       r.ticket_type, coalesce(r.is_group, false) AS is_group, r.group_size,
       coalesce(r.manually_sold_out, false) AS manually_sold_out, r.position
FROM public.ticket_rounds r
CROSS JOIN d
WHERE NOT (r.event_id = ANY (d.de));

CREATE OR REPLACE VIEW analytics_wh.table_packs AS
WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de)
SELECT p.id AS pack_id, p.zone_id, p.venue_id, p.event_id, p.created_at,
       p.base_price, p.base_capacity, p.deposit, p.deposit_type, p.minimum_spend,
       p.tables_count, coalesce(p.limit_tables, false) AS limit_tables,
       coalesce(p.payment_mode, 'online') AS payment_mode, coalesce(p.is_active, false) AS is_active
FROM public.table_packs p
CROSS JOIN d
WHERE NOT (coalesce(p.venue_id, '') = ANY (d.dv))
  AND NOT (p.event_id IS NOT NULL AND p.event_id = ANY (d.de));

CREATE OR REPLACE VIEW analytics_wh.tickets AS
WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
SELECT t.id AS ticket_id, t.event_id, t.ticket_round_id, t.created_at, t.paid_at, t.status,
       coalesce(t.quantity, 1) AS quantity, t.unit_price, t.total_price,
       coalesce(t.service_fee, 0) AS service_fee, coalesce(t.insurance_fee, 0) AS insurance_fee,
       coalesce(t.refund_amount, 0) AS refund_amount, t.refunded_at,
       coalesce(t.total_price, 0) - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0) AS club_revenue,
       coalesce(t.entry_scanned, false) OR coalesce(t.used, false) AS entry_scanned,
       t.entry_scanned_at, t.ticket_type, t.purchase_source,
       t.promo_code_id IS NOT NULL AS has_promo_code,
       t.tracked_link_id IS NOT NULL AS has_tracked_link,
       coalesce(t.is_guest, false) AS guest_checkout,
       analytics_wh_private.opaque_key(coalesce(t.user_id::text, t.user_email)) AS buyer_key
FROM public.tickets t
CROSS JOIN d
WHERE NOT (t.event_id = ANY (d.de))
  AND NOT coalesce(public.is_demo_email(t.user_email), false);

CREATE OR REPLACE VIEW analytics_wh.table_reservations AS
WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
SELECT r.id AS reservation_id, r.event_id, r.pack_id, r.zone_id, r.created_at, r.paid_at, r.status,
       coalesce(r.guest_count, 1) AS guest_count, r.total_price, r.deposit,
       coalesce(r.service_fee, 0) AS service_fee, coalesce(r.management_fee, 0) AS management_fee,
       coalesce(r.refund_amount, 0) AS refund_amount, r.refunded_at,
       coalesce(r.total_price, 0) - coalesce(r.service_fee, 0) - coalesce(r.management_fee, 0) AS club_revenue,
       coalesce(r.payment_mode, 'online') AS payment_mode,
       coalesce(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL AS entry_scanned,
       coalesce(r.entry_scanned_at, r.checked_in_at) AS entry_scanned_at,
       r.purchase_source,
       r.promo_code_id IS NOT NULL AS has_promo_code,
       r.tracked_link_id IS NOT NULL AS has_tracked_link,
       coalesce(r.is_guest, false) AS guest_checkout,
       analytics_wh_private.opaque_key(coalesce(r.user_id::text, r.user_email)) AS buyer_key
FROM public.table_reservations r
CROSS JOIN d
WHERE NOT (r.event_id = ANY (d.de))
  AND NOT coalesce(public.is_demo_email(r.user_email), false);

CREATE OR REPLACE VIEW analytics_wh.orders AS
WITH d AS MATERIALIZED (SELECT public.demo_venue_ids() AS dv, public.demo_event_ids() AS de)
SELECT o.id AS order_id, o.venue_id, o.event_id, o.created_at, o.paid_at, o.served_at, o.status,
       coalesce(o.total, 0) AS total, coalesce(o.service_fee, 0) AS service_fee,
       coalesce(o.refund_amount, 0) AS refund_amount, o.refunded_at,
       coalesce(o.total, 0) - coalesce(o.service_fee, 0) AS club_revenue,
       coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items END), 0) AS line_count,
       o.purchase_source,
       o.tracked_link_id IS NOT NULL AS has_tracked_link,
       coalesce(o.is_guest, false) AS guest_checkout,
       analytics_wh_private.opaque_key(coalesce(o.user_id::text, o.user_email)) AS buyer_key
FROM public.orders o
CROSS JOIN d
WHERE NOT (coalesce(o.venue_id, '') = ANY (d.dv))
  AND NOT (o.event_id IS NOT NULL AND o.event_id = ANY (d.de))
  AND NOT coalesce(public.is_demo_email(o.user_email), false);

CREATE OR REPLACE VIEW analytics_wh.guest_list_entries AS
WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
SELECT g.id AS entry_id, g.guest_list_id, l.event_id, g.created_at, g.status, g.entry_type,
       l.holder_type, g.promoter_id IS NOT NULL AS has_promoter,
       g.tracked_link_id IS NOT NULL AS has_tracked_link,
       coalesce(g.entry_scanned, false) AS entry_scanned, g.entry_scanned_at,
       analytics_wh_private.opaque_key(coalesce(g.user_id::text, g.email)) AS buyer_key
FROM public.guest_list_entries g
JOIN public.guest_lists l ON l.id = g.guest_list_id
CROSS JOIN d
WHERE NOT (l.event_id = ANY (d.de))
  AND NOT coalesce(public.is_demo_email(g.email), false);

-- Installations des apps natives (OTA Capgo) : aucun identifiant personnel,
-- l'appareil devient une clé opaque, `custom_id` n'est jamais exposé.
CREATE OR REPLACE VIEW analytics_wh.app_installs AS
SELECT analytics_wh_private.opaque_key(o.device_id) AS device_key,
       o.app_id, o.channel, o.platform, o.version_name, o.native_version,
       o.first_seen, o.last_seen
FROM public.ota_devices o;

-- ── Rôle lecteur ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'posthog_reader') THEN
    -- NOLOGIN tant que le mot de passe n'est pas posé (hors migration).
    CREATE ROLE posthog_reader NOLOGIN NOINHERIT;
  END IF;
END $$;

ALTER ROLE posthog_reader SET default_transaction_read_only = on;
ALTER ROLE posthog_reader SET statement_timeout = '120s';
ALTER ROLE posthog_reader SET search_path = analytics_wh;

GRANT USAGE ON SCHEMA analytics_wh TO posthog_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics_wh TO posthog_reader;
GRANT EXECUTE ON FUNCTION analytics_wh.market_country(text, text), analytics_wh.market_city(text) TO posthog_reader;
-- Les fonctions appelées DANS une vue sont vérifiées avec les droits de
-- l'appelant : le lecteur doit pouvoir exécuter la porte démo et la clé
-- opaque (SECURITY DEFINER, sel illisible), rien d'autre.
GRANT USAGE ON SCHEMA analytics_wh_private TO posthog_reader;
GRANT EXECUTE ON FUNCTION analytics_wh_private.opaque_key(text) TO posthog_reader;
GRANT EXECUTE ON FUNCTION public.demo_venue_ids(), public.demo_event_ids(), public.is_demo_email(text) TO posthog_reader;

COMMENT ON SCHEMA analytics_wh IS
  'Entrepôt PostHog (lecture seule, sans PII, démo exclue). Lu par le rôle posthog_reader. Voir la migration 20260925235000.';
