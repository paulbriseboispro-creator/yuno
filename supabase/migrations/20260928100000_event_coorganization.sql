-- ════════════════════════════════════════════════════════════════════════════
-- Co-organisation — N parties sur une soirée (organisateurs ET clubs)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Le collab contractuel existant reste ce qu'il est : UN club + UN organisateur,
-- partage Stripe automatique au moment de la vente (2 jambes, jamais plus —
-- revenue_distributions n'en porte que deux, payment-split.ts aussi).
--
-- La co-organisation ajoute une couche au-dessus, ouverte à N parties :
--   * des CO-HÔTES (organisateurs ou clubs) invités sur n'importe quelle
--     soirée — solo club, solo orga ou co-soirée — qui acceptent ;
--   * accès partagé à la soirée dans leur Console (lecture, ou édition) ;
--   * CRM partagé : les acheteurs qui ont coché la case (qui NOMME tous les
--     hôtes) entrent dans le registre de consentement de chaque hôte ;
--   * annonce de la soirée aux bases de chaque hôte (email « nouvelle soirée »,
--     « dernier appel », push de lancement aux abonnés de tous les hôtes) ;
--   * ARGENT : un seul encaisseur (celui d'aujourd'hui, rien ne change au
--     checkout). Le partage entre N parties ne passe JAMAIS par Stripe : il
--     passe par un DÉCOMPTE Yuno (revenus Yuno + déclarés, frais partagés,
--     parts) validé par TOUTES les parties, puis par des VIREMENTS déclarés
--     par le payeur et confirmés par le bénéficiaire. Yuno trace, ne touche
--     pas aux fonds.
--   * l'ACCORD (parts, règle des frais, clauses) est optionnel. Sans accord :
--     dashboards connectés, CRM partagé, pas de décompte. Avec accord : chaque
--     partie l'accepte (simple accord) ou le signe (contrat, IP + navigateur +
--     horodatage), et le décompte devient possible après la soirée.
--
-- Une partie = une clé texte : 'venue:<id>' ou 'org:<uuid>'.
-- Parties « principales » = celles des colonnes de l'événement (venue_id,
-- organizer_user_id, partner_venue_id, partner_organizer_id) ; parties
-- « co-hôtes » = event_cohosts acceptés.

-- ─── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_cohosts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  access            text NOT NULL DEFAULT 'editor' CHECK (access IN ('editor', 'viewer')),
  share_crm         boolean NOT NULL DEFAULT true,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined', 'removed', 'left')),
  message           text,
  invited_by        uuid,
  invited_by_party  text,
  invited_at        timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz,
  responded_by      uuid,
  ended_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_cohosts_one_party CHECK ((organizer_user_id IS NULL) <> (venue_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS event_cohosts_live_org_idx
  ON public.event_cohosts (event_id, organizer_user_id)
  WHERE organizer_user_id IS NOT NULL AND status IN ('pending', 'accepted');
CREATE UNIQUE INDEX IF NOT EXISTS event_cohosts_live_venue_idx
  ON public.event_cohosts (event_id, venue_id)
  WHERE venue_id IS NOT NULL AND status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS event_cohosts_org_accepted_idx
  ON public.event_cohosts (organizer_user_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS event_cohosts_venue_accepted_idx
  ON public.event_cohosts (venue_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS event_cohosts_event_idx ON public.event_cohosts (event_id);

-- L'accord de co-organisation : parts, règle des frais, clauses, signatures.
CREATE TABLE IF NOT EXISTS public.event_coorg_deals (
  event_id       uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  shares         jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {party_key: pct}
  formal         boolean NOT NULL DEFAULT false,            -- true = contrat signé, false = simple accord
  clauses        text,
  terms_version  text NOT NULL DEFAULT '2026-09-28',
  version        integer NOT NULL DEFAULT 1,
  signatures     jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {party_key: {at, by, ip, ua, version}}
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled')),
  activated_at   timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Lignes DÉCLARÉES du décompte (les ventes Yuno, elles, se calculent en direct).
CREATE TABLE IF NOT EXISTS public.event_coorg_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('revenue', 'expense')),
  party_key   text NOT NULL,              -- qui a encaissé (revenu) / qui a payé (frais)
  category    text NOT NULL DEFAULT 'other',
  label       text NOT NULL,
  amount      numeric(12, 2) NOT NULL CHECK (amount > 0),
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  voided_by   uuid
);
CREATE INDEX IF NOT EXISTS event_coorg_ledger_event_idx ON public.event_coorg_ledger (event_id) WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS public.event_coorg_settlements (
  event_id     uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'settled')),
  version      integer NOT NULL DEFAULT 1,
  approvals    jsonb NOT NULL DEFAULT '{}'::jsonb,         -- {party_key: {at, by, version}}
  snapshot     jsonb,
  approved_at  timestamptz,
  settled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_coorg_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  from_party      text NOT NULL,
  to_party        text NOT NULL,
  amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
  reference       text NOT NULL,
  payee_iban      text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'received', 'disputed')),
  sent_at         timestamptz,
  sent_by         uuid,
  sent_reference  text,
  received_at     timestamptz,
  received_by     uuid,
  disputed_at     timestamptz,
  dispute_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_coorg_transfers_event_idx ON public.event_coorg_transfers (event_id);

-- RLS totale : aucune policy d'écriture, tout passe par les RPC ci-dessous.
ALTER TABLE public.event_cohosts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_coorg_deals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_coorg_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_coorg_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_coorg_transfers   ENABLE ROW LEVEL SECURITY;

-- ─── 2. Parties et droits ────────────────────────────────────────────────────

-- Niveau d'une personne pour une partie : 0 aucun, 1 lecture, 2 gestion,
-- 3 gestion + argent. Fondateur / admin d'équipe côté orga ; propriétaire /
-- manager côté club.
CREATE OR REPLACE FUNCTION public.coorg_party_level(p_uid uuid, p_party text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind text := split_part(p_party, ':', 1);
  v_id   text := substr(p_party, length(split_part(p_party, ':', 1)) + 2);
  v_org  uuid;
BEGIN
  IF p_uid IS NULL OR p_party IS NULL OR v_id = '' THEN RETURN 0; END IF;
  IF v_kind = 'org' THEN
    BEGIN v_org := v_id::uuid; EXCEPTION WHEN others THEN RETURN 0; END;
    IF p_uid = v_org OR public.is_org_team_member(p_uid, v_org, 'admin') THEN RETURN 3; END IF;
    IF public.is_org_team_member(p_uid, v_org, 'editor') THEN RETURN 1; END IF;
    RETURN 0;
  ELSIF v_kind = 'venue' THEN
    IF EXISTS (SELECT 1 FROM public.venues v WHERE v.id = v_id AND v.owner_id = p_uid) THEN RETURN 3; END IF;
    IF EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = p_uid AND mp.venue_id = v_id AND COALESCE(mp.can_view_finance, false)) THEN
      RETURN 3;
    END IF;
    IF EXISTS (SELECT 1 FROM public.manager_permissions mp
                WHERE mp.user_id = p_uid AND mp.venue_id = v_id AND COALESCE(mp.can_manage_events, false)) THEN
      RETURN 2;
    END IF;
    IF public.can_manage_venue(p_uid, v_id) THEN RETURN 1; END IF;
    RETURN 0;
  END IF;
  RETURN 0;
END;
$$;

-- Toutes les parties d'une soirée, principales d'abord. Nom public résolu.
CREATE OR REPLACE FUNCTION public.event_parties(p_event_id uuid)
RETURNS TABLE (
  party_key text, kind text, venue_id text, organizer_user_id uuid,
  role text, access text, share_crm boolean, cohost_id uuid,
  display_name text, slug text, avatar_url text, city text, ord integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH e AS (SELECT * FROM public.events WHERE id = p_event_id),
  raw AS (
    SELECT 'venue:' || e.venue_id AS party_key, 'venue'::text AS kind, e.venue_id AS venue_id,
           NULL::uuid AS organizer_user_id, 'lead'::text AS role, 'owner'::text AS access,
           true AS share_crm, NULL::uuid AS cohost_id, 1 AS ord
      FROM e WHERE e.venue_id IS NOT NULL
    UNION ALL
    SELECT 'org:' || e.organizer_user_id, 'org', NULL, e.organizer_user_id,
           CASE WHEN e.venue_id IS NULL THEN 'lead' ELSE 'partner' END, 'owner', true, NULL,
           CASE WHEN e.venue_id IS NULL THEN 1 ELSE 2 END
      FROM e WHERE e.organizer_user_id IS NOT NULL
    UNION ALL
    SELECT 'venue:' || e.partner_venue_id, 'venue', e.partner_venue_id, NULL, 'partner', 'owner', true, NULL, 2
      FROM e WHERE e.partner_venue_id IS NOT NULL
    UNION ALL
    SELECT 'org:' || e.partner_organizer_id, 'org', NULL, e.partner_organizer_id, 'partner', 'owner', true, NULL, 2
      FROM e WHERE e.partner_organizer_id IS NOT NULL
    UNION ALL
    SELECT CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END,
           CASE WHEN c.venue_id IS NOT NULL THEN 'venue' ELSE 'org' END,
           c.venue_id, c.organizer_user_id, 'cohost', c.access, c.share_crm, c.id, 3
      FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted'
  ),
  dedup AS (
    SELECT DISTINCT ON (party_key) * FROM raw ORDER BY party_key, ord
  )
  SELECT d.party_key, d.kind, d.venue_id, d.organizer_user_id, d.role, d.access, d.share_crm, d.cohost_id,
         COALESCE(v.name, op.display_name, pr.organization_name, 'Organisateur') AS display_name,
         COALESCE(v.slug, op.slug) AS slug,
         COALESCE(v.logo_url, op.avatar_url, pr.organization_logo_url) AS avatar_url,
         COALESCE(v.city, op.city) AS city,
         d.ord
    FROM dedup d
    LEFT JOIN public.venues v ON v.id = d.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = d.organizer_user_id
    LEFT JOIN public.profiles pr ON pr.id = d.organizer_user_id
   ORDER BY d.ord, d.party_key;
$$;

-- L'encaisseur par défaut d'une vente de billet / table : le club qui porte la
-- soirée, sinon l'organisateur (même règle que create-ticket-checkout).
CREATE OR REPLACE FUNCTION public.event_merchant_party(p_event_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN e.venue_id IS NOT NULL THEN 'venue:' || e.venue_id
              WHEN e.organizer_user_id IS NOT NULL THEN 'org:' || e.organizer_user_id
              WHEN e.partner_venue_id IS NOT NULL THEN 'venue:' || e.partner_venue_id
              ELSE 'org:' || e.partner_organizer_id END
    FROM public.events e WHERE e.id = p_event_id;
$$;

-- Meilleure partie que l'appelant représente sur cette soirée (principale
-- d'abord), avec son niveau.
CREATE OR REPLACE FUNCTION public.my_event_party(p_event_id uuid)
RETURNS TABLE (party_key text, role text, access text, level integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.party_key, p.role, p.access, public.coorg_party_level(auth.uid(), p.party_key)
    FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(auth.uid(), p.party_key) > 0
   ORDER BY p.ord, public.coorg_party_level(auth.uid(), p.party_key) DESC
   LIMIT 1;
$$;

-- Soirées dont l'appelant est CO-HÔTE (accepté), au niveau demandé.
-- Forme ensembliste non corrélée : évaluée une fois par requête dans une policy.
CREATE OR REPLACE FUNCTION public.my_cohost_event_ids(p_min text DEFAULT 'viewer')
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.event_id
    FROM public.event_cohosts c
   WHERE c.status = 'accepted'
     AND (p_min = 'viewer' OR c.access = 'editor')
     AND auth.uid() IS NOT NULL
     AND (
       (c.organizer_user_id IS NOT NULL
        AND (c.organizer_user_id = auth.uid()
             OR public.is_org_team_member(auth.uid(), c.organizer_user_id, 'editor')))
       OR (c.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), c.venue_id))
     );
$$;

CREATE OR REPLACE FUNCTION public.is_event_cohost(p_event_id uuid, p_uid uuid, p_min text DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_cohosts c
     WHERE c.event_id = p_event_id AND c.status = 'accepted'
       AND (p_min = 'viewer' OR c.access = 'editor')
       AND p_uid IS NOT NULL
       AND (
         (c.organizer_user_id IS NOT NULL
          AND (c.organizer_user_id = p_uid OR public.is_org_team_member(p_uid, c.organizer_user_id, 'editor')))
         OR (c.venue_id IS NOT NULL AND public.can_manage_venue(p_uid, c.venue_id))
       )
  );
$$;

-- Soirées co-hébergées par une portée (utilisé par les RPC d'analyse / CRM).
CREATE OR REPLACE FUNCTION public.cohost_event_ids_org(p_org uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.event_id FROM public.event_cohosts c
   WHERE c.organizer_user_id = p_org AND c.status = 'accepted';
$$;

CREATE OR REPLACE FUNCTION public.cohost_event_ids_venue(p_venue text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.event_id FROM public.event_cohosts c
   WHERE c.venue_id = p_venue AND c.status = 'accepted';
$$;

-- Champs calculés PostgREST (filtrables : `cohost_org_ids=cs.{uuid}`) : c'est
-- ce qui permet aux listes de la Console d'inclure les soirées co-hébergées
-- sans une requête de plus. Information publique (affichée « Présenté par »).
CREATE OR REPLACE FUNCTION public.cohost_org_ids(public.events)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.organizer_user_id), '{}'::uuid[])
    FROM public.event_cohosts c
   WHERE c.event_id = $1.id AND c.status = 'accepted' AND c.organizer_user_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.cohost_venue_ids(public.events)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.venue_id), '{}'::text[])
    FROM public.event_cohosts c
   WHERE c.event_id = $1.id AND c.status = 'accepted' AND c.venue_id IS NOT NULL;
$$;

-- Portée marketing élargie : soirées où la portée est PARTENAIRE ou CO-HÔTE qui
-- partage son CRM. Utilisé par les recettes « nouvelle soirée » et « dernier
-- appel » : chaque hôte annonce la soirée à SA base (la règle R5 « une soirée,
-- un message » dédoublonne la personne présente dans plusieurs bases).
CREATE OR REPLACE FUNCTION public.coorg_marketing_event_ids(p_venue text, p_org uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id FROM public.events e
   WHERE (p_venue IS NOT NULL AND e.partner_venue_id = p_venue)
      OR (p_org IS NOT NULL AND e.partner_organizer_id = p_org)
  UNION
  SELECT c.event_id FROM public.event_cohosts c
   WHERE c.status = 'accepted' AND c.share_crm
     AND ((p_venue IS NOT NULL AND c.venue_id = p_venue)
       OR (p_org IS NOT NULL AND c.organizer_user_id = p_org));
$$;

-- Notification à une partie (orga → organizer_notifications, club → staff owner).
-- Une alerte ne fait jamais échouer l'action qu'elle raconte.
CREATE OR REPLACE FUNCTION public.notify_coorg_party(
  p_party text, p_event_id uuid, p_type text, p_title text, p_message text,
  p_ref uuid DEFAULT NULL, p_dedup text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kind text := split_part(p_party, ':', 1);
  v_id   text := substr(p_party, length(split_part(p_party, ':', 1)) + 2);
BEGIN
  IF v_kind = 'org' THEN
    PERFORM public.emit_organizer_notification(v_id::uuid, p_type, p_title, p_message, 'normal',
      'event_coorg', p_ref, p_event_id, COALESCE(p_meta, '{}'::jsonb), p_dedup);
  ELSIF v_kind = 'venue' THEN
    PERFORM public.emit_staff_notification(v_id, 'owner', p_type, p_title, p_message, 'normal',
      'event_coorg', p_ref, p_event_id, COALESCE(p_meta, '{}'::jsonb), p_dedup);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_coorg_party: %', SQLERRM;
END;
$$;

-- ─── 3. Lecture (RLS) : l'appelant voit les lignes de SES soirées ───────────

CREATE POLICY "Parties read event cohosts" ON public.event_cohosts
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.coorg_party_level(auth.uid(),
         CASE WHEN venue_id IS NOT NULL THEN 'venue:' || venue_id ELSE 'org:' || organizer_user_id END) > 0
    OR EXISTS (SELECT 1 FROM public.my_event_party(event_cohosts.event_id))
  );

-- ─── 4. Accès co-hôte aux données de la soirée ───────────────────────────────

CREATE POLICY "Cohosts view co-organized events" ON public.events
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_cohost_event_ids('viewer')));

CREATE POLICY "Cohost editors update co-organized events" ON public.events
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.my_cohost_event_ids('editor')))
  WITH CHECK (id IN (SELECT public.my_cohost_event_ids('editor')));

CREATE POLICY "Cohosts view co-organized tickets" ON public.tickets
  FOR SELECT TO authenticated
  USING (event_id IN (SELECT public.my_cohost_event_ids('viewer')));

CREATE POLICY "Cohosts view co-organized reservations" ON public.table_reservations
  FOR SELECT TO authenticated
  USING (event_id IN (SELECT public.my_cohost_event_ids('viewer')));

CREATE POLICY "Cohosts view co-organized guest lists" ON public.guest_lists
  FOR SELECT TO authenticated
  USING (event_id IN (SELECT public.my_cohost_event_ids('viewer')));

CREATE POLICY "Cohosts view co-organized guest entries" ON public.guest_list_entries
  FOR SELECT TO authenticated
  USING (guest_list_id IN (
    SELECT gl.id FROM public.guest_lists gl
     WHERE gl.event_id IN (SELECT public.my_cohost_event_ids('viewer'))));

-- Un co-hôte ÉDITEUR habille la soirée et gère ses ventes au quotidien, mais
-- ne touche JAMAIS à la structure (parties, argent, partage, mode, cycle de
-- vie, visibilité) : ça reste aux parties principales.
-- SECURITY INVOKER, et c'est vital : le garde discrimine sur current_user.
-- En DEFINER il tournerait sous son propriétaire, ne verrait jamais
-- 'authenticated' et laisserait tout passer (vérifié : un co-hôte s'était
-- approprié la soirée dans le premier smoke test).
CREATE OR REPLACE FUNCTION public.protect_event_columns_from_cohost()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed text[] := ARRAY[
    -- design
    'title', 'description', 'poster_url', 'image_url', 'poster_position', 'banner_position',
    'music_genre', 'music_genres', 'video_url', 'location_logo_url', 'event_type',
    -- ventes au quotidien
    'tickets_sold_out', 'tables_sold_out', 'guest_list_sold_out', 'sold_out_pack_ids',
    'entry_target', 'max_tickets_per_person', 'rounds_visibility', 'waitlist_enabled',
    'presale_start_at', 'public_sale_start_at',
    -- posés par d'autres triggers
    'updated_at', 'slug', 'search_title', 'is_discoverable', 'discovery_status', 'published_at',
    'alcohol_free', 'event_mode'
  ];
BEGIN
  IF current_user <> 'authenticated' OR v_uid IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  -- Partie principale ? Ses règles (domaines du collab) s'appliquent ailleurs.
  IF (OLD.organizer_user_id IS NOT NULL
        AND (OLD.organizer_user_id = v_uid OR public.is_org_team_member(v_uid, OLD.organizer_user_id, 'editor')))
     OR (OLD.partner_organizer_id IS NOT NULL
        AND (OLD.partner_organizer_id = v_uid OR public.is_org_team_member(v_uid, OLD.partner_organizer_id, 'editor')))
     OR (OLD.venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.venue_id))
     OR (OLD.partner_venue_id IS NOT NULL AND public.can_manage_venue(v_uid, OLD.partner_venue_id))
     OR OLD.tables_owner_user_id = v_uid
  THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_event_cohost(OLD.id, v_uid, 'editor') THEN
    RETURN NEW; -- aucune policy ne l'aura laissé passer de toute façon
  END IF;
  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION 'cohost_structural_change'
      USING HINT = 'Un co-hôte peut habiller la soirée et gérer ses ventes, pas en changer la structure.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zy_protect_event_columns_from_cohost ON public.events;
CREATE TRIGGER zy_protect_event_columns_from_cohost
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.protect_event_columns_from_cohost();

-- Les portes « design / billetterie & tables / guest list » de la soirée
-- s'ouvrent au co-hôte éditeur. Corps repris de l'état live, une ligne ajoutée.
CREATE OR REPLACE FUNCTION public.can_manage_event_design(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM events e
    LEFT JOIN venues v ON (v.id = e.venue_id OR v.id = e.partner_venue_id)
    WHERE e.id = _event_id
      AND (
        is_super_admin()
        OR (v.owner_id = _user_id
            AND collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design')
                = ANY (ARRAY['venue', 'both']))
        OR ((e.organizer_user_id = _user_id OR e.partner_organizer_id = _user_id)
            AND collab_domain_holder(e.collab_responsibilities, e.event_mode, 'design')
                = ANY (ARRAY['organizer', 'both']))
        OR is_org_team_member(_user_id, COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  ) OR public.is_event_cohost(_event_id, _user_id, 'editor');
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_event_tables(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id
        OR (e.partner_organizer_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('organizer','both'))
        OR e.tables_owner_user_id = _user_id
        OR (v.owner_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('venue','both'))
        OR public.is_super_admin()
      )
  ) OR public.is_event_cohost(_event_id, _user_id, 'editor')
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_event_guestlist_house(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    WHERE e.id = _event_id
      AND (
        -- Lead organisateur : plein contrôle sur une soirée solo / sans club
        -- partenaire, OU sur une co-soirée où il tient encore l'operations.
        (e.organizer_user_id = _user_id
         AND (e.partner_venue_id IS NULL
              OR public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                 IN ('organizer', 'both')))
        -- Organisateur partenaire : seulement s'il tient l'operations.
        OR (e.partner_organizer_id = _user_id
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('organizer', 'both'))
        -- Club (owner ou manager) : seulement s'il tient l'operations.
        OR ((v.owner_id = _user_id OR public.can_manage_venue(_user_id, v.id))
            AND public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations')
                IN ('venue', 'both'))
        OR public.is_super_admin()
      )
  ) OR public.is_event_cohost(_event_id, _user_id, 'editor')
$function$;

-- ─── 5. Invitations ──────────────────────────────────────────────────────────

-- Annuaire des partenaires possibles : organisateurs publics et clubs en ligne.
CREATE OR REPLACE FUNCTION public.search_coorg_partners(p_query text, p_limit integer DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- La démo ne voit que la démo, le réel ne voit jamais la démo.
  WITH q AS (SELECT lower(btrim(COALESCE(p_query, ''))) AS s,
                    COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = auth.uid()), false) AS demo)
  SELECT COALESCE(jsonb_agg(x ORDER BY x.followers DESC NULLS LAST, x.name), '[]'::jsonb)
    FROM (
      (SELECT 'org' AS kind, op.user_id::text AS id, op.display_name AS name, op.slug,
              op.avatar_url, op.city,
              (SELECT count(*) FROM public.organizer_profile_followers f WHERE f.organizer_user_id = op.user_id) AS followers
         FROM public.organizer_profiles op, q
        WHERE auth.uid() IS NOT NULL
          AND length(q.s) >= 2
          AND COALESCE(op.is_public, true)
          AND op.user_id <> auth.uid()
          AND COALESCE((SELECT public.is_demo_email(u.email) FROM auth.users u WHERE u.id = op.user_id), false) = q.demo
          AND (lower(op.display_name) LIKE '%' || q.s || '%' OR lower(COALESCE(op.slug, '')) LIKE '%' || q.s || '%')
        LIMIT p_limit)
      UNION ALL
      (SELECT 'venue', v.id, v.name, v.slug, v.logo_url, v.city,
              (SELECT count(*) FROM public.favorites f WHERE f.venue_id = v.id)
         FROM public.venues v, q
        WHERE auth.uid() IS NOT NULL
          AND length(q.s) >= 2
          AND v.decommissioned_at IS NULL
          AND (NOT COALESCE(v.is_hidden, false) OR v.id = ANY (public.demo_venue_ids()))
          AND (v.id = ANY (public.demo_venue_ids())) = q.demo
          AND (lower(v.name) LIKE '%' || q.s || '%' OR lower(COALESCE(v.slug, '')) LIKE '%' || q.s || '%'
               OR lower(COALESCE(v.city, '')) LIKE '%' || q.s || '%')
        LIMIT p_limit)
    ) x;
$$;

CREATE OR REPLACE FUNCTION public.invite_event_cohost(
  p_event_id uuid,
  p_organizer_user_id uuid DEFAULT NULL,
  p_venue_id text DEFAULT NULL,
  p_access text DEFAULT 'editor',
  p_share_crm boolean DEFAULT true,
  p_message text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_party text;
  v_id    uuid;
  v_count integer;
  v_title text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF (p_organizer_user_id IS NULL) = (p_venue_id IS NULL) THEN RAISE EXCEPTION 'one_party_required'; END IF;
  IF p_access NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_access'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR v_ev.end_at < now() THEN RAISE EXCEPTION 'event_closed'; END IF;

  -- Seules les parties PRINCIPALES invitent (niveau gestion).
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_party := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id ELSE 'org:' || p_organizer_user_id END;
  IF EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = v_party) THEN
    RAISE EXCEPTION 'already_party';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_cohosts c WHERE c.event_id = p_event_id AND c.status = 'pending'
              AND (c.organizer_user_id = p_organizer_user_id OR c.venue_id = p_venue_id)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  -- Existence + garde démo : la démo ne s'invite qu'entre comptes démo.
  IF p_organizer_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE op.user_id = p_organizer_user_id) THEN
      RAISE EXCEPTION 'organizer_not_found';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.venues v WHERE v.id = p_venue_id AND v.decommissioned_at IS NULL) THEN
      RAISE EXCEPTION 'venue_not_found';
    END IF;
  END IF;

  SELECT count(*) INTO v_count FROM public.event_cohosts c
   WHERE c.event_id = p_event_id AND c.status IN ('pending', 'accepted');
  IF v_count >= 8 THEN RAISE EXCEPTION 'too_many_cohosts'; END IF;

  INSERT INTO public.event_cohosts (event_id, organizer_user_id, venue_id, access, share_crm, message,
                                    invited_by, invited_by_party)
  VALUES (p_event_id, p_organizer_user_id, p_venue_id, p_access, COALESCE(p_share_crm, true),
          NULLIF(btrim(COALESCE(p_message, '')), ''), v_uid, v_me.party_key)
  RETURNING id INTO v_id;

  -- Un accord en cours ne couvre pas la nouvelle partie : il repasse en attente.
  UPDATE public.event_coorg_deals SET status = 'pending', signatures = '{}'::jsonb,
         version = version + 1, activated_at = NULL, updated_at = now()
   WHERE event_id = p_event_id AND status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.event_coorg_settlements s
                      WHERE s.event_id = p_event_id AND s.status <> 'open');

  v_title := COALESCE(v_ev.title, 'Soirée');
  PERFORM public.notify_coorg_party(v_party, p_event_id, 'cohost_invited',
    'Invitation à co-organiser',
    (SELECT display_name FROM public.event_parties(p_event_id) WHERE party_key = v_me.party_key)
      || ' t''invite à co-organiser « ' || v_title || ' ».',
    v_id, 'cohost_invited:' || v_id::text);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_event_cohost_invitation(p_cohost_id uuid, p_accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c     record;
  v_key text;
  v_title text;
  v_name text;
BEGIN
  SELECT * INTO c FROM public.event_cohosts WHERE id = p_cohost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  v_key := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END;
  IF public.coorg_party_level(v_uid, v_key) < 2 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  UPDATE public.event_cohosts
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now(), responded_by = v_uid, updated_at = now()
   WHERE id = p_cohost_id;

  SELECT title INTO v_title FROM public.events WHERE id = c.event_id;
  SELECT COALESCE(v.name, op.display_name, 'Un partenaire') INTO v_name
    FROM (SELECT 1) one
    LEFT JOIN public.venues v ON v.id = c.venue_id
    LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id;

  IF c.invited_by_party IS NOT NULL THEN
    PERFORM public.notify_coorg_party(c.invited_by_party, c.event_id,
      CASE WHEN p_accept THEN 'cohost_accepted' ELSE 'cohost_declined' END,
      CASE WHEN p_accept THEN 'Co-organisation acceptée' ELSE 'Co-organisation déclinée' END,
      v_name || CASE WHEN p_accept THEN ' co-organise désormais « ' ELSE ' a décliné « ' END
        || COALESCE(v_title, 'la soirée') || ' ».',
      p_cohost_id, 'cohost_resp:' || p_cohost_id::text);
  END IF;
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END;
$$;

-- Réglages d'un co-hôte (accès, partage CRM) par une partie principale.
CREATE OR REPLACE FUNCTION public.update_event_cohost(p_cohost_id uuid, p_access text DEFAULT NULL, p_share_crm boolean DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c record; v_me record;
BEGIN
  SELECT * INTO c FROM public.event_cohosts WHERE id = p_cohost_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_me FROM public.my_event_party(c.event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_access IS NOT NULL AND p_access NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_access'; END IF;
  UPDATE public.event_cohosts
     SET access = COALESCE(p_access, access), share_crm = COALESCE(p_share_crm, share_crm), updated_at = now()
   WHERE id = p_cohost_id AND status IN ('pending', 'accepted');
END;
$$;

-- Retrait (par une partie principale) ou départ (par le co-hôte lui-même).
-- Les contacts déjà partagés restent chez chacun : ils ont consenti, nommément.
CREATE OR REPLACE FUNCTION public.end_event_cohost(p_cohost_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c record; v_me record; v_key text; v_status text;
BEGIN
  SELECT * INTO c FROM public.event_cohosts WHERE id = p_cohost_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF c.status NOT IN ('pending', 'accepted') THEN RAISE EXCEPTION 'not_live'; END IF;
  v_key := CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END;

  IF public.coorg_party_level(v_uid, v_key) >= 2 THEN
    v_status := CASE WHEN c.status = 'pending' THEN 'declined' ELSE 'left' END;
  ELSE
    SELECT * INTO v_me FROM public.my_event_party(c.event_id);
    IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    v_status := 'removed';
  END IF;

  -- Une partie engagée dans un décompte validé ne s'efface pas.
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s
              WHERE s.event_id = c.event_id AND s.status <> 'open'
                AND s.snapshot -> 'party_set' ? v_key) THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  UPDATE public.event_cohosts SET status = v_status, ended_at = now(), updated_at = now() WHERE id = p_cohost_id;

  -- Sa part sort de l'accord : l'accord repasse en attente.
  UPDATE public.event_coorg_deals
     SET shares = shares - v_key, status = 'pending', signatures = '{}'::jsonb,
         version = version + 1, activated_at = NULL, updated_at = now()
   WHERE event_id = c.event_id AND shares ? v_key;

  IF v_status = 'removed' THEN
    PERFORM public.notify_coorg_party(v_key, c.event_id, 'cohost_removed', 'Co-organisation terminée',
      'Tu ne co-organises plus « ' || COALESCE((SELECT title FROM public.events WHERE id = c.event_id), 'la soirée') || ' ».',
      p_cohost_id, 'cohost_removed:' || p_cohost_id::text);
  END IF;
  RETURN v_status;
END;
$$;

-- ─── 6. Lecture pour la Console ──────────────────────────────────────────────

-- Invitations en attente pour une portée (club OU organisateur).
CREATE OR REPLACE FUNCTION public.get_my_cohost_invitations(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'event_id', c.event_id, 'access', c.access, 'share_crm', c.share_crm,
           'message', c.message, 'invited_at', c.invited_at,
           'event_title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
           'poster_url', COALESCE(e.poster_url, e.image_url),
           'location', COALESCE(v.name, e.location_name), 'city', COALESCE(v.city, e.location_city),
           'invited_by_name', (SELECT p.display_name FROM public.event_parties(c.event_id) p
                                WHERE p.party_key = c.invited_by_party),
           'parties', (SELECT jsonb_agg(jsonb_build_object('name', p.display_name, 'kind', p.kind, 'role', p.role))
                         FROM public.event_parties(c.event_id) p)
         ) ORDER BY e.start_at), '[]'::jsonb)
    FROM public.event_cohosts c
    JOIN public.events e ON e.id = c.event_id
    LEFT JOIN public.venues v ON v.id = COALESCE(e.venue_id, e.partner_venue_id)
   WHERE c.status = 'pending' AND e.end_at > now()
     AND (
       (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id
        AND public.coorg_party_level(auth.uid(), 'org:' || p_organizer_user_id) >= 1)
       OR (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id
        AND public.coorg_party_level(auth.uid(), 'venue:' || p_venue_id) >= 1)
     );
$$;

-- Soirées multi-parties de la portée (principale avec co-hôtes, ou co-hôte).
CREATE OR REPLACE FUNCTION public.get_my_coorg_events(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
                WHEN p_organizer_user_id IS NOT NULL THEN 'org:' || p_organizer_user_id END;
  IF v_key IS NULL OR public.coorg_party_level(auth.uid(), v_key) < 1 THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'start_at') DESC)
      FROM (
        SELECT jsonb_build_object(
          'event_id', e.id, 'title', e.title, 'start_at', e.start_at, 'end_at', e.end_at,
          'poster_url', COALESCE(e.poster_url, e.image_url),
          'my_role', (SELECT p.role FROM public.event_parties(e.id) p WHERE p.party_key = v_key),
          'parties', (SELECT jsonb_agg(jsonb_build_object('key', p.party_key, 'name', p.display_name,
                              'kind', p.kind, 'role', p.role, 'avatar_url', p.avatar_url) ORDER BY p.ord)
                        FROM public.event_parties(e.id) p),
          'pending_invites', (SELECT count(*) FROM public.event_cohosts c2 WHERE c2.event_id = e.id AND c2.status = 'pending'),
          'deal_status', (SELECT d.status FROM public.event_coorg_deals d WHERE d.event_id = e.id),
          'settlement_status', (SELECT s.status FROM public.event_coorg_settlements s WHERE s.event_id = e.id)
        ) AS row
          FROM public.events e
         WHERE EXISTS (SELECT 1 FROM public.event_cohosts c WHERE c.event_id = e.id AND c.status IN ('pending', 'accepted'))
           AND EXISTS (SELECT 1 FROM public.event_parties(e.id) p WHERE p.party_key = v_key)
      ) t
  ), '[]'::jsonb);
END;
$$;

-- Carnet des partenaires : avec qui la portée a déjà co-organisé, et combien
-- ça a vendu. C'est ce qui rend « on refait une soirée ensemble » en un clic.
CREATE OR REPLACE FUNCTION public.get_my_coorg_partners(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := CASE WHEN p_venue_id IS NOT NULL THEN 'venue:' || p_venue_id
                WHEN p_organizer_user_id IS NOT NULL THEN 'org:' || p_organizer_user_id END;
  IF v_key IS NULL OR public.coorg_party_level(auth.uid(), v_key) < 1 THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    WITH my_events AS (
      SELECT e.id FROM public.events e
       WHERE e.cancelled_at IS NULL
         AND ((p_venue_id IS NOT NULL AND (e.venue_id = p_venue_id OR e.partner_venue_id = p_venue_id
                OR e.id IN (SELECT public.cohost_event_ids_venue(p_venue_id))))
           OR (p_organizer_user_id IS NOT NULL AND (e.organizer_user_id = p_organizer_user_id
                OR e.partner_organizer_id = p_organizer_user_id
                OR e.id IN (SELECT public.cohost_event_ids_org(p_organizer_user_id)))))
    ),
    pairs AS (
      SELECT p.party_key, p.kind, p.display_name, p.slug, p.avatar_url, p.city, p.venue_id, p.organizer_user_id, me.id AS event_id
        FROM my_events me
        CROSS JOIN LATERAL public.event_parties(me.id) p
       WHERE p.party_key <> v_key
    ),
    sales AS (
      SELECT t.event_id, sum(greatest(coalesce(t.quantity, 1), 1)) AS tickets
        FROM public.tickets t WHERE t.event_id IN (SELECT event_id FROM pairs) AND t.status IN ('paid', 'used')
       GROUP BY t.event_id
    )
    SELECT jsonb_agg(jsonb_build_object(
             'key', x.party_key, 'kind', x.kind, 'name', x.display_name, 'slug', x.slug,
             'avatar_url', x.avatar_url, 'city', x.city,
             'venue_id', x.venue_id, 'organizer_user_id', x.organizer_user_id,
             'events', x.n, 'tickets', x.tickets, 'last_at', x.last_at
           ) ORDER BY x.last_at DESC)
      FROM (
        SELECT pr.party_key, pr.kind, max(pr.display_name) AS display_name, max(pr.slug) AS slug,
               max(pr.avatar_url) AS avatar_url, max(pr.city) AS city,
               max(pr.venue_id) AS venue_id, (array_agg(pr.organizer_user_id))[1] AS organizer_user_id,
               count(DISTINCT pr.event_id) AS n,
               COALESCE(sum(s.tickets), 0) AS tickets,
               max(e.start_at) AS last_at
          FROM pairs pr
          JOIN public.events e ON e.id = pr.event_id
          LEFT JOIN sales s ON s.event_id = pr.event_id
         GROUP BY pr.party_key, pr.kind
      ) x
  ), '[]'::jsonb);
END;
$$;

-- ─── 7. Accord de co-organisation ────────────────────────────────────────────

-- Une partie principale propose (ou modifie) les parts. Toute modification
-- repart de zéro côté signatures. Les parts ne portent que sur les parties de
-- la soirée ; une partie absente des parts reste hors décompte (elle partage
-- dashboards et CRM, pas l'argent).
CREATE OR REPLACE FUNCTION public.save_coorg_deal(p_event_id uuid, p_shares jsonb, p_formal boolean DEFAULT false, p_clauses text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me record; v_total numeric := 0; k text; v_pct numeric; v_n integer := 0;
BEGIN
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = p_event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  IF jsonb_typeof(p_shares) <> 'object' THEN RAISE EXCEPTION 'invalid_shares'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_shares) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = k) THEN
      RAISE EXCEPTION 'unknown_party %', k;
    END IF;
    v_pct := (p_shares ->> k)::numeric;
    IF v_pct < 0 OR v_pct > 100 THEN RAISE EXCEPTION 'invalid_pct'; END IF;
    v_total := v_total + v_pct;
    v_n := v_n + 1;
  END LOOP;
  IF v_n < 2 THEN RAISE EXCEPTION 'at_least_two_parties'; END IF;
  IF abs(v_total - 100) > 0.001 THEN RAISE EXCEPTION 'shares_must_total_100'; END IF;

  INSERT INTO public.event_coorg_deals (event_id, shares, formal, clauses, created_by, status, signatures)
  VALUES (p_event_id, p_shares, COALESCE(p_formal, false), NULLIF(btrim(COALESCE(p_clauses, '')), ''), auth.uid(), 'pending', '{}'::jsonb)
  ON CONFLICT (event_id) DO UPDATE
     SET shares = EXCLUDED.shares, formal = EXCLUDED.formal, clauses = EXCLUDED.clauses,
         status = 'pending', signatures = '{}'::jsonb, activated_at = NULL,
         version = public.event_coorg_deals.version + 1, updated_at = now();

  -- La partie qui propose accepte d'office sa propre proposition.
  PERFORM public.sign_coorg_deal(p_event_id, v_me.party_key, NULL, NULL);

  -- Toute modification des parts rouvre les validations du décompte.
  UPDATE public.event_coorg_settlements SET approvals = '{}'::jsonb, version = version + 1, updated_at = now()
   WHERE event_id = p_event_id AND status = 'open';

  PERFORM public.notify_coorg_party(k2, p_event_id, 'coorg_deal_to_sign',
      CASE WHEN p_formal THEN 'Contrat de co-organisation à signer' ELSE 'Accord de co-organisation à valider' END,
      'Les parts de « ' || COALESCE((SELECT title FROM public.events WHERE id = p_event_id), 'la soirée') || ' » attendent ton accord.',
      NULL, NULL)
    FROM jsonb_object_keys(p_shares) AS k2 WHERE k2 <> v_me.party_key;

  RETURN (SELECT to_jsonb(d) FROM public.event_coorg_deals d WHERE d.event_id = p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.sign_coorg_deal(p_event_id uuid, p_party text, p_ip text DEFAULT NULL, p_ua text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d record; v_all boolean;
BEGIN
  IF public.coorg_party_level(auth.uid(), p_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT * INTO d FROM public.event_coorg_deals WHERE event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_deal'; END IF;
  IF d.status = 'cancelled' THEN RAISE EXCEPTION 'deal_cancelled'; END IF;
  IF NOT (d.shares ? p_party) THEN RAISE EXCEPTION 'not_in_deal'; END IF;

  UPDATE public.event_coorg_deals
     SET signatures = signatures || jsonb_build_object(p_party, jsonb_build_object(
           'at', now(), 'by', auth.uid(), 'ip', p_ip, 'ua', left(COALESCE(p_ua, ''), 400), 'version', d.version)),
         updated_at = now()
   WHERE event_id = p_event_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(dd.shares) k WHERE NOT (dd.signatures ? k)
  ) INTO v_all FROM public.event_coorg_deals dd WHERE dd.event_id = p_event_id;

  IF v_all AND d.status <> 'active' THEN
    UPDATE public.event_coorg_deals SET status = 'active', activated_at = now() WHERE event_id = p_event_id;
    PERFORM public.notify_coorg_party(k, p_event_id, 'coorg_deal_active',
        'Accord de co-organisation actif',
        'Toutes les parties ont validé les parts de « ' || COALESCE((SELECT title FROM public.events WHERE id = p_event_id), 'la soirée') || ' ».',
        NULL, 'coorg_deal_active:' || p_event_id::text || ':' || d.version::text)
      FROM jsonb_object_keys(d.shares) AS k;
  END IF;
  RETURN (SELECT to_jsonb(x) FROM public.event_coorg_deals x WHERE x.event_id = p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_coorg_deal(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_me record;
BEGIN
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = p_event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  UPDATE public.event_coorg_deals SET status = 'cancelled', updated_at = now() WHERE event_id = p_event_id;
END;
$$;

-- ─── 8. Décompte : lignes déclarées ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._coorg_touch_settlement(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.event_coorg_settlements (event_id) VALUES (p_event_id)
  ON CONFLICT (event_id) DO UPDATE
     SET approvals = '{}'::jsonb, version = public.event_coorg_settlements.version + 1, updated_at = now()
   WHERE public.event_coorg_settlements.status = 'open';
END;
$$;

CREATE OR REPLACE FUNCTION public.add_coorg_ledger_line(
  p_event_id uuid, p_party text, p_kind text, p_label text, p_amount numeric,
  p_category text DEFAULT 'other', p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  -- On déclare pour SA partie : ce qu'on a payé, ou ce qu'on a encaissé hors Yuno.
  IF public.coorg_party_level(auth.uid(), p_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF p_kind NOT IN ('revenue', 'expense') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF COALESCE(p_amount, 0) <= 0 OR p_amount > 10000000 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF COALESCE(btrim(p_label), '') = '' THEN RAISE EXCEPTION 'label_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = p_party) THEN
    RAISE EXCEPTION 'not_a_party';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = p_event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  INSERT INTO public.event_coorg_ledger (event_id, kind, party_key, category, label, amount, note, created_by)
  VALUES (p_event_id, p_kind, p_party, COALESCE(NULLIF(p_category, ''), 'other'), left(btrim(p_label), 140),
          round(p_amount, 2), NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  PERFORM public._coorg_touch_settlement(p_event_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_coorg_ledger_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE l record;
BEGIN
  SELECT * INTO l FROM public.event_coorg_ledger WHERE id = p_line_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), l.party_key) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_coorg_settlements s WHERE s.event_id = l.event_id AND s.status <> 'open') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  UPDATE public.event_coorg_ledger SET voided_at = now(), voided_by = auth.uid() WHERE id = p_line_id;
  PERFORM public._coorg_touch_settlement(l.event_id);
END;
$$;

-- ─── 9. Décompte : calcul ──(ventes)
-- Ventes Yuno de la soirée, par partie qui les a réellement reçues.
CREATE OR REPLACE FUNCTION public._coorg_yuno_legs(p_event_id uuid)
RETURNS TABLE (party_key text, pillar text, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH m AS (SELECT public.event_merchant_party(p_event_id) AS k)
  SELECT leg.party_key, 'tickets', leg.amount
      FROM public.tickets t
      CROSS JOIN m
      CROSS JOIN LATERAL (
        SELECT greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0) AS ca,
               CASE WHEN coalesce(t.total_price, 0) > 0 THEN round(t.total_price * 0.015 + 0.25, 2) ELSE 0 END AS stripe
      ) f
      CROSS JOIN LATERAL (
        SELECT f.ca - least(greatest(coalesce(t.refund_amount, 0), 0), f.ca) - f.stripe AS net
      ) n
      LEFT JOIN LATERAL (
        SELECT rd.* FROM public.revenue_distributions rd WHERE rd.ticket_id = t.id ORDER BY rd.created_at DESC LIMIT 1
      ) rd ON true
      CROSS JOIN LATERAL (
        SELECT CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN m.k
                    ELSE CASE WHEN rd.primary_recipient_kind = 'venue' THEN 'venue:' || rd.primary_recipient_venue_id
                              ELSE 'org:' || rd.primary_recipient_organizer_id END END AS party_key,
               CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN n.net
                    ELSE n.net * rd.primary_amount_cents::numeric
                         / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0)) END AS amount
        UNION ALL
        SELECT CASE WHEN rd.secondary_recipient_kind = 'venue' THEN 'venue:' || rd.secondary_recipient_venue_id
                    ELSE 'org:' || rd.secondary_recipient_organizer_id END,
               n.net * rd.secondary_amount_cents::numeric
                 / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0))
         WHERE rd.id IS NOT NULL AND coalesce(rd.secondary_amount_cents, 0) > 0
      ) leg
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'used')
  UNION ALL
  SELECT leg.party_key, 'tables', leg.amount
      FROM public.table_reservations t
      CROSS JOIN m
      CROSS JOIN LATERAL (
        SELECT greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.management_fee, 0), 0) AS ca,
               CASE WHEN coalesce(t.total_price, 0) > 0 THEN round(t.total_price * 0.015 + 0.25, 2) ELSE 0 END AS stripe
      ) f
      CROSS JOIN LATERAL (
        SELECT f.ca - least(greatest(coalesce(t.refund_amount, 0), 0), f.ca) - f.stripe AS net
      ) n
      LEFT JOIN LATERAL (
        SELECT rd.* FROM public.revenue_distributions rd WHERE rd.table_reservation_id = t.id ORDER BY rd.created_at DESC LIMIT 1
      ) rd ON true
      CROSS JOIN LATERAL (
        SELECT CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN m.k
                    ELSE CASE WHEN rd.primary_recipient_kind = 'venue' THEN 'venue:' || rd.primary_recipient_venue_id
                              ELSE 'org:' || rd.primary_recipient_organizer_id END END AS party_key,
               CASE WHEN rd.id IS NULL OR coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0) <= 0
                    THEN n.net
                    ELSE n.net * rd.primary_amount_cents::numeric
                         / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0)) END AS amount
        UNION ALL
        SELECT CASE WHEN rd.secondary_recipient_kind = 'venue' THEN 'venue:' || rd.secondary_recipient_venue_id
                    ELSE 'org:' || rd.secondary_recipient_organizer_id END,
               n.net * rd.secondary_amount_cents::numeric
                 / (coalesce(rd.primary_amount_cents, 0) + coalesce(rd.secondary_amount_cents, 0))
         WHERE rd.id IS NOT NULL AND coalesce(rd.secondary_amount_cents, 0) > 0
      ) leg
     WHERE t.event_id = p_event_id AND t.status IN ('paid', 'confirmed')
  UNION ALL
  SELECT 'venue:' || o.venue_id, 'drinks',
           greatest(o.total - coalesce(o.service_fee, 0), 0)
           - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0))
           - CASE WHEN coalesce(o.total, 0) > 0 THEN round(o.total * 0.015 + 0.25, 2) ELSE 0 END
      FROM public.orders o
     WHERE o.event_id = p_event_id AND o.status IN ('paid', 'served') AND o.venue_id IS NOT NULL;
$$;

-- ─── 9 bis. Décompte : calcul ────────────────────────────────────────────────────
--
-- Revenus Yuno par partie : chaque vente (billet, table, commande bar) vaut son
-- NET (fees.ts : CA club − remboursement − frais Stripe 1,5 % + 0,25 €). Elle
-- est créditée à qui l'a réellement reçue : les deux jambes Stripe de
-- revenue_distributions quand elles existent (au prorata des montants), sinon
-- l'encaisseur de la soirée (billets, tables) ou le club (bar).
--
-- Pot = revenus Yuno + revenus déclarés reçus par les parties de l'accord −
-- frais déclarés payés par elles. Chacun a droit à part × pot + ses frais ;
-- il détient ses encaissements ; le solde se règle par virements (algorithme
-- glouton : le plus gros débiteur paie le plus gros créancier). Arrondi au
-- centime, le reste va à la plus grosse ligne.
CREATE OR REPLACE FUNCTION public._coorg_compute(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d        record;
  v_merch  text;
  v_parts  jsonb := '[]'::jsonb;
  v_rev    numeric := 0;
  v_exp    numeric := 0;
  v_pot    numeric;
  r        record;
  v_bal    jsonb := '{}'::jsonb;
  v_trans  jsonb := '[]'::jsonb;
  v_debt   text; v_cred text; v_amt numeric; v_db numeric; v_cr numeric;
  v_guard  integer := 0;
  v_resid  numeric;
  v_top    text;
BEGIN
  SELECT * INTO d FROM public.event_coorg_deals WHERE event_id = p_event_id AND status <> 'cancelled';
  IF NOT FOUND OR d.shares = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_deal');
  END IF;
  v_merch := public.event_merchant_party(p_event_id);

  FOR r IN
    WITH _yl AS MATERIALIZED (SELECT * FROM public._coorg_yuno_legs(p_event_id))
    SELECT p.party_key, p.display_name, p.kind, p.role,
           (d.shares ->> p.party_key)::numeric AS pct,
           round(COALESCE((SELECT sum(y.amount) FROM _yl y WHERE y.party_key = p.party_key), 0), 2) AS yuno,
           round(COALESCE((SELECT sum(y.amount) FROM _yl y WHERE y.party_key = p.party_key AND y.pillar = 'tickets'), 0), 2) AS yuno_tickets,
           round(COALESCE((SELECT sum(y.amount) FROM _yl y WHERE y.party_key = p.party_key AND y.pillar = 'tables'), 0), 2) AS yuno_tables,
           round(COALESCE((SELECT sum(y.amount) FROM _yl y WHERE y.party_key = p.party_key AND y.pillar = 'drinks'), 0), 2) AS yuno_drinks,
           COALESCE((SELECT sum(l.amount) FROM public.event_coorg_ledger l
                      WHERE l.event_id = p_event_id AND l.voided_at IS NULL AND l.party_key = p.party_key AND l.kind = 'revenue'), 0) AS declared_rev,
           COALESCE((SELECT sum(l.amount) FROM public.event_coorg_ledger l
                      WHERE l.event_id = p_event_id AND l.voided_at IS NULL AND l.party_key = p.party_key AND l.kind = 'expense'), 0) AS declared_exp
      FROM public.event_parties(p_event_id) p
     WHERE d.shares ? p.party_key
     ORDER BY p.ord, p.party_key
  LOOP
    v_rev := v_rev + r.yuno + r.declared_rev;
    v_exp := v_exp + r.declared_exp;
    v_parts := v_parts || jsonb_build_object(
      'party', r.party_key, 'name', r.display_name, 'kind', r.kind, 'role', r.role, 'pct', r.pct,
      'yuno', r.yuno, 'yuno_tickets', r.yuno_tickets, 'yuno_tables', r.yuno_tables, 'yuno_drinks', r.yuno_drinks,
      'declared_revenue', r.declared_rev, 'expenses', r.declared_exp,
      'held', r.yuno + r.declared_rev);
  END LOOP;

  v_pot := round(v_rev - v_exp, 2);

  -- Droits, soldes.
  SELECT jsonb_agg(p || jsonb_build_object(
           'entitled', round((p->>'pct')::numeric / 100 * v_pot + (p->>'expenses')::numeric, 2),
           'balance',  round((p->>'pct')::numeric / 100 * v_pot + (p->>'expenses')::numeric - (p->>'held')::numeric, 2)))
    INTO v_parts FROM jsonb_array_elements(v_parts) p;

  -- Résidu d'arrondi → la plus grosse part.
  SELECT sum((p->>'balance')::numeric) INTO v_resid FROM jsonb_array_elements(v_parts) p;
  IF COALESCE(v_resid, 0) <> 0 THEN
    SELECT p->>'party' INTO v_top FROM jsonb_array_elements(v_parts) p
     ORDER BY (p->>'pct')::numeric DESC, p->>'party' LIMIT 1;
    SELECT jsonb_agg(CASE WHEN p->>'party' = v_top
                          THEN p || jsonb_build_object('balance', (p->>'balance')::numeric - v_resid,
                                                       'entitled', (p->>'entitled')::numeric - v_resid)
                          ELSE p END)
      INTO v_parts FROM jsonb_array_elements(v_parts) p;
  END IF;

  FOR r IN SELECT p->>'party' AS k, (p->>'balance')::numeric AS b FROM jsonb_array_elements(v_parts) p LOOP
    v_bal := v_bal || jsonb_build_object(r.k, r.b);
  END LOOP;

  -- Virements : glouton.
  LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_guard > 50;
    SELECT key, value::numeric INTO v_debt, v_db FROM jsonb_each_text(v_bal)
     WHERE value::numeric < -0.004 ORDER BY value::numeric ASC, key LIMIT 1;
    SELECT key, value::numeric INTO v_cred, v_cr FROM jsonb_each_text(v_bal)
     WHERE value::numeric > 0.004 ORDER BY value::numeric DESC, key LIMIT 1;
    EXIT WHEN v_debt IS NULL OR v_cred IS NULL;
    v_amt := round(least(-v_db, v_cr), 2);
    EXIT WHEN v_amt <= 0;
    v_trans := v_trans || jsonb_build_object('from', v_debt, 'to', v_cred, 'amount', v_amt);
    v_bal := v_bal || jsonb_build_object(v_debt, v_db + v_amt, v_cred, v_cr - v_amt);
    v_debt := NULL; v_cred := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'deal_version', d.version, 'deal_status', d.status,
    'merchant', v_merch,
    'revenue', round(v_rev, 2), 'expenses', round(v_exp, 2), 'pot', v_pot,
    'parties', COALESCE(v_parts, '[]'::jsonb),
    'transfers', v_trans
  );
END;
$$;

-- ─── 10. Vue complète pour l'écran de la soirée ─────────────────────────────

CREATE OR REPLACE FUNCTION public.get_event_coorg(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_money boolean;
  v_mine  text[];
  v_set   record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);

  -- Une invitation en attente se lit aussi (pour décider).
  IF v_me.party_key IS NULL AND NOT public.is_super_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_cohosts c
                    WHERE c.event_id = p_event_id AND c.status = 'pending'
                      AND public.coorg_party_level(v_uid,
                            CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
  END IF;

  SELECT array_agg(p.party_key) INTO v_mine FROM public.event_parties(p_event_id) p
   WHERE public.coorg_party_level(v_uid, p.party_key) >= 3;
  v_money := public.is_super_admin() OR COALESCE(array_length(v_mine, 1), 0) > 0;

  SELECT * INTO v_set FROM public.event_coorg_settlements WHERE event_id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at, 'end_at', v_ev.end_at,
                                'ended', v_ev.end_at < now(), 'has_stripe_collab',
                                EXISTS (SELECT 1 FROM public.event_collab_contracts cc
                                         WHERE cc.event_id = p_event_id AND cc.status IN ('active', 'locked', 'closed'))),
    'me', CASE WHEN v_me.party_key IS NULL THEN NULL
               ELSE jsonb_build_object('party', v_me.party_key, 'role', v_me.role, 'access', v_me.access, 'level', v_me.level) END,
    'my_parties', COALESCE(to_jsonb(v_mine), '[]'::jsonb),
    'can_invite', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 2, false)
                  AND v_ev.end_at > now() AND v_ev.cancelled_at IS NULL,
    'can_deal', COALESCE(v_me.role IN ('lead', 'partner') AND v_me.level >= 3, false),
    'parties', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'key', p.party_key, 'kind', p.kind, 'role', p.role, 'access', p.access,
                  'share_crm', p.share_crm, 'cohost_id', p.cohost_id, 'name', p.display_name,
                  'slug', p.slug, 'avatar_url', p.avatar_url, 'city', p.city) ORDER BY p.ord), '[]'::jsonb)
                  FROM public.event_parties(p_event_id) p),
    'invitations', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                      'id', c.id, 'status', c.status, 'access', c.access, 'share_crm', c.share_crm,
                      'invited_at', c.invited_at, 'message', c.message,
                      'party', CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END,
                      'name', COALESCE(v.name, op.display_name),
                      'avatar_url', COALESCE(v.logo_url, op.avatar_url),
                      'mine', public.coorg_party_level(v_uid,
                                CASE WHEN c.venue_id IS NOT NULL THEN 'venue:' || c.venue_id ELSE 'org:' || c.organizer_user_id END) >= 1
                    ) ORDER BY c.invited_at DESC), '[]'::jsonb)
                      FROM public.event_cohosts c
                      LEFT JOIN public.venues v ON v.id = c.venue_id
                      LEFT JOIN public.organizer_profiles op ON op.user_id = c.organizer_user_id
                     WHERE c.event_id = p_event_id AND c.status IN ('pending', 'declined')),
    'deal', CASE WHEN v_money THEN (SELECT to_jsonb(d) - 'created_by' FROM public.event_coorg_deals d WHERE d.event_id = p_event_id) END,
    'ledger', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'kind', l.kind, 'party', l.party_key, 'category', l.category, 'label', l.label,
                  'amount', l.amount, 'note', l.note, 'created_at', l.created_at,
                  'mine', l.party_key = ANY (COALESCE(v_mine, '{}'::text[]))) ORDER BY l.created_at), '[]'::jsonb)
                  FROM public.event_coorg_ledger l WHERE l.event_id = p_event_id AND l.voided_at IS NULL) END,
    'settlement', CASE WHEN v_money THEN jsonb_build_object(
                    'status', COALESCE(v_set.status, 'open'),
                    'version', COALESCE(v_set.version, 1),
                    'approvals', COALESCE(v_set.approvals, '{}'::jsonb),
                    'approved_at', v_set.approved_at, 'settled_at', v_set.settled_at,
                    'figures', CASE WHEN v_set.status IN ('approved', 'settled') THEN v_set.snapshot
                                    ELSE public._coorg_compute(p_event_id) END) END,
    'transfers', CASE WHEN v_money THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'from', t.from_party, 'to', t.to_party, 'amount', t.amount,
                    'reference', t.reference, 'status', t.status,
                    'payee_iban', CASE WHEN t.from_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                         OR t.to_party = ANY (COALESCE(v_mine, '{}'::text[]))
                                       THEN t.payee_iban END,
                    'sent_at', t.sent_at, 'sent_reference', t.sent_reference,
                    'received_at', t.received_at, 'disputed_at', t.disputed_at, 'dispute_reason', t.dispute_reason,
                    'i_pay', t.from_party = ANY (COALESCE(v_mine, '{}'::text[])),
                    'i_receive', t.to_party = ANY (COALESCE(v_mine, '{}'::text[]))
                  ) ORDER BY t.amount DESC), '[]'::jsonb)
                    FROM public.event_coorg_transfers t WHERE t.event_id = p_event_id) END
  );
END;
$$;

-- ─── 11. Validation du décompte, virements ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_coorg_settlement(p_event_id uuid, p_party text, p_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ev record; d record; s record; v_fig jsonb; v_all boolean; t jsonb; v_iban text; v_id uuid;
BEGIN
  IF public.coorg_party_level(auth.uid(), p_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF v_ev.end_at > now() THEN RAISE EXCEPTION 'event_not_over'; END IF;
  SELECT * INTO d FROM public.event_coorg_deals WHERE event_id = p_event_id;
  IF NOT FOUND OR d.status <> 'active' THEN RAISE EXCEPTION 'deal_not_active'; END IF;
  IF NOT (d.shares ? p_party) THEN RAISE EXCEPTION 'not_in_deal'; END IF;

  INSERT INTO public.event_coorg_settlements (event_id) VALUES (p_event_id) ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO s FROM public.event_coorg_settlements WHERE event_id = p_event_id FOR UPDATE;
  IF s.status <> 'open' THEN RAISE EXCEPTION 'already_approved'; END IF;
  -- On valide ce qu'on a VU : une ligne ajoutée entre-temps change la version.
  IF p_version IS DISTINCT FROM s.version THEN RAISE EXCEPTION 'stale_version'; END IF;

  UPDATE public.event_coorg_settlements
     SET approvals = approvals || jsonb_build_object(p_party, jsonb_build_object('at', now(), 'by', auth.uid(), 'version', s.version)),
         updated_at = now()
   WHERE event_id = p_event_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(d.shares) k
     WHERE NOT (ss.approvals ? k) OR (ss.approvals -> k ->> 'version')::integer <> ss.version
  ) INTO v_all FROM public.event_coorg_settlements ss WHERE ss.event_id = p_event_id;

  IF NOT v_all THEN
    PERFORM public.notify_coorg_party(k, p_event_id, 'coorg_settlement_to_approve',
        'Décompte de co-organisation à valider',
        'Une partie a validé le décompte de « ' || COALESCE(v_ev.title, 'la soirée') || ' ». À toi.',
        NULL, 'coorg_settle:' || p_event_id::text || ':' || s.version::text || ':' || k)
      FROM jsonb_object_keys(d.shares) AS k
     WHERE NOT ((SELECT approvals FROM public.event_coorg_settlements WHERE event_id = p_event_id) ? k);
    RETURN jsonb_build_object('status', 'open', 'waiting', true);
  END IF;

  -- Tout le monde a validé : on fige et on crée les virements.
  v_fig := public._coorg_compute(p_event_id);
  UPDATE public.event_coorg_settlements
     SET status = CASE WHEN jsonb_array_length(v_fig -> 'transfers') = 0 THEN 'settled' ELSE 'approved' END,
         snapshot = v_fig || jsonb_build_object('party_set',
                      (SELECT jsonb_object_agg(k, true) FROM jsonb_object_keys(d.shares) k)),
         approved_at = now(),
         settled_at = CASE WHEN jsonb_array_length(v_fig -> 'transfers') = 0 THEN now() END,
         updated_at = now()
   WHERE event_id = p_event_id;

  FOR t IN SELECT * FROM jsonb_array_elements(v_fig -> 'transfers') LOOP
    v_iban := NULL;
    IF split_part(t->>'to', ':', 1) = 'org' THEN
      SELECT opd.iban INTO v_iban FROM public.organizer_payout_details opd
       WHERE opd.user_id = substr(t->>'to', 5)::uuid;
    END IF;
    v_id := gen_random_uuid();
    INSERT INTO public.event_coorg_transfers (id, event_id, from_party, to_party, amount, reference, payee_iban)
    VALUES (v_id, p_event_id, t->>'from', t->>'to', (t->>'amount')::numeric,
            'YCO-' || upper(substr(replace(v_id::text, '-', ''), 1, 8)), v_iban);
    PERFORM public.notify_coorg_party(t->>'from', p_event_id, 'coorg_transfer_due', 'Virement de co-organisation à faire',
      'Décompte validé : ' || to_char((t->>'amount')::numeric, 'FM999G999D00') || ' € à virer (référence YCO-'
        || upper(substr(replace(v_id::text, '-', ''), 1, 8)) || ').',
      v_id, 'coorg_transfer_due:' || v_id::text);
  END LOOP;
  RETURN jsonb_build_object('status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_coorg_transfer_iban(p_transfer_id uuid, p_iban text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t record; v_iban text := upper(regexp_replace(COALESCE(p_iban, ''), '\s', '', 'g'));
BEGIN
  SELECT * INTO t FROM public.event_coorg_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), t.to_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF t.status NOT IN ('pending', 'disputed') THEN RAISE EXCEPTION 'locked'; END IF;
  IF v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' THEN RAISE EXCEPTION 'invalid_iban'; END IF;
  UPDATE public.event_coorg_transfers SET payee_iban = v_iban, updated_at = now() WHERE id = p_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.declare_coorg_transfer_sent(p_transfer_id uuid, p_reference text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.event_coorg_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), t.from_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF t.status NOT IN ('pending', 'disputed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.event_coorg_transfers
     SET status = 'sent', sent_at = now(), sent_by = auth.uid(),
         sent_reference = NULLIF(btrim(COALESCE(p_reference, '')), ''),
         disputed_at = NULL, dispute_reason = NULL, updated_at = now()
   WHERE id = p_transfer_id;
  PERFORM public.notify_coorg_party(t.to_party, t.event_id, 'coorg_transfer_sent', 'Virement annoncé',
    to_char(t.amount, 'FM999G999D00') || ' € annoncés comme virés (' || t.reference || '). Confirme la réception.',
    p_transfer_id, 'coorg_transfer_sent:' || p_transfer_id::text || ':' || extract(epoch FROM now())::bigint::text);
END;
$$;

-- Seul le BÉNÉFICIAIRE confirme ou conteste : jamais de solde unilatéral.
CREATE OR REPLACE FUNCTION public.confirm_coorg_transfer(p_transfer_id uuid, p_received boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM public.event_coorg_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.coorg_party_level(auth.uid(), t.to_party) < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  IF p_received THEN
    IF t.status NOT IN ('sent', 'pending', 'disputed') THEN RAISE EXCEPTION 'invalid_status'; END IF;
    UPDATE public.event_coorg_transfers
       SET status = 'received', received_at = now(), received_by = auth.uid(), updated_at = now()
     WHERE id = p_transfer_id;
    PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_received', 'Virement reçu',
      to_char(t.amount, 'FM999G999D00') || ' € confirmés reçus (' || t.reference || ').',
      p_transfer_id, 'coorg_transfer_received:' || p_transfer_id::text);
    IF NOT EXISTS (SELECT 1 FROM public.event_coorg_transfers x WHERE x.event_id = t.event_id AND x.status <> 'received') THEN
      UPDATE public.event_coorg_settlements SET status = 'settled', settled_at = now(), updated_at = now()
       WHERE event_id = t.event_id;
    END IF;
  ELSE
    IF t.status NOT IN ('sent', 'pending') THEN RAISE EXCEPTION 'invalid_status'; END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
    UPDATE public.event_coorg_transfers
       SET status = 'disputed', disputed_at = now(), dispute_reason = left(btrim(p_reason), 500), updated_at = now()
     WHERE id = p_transfer_id;
    PERFORM public.notify_coorg_party(t.from_party, t.event_id, 'coorg_transfer_disputed', 'Virement contesté',
      'Le virement ' || t.reference || ' est contesté : ' || left(btrim(p_reason), 200),
      p_transfer_id, 'coorg_transfer_disputed:' || p_transfer_id::text || ':' || extract(epoch FROM now())::bigint::text);
  END IF;
END;
$$;

-- ─── 12. CRM partagé : consentement nommé ────────────────────────────────────

-- Les hôtes qui partagent le CRM, dans l'ordre d'affichage. Le checkout les
-- NOMME tous dans la case (« Recevoir les offres de A, B et C ») : un
-- consentement qui ne nomme pas son destinataire ne couvre personne
-- (EDPB 05/2020 §65 ; CNIL, transmission aux partenaires).
CREATE OR REPLACE FUNCTION public.get_event_marketing_hosts(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', p.party_key, 'kind', p.kind, 'venue_id', p.venue_id,
           'organizer_user_id', p.organizer_user_id, 'name', p.display_name, 'role', p.role
         ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
    FROM public.event_parties(p_event_id) p
   WHERE p.share_crm AND COALESCE(btrim(p.display_name), '') <> '';
$$;

-- Verse le consentement coché au checkout dans le registre de CHAQUE hôte
-- nommé (hors portée principale, déjà écrite par le trigger d'achat). N'agit
-- que si une vente / inscription récente de CETTE adresse sur CETTE soirée
-- porte la case cochée : impossible d'abonner une adresse quelconque.
CREATE OR REPLACE FUNCTION public.share_event_marketing_consent(
  p_event_id uuid, p_email text, p_wording text, p_locale text DEFAULT NULL, p_source text DEFAULT 'checkout',
  p_host_keys text[] DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email  text := lower(btrim(COALESCE(p_email, '')));
  v_ev     record;
  v_primary text;
  v_uid    uuid;
  p        record;
  v_n      integer := 0;
BEGIN
  IF v_email = '' OR position('@' IN v_email) = 0 THEN RETURN 0; END IF;
  IF COALESCE(btrim(p_wording), '') = '' THEN RETURN 0; END IF;
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id = p_event_id AND lower(t.user_email) = v_email
             AND COALESCE(t.newsletter_opt_in, false) AND t.created_at > now() - interval '3 hours')
    OR EXISTS (SELECT 1 FROM public.table_reservations r WHERE r.event_id = p_event_id AND lower(r.user_email) = v_email
             AND COALESCE(r.newsletter_opt_in, false) AND r.created_at > now() - interval '3 hours')
    OR EXISTS (SELECT 1 FROM public.guest_list_entries g JOIN public.guest_lists gl ON gl.id = g.guest_list_id
                WHERE gl.event_id = p_event_id AND lower(g.email) = v_email
                  AND COALESCE(g.newsletter_opt_in, false) AND g.created_at > now() - interval '3 hours')
  ) THEN
    RETURN 0;
  END IF;

  v_primary := CASE WHEN v_ev.venue_id IS NOT NULL THEN 'venue:' || v_ev.venue_id ELSE 'org:' || v_ev.organizer_user_id END;
  SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  FOR p IN SELECT * FROM public.event_parties(p_event_id) x
            WHERE x.share_crm AND x.party_key <> v_primary
              AND (p_host_keys IS NULL OR x.party_key = ANY (p_host_keys))
  LOOP
    IF p.kind = 'venue' THEN
      INSERT INTO public.newsletter_subscriptions (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.venue_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    ELSE
      INSERT INTO public.newsletter_subscriptions (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at)
      VALUES (v_uid, p.organizer_user_id, v_email, true, 'cohost_purchase', 'ticketing', now())
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true, opted_out_at = NULL,
            user_id = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id), updated_at = now();
    END IF;
    INSERT INTO public.marketing_consent_events (user_id, email, channel, venue_id, organizer_user_id,
                                                 action, wording_key, wording_text, locale, source)
    VALUES (v_uid, v_email, 'email', p.venue_id, p.organizer_user_id, 'granted', 'consent.emailOffersFrom',
            left(btrim(p_wording), 1000), p_locale, left(COALESCE(p_source, 'checkout'), 60) || ':cohost');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'share_event_marketing_consent: %', SQLERRM;
  RETURN 0;
END;
$$;

-- Abonnés de TOUS les hôtes (club : favoris, orga : abonnés) — l'audience du
-- push de lancement. Service role seul.
CREATE OR REPLACE FUNCTION public.get_event_host_followers(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user_ids', COALESCE((
      SELECT jsonb_agg(DISTINCT x.user_id) FROM (
        SELECT f.user_id FROM public.favorites f
          JOIN public.event_parties(p_event_id) p ON p.kind = 'venue' AND f.venue_id = p.venue_id
         WHERE f.user_id IS NOT NULL
        UNION
        SELECT f.user_id FROM public.organizer_profile_followers f
          JOIN public.event_parties(p_event_id) p ON p.kind = 'org' AND f.organizer_user_id = p.organizer_user_id
      ) x), '[]'::jsonb),
    'host_names', (SELECT string_agg(p.display_name, ' × ' ORDER BY p.ord, p.party_key)
                     FROM public.event_parties(p_event_id) p),
    'parties', (SELECT count(*) FROM public.event_parties(p_event_id))
  );
$$;

-- Page publique : « Présenté par A × B × C ».
CREATE OR REPLACE FUNCTION public.get_event_presenters(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', p.kind, 'name', p.display_name, 'slug', p.slug, 'avatar_url', p.avatar_url,
           'venue_id', p.venue_id, 'organizer_user_id', p.organizer_user_id, 'role', p.role
         ) ORDER BY p.ord, p.party_key), '[]'::jsonb)
    FROM public.event_parties(p_event_id) p
    LEFT JOIN public.organizer_profiles op ON op.user_id = p.organizer_user_id
    LEFT JOIN public.venues v ON v.id = p.venue_id
   WHERE (p.kind = 'org' AND COALESCE(op.is_public, true))
      OR (p.kind = 'venue' AND v.decommissioned_at IS NULL);
$$;

-- Suivre tous les hôtes d'un coup (organisateurs + clubs), depuis la soirée.
-- Même source de suivi que la page profil (le trigger d'abonnement la lit).
CREATE OR REPLACE FUNCTION public.follow_event_hosts(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); p record; v_n integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM set_config('yuno.follow_source', 'event_hosts', true);
  FOR p IN SELECT * FROM public.event_parties(p_event_id) LOOP
    IF p.kind = 'org' THEN
      IF NOT EXISTS (SELECT 1 FROM public.organizer_profile_followers f
                      WHERE f.organizer_user_id = p.organizer_user_id AND f.user_id = v_uid)
         AND p.organizer_user_id <> v_uid THEN
        INSERT INTO public.organizer_profile_followers (organizer_user_id, user_id) VALUES (p.organizer_user_id, v_uid);
        v_n := v_n + 1;
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.favorites f
                      WHERE f.venue_id = p.venue_id AND f.user_id = v_uid AND f.favorite_type = 'club') THEN
        INSERT INTO public.favorites (user_id, favorite_type, venue_id) VALUES (v_uid, 'club', p.venue_id);
        v_n := v_n + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- L'appelant suit-il déjà tous les hôtes ?
CREATE OR REPLACE FUNCTION public.follows_all_event_hosts(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_parties(p_event_id) p
     WHERE (p.kind = 'org' AND p.organizer_user_id <> auth.uid() AND NOT EXISTS (
              SELECT 1 FROM public.organizer_profile_followers f
               WHERE f.organizer_user_id = p.organizer_user_id AND f.user_id = auth.uid()))
        OR (p.kind = 'venue' AND NOT EXISTS (
              SELECT 1 FROM public.favorites f
               WHERE f.venue_id = p.venue_id AND f.user_id = auth.uid() AND f.favorite_type = 'club'))
  );
$$;

-- ─── 13. Droits d'exécution ─────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.coorg_party_level(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notify_coorg_party(text, uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._coorg_compute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._coorg_yuno_legs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._coorg_touch_settlement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_event_host_followers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cohost_event_ids_org(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cohost_event_ids_venue(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coorg_marketing_event_ids(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_parties(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_coorg_partners(text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_event_host_followers(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.coorg_marketing_event_ids(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_marketing_hosts(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_event_marketing_consent(uuid, text, text, text, text, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_presenters(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cohost_org_ids(public.events) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cohost_venue_ids(public.events) TO anon, authenticated;
