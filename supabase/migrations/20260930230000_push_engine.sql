-- =============================================================================
-- Moteur de notifications Yuno — Yuno envoie, les pros lisent (2026-09-30)
-- =============================================================================
-- Design : docs/designs/NOTIFICATION_ENGINE_PLAN.md
--
-- Avant : chaque club activait (ou oubliait d'activer) ses automatisations
-- push, l'organisateur n'en avait aucune, une co-soirée non plus, et les
-- rappels du club doublonnaient ceux de la plateforme. Désormais Yuno décide,
-- pour TOUTES les soirées, qui reçoit quoi et quand :
--
--   1. push_engine_settings      — la politique réglée par le super admin.
--   2. platform_notification_settings (catégorie `event_engine`, `params`)
--                                — les règles du cycle de vie d'une soirée.
--   3. push_rule_templates       — les textes FR/EN/ES par règle et par RAISON.
--   4. push_candidates           — la file : (personne, soirée, règle, raison,
--                                  partie par laquelle on la touche, score,
--                                  fenêtre). Des collecteurs SQL idempotents la
--                                  remplissent ; l'arbitre la vide.
--   5. push_engine_claim()       — l'arbitre : une notification marketing au
--                                  plus par personne et par passage, la plus
--                                  utile ; heures calmes, plafonds adaptatifs,
--                                  budget par soirée. Ce qui n'a pas sa place
--                                  est REPORTÉ, jamais perdu avant expiration.
--   6. get_push_center()         — ce que voit le pro : par soirée, par règle,
--                                  « via ton audience » en co-soirée, CA club.
--   7. Crédits de campagnes manuelles (push_credit_*).
--
-- Sécurité de l'ordre de déploiement : les anciennes clés et tous les toggles
-- club / agence sont ÉTEINTS ici. Quel que soit l'ordre (migration ↔ edge),
-- rien ne part deux fois.
-- =============================================================================

-- ── 0. Politique globale ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_engine_settings (
  id         text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.push_engine_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_engine_settings_admin_read ON public.push_engine_settings;
CREATE POLICY push_engine_settings_admin_read ON public.push_engine_settings
  FOR SELECT TO authenticated USING (public.is_super_admin());
-- Aucune policy d'écriture : admin_set_push_engine_settings() seulement.

INSERT INTO public.push_engine_settings (id, settings) VALUES ('default', jsonb_build_object(
  'quiet_start', 22, 'quiet_end', 10,
  'daily_cap', 1, 'weekly_cap', 3, 'weekly_cap_engaged', 4, 'weekly_cap_fatigued', 1,
  'fatigue_sent', 6, 'fatigue_days', 45,
  'urgent_daily_cap', 2, 'per_event_max', 2,
  'credits_venue', 4, 'credits_org', 4, 'credits_agency', 2,
  'event_info_per_event', 2, 'manual_per_24h', 1
)) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.push_engine_setting(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE WHEN jsonb_typeof(s.settings -> p_key) = 'number'
                THEN round((s.settings ->> p_key)::numeric)::integer END
      FROM public.push_engine_settings s WHERE s.id = 'default'), p_default);
$$;

-- ── 1. Registre : les règles du moteur ───────────────────────────────────────
ALTER TABLE public.platform_notification_settings
  ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.platform_notification_settings
  DROP CONSTRAINT IF EXISTS platform_notification_settings_category_check;
ALTER TABLE public.platform_notification_settings
  ADD CONSTRAINT platform_notification_settings_category_check
  CHECK (category IN ('transactional', 'reminder', 'engagement', 'marketing',
                      'club_automation', 'event_engine', 'legacy'));

INSERT INTO public.platform_notification_settings (notification_key, enabled, category, params) VALUES
  ('new_event',          true, 'event_engine', '{"window_days":5,"min_before_hours":2,"past_customer_months":12,"include_past_customers":1,"include_dj_followers":1,"include_agency_followers":1}'),
  ('sales_open',         true, 'event_engine', '{}'),
  ('last_tickets',       true, 'event_engine', '{"threshold_pct":80,"max_days_before":14,"include_followers":1}'),
  ('last_call',          true, 'event_engine', '{"start_hour":12}'),
  ('checkout_abandoned', true, 'event_engine', '{"delay_minutes":45,"window_hours":6}'),
  ('vip_upsell',         true, 'event_engine', '{"days_before":3,"start_hour":14,"end_hour":21}'),
  ('event_day_reminder', true, 'event_engine', '{"hours_before":5}'),
  ('doors_open',         true, 'event_engine', '{"minutes_before":45}'),
  ('after_thanks',       true, 'event_engine', '{"start_hour":12,"window_hours":36}'),
  ('cart_abandonment_drinks', true, 'marketing', '{}')
ON CONFLICT (notification_key) DO UPDATE
  SET category = EXCLUDED.category,
      params   = CASE WHEN platform_notification_settings.params = '{}'::jsonb
                      THEN EXCLUDED.params ELSE platform_notification_settings.params END;

-- Anciennes clés remplacées par le moteur : éteintes (plus aucun émetteur ne
-- doit les envoyer, même une fonction pas encore redéployée).
UPDATE public.platform_notification_settings
   SET enabled = false, category = 'legacy', updated_at = now()
 WHERE notification_key IN ('reminder_day_of', 'event_live', 'thank_you', 'almost_sold_out',
                            'drinks_preorder', 'win_back', 'birthday', 'agency_new_event',
                            'event_reminder_4h', 'event_reminder_30m', 'cart_abandonment');

-- Les interrupteurs par club / agence n'ont plus de sens : Yuno décide.
UPDATE public.venue_push_automations SET enabled = false, updated_at = now() WHERE enabled;
DO $$
BEGIN
  IF to_regclass('public.agency_push_automations') IS NOT NULL THEN
    EXECUTE 'UPDATE public.agency_push_automations SET enabled = false WHERE enabled';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.push_rule_enabled(p_rule text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT s.enabled FROM public.platform_notification_settings s
                    WHERE s.notification_key = p_rule), true);
$$;

CREATE OR REPLACE FUNCTION public.push_rule_param(p_rule text, p_key text, p_default integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE jsonb_typeof(s.params -> p_key)
             WHEN 'number'  THEN round((s.params ->> p_key)::numeric)::integer
             WHEN 'boolean' THEN CASE WHEN (s.params ->> p_key)::boolean THEN 1 ELSE 0 END
           END
      FROM public.platform_notification_settings s WHERE s.notification_key = p_rule), p_default);
$$;

-- ── 2. Textes par règle, variante et raison ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_rule_templates (
  rule_key      text NOT NULL,
  variant       text NOT NULL DEFAULT 'default',
  reason        text NOT NULL DEFAULT 'any',
  lang          text NOT NULL CHECK (lang IN ('fr', 'en', 'es')),
  title         text NOT NULL,
  body          text NOT NULL,
  default_title text NOT NULL,
  default_body  text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  PRIMARY KEY (rule_key, variant, reason, lang)
);
ALTER TABLE public.push_rule_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_rule_templates_admin_read ON public.push_rule_templates;
CREATE POLICY push_rule_templates_admin_read ON public.push_rule_templates
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- Variables : {name} partie qui touche la personne (sinon « A × B »), {hosts},
-- {event}, {date}, {time}, {venue}, {dj}, {agency}, {next_event}, {next_date}.
-- Titres courts : iOS tronque vers 30 caractères.
INSERT INTO public.push_rule_templates (rule_key, variant, reason, lang, title, body, default_title, default_body)
SELECT v.rule_key, v.variant, v.reason, v.lang, v.title, v.body, v.title, v.body FROM (VALUES
  ('new_event','default','host_follower','fr','📅 Nouveau chez {name}','{event} — {date}. Sois dans les premiers à réserver.'),
  ('new_event','default','host_follower','en','📅 New at {name}','{event} — {date}. Be one of the first to book.'),
  ('new_event','default','host_follower','es','📅 Novedad en {name}','{event} — {date}. Sé de los primeros en reservar.'),
  ('new_event','default','past_customer','fr','{name} remet ça 🔁','{event} — {date}. Tu étais là la dernière fois : garde ta place.'),
  ('new_event','default','past_customer','en','{name} is back 🔁','{event} — {date}. You were there last time: save your spot.'),
  ('new_event','default','past_customer','es','{name} vuelve 🔁','{event} — {date}. Estuviste la última vez: guarda tu sitio.'),
  ('new_event','default','dj_follower','fr','🎧 {dj} joue le {date}','{event} chez {hosts}. Réserve ta place avant tout le monde.'),
  ('new_event','default','dj_follower','en','🎧 {dj} plays {date}','{event} at {hosts}. Book before everyone else.'),
  ('new_event','default','dj_follower','es','🎧 {dj} pincha el {date}','{event} en {hosts}. Reserva antes que nadie.'),
  ('new_event','default','agency_follower','fr','📅 {agency} présente','{event} — {date}. Réserve ta place dès maintenant.'),
  ('new_event','default','agency_follower','en','📅 {agency} presents','{event} — {date}. Book your spot now.'),
  ('new_event','default','agency_follower','es','📅 {agency} presenta','{event} — {date}. Reserva tu lugar ahora.'),
  ('sales_open','default','any','fr','🎟️ Billetterie ouverte','{event} — {date} chez {hosts}. Les premières places partent vite.'),
  ('sales_open','default','any','en','🎟️ Tickets are live','{event} — {date} at {hosts}. The first tickets go fast.'),
  ('sales_open','default','any','es','🎟️ Entradas a la venta','{event} — {date} en {hosts}. Las primeras vuelan.'),
  ('last_tickets','default','any','fr','⚡ Dernières places','{event} — {date}. Il en reste très peu.'),
  ('last_tickets','default','any','en','⚡ Last tickets','{event} — {date}. Only a few left.'),
  ('last_tickets','default','any','es','⚡ Últimas entradas','{event} — {date}. Quedan muy pocas.'),
  ('last_tickets','price_rise','any','fr','⏳ Le tarif va monter','{event} — le palier actuel est presque épuisé. Réserve au prix actuel.'),
  ('last_tickets','price_rise','any','en','⏳ Price goes up soon','{event} — the current tier is almost gone. Book at today''s price.'),
  ('last_tickets','price_rise','any','es','⏳ El precio va a subir','{event} — el tramo actual casi se agota. Reserva al precio actual.'),
  ('last_tickets','last_tables','any','fr','🥂 Dernières tables','{event} — {date}. Il ne reste que quelques tables.'),
  ('last_tickets','last_tables','any','en','🥂 Last tables','{event} — {date}. Only a few tables left.'),
  ('last_tickets','last_tables','any','es','🥂 Últimas mesas','{event} — {date}. Quedan pocas mesas.'),
  ('last_call','default','any','fr','🔥 C''est ce soir','{event} chez {hosts} — il reste des places. Réserve avant l''ouverture.'),
  ('last_call','default','any','en','🔥 It''s tonight','{event} at {hosts} — tickets still available. Book before doors.'),
  ('last_call','default','any','es','🔥 Es esta noche','{event} en {hosts} — quedan entradas. Reserva antes de abrir.'),
  ('checkout_abandoned','default','any','fr','Ta place t''attend 🎟️','{event} — {date}. Finalise ta réservation avant qu''il n''y en ait plus.'),
  ('checkout_abandoned','default','any','en','Your spot is waiting 🎟️','{event} — {date}. Finish booking before it''s gone.'),
  ('checkout_abandoned','default','any','es','Tu sitio te espera 🎟️','{event} — {date}. Termina tu reserva antes de que se agote.'),
  ('checkout_abandoned','table','any','fr','Ta table t''attend 🥂','{event} — {date}. Finalise ta réservation avant qu''elle parte.'),
  ('checkout_abandoned','table','any','en','Your table is waiting 🥂','{event} — {date}. Finish booking before it''s taken.'),
  ('checkout_abandoned','table','any','es','Tu mesa te espera 🥂','{event} — {date}. Termina tu reserva antes de que se la lleven.'),
  ('vip_upsell','default','any','fr','🥂 Passe en VIP','{event} : ta soirée est réservée. Ta table aussi ? Les meilleures partent en premier.'),
  ('vip_upsell','default','any','en','🥂 Go VIP','{event}: your night is booked. Your table too? The best ones go first.'),
  ('vip_upsell','default','any','es','🥂 Pásate a VIP','{event}: tu noche está reservada. ¿Y tu mesa? Las mejores vuelan.'),
  ('event_day_reminder','default','any','fr','🎟️ Ce soir : {event}','Rendez-vous à {time} chez {venue}. Ton QR est dans l''app.'),
  ('event_day_reminder','default','any','en','🎟️ Tonight: {event}','See you at {time} at {venue}. Your QR is in the app.'),
  ('event_day_reminder','default','any','es','🎟️ Esta noche: {event}','Nos vemos a las {time} en {venue}. Tu QR está en la app.'),
  ('event_day_reminder','drinks','any','fr','🎟️ Ce soir : {event}','Rendez-vous à {time}. Commande tes boissons dans l''app : zéro file au bar.'),
  ('event_day_reminder','drinks','any','en','🎟️ Tonight: {event}','See you at {time}. Order your drinks in the app: no bar queue.'),
  ('event_day_reminder','drinks','any','es','🎟️ Esta noche: {event}','Nos vemos a las {time}. Pide tus copas en la app: sin cola en la barra.'),
  ('doors_open','default','any','fr','Ouverture imminente 🎶','{event} — ton QR est prêt. Évite la file.'),
  ('doors_open','default','any','en','Doors open soon 🎶','{event} — your QR is ready. Skip the line.'),
  ('doors_open','default','any','es','Abrimos enseguida 🎶','{event} — tu QR está listo. Evita la cola.'),
  ('after_thanks','default','any','fr','Merci d''être venu ❤️','{hosts} — c''était une belle soirée. À très vite.'),
  ('after_thanks','default','any','en','Thanks for coming ❤️','{hosts} — what a night. See you soon.'),
  ('after_thanks','default','any','es','Gracias por venir ❤️','{hosts} — qué noche. Hasta muy pronto.'),
  ('after_thanks','next','any','fr','Merci d''être venu ❤️','Prochaine date : {next_event}, {next_date}. Réserve ta place.'),
  ('after_thanks','next','any','en','Thanks for coming ❤️','Next date: {next_event}, {next_date}. Book your spot.'),
  ('after_thanks','next','any','es','Gracias por venir ❤️','Próxima fecha: {next_event}, {next_date}. Reserva tu sitio.')
) AS v(rule_key, variant, reason, lang, title, body)
ON CONFLICT (rule_key, variant, reason, lang) DO UPDATE
  SET default_title = EXCLUDED.default_title, default_body = EXCLUDED.default_body;

-- ── 3. La file ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_candidates (
  id           bigserial PRIMARY KEY,
  dedup_key    text NOT NULL UNIQUE,
  user_id      uuid NOT NULL,
  rule_key     text NOT NULL,
  variant      text NOT NULL DEFAULT 'default',
  family       text NOT NULL CHECK (family IN ('marketing', 'urgent', 'event', 'reminder')),
  event_id     uuid REFERENCES public.events(id) ON DELETE CASCADE,
  reason       text NOT NULL,
  -- Partie par laquelle la personne est touchée : 'venue:<id>', 'org:<uuid>',
  -- 'dj:<uuid>', 'agency:<uuid>'. NULL = intérêt direct (favori, clic, panier).
  reason_party text,
  score        numeric NOT NULL DEFAULT 0,
  vars         jsonb NOT NULL DEFAULT '{}'::jsonb,
  not_before   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'skipped', 'expired')),
  -- Dernier motif de report (pending) ou de retrait (skipped / expired).
  hold_reason  text,
  attempts     integer NOT NULL DEFAULT 0,
  claimed_at   timestamptz,
  decided_at   timestamptz,
  campaign_id  uuid REFERENCES public.push_campaigns(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_candidates_due ON public.push_candidates (not_before) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_push_candidates_claimed ON public.push_candidates (claimed_at) WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS idx_push_candidates_user ON public.push_candidates (user_id, status);
CREATE INDEX IF NOT EXISTS idx_push_candidates_event ON public.push_candidates (event_id, rule_key, status);
CREATE INDEX IF NOT EXISTS idx_push_candidates_campaign ON public.push_candidates (campaign_id) WHERE campaign_id IS NOT NULL;
ALTER TABLE public.push_candidates ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul le service écrit, les pros lisent des COMPTEURS par RPC.

-- Une règle se collecte UNE fois par soirée (sauf panier abandonné, continu).
CREATE TABLE IF NOT EXISTS public.push_rule_runs (
  rule_key   text NOT NULL,
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  candidates integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_key, event_id)
);
ALTER TABLE public.push_rule_runs ENABLE ROW LEVEL SECURITY;

-- Heure d'annonce choisie par le pro (Shotgun : « caler l'annonce sur mon post »).
CREATE TABLE IF NOT EXISTS public.push_event_settings (
  event_id    uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  announce_at timestamptz,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_event_settings ENABLE ROW LEVEL SECURITY;

-- Lectures continues du collecteur de paniers abandonnés.
CREATE INDEX IF NOT EXISTS idx_tickets_pending_created ON public.tickets (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_table_reservations_pending_created ON public.table_reservations (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_event_user ON public.visitor_sessions (event_id) WHERE user_id IS NOT NULL;

-- ── 4. Briques ───────────────────────────────────────────────────────────────

-- Soirées qu'on a le droit de promouvoir : actives, publiques, sans code,
-- pas démo, lieu visible, à venir sous 120 jours.
CREATE OR REPLACE FUNCTION public._push_marketable_events()
RETURNS TABLE (event_id uuid, start_at timestamptz, published_at timestamptz, venue_id text, tz text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
  SELECT e.id, e.start_at, e.published_at, e.venue_id,
         COALESCE(NULLIF(e.timezone, ''), NULLIF(v.timezone, ''), 'Europe/Paris')
    FROM public.events e
    CROSS JOIN d
    LEFT JOIN public.venues v ON v.id = e.venue_id
   WHERE e.is_active
     AND COALESCE(e.visibility, 'public') = 'public'
     AND e.cancelled_at IS NULL
     AND COALESCE(e.status, 'active') = 'active'
     AND COALESCE(e.requires_access_code, false) = false
     AND e.start_at > now() AND e.start_at < now() + interval '120 days'
     AND NOT (e.id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
     AND (e.venue_id IS NULL OR (COALESCE(v.is_hidden, false) = false AND v.decommissioned_at IS NULL));
$$;

CREATE OR REPLACE FUNCTION public._push_reason_weight(p_reason text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_reason
    WHEN 'abandoned' THEN 100 WHEN 'interested' THEN 80 WHEN 'past_customer' THEN 60
    WHEN 'host_follower' THEN 55 WHEN 'dj_follower' THEN 50 WHEN 'agency_follower' THEN 45
    WHEN 'attendee' THEN 40 ELSE 30 END;
$$;

-- Valeur attendue : règle + raison + urgence (la soirée la plus proche d'abord).
CREATE OR REPLACE FUNCTION public._push_score(p_base integer, p_reason text, p_start timestamptz)
RETURNS numeric
LANGUAGE sql STABLE
AS $$
  SELECT (p_base + public._push_reason_weight(p_reason)
          + GREATEST(0, 14 - extract(epoch FROM (COALESCE(p_start, now() + interval '14 days') - now())) / 86400.0))::numeric;
$$;

-- A une place pour la soirée (billet, table, guest list) — acheteur ou bénéficiaire.
CREATE OR REPLACE FUNCTION public._push_has_bought(p_user uuid, p_event uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tickets t
                  WHERE t.event_id = p_event AND t.status IN ('paid', 'used')
                    AND (t.user_id = p_user OR t.claimed_by_user_id = p_user))
      OR EXISTS (SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = p_event AND r.status IN ('paid', 'confirmed')
                    AND (r.user_id = p_user OR r.claimed_by_user_id = p_user))
      OR EXISTS (SELECT 1 FROM public.guest_list_entries g
                   JOIN public.guest_lists gl ON gl.id = g.guest_list_id
                  WHERE gl.event_id = p_event AND g.user_id = p_user AND g.status <> 'cancelled');
$$;

-- Détenteurs d'une place, une ligne par personne ; came = passé la porte.
CREATE OR REPLACE FUNCTION public._push_event_holders(p_event uuid)
RETURNS TABLE (user_id uuid, reason text, came boolean, has_table boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH h AS (
    SELECT hu.uid AS user_id, 'ticket_holder'::text AS reason,
           (COALESCE(t.entry_scanned, false) OR t.status = 'used') AS came, false AS has_table
      FROM public.tickets t
      CROSS JOIN LATERAL unnest(ARRAY[t.user_id, t.claimed_by_user_id]) AS hu(uid)
     WHERE t.event_id = p_event AND t.status IN ('paid', 'used')
    UNION ALL
    SELECT hu.uid, 'ticket_holder', (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL), true
      FROM public.table_reservations r
      CROSS JOIN LATERAL unnest(ARRAY[r.user_id, r.claimed_by_user_id]) AS hu(uid)
     WHERE r.event_id = p_event AND r.status IN ('paid', 'confirmed')
    UNION ALL
    SELECT g.user_id, 'guest', COALESCE(g.entry_scanned, false), false
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id = p_event AND g.status <> 'cancelled'
  )
  SELECT h.user_id,
         CASE WHEN bool_or(h.reason = 'ticket_holder') THEN 'ticket_holder' ELSE 'guest' END,
         bool_or(h.came), bool_or(h.has_table)
    FROM h WHERE h.user_id IS NOT NULL
   GROUP BY h.user_id;
$$;

-- Intéressés : ont touché une notification de la soirée, l'ont mise en favori,
-- ont regardé sa page connectés (30 j), ont commencé un paiement, ou sont sur
-- sa liste d'attente.
CREATE OR REPLACE FUNCTION public._push_event_interested(p_event uuid)
RETURNS TABLE (user_id uuid, on_waitlist boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH i AS (
    SELECT pce.user_id, false AS w FROM public.push_campaign_events pce
      JOIN public.push_campaigns pc ON pc.id = pce.campaign_id
     WHERE pc.event_id = p_event AND pce.event_type = 'clicked'
    UNION ALL
    SELECT f.user_id, false FROM public.favorites f WHERE f.favorite_type = 'event' AND f.event_id = p_event
    UNION ALL
    SELECT vs.user_id, false FROM public.visitor_sessions vs
     WHERE vs.event_id = p_event AND vs.user_id IS NOT NULL AND vs.created_at > now() - interval '30 days'
    UNION ALL
    SELECT t.user_id, false FROM public.tickets t WHERE t.event_id = p_event AND t.status = 'pending'
    UNION ALL
    SELECT r.user_id, false FROM public.table_reservations r WHERE r.event_id = p_event AND r.status = 'pending'
    UNION ALL
    SELECT w.user_id, true FROM public.event_waitlist w WHERE w.event_id = p_event
  )
  SELECT i.user_id, bool_or(i.w) FROM i WHERE i.user_id IS NOT NULL GROUP BY i.user_id;
$$;

-- Reste-t-il quelque chose à vendre (billets ou tables) ?
CREATE OR REPLACE FUNCTION public._push_event_sellable(p_event uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT e.is_active AND e.cancelled_at IS NULL AND (
      (COALESCE(e.ticketing_enabled, true) AND NOT COALESCE(e.tickets_sold_out, false)
        AND EXISTS (SELECT 1 FROM public.ticket_rounds r
                     WHERE r.event_id = e.id AND r.is_active AND NOT COALESCE(r.manually_sold_out, false)
                       AND (r.max_tickets IS NULL OR COALESCE(r.tickets_sold, 0) < r.max_tickets)))
      OR (COALESCE(e.tables_enabled, false) AND NOT COALESCE(e.tables_sold_out, false)
          AND COALESCE(public._event_tables_left(e.id), 0) > 0))
      FROM public.events e WHERE e.id = p_event), false);
$$;

-- Rareté réelle : 'default' (palier global ≥ seuil), 'price_rise' (palier
-- ouvert presque vide avant un plus cher), 'last_tables' (≤ 3 tables, au moins
-- une déjà prise), sinon NULL.
CREATE OR REPLACE FUNCTION public._push_scarcity_variant(p_event uuid, p_threshold integer)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e record;
  v_cap bigint; v_sold bigint; v_unlimited boolean; v_left integer;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(e.ticketing_enabled, true) AND NOT COALESCE(e.tickets_sold_out, false) THEN
    SELECT COALESCE(sum(r.max_tickets) FILTER (WHERE r.max_tickets > 0), 0),
           COALESCE(sum(LEAST(COALESCE(r.tickets_sold, 0), r.max_tickets)) FILTER (WHERE r.max_tickets > 0), 0),
           COALESCE(bool_or(r.max_tickets IS NULL AND r.is_active AND NOT COALESCE(r.manually_sold_out, false)), false)
      INTO v_cap, v_sold, v_unlimited
      FROM public.ticket_rounds r WHERE r.event_id = p_event;
    IF v_cap > 0 AND NOT v_unlimited AND v_sold < v_cap AND v_sold::numeric >= v_cap * p_threshold / 100.0 THEN
      RETURN 'default';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.ticket_rounds r1
       WHERE r1.event_id = p_event AND r1.is_active AND NOT COALESCE(r1.manually_sold_out, false)
         AND r1.max_tickets > 0 AND COALESCE(r1.tickets_sold, 0) < r1.max_tickets
         AND COALESCE(r1.tickets_sold, 0)::numeric >= r1.max_tickets * 0.9
         AND EXISTS (SELECT 1 FROM public.ticket_rounds r2
                      WHERE r2.event_id = p_event AND r2.position > r1.position
                        AND r2.price > r1.price AND NOT COALESCE(r2.manually_sold_out, false))
    ) THEN
      RETURN 'price_rise';
    END IF;
  END IF;
  IF COALESCE(e.tables_enabled, false) AND NOT COALESCE(e.tables_sold_out, false) THEN
    v_left := public._event_tables_left(p_event);
    IF v_left IS NOT NULL AND v_left BETWEEN 1 AND 3
       AND EXISTS (SELECT 1 FROM public.table_reservations r
                    WHERE r.event_id = p_event AND r.status IN ('paid', 'confirmed')) THEN
      RETURN 'last_tables';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Soirées passées (12 mois) d'une partie, en principal — ses anciens clients.
CREATE OR REPLACE FUNCTION public._push_party_past_events(p_kind text, p_venue text, p_org uuid, p_months integer, p_exclude uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id FROM public.events e
   WHERE p_kind = 'venue' AND e.venue_id = p_venue
     AND e.start_at < now() AND e.start_at > now() - make_interval(months => p_months) AND e.id <> p_exclude
  UNION
  SELECT e.id FROM public.events e
   WHERE p_kind = 'venue' AND e.partner_venue_id = p_venue
     AND e.start_at < now() AND e.start_at > now() - make_interval(months => p_months) AND e.id <> p_exclude
  UNION
  SELECT e.id FROM public.events e
   WHERE p_kind = 'org' AND e.organizer_user_id = p_org
     AND e.start_at < now() AND e.start_at > now() - make_interval(months => p_months) AND e.id <> p_exclude
  UNION
  SELECT e.id FROM public.events e
   WHERE p_kind = 'org' AND e.partner_organizer_id = p_org
     AND e.start_at < now() AND e.start_at > now() - make_interval(months => p_months) AND e.id <> p_exclude;
$$;

-- Une annonce déjà partie par l'ancien système (avant le moteur) ne se refait pas.
CREATE OR REPLACE FUNCTION public._push_legacy_sent(p_event uuid, p_keys text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.push_campaigns c
                  WHERE c.event_id = p_event AND c.source = 'auto'
                    AND c.template_key = ANY (p_keys)
                    AND COALESCE(c.audience ->> 'engine', '') <> 'true');
$$;

CREATE OR REPLACE FUNCTION public._push_mark_run(p_rule text, p_event uuid, p_n integer)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.push_rule_runs (rule_key, event_id, candidates)
  VALUES (p_rule, p_event, COALESCE(p_n, 0))
  ON CONFLICT (rule_key, event_id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public._push_reachable(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = p_user AND ps.platform = 'ios');
$$;

-- ── 5. Collecteurs ───────────────────────────────────────────────────────────

-- L'annonce : l'union des audiences de TOUTES les parties, une personne = une
-- ligne, avec la meilleure raison (ancien client > abonné > fan du DJ > abonné
-- d'agence). p_dj_ids non NULL = ajout au line-up : seulement ces fans-là.
CREATE OR REPLACE FUNCTION public._push_collect_announcement(
  p_event_id uuid, p_not_before timestamptz, p_expires timestamptz, p_dj_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_n      integer := 0;
  v_months integer := public.push_rule_param('new_event', 'past_customer_months', 12);
  v_past   boolean := public.push_rule_param('new_event', 'include_past_customers', 1) > 0;
  v_djs    boolean := public.push_rule_param('new_event', 'include_dj_followers', 1) > 0;
  v_ag     boolean := public.push_rule_param('new_event', 'include_agency_followers', 1) > 0;
  v_start  timestamptz; v_city text;
  v_venue  text; v_org uuid; v_pvenue text; v_porg uuid;
BEGIN
  SELECT e.start_at, COALESCE(v.city, e.location_city), e.venue_id, e.organizer_user_id,
         e.partner_venue_id, e.partner_organizer_id
    INTO v_start, v_city, v_venue, v_org, v_pvenue, v_porg
    FROM public.events e LEFT JOIN public.venues v ON v.id = e.venue_id
   WHERE e.id = p_event_id;
  IF v_start IS NULL OR p_expires <= GREATEST(p_not_before, now()) THEN RETURN 0; END IF;

  WITH parties AS MATERIALIZED (SELECT * FROM public.event_parties(p_event_id)),
  aud AS (
    SELECT f.user_id, 'host_follower'::text AS reason, p.party_key AS party, p.ord, NULL::jsonb AS vars
      FROM public.favorites f JOIN parties p ON p.kind = 'venue' AND f.venue_id = p.venue_id
     WHERE p_dj_ids IS NULL AND f.favorite_type = 'club' AND f.user_id IS NOT NULL
    UNION ALL
    SELECT f.user_id, 'host_follower', p.party_key, p.ord, NULL
      FROM public.organizer_profile_followers f JOIN parties p ON p.kind = 'org' AND f.organizer_user_id = p.organizer_user_id
     WHERE p_dj_ids IS NULL
    UNION ALL
    SELECT t.user_id, 'past_customer', p.party_key, p.ord, NULL
      FROM parties p
      CROSS JOIN LATERAL public._push_party_past_events(p.kind, p.venue_id, p.organizer_user_id, v_months, p_event_id) pe(id)
      JOIN public.tickets t ON t.event_id = pe.id AND t.status IN ('paid', 'used') AND t.user_id IS NOT NULL
     WHERE p_dj_ids IS NULL AND v_past
    UNION ALL
    SELECT r.user_id, 'past_customer', p.party_key, p.ord, NULL
      FROM parties p
      CROSS JOIN LATERAL public._push_party_past_events(p.kind, p.venue_id, p.organizer_user_id, v_months, p_event_id) pe(id)
      JOIN public.table_reservations r ON r.event_id = pe.id AND r.status IN ('paid', 'confirmed') AND r.user_id IS NOT NULL
     WHERE p_dj_ids IS NULL AND v_past
    UNION ALL
    SELECT g.user_id, 'past_customer', p.party_key, p.ord, NULL
      FROM parties p
      CROSS JOIN LATERAL public._push_party_past_events(p.kind, p.venue_id, p.organizer_user_id, v_months, p_event_id) pe(id)
      JOIN public.guest_lists gl ON gl.event_id = pe.id
      JOIN public.guest_list_entries g ON g.guest_list_id = gl.id AND g.status <> 'cancelled' AND g.user_id IS NOT NULL
     WHERE p_dj_ids IS NULL AND v_past
    UNION ALL
    -- Fans des DJ du line-up, grain PERSONNE (toutes les fiches du DJ), dans la zone.
    SELECT f.user_id, 'dj_follower', 'dj:' || d.id::text, 9,
           jsonb_build_object('dj', COALESCE(NULLIF(btrim(d.stage_name), ''),
                                             NULLIF(btrim(concat_ws(' ', d.first_name, d.last_name)), ''), 'DJ'))
      FROM public.event_djs ed
      JOIN public.djs d ON d.id = ed.dj_id
      JOIN public.favorites f ON f.favorite_type = 'dj'
           AND (f.dj_id = d.id OR (d.user_id IS NOT NULL AND f.dj_id IN (SELECT d2.id FROM public.djs d2 WHERE d2.user_id = d.user_id)))
      LEFT JOIN public.profiles pr ON pr.id = f.user_id
     WHERE ed.event_id = p_event_id AND v_djs
       AND (p_dj_ids IS NULL OR ed.dj_id = ANY (p_dj_ids))
       AND f.user_id IS NOT NULL
       AND (COALESCE(f.notify_all_locations, false)
            OR (v_city IS NOT NULL AND pr.city IS NOT NULL AND (
                  lower(btrim(pr.city)) = lower(btrim(v_city))
                  OR position(lower(btrim(v_city)) IN lower(btrim(pr.city))) > 0
                  OR position(lower(btrim(pr.city)) IN lower(btrim(v_city))) > 0)))
    UNION ALL
    -- Abonnés des agences sous contrat actif avec le club ou l'organisateur.
    SELECT af.user_id, 'agency_follower', 'agency:' || a.id::text, 10, jsonb_build_object('agency', a.name)
      FROM public.agency_venue_contracts c
      JOIN public.agencies a ON a.id = c.agency_id AND COALESCE(a.is_active, true)
      JOIN public.agency_followers af ON af.agency_id = a.id
     WHERE p_dj_ids IS NULL AND v_ag AND c.status = 'active' AND af.user_id IS NOT NULL
       AND ((c.venue_id IS NOT NULL AND (c.venue_id = v_venue OR c.venue_id = v_pvenue))
         OR (c.organizer_user_id IS NOT NULL AND (c.organizer_user_id = v_org OR c.organizer_user_id = v_porg)))
  ),
  best AS (
    SELECT DISTINCT ON (a.user_id) a.user_id, a.reason, a.party, a.vars
      FROM aud a
     ORDER BY a.user_id, public._push_reason_weight(a.reason) DESC, a.ord, a.party
  )
  INSERT INTO public.push_candidates
    (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
  SELECT 'new_event:' || p_event_id::text || ':' || b.user_id::text, b.user_id, 'new_event', 'default', 'marketing',
         p_event_id, b.reason, b.party, public._push_score(20, b.reason, v_start), COALESCE(b.vars, '{}'::jsonb),
         GREATEST(p_not_before, now()), p_expires
    FROM best b
   WHERE public._push_reachable(b.user_id)
     AND NOT public._push_has_bought(b.user_id, p_event_id)
  ON CONFLICT (dedup_key) DO UPDATE
     SET reason = EXCLUDED.reason, reason_party = EXCLUDED.reason_party,
         score = EXCLUDED.score, vars = EXCLUDED.vars
   WHERE push_candidates.status = 'pending' AND push_candidates.score < EXCLUDED.score;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Abonnés de toutes les parties d'une soirée (relance « dernières places »).
CREATE OR REPLACE FUNCTION public._push_event_host_followers(p_event uuid)
RETURNS TABLE (user_id uuid, party text, ord integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH parties AS MATERIALIZED (SELECT * FROM public.event_parties(p_event))
  SELECT f.user_id, p.party_key, p.ord
    FROM public.favorites f JOIN parties p ON p.kind = 'venue' AND f.venue_id = p.venue_id
   WHERE f.favorite_type = 'club' AND f.user_id IS NOT NULL
  UNION ALL
  SELECT f.user_id, p.party_key, p.ord
    FROM public.organizer_profile_followers f JOIN parties p ON p.kind = 'org' AND f.organizer_user_id = p.organizer_user_id;
$$;

CREATE OR REPLACE FUNCTION public._push_collect_new_event()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; v_n integer; v_total integer := 0;
  v_window integer := public.push_rule_param('new_event', 'window_days', 5);
  v_min    integer := public.push_rule_param('new_event', 'min_before_hours', 2);
  v_nb timestamptz; v_exp timestamptz;
BEGIN
  IF NOT public.push_rule_enabled('new_event') THEN RETURN 0; END IF;
  FOR r IN
    SELECT m.event_id, m.start_at, m.published_at, ps.announce_at
      FROM public._push_marketable_events() m
      JOIN public.events e ON e.id = m.event_id
      LEFT JOIN public.push_event_settings ps ON ps.event_id = m.event_id
     WHERE m.published_at IS NOT NULL
       AND (m.published_at > now() - make_interval(days => v_window)
            OR (ps.announce_at IS NOT NULL AND ps.announce_at > now() - interval '1 day'))
       AND m.start_at > now() + make_interval(hours => v_min)
       -- Une occurrence de série récurrente n'est une nouveauté que la 1re fois.
       AND (e.recurring_template_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM public.events e2
               WHERE e2.recurring_template_id = e.recurring_template_id
                 AND e2.id <> e.id AND e2.created_at < e.created_at))
       AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'new_event' AND rr.event_id = m.event_id)
       AND NOT public._push_legacy_sent(m.event_id, ARRAY['new_event'])
  LOOP
    v_nb  := GREATEST(now(), COALESCE(r.announce_at, now()));
    v_exp := LEAST(r.start_at - make_interval(hours => v_min), v_nb + make_interval(days => v_window));
    v_n := public._push_collect_announcement(r.event_id, v_nb, v_exp, NULL);
    PERFORM public._push_mark_run('new_event', r.event_id, v_n);
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public._push_collect_sales_open()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE r record; v_n integer; v_total integer := 0;
BEGIN
  IF NOT public.push_rule_enabled('sales_open') THEN RETURN 0; END IF;
  FOR r IN
    SELECT m.event_id, m.start_at
      FROM public._push_marketable_events() m
      JOIN public.events e ON e.id = m.event_id
     WHERE e.public_sale_start_at IS NOT NULL
       AND e.public_sale_start_at <= now() AND e.public_sale_start_at > now() - interval '6 hours'
       AND e.public_sale_start_at > COALESCE(m.published_at, e.created_at) + interval '1 hour'
       AND m.start_at > now() + interval '3 hours'
       AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'sales_open' AND rr.event_id = m.event_id)
  LOOP
    INSERT INTO public.push_candidates
      (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
    SELECT 'sales_open:' || r.event_id::text || ':' || i.user_id::text, i.user_id, 'sales_open', 'default', 'marketing',
           r.event_id, 'interested', NULL, public._push_score(30, 'interested', r.start_at), '{}'::jsonb,
           now(), LEAST(r.start_at - interval '2 hours', now() + interval '48 hours')
      FROM public._push_event_interested(r.event_id) i
     WHERE NOT i.on_waitlist  -- la liste d'attente a déjà son push (waitlist_presale)
       AND public._push_reachable(i.user_id)
       AND NOT public._push_has_bought(i.user_id, r.event_id)
    ON CONFLICT (dedup_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public._push_mark_run('sales_open', r.event_id, v_n);
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public._push_collect_last_tickets()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; v_n integer; v_total integer := 0;
  v_threshold integer := public.push_rule_param('last_tickets', 'threshold_pct', 80);
  v_max_days  integer := public.push_rule_param('last_tickets', 'max_days_before', 14);
  v_followers boolean := public.push_rule_param('last_tickets', 'include_followers', 1) > 0;
BEGIN
  IF NOT public.push_rule_enabled('last_tickets') THEN RETURN 0; END IF;
  FOR r IN
    SELECT m.event_id, m.start_at, x.variant,
           GREATEST(now(), COALESCE(ps.announce_at, now())) AS nb
      FROM public._push_marketable_events() m
      LEFT JOIN public.push_event_settings ps ON ps.event_id = m.event_id
      CROSS JOIN LATERAL (SELECT public._push_scarcity_variant(m.event_id, v_threshold) AS variant) x
     WHERE m.start_at > now() + interval '6 hours'
       AND m.start_at < now() + make_interval(days => v_max_days)
       AND x.variant IS NOT NULL
       AND GREATEST(now(), COALESCE(ps.announce_at, now())) < m.start_at - interval '4 hours'
       AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'last_tickets' AND rr.event_id = m.event_id)
       AND NOT public._push_legacy_sent(m.event_id, ARRAY['almost_sold_out'])
  LOOP
    WITH aud AS (
      SELECT i.user_id, 'interested'::text AS reason, NULL::text AS party, 0 AS ord
        FROM public._push_event_interested(r.event_id) i
      UNION ALL
      SELECT hf.user_id, 'host_follower', hf.party, hf.ord
        FROM public._push_event_host_followers(r.event_id) hf WHERE v_followers
    ),
    best AS (
      SELECT DISTINCT ON (a.user_id) a.user_id, a.reason, a.party FROM aud a
       ORDER BY a.user_id, public._push_reason_weight(a.reason) DESC, a.ord
    )
    INSERT INTO public.push_candidates
      (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
    SELECT 'last_tickets:' || r.event_id::text || ':' || b.user_id::text, b.user_id, 'last_tickets', r.variant, 'marketing',
           r.event_id, b.reason, b.party, public._push_score(30, b.reason, r.start_at), '{}'::jsonb,
           r.nb, LEAST(r.start_at - interval '3 hours', r.nb + interval '72 hours')
      FROM best b
     WHERE public._push_reachable(b.user_id)
       AND NOT public._push_has_bought(b.user_id, r.event_id)
    ON CONFLICT (dedup_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public._push_mark_run('last_tickets', r.event_id, v_n);
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public._push_collect_last_call()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; v_n integer; v_total integer := 0;
  v_hour integer := public.push_rule_param('last_call', 'start_hour', 12);
BEGIN
  IF NOT public.push_rule_enabled('last_call') THEN RETURN 0; END IF;
  FOR r IN
    SELECT m.event_id, m.start_at
      FROM public._push_marketable_events() m
     WHERE m.start_at BETWEEN now() + interval '1 hour' AND now() + interval '14 hours'
       AND extract(hour FROM now() AT TIME ZONE m.tz) >= v_hour
       AND public._push_event_sellable(m.event_id)
       AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'last_call' AND rr.event_id = m.event_id)
  LOOP
    INSERT INTO public.push_candidates
      (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
    SELECT 'last_call:' || r.event_id::text || ':' || i.user_id::text, i.user_id, 'last_call', 'default', 'marketing',
           r.event_id, 'interested', NULL, public._push_score(40, 'interested', r.start_at), '{}'::jsonb,
           now(), r.start_at - interval '30 minutes'
      FROM public._push_event_interested(r.event_id) i
     WHERE public._push_reachable(i.user_id)
       AND NOT public._push_has_bought(i.user_id, r.event_id)
    ON CONFLICT (dedup_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public._push_mark_run('last_call', r.event_id, v_n);
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Continu : un checkout billet / table resté « pending ». Une seule relance par
-- personne et par soirée (dedup_key), retirée si la personne achète entre-temps.
CREATE OR REPLACE FUNCTION public._push_collect_checkout_abandoned()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_n integer := 0;
  v_delay  integer := public.push_rule_param('checkout_abandoned', 'delay_minutes', 45);
  v_window integer := public.push_rule_param('checkout_abandoned', 'window_hours', 6);
BEGIN
  IF NOT public.push_rule_enabled('checkout_abandoned') THEN RETURN 0; END IF;
  WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de),
  x AS (
    SELECT t.user_id, t.event_id, t.created_at, 'default'::text AS variant
      FROM public.tickets t
     WHERE t.status = 'pending' AND t.user_id IS NOT NULL
       AND t.created_at > now() - make_interval(hours => v_window)
       AND t.created_at < now() - make_interval(mins => v_delay)
    UNION ALL
    SELECT r.user_id, r.event_id, r.created_at, 'table'
      FROM public.table_reservations r
     WHERE r.status = 'pending' AND r.user_id IS NOT NULL
       AND r.created_at > now() - make_interval(hours => v_window)
       AND r.created_at < now() - make_interval(mins => v_delay)
  ),
  pick AS (
    SELECT DISTINCT ON (x.user_id, x.event_id) x.user_id, x.event_id, x.created_at, x.variant, e.start_at
      FROM x
      JOIN public.events e ON e.id = x.event_id
      CROSS JOIN d
     WHERE e.is_active AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') = 'active'
       AND e.start_at > now() + interval '90 minutes'
       AND NOT (e.id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
     ORDER BY x.user_id, x.event_id, (x.variant = 'table') DESC, x.created_at DESC
  )
  INSERT INTO public.push_candidates
    (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
  SELECT 'checkout_abandoned:' || p.event_id::text || ':' || p.user_id::text, p.user_id, 'checkout_abandoned',
         p.variant, 'urgent', p.event_id, 'abandoned', NULL, public._push_score(50, 'abandoned', p.start_at),
         '{}'::jsonb, now(), LEAST(p.created_at + make_interval(hours => v_window), p.start_at - interval '1 hour')
    FROM pick p
   WHERE LEAST(p.created_at + make_interval(hours => v_window), p.start_at - interval '1 hour') > now()
     AND public._push_reachable(p.user_id)
     AND NOT public._push_has_bought(p.user_id, p.event_id)
  ON CONFLICT (dedup_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public._push_collect_vip_upsell()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; v_n integer; v_total integer := 0;
  v_days integer := public.push_rule_param('vip_upsell', 'days_before', 3);
  v_h1   integer := public.push_rule_param('vip_upsell', 'start_hour', 14);
  v_h2   integer := public.push_rule_param('vip_upsell', 'end_hour', 21);
BEGIN
  IF NOT public.push_rule_enabled('vip_upsell') THEN RETURN 0; END IF;
  FOR r IN
    WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
    SELECT e.id AS event_id, e.start_at
      FROM public.events e
      CROSS JOIN d
      LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.is_active AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') = 'active'
       AND NOT (e.id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
       AND COALESCE(e.tables_enabled, false) AND NOT COALESCE(e.tables_sold_out, false)
       AND e.start_at > now() + interval '20 hours'
       AND e.start_at < now() + make_interval(days => v_days)
       AND extract(hour FROM now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), NULLIF(v.timezone, ''), 'Europe/Paris'))
           BETWEEN v_h1 AND v_h2 - 1
       AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'vip_upsell' AND rr.event_id = e.id)
       AND NOT public._push_legacy_sent(e.id, ARRAY['vip_upsell'])
       AND COALESCE(public._event_tables_left(e.id), 0) > 0
  LOOP
    INSERT INTO public.push_candidates
      (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
    SELECT 'vip_upsell:' || r.event_id::text || ':' || h.user_id::text, h.user_id, 'vip_upsell', 'default', 'event',
           r.event_id, 'ticket_holder', NULL, public._push_score(20, 'ticket_holder', r.start_at), '{}'::jsonb,
           now(), LEAST(r.start_at - interval '6 hours', now() + interval '30 hours')
      FROM public._push_event_holders(r.event_id) h
     WHERE h.reason = 'ticket_holder' AND NOT h.has_table
       AND public._push_reachable(h.user_id)
    ON CONFLICT (dedup_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public._push_mark_run('vip_upsell', r.event_id, v_n);
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Rappels d'une soirée ACHETÉE (privée comprise) : jour J et ouverture.
CREATE OR REPLACE FUNCTION public._push_collect_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; v_n integer; v_total integer := 0;
  v_hours integer := public.push_rule_param('event_day_reminder', 'hours_before', 5);
  v_mins  integer := public.push_rule_param('doors_open', 'minutes_before', 45);
  v_day   boolean := public.push_rule_enabled('event_day_reminder');
  v_doors boolean := public.push_rule_enabled('doors_open');
BEGIN
  IF v_day THEN
    FOR r IN
      WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
      SELECT e.id AS event_id, e.start_at, COALESCE(v.menu_enabled, false) AS drinks
        FROM public.events e
        CROSS JOIN d
        LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
       WHERE e.is_active AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') = 'active'
         AND NOT (e.id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
         AND e.start_at > now() + interval '90 minutes'
         AND e.start_at <= now() + make_interval(hours => v_hours)
         AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'event_day_reminder' AND rr.event_id = e.id)
         AND NOT public._push_legacy_sent(e.id, ARRAY['reminder_day_of'])
    LOOP
      INSERT INTO public.push_candidates
        (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
      SELECT 'event_day_reminder:' || r.event_id::text || ':' || h.user_id::text, h.user_id, 'event_day_reminder',
             CASE WHEN r.drinks THEN 'drinks' ELSE 'default' END, 'reminder', r.event_id, h.reason, NULL,
             public._push_score(0, h.reason, r.start_at), '{}'::jsonb, now(), r.start_at
        FROM public._push_event_holders(r.event_id) h
       WHERE NOT h.came AND public._push_reachable(h.user_id)
      ON CONFLICT (dedup_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      PERFORM public._push_mark_run('event_day_reminder', r.event_id, v_n);
      v_total := v_total + v_n;
    END LOOP;
  END IF;

  IF v_doors THEN
    FOR r IN
      WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
      SELECT e.id AS event_id, e.start_at
        FROM public.events e
        CROSS JOIN d
       WHERE e.is_active AND e.cancelled_at IS NULL AND COALESCE(e.status, 'active') = 'active'
         AND NOT (e.id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
         AND e.start_at > now() + interval '5 minutes'
         AND e.start_at <= now() + make_interval(mins => v_mins)
         AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'doors_open' AND rr.event_id = e.id)
         AND NOT public._push_legacy_sent(e.id, ARRAY['event_live'])
    LOOP
      INSERT INTO public.push_candidates
        (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
      SELECT 'doors_open:' || r.event_id::text || ':' || h.user_id::text, h.user_id, 'doors_open', 'default',
             'reminder', r.event_id, h.reason, NULL, public._push_score(0, h.reason, r.start_at), '{}'::jsonb,
             now(), r.start_at + interval '30 minutes'
        FROM public._push_event_holders(r.event_id) h
       WHERE NOT h.came AND public._push_reachable(h.user_id)
      ON CONFLICT (dedup_key) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      PERFORM public._push_mark_run('doors_open', r.event_id, v_n);
      v_total := v_total + v_n;
    END LOOP;
  END IF;
  RETURN v_total;
END;
$$;

-- Le lendemain : merci aux personnes ENTRÉES, avec la prochaine date d'une des
-- parties quand il y en a une (c'est ce qui fait revenir).
CREATE OR REPLACE FUNCTION public._push_collect_after_thanks()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; nx record; v_n integer; v_total integer := 0; v_vars jsonb;
  v_hour   integer := public.push_rule_param('after_thanks', 'start_hour', 12);
  v_window integer := public.push_rule_param('after_thanks', 'window_hours', 36);
  v_anchor timestamptz;
BEGIN
  IF NOT public.push_rule_enabled('after_thanks') THEN RETURN 0; END IF;
  FOR r IN
    WITH d AS MATERIALIZED (SELECT public.demo_event_ids() AS de)
    SELECT e.id AS event_id, COALESCE(e.end_at, e.start_at + interval '6 hours') AS end_at,
           COALESCE(NULLIF(e.timezone, ''), NULLIF(v.timezone, ''), 'Europe/Paris') AS tz
      FROM public.events e
      CROSS JOIN d
      LEFT JOIN public.venues v ON v.id = e.venue_id
     WHERE e.is_active AND e.cancelled_at IS NULL
       AND NOT (e.id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') < now()
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') > now() - interval '3 days'
       AND NOT EXISTS (SELECT 1 FROM public.push_rule_runs rr WHERE rr.rule_key = 'after_thanks' AND rr.event_id = e.id)
       AND NOT public._push_legacy_sent(e.id, ARRAY['thank_you'])
  LOOP
    v_anchor := (date_trunc('day', r.end_at AT TIME ZONE r.tz) + make_interval(hours => v_hour)) AT TIME ZONE r.tz;
    CONTINUE WHEN now() < v_anchor;
    IF now() > v_anchor + make_interval(hours => v_window) THEN
      PERFORM public._push_mark_run('after_thanks', r.event_id, 0);
      CONTINUE;
    END IF;

    -- Prochaine soirée d'une des parties (45 jours).
    SELECT n.id, n.title, n.start_at INTO nx
      FROM public.event_parties(r.event_id) p
      JOIN public.events n ON (p.kind = 'venue' AND (n.venue_id = p.venue_id OR n.partner_venue_id = p.venue_id))
                           OR (p.kind = 'org' AND (n.organizer_user_id = p.organizer_user_id OR n.partner_organizer_id = p.organizer_user_id))
      JOIN public._push_marketable_events() m ON m.event_id = n.id
     WHERE n.id <> r.event_id AND n.start_at < now() + interval '45 days'
     ORDER BY n.start_at
     LIMIT 1;
    v_vars := CASE WHEN nx.id IS NOT NULL
                   THEN jsonb_build_object('next_event_id', nx.id, 'next_event', nx.title, 'next_start', nx.start_at)
                   ELSE '{}'::jsonb END;

    INSERT INTO public.push_candidates
      (dedup_key, user_id, rule_key, variant, family, event_id, reason, reason_party, score, vars, not_before, expires_at)
    SELECT 'after_thanks:' || r.event_id::text || ':' || h.user_id::text, h.user_id, 'after_thanks',
           CASE WHEN nx.id IS NOT NULL THEN 'next' ELSE 'default' END, 'marketing', r.event_id, 'attendee', NULL,
           public._push_score(0, 'attendee', COALESCE(nx.start_at, now() + interval '14 days')), v_vars,
           now(), v_anchor + make_interval(hours => v_window)
      FROM public._push_event_holders(r.event_id) h
     WHERE h.came AND public._push_reachable(h.user_id)
    ON CONFLICT (dedup_key) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM public._push_mark_run('after_thanks', r.event_id, v_n);
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Point d'entrée du cron : chaque collecteur est isolé (une panne n'arrête pas
-- les autres).
CREATE OR REPLACE FUNCTION public.push_engine_collect()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_key text;
  v_n integer;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['checkout_abandoned', 'new_event', 'sales_open', 'last_tickets', 'last_call',
                               'vip_upsell', 'reminders', 'after_thanks'] LOOP
    BEGIN
      v_n := CASE v_key
        WHEN 'checkout_abandoned' THEN public._push_collect_checkout_abandoned()
        WHEN 'new_event'          THEN public._push_collect_new_event()
        WHEN 'sales_open'         THEN public._push_collect_sales_open()
        WHEN 'last_tickets'       THEN public._push_collect_last_tickets()
        WHEN 'last_call'          THEN public._push_collect_last_call()
        WHEN 'vip_upsell'         THEN public._push_collect_vip_upsell()
        WHEN 'reminders'          THEN public._push_collect_reminders()
        WHEN 'after_thanks'       THEN public._push_collect_after_thanks()
      END;
      v_out := v_out || jsonb_build_object(v_key, v_n);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[push_engine_collect] % failed: %', v_key, SQLERRM;
      v_out := v_out || jsonb_build_object(v_key, 'error: ' || left(SQLERRM, 160));
    END;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Ajout au line-up : les fans de CES DJ entrent dans l'annonce (grain personne,
-- zone), sans jamais doubler quelqu'un qui l'a déjà reçue.
CREATE OR REPLACE FUNCTION public.push_engine_enqueue_lineup(p_event_id uuid, p_dj_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_start timestamptz; v_announce timestamptz; v_nb timestamptz;
  v_min integer := public.push_rule_param('new_event', 'min_before_hours', 2);
  v_window integer := public.push_rule_param('new_event', 'window_days', 5);
BEGIN
  IF p_event_id IS NULL OR COALESCE(cardinality(p_dj_ids), 0) = 0 THEN RETURN 0; END IF;
  IF NOT public.push_rule_enabled('new_event') THEN RETURN 0; END IF;
  SELECT m.start_at INTO v_start FROM public._push_marketable_events() m WHERE m.event_id = p_event_id;
  IF v_start IS NULL OR v_start < now() + make_interval(hours => v_min + 1) THEN RETURN 0; END IF;
  SELECT ps.announce_at INTO v_announce FROM public.push_event_settings ps WHERE ps.event_id = p_event_id;
  v_nb := GREATEST(now(), COALESCE(v_announce, now()));
  RETURN public._push_collect_announcement(
    p_event_id, v_nb,
    LEAST(v_start - make_interval(hours => v_min), v_nb + make_interval(days => v_window)),
    p_dj_ids);
END;
$$;

-- ── 6. L'arbitre ─────────────────────────────────────────────────────────────
-- Une notification MARKETING au plus par personne et par passage (la plus
-- utile), une « soirée achetée » (upsell) par 24 h, les rappels sans plafond.
-- Ce qui ne passe pas est REPORTÉ (hold_reason) ; seul le budget par soirée
-- retire définitivement. Renvoie de quoi rédiger chaque notification.
CREATE OR REPLACE FUNCTION public.push_engine_claim(p_limit integer DEFAULT 1500)
RETURNS TABLE (
  candidate_id bigint, user_id uuid, rule_key text, variant text, family text, reason text,
  reason_party text, event_id uuid, vars jsonb, lang text, event_title text, start_at timestamptz,
  tz text, venue_name text, host_names text, party_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_ids bigint[];
  v_limit       integer := LEAST(GREATEST(COALESCE(p_limit, 1500), 1), 5000);
  v_quiet_start integer := public.push_engine_setting('quiet_start', 22);
  v_quiet_end   integer := public.push_engine_setting('quiet_end', 10);
  v_hour        integer := extract(hour FROM now() AT TIME ZONE 'Europe/Paris')::integer;
  v_quiet       boolean;
  v_daily       integer := public.push_engine_setting('daily_cap', 1);
  v_weekly      integer := public.push_engine_setting('weekly_cap', 3);
  v_weekly_eng  integer := public.push_engine_setting('weekly_cap_engaged', 4);
  v_weekly_fat  integer := public.push_engine_setting('weekly_cap_fatigued', 1);
  v_fat_sent    integer := public.push_engine_setting('fatigue_sent', 6);
  v_fat_days    integer := public.push_engine_setting('fatigue_days', 45);
  v_urgent      integer := public.push_engine_setting('urgent_daily_cap', 2);
  v_per_event   integer := public.push_engine_setting('per_event_max', 2);
BEGIN
  v_quiet := CASE WHEN v_quiet_start = v_quiet_end THEN false
                  WHEN v_quiet_start > v_quiet_end THEN (v_hour >= v_quiet_start OR v_hour < v_quiet_end)
                  ELSE (v_hour >= v_quiet_start AND v_hour < v_quiet_end) END;

  -- 1. Réservations mortes (worker tué entre la réservation et l'envoi).
  UPDATE public.push_candidates c
     SET status      = CASE WHEN c.attempts >= 3 THEN 'failed' ELSE 'pending' END,
         decided_at  = CASE WHEN c.attempts >= 3 THEN now() ELSE c.decided_at END,
         hold_reason = CASE WHEN c.attempts >= 3 THEN 'worker_lost' ELSE c.hold_reason END,
         claimed_at  = NULL
   WHERE c.status = 'claimed' AND c.claimed_at < now() - interval '15 minutes';

  -- 2. Fenêtre passée.
  UPDATE public.push_candidates c
     SET status = 'expired', decided_at = now(), hold_reason = COALESCE(c.hold_reason, 'window_passed')
   WHERE c.status = 'pending' AND c.expires_at <= now();

  -- 3. Retraits définitifs, évalués au moment où l'envoi est dû.
  WITH x AS (
    SELECT c.id,
      CASE
        WHEN e.id IS NULL OR NOT e.is_active OR e.cancelled_at IS NOT NULL
             OR COALESCE(e.status, 'active') <> 'active' THEN 'event_cancelled'
        WHEN NOT COALESCE(s.enabled, true) THEN 'rule_off'
        WHEN pr.id IS NULL OR COALESCE(pr.is_suspended, false) THEN 'no_profile'
        WHEN c.family IN ('marketing', 'urgent', 'event')
             AND COALESCE(pr.notification_prefs ->> 'marketing', 'true') = 'false' THEN 'opted_out'
        WHEN c.rule_key = 'new_event' AND c.reason IN ('host_follower', 'dj_follower', 'agency_follower')
             AND COALESCE(pr.notification_prefs ->> 'follow_new_event', 'true') = 'false' THEN 'opted_out'
        WHEN NOT public._push_reachable(c.user_id) THEN 'no_device'
        WHEN c.rule_key IN ('new_event', 'sales_open', 'last_tickets', 'last_call', 'checkout_abandoned')
             AND public._push_has_bought(c.user_id, c.event_id) THEN 'already_bought'
        WHEN c.rule_key IN ('sales_open', 'last_tickets', 'last_call')
             AND NOT public._push_event_sellable(c.event_id) THEN 'sold_out'
        WHEN c.rule_key = 'vip_upsell'
             AND (NOT COALESCE(e.tables_enabled, false) OR COALESCE(e.tables_sold_out, false)
                  OR COALESCE(public._event_tables_left(e.id), 0) <= 0
                  OR EXISTS (SELECT 1 FROM public.table_reservations tr
                              WHERE tr.event_id = c.event_id AND tr.status IN ('paid', 'confirmed')
                                AND (tr.user_id = c.user_id OR tr.claimed_by_user_id = c.user_id))) THEN 'no_longer_relevant'
        WHEN c.rule_key IN ('event_day_reminder', 'doors_open', 'vip_upsell')
             AND NOT public._push_has_bought(c.user_id, c.event_id) THEN 'no_longer_relevant'
        ELSE NULL END AS why
      FROM public.push_candidates c
      LEFT JOIN public.events e ON e.id = c.event_id
      LEFT JOIN public.platform_notification_settings s ON s.notification_key = c.rule_key
      LEFT JOIN public.profiles pr ON pr.id = c.user_id
     WHERE c.status = 'pending' AND c.not_before <= now()
  )
  UPDATE public.push_candidates c
     SET status = 'skipped', hold_reason = x.why, decided_at = now()
    FROM x
   WHERE x.id = c.id AND x.why IS NOT NULL;

  -- 4. Arbitrage.
  WITH due AS MATERIALIZED (
    SELECT c.id, c.user_id, c.family, c.score, c.event_id, c.rule_key, c.hold_reason
      FROM public.push_candidates c
     WHERE c.status = 'pending' AND c.not_before <= now() AND c.expires_at > now()
     ORDER BY c.score DESC, c.id
     LIMIT 30000
  ),
  users AS MATERIALIZED (SELECT DISTINCT d.user_id FROM due d),
  pressure AS MATERIALIZED (
    SELECT u.user_id,
      (SELECT count(*) FROM public.notification_log l
        WHERE l.user_id = u.user_id AND l.notification_type IN ('marketing', 'campaign')
          AND l.sent_at > now() - interval '24 hours') AS n24,
      (SELECT count(*) FROM public.notification_log l
        WHERE l.user_id = u.user_id AND l.notification_type IN ('marketing', 'campaign')
          AND l.sent_at > now() - interval '7 days') AS n7,
      (SELECT count(*) FROM public.notification_log l
        WHERE l.user_id = u.user_id AND l.notification_type IN ('marketing', 'campaign')
          AND l.sent_at > now() - make_interval(days => v_fat_days)) AS nfat,
      EXISTS (SELECT 1 FROM public.push_campaign_events pe
               WHERE pe.user_id = u.user_id AND pe.event_type = 'clicked'
                 AND pe.created_at > now() - make_interval(days => v_fat_days)) AS clicked_fat,
      (EXISTS (SELECT 1 FROM public.push_campaign_events pe
                WHERE pe.user_id = u.user_id AND pe.event_type = 'clicked'
                  AND pe.created_at > now() - interval '30 days')
       OR EXISTS (SELECT 1 FROM public.tickets t
                   WHERE t.user_id = u.user_id AND t.status IN ('paid', 'used')
                     AND t.created_at > now() - interval '60 days')) AS engaged,
      (SELECT count(*) FROM public.notification_log l
        WHERE l.user_id = u.user_id AND l.notification_type = 'event_campaign'
          AND l.sent_at > now() - interval '24 hours') AS ev24
      FROM users u
  ),
  budget AS MATERIALIZED (
    SELECT c.user_id, c.event_id, count(*) AS n
      FROM public.push_candidates c
     WHERE c.user_id IN (SELECT u.user_id FROM users u)
       AND c.status IN ('sent', 'claimed') AND c.family IN ('marketing', 'urgent')
     GROUP BY c.user_id, c.event_id
  ),
  -- Annonce programmée par le pro et pas encore due : aucune relance marketing
  -- de la même soirée ne la double (pas de « dernières places » avant l'annonce).
  scheduled_ann AS MATERIALIZED (
    SELECT DISTINCT c.user_id, c.event_id
      FROM public.push_candidates c
     WHERE c.user_id IN (SELECT u.user_id FROM users u)
       AND c.rule_key = 'new_event' AND c.status = 'pending' AND c.not_before > now()
  ),
  judged AS MATERIALIZED (
    SELECT d.id, d.user_id, d.family, d.score, d.event_id, d.hold_reason AS prev_hold,
      CASE
        WHEN d.family = 'reminder' THEN NULL
        WHEN v_quiet THEN 'quiet_hours'
        WHEN d.family = 'marketing' AND d.rule_key <> 'new_event' AND sa.user_id IS NOT NULL THEN 'awaiting_announcement'
        WHEN d.family IN ('marketing', 'urgent') AND COALESCE(b.n, 0) >= v_per_event THEN 'event_budget'
        WHEN d.family = 'urgent' AND p.n24 >= v_urgent THEN 'daily_cap'
        WHEN d.family = 'marketing' AND p.n24 >= v_daily THEN 'daily_cap'
        WHEN d.family = 'marketing' AND p.nfat >= v_fat_sent AND NOT p.clicked_fat
             AND p.n7 >= v_weekly_fat THEN 'fatigue'
        WHEN d.family = 'marketing'
             AND p.n7 >= CASE WHEN p.engaged THEN v_weekly_eng ELSE v_weekly END THEN 'weekly_cap'
        WHEN d.family = 'event' AND p.ev24 >= 1 THEN 'daily_cap'
        ELSE NULL END AS hold
      FROM due d
      JOIN pressure p ON p.user_id = d.user_id
      LEFT JOIN budget b ON b.user_id = d.user_id AND b.event_id IS NOT DISTINCT FROM d.event_id
      LEFT JOIN scheduled_ann sa ON sa.user_id = d.user_id AND sa.event_id = d.event_id
  ),
  ranked AS MATERIALIZED (
    SELECT j.id, j.score, j.prev_hold,
           row_number() OVER (
             PARTITION BY j.user_id,
               CASE WHEN j.family IN ('marketing', 'urgent') THEN 'm'
                    WHEN j.family = 'event' THEN 'e'
                    ELSE 'r:' || COALESCE(j.event_id::text, '-') END
             ORDER BY j.score DESC, j.id) AS rn
      FROM judged j WHERE j.hold IS NULL
  ),
  chosen AS MATERIALIZED (
    SELECT r.id FROM ranked r WHERE r.rn = 1 ORDER BY r.score DESC, r.id LIMIT v_limit
  ),
  held AS (
    UPDATE public.push_candidates c
       SET hold_reason = j.hold,
           status      = CASE WHEN j.hold = 'event_budget' THEN 'skipped' ELSE c.status END,
           decided_at  = CASE WHEN j.hold = 'event_budget' THEN now() ELSE c.decided_at END
      FROM judged j
     WHERE c.id = j.id AND j.hold IS NOT NULL
       AND (j.hold = 'event_budget' OR j.prev_hold IS DISTINCT FROM j.hold)
    RETURNING c.id
  ),
  lower_prio AS (
    UPDATE public.push_candidates c
       SET hold_reason = 'lower_priority'
      FROM ranked r
     WHERE c.id = r.id AND r.rn > 1 AND r.prev_hold IS DISTINCT FROM 'lower_priority'
    RETURNING c.id
  ),
  claimed AS (
    UPDATE public.push_candidates c
       SET status = 'claimed', claimed_at = now(), attempts = c.attempts + 1
      FROM chosen ch
     WHERE c.id = ch.id
    RETURNING c.id
  )
  SELECT array_agg(claimed.id) INTO v_ids FROM claimed;

  IF v_ids IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH cc AS MATERIALIZED (
    SELECT c.* FROM public.push_candidates c WHERE c.id = ANY (v_ids)
  ),
  ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at,
           COALESCE(NULLIF(e.timezone, ''), NULLIF(v.timezone, ''), 'Europe/Paris') AS tz,
           COALESCE(v.name, pv.name, e.location_name) AS venue_name,
           (SELECT string_agg(p.display_name, ' × ' ORDER BY p.ord, p.party_key)
              FROM public.event_parties(e.id) p) AS host_names
      FROM public.events e
      LEFT JOIN public.venues v ON v.id = e.venue_id
      LEFT JOIN public.venues pv ON pv.id = e.partner_venue_id
     WHERE e.id IN (SELECT DISTINCT cc.event_id FROM cc WHERE cc.event_id IS NOT NULL)
  )
  SELECT cc.id, cc.user_id, cc.rule_key, cc.variant, cc.family, cc.reason, cc.reason_party, cc.event_id, cc.vars,
         CASE WHEN pr.preferred_language IN ('en', 'es') THEN pr.preferred_language ELSE 'fr' END,
         ev.title, ev.start_at, ev.tz, ev.venue_name, ev.host_names,
         CASE split_part(COALESCE(cc.reason_party, ''), ':', 1)
           WHEN 'venue'  THEN (SELECT v2.name FROM public.venues v2 WHERE v2.id = substr(cc.reason_party, 7))
           WHEN 'org'    THEN (SELECT NULLIF(btrim(op.display_name), '') FROM public.organizer_profiles op
                                WHERE op.user_id::text = substr(cc.reason_party, 5))
           WHEN 'agency' THEN cc.vars ->> 'agency'
           WHEN 'dj'     THEN cc.vars ->> 'dj'
           ELSE NULL END
    FROM cc
    LEFT JOIN ev ON ev.id = cc.event_id
    LEFT JOIN public.profiles pr ON pr.id = cc.user_id;
END;
$$;

-- Une campagne AUTO par (soirée, règle), qui cumule les envois de plusieurs
-- passages (une annonce reportée finit dans la même ligne d'historique).
CREATE OR REPLACE FUNCTION public.push_engine_campaign(p_rule text, p_event_id uuid, p_title text, p_body text, p_url text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid; v_venue text; v_org uuid;
BEGIN
  SELECT c.id INTO v_id FROM public.push_campaigns c
   WHERE c.event_id = p_event_id AND c.template_key = p_rule AND c.source = 'auto'
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT e.venue_id, CASE WHEN e.venue_id IS NULL THEN e.organizer_user_id END
    INTO v_venue, v_org FROM public.events e WHERE e.id = p_event_id;

  INSERT INTO public.push_campaigns
    (title, body, url, segment, venue_id, organizer_user_id, event_id, template_key, source, status,
     audience, targeted_count, sent_count, failed_count)
  VALUES (left(COALESCE(p_title, ''), 200), left(COALESCE(p_body, ''), 400), COALESCE(p_url, '/'), p_rule,
          v_venue, v_org, p_event_id, p_rule, 'auto', 'sending',
          jsonb_build_object('engine', true, 'scope', p_rule), 0, 0, 0)
  ON CONFLICT (event_id, template_key) WHERE source = 'auto' AND event_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT c.id INTO v_id FROM public.push_campaigns c
     WHERE c.event_id = p_event_id AND c.template_key = p_rule AND c.source = 'auto'
     LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

-- Issue d'un lot : file, journal anti-spam, suivi de campagne, compteurs.
CREATE OR REPLACE FUNCTION public.push_engine_record(
  p_campaign_id uuid, p_sent bigint[], p_failed bigint[], p_nodevice bigint[], p_log_type text, p_title text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_sent integer := 0; v_failed integer := 0; v_none integer := 0;
BEGIN
  WITH s AS (
    UPDATE public.push_candidates c
       SET status = 'sent', decided_at = now(), campaign_id = p_campaign_id, hold_reason = NULL
     WHERE c.id = ANY (COALESCE(p_sent, ARRAY[]::bigint[])) AND c.status = 'claimed'
    RETURNING c.user_id, c.event_id, c.rule_key
  ),
  -- « Dernières places » ou « c'est ce soir » reçu : l'annonce encore en
  -- attente pour la même personne et la même soirée n'a plus lieu d'être.
  sup AS (
    UPDATE public.push_candidates c
       SET status = 'skipped', hold_reason = 'superseded', decided_at = now()
      FROM s
     WHERE s.rule_key IN ('sales_open', 'last_tickets', 'last_call')
       AND c.rule_key = 'new_event' AND c.status = 'pending'
       AND c.user_id = s.user_id AND c.event_id = s.event_id
    RETURNING c.id
  ),
  ev AS (
    INSERT INTO public.push_campaign_events (campaign_id, user_id, event_type, platform)
    SELECT p_campaign_id, s.user_id, 'sent', 'ios' FROM s WHERE p_campaign_id IS NOT NULL
    ON CONFLICT (campaign_id, user_id, event_type) DO NOTHING
    RETURNING 1
  ),
  lg AS (
    INSERT INTO public.notification_log (user_id, notification_type, title)
    SELECT s.user_id, COALESCE(p_log_type, 'marketing'), left(COALESCE(p_title, ''), 200) FROM s
    RETURNING 1
  )
  SELECT count(*) INTO v_sent FROM s;

  WITH f AS (
    UPDATE public.push_candidates c
       SET status = 'failed', decided_at = now(), campaign_id = p_campaign_id, hold_reason = 'apns_failed'
     WHERE c.id = ANY (COALESCE(p_failed, ARRAY[]::bigint[])) AND c.status = 'claimed'
    RETURNING c.user_id
  ),
  ev AS (
    INSERT INTO public.push_campaign_events (campaign_id, user_id, event_type, platform)
    SELECT p_campaign_id, f.user_id, 'failed', 'ios' FROM f WHERE p_campaign_id IS NOT NULL
    ON CONFLICT (campaign_id, user_id, event_type) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_failed FROM f;

  UPDATE public.push_candidates c
     SET status = 'skipped', decided_at = now(), hold_reason = 'no_device'
   WHERE c.id = ANY (COALESCE(p_nodevice, ARRAY[]::bigint[])) AND c.status = 'claimed';
  GET DIAGNOSTICS v_none = ROW_COUNT;

  IF p_campaign_id IS NOT NULL AND (v_sent + v_failed) > 0 THEN
    UPDATE public.push_campaigns pc
       SET sent_count     = COALESCE(pc.sent_count, 0) + v_sent,
           failed_count   = COALESCE(pc.failed_count, 0) + v_failed,
           targeted_count = COALESCE(pc.targeted_count, 0) + v_sent + v_failed,
           status         = 'sent'
     WHERE pc.id = p_campaign_id;
  END IF;
  RETURN jsonb_build_object('sent', v_sent, 'failed', v_failed, 'no_device', v_none);
END;
$$;

-- Ménage : la file décidée se purge à 90 jours (les compteurs vivent dans
-- push_campaigns / push_campaign_events).
CREATE OR REPLACE FUNCTION public.push_engine_housekeeping()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.push_candidates c
   WHERE c.status IN ('sent', 'failed', 'skipped', 'expired')
     AND COALESCE(c.decided_at, c.created_at) < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('push-engine-housekeeping')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-engine-housekeeping');
  PERFORM cron.schedule('push-engine-housekeeping', '37 4 * * *', 'SELECT public.push_engine_housekeeping();');
EXCEPTION WHEN undefined_table OR invalid_schema_name THEN
  RAISE NOTICE 'pg_cron absent : purge de la file à planifier à la main';
END $$;

-- ── 7. Heure d'annonce choisie par le pro ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_event_announce_at(p_event_id uuid, p_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_start timestamptz; v_nb timestamptz;
  v_min integer := public.push_rule_param('new_event', 'min_before_hours', 2);
  v_window integer := public.push_rule_param('new_event', 'window_days', 5);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  -- Seule une partie PRINCIPALE (club, organisateur, partenaire du collab) de
  -- niveau gestion règle l'annonce : un co-hôte ne décide pas pour la soirée.
  IF NOT (public.is_super_admin() OR EXISTS (
            SELECT 1 FROM public.event_parties(p_event_id) p
             WHERE p.role IN ('lead', 'partner') AND public.coorg_party_level(v_uid, p.party_key) >= 2)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT e.start_at INTO v_start FROM public.events e WHERE e.id = p_event_id AND e.cancelled_at IS NULL;
  IF v_start IS NULL OR v_start <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_past');
  END IF;
  IF EXISTS (SELECT 1 FROM public.push_candidates c
              WHERE c.event_id = p_event_id AND c.rule_key = 'new_event' AND c.status IN ('sent', 'claimed'))
     OR public._push_legacy_sent(p_event_id, ARRAY['new_event']) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_announced');
  END IF;
  IF p_at IS NOT NULL AND (p_at < now() - interval '5 minutes'
                           OR p_at > v_start - make_interval(hours => v_min + 1)
                           OR p_at > now() + interval '30 days') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_time');
  END IF;

  INSERT INTO public.push_event_settings (event_id, announce_at, updated_by, updated_at)
  VALUES (p_event_id, p_at, v_uid, now())
  ON CONFLICT (event_id) DO UPDATE
     SET announce_at = EXCLUDED.announce_at, updated_by = EXCLUDED.updated_by, updated_at = now();

  v_nb := GREATEST(now(), COALESCE(p_at, now()));
  UPDATE public.push_candidates c
     SET not_before = v_nb,
         expires_at = LEAST(v_start - make_interval(hours => v_min), v_nb + make_interval(days => v_window)),
         hold_reason = NULL
   WHERE c.event_id = p_event_id AND c.rule_key = 'new_event' AND c.status = 'pending';

  RETURN jsonb_build_object('ok', true, 'announce_at', p_at);
END;
$$;

-- ── 8. Crédits de campagnes manuelles ────────────────────────────────────────
-- 1 crédit = 1 campagne marketing (abonnés, clients, segment). Offerts chaque
-- mois (heure de Paris), bonus attribués par le super admin (ne périment pas).
CREATE TABLE IF NOT EXISTS public.push_credit_accounts (
  scope_key         text PRIMARY KEY CHECK (scope_key ~ '^(venue|org|agency):.+$'),
  monthly_allowance integer CHECK (monthly_allowance IS NULL OR monthly_allowance BETWEEN 0 AND 100),
  bonus_balance     integer NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);
ALTER TABLE public.push_credit_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.push_credit_ledger (
  id          bigserial PRIMARY KEY,
  scope_key   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('use_monthly', 'use_bonus', 'refund_monthly', 'refund_bonus', 'grant', 'allowance')),
  delta       integer NOT NULL,
  campaign_id uuid,
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_credit_ledger_scope ON public.push_credit_ledger (scope_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_credit_ledger_campaign ON public.push_credit_ledger (campaign_id) WHERE campaign_id IS NOT NULL;
ALTER TABLE public.push_credit_ledger ENABLE ROW LEVEL SECURITY;
-- Aucune policy sur les deux tables : lecture et écriture par RPC seulement.

CREATE OR REPLACE FUNCTION public._push_credit_state(p_scope text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind text := split_part(p_scope, ':', 1);
  v_default integer;
  v_override integer; v_bonus integer := 0; v_used integer := 0;
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
  v_allow integer;
BEGIN
  v_default := CASE v_kind
    WHEN 'venue'  THEN public.push_engine_setting('credits_venue', 4)
    WHEN 'org'    THEN public.push_engine_setting('credits_org', 4)
    WHEN 'agency' THEN public.push_engine_setting('credits_agency', 2)
    ELSE 0 END;
  SELECT a.monthly_allowance, a.bonus_balance INTO v_override, v_bonus
    FROM public.push_credit_accounts a WHERE a.scope_key = p_scope;
  v_allow := COALESCE(v_override, v_default);
  SELECT COALESCE(sum(CASE l.kind WHEN 'use_monthly' THEN 1 WHEN 'refund_monthly' THEN -1 ELSE 0 END), 0)
    INTO v_used
    FROM public.push_credit_ledger l
   WHERE l.scope_key = p_scope AND l.created_at >= v_month_start;
  v_used := GREATEST(v_used, 0);
  RETURN jsonb_build_object(
    'allowance', v_allow,
    'defaultAllowance', v_default,
    'override', v_override IS NOT NULL,
    'used', v_used,
    'bonus', COALESCE(v_bonus, 0),
    'remaining', GREATEST(0, v_allow - v_used) + COALESCE(v_bonus, 0),
    'resetsAt', (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') + interval '1 month') AT TIME ZONE 'Europe/Paris',
    'eventInfoPerEvent', public.push_engine_setting('event_info_per_event', 2),
    'marketingPer24h', public.push_engine_setting('manual_per_24h', 1)
  );
END;
$$;

-- Débit d'un crédit (service) : le mois d'abord, puis le bonus. NULL = plus rien.
CREATE OR REPLACE FUNCTION public.consume_push_credit(p_scope text, p_campaign_id uuid, p_actor uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_state jsonb; v_bonus integer;
BEGIN
  IF p_scope IS NULL OR p_scope !~ '^(venue|org|agency):.+$' THEN RETURN NULL; END IF;
  INSERT INTO public.push_credit_accounts (scope_key) VALUES (p_scope) ON CONFLICT (scope_key) DO NOTHING;
  SELECT a.bonus_balance INTO v_bonus FROM public.push_credit_accounts a WHERE a.scope_key = p_scope FOR UPDATE;
  v_state := public._push_credit_state(p_scope);
  IF (v_state ->> 'used')::integer < (v_state ->> 'allowance')::integer THEN
    INSERT INTO public.push_credit_ledger (scope_key, kind, delta, campaign_id, created_by)
    VALUES (p_scope, 'use_monthly', 1, p_campaign_id, p_actor);
    RETURN 'monthly';
  ELSIF COALESCE(v_bonus, 0) > 0 THEN
    UPDATE public.push_credit_accounts SET bonus_balance = bonus_balance - 1, updated_at = now() WHERE scope_key = p_scope;
    INSERT INTO public.push_credit_ledger (scope_key, kind, delta, campaign_id, created_by)
    VALUES (p_scope, 'use_bonus', -1, p_campaign_id, p_actor);
    RETURN 'bonus';
  END IF;
  RETURN NULL;
END;
$$;

-- Remboursement (campagne programmée annulée, partie à zéro). Un crédit du
-- mois courant revient au mois ; sinon il revient en bonus.
CREATE OR REPLACE FUNCTION public.refund_push_credit(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  l record;
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris';
BEGIN
  IF p_campaign_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO l FROM public.push_credit_ledger
   WHERE campaign_id = p_campaign_id AND kind IN ('use_monthly', 'use_bonus')
   ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.push_credit_ledger
              WHERE campaign_id = p_campaign_id AND kind IN ('refund_monthly', 'refund_bonus')) THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.push_credit_accounts WHERE scope_key = l.scope_key FOR UPDATE;
  IF l.kind = 'use_monthly' AND l.created_at >= v_month_start THEN
    INSERT INTO public.push_credit_ledger (scope_key, kind, delta, campaign_id, note)
    VALUES (l.scope_key, 'refund_monthly', -1, p_campaign_id, 'refund');
  ELSE
    UPDATE public.push_credit_accounts SET bonus_balance = bonus_balance + 1, updated_at = now()
     WHERE scope_key = l.scope_key;
    INSERT INTO public.push_credit_ledger (scope_key, kind, delta, campaign_id, note)
    VALUES (l.scope_key, 'refund_bonus', 1, p_campaign_id, 'refund');
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.push_credit_state_for(p_scope text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public._push_credit_state(p_scope); $$;

-- Porte de lecture d'une portée pour un pro (mêmes droits que l'historique push).
CREATE OR REPLACE FUNCTION public._push_scope_for_caller(p_venue_id text, p_organizer_user_id uuid, p_agency_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  IF p_organizer_user_id IS NOT NULL THEN
    IF v_uid = p_organizer_user_id OR public.is_super_admin()
       OR public.is_org_team_member(v_uid, p_organizer_user_id, 'admin') THEN
      RETURN 'org:' || p_organizer_user_id::text;
    END IF;
  ELSIF p_venue_id IS NOT NULL THEN
    IF public.is_super_admin() OR public.is_venue_owner(v_uid, p_venue_id)
       OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                   WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                     AND (COALESCE(mp.can_manage_crm, false) OR COALESCE(mp.can_view_analytics, false))) THEN
      RETURN 'venue:' || p_venue_id;
    END IF;
  ELSIF p_agency_id IS NOT NULL THEN
    IF public.is_super_admin() OR public.is_agency_owner(v_uid, p_agency_id) THEN
      RETURN 'agency:' || p_agency_id::text;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_push_credits(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_agency_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scope text := public._push_scope_for_caller(p_venue_id, p_organizer_user_id, p_agency_id);
BEGIN
  IF v_scope IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  RETURN jsonb_build_object('ok', true, 'scope', v_scope) || public._push_credit_state(v_scope)
    || jsonb_build_object('requestedToday', EXISTS (
         SELECT 1 FROM public.admin_notifications n
          WHERE n.dedup_key = 'push_credit_request:' || v_scope || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')));
END;
$$;

-- « Demander plus de crédits » : une alerte super admin par portée et par jour.
CREATE OR REPLACE FUNCTION public.request_push_credits(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_agency_id uuid DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scope text := public._push_scope_for_caller(p_venue_id, p_organizer_user_id, p_agency_id);
  v_name text;
BEGIN
  IF v_scope IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_name := CASE split_part(v_scope, ':', 1)
    WHEN 'venue'  THEN (SELECT v.name FROM public.venues v WHERE v.id = p_venue_id)
    WHEN 'org'    THEN (SELECT op.display_name FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id)
    WHEN 'agency' THEN (SELECT a.name FROM public.agencies a WHERE a.id = p_agency_id)
  END;
  PERFORM public.emit_admin_notification(
    'admin_push_credit_request',
    'Crédits push demandés — ' || COALESCE(v_name, v_scope),
    COALESCE(NULLIF(btrim(p_note), ''), COALESCE(v_name, v_scope) || ' demande des crédits de campagnes push.'),
    'normal', 'push_credits', v_scope,
    jsonb_build_object('scope', v_scope, 'name', v_name, 'state', public._push_credit_state(v_scope)),
    'push_credit_request:' || v_scope || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD'),
    NULL);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Annuler une campagne programmée rend son crédit (corps live + remboursement).
CREATE OR REPLACE FUNCTION public.cancel_scheduled_push_campaign(p_campaign_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_venue_id text;
  v_org_id   uuid;
begin
  select pc.venue_id, pc.organizer_user_id into v_venue_id, v_org_id
  from push_campaigns pc
  where pc.id = p_campaign_id and pc.status = 'scheduled';

  if v_venue_id is null and v_org_id is null then
    return false; -- introuvable, déjà partie, ou campagne admin / agence
  end if;

  if v_venue_id is not null then
    if not (is_super_admin()
            or is_venue_owner(auth.uid(), v_venue_id)
            or exists (
              select 1 from manager_permissions mp
              where mp.user_id = auth.uid() and mp.venue_id = v_venue_id and mp.can_manage_crm = true
            )) then
      raise exception 'Not authorized for venue %', v_venue_id using errcode = '42501';
    end if;
  else
    if not (is_super_admin()
            or auth.uid() = v_org_id
            or is_org_team_member(auth.uid(), v_org_id, 'admin')) then
      raise exception 'Not authorized for organizer %', v_org_id using errcode = '42501';
    end if;
  end if;

  perform public.refund_push_credit(p_campaign_id);

  delete from push_campaigns pc
  where pc.id = p_campaign_id and pc.status = 'scheduled';

  return found;
end;
$$;

-- ── 9. Politique partagée : les push manuels et les crons plateforme lisent
--       les MÊMES réglages que le moteur ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_is_quiet_hour(p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH q AS (
    SELECT public.push_engine_setting('quiet_start', 22) AS s,
           public.push_engine_setting('quiet_end', 10) AS e,
           extract(hour FROM COALESCE(p_at, now()) AT TIME ZONE 'Europe/Paris')::integer AS h
  )
  SELECT CASE WHEN q.s = q.e THEN false
              WHEN q.s > q.e THEN (q.h >= q.s OR q.h < q.e)
              ELSE (q.h >= q.s AND q.h < q.e) END
    FROM q;
$$;

create or replace function public.filter_manual_push_recipients(
  p_user_ids uuid[],
  p_kind text,
  p_at timestamptz default now()
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select distinct u.id from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u(id)
  ),
  cfg as (
    select public.push_is_quiet_hour(coalesce(p_at, now())) as quiet,
           public.push_engine_setting('daily_cap', 1) as daily,
           public.push_engine_setting('weekly_cap', 3) as weekly
  )
  select i.id
  from ids i
  join public.profiles p on p.id = i.id
  cross join cfg
  where coalesce(p.notification_prefs ->> 'marketing', 'true') <> 'false'
    and (
      p_kind = 'event'
      or (
        p_kind = 'marketing'
        and not cfg.quiet
        and (
          select count(*) from public.notification_log l
          where l.user_id = i.id
            and l.notification_type in ('marketing', 'campaign')
            and l.sent_at > now() - interval '24 hours'
        ) < cfg.daily
        and (
          select count(*) from public.notification_log l
          where l.user_id = i.id
            and l.notification_type in ('marketing', 'campaign')
            and l.sent_at > now() - interval '7 days'
        ) < cfg.weekly
      )
    );
$$;
revoke all on function public.filter_manual_push_recipients(uuid[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.filter_manual_push_recipients(uuid[], text, timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.client_push_policy(p_user_id uuid, p_key text)
RETURNS TABLE (allowed boolean, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefs    jsonb;
  v_opt_out  boolean;
  v_day      int;
  v_week     int;
  v_last_key timestamptz;
  v_cooldown interval;
BEGIN
  SELECT COALESCE(p.notification_prefs, '{}'::jsonb), COALESCE(p.discovery_opt_out, false)
    INTO v_prefs, v_opt_out
    FROM public.profiles p WHERE p.id = p_user_id;
  IF v_prefs IS NULL THEN
    RETURN QUERY SELECT false, 'no_profile'; RETURN;
  END IF;

  IF p_key IN ('taste_discovery', 'inactivity_reminder', 'discovery_week', 'discovery_weekend', 'weekly_digest') THEN
    IF v_opt_out OR COALESCE(v_prefs->>'discovery', 'true') = 'false' THEN
      RETURN QUERY SELECT false, 'opted_out'; RETURN;
    END IF;
  ELSIF p_key IN ('new_event', 'agency_new_event') THEN
    IF COALESCE(v_prefs->>'follow_new_event', 'true') = 'false' THEN
      RETURN QUERY SELECT false, 'opted_out'; RETURN;
    END IF;
  ELSIF p_key IN ('cart_abandonment', 'cart_abandonment_drinks', 'win_back', 'birthday') THEN
    IF COALESCE(v_prefs->>'marketing', 'true') = 'false' THEN
      RETURN QUERY SELECT false, 'opted_out'; RETURN;
    END IF;
  END IF;

  -- Heures calmes : les réglages du moteur (22 h → 10 h Paris par défaut).
  IF public.push_is_quiet_hour(now()) THEN
    RETURN QUERY SELECT false, 'quiet_hours'; RETURN;
  END IF;

  SELECT count(*) INTO v_day FROM public.notification_log l
   WHERE l.user_id = p_user_id AND l.notification_type IN ('marketing', 'campaign')
     AND l.sent_at > now() - interval '24 hours';
  IF v_day >= public.push_engine_setting('daily_cap', 1) THEN
    RETURN QUERY SELECT false, 'daily_cap'; RETURN;
  END IF;

  SELECT count(*) INTO v_week FROM public.notification_log l
   WHERE l.user_id = p_user_id AND l.notification_type IN ('marketing', 'campaign')
     AND l.sent_at > now() - interval '7 days';
  IF v_week >= public.push_engine_setting('weekly_cap', 3) THEN
    RETURN QUERY SELECT false, 'weekly_cap'; RETURN;
  END IF;

  v_cooldown := CASE p_key
    WHEN 'new_event' THEN interval '20 hours'
    WHEN 'agency_new_event' THEN interval '20 hours'
    WHEN 'taste_discovery' THEN interval '4 days'
    WHEN 'inactivity_reminder' THEN interval '21 days'
    WHEN 'cart_abandonment' THEN interval '3 days'
    WHEN 'cart_abandonment_drinks' THEN interval '3 days'
    ELSE interval '2 days' END;
  SELECT max(x.at) INTO v_last_key FROM (
    SELECT e.created_at AS at FROM public.auto_push_events e
     WHERE e.user_id = p_user_id AND e.notification_key = p_key AND e.event_type = 'sent'
    UNION ALL
    SELECT ce.created_at FROM public.push_campaign_events ce
      JOIN public.push_campaigns c ON c.id = ce.campaign_id
     WHERE ce.user_id = p_user_id AND ce.event_type = 'sent'
       AND (c.template_key = p_key OR c.template_key LIKE p_key || ':%')
  ) x;
  IF v_last_key IS NOT NULL AND v_last_key > now() - v_cooldown THEN
    RETURN QUERY SELECT false, 'key_cooldown'; RETURN;
  END IF;

  RETURN QUERY SELECT true, 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.client_push_policy(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_push_policy(uuid, text) TO service_role;

-- ── 10. Ce que voit le pro ───────────────────────────────────────────────────
-- « Protégées » = ce que la POLITIQUE a retenu (plafonds, heures calmes,
-- fatigue, budget par soirée, priorité) jusqu'à la fin de la fenêtre. Pas un
-- désabonnement (le choix du client), pas un « déjà acheté » (une bonne
-- nouvelle, comptée à part), pas une annonce remplacée par « dernières places ».
-- Toutes les notifications automatiques des soirées de la portée (menées,
-- partenaires, co-hébergées), par soirée et par règle. Attribution « dernier
-- tap » : une vente revient à la dernière notification touchée dans les 72 h
-- avant l'achat (jamais comptée deux fois) ; « après réception » = acheté
-- dans les 72 h qui suivent l'envoi, tap ou pas. CA club (fees.ts),
-- remboursement déduit, seulement pour qui voit l'argent.
CREATE OR REPLACE FUNCTION public.get_push_center(
  p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL, p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid       uuid := auth.uid();
  v_money     boolean := false;
  v_party     text;
  v_event_ids uuid[];
  v_days      integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 120);
  v_from      timestamptz;
  v_result    jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  v_from := now() - make_interval(days => v_days);

  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT (v_uid = p_organizer_user_id OR public.is_super_admin()
            OR public.is_org_team_member(v_uid, p_organizer_user_id, 'admin')) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := v_uid = p_organizer_user_id OR public.is_super_admin()
      OR public.org_member_has_permission(v_uid, p_organizer_user_id, 'view_finance');
    v_party := 'org:' || p_organizer_user_id::text;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE e.organizer_user_id = p_organizer_user_id OR e.partner_organizer_id = p_organizer_user_id
        OR e.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id));
  ELSIF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR public.is_venue_owner(v_uid, p_venue_id)
            OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                        WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                          AND (COALESCE(mp.can_manage_crm, false) OR COALESCE(mp.can_view_analytics, false)))) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
    v_money := public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.owner_id = v_uid)
      OR EXISTS (SELECT 1 FROM public.manager_permissions mp
                  WHERE mp.user_id = v_uid AND mp.venue_id = p_venue_id
                    AND (COALESCE(mp.can_view_analytics, false) OR COALESCE(mp.can_view_finance, false)));
    v_party := 'venue:' || p_venue_id;
    SELECT COALESCE(array_agg(e.id), '{}') INTO v_event_ids
      FROM public.events e
     WHERE e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
        OR e.id IN (SELECT public.cohost_event_ids_venue(p_venue_id));
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  WITH
  ev AS MATERIALIZED (
    SELECT e.id, e.title, e.start_at, COALESCE(e.poster_url, e.image_url) AS image, e.published_at,
           COALESCE(NULLIF(e.visibility, ''), 'public') AS visibility
      FROM public.events e
     WHERE e.id = ANY (v_event_ids) AND e.cancelled_at IS NULL
       AND e.start_at >= v_from AND e.start_at < now() + interval '180 days'
  ),
  camp AS MATERIALIZED (
    SELECT pc.id, pc.event_id, pc.created_at, COALESCE(pc.sent_count, 0) AS sent_count,
           CASE pc.template_key
             WHEN 'almost_sold_out' THEN 'last_tickets' WHEN 'thank_you' THEN 'after_thanks'
             WHEN 'reminder_day_of' THEN 'event_day_reminder' WHEN 'drinks_preorder' THEN 'event_day_reminder'
             WHEN 'event_live' THEN 'doors_open' ELSE pc.template_key END AS rule
      FROM public.push_campaigns pc
     WHERE pc.source = 'auto' AND pc.event_id IN (SELECT ev.id FROM ev)
  ),
  recv AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'sent' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  taps AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'clicked' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  sales AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.id, t.user_id, t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
           GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - LEAST(GREATEST(COALESCE(t.refund_amount, 0), 0),
                     GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t
     WHERE t.event_id IN (SELECT ev.id FROM ev) AND t.status IN ('paid', 'used') AND t.user_id IS NOT NULL
    UNION ALL
    SELECT 'tables', r.id, r.user_id, r.event_id, COALESCE(r.paid_at, r.created_at),
           GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0),
                     GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT ev.id FROM ev) AND r.status IN ('paid', 'confirmed') AND r.user_id IS NOT NULL
    UNION ALL
    SELECT 'guestlist', g.id, g.user_id, gl.event_id, g.created_at, 0
      FROM public.guest_list_entries g
      JOIN public.guest_lists gl ON gl.id = g.guest_list_id
     WHERE gl.event_id IN (SELECT ev.id FROM ev) AND g.status <> 'cancelled' AND g.user_id IS NOT NULL
  ),
  touch AS MATERIALIZED (
    SELECT DISTINCT ON (s.pillar, s.id) s.pillar, s.id AS sale_id, s.user_id, s.event_id, s.amount,
           c.rule, tp.campaign_id
      FROM sales s
      JOIN taps tp ON tp.user_id = s.user_id
      JOIN camp c ON c.id = tp.campaign_id AND c.event_id = s.event_id
     WHERE s.at >= tp.at AND s.at < tp.at + interval '72 hours'
     ORDER BY s.pillar, s.id, tp.at DESC
  ),
  infl AS MATERIALIZED (
    SELECT DISTINCT rv.campaign_id, rv.user_id
      FROM recv rv
      JOIN camp c ON c.id = rv.campaign_id
      JOIN sales s ON s.user_id = rv.user_id AND s.event_id = c.event_id AND s.pillar <> 'guestlist'
     WHERE s.at >= rv.at AND s.at < rv.at + interval '72 hours'
  ),
  cand AS MATERIALIZED (
    SELECT c.rule_key, c.event_id, c.status, COALESCE(c.hold_reason, '') AS hold, c.reason_party,
           c.user_id, c.campaign_id, c.not_before
      FROM public.push_candidates c
     WHERE c.event_id IN (SELECT ev.id FROM ev)
  ),
  per_camp AS MATERIALIZED (
    SELECT c.id, c.event_id, c.rule, c.created_at, c.sent_count,
           (SELECT count(*) FROM taps t WHERE t.campaign_id = c.id) AS taps,
           (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.campaign_id = c.id AND t.pillar <> 'guestlist') AS buyers,
           (SELECT count(*) FROM touch t WHERE t.campaign_id = c.id AND t.pillar = 'guestlist') AS entries,
           (SELECT COALESCE(sum(t.amount), 0) FROM touch t WHERE t.campaign_id = c.id) AS revenue,
           (SELECT count(*) FROM infl i WHERE i.campaign_id = c.id) AS influenced
      FROM camp c
  ),
  steps AS MATERIALIZED (
    SELECT k.event_id, k.rule,
           COALESCE(sum(pc.sent_count), 0) AS sent,
           COALESCE(sum(pc.taps), 0) AS taps,
           COALESCE(sum(pc.buyers), 0) AS buyers,
           COALESCE(sum(pc.entries), 0) AS entries,
           COALESCE(sum(pc.revenue), 0) AS revenue,
           COALESCE(sum(pc.influenced), 0) AS influenced,
           max(pc.created_at) AS last_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('pending', 'claimed')) AS queued,
           (SELECT min(x.not_before) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status = 'pending') AS next_at,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.status IN ('skipped', 'expired')
               AND x.hold IN ('daily_cap', 'weekly_cap', 'fatigue', 'quiet_hours', 'event_budget',
                                  'lower_priority', 'awaiting_announcement', 'window_passed')) AS held,
           (SELECT count(*) FROM cand x WHERE x.event_id = k.event_id AND x.rule_key = k.rule
               AND x.hold = 'already_bought') AS bought_before
      FROM (SELECT DISTINCT camp.event_id, camp.rule FROM camp
            UNION SELECT DISTINCT cand.event_id, cand.rule_key FROM cand) k
      LEFT JOIN per_camp pc ON pc.event_id = k.event_id AND pc.rule = k.rule
     GROUP BY k.event_id, k.rule
  ),
  mine AS MATERIALIZED (
    SELECT x.user_id, x.campaign_id FROM cand x WHERE x.status = 'sent' AND x.reason_party = v_party
  ),
  disc AS (
    SELECT count(*) AS selections, count(DISTINCT ds.user_id) AS people,
           count(*) FILTER (WHERE ds.opened_at IS NOT NULL) AS opened
      FROM public.discovery_selections ds
     WHERE ds.created_at >= v_from AND ds.event_ids && v_event_ids
  ),
  evj AS (
    SELECT e.*, ps.announce_at,
           (SELECT count(*) FROM public.event_parties(e.id)) AS parties,
           EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0) AS announced,
           (e.start_at > now() + interval '3 hours'
            AND e.visibility = 'public'
            AND NOT EXISTS (SELECT 1 FROM steps st WHERE st.event_id = e.id AND st.rule = 'new_event' AND st.sent > 0)
            AND (public.is_super_admin() OR EXISTS (
                  SELECT 1 FROM public.event_parties(e.id) p
                   WHERE p.role IN ('lead', 'partner') AND public.coorg_party_level(v_uid, p.party_key) >= 2))) AS can_schedule
      FROM ev e
      LEFT JOIN public.push_event_settings ps ON ps.event_id = e.id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'money', v_money,
    'days', v_days,
    'party', v_party,
    'summary', jsonb_build_object(
      'sent',       (SELECT COALESCE(sum(pc.sent_count), 0) FROM per_camp pc),
      'people',     (SELECT count(DISTINCT rv.user_id) FROM recv rv),
      'taps',       (SELECT count(*) FROM taps),
      'buyers',     (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.pillar <> 'guestlist'),
      'entries',    (SELECT count(*) FROM touch t WHERE t.pillar = 'guestlist'),
      'influenced', (SELECT count(DISTINCT i.user_id) FROM infl i),
      'revenue',    CASE WHEN v_money THEN round((SELECT COALESCE(sum(t.amount), 0) FROM touch t)::numeric, 2) END,
      'held',       (SELECT COALESCE(sum(st.held), 0) FROM steps st),
      'boughtBefore', (SELECT COALESCE(sum(st.bought_before), 0) FROM steps st),
      'queued',     (SELECT COALESCE(sum(st.queued), 0) FROM steps st)
    ),
    'viaMe', jsonb_build_object(
      'multiParty', EXISTS (SELECT 1 FROM evj WHERE evj.parties > 1),
      'sent',  (SELECT count(*) FROM mine),
      'taps',  (SELECT count(*) FROM mine m JOIN taps t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id),
      'buyers', (SELECT count(DISTINCT m.user_id) FROM mine m
                   JOIN touch t ON t.campaign_id = m.campaign_id AND t.user_id = m.user_id AND t.pillar <> 'guestlist')
    ),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', s.notification_key, 'enabled', s.enabled, 'params', s.params,
               'sent',    (SELECT COALESCE(sum(st.sent), 0) FROM steps st WHERE st.rule = s.notification_key),
               'taps',    (SELECT COALESCE(sum(st.taps), 0) FROM steps st WHERE st.rule = s.notification_key),
               'buyers',  (SELECT COALESCE(sum(st.buyers), 0) FROM steps st WHERE st.rule = s.notification_key),
               'revenue', CASE WHEN v_money THEN round((SELECT COALESCE(sum(st.revenue), 0) FROM steps st WHERE st.rule = s.notification_key)::numeric, 2) END,
               'held',    (SELECT COALESCE(sum(st.held), 0) FROM steps st WHERE st.rule = s.notification_key),
               'queued',  (SELECT COALESCE(sum(st.queued), 0) FROM steps st WHERE st.rule = s.notification_key)
             ) ORDER BY s.notification_key)
        FROM public.platform_notification_settings s WHERE s.category = 'event_engine'
    ), '[]'::jsonb),
    'discovery', (SELECT jsonb_build_object('selections', d.selections, 'people', d.people, 'opened', d.opened) FROM disc d),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'title', e.title, 'startAt', e.start_at, 'image', e.image,
               'publishedAt', e.published_at, 'visibility', e.visibility,
               'upcoming', e.start_at > now(),
               'announceAt', e.announce_at, 'announced', e.announced,
               'canSchedule', e.can_schedule, 'parties', e.parties,
               'steps', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'rule', st.rule, 'sent', st.sent, 'taps', st.taps, 'buyers', st.buyers,
                          'entries', st.entries, 'influenced', st.influenced,
                          'revenue', CASE WHEN v_money THEN round(st.revenue::numeric, 2) END,
                          'queued', st.queued, 'nextAt', st.next_at, 'held', st.held,
                          'boughtBefore', st.bought_before, 'lastAt', st.last_at))
                   FROM steps st WHERE st.event_id = e.id), '[]'::jsonb)
             ) ORDER BY (e.start_at < now()), CASE WHEN e.start_at >= now() THEN e.start_at END ASC, e.start_at DESC)
        FROM (SELECT * FROM evj
               ORDER BY (evj.start_at < now()), CASE WHEN evj.start_at >= now() THEN evj.start_at END ASC, evj.start_at DESC
               LIMIT 30) e
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── 11. Super admin ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_push_engine_overview(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 120);
  v_from timestamptz;
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  v_from := now() - make_interval(days => v_days);

  WITH
  d AS MATERIALIZED (SELECT public.demo_event_ids() AS de),
  camp AS MATERIALIZED (
    SELECT pc.id, pc.event_id, pc.created_at, COALESCE(pc.sent_count, 0) AS sent_count, pc.template_key AS rule
      FROM public.push_campaigns pc CROSS JOIN d
     WHERE pc.source = 'auto' AND COALESCE(pc.audience ->> 'engine', '') = 'true'
       AND pc.created_at >= v_from
       AND NOT (pc.event_id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
  ),
  taps AS MATERIALIZED (
    SELECT pce.campaign_id, pce.user_id, min(pce.created_at) AS at
      FROM public.push_campaign_events pce
     WHERE pce.event_type = 'clicked' AND pce.campaign_id IN (SELECT camp.id FROM camp)
     GROUP BY 1, 2
  ),
  sales AS MATERIALIZED (
    SELECT 'tickets'::text AS pillar, t.id, t.user_id, t.event_id, COALESCE(t.paid_at, t.created_at) AS at,
           GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)
             - LEAST(GREATEST(COALESCE(t.refund_amount, 0), 0),
                     GREATEST(t.total_price - COALESCE(t.service_fee, 0) - COALESCE(t.insurance_fee, 0), 0)) AS amount
      FROM public.tickets t
     WHERE t.event_id IN (SELECT DISTINCT camp.event_id FROM camp) AND t.status IN ('paid', 'used')
       AND t.user_id IN (SELECT DISTINCT taps.user_id FROM taps)
    UNION ALL
    SELECT 'tables', r.id, r.user_id, r.event_id, COALESCE(r.paid_at, r.created_at),
           GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                    - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0)
             - LEAST(GREATEST(COALESCE(r.refund_amount, 0), 0),
                     GREATEST(r.total_price - COALESCE(r.service_fee, 0)
                              - (CASE WHEN COALESCE(r.fee_absorbed, false) THEN COALESCE(r.management_fee, 0) ELSE 0 END), 0))
      FROM public.table_reservations r
     WHERE r.event_id IN (SELECT DISTINCT camp.event_id FROM camp) AND r.status IN ('paid', 'confirmed')
       AND r.user_id IN (SELECT DISTINCT taps.user_id FROM taps)
  ),
  touch AS MATERIALIZED (
    SELECT DISTINCT ON (s.pillar, s.id) s.id AS sale_id, s.user_id, s.amount, c.rule
      FROM sales s
      JOIN taps tp ON tp.user_id = s.user_id
      JOIN camp c ON c.id = tp.campaign_id AND c.event_id = s.event_id
     WHERE s.at >= tp.at AND s.at < tp.at + interval '72 hours'
     ORDER BY s.pillar, s.id, tp.at DESC
  ),
  q AS MATERIALIZED (
    SELECT c.rule_key, c.status, COALESCE(c.hold_reason, '') AS hold, c.not_before, c.decided_at, c.created_at
      FROM public.push_candidates c CROSS JOIN d
     WHERE (c.status IN ('pending', 'claimed') OR COALESCE(c.decided_at, c.created_at) >= v_from)
       AND NOT (c.event_id = ANY (COALESCE(d.de, ARRAY[]::uuid[])))
  ),
  series AS (
    SELECT gs::date AS day,
           (SELECT count(*) FROM public.push_campaign_events pce
             WHERE pce.campaign_id IN (SELECT camp.id FROM camp) AND pce.event_type = 'sent'
               AND pce.created_at >= gs AND pce.created_at < gs + interval '1 day') AS sent,
           (SELECT count(*) FROM taps t WHERE t.at >= gs AND t.at < gs + interval '1 day') AS taps
      FROM generate_series(date_trunc('day', now() - make_interval(days => LEAST(v_days, 30) - 1)),
                           date_trunc('day', now()), interval '1 day') gs
  )
  SELECT jsonb_build_object(
    'ok', true,
    'days', v_days,
    'settings', (SELECT s.settings FROM public.push_engine_settings s WHERE s.id = 'default'),
    'totals', jsonb_build_object(
      'sent',    (SELECT COALESCE(sum(c.sent_count), 0) FROM camp c),
      'taps',    (SELECT count(*) FROM taps),
      'buyers',  (SELECT count(DISTINCT t.user_id) FROM touch t),
      'revenue', round((SELECT COALESCE(sum(t.amount), 0) FROM touch t)::numeric, 2),
      'held',    (SELECT count(*) FROM q WHERE q.status IN ('skipped', 'expired')
                    AND q.hold IN ('daily_cap', 'weekly_cap', 'fatigue', 'quiet_hours', 'event_budget',
                                       'lower_priority', 'awaiting_announcement', 'window_passed')),
      'boughtBefore', (SELECT count(*) FROM q WHERE q.hold = 'already_bought')
    ),
    'queue', jsonb_build_object(
      'pending',  (SELECT count(*) FROM q WHERE q.status = 'pending'),
      'dueNow',   (SELECT count(*) FROM q WHERE q.status = 'pending' AND q.not_before <= now()),
      'claimed',  (SELECT count(*) FROM q WHERE q.status = 'claimed'),
      'oldestDue', (SELECT min(q.not_before) FROM q WHERE q.status = 'pending' AND q.not_before <= now()),
      'holds', COALESCE((SELECT jsonb_object_agg(h.hold, h.n) FROM (
                 SELECT q.hold, count(*) AS n FROM q WHERE q.status = 'pending' AND q.hold <> '' GROUP BY q.hold) h), '{}'::jsonb)
    ),
    'rules', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', s.notification_key, 'enabled', s.enabled, 'params', s.params,
               'sent',    (SELECT COALESCE(sum(c.sent_count), 0) FROM camp c WHERE c.rule = s.notification_key),
               'taps',    (SELECT count(*) FROM taps t JOIN camp c ON c.id = t.campaign_id WHERE c.rule = s.notification_key),
               'buyers',  (SELECT count(DISTINCT t.user_id) FROM touch t WHERE t.rule = s.notification_key),
               'revenue', round((SELECT COALESCE(sum(t.amount), 0) FROM touch t WHERE t.rule = s.notification_key)::numeric, 2),
               'queued',  (SELECT count(*) FROM q WHERE q.rule_key = s.notification_key AND q.status IN ('pending', 'claimed')),
               'held',    (SELECT count(*) FROM q WHERE q.rule_key = s.notification_key AND q.status IN ('skipped', 'expired')
                             AND q.hold IN ('daily_cap', 'weekly_cap', 'fatigue', 'quiet_hours', 'event_budget',
                                                'lower_priority', 'awaiting_announcement', 'window_passed')),
               'heldBy',  COALESCE((SELECT jsonb_object_agg(h.hold, h.n) FROM (
                             SELECT q.hold, count(*) AS n FROM q
                              WHERE q.rule_key = s.notification_key AND q.status IN ('skipped', 'expired') AND q.hold <> ''
                              GROUP BY q.hold) h), '{}'::jsonb),
               'lastAt',  (SELECT max(c.created_at) FROM camp c WHERE c.rule = s.notification_key)
             ) ORDER BY s.notification_key)
        FROM public.platform_notification_settings s WHERE s.category = 'event_engine'
    ), '[]'::jsonb),
    'series', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', se.day, 'sent', se.sent, 'taps', se.taps) ORDER BY se.day) FROM series se), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_push_engine_settings(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text; v_val jsonb; v_num numeric;
  v_bounds jsonb := '{
    "quiet_start":[0,23],"quiet_end":[0,23],"daily_cap":[0,10],"weekly_cap":[0,30],
    "weekly_cap_engaged":[0,30],"weekly_cap_fatigued":[0,30],"fatigue_sent":[1,60],"fatigue_days":[7,180],
    "urgent_daily_cap":[0,10],"per_event_max":[1,6],"credits_venue":[0,100],"credits_org":[0,100],
    "credits_agency":[0,100],"event_info_per_event":[0,10],"manual_per_24h":[0,10]}'::jsonb;
  v_clean jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(COALESCE(p_patch, '{}'::jsonb)) LOOP
    IF NOT (v_bounds ? v_key) THEN RAISE EXCEPTION 'unknown_setting: %', v_key; END IF;
    IF jsonb_typeof(v_val) <> 'number' THEN RAISE EXCEPTION 'not_a_number: %', v_key; END IF;
    v_num := round((v_val #>> '{}')::numeric);
    IF v_num < (v_bounds -> v_key ->> 0)::numeric OR v_num > (v_bounds -> v_key ->> 1)::numeric THEN
      RAISE EXCEPTION 'out_of_range: %', v_key;
    END IF;
    v_clean := v_clean || jsonb_build_object(v_key, v_num::integer);
  END LOOP;
  UPDATE public.push_engine_settings
     SET settings = settings || v_clean, updated_at = now(), updated_by = auth.uid()
   WHERE id = 'default';
  RETURN (SELECT s.settings FROM public.push_engine_settings s WHERE s.id = 'default');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_push_rule(p_key text, p_enabled boolean DEFAULT NULL, p_params jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.platform_notification_settings%ROWTYPE;
  v_k text; v_v jsonb; v_clean jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.platform_notification_settings WHERE notification_key = p_key;
  IF NOT FOUND OR v_row.category <> 'event_engine' THEN RAISE EXCEPTION 'unknown_rule: %', p_key; END IF;
  IF p_params IS NOT NULL THEN
    FOR v_k, v_v IN SELECT * FROM jsonb_each(p_params) LOOP
      -- On ne règle que des paramètres qui existent déjà, et en nombres entiers
      -- raisonnables : jamais une clé inventée que personne ne lit.
      IF NOT (v_row.params ? v_k) THEN RAISE EXCEPTION 'unknown_param: %', v_k; END IF;
      IF jsonb_typeof(v_v) <> 'number' OR (v_v #>> '{}')::numeric < 0 OR (v_v #>> '{}')::numeric > 1000 THEN
        RAISE EXCEPTION 'bad_param: %', v_k;
      END IF;
      v_clean := v_clean || jsonb_build_object(v_k, round((v_v #>> '{}')::numeric)::integer);
    END LOOP;
  END IF;
  UPDATE public.platform_notification_settings
     SET enabled = COALESCE(p_enabled, enabled),
         params = params || v_clean,
         updated_at = now(), updated_by = auth.uid()
   WHERE notification_key = p_key
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('key', v_row.notification_key, 'enabled', v_row.enabled, 'params', v_row.params);
END;
$$;

-- p_title NULL = rétablir le texte par défaut.
CREATE OR REPLACE FUNCTION public.admin_set_push_template(
  p_rule text, p_variant text, p_reason text, p_lang text, p_title text, p_body text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.push_rule_templates%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_title IS NULL THEN
    UPDATE public.push_rule_templates
       SET title = default_title, body = default_body, updated_at = now(), updated_by = auth.uid()
     WHERE rule_key = p_rule AND variant = p_variant AND reason = p_reason AND lang = p_lang
    RETURNING * INTO v_row;
  ELSE
    IF length(btrim(p_title)) = 0 OR length(p_title) > 80 OR length(COALESCE(p_body, '')) = 0 OR length(p_body) > 240 THEN
      RAISE EXCEPTION 'invalid_text';
    END IF;
    UPDATE public.push_rule_templates
       SET title = btrim(p_title), body = btrim(p_body), updated_at = now(), updated_by = auth.uid()
     WHERE rule_key = p_rule AND variant = p_variant AND reason = p_reason AND lang = p_lang
    RETURNING * INTO v_row;
  END IF;
  IF v_row.rule_key IS NULL THEN RAISE EXCEPTION 'unknown_template'; END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_push_credit_accounts(p_q text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  IF NOT public.is_super_admin() THEN RETURN jsonb_build_object('ok', false, 'reason', 'forbidden'); END IF;
  RETURN jsonb_build_object('ok', true, 'accounts', COALESCE((
    WITH scopes AS (
      SELECT 'venue:' || v.id AS scope_key, 'venue'::text AS kind, v.name AS name
        FROM public.venues v
       WHERE v.decommissioned_at IS NULL AND (v_q IS NULL OR v.name ILIKE '%' || v_q || '%')
      UNION ALL
      SELECT 'org:' || op.user_id::text, 'org', op.display_name
        FROM public.organizer_profiles op
       WHERE v_q IS NULL OR op.display_name ILIKE '%' || v_q || '%'
      UNION ALL
      SELECT 'agency:' || a.id::text, 'agency', a.name
        FROM public.agencies a
       WHERE v_q IS NULL OR a.name ILIKE '%' || v_q || '%'
    ),
    picked AS (
      SELECT s.* FROM scopes s
       WHERE v_q IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.push_credit_accounts a WHERE a.scope_key = s.scope_key)
          OR EXISTS (SELECT 1 FROM public.push_credit_ledger l
                      WHERE l.scope_key = s.scope_key AND l.created_at > now() - interval '90 days')
       ORDER BY s.name
       LIMIT 100
    )
    SELECT jsonb_agg(jsonb_build_object('scope', p.scope_key, 'kind', p.kind, 'name', p.name)
                     || public._push_credit_state(p.scope_key)
                     || jsonb_build_object('lastRequestAt', (
                          SELECT max(n.created_at) FROM public.admin_notifications n
                           WHERE n.notification_type = 'admin_push_credit_request'
                             AND n.reference_id = p.scope_key))
                     ORDER BY p.name)
      FROM picked p
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_push_credits(p_scope text, p_amount integer, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_scope IS NULL OR p_scope !~ '^(venue|org|agency):.+$' THEN RAISE EXCEPTION 'bad_scope'; END IF;
  IF p_amount IS NULL OR p_amount = 0 OR abs(p_amount) > 100 THEN RAISE EXCEPTION 'bad_amount'; END IF;
  INSERT INTO public.push_credit_accounts (scope_key) VALUES (p_scope) ON CONFLICT (scope_key) DO NOTHING;
  UPDATE public.push_credit_accounts
     SET bonus_balance = GREATEST(0, bonus_balance + p_amount), updated_at = now(), updated_by = auth.uid()
   WHERE scope_key = p_scope;
  INSERT INTO public.push_credit_ledger (scope_key, kind, delta, note, created_by)
  VALUES (p_scope, 'grant', p_amount, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid());
  RETURN public._push_credit_state(p_scope);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_push_allowance(p_scope text, p_allowance integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_scope IS NULL OR p_scope !~ '^(venue|org|agency):.+$' THEN RAISE EXCEPTION 'bad_scope'; END IF;
  IF p_allowance IS NOT NULL AND (p_allowance < 0 OR p_allowance > 100) THEN RAISE EXCEPTION 'bad_allowance'; END IF;
  INSERT INTO public.push_credit_accounts (scope_key, monthly_allowance, updated_by)
  VALUES (p_scope, p_allowance, auth.uid())
  ON CONFLICT (scope_key) DO UPDATE
     SET monthly_allowance = EXCLUDED.monthly_allowance, updated_at = now(), updated_by = auth.uid();
  INSERT INTO public.push_credit_ledger (scope_key, kind, delta, note, created_by)
  VALUES (p_scope, 'allowance', COALESCE(p_allowance, -1), 'monthly allowance', auth.uid());
  RETURN public._push_credit_state(p_scope);
END;
$$;

-- ── 12. Droits ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.push_engine_setting(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_rule_enabled(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_rule_param(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_marketable_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_has_bought(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_event_holders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_event_interested(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_event_sellable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_scarcity_variant(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_party_past_events(text, text, uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_legacy_sent(uuid, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_mark_run(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_reachable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_announcement(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_event_host_followers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_new_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_sales_open() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_last_tickets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_last_call() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_checkout_abandoned() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_vip_upsell() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_reminders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_collect_after_thanks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_engine_collect() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_engine_enqueue_lineup(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_engine_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_engine_campaign(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_engine_record(uuid, bigint[], bigint[], bigint[], text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_engine_housekeeping() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_credit_state(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_push_credit(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_push_credit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_credit_state_for(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._push_scope_for_caller(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_is_quiet_hour(timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.push_engine_setting(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_rule_enabled(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_rule_param(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_engine_collect() TO service_role;
GRANT EXECUTE ON FUNCTION public.push_engine_enqueue_lineup(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_engine_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_engine_campaign(text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_engine_record(uuid, bigint[], bigint[], bigint[], text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_engine_housekeeping() TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_push_credit(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_push_credit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_credit_state_for(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_is_quiet_hour(timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.set_event_announce_at(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_push_center(text, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_push_credits(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_push_credits(text, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_push_engine_overview(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_push_engine_settings(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_push_rule(text, boolean, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_push_template(text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_push_credit_accounts(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_push_credits(text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_push_allowance(text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_event_announce_at(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_center(text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_credits(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_push_credits(text, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_push_engine_overview(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_push_engine_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_push_rule(text, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_push_template(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_push_credit_accounts(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_push_credits(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_push_allowance(text, integer) TO authenticated;

COMMENT ON TABLE public.push_candidates IS
  'File du moteur de notifications : une ligne = une notification possible (personne, soirée, règle, raison, partie). Écrite par les collecteurs, vidée par push_engine_claim (arbitrage anti-spam), jamais lue en direct par un pro.';
