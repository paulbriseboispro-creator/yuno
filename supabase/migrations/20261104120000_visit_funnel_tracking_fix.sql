-- ============================================================================
-- Visites, paniers, passages au paiement, achats : la mesure qui ne passait pas
-- (19/10, lancement des ventes de House Of Masquerade, Amoris).
--
-- Constaté en prod sur la soirée (308 visites, 40 billets payés) :
--  • `visitor_sessions.added_to_cart / proceeded_to_checkout / completed_order`
--    à 0 partout. Le front les écrivait par un UPDATE direct, que la base
--    refuse en silence : un visiteur n'a aucune policy de LECTURE sur la
--    table, donc l'UPDATE … WHERE session_id = … ne voit aucune ligne. Le
--    trigger `validate_visitor_session_update` levait en plus pour tout
--    visiteur sans compte (`auth.uid() IS NULL`), y compris sous une fonction
--    SECURITY DEFINER : `link_sale_session` échouait donc pour chaque acheteur
--    invité (0 session reliée à une vente).
--  • `duration_seconds`, `scroll_depth_max`, `last_activity_at` jamais écrits
--    depuis août (même UPDATE direct, même refus).
--  • Vue en direct : `live_visitor_pings.stage` toujours « browsing ». Les
--    étapes panier / paiement / payé passaient par un upsert direct (aucune
--    policy d'écriture) et le battement de 15 s réécrivait « browsing ».
--  • Tunnel par soirée (`event_funnel_events`) : 0 achat sur 40 billets.
--    L'étape « purchased » n'était écrite que par le navigateur, et seulement
--    quand CET appel validait le paiement — or le webhook Stripe passe presque
--    toujours avant le retour du client (`alreadyProcessed`).
--
-- Ce que fait la migration :
--  1. La garde de `visitor_sessions` ne discrimine plus sur `auth.uid()` mais
--     sur `current_user` : un CLIENT ne change jamais une étape, une fonction
--     SECURITY DEFINER si.
--  2. `touch_visitor_session` : durée, défilement, dernière activité.
--  3. `_visit_mark_stage` : UNE porte qui pose l'étape d'une visite (drapeaux
--     de `visitor_sessions` + étape du direct), jamais à reculons.
--  4. `track_event_funnel` reçoit l'id de la visite (`p_visit_sid`) et pose
--     l'étape correspondante : choisi → panier ; page de paiement, coordonnées,
--     paiement → passage au paiement.
--  5. `ping_live_visitor` ne fait plus reculer une étape (dans la même visite).
--  6. L'ACHAT est écrit par la base, au passage en payé de la vente : billets,
--     tables, guest list portent l'id de la visite et du tunnel
--     (`tracking_visit_sid`, `tracking_funnel_sid`, posés par les fonctions
--     `create-*`), et deux triggers relient la vente — que le paiement soit
--     confirmé par le webhook, le navigateur, un billet gratuit ou une table
--     réglée sur place.
--  7. Rattrapage des ventes et des visites passées (hors démo), sur des
--     correspondances sans ambiguïté (voir § 7).
--
-- Définitions, partout (mêmes rangs que `get_event_traffic`) :
--   panier   = la visite a choisi un billet / une formule / s'est inscrite
--   paiement = la visite a ouvert la page de paiement (ou plus loin)
--   achat    = une vente payée (ou une inscription) est née de cette visite
-- ============================================================================

-- ── 1. Garde des étapes d'une visite ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_visitor_session_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Un client (anon / authenticated) ne touche ni aux étapes du tunnel ni à
  -- l'identité de la session : seules les fonctions SECURITY DEFINER
  -- (track_event_funnel, relevé des ventes) les posent. `current_user`, jamais
  -- `auth.uid()` : sous une fonction DEFINER, auth.uid() reste celui du
  -- visiteur (NULL pour un invité), ce qui faisait échouer la liaison des
  -- ventes de tous les acheteurs sans compte.
  IF current_user IN ('anon', 'authenticated') AND (
       NEW.added_to_cart IS DISTINCT FROM OLD.added_to_cart
    OR NEW.completed_order IS DISTINCT FROM OLD.completed_order
    OR NEW.proceeded_to_checkout IS DISTINCT FROM OLD.proceeded_to_checkout
    OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.venue_id IS DISTINCT FROM OLD.venue_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.ip_address IS DISTINCT FROM OLD.ip_address
  ) THEN
    RAISE EXCEPTION 'visitor_session_steps_are_server_side';
  END IF;

  -- Durée bornée (0 à 24 h).
  IF NEW.duration_seconds IS NOT NULL AND (NEW.duration_seconds < 0 OR NEW.duration_seconds > 86400) THEN
    NEW.duration_seconds := LEAST(GREATEST(NEW.duration_seconds, 0), 86400);
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 2. Durée, défilement, dernière activité ──────────────────────────────────
-- Appelée au passage en arrière-plan, à la fermeture et au démontage de la
-- page (fetch keepalive). Jamais à reculons : la durée part du début de la
-- visite, le défilement est un maximum.
CREATE OR REPLACE FUNCTION public.touch_visitor_session(
  p_session_id text,
  p_duration_seconds integer DEFAULT NULL,
  p_scroll_depth integer DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sid text := left(btrim(COALESCE(p_session_id, '')), 80);
  v_dur integer := LEAST(GREATEST(COALESCE(p_duration_seconds, 0), 0), 86400);
  v_scr integer := LEAST(GREATEST(COALESCE(p_scroll_depth, 0), 0), 100);
BEGIN
  IF length(v_sid) < 8 THEN RETURN; END IF;
  UPDATE public.visitor_sessions s
     SET duration_seconds = GREATEST(COALESCE(s.duration_seconds, 0), v_dur),
         scroll_depth_max = GREATEST(COALESCE(s.scroll_depth_max, 0), v_scr),
         last_activity_at = now()
   WHERE s.session_id = v_sid
     AND s.visited_at > now() - interval '2 days';
EXCEPTION WHEN OTHERS THEN
  RETURN; -- une mesure ne fait jamais échouer une page
END;
$function$;

REVOKE ALL ON FUNCTION public.touch_visitor_session(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_visitor_session(text, integer, integer) TO anon, authenticated;

-- ── 3. L'étape d'une visite : une porte, jamais à reculons ───────────────────
CREATE OR REPLACE FUNCTION public._visit_stage_rank(p_stage text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_stage WHEN 'cart' THEN 2 WHEN 'checkout' THEN 3 WHEN 'paid' THEN 4 ELSE 1 END
$function$;

REVOKE ALL ON FUNCTION public._visit_stage_rank(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._visit_stage_rank(text) TO service_role;

-- Pose l'étape `p_stage` (cart | checkout | paid) sur la visite `p_visit_sid` :
-- drapeaux de la dernière ligne `visitor_sessions` de cette visite (une étape
-- implique les précédentes) et étape de la Vue en direct. `p_order_id` relie
-- une COMMANDE DU BAR à la visite (une fois) : `visitor_sessions.order_id` est
-- une clé vers `orders`, jamais un billet ni une table (c'est ce qui faisait
-- aussi échouer `link_sale_session` sur chaque billet). Ne lève jamais.
CREATE OR REPLACE FUNCTION public._visit_mark_stage(
  p_visit_sid text,
  p_event_id uuid,
  p_stage text,
  p_cart_cents integer DEFAULT NULL,
  p_order_id uuid DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sid  text := left(btrim(COALESCE(p_visit_sid, '')), 80);
  v_rank integer := public._visit_stage_rank(p_stage);
  v_cart integer := CASE WHEN p_cart_cents BETWEEN 0 AND 10000000 THEN p_cart_cents END;
  v_id   uuid;
BEGIN
  IF length(v_sid) < 8 OR v_rank < 2 THEN RETURN; END IF;

  SELECT s.id INTO v_id
    FROM public.visitor_sessions s
   WHERE s.session_id = v_sid
     AND s.visited_at > now() - interval '2 days'
   ORDER BY s.visited_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.visitor_sessions s
       SET added_to_cart         = true,
           proceeded_to_checkout = s.proceeded_to_checkout OR v_rank >= 3,
           completed_order       = s.completed_order OR v_rank >= 4,
           order_id              = COALESCE(s.order_id, p_order_id),
           cart_value_cents      = GREATEST(COALESCE(s.cart_value_cents, 0), COALESCE(v_cart, 0)),
           last_activity_at      = now()
     WHERE s.id = v_id
       AND (   NOT COALESCE(s.added_to_cart, false)
            OR (v_rank >= 3 AND NOT COALESCE(s.proceeded_to_checkout, false))
            OR (v_rank >= 4 AND NOT COALESCE(s.completed_order, false))
            OR (p_order_id IS NOT NULL AND s.order_id IS NULL)
            OR COALESCE(s.cart_value_cents, 0) < COALESCE(v_cart, 0));
  END IF;

  -- Vue en direct : l'étape la plus avancée de la visite (une visite reprise
  -- après 30 minutes repart de zéro), et c'est aussi un signe de vie.
  UPDATE public.live_visitor_pings p
     SET stage = CASE
                   WHEN p.last_seen < now() - interval '30 minutes' THEN p_stage
                   WHEN public._visit_stage_rank(p.stage) >= v_rank THEN p.stage
                   ELSE p_stage
                 END,
         cart_value_cents = GREATEST(COALESCE(p.cart_value_cents, 0), COALESCE(v_cart, 0)),
         event_id = COALESCE(p.event_id, p_event_id),
         last_seen = now()
   WHERE p.session_id = v_sid;
  IF NOT FOUND THEN
    INSERT INTO public.live_visitor_pings (session_id, event_id, stage, cart_value_cents, user_id, last_seen)
    VALUES (v_sid, p_event_id, p_stage, COALESCE(v_cart, 0), auth.uid(), now())
    ON CONFLICT (session_id) DO NOTHING;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public._visit_mark_stage(text, uuid, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._visit_mark_stage(text, uuid, text, integer, uuid) TO service_role;

-- Porte publique des étapes « panier » et « paiement » d'une visite hors
-- soirée (commande au bar, quand le pilier boissons reviendra). Jamais
-- « payé » : un achat se relève sur la vente, pas sur la parole du navigateur.
CREATE OR REPLACE FUNCTION public.track_visit_stage(
  p_session_id text,
  p_stage text,
  p_cart_value_cents integer DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_stage NOT IN ('cart', 'checkout') THEN RETURN; END IF;
  PERFORM public._visit_mark_stage(p_session_id, NULL, p_stage, p_cart_value_cents);
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.track_visit_stage(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_visit_stage(text, text, integer) TO anon, authenticated;

-- ── 4. Le tunnel d'une soirée pose aussi l'étape de la visite ────────────────
-- Ajouter un paramètre = DROP + CREATE (une surcharge rendrait ambigus les
-- appels à arguments nommés des bundles en cache).
DROP FUNCTION IF EXISTS public.track_event_funnel(text, uuid, text, text, text, integer, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.track_event_funnel(
  p_session_id text,
  p_event_id uuid,
  p_step text,
  p_pillar text DEFAULT NULL,
  p_ref text DEFAULT NULL,
  p_quantity integer DEFAULT NULL,
  p_amount_cents integer DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_visit_sid text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sid    text := left(btrim(COALESCE(p_session_id, '')), 80);
  v_pillar text := CASE WHEN p_pillar IN ('tickets', 'tables', 'guest_list') THEN p_pillar END;
  v_device text := CASE WHEN p_device IN ('mobile', 'tablet', 'desktop') THEN p_device END;
  v_source text := CASE WHEN p_source IN ('direct', 'social', 'search', 'email', 'qr', 'paid_search',
                                          'paid_social', 'paid', 'affiliate', 'internal', 'referral') THEN p_source END;
  v_stage  text;
BEGIN
  IF v_sid = '' OR p_event_id IS NULL THEN RETURN; END IF;
  IF p_step IS NULL OR p_step NOT IN ('viewed', 'selected', 'checkout', 'details', 'payment',
                                      'purchased', 'failed', 'waitlist', 'shared', 'followed') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN RETURN; END IF;

  -- L'étape de la VISITE (drapeaux de visitor_sessions + Vue en direct), avant
  -- les dédoublonnages du tunnel : un rechargement ne gonfle pas le tunnel,
  -- mais la visite doit garder son étape.
  v_stage := CASE
               WHEN p_step = 'selected' THEN 'cart'
               WHEN p_step IN ('checkout', 'details', 'payment') THEN 'checkout'
               WHEN p_step = 'purchased' THEN 'paid'
             END;
  IF v_stage IS NOT NULL AND p_visit_sid IS NOT NULL THEN
    PERFORM public._visit_mark_stage(p_visit_sid, p_event_id, v_stage,
                                     CASE WHEN p_step = 'selected' THEN p_amount_cents END);
  END IF;

  -- Anti-flood : 80 lignes par session et par soirée et par heure.
  IF (SELECT count(*) FROM public.event_funnel_events f
       WHERE f.event_id = p_event_id AND f.session_id = v_sid
         AND f.created_at > now() - interval '1 hour') >= 80 THEN
    RETURN;
  END IF;

  -- Une étape « de passage » ne se répète pas : un rechargement de page ne
  -- gonfle ni la vue ni l'entrée au paiement. Un choix se répète seulement
  -- s'il change (autre palier / formule) ou après 2 minutes. Un achat écrit
  -- par le navigateur (anciens bundles) s'efface derrière celui que la base a
  -- relevé sur la vente.
  IF p_step IN ('viewed', 'checkout', 'details', 'payment', 'purchased', 'waitlist', 'shared', 'followed') THEN
    IF EXISTS (SELECT 1 FROM public.event_funnel_events f
                WHERE f.event_id = p_event_id AND f.session_id = v_sid AND f.step = p_step
                  AND f.pillar IS NOT DISTINCT FROM v_pillar
                  AND f.created_at > now() - interval '30 minutes') THEN
      RETURN;
    END IF;
  ELSIF p_step = 'selected' THEN
    IF EXISTS (SELECT 1 FROM public.event_funnel_events f
                WHERE f.event_id = p_event_id AND f.session_id = v_sid AND f.step = 'selected'
                  AND f.pillar IS NOT DISTINCT FROM v_pillar
                  AND f.ref_id IS NOT DISTINCT FROM left(p_ref, 80)
                  AND f.created_at > now() - interval '2 minutes') THEN
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.event_funnel_events
    (session_id, event_id, step, pillar, ref_id, quantity, amount_cents, reason, device, source)
  VALUES (
    v_sid, p_event_id, p_step, v_pillar, left(p_ref, 80),
    CASE WHEN p_quantity BETWEEN 0 AND 1000 THEN p_quantity END,
    CASE WHEN p_amount_cents BETWEEN 0 AND 10000000 THEN p_amount_cents END,
    left(p_reason, 40), v_device, v_source
  );
EXCEPTION WHEN OTHERS THEN
  -- Une mesure ne doit jamais faire échouer la page qui la tire.
  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.track_event_funnel(text, uuid, text, text, text, integer, integer, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_event_funnel(text, uuid, text, text, text, integer, integer, text, text, text, text) TO anon, authenticated;

-- ── 5. Le battement du direct ne fait plus reculer une étape ─────────────────
CREATE OR REPLACE FUNCTION public.ping_live_visitor(
  p_session_id text,
  p_venue_id text DEFAULT NULL::text,
  p_event_id uuid DEFAULT NULL::uuid,
  p_organizer_user_id uuid DEFAULT NULL::uuid,
  p_page_path text DEFAULT NULL::text,
  p_stage text DEFAULT 'browsing'::text
)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO live_visitor_pings
    (session_id, venue_id, event_id, organizer_user_id, page_path, stage, user_id, last_seen)
  VALUES (
    left(p_session_id, 80),
    p_venue_id,
    p_event_id,
    p_organizer_user_id,
    left(p_page_path, 300),
    -- Le stage vient du client : contraint à la liste connue, sinon 'browsing'.
    CASE WHEN p_stage IN ('browsing', 'cart', 'checkout', 'paid') THEN p_stage ELSE 'browsing' END,
    -- Identité imposée par le serveur : auth.uid() (NULL pour un anonyme).
    auth.uid(),
    now()
  )
  ON CONFLICT (session_id) DO UPDATE
    SET venue_id          = COALESCE(EXCLUDED.venue_id, live_visitor_pings.venue_id),
        event_id          = COALESCE(EXCLUDED.event_id, live_visitor_pings.event_id),
        organizer_user_id = COALESCE(EXCLUDED.organizer_user_id, live_visitor_pings.organizer_user_id),
        page_path         = EXCLUDED.page_path,
        -- L'étape la plus avancée de la visite : le battement d'une page de
        -- soirée (« browsing ») n'efface plus un panier, un paiement, un achat.
        -- Une visite reprise après 30 minutes repart de son étape du moment.
        stage = CASE
                  WHEN live_visitor_pings.last_seen < now() - interval '30 minutes' THEN EXCLUDED.stage
                  WHEN public._visit_stage_rank(EXCLUDED.stage) > public._visit_stage_rank(live_visitor_pings.stage) THEN EXCLUDED.stage
                  ELSE live_visitor_pings.stage
                END,
        user_id           = EXCLUDED.user_id,
        last_seen         = now();
$function$;

REVOKE ALL ON FUNCTION public.ping_live_visitor(text, text, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ping_live_visitor(text, text, uuid, uuid, text, text) TO anon, authenticated;

-- Les battements ne servent qu'aux 10 dernières minutes : purge quotidienne
-- (la fonction existait sans cron, la table grossissait sans fin).
CREATE OR REPLACE FUNCTION public.cleanup_stale_live_pings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.live_visitor_pings WHERE last_seen < now() - interval '2 days';
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_stale_live_pings() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'live-visitor-pings-purge') THEN
    PERFORM cron.unschedule('live-visitor-pings-purge');
  END IF;
  PERFORM cron.schedule('live-visitor-pings-purge', '57 3 * * *', 'SELECT public.cleanup_stale_live_pings();');
END
$cron$;

-- ── 6. L'achat, relevé par la base sur la vente ──────────────────────────────
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS tracking_visit_sid text,
  ADD COLUMN IF NOT EXISTS tracking_funnel_sid text;
ALTER TABLE public.table_reservations
  ADD COLUMN IF NOT EXISTS tracking_visit_sid text,
  ADD COLUMN IF NOT EXISTS tracking_funnel_sid text;
ALTER TABLE public.guest_list_entries
  ADD COLUMN IF NOT EXISTS tracking_visit_sid text,
  ADD COLUMN IF NOT EXISTS tracking_funnel_sid text;

COMMENT ON COLUMN public.tickets.tracking_visit_sid IS
  'Id (aléatoire, par onglet) de la visite qui a mené à l''achat — visitor_sessions.session_id. Aucune donnée personnelle.';
COMMENT ON COLUMN public.tickets.tracking_funnel_sid IS
  'Id (aléatoire, par onglet) du tunnel de la soirée — event_funnel_events.session_id. Aucune donnée personnelle.';

-- Une vente payée → l'étape « achat » du tunnel de la soirée et de la visite.
-- Idempotent : une ligne « purchased » par vente (ref_id = '<kind>:<id>').
CREATE OR REPLACE FUNCTION public._record_sale_visit(
  p_kind text,            -- ticket | table | guest_list
  p_sale_id uuid,
  p_event_id uuid,
  p_quantity integer,
  p_amount_cents integer,
  p_visit_sid text,
  p_funnel_sid text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pillar text := CASE p_kind WHEN 'ticket' THEN 'tickets' WHEN 'table' THEN 'tables' WHEN 'guest_list' THEN 'guest_list' END;
  v_ref    text := p_kind || ':' || p_sale_id::text;
  v_fsid   text := left(btrim(COALESCE(p_funnel_sid, '')), 80);
  v_device text;
  v_source text;
BEGIN
  IF v_pillar IS NULL OR p_sale_id IS NULL OR p_event_id IS NULL THEN RETURN; END IF;

  IF length(v_fsid) >= 8
     AND NOT EXISTS (SELECT 1 FROM public.event_funnel_events f
                      WHERE f.event_id = p_event_id AND f.step = 'purchased' AND f.ref_id = v_ref)
     AND NOT EXISTS (SELECT 1 FROM public.event_funnel_events f
                      WHERE f.event_id = p_event_id AND f.session_id = v_fsid AND f.step = 'purchased'
                        AND f.pillar = v_pillar AND f.ref_id IS NULL
                        AND f.created_at > now() - interval '30 minutes') THEN
    SELECT (array_agg(f.device ORDER BY f.created_at DESC) FILTER (WHERE f.device IS NOT NULL))[1],
           (array_agg(f.source ORDER BY f.created_at) FILTER (WHERE f.source IS NOT NULL))[1]
      INTO v_device, v_source
      FROM public.event_funnel_events f
     WHERE f.event_id = p_event_id AND f.session_id = v_fsid;
    INSERT INTO public.event_funnel_events
      (session_id, event_id, step, pillar, ref_id, quantity, amount_cents, device, source)
    VALUES (v_fsid, p_event_id, 'purchased', v_pillar, v_ref,
            CASE WHEN p_quantity BETWEEN 0 AND 1000 THEN p_quantity END,
            CASE WHEN p_amount_cents BETWEEN 0 AND 10000000 THEN p_amount_cents END,
            v_device, v_source);
  END IF;

  IF p_visit_sid IS NOT NULL THEN
    PERFORM public._visit_mark_stage(p_visit_sid, p_event_id, 'paid', p_amount_cents, NULL);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN; -- une mesure ne fait jamais échouer une vente
END;
$function$;

REVOKE ALL ON FUNCTION public._record_sale_visit(text, uuid, uuid, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._record_sale_visit(text, uuid, uuid, integer, integer, text, text) TO service_role;

-- AFTER INSERT OR UPDATE OF status, tracking_* : la vente vient de devenir
-- payée, OU elle l'était déjà quand ses ids de visite arrivent (une table
-- réglée sur place est créée payée par reserve_table_slot, puis complétée).
CREATE OR REPLACE FUNCTION public.record_sale_visit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind  text := TG_ARGV[0];
  v_paid  text[];
  v_event uuid;
  v_qty   integer;
  v_cents integer;
BEGIN
  IF NEW.tracking_visit_sid IS NULL AND NEW.tracking_funnel_sid IS NULL THEN RETURN NEW; END IF;

  v_paid := CASE v_kind
              WHEN 'ticket' THEN ARRAY['paid', 'used']
              WHEN 'table' THEN ARRAY['paid', 'confirmed']
              -- Une inscription compte dès qu'elle existe (en attente de
              -- validation comprise), comme `guest_list_joined`.
              ELSE ARRAY['confirmed', 'pending', 'entered', 'reserved']
            END;
  IF NOT (NEW.status = ANY (v_paid)) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = ANY (v_paid)
     AND (OLD.tracking_visit_sid IS NOT NULL OR OLD.tracking_funnel_sid IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  IF v_kind = 'ticket' THEN
    v_event := NEW.event_id;
    v_qty := GREATEST(COALESCE(NEW.quantity, 1), 1);
    v_cents := round(COALESCE(NEW.total_price, 0) * 100)::integer;
  ELSIF v_kind = 'table' THEN
    v_event := NEW.event_id;
    v_qty := NEW.guest_count;
    v_cents := round(COALESCE(NEW.total_price, 0) * 100)::integer;
  ELSE
    SELECT gl.event_id INTO v_event FROM public.guest_lists gl WHERE gl.id = NEW.guest_list_id;
    v_qty := 1;
    v_cents := 0;
  END IF;

  PERFORM public._record_sale_visit(v_kind, NEW.id, v_event, v_qty, v_cents,
                                    NEW.tracking_visit_sid, NEW.tracking_funnel_sid);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_sale_visit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_record_sale_visit ON public.tickets;
CREATE TRIGGER trg_record_sale_visit AFTER INSERT OR UPDATE OF status, tracking_visit_sid, tracking_funnel_sid ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.record_sale_visit('ticket');
DROP TRIGGER IF EXISTS trg_record_sale_visit ON public.table_reservations;
CREATE TRIGGER trg_record_sale_visit AFTER INSERT OR UPDATE OF status, tracking_visit_sid, tracking_funnel_sid ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.record_sale_visit('table');
DROP TRIGGER IF EXISTS trg_record_sale_visit ON public.guest_list_entries;
CREATE TRIGGER trg_record_sale_visit AFTER INSERT OR UPDATE OF status, tracking_visit_sid, tracking_funnel_sid ON public.guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.record_sale_visit('guest_list');

-- BEFORE … : une vente restée « direct » prend la source d'arrivée de la
-- visite (ce que `link_sale_session` devait faire depuis le navigateur). Nommé
-- pour passer APRÈS `trg_stamp_*_attribution` (ordre alphabétique des BEFORE).
CREATE OR REPLACE FUNCTION public.stamp_sale_session_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := TG_ARGV[0];
  v_paid text[];
  v_sess record;
  v_src  text;
BEGIN
  IF NEW.tracking_visit_sid IS NULL THEN RETURN NEW; END IF;
  v_paid := CASE v_kind WHEN 'ticket' THEN ARRAY['paid', 'used'] WHEN 'table' THEN ARRAY['paid', 'confirmed']
                        ELSE ARRAY['confirmed', 'pending', 'entered', 'reserved'] END;
  IF NOT (NEW.status = ANY (v_paid)) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = ANY (v_paid) AND OLD.tracking_visit_sid IS NOT NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.attribution_source, 'direct') <> 'direct' THEN RETURN NEW; END IF;

  SELECT s.referrer_category, s.referrer_domain, s.utm_source, s.utm_medium
    INTO v_sess
    FROM public.visitor_sessions s
   WHERE s.session_id = NEW.tracking_visit_sid
     AND s.visited_at > now() - interval '2 days'
   ORDER BY s.visited_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_src := public.attribution_from_session(v_sess.referrer_category, v_sess.referrer_domain, v_sess.utm_source, v_sess.utm_medium);
  IF v_src IS NOT NULL AND v_src <> 'direct' THEN
    NEW.attribution_source := v_src;
    NEW.attribution_ref := 'session';
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- l'attribution n'empêche jamais une vente
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_sale_session_source() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_ticket_session_source ON public.tickets;
CREATE TRIGGER trg_stamp_ticket_session_source BEFORE INSERT OR UPDATE OF status, tracking_visit_sid ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_session_source('ticket');
DROP TRIGGER IF EXISTS trg_stamp_table_session_source ON public.table_reservations;
CREATE TRIGGER trg_stamp_table_session_source BEFORE INSERT OR UPDATE OF status, tracking_visit_sid ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_session_source('table');
DROP TRIGGER IF EXISTS trg_stamp_guest_list_session_source ON public.guest_list_entries;
CREATE TRIGGER trg_stamp_guest_list_session_source BEFORE INSERT ON public.guest_list_entries
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sale_session_source('guest_list');

-- `link_sale_session` (pages de retour de paiement, commandes du bar
-- comprises) passe par la même porte : panier, paiement, achat, direct.
CREATE OR REPLACE FUNCTION public.link_sale_session(p_session_id text, p_kind text, p_sale_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sess record; v_event uuid; v_at timestamptz; v_src text; v_cur text;
BEGIN
  IF p_session_id IS NULL OR length(p_session_id) < 8 OR p_sale_id IS NULL THEN RETURN false; END IF;
  SELECT s.id, s.session_id, s.referrer_category, s.referrer_domain, s.utm_source, s.utm_medium, s.order_id
    INTO v_sess FROM public.visitor_sessions s WHERE s.session_id = p_session_id ORDER BY s.visited_at DESC LIMIT 1;
  IF v_sess.id IS NULL THEN RETURN false; END IF;

  IF p_kind = 'ticket' THEN
    SELECT t.event_id, coalesce(t.paid_at, t.created_at), t.attribution_source INTO v_event, v_at, v_cur FROM public.tickets t WHERE t.id = p_sale_id AND t.status IN ('paid', 'used');
  ELSIF p_kind = 'table' THEN
    SELECT r.event_id, coalesce(r.paid_at, r.created_at), r.attribution_source INTO v_event, v_at, v_cur FROM public.table_reservations r WHERE r.id = p_sale_id AND r.status IN ('paid', 'confirmed');
  ELSIF p_kind = 'order' THEN
    SELECT o.event_id, coalesce(o.paid_at, o.created_at), o.attribution_source INTO v_event, v_at, v_cur FROM public.orders o WHERE o.id = p_sale_id AND o.status IN ('paid', 'served');
  ELSE
    RETURN false;
  END IF;
  IF v_at IS NULL OR v_at < now() - interval '24 hours' THEN RETURN false; END IF;

  -- La visite porte la vente : panier, paiement, achat (et la commande du bar
  -- elle-même, seule vente que `order_id` sait désigner).
  PERFORM public._visit_mark_stage(p_session_id, v_event, 'paid', NULL,
                                   CASE WHEN p_kind = 'order' THEN p_sale_id END);

  -- La source de la visite complète une attribution « direct ».
  v_src := public.attribution_from_session(v_sess.referrer_category, v_sess.referrer_domain, v_sess.utm_source, v_sess.utm_medium);
  IF v_src IS NOT NULL AND v_src <> 'direct' AND coalesce(v_cur, 'direct') = 'direct' THEN
    IF p_kind = 'ticket' THEN
      UPDATE public.tickets SET attribution_source = v_src, attribution_ref = 'session' WHERE id = p_sale_id AND coalesce(attribution_source, 'direct') = 'direct';
    ELSIF p_kind = 'table' THEN
      UPDATE public.table_reservations SET attribution_source = v_src, attribution_ref = 'session' WHERE id = p_sale_id AND coalesce(attribution_source, 'direct') = 'direct';
    ELSE
      UPDATE public.orders SET attribution_source = v_src, attribution_ref = 'session' WHERE id = p_sale_id AND coalesce(attribution_source, 'direct') = 'direct';
    END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_sale_session(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_sale_session(text, text, uuid) TO anon, authenticated;

-- ── 7. Rattrapage (hors démo, depuis l'ouverture du tunnel par soirée) ───────
-- 7a. Les achats du tunnel. Chaque billet / table payé est relié à la session
--     du tunnel qui a validé ses coordonnées 0 à 5 secondes avant que la
--     vente soit créée (le navigateur écrit « details » puis appelle
--     create-*-checkout, qui crée la ligne ~1 s plus tard), SEULEMENT quand
--     une seule session est candidate. Répété sur Amoris : 37 billets sur 40
--     reliés, un seul candidat chacun, à 0,9-1,8 s. Les autres restent sans session.
--     `reason = 'backfill'` garde la trace du rattrapage.
WITH demo AS MATERIALIZED (SELECT public.demo_event_ids() AS de),
sales AS (
  SELECT 'ticket'::text AS kind, 'tickets'::text AS pillar, t.id, t.event_id, t.created_at,
         GREATEST(COALESCE(t.quantity, 1), 1) AS qty, round(COALESCE(t.total_price, 0) * 100)::integer AS cents
    FROM public.tickets t, demo d
   WHERE t.status IN ('paid', 'used') AND t.created_at >= '2026-09-30'
     AND NOT (t.event_id = ANY (d.de))
  UNION ALL
  SELECT 'table', 'tables', r.id, r.event_id, r.created_at,
         r.guest_count, round(COALESCE(r.total_price, 0) * 100)::integer
    FROM public.table_reservations r, demo d
   WHERE r.status IN ('paid', 'confirmed') AND r.created_at >= '2026-09-30'
     AND r.event_id IS NOT NULL AND NOT (r.event_id = ANY (d.de))
),
todo AS (
  SELECT s.* FROM sales s
   WHERE NOT EXISTS (SELECT 1 FROM public.event_funnel_events f
                      WHERE f.event_id = s.event_id AND f.step = 'purchased'
                        AND f.ref_id = s.kind || ':' || s.id::text)
),
cand AS (
  SELECT s.kind, s.pillar, s.id, s.event_id, s.qty, s.cents, f.session_id,
         count(*) OVER (PARTITION BY s.id) AS n
    FROM todo s
    JOIN public.event_funnel_events f
      ON f.event_id = s.event_id AND f.step = 'details' AND f.pillar = s.pillar
     AND f.created_at BETWEEN s.created_at - interval '5 seconds' AND s.created_at
),
one AS (
  SELECT c.* FROM cand c
   WHERE c.n = 1
     -- La session n'a pas déjà un achat écrit par le navigateur pour ce pilier.
     AND NOT EXISTS (SELECT 1 FROM public.event_funnel_events f
                      WHERE f.event_id = c.event_id AND f.session_id = c.session_id
                        AND f.step = 'purchased' AND f.pillar = c.pillar AND f.ref_id IS NULL)
)
INSERT INTO public.event_funnel_events
  (session_id, event_id, step, pillar, ref_id, quantity, amount_cents, reason, device, source, created_at)
SELECT o.session_id, o.event_id, 'purchased', o.pillar, o.kind || ':' || o.id::text, o.qty, o.cents, 'backfill',
       (SELECT (array_agg(f.device ORDER BY f.created_at DESC) FILTER (WHERE f.device IS NOT NULL))[1]
          FROM public.event_funnel_events f WHERE f.event_id = o.event_id AND f.session_id = o.session_id),
       (SELECT (array_agg(f.source ORDER BY f.created_at) FILTER (WHERE f.source IS NOT NULL))[1]
          FROM public.event_funnel_events f WHERE f.event_id = o.event_id AND f.session_id = o.session_id),
       COALESCE((SELECT COALESCE(t.paid_at, t.created_at) FROM public.tickets t WHERE o.kind = 'ticket' AND t.id = o.id),
                (SELECT COALESCE(r.paid_at, r.created_at) FROM public.table_reservations r WHERE o.kind = 'table' AND r.id = o.id),
                now())
  FROM one o;

-- 7b. Les étapes des visites. Une visite (`visitor_sessions`) et une session
--     du tunnel naissent au même chargement de la page de la soirée : même
--     soirée, même appareil, même source d'arrivée, à moins de 3 secondes.
--     Une paire n'est retenue que si chacune est la plus proche de l'autre
--     (1 pour 1). Deux visites simultanées au même appareil et à la même
--     source sont indiscernables pour toute répartition, donc les chiffres
--     (paniers, paiements, achats, par source, par appareil) restent justes.
CREATE TEMP TABLE _bf_visit_pairs ON COMMIT DROP AS
WITH demo AS MATERIALIZED (SELECT public.demo_event_ids() AS de),
fs AS (
  SELECT f.event_id, f.session_id,
         min(f.created_at) FILTER (WHERE f.step = 'viewed') AS viewed_at,
         (array_agg(f.device) FILTER (WHERE f.device IS NOT NULL))[1] AS device,
         (array_agg(f.source) FILTER (WHERE f.source IS NOT NULL))[1] AS source,
         max(CASE f.step WHEN 'selected' THEN 2 WHEN 'checkout' THEN 3 WHEN 'details' THEN 3
                         WHEN 'payment' THEN 3 WHEN 'purchased' THEN 4 ELSE 1 END) AS rk
    FROM public.event_funnel_events f, demo d
   WHERE f.created_at >= '2026-09-30' AND NOT (f.event_id = ANY (d.de))
   GROUP BY f.event_id, f.session_id
  HAVING min(f.created_at) FILTER (WHERE f.step = 'viewed') IS NOT NULL
),
vs AS (
  SELECT s.id, s.event_id, s.visited_at, s.device_type, COALESCE(NULLIF(s.referrer_category, ''), 'direct') AS source
    FROM public.visitor_sessions s, demo d
   WHERE s.event_id IS NOT NULL AND s.visited_at >= '2026-09-30' AND NOT (s.event_id = ANY (d.de))
),
m AS (
  SELECT fs.event_id, fs.session_id AS fsid, vs.id AS vid, fs.rk,
         abs(extract(epoch FROM fs.viewed_at - vs.visited_at)) AS adt
    FROM fs
    JOIN vs ON vs.event_id = fs.event_id
           AND vs.visited_at BETWEEN fs.viewed_at - interval '3 seconds' AND fs.viewed_at + interval '3 seconds'
           AND vs.device_type IS NOT DISTINCT FROM fs.device
           AND vs.source = COALESCE(fs.source, 'direct')
),
-- Toutes les visites candidates (pas seulement celles d'un panier) : la plus
-- proche de chaque visite doit être cette session-là.
allf AS (
  SELECT f.event_id, f.session_id, min(f.created_at) AS viewed_at,
         (array_agg(f.device) FILTER (WHERE f.device IS NOT NULL))[1] AS device,
         (array_agg(f.source) FILTER (WHERE f.source IS NOT NULL))[1] AS source
    FROM public.event_funnel_events f, demo d
   WHERE f.step = 'viewed' AND f.created_at >= '2026-09-30' AND NOT (f.event_id = ANY (d.de))
   GROUP BY f.event_id, f.session_id
),
vbest AS (
  SELECT DISTINCT ON (vs.id) vs.id AS vid, allf.session_id AS fsid
    FROM vs
    JOIN allf ON allf.event_id = vs.event_id
             AND vs.visited_at BETWEEN allf.viewed_at - interval '3 seconds' AND allf.viewed_at + interval '3 seconds'
             AND vs.device_type IS NOT DISTINCT FROM allf.device
             AND vs.source = COALESCE(allf.source, 'direct')
   ORDER BY vs.id, abs(extract(epoch FROM allf.viewed_at - vs.visited_at)), allf.session_id
),
fbest AS (
  SELECT DISTINCT ON (m.fsid, m.event_id) m.* FROM m ORDER BY m.fsid, m.event_id, m.adt, m.vid
),
pairs AS (
  SELECT fb.* FROM fbest fb JOIN vbest vb ON vb.vid = fb.vid AND vb.fsid = fb.fsid
)
SELECT p.event_id, p.fsid, p.vid, p.rk FROM pairs p;

UPDATE public.visitor_sessions s
   SET added_to_cart = true,
       proceeded_to_checkout = s.proceeded_to_checkout OR p.rk >= 3,
       completed_order = s.completed_order OR p.rk >= 4
  FROM _bf_visit_pairs p
 WHERE s.id = p.vid AND p.rk >= 2;

-- 7c. Les visites arrivées par un lien suivi (/l/<code>) étaient classées
--     « interne » : leur référent était la page /l/ elle-même. Le lien est
--     connu (référent = yunoapp.eu/l/<code>, alias des anciens codes compris) :
--     ses UTM et son canal reviennent sur la visite, avec la règle de
--     `categorizeReferrer` (src/lib/referrerCategory.ts). Et `fbclid` seul ne
--     fait plus une visite « publicité » : Instagram et Facebook l'ajoutent à
--     tout lien cliqué.
CREATE OR REPLACE FUNCTION public._visit_link_category(p_utm_source text, p_utm_medium text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN lower(coalesce(p_utm_medium, '')) = 'qr' THEN 'qr'
    WHEN lower(coalesce(p_utm_medium, '')) IN ('email', 'newsletter')
      OR lower(coalesce(p_utm_source, '')) IN ('newsletter', 'email', 'mail') THEN 'email'
    WHEN lower(coalesce(p_utm_source, '')) IN ('meta', 'meta_ads', 'facebook_ads')
      OR lower(coalesce(p_utm_medium, '')) = 'paid_social' THEN 'paid_social'
    WHEN lower(coalesce(p_utm_medium, '')) IN ('cpc', 'paid') THEN 'paid'
    WHEN lower(coalesce(p_utm_medium, '')) IN ('affiliate', 'promoter', 'partner_link', 'dj_link', 'party_link') THEN 'affiliate'
    WHEN lower(coalesce(p_utm_source, '')) IN ('instagram', 'tiktok', 'facebook', 'whatsapp', 'snapchat', 'twitter', 'x',
                                                'threads', 'youtube', 'linkedin') THEN 'social'
    ELSE 'direct'
  END
$function$;

REVOKE ALL ON FUNCTION public._visit_link_category(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._visit_link_category(text, text) TO service_role;

WITH l AS (
  SELECT s.id, tl.utm_source AS us, tl.utm_medium AS um, tl.utm_campaign AS uc
    FROM public.visitor_sessions s
    CROSS JOIN LATERAL (SELECT substring(s.referrer FROM '/l/([A-Za-z0-9_-]+)') AS code) c
    JOIN public.tracked_links tl ON tl.id = public.tracked_link_id_for_code(c.code)
   WHERE s.referrer ~* '^https?://(www\.)?yunoapp\.eu/l/'
     AND s.utm_source IS NULL
)
UPDATE public.visitor_sessions s
   SET utm_source = l.us,
       utm_medium = l.um,
       utm_campaign = COALESCE(s.utm_campaign, l.uc),
       referrer_category = public._visit_link_category(l.us, l.um)
  FROM l
 WHERE s.id = l.id;

UPDATE public.visitor_sessions s
   SET referrer_category = 'social'
 WHERE s.referrer_category = 'paid_social'
   AND lower(coalesce(s.utm_source, '')) NOT IN ('meta', 'meta_ads', 'facebook_ads')
   AND lower(coalesce(s.utm_medium, '')) <> 'paid_social'
   AND s.gclid IS NULL;

-- 7d. Les sessions du tunnel reliées à une visite (7b) prennent sa source
--     corrigée (même règle, même instant d'arrivée).
UPDATE public.event_funnel_events f
   SET source = v.referrer_category
  FROM _bf_visit_pairs p
  JOIN public.visitor_sessions v ON v.id = p.vid
 WHERE f.event_id = p.event_id AND f.session_id = p.fsid
   AND f.source IN ('internal', 'paid_social')
   AND v.referrer_category IN ('direct', 'social', 'search', 'email', 'qr', 'paid_search',
                               'paid_social', 'paid', 'affiliate', 'internal', 'referral')
   AND f.source IS DISTINCT FROM v.referrer_category;

-- ── 8. Le clic sur un lien suivi rend aussi ses UTM ──────────────────────────
-- La page /l/ les ajoute à l'URL de la soirée : la visite porte le canal du
-- lien (Instagram, newsletter, partenaire…) au lieu de « interne ». Corps
-- repris de la définition en base (20261103100000), trois clés en plus.
CREATE OR REPLACE FUNCTION public.record_tracked_link_click(p_code text, p_visitor_id text DEFAULT NULL::text, p_device_type text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link        public.tracked_links%ROWTYPE;
  v_event_venue text;
  v_org_slug    text;
  v_promo_code  text;
  v_gl_token    text;
  v_gl_event    uuid;
  v_path_event  uuid;
  v_event_host  text;
  v_event_slug  text;
  v_ctx         record;
  v_key         text;
  v_country     text;
  v_ua          text;
  v_count       boolean := true;
  v_flood       integer;
BEGIN
  SELECT * INTO v_link FROM public.tracked_links
   WHERE id = public.tracked_link_id_for_code(p_code) AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- ── Mesure : jamais bloquante ────────────────────────────────────────────
  BEGIN
    v_ua := left(COALESCE(p_user_agent, ''), 400);

    -- Robots d'aperçu (messageries, réseaux sociaux, moteurs) et outils headless.
    IF v_ua ~* '(bot\M|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|linkedinbot|discord|slack|skype|embedly|pinterest|snapchat|google-?other|lighthouse|headless|curl/|wget/|python-requests|okhttp|axios|node-fetch|go-http-client)' THEN
      v_count := false;
    END IF;

    -- L'équipe Yuno qui teste ses propres liens ne gonfle pas les chiffres.
    IF v_count AND auth.uid() IS NOT NULL AND public.is_super_admin() THEN
      v_count := false;
    END IF;

    IF v_count THEN
      IF NULLIF(btrim(COALESCE(p_visitor_id, '')), '') IS NOT NULL THEN
        v_key := 'c:' || left(btrim(p_visitor_id), 80);
      ELSE
        SELECT * INTO v_ctx FROM public.links_visitor_context();
        v_key := v_ctx.o_hash;
        v_country := v_ctx.o_country;
      END IF;

      SELECT count(*) INTO v_flood FROM public.tracked_link_clicks
       WHERE tracked_link_id = v_link.id AND visitor_id = v_key
         AND clicked_at > now() - interval '1 hour';

      IF v_flood < 30 AND NOT EXISTS (
        SELECT 1 FROM public.tracked_link_clicks
         WHERE tracked_link_id = v_link.id AND visitor_id = v_key
           AND clicked_at > now() - interval '30 minutes'
      ) THEN
        INSERT INTO public.tracked_link_clicks (tracked_link_id, ip_hash, user_agent, referrer, visitor_id, device_type, country)
        VALUES (v_link.id, p_ip_hash, NULLIF(v_ua, ''), left(p_referrer, 200), v_key, p_device_type,
                v_country);
        UPDATE public.tracked_links SET clicks_count = clicks_count + 1 WHERE id = v_link.id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'record_tracked_link_click: %', SQLERRM;
  END;

  -- ── Résolution de la cible (inchangée) ───────────────────────────────────
  IF v_link.target_kind = 'event' THEN
    SELECT venue_id INTO v_event_venue FROM public.events WHERE id = v_link.event_id;
  END IF;
  IF v_link.target_kind = 'organizer' THEN
    SELECT slug INTO v_org_slug FROM public.organizer_profiles WHERE user_id = v_link.organizer_user_id;
  END IF;
  IF v_link.target_kind = 'guestlist' THEN
    SELECT gl.share_token, gl.event_id INTO v_gl_token, v_gl_event
    FROM public.guest_lists gl
    WHERE gl.id = v_link.guest_list_id AND gl.is_active = true;
    IF v_gl_event IS NOT NULL THEN
      SELECT COALESCE(e.venue_id, e.partner_venue_id) INTO v_event_venue
      FROM public.events e WHERE e.id = v_gl_event;
    END IF;
  END IF;
  IF v_link.owner_kind = 'promoter' THEN
    SELECT promo_code INTO v_promo_code FROM public.promoters WHERE id = v_link.promoter_id;
  END IF;

  v_path_event := COALESCE(v_gl_event, v_link.event_id);
  IF v_path_event IS NOT NULL THEN
    SELECT NULLIF(btrim(e.slug), '') INTO v_event_slug FROM public.events e WHERE e.id = v_path_event;
    IF v_event_slug IS NOT NULL THEN
      SELECT NULLIF(btrim(public.event_host_slug(v_path_event)), '') INTO v_event_host;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found',              true,
    'tracked_link_id',    v_link.id,
    'target_kind',        v_link.target_kind,
    'event_id',           v_link.event_id,
    'event_venue_id',     v_event_venue,
    'target_venue_id',    v_link.target_venue_id,
    'organizer_slug',     v_org_slug,
    'promo_code',         v_promo_code,
    'guest_list_token',   v_gl_token,
    'guest_list_event_id', v_gl_event,
    'event_host',         v_event_host,
    'event_slug',         v_event_slug,
    'utm_source',         v_link.utm_source,
    'utm_medium',         v_link.utm_medium,
    'utm_campaign',       v_link.utm_campaign
  );
END; $function$;

REVOKE ALL ON FUNCTION public.record_tracked_link_click(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tracked_link_click(text, text, text, text, text, text) TO anon, authenticated;
