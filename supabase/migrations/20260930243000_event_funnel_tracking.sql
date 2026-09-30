-- Analyse PAR SOIRÉE — Trafic et Communauté (suite du lot E, 30/09).
--
-- Ce fichier pose les deux fondations communes :
--   1. le suivi du tunnel d'achat d'UNE soirée (`event_funnel_events`) : vue de
--      la page, choix d'un billet / d'une formule, entrée au paiement,
--      coordonnées validées, achat, échec (avec son motif), liste d'attente,
--      partage, abonnement. Avant, aucune étape n'était mesurée en base : le
--      pro savait combien de personnes avaient VU la soirée, jamais OÙ elles
--      lâchaient.
--   2. la porte d'accès unique des analyses par soirée (`event_analytics_scope`),
--      qui reprend à l'identique la portée + le droit de voir l'argent du
--      Rapport de soirée (`get_event_report`) : club hôte, club co-hôte,
--      organisateur, équipe d'orga, co-hôte accepté, super admin.
--
-- Consentement : le front n'écrit ici QUE si la mesure d'audience est acceptée
-- (même porte que `visitor_sessions`), jamais sur une surface pro, jamais en
-- session d'accès assisté. Aucune donnée personnelle : un identifiant de
-- session aléatoire par onglet, l'appareil, et les identifiants de ligne
-- (palier, formule) — ni email, ni nom, ni IP.

-- ─── 1. Le journal du tunnel ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_funnel_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id   text        NOT NULL,
  event_id     uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  step         text        NOT NULL,
  pillar       text,
  ref_id       text,
  quantity     integer,
  amount_cents integer,
  reason       text,
  device       text,
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_funnel_step_chk CHECK (step IN (
    'viewed', 'selected', 'checkout', 'details', 'payment', 'purchased',
    'failed', 'waitlist', 'shared', 'followed'
  )),
  CONSTRAINT event_funnel_pillar_chk CHECK (pillar IS NULL OR pillar IN ('tickets', 'tables', 'guest_list'))
);

-- Posée après coup sur une base qui aurait déjà la table (rejeu idempotent).
ALTER TABLE public.event_funnel_events ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_event_funnel_event_ts ON public.event_funnel_events (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_funnel_session ON public.event_funnel_events (event_id, session_id);

-- Table interne : RLS sans policy. On n'y écrit que par `track_event_funnel`,
-- on n'y lit que par les RPC d'analyse (SECURITY DEFINER).
ALTER TABLE public.event_funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_funnel_events FROM PUBLIC, anon, authenticated;

-- ─── 2. L'écriture : bornée, dédoublonnée, sans confiance dans le client ─────
-- La source d'arrivée (`referrer_category` : direct, social, search, email, qr…)
-- est posée PAR LE NAVIGATEUR à la première étape de l'onglet, avec la même
-- règle que `visitor_sessions` : c'est ce qui relie une vente à sa source sans
-- avoir à aligner deux identifiants de session.
DROP FUNCTION IF EXISTS public.track_event_funnel(text, uuid, text, text, text, integer, integer, text, text);
CREATE OR REPLACE FUNCTION public.track_event_funnel(
  p_session_id   text,
  p_event_id     uuid,
  p_step         text,
  p_pillar       text    DEFAULT NULL,
  p_ref          text    DEFAULT NULL,
  p_quantity     integer DEFAULT NULL,
  p_amount_cents integer DEFAULT NULL,
  p_reason       text    DEFAULT NULL,
  p_device       text    DEFAULT NULL,
  p_source       text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sid    text := left(btrim(COALESCE(p_session_id, '')), 80);
  v_pillar text := CASE WHEN p_pillar IN ('tickets', 'tables', 'guest_list') THEN p_pillar END;
  v_device text := CASE WHEN p_device IN ('mobile', 'tablet', 'desktop') THEN p_device END;
  v_source text := CASE WHEN p_source IN ('direct', 'social', 'search', 'email', 'qr', 'paid_search',
                                          'paid_social', 'paid', 'affiliate', 'internal', 'referral') THEN p_source END;
BEGIN
  IF v_sid = '' OR p_event_id IS NULL THEN RETURN; END IF;
  IF p_step IS NULL OR p_step NOT IN ('viewed', 'selected', 'checkout', 'details', 'payment',
                                      'purchased', 'failed', 'waitlist', 'shared', 'followed') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN RETURN; END IF;

  -- Anti-flood : 80 lignes par session et par soirée et par heure.
  IF (SELECT count(*) FROM public.event_funnel_events f
       WHERE f.event_id = p_event_id AND f.session_id = v_sid
         AND f.created_at > now() - interval '1 hour') >= 80 THEN
    RETURN;
  END IF;

  -- Une étape « de passage » ne se répète pas : un rechargement de page ne
  -- gonfle ni la vue ni l'entrée au paiement. Un choix se répète seulement
  -- s'il change (autre palier / formule) ou après 2 minutes.
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
$$;

REVOKE ALL ON FUNCTION public.track_event_funnel(text, uuid, text, text, text, integer, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_event_funnel(text, uuid, text, text, text, integer, integer, text, text, text) TO anon, authenticated;

-- ─── 3. Rétention : 13 mois, comme le reste de la mesure ─────────────────────
CREATE OR REPLACE FUNCTION public.event_funnel_housekeeping()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.event_funnel_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.event_funnel_housekeeping() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_funnel_housekeeping() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('event-funnel-housekeeping')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'event-funnel-housekeeping');
  PERFORM cron.schedule('event-funnel-housekeeping', '12 4 * * *', 'SELECT public.event_funnel_housekeeping();');
EXCEPTION WHEN undefined_table OR invalid_schema_name THEN
  RAISE NOTICE 'pg_cron absent : purge du tunnel à planifier à la main';
END $$;

-- ─── 4. La porte d'accès des analyses par soirée ─────────────────────────────
-- Reprise mot pour mot de la portée + du droit « argent » de `get_event_report`
-- (migration 20260929290000) : une seule lecture de « qui a le droit de voir
-- cette soirée », partagée par le Trafic et la Communauté. `money` = peut voir
-- les montants ; `scope_ids` = les soirées de la portée (pour « déjà venu »).
CREATE OR REPLACE FUNCTION public.event_analytics_scope(p_event_id uuid)
RETURNS TABLE (ok boolean, reason text, scope_venue text, scope_org uuid, money boolean, scope_ids uuid[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  e       record;
  v_venue text := null;
  v_org   uuid := null;
  v_money boolean := false;
  v_ids   uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'not_authenticated'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;
  SELECT ev.* INTO e FROM public.events ev WHERE ev.id = p_event_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;

  IF e.venue_id IS NOT NULL AND (public.can_manage_venue(v_uid, e.venue_id) OR public.is_super_admin()) THEN
    v_venue := e.venue_id;
  ELSIF e.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, e.partner_venue_id) THEN
    v_venue := e.partner_venue_id;
  ELSIF e.organizer_user_id IS NOT NULL AND (
          v_uid = e.organizer_user_id
          OR public.is_super_admin()
          OR public.is_org_team_member(v_uid, e.organizer_user_id, 'editor')) THEN
    v_org := e.organizer_user_id;
  ELSIF e.partner_organizer_id IS NOT NULL AND (
          v_uid = e.partner_organizer_id
          OR public.is_org_team_member(v_uid, e.partner_organizer_id, 'editor')) THEN
    v_org := e.partner_organizer_id;
  ELSIF EXISTS (SELECT 1 FROM public.event_cohosts c
                 WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.organizer_user_id IS NOT NULL
                   AND (c.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))) THEN
    SELECT c.organizer_user_id INTO v_org FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.organizer_user_id IS NOT NULL
       AND (c.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, c.organizer_user_id, 'editor'))
     ORDER BY (c.organizer_user_id = v_uid) DESC LIMIT 1;
  ELSIF EXISTS (SELECT 1 FROM public.event_cohosts c
                 WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.venue_id IS NOT NULL
                   AND public.can_manage_venue(v_uid, c.venue_id)) THEN
    SELECT c.venue_id INTO v_venue FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted' AND c.venue_id IS NOT NULL
       AND public.can_manage_venue(v_uid, c.venue_id)
     LIMIT 1;
  ELSE
    RETURN QUERY SELECT false, 'forbidden'::text, null::text, null::uuid, false, '{}'::uuid[]; RETURN;
  END IF;

  IF v_venue IS NOT NULL THEN
    v_money := (coalesce(v_venue = e.venue_id, false)
                OR public.coorg_cohost_sees_money(p_event_id, 'venue:' || v_venue)) AND (
      public.is_super_admin()
      OR EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_venue AND v.owner_id = v_uid)
      OR EXISTS (
        SELECT 1 FROM public.manager_permissions mp
         WHERE mp.user_id = v_uid AND mp.venue_id = v_venue
           AND (coalesce(mp.can_view_analytics, false) OR coalesce(mp.can_view_finance, false))
      ));
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids
      FROM public.events x
     WHERE x.venue_id = v_venue OR x.partner_venue_id = v_venue
        OR x.id IN (SELECT public.cohost_event_ids_venue(v_venue));
  ELSE
    v_money := (v_uid = v_org
      OR public.is_super_admin()
      OR public.org_member_has_permission(v_uid, v_org, 'view_finance'))
      AND (public.is_super_admin() OR public.coorg_sees_event_money(p_event_id, 'org:' || v_org::text));
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids
      FROM public.events x
     WHERE x.organizer_user_id = v_org OR x.partner_organizer_id = v_org
        OR x.id IN (SELECT public.cohost_event_ids_org(v_org));
  END IF;

  RETURN QUERY SELECT true, null::text, v_venue, v_org, v_money, v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.event_analytics_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_analytics_scope(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
