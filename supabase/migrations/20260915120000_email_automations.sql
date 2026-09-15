-- ─────────────────────────────────────────────────────────────────────────────
-- Email automations — des recettes qui partent seules, dans le design du pro.
--
-- Pourquoi : un club à trois soirées par semaine n'écrit pas trois relances
-- par semaine. Les envois qui convertissent le mieux (panier abandonné,
-- dernier appel, merci d'être venu, on t'a manqué, bienvenue, reconquête,
-- renvoi aux non-ouvreurs) sont ceux que personne ne prend le temps de faire
-- à la main. Ici ils partent seuls, par le MÊME moteur que les campagnes
-- (file, quota, rodage, suppression, nuit, liens suivis, attribution).
--
-- Trois tables / colonnes :
--   · email_automations       : une ligne par (portée, recette) ;
--   · email_automation_sends  : le registre — une ligne par (automation,
--     déclencheur, email), raison d'exclusion écrite, évaluée AU MOMENT où
--     l'envoi est dû ; c'est lui qui interdit le doublon ;
--   · email_campaigns.automation_id / child_kind / resend_* : les campagnes
--     ENFANTS (une par automation et par soirée) et l'option « renvoyer aux
--     non-ouvreurs » d'une campagne ordinaire.
--
-- Doctrine (docs/designs/EMAIL_AUTOMATION_PLAN.md) :
--   · rien ne part hors du registre de consentement newsletter_subscriptions ;
--   · au plus UNE automatisation par contact et par 48 h par portée (le panier
--     abandonné, urgent, fait exception) ;
--   · un enfant sans soirée reliée perd ses blocs Yuno (jamais de chiffres
--     inventés) ;
--   · « merci » / « on t'a manqué » exigent au moins un scan sur la soirée.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonnes sur email_campaigns ─────────────────────────────────────────
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS child_kind text,
  ADD COLUMN IF NOT EXISTS automation_id uuid,
  ADD COLUMN IF NOT EXISTS automation_trigger_event_id uuid,
  ADD COLUMN IF NOT EXISTS resend_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resend_delay_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS resend_subject text,
  ADD COLUMN IF NOT EXISTS resend_campaign_id uuid REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resend_done_at timestamptz;

ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_child_kind_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_child_kind_check
  CHECK (child_kind IS NULL OR child_kind IN ('followup', 'resend', 'automation'));
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_resend_delay_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_resend_delay_check
  CHECK (resend_delay_hours BETWEEN 12 AND 168);

UPDATE public.email_campaigns SET child_kind = 'followup'
 WHERE parent_campaign_id IS NOT NULL AND child_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_campaigns_automation
  ON public.email_campaigns (automation_id) WHERE automation_id IS NOT NULL;

COMMENT ON COLUMN public.email_campaigns.child_kind IS
  'NULL = campagne ordinaire ; followup = relance après clic ; resend = renvoi aux non-ouvreurs ; automation = enfant d''une recette.';
COMMENT ON COLUMN public.email_campaigns.resend_enabled IS
  'Renvoyer la campagne, N h après la fin de l''envoi, aux destinataires qui ne l''ont pas ouverte (objet resend_subject).';
COMMENT ON COLUMN public.email_campaigns.resend_done_at IS
  'Le renvoi a été évalué (enfant créé ou personne à renvoyer) : on n''y revient plus.';

-- ── 2. Les recettes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'welcome', 'abandoned_checkout', 'last_call', 'post_event_thanks', 'post_event_missed', 'win_back'
  )),
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  -- Sens du délai selon la recette : après l'inscription (welcome), après le
  -- checkout (abandoned), AVANT le début (last_call), après la fin
  -- (post_event_*), sans venue (win_back, en heures : 90 j = 2160).
  delay_hours integer NOT NULL DEFAULT 24 CHECK (delay_hours BETWEEN 1 AND 8760),
  template_id uuid REFERENCES public.email_campaign_templates(id) ON DELETE SET NULL,
  subject text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_automations_owner_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  ),
  CONSTRAINT email_automations_subject_check CHECK (subject IS NULL OR char_length(subject) <= 200)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automations_venue_kind
  ON public.email_automations (venue_id, kind) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automations_org_kind
  ON public.email_automations (organizer_user_id, kind) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.email_campaigns
  DROP CONSTRAINT IF EXISTS email_campaigns_automation_id_fkey;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_automation_id_fkey
  FOREIGN KEY (automation_id) REFERENCES public.email_automations(id) ON DELETE SET NULL;

ALTER TABLE public.email_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners manage email automations" ON public.email_automations;
CREATE POLICY "Owners manage email automations"
  ON public.email_automations FOR ALL
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  )
  WITH CHECK (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

-- enabled_at : la date d'activation borne les déclencheurs (une bienvenue ne
-- part jamais à toute la base existante le jour où on allume la recette).
CREATE OR REPLACE FUNCTION public.email_automations_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.enabled, false) OR NEW.enabled_at IS NULL) THEN
    NEW.enabled_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_email_automations_before_write ON public.email_automations;
CREATE TRIGGER trg_email_automations_before_write
  BEFORE INSERT OR UPDATE ON public.email_automations
  FOR EACH ROW EXECUTE FUNCTION public.email_automations_before_write();

COMMENT ON TABLE public.email_automations IS
  'Recettes email automatiques (une par portée et par type) : interrupteur, délai, modèle Email Studio, objet.';

-- ── 3. Le registre ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_automation_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.email_automations(id) ON DELETE CASCADE,
  venue_id text,
  organizer_user_id uuid,
  kind text NOT NULL,
  -- id de la soirée déclencheuse, 'once' (bienvenue) ou 'wb-YYYY-MM' (reconquête).
  trigger_key text NOT NULL,
  trigger_event_id uuid,
  -- Soirée reliée à l'email enfant (blocs Yuno) — la prochaine date pour les
  -- recettes d'après-soirée, de bienvenue et de reconquête.
  bind_event_id uuid,
  email text NOT NULL,
  campaign_id uuid REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued', 'skipped')),
  skip_reason text CHECK (skip_reason IS NULL OR skip_reason IN (
    'bought', 'guest_list', 'unsubscribed', 'suppressed', 'no_consent', 'cooldown', 'event_over'
  )),
  due_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_automation_sends_key
  ON public.email_automation_sends (automation_id, trigger_key, lower(email));
CREATE INDEX IF NOT EXISTS idx_email_automation_sends_pending
  ON public.email_automation_sends (automation_id) WHERE status = 'queued' AND campaign_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_automation_sends_venue_recent
  ON public.email_automation_sends (venue_id, lower(email), created_at) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_automation_sends_org_recent
  ON public.email_automation_sends (organizer_user_id, lower(email), created_at) WHERE organizer_user_id IS NOT NULL;
ALTER TABLE public.email_automation_sends ENABLE ROW LEVEL SECURITY;
-- Aucune policy : le cron (service_role) écrit, les RPC de rapport lisent.
COMMENT ON TABLE public.email_automation_sends IS
  'Registre des automatisations email : une ligne par (recette, déclencheur, email), raison d''exclusion écrite. Interdit le doublon et porte la règle « une automatisation par 48 h ».';

-- ── 4. Prochaine soirée publiée d'une portée ────────────────────────────────
CREATE OR REPLACE FUNCTION public._email_automation_next_event(p_venue_id text, p_organizer_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT e.id
    FROM public.events e
   WHERE e.status IN ('published', 'featured')
     AND e.is_active
     AND e.cancelled_at IS NULL
     AND e.start_at > now()
     AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
   ORDER BY e.start_at ASC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._email_automation_next_event(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._email_automation_next_event(text, uuid) TO service_role, authenticated;

-- Blocs d'un modèle sans soirée reliée : les blocs Yuno partent, on ne
-- livre jamais des tarifs d'exemple à un vrai client.
CREATE OR REPLACE FUNCTION public._email_blocks_without_live(p_blocks jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(b) FROM jsonb_array_elements(COALESCE(p_blocks, '[]'::jsonb)) b
      WHERE COALESCE(b->>'type', '') NOT IN ('event', 'tickets', 'guestlist', 'table', 'countdown')),
    '[]'::jsonb
  )
$$;

-- ── 5. Le moteur (cron, service_role) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.collect_email_automations()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
  tpl RECORD;
  grp RECORD;
  v_delay interval;
  v_next uuid;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_automations integer := 0;
  v_children uuid[] := '{}';
  v_blocks jsonb;
  v_name text;
  v_label text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_email_automations: service_role only';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _auto_cand (
    em text,
    trigger_key text,
    trigger_event_id uuid,
    bind_event_id uuid,
    due_at timestamptz,
    optin boolean,
    user_id uuid,
    first_name text,
    last_name text
  ) ON COMMIT DROP;

  FOR a IN
    SELECT x.*
      FROM public.email_automations x
     WHERE x.enabled AND x.template_id IS NOT NULL AND x.enabled_at IS NOT NULL
     ORDER BY x.created_at
  LOOP
    v_automations := v_automations + 1;
    v_delay := make_interval(hours => a.delay_hours);
    v_next := public._email_automation_next_event(a.venue_id, a.organizer_user_id);
    TRUNCATE _auto_cand;

    -- ── 5a. Candidats par recette ─────────────────────────────────────────
    IF a.kind = 'welcome' THEN
      -- Nouvelles inscriptions au registre, hors imports (ils n'ont rien
      -- demandé) et hors achats (la confirmation de billet suffit).
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT lower(s.email), 'once', NULL, v_next, s.created_at + v_delay, true, s.user_id, s.first_name, s.last_name
        FROM public.newsletter_subscriptions s
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND s.import_id IS NULL
         AND COALESCE(s.source, '') NOT LIKE 'import%'
         AND COALESCE(s.source, '') NOT LIKE 'platform%'
         AND COALESCE(s.source, '') NOT LIKE 'checkout%'
         AND s.created_at >= a.enabled_at
         AND s.created_at >= now() - interval '14 days'
         AND s.created_at + v_delay <= now()
       LIMIT 500;

    ELSIF a.kind = 'abandoned_checkout' THEN
      -- Billet ou table lancés au checkout et jamais payés. L'accord marketing
      -- coché sur le formulaire (newsletter_opt_in) est versé au registre
      -- AVANT le jugement : la recette lit ensuite le registre comme les autres.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT DISTINCT ON (lower(x.em), x.event_id)
             lower(x.em), x.event_id::text, x.event_id, x.event_id, x.created_at + v_delay,
             x.optin, x.user_id, x.first_name, x.last_name
        FROM (
          SELECT t.user_email AS em, t.event_id, t.created_at, COALESCE(t.newsletter_opt_in, false) AS optin, t.user_id,
                 COALESCE(t.guest_first_name, NULLIF(split_part(btrim(COALESCE(t.full_name, '')), ' ', 1), '')) AS first_name,
                 COALESCE(t.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(t.full_name, ''), '^\S+\s*', '')), '')) AS last_name
            FROM public.tickets t
            JOIN public.events e ON e.id = t.event_id
           WHERE t.status = 'pending' AND t.user_email IS NOT NULL
             AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND t.created_at >= a.enabled_at
             AND t.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
          UNION ALL
          SELECT r.user_email, r.event_id, r.created_at, COALESCE(r.newsletter_opt_in, false), r.user_id,
                 COALESCE(r.guest_first_name, NULLIF(split_part(btrim(COALESCE(r.full_name, '')), ' ', 1), '')),
                 COALESCE(r.guest_last_name, NULLIF(btrim(regexp_replace(COALESCE(r.full_name, ''), '^\S+\s*', '')), ''))
            FROM public.table_reservations r
            JOIN public.events e ON e.id = r.event_id
           WHERE r.status = 'pending' AND r.user_email IS NOT NULL
             AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
               OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
             AND r.created_at >= a.enabled_at
             AND r.created_at BETWEEN now() - interval '48 hours' AND now() - v_delay
             AND e.start_at > now() + interval '1 hour'
        ) x
       ORDER BY lower(x.em), x.event_id, x.optin DESC, x.created_at DESC
       LIMIT 500;

      -- Versement de l'accord marketing dans le registre (même arbitre
      -- partiel que le trigger d'achat : lower(email) + colonne de portée).
      IF a.venue_id IS NOT NULL THEN
        INSERT INTO public.newsletter_subscriptions
          (user_id, venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.venue_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      ELSE
        INSERT INTO public.newsletter_subscriptions
          (user_id, organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
        SELECT c.user_id, a.organizer_user_id, c.em, true, 'checkout_started', 'ticketing', now(), c.first_name, c.last_name
          FROM _auto_cand c WHERE c.optin
        ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
          SET opted_in = true, opted_out_at = NULL,
              user_id    = COALESCE(EXCLUDED.user_id, public.newsletter_subscriptions.user_id),
              first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
              last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
              updated_at = now();
      END IF;

    ELSIF a.kind = 'last_call' THEN
      -- N h avant chaque soirée qui a encore quelque chose à vendre : toute la
      -- base opt-in, moins ceux qui ont déjà leur place (jugé plus bas).
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT lower(s.email), e.id::text, e.id, e.id, now(), true, s.user_id, s.first_name, s.last_name
        FROM public.events e
        JOIN public.newsletter_subscriptions s
          ON public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
       WHERE e.status IN ('published', 'featured') AND e.is_active AND e.cancelled_at IS NULL
         AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
           OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
         AND e.start_at > a.enabled_at
         AND e.start_at - v_delay <= now()
         AND e.start_at > now() + interval '2 hours'
         AND (
           (e.ticketing_enabled AND NOT e.tickets_sold_out)
           OR (e.tables_enabled AND NOT e.tables_sold_out)
           OR (NOT e.guest_list_sold_out AND EXISTS (
                 SELECT 1 FROM public.guest_lists gl
                  WHERE gl.event_id = e.id AND gl.is_active AND gl.visible_on_club_page AND NOT gl.manually_sold_out))
         )
       LIMIT 5000;

    ELSIF a.kind IN ('post_event_thanks', 'post_event_missed') THEN
      -- Soirées finies depuis N h (≤ 5 j), terminées après l'activation, et
      -- SCANNÉES : sans aucun scan on ne sait pas qui est venu, rien ne part.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT DISTINCT ON (lower(p.em), p.event_id)
             lower(p.em), p.event_id::text, p.event_id, v_next, now(), true, NULL, NULL, NULL
        FROM (
          WITH ev AS (
            SELECT e.id
              FROM public.events e
             WHERE e.status IN ('published', 'featured') AND e.cancelled_at IS NULL
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
               AND e.end_at >= a.enabled_at
               AND e.end_at + v_delay <= now()
               AND e.end_at >= now() - interval '5 days'
          ),
          came AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND (t.status = 'used' OR t.used OR COALESCE(t.entry_scanned, false))
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND ge.entry_scanned
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND (COALESCE(r.entry_scanned, false) OR r.checked_in_at IS NOT NULL)
          ),
          holders AS (
            SELECT t.event_id, lower(t.user_email) AS em FROM public.tickets t JOIN ev ON ev.id = t.event_id
             WHERE t.user_email IS NOT NULL AND t.status IN ('paid', 'used')
            UNION
            SELECT gl.event_id, lower(ge.email) FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN ev ON ev.id = gl.event_id
             WHERE ge.email IS NOT NULL AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
            UNION
            SELECT r.event_id, lower(r.user_email) FROM public.table_reservations r JOIN ev ON ev.id = r.event_id
             WHERE r.user_email IS NOT NULL AND r.status IN ('paid', 'used')
          ),
          scanned_events AS (SELECT DISTINCT event_id FROM came)
          SELECT c.event_id, c.em FROM came c WHERE a.kind = 'post_event_thanks'
          UNION ALL
          SELECT h.event_id, h.em FROM holders h
            JOIN scanned_events se ON se.event_id = h.event_id
           WHERE a.kind = 'post_event_missed'
             AND NOT EXISTS (SELECT 1 FROM came c WHERE c.event_id = h.event_id AND c.em = h.em)
        ) p
       ORDER BY lower(p.em), p.event_id
       LIMIT 5000;

    ELSIF a.kind = 'win_back' THEN
      -- Dernière venue entre N jours et N + 120 jours : le dormant récent, pas
      -- la base morte. Une fois par semestre et par personne.
      INSERT INTO _auto_cand (em, trigger_key, trigger_event_id, bind_event_id, due_at, optin, user_id, first_name, last_name)
      SELECT lower(s.email), 'wb-' || to_char(now(), 'YYYY-MM'), NULL, v_next, now(), true, s.user_id, s.first_name, s.last_name
        FROM public.newsletter_subscriptions s
        JOIN LATERAL (
          SELECT max(x.at) AS last_at FROM (
            SELECT t.created_at AS at FROM public.tickets t JOIN public.events e ON e.id = t.event_id
             WHERE lower(t.user_email) = lower(s.email) AND t.status IN ('paid', 'used')
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT r.created_at FROM public.table_reservations r JOIN public.events e ON e.id = r.event_id
             WHERE lower(r.user_email) = lower(s.email) AND r.status IN ('paid', 'used')
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
            UNION ALL
            SELECT ge.entry_scanned_at FROM public.guest_list_entries ge
              JOIN public.guest_lists gl ON gl.id = ge.guest_list_id JOIN public.events e ON e.id = gl.event_id
             WHERE lower(ge.email) = lower(s.email) AND ge.entry_scanned AND ge.entry_scanned_at IS NOT NULL
               AND ((a.venue_id IS NOT NULL AND e.venue_id = a.venue_id)
                 OR (a.organizer_user_id IS NOT NULL AND e.organizer_user_id = a.organizer_user_id))
          ) x
        ) act ON true
       WHERE public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
         AND s.opted_in AND s.opted_out_at IS NULL
         AND act.last_at IS NOT NULL
         AND act.last_at <= now() - v_delay
         AND act.last_at > now() - v_delay - interval '120 days'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_automation_sends l
            WHERE l.automation_id = a.id AND lower(l.email) = lower(s.email)
              AND l.created_at > now() - interval '180 days'
         )
       LIMIT 300;
    END IF;

    -- ── 5b. Jugement, au moment où l'envoi est dû ─────────────────────────
    WITH cand AS (
      SELECT DISTINCT ON (c.em, c.trigger_key) c.*
        FROM _auto_cand c
       WHERE NOT EXISTS (
         SELECT 1 FROM public.email_automation_sends l
          WHERE l.automation_id = a.id AND l.trigger_key = c.trigger_key AND lower(l.email) = c.em
       )
       ORDER BY c.em, c.trigger_key, c.optin DESC
    ),
    judged AS (
      SELECT c.*,
             CASE
               WHEN c.trigger_event_id IS NOT NULL AND a.kind IN ('last_call', 'abandoned_checkout') AND EXISTS (
                 SELECT 1 FROM public.events e WHERE e.id = c.trigger_event_id AND e.start_at <= now()
               ) THEN 'event_over'
               WHEN public.is_email_suppressed(c.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = c.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
               ) THEN CASE WHEN a.kind = 'abandoned_checkout' THEN 'no_consent' ELSE 'unsubscribed' END
               WHEN a.kind IN ('last_call', 'abandoned_checkout') AND (
                 EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = c.trigger_event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = c.em)
                 OR EXISTS (SELECT 1 FROM public.table_reservations r
                             WHERE r.event_id = c.trigger_event_id AND r.status IN ('paid', 'used') AND lower(r.user_email) = c.em)
               ) THEN 'bought'
               WHEN a.kind IN ('last_call', 'abandoned_checkout') AND EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                   JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = c.trigger_event_id AND lower(ge.email) = c.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               WHEN a.kind <> 'abandoned_checkout' AND EXISTS (
                 SELECT 1 FROM public.email_automation_sends l
                  WHERE l.status = 'queued' AND lower(l.email) = c.em
                    AND l.created_at > now() - interval '48 hours'
                    AND ((a.venue_id IS NOT NULL AND l.venue_id = a.venue_id)
                      OR (a.organizer_user_id IS NOT NULL AND l.organizer_user_id = a.organizer_user_id))
               ) THEN 'cooldown'
               ELSE NULL
             END AS reason
        FROM cand c
    ),
    ins AS (
      INSERT INTO public.email_automation_sends
        (automation_id, venue_id, organizer_user_id, kind, trigger_key, trigger_event_id, bind_event_id,
         email, status, skip_reason, due_at)
      SELECT a.id, a.venue_id, a.organizer_user_id, a.kind, j.trigger_key, j.trigger_event_id, j.bind_event_id,
             j.em, CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason, j.due_at
        FROM judged j
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT v_queued + count(*) FILTER (WHERE status = 'queued'), v_skipped + count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

    -- ── 5c. Campagnes enfants : une par (recette, soirée reliée, déclencheur) ──
    SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = a.template_id;
    IF tpl.id IS NULL THEN CONTINUE; END IF;

    FOR grp IN
      SELECT l.bind_event_id, l.trigger_event_id, count(*) AS n
        FROM public.email_automation_sends l
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
       GROUP BY l.bind_event_id, l.trigger_event_id
    LOOP
      -- Enfant existant ? Même soirée reliée et même déclencheur ; sans soirée
      -- du tout, un enfant par mois pour que le rapport reste lisible.
      SELECT c.id INTO v_child
        FROM public.email_campaigns c
       WHERE c.automation_id = a.id
         AND c.event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND c.automation_trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
         AND (grp.bind_event_id IS NOT NULL OR grp.trigger_event_id IS NOT NULL
              OR c.created_at >= date_trunc('month', now()))
         AND c.status NOT IN ('cancelled', 'failed')
       ORDER BY c.created_at DESC
       LIMIT 1;

      IF v_child IS NULL THEN
        SELECT COALESCE(e.title, '') INTO v_label
          FROM public.events e WHERE e.id = COALESCE(grp.trigger_event_id, grp.bind_event_id);
        IF v_label IS NULL OR v_label = '' THEN v_label := to_char(now(), 'YYYY-MM'); END IF;
        v_name := left(COALESCE(NULLIF(tpl.name, ''), a.kind) || ' · ' || v_label, 80);
        v_blocks := CASE WHEN grp.bind_event_id IS NULL
                         THEN public._email_blocks_without_live(tpl.blocks_json)
                         ELSE COALESCE(tpl.blocks_json, '[]'::jsonb) END;
        INSERT INTO public.email_campaigns
          (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
           theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
           quiet_hours, automation_id, automation_trigger_event_id, child_kind, total_recipients, created_by)
        VALUES
          (a.venue_id, a.organizer_user_id, v_name, 'promotional',
           COALESCE(NULLIF(a.subject, ''), NULLIF(tpl.subject, ''), tpl.name), COALESCE(tpl.preheader, ''),
           v_blocks, 2,
           COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
           grp.bind_event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
           true, a.id, grp.trigger_event_id, 'automation', 0, COALESCE(a.created_by, tpl.created_by))
        RETURNING id INTO v_child;
      END IF;

      WITH todo AS (
        SELECT l.id, lower(l.email) AS em
          FROM public.email_automation_sends l
         WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
           AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
           AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id
      ),
      ins AS (
        INSERT INTO public.email_campaign_recipients
          (campaign_id, email, first_name, last_name, unsubscribe_token, status)
        SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
          FROM todo t
          LEFT JOIN LATERAL (
            SELECT s.first_name, s.last_name, s.unsubscribe_token
              FROM public.newsletter_subscriptions s
             WHERE lower(s.email) = t.em
               AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, a.venue_id, a.organizer_user_id)
             LIMIT 1
          ) s ON true
        ON CONFLICT (campaign_id, lower(email)) DO NOTHING
        RETURNING 1
      )
      SELECT count(*) INTO v_new FROM ins;

      UPDATE public.email_automation_sends l
         SET campaign_id = v_child
       WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL
         AND l.bind_event_id IS NOT DISTINCT FROM grp.bind_event_id
         AND l.trigger_event_id IS NOT DISTINCT FROM grp.trigger_event_id;

      -- L'enfant repasse en vol (le worker le pose en 'sent' quand sa file se
      -- vide) ; le balayage du cron reprend une tranche.
      UPDATE public.email_campaigns
         SET status = 'sending', paused_reason = NULL, error_message = NULL,
             total_recipients = COALESCE(total_recipients, 0) + v_new
       WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

      v_enqueued := v_enqueued + v_new;
      v_children := array_append(v_children, v_child);
      v_child := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'automations', v_automations, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.collect_email_automations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_email_automations() TO service_role;

-- ── 6. Renvoi aux non-ouvreurs (cron, service_role) ─────────────────────────
-- N h après la fin de l'envoi d'une campagne ordinaire, le même email repart,
-- sous un autre objet, à ceux qui ne l'ont ni ouvert ni cliqué. Jamais à un
-- acheteur de la soirée, jamais après son début, jamais à un désabonné.
CREATE OR REPLACE FUNCTION public.collect_campaign_resends()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  v_child uuid;
  v_new integer;
  v_parents integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_resends: service_role only';
  END IF;

  FOR p IN
    SELECT c.*, e.start_at AS event_start_at
      FROM public.email_campaigns c
      LEFT JOIN public.events e ON e.id = c.event_id
     WHERE c.resend_enabled
       AND c.resend_done_at IS NULL
       AND c.resend_campaign_id IS NULL
       AND c.child_kind IS NULL
       AND c.parent_campaign_id IS NULL
       AND c.automation_id IS NULL
       AND c.status = 'sent'
       AND c.type = 'promotional'
       AND c.sent_at IS NOT NULL
       AND c.sent_at + make_interval(hours => c.resend_delay_hours) <= now()
       AND c.sent_at > now() - interval '10 days'
     ORDER BY c.sent_at
     LIMIT 20
  LOOP
    v_parents := v_parents + 1;

    -- Soirée déjà commencée : plus rien à renvoyer.
    IF p.event_start_at IS NOT NULL AND p.event_start_at <= now() + interval '2 hours' THEN
      UPDATE public.email_campaigns SET resend_done_at = now() WHERE id = p.id;
      CONTINUE;
    END IF;

    INSERT INTO public.email_campaigns
      (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
       theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
       quiet_hours, throttle_per_hour, throttle_window_minutes, parent_campaign_id, child_kind,
       total_recipients, created_by)
    VALUES
      (p.venue_id, p.organizer_user_id, left('Renvoi · ' || p.name, 80), 'promotional',
       COALESCE(NULLIF(p.resend_subject, ''), p.subject), COALESCE(p.preheader, ''),
       COALESCE(p.blocks_json, '[]'::jsonb), COALESCE(p.blocks_version, 1),
       COALESCE(p.theme_json, '{}'::jsonb), COALESCE(p.social_links_json, '{}'::jsonb), p.logo_url,
       p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
       true, p.throttle_per_hour, COALESCE(p.throttle_window_minutes, 60), p.id, 'resend',
       0, p.created_by)
    RETURNING id INTO v_child;

    WITH ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, user_id, status)
      SELECT v_child, r.email, r.first_name, r.last_name, r.unsubscribe_token, r.user_id, 'pending'
        FROM public.email_campaign_recipients r
       WHERE r.campaign_id = p.id
         AND r.status = 'sent'
         AND NOT EXISTS (
           SELECT 1 FROM public.email_campaign_events ev
            WHERE ev.campaign_id = p.id AND lower(ev.recipient_email) = lower(r.email)
              AND ev.event_type IN ('opened', 'clicked', 'bounced', 'complained', 'unsubscribed')
         )
         AND NOT public.is_email_suppressed(r.email)
         AND EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions s
            WHERE lower(s.email) = lower(r.email) AND s.opted_in AND s.opted_out_at IS NULL
              AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
         )
         AND (p.event_id IS NULL OR NOT (
           EXISTS (SELECT 1 FROM public.tickets t
                    WHERE t.event_id = p.event_id AND t.status IN ('paid', 'used') AND lower(t.user_email) = lower(r.email))
           OR EXISTS (SELECT 1 FROM public.table_reservations tr
                       WHERE tr.event_id = p.event_id AND tr.status IN ('paid', 'used') AND lower(tr.user_email) = lower(r.email))
           OR EXISTS (SELECT 1 FROM public.guest_list_entries ge
                        JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                       WHERE gl.event_id = p.event_id AND lower(ge.email) = lower(r.email)
                         AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected'))
         ))
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    IF v_new = 0 THEN
      -- Personne à renvoyer : l'enfant n'a pas lieu d'exister.
      DELETE FROM public.email_campaigns WHERE id = v_child;
      UPDATE public.email_campaigns SET resend_done_at = now() WHERE id = p.id;
      CONTINUE;
    END IF;

    UPDATE public.email_campaigns SET total_recipients = v_new WHERE id = v_child;
    UPDATE public.email_campaigns SET resend_campaign_id = v_child, resend_done_at = now() WHERE id = p.id;
    v_enqueued := v_enqueued + v_new;
    v_children := array_append(v_children, v_child);
  END LOOP;

  RETURN jsonb_build_object('parents', v_parents, 'enqueued', v_enqueued, 'children', to_jsonb(v_children));
END;
$$;
REVOKE ALL ON FUNCTION public.collect_campaign_resends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_campaign_resends() TO service_role;

-- ── 7. La relance après clic lit aussi les clics du renvoi ──────────────────
-- Corps repris de 20260910150000 ; seule différence : les clics repérés
-- viennent de la campagne mère ET de son renvoi aux non-ouvreurs.
CREATE OR REPLACE FUNCTION public.collect_campaign_followups()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  tpl RECORD;
  v_child uuid;
  v_new integer;
  v_queued integer := 0;
  v_skipped integer := 0;
  v_enqueued integer := 0;
  v_children uuid[] := '{}';
  v_parents integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'collect_campaign_followups: service_role only';
  END IF;

  FOR p IN
    SELECT c.id, c.name, c.venue_id, c.organizer_user_id, c.event_id, c.quiet_hours,
           c.followup_delay_hours AS delay_h, c.followup_template_id, c.followup_campaign_id,
           c.resend_campaign_id,
           e.start_at
      FROM public.email_campaigns c
      JOIN public.events e ON e.id = c.event_id
     WHERE c.followup_enabled
       AND c.parent_campaign_id IS NULL
       AND c.followup_template_id IS NOT NULL
       AND c.event_id IS NOT NULL
       AND c.status IN ('sent', 'sending', 'paused')
       AND c.type = 'promotional'
       AND e.start_at > now() - interval '7 days'
  LOOP
    v_parents := v_parents + 1;

    WITH clicks AS (
      SELECT lower(ev.recipient_email) AS em, min(ev.created_at) AS first_click
        FROM public.email_campaign_events ev
       WHERE ev.campaign_id IN (p.id, p.resend_campaign_id)
         AND ev.event_type = 'clicked'
         AND COALESCE(ev.metadata->'click'->>'link', ev.metadata->>'link', '')
             ~ '^https?://(www\.)?yunoapp\.eu/(l/|events?/|affiliate-event/|guest-list)'
         AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                      WHERE r.campaign_id = ev.campaign_id AND lower(r.email) = lower(ev.recipient_email))
       GROUP BY lower(ev.recipient_email)
    ),
    due AS (
      SELECT c.em, c.first_click, c.first_click + make_interval(hours => p.delay_h) AS due_at
        FROM clicks c
       WHERE c.first_click + make_interval(hours => p.delay_h) <= now()
         AND NOT EXISTS (SELECT 1 FROM public.email_campaign_followups f
                          WHERE f.parent_campaign_id = p.id AND lower(f.email) = c.em)
    ),
    judged AS (
      SELECT d.em, d.first_click, d.due_at,
             CASE
               WHEN d.due_at >= p.start_at THEN 'event_over'
               WHEN public.is_email_suppressed(d.em) THEN 'suppressed'
               WHEN NOT EXISTS (
                 SELECT 1 FROM public.newsletter_subscriptions s
                  WHERE lower(s.email) = d.em AND s.opted_in AND s.opted_out_at IS NULL
                    AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
               ) THEN 'unsubscribed'
               WHEN EXISTS (
                 SELECT 1 FROM public.tickets t
                  WHERE t.event_id = p.event_id AND t.status = 'paid' AND lower(t.user_email) = d.em
               ) OR EXISTS (
                 SELECT 1 FROM public.table_reservations r
                  WHERE r.event_id = p.event_id AND r.status = 'paid' AND lower(r.user_email) = d.em
               ) THEN 'bought'
               WHEN EXISTS (
                 SELECT 1 FROM public.guest_list_entries ge
                  JOIN public.guest_lists gl ON gl.id = ge.guest_list_id
                  WHERE gl.event_id = p.event_id AND lower(ge.email) = d.em
                    AND COALESCE(ge.status, '') NOT IN ('cancelled', 'refused', 'rejected')
               ) THEN 'guest_list'
               WHEN EXISTS (
                 SELECT 1 FROM public.email_campaign_followups f2
                  WHERE f2.event_id = p.event_id AND lower(f2.email) = d.em AND f2.status = 'queued'
               ) THEN 'already_event'
               ELSE NULL
             END AS reason
        FROM due d
    ),
    ins AS (
      INSERT INTO public.email_campaign_followups
        (parent_campaign_id, event_id, email, clicked_at, due_at, status, skip_reason)
      SELECT p.id, p.event_id, j.em, j.first_click, j.due_at,
             CASE WHEN j.reason IS NULL THEN 'queued' ELSE 'skipped' END, j.reason
        FROM judged j
      ON CONFLICT DO NOTHING
      RETURNING status
    )
    SELECT count(*) FILTER (WHERE status = 'queued'), count(*) FILTER (WHERE status = 'skipped')
      INTO v_queued, v_skipped FROM ins;

    SELECT count(*) INTO v_new
      FROM public.email_campaign_followups f
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;
    IF v_new = 0 THEN CONTINUE; END IF;

    v_child := p.followup_campaign_id;
    IF v_child IS NULL THEN
      SELECT * INTO tpl FROM public.email_campaign_templates WHERE id = p.followup_template_id;
      IF tpl.id IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.email_campaigns
        (venue_id, organizer_user_id, name, type, subject, preheader, blocks_json, blocks_version,
         theme_json, social_links_json, logo_url, event_id, status, audiences_json, exclusions_json,
         quiet_hours, parent_campaign_id, child_kind, total_recipients, created_by)
      VALUES
        (p.venue_id, p.organizer_user_id, 'Relance · ' || p.name, 'promotional',
         COALESCE(NULLIF(tpl.subject, ''), 'Relance'), COALESCE(tpl.preheader, ''),
         COALESCE(tpl.blocks_json, '[]'::jsonb), 2,
         COALESCE(tpl.theme_json, '{}'::jsonb), COALESCE(tpl.social_links_json, '{}'::jsonb), tpl.logo_url,
         p.event_id, 'sending', '[]'::jsonb, '{}'::jsonb,
         p.quiet_hours, p.id, 'followup', 0, tpl.created_by)
      RETURNING id INTO v_child;
      UPDATE public.email_campaigns SET followup_campaign_id = v_child WHERE id = p.id;
    END IF;

    WITH todo AS (
      SELECT f.id, lower(f.email) AS em
        FROM public.email_campaign_followups f
       WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL
    ),
    ins AS (
      INSERT INTO public.email_campaign_recipients
        (campaign_id, email, first_name, last_name, unsubscribe_token, status)
      SELECT v_child, t.em, s.first_name, s.last_name, s.unsubscribe_token, 'pending'
        FROM todo t
        LEFT JOIN LATERAL (
          SELECT s.first_name, s.last_name, s.unsubscribe_token
            FROM public.newsletter_subscriptions s
           WHERE lower(s.email) = t.em
             AND public.marketing_scope_match(s.venue_id, s.organizer_user_id, p.venue_id, p.organizer_user_id)
           LIMIT 1
        ) s ON true
      ON CONFLICT (campaign_id, lower(email)) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_new FROM ins;

    UPDATE public.email_campaign_followups f
       SET followup_campaign_id = v_child
     WHERE f.parent_campaign_id = p.id AND f.status = 'queued' AND f.followup_campaign_id IS NULL;

    UPDATE public.email_campaigns
       SET status = 'sending', paused_reason = NULL, error_message = NULL,
           total_recipients = COALESCE(total_recipients, 0) + v_new
     WHERE id = v_child AND status IN ('sent', 'sending', 'draft');

    v_enqueued := v_enqueued + v_new;
    v_children := array_append(v_children, v_child);
  END LOOP;

  RETURN jsonb_build_object(
    'parents', v_parents, 'queued', v_queued, 'skipped', v_skipped,
    'enqueued', v_enqueued, 'children', to_jsonb(v_children)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.collect_campaign_followups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_campaign_followups() TO service_role;

-- ── 8. Rapports ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._email_scope_guard(p_venue_id text, p_organizer_user_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = auth.uid() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unauthorized';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._email_scope_guard(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._email_scope_guard(text, uuid) TO authenticated, service_role;

-- Bilan par recette : file, exclus avec raison, envoyés / ouvertures / clics
-- cumulés sur les campagnes enfants, et leurs ids (le front y joint le revenu
-- attribué par get_email_campaign_attribution — une seule source de vérité).
CREATE OR REPLACE FUNCTION public.get_email_automation_stats(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.kind), '[]'::jsonb) INTO result
    FROM (
      SELECT a.id, a.kind, a.enabled, a.enabled_at, a.delay_hours, a.template_id, a.subject,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued' AND l.campaign_id IS NULL) AS pending,
             (SELECT count(*) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued') AS queued,
             (SELECT COALESCE(jsonb_object_agg(x.skip_reason, x.n), '{}'::jsonb)
                FROM (SELECT l.skip_reason, count(*) AS n FROM public.email_automation_sends l
                       WHERE l.automation_id = a.id AND l.status = 'skipped' GROUP BY l.skip_reason) x) AS skipped,
             (SELECT max(l.created_at) FROM public.email_automation_sends l
               WHERE l.automation_id = a.id AND l.status = 'queued') AS last_queued_at,
             (SELECT count(*) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS campaigns,
             (SELECT COALESCE(sum(c.recipients_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS sent,
             (SELECT COALESCE(sum(c.delivered_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS delivered,
             (SELECT COALESCE(sum(c.opens_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS opens,
             (SELECT COALESCE(sum(c.clickers_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS clickers,
             (SELECT COALESCE(sum(c.unsubscribes_count), 0) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS unsubscribes,
             (SELECT COALESCE(jsonb_agg(c.id), '[]'::jsonb) FROM public.email_campaigns c WHERE c.automation_id = a.id) AS campaign_ids
        FROM public.email_automations a
       WHERE (p_venue_id IS NOT NULL AND a.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND a.organizer_user_id = p_organizer_user_id)
    ) s;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_automation_stats(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_automation_stats(text, uuid) TO authenticated, service_role;

-- La meilleure heure de la base : ouvertures des 120 derniers jours par heure
-- et par jour de semaine, en heure de Paris. Le pro envoie quand SA base lit.
CREATE OR REPLACE FUNCTION public.get_email_send_time_insights(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample integer;
  v_by_hour jsonb;
  v_by_dow jsonb;
  v_best_hour integer;
  v_best_dow integer;
BEGIN
  PERFORM public._email_scope_guard(p_venue_id, p_organizer_user_id);

  CREATE TEMP TABLE IF NOT EXISTS _opens (h integer, d integer) ON COMMIT DROP;
  TRUNCATE _opens;
  INSERT INTO _opens (h, d)
  SELECT extract(hour from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer,
         extract(isodow from (ev.created_at AT TIME ZONE 'Europe/Paris'))::integer
    FROM public.email_campaign_events ev
    JOIN public.email_campaigns c ON c.id = ev.campaign_id
   WHERE ev.event_type = 'opened'
     AND ev.created_at > now() - interval '120 days'
     AND ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id));

  SELECT count(*) INTO v_sample FROM _opens;

  SELECT jsonb_agg(COALESCE(n, 0) ORDER BY g.h) INTO v_by_hour
    FROM generate_series(0, 23) AS g(h)
    LEFT JOIN (SELECT h, count(*) AS n FROM _opens GROUP BY h) o ON o.h = g.h;
  SELECT jsonb_agg(COALESCE(n, 0) ORDER BY g.d) INTO v_by_dow
    FROM generate_series(1, 7) AS g(d)
    LEFT JOIN (SELECT d, count(*) AS n FROM _opens GROUP BY d) o ON o.d = g.d;

  -- Meilleure heure = centre de la fenêtre de 2 h la plus ouverte.
  SELECT h INTO v_best_hour
    FROM (SELECT g.h, (SELECT count(*) FROM _opens o WHERE o.h IN (g.h, (g.h + 1) % 24)) AS n
            FROM generate_series(0, 23) AS g(h)) w
   ORDER BY n DESC, h ASC LIMIT 1;
  SELECT d INTO v_best_dow FROM (SELECT d, count(*) AS n FROM _opens GROUP BY d) x ORDER BY n DESC, d ASC LIMIT 1;

  RETURN jsonb_build_object(
    'sample', v_sample,
    'by_hour', COALESCE(v_by_hour, '[]'::jsonb),
    'by_dow', COALESCE(v_by_dow, '[]'::jsonb),
    'best_hour', CASE WHEN v_sample >= 30 THEN v_best_hour END,
    'best_dow', CASE WHEN v_sample >= 30 THEN v_best_dow END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_send_time_insights(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_send_time_insights(text, uuid) TO authenticated, service_role;

-- Bilan du renvoi aux non-ouvreurs, lu depuis le rapport de la campagne
-- mère (ou rattachement depuis l'enfant).
CREATE OR REPLACE FUNCTION public.get_campaign_resend_stats(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  parent RECORD;
  child RECORD;
  parent_id uuid;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  PERFORM public._email_scope_guard(c.venue_id, c.organizer_user_id);

  parent_id := CASE WHEN c.child_kind = 'resend' THEN c.parent_campaign_id ELSE c.id END;
  SELECT id, name, resend_enabled, resend_delay_hours, resend_subject, resend_campaign_id, resend_done_at, status, sent_at
    INTO parent FROM public.email_campaigns WHERE id = parent_id;
  IF parent.id IS NULL THEN RETURN NULL; END IF;

  SELECT id, name, status, recipients_count, delivered_count, opens_count, clicks_count, clickers_count,
         unsubscribes_count, bounced_count
    INTO child FROM public.email_campaigns WHERE id = parent.resend_campaign_id;

  RETURN jsonb_build_object(
    'parent_id', parent.id,
    'parent_name', parent.name,
    'is_child', c.child_kind = 'resend',
    'enabled', parent.resend_enabled,
    'delay_hours', parent.resend_delay_hours,
    'subject', parent.resend_subject,
    'done_at', parent.resend_done_at,
    'parent_sent_at', parent.sent_at,
    'nobody', parent.resend_done_at IS NOT NULL AND parent.resend_campaign_id IS NULL,
    'child', CASE WHEN child.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', child.id, 'name', child.name, 'status', child.status,
      'sent', COALESCE(child.recipients_count, 0), 'delivered', COALESCE(child.delivered_count, 0),
      'opens', COALESCE(child.opens_count, 0), 'clicks', COALESCE(child.clicks_count, 0),
      'clickers', COALESCE(child.clickers_count, 0), 'unsubscribes', COALESCE(child.unsubscribes_count, 0),
      'bounced', COALESCE(child.bounced_count, 0)
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_campaign_resend_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_campaign_resend_stats(uuid) TO authenticated, service_role;
