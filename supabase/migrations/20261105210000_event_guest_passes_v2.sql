-- ============================================================================
-- L'espace INVITÉ d'une soirée (v2) : club ou organisation, six onglets
-- ============================================================================
-- Plan : docs/designs/EVENT_HOST_PASS_PLAN.md §9 (structure validée par Paul
-- le 20/10, maquette docs/designs/mockups/espace-invite-soiree.html). Remplace
-- la page unique de 20261105200000 : la table (vide hors démo) est renommée
-- `event_guest_passes`, l'invité peut être un CLUB ou une ORGANISATION, et
-- l'espace a de vraies écritures par le lien :
--   • ajouter ses invités dans la part de guest list que l'organisateur lui a
--     donnée, en demander plus ;
--   • créer ses liens de vente suivis (attribués à l'invité, jamais à l'orga) ;
--   • valider ou contester le décompte (un avis : aucun argent ne bouge).
-- L'IBAN et la confirmation d'un virement exigent la CONNEXION de la partie
-- invitée (RPC existantes) : un IBAN saisi par quiconque tient le lien
-- détournerait l'argent.
--
-- L'argent : l'invité ne voit que SA part (décision de Paul du 20/10), jamais
-- celle des autres parties.
-- Qui fait vendre : lien d'une partie (ou d'un de ses promoteurs) → la
-- partie ; lien de l'invité → l'invité ; arrivée par Yuno (attribution
-- `marketplace`) → « Yuno » ; le reste → « Direct ».
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. La v1 s'en va (aucun lecteur en prod : le front n'est pas déployé).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_event_host_pass(text);
DROP FUNCTION IF EXISTS public.track_event_host_pass(text, text);
DROP FUNCTION IF EXISTS public.claim_event_host_pass(text, text);
DROP FUNCTION IF EXISTS public.create_event_host_pass(uuid, text, text, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.update_event_host_pass(uuid, boolean, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.list_event_host_passes(uuid);
DROP FUNCTION IF EXISTS public.prepare_event_host_pass_email(uuid);
DROP FUNCTION IF EXISTS public._host_pass_payload(public.event_host_passes);
DROP FUNCTION IF EXISTS public._host_pass_alert(public.event_host_passes, text, text);
DROP FUNCTION IF EXISTS public._host_pass_manager(uuid);
DROP TRIGGER IF EXISTS trg_event_host_passes_guard ON public.event_host_passes;
DROP FUNCTION IF EXISTS public.event_host_passes_guard();

ALTER TABLE public.event_host_passes RENAME TO event_guest_passes;
ALTER TABLE public.event_host_pass_opens RENAME TO event_guest_pass_opens;
ALTER TABLE public.event_guest_passes RENAME COLUMN venue_name TO guest_name;
ALTER INDEX IF EXISTS event_host_passes_event_idx RENAME TO event_guest_passes_event_idx;
ALTER INDEX IF EXISTS event_host_passes_live_name_key RENAME TO event_guest_passes_live_name_key;
ALTER INDEX IF EXISTS event_host_pass_opens_pass_idx RENAME TO event_guest_pass_opens_pass_idx;
ALTER INDEX IF EXISTS event_host_pass_opens_visitor_idx RENAME TO event_guest_pass_opens_visitor_idx;

ALTER TABLE public.event_guest_passes
  DROP COLUMN IF EXISTS claimed_venue_id,
  ADD COLUMN IF NOT EXISTS guest_kind text NOT NULL DEFAULT 'venue' CHECK (guest_kind IN ('venue', 'org')),
  ADD COLUMN IF NOT EXISTS guest_party text CHECK (guest_party IS NULL OR guest_party ~ '^(venue:.+|org:[0-9a-f-]{36})$'),
  ADD COLUMN IF NOT EXISTS share_tickets_pct numeric CHECK (share_tickets_pct IS NULL OR share_tickets_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS share_tables_pct numeric CHECK (share_tables_pct IS NULL OR share_tables_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS statement_response text CHECK (statement_response IS NULL OR statement_response IN ('approved', 'contested')),
  ADD COLUMN IF NOT EXISTS statement_reason text CHECK (statement_reason IS NULL OR char_length(statement_reason) <= 500),
  ADD COLUMN IF NOT EXISTS statement_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS places_requested integer,
  ADD COLUMN IF NOT EXISTS places_requested_at timestamptz;

ALTER TABLE public.event_guest_passes DROP CONSTRAINT IF EXISTS event_host_passes_venue_name_check;
ALTER TABLE public.event_guest_passes DROP CONSTRAINT IF EXISTS event_guest_passes_guest_name_check;
ALTER TABLE public.event_guest_passes ADD CONSTRAINT event_guest_passes_guest_name_check
  CHECK (char_length(guest_name) BETWEEN 1 AND 80);

ALTER TABLE public.event_guest_pass_opens DROP CONSTRAINT IF EXISTS event_host_pass_opens_action_check;
ALTER TABLE public.event_guest_pass_opens ADD CONSTRAINT event_guest_pass_opens_action_check
  CHECK (action IN ('open', 'signup', 'whatsapp', 'copy', 'share', 'guest', 'link', 'statement', 'places', 'staff'));

COMMENT ON TABLE public.event_guest_passes IS
  'Espace invité d''une soirée (club ou organisation, nom visible à nommer) : /h/<jeton>, sans compte pour regarder. RLS sans policy, tout par les RPC *_event_guest_pass* / guest_pass_*.';

CREATE OR REPLACE FUNCTION public.event_guest_passes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.token := replace(gen_random_uuid()::text, '-', '');
  ELSE
    NEW.token := OLD.token;
    NEW.event_id := OLD.event_id;
    NEW.guest_kind := OLD.guest_kind;
    NEW.created_by_party := OLD.created_by_party;
    NEW.updated_at := now();
  END IF;
  NEW.guest_name := btrim(regexp_replace(NEW.guest_name, '\s+', ' ', 'g'));
  NEW.contact_email := nullif(lower(btrim(NEW.contact_email)), '');
  NEW.contact_phone := nullif(btrim(NEW.contact_phone), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.event_guest_passes_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_event_guest_passes_guard
  BEFORE INSERT OR UPDATE ON public.event_guest_passes
  FOR EACH ROW EXECUTE FUNCTION public.event_guest_passes_guard();

-- ---------------------------------------------------------------------------
-- 1. Liens de vente de l'invité (plusieurs) et sa part de guest list.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracked_links
  ADD COLUMN IF NOT EXISTS guest_pass_id uuid REFERENCES public.event_guest_passes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tracked_links_guest_pass_idx ON public.tracked_links (guest_pass_id) WHERE guest_pass_id IS NOT NULL;
COMMENT ON COLUMN public.tracked_links.guest_pass_id IS
  'Lien de vente d''un INVITÉ de la soirée (event_guest_passes) : ses ventes lui sont attribuées, jamais à l''organisateur qui possède la ligne.';

ALTER TABLE public.tracked_links DROP CONSTRAINT IF EXISTS tracked_links_partner_chk;
ALTER TABLE public.tracked_links ADD CONSTRAINT tracked_links_partner_chk CHECK (
  partner_name IS NULL OR (
    owner_kind IN ('venue', 'organizer')
    AND target_kind = 'event'
    AND char_length(partner_name) BETWEEN 1 AND 60
    AND partner_role IN ('promoter', 'dj', 'artist', 'ambassador', 'other', 'venue', 'organization')
    AND partner_token ~ '^[0-9a-f]{32}$'
    AND (partner_contact IS NULL OR char_length(partner_contact) <= 120)
    AND partner_language IN ('en', 'fr', 'es')
  )
);

ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS guest_pass_id uuid REFERENCES public.event_guest_passes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_guest_pass_key ON public.guest_lists (guest_pass_id) WHERE guest_pass_id IS NOT NULL;
COMMENT ON COLUMN public.guest_lists.guest_pass_id IS
  'Part de guest list DONNÉE par l''organisateur à un invité de la soirée (event_guest_passes) : l''invité la remplit par son espace, jamais il ne la crée.';

-- ---------------------------------------------------------------------------
-- 2. Qui gère : une partie PRINCIPALE, niveau ≥ 2.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._guest_pass_manager(p_event_id uuid)
RETURNS TABLE(party_key text, level integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session_forbidden'; END IF;
  SELECT * INTO v_me FROM public.my_event_party(p_event_id);
  IF v_me.party_key IS NULL OR v_me.role NOT IN ('lead', 'partner') OR v_me.level < 2 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  party_key := v_me.party_key;
  level := v_me.level;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_manager(uuid) FROM PUBLIC, anon, authenticated;

-- Le pass d'un jeton vivant (ni coupé, ni fermé 7 jours après la fin).
CREATE OR REPLACE FUNCTION public._guest_pass_live(p_token text)
RETURNS public.event_guest_passes
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass public.event_guest_passes%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_pass FROM public.event_guest_passes WHERE token = p_token;
  IF NOT FOUND OR v_pass.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_pass.event_id
              AND now() > coalesce(e.end_at, e.start_at + interval '8 hours') + interval '7 days') THEN
    RAISE EXCEPTION 'closed';
  END IF;
  RETURN v_pass;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_live(text) FROM PUBLIC, anon, authenticated;

-- Anti-flood des écritures par lien : 60 gestes / heure / visiteur.
CREATE OR REPLACE FUNCTION public._guest_pass_note(p_pass_id uuid, p_action text, p_dedup interval DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM public.links_visitor_context();
  IF (SELECT count(*) FROM public.event_guest_pass_opens o
       WHERE o.visitor_hash = v_ctx.o_hash AND o.created_at > now() - interval '1 hour') >= 60 THEN
    RETURN false;
  END IF;
  IF p_dedup IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.event_guest_pass_opens o
     WHERE o.pass_id = p_pass_id AND o.action = p_action AND o.visitor_hash = v_ctx.o_hash
       AND o.created_at > now() - p_dedup) THEN
    RETURN false;
  END IF;
  INSERT INTO public.event_guest_pass_opens (pass_id, visitor_hash, action) VALUES (p_pass_id, v_ctx.o_hash, p_action);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_note(uuid, text, interval) FROM PUBLIC, anon, authenticated;

-- L'équipe de la soirée qui regarde l'espace ne compte jamais.
CREATE OR REPLACE FUNCTION public._guest_pass_is_team(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.is_super_admin() OR EXISTS (
       SELECT 1 FROM public.my_event_party(p_event_id) m WHERE m.role IN ('lead', 'partner')));
$$;
REVOKE ALL ON FUNCTION public._guest_pass_is_team(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Alerte super admin (jamais pour la démo, une fois par clé).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._guest_pass_alert(p_pass public.event_guest_passes, p_kind text, p_dedup text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_org   text;
BEGIN
  IF p_pass.event_id = ANY (public.demo_event_ids()) THEN RETURN; END IF;
  SELECT e.title INTO v_title FROM public.events e WHERE e.id = p_pass.event_id;
  SELECT p.display_name INTO v_org FROM public.event_parties(p_pass.event_id) p WHERE p.party_key = p_pass.created_by_party;
  PERFORM public.emit_admin_notification(
    CASE WHEN p_kind = 'claimed' THEN 'admin_host_pass_claimed' ELSE 'admin_host_pass_lead' END,
    CASE p_kind
      WHEN 'open' THEN 'Un invité ouvre son espace'
      WHEN 'hot' THEN 'Invité d''une soirée : prospect chaud'
      WHEN 'signup' THEN 'Invité : « Ouvrir le compte »'
      WHEN 'claimed' THEN 'Invité : compte ouvert'
      ELSE 'Invité d''une soirée' END,
    p_pass.guest_name || CASE p_pass.guest_kind WHEN 'venue' THEN ' (club)' ELSE ' (organisation)' END
      || ' — ' || coalesce(v_title, 'soirée') || coalesce(' (par ' || v_org || ')', '')
      || CASE p_kind
           WHEN 'open' THEN ' : première ouverture de l''espace.'
           WHEN 'hot' THEN ' : ' || p_pass.opened_count || ' ouvertures.'
           WHEN 'signup' THEN ' : a cliqué « Ouvrir le compte ».'
           WHEN 'claimed' THEN ' : a ouvert son compte Yuno.'
           ELSE '.' END,
    CASE WHEN p_kind IN ('signup', 'claimed', 'hot') THEN 'high' ELSE 'normal' END,
    'guest_pass', p_pass.id::text,
    jsonb_build_object('kind', p_kind, 'guest_kind', p_pass.guest_kind, 'guest_name', p_pass.guest_name,
                       'contact_email', p_pass.contact_email, 'contact_phone', p_pass.contact_phone,
                       'opened_count', p_pass.opened_count, 'organizer', v_org, 'event_title', v_title),
    p_dedup, p_pass.event_id);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_guest_pass_alert: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_alert(public.event_guest_passes, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Un lien de vente de l'invité (canal : direct, story, bio, whatsapp, autre).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._guest_pass_add_link(p_pass public.event_guest_passes, p_channel text, p_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := split_part(p_pass.created_by_party, ':', 1);
  v_id   text := substr(p_pass.created_by_party, length(split_part(p_pass.created_by_party, ':', 1)) + 2);
  v_link uuid;
  v_code text;
  v_base text;
  v_suffix text := CASE p_channel WHEN 'story' THEN 'insta' WHEN 'bio' THEN 'bio' WHEN 'whatsapp' THEN 'whatsapp'
                                  WHEN 'other' THEN 'lien' ELSE NULL END;
  v_owner uuid;
BEGIN
  IF p_channel NOT IN ('direct', 'story', 'bio', 'whatsapp', 'other') THEN RAISE EXCEPTION 'invalid_channel'; END IF;
  -- Le lien appartient à la partie qui a invité (portée du lien suivi), au nom
  -- de l'invité (lien partenaire) ; c'est guest_pass_id qui l'attribue à l'invité.
  v_owner := coalesce(p_by, p_pass.created_by,
                      CASE WHEN v_kind = 'org' THEN v_id::uuid END,
                      (SELECT v.owner_id FROM public.venues v WHERE v.id = v_id));
  INSERT INTO public.tracked_links (code, label, owner_kind, venue_id, organizer_user_id, created_by,
                                    target_kind, event_id, utm_source, utm_medium,
                                    partner_name, partner_role, partner_contact, partner_language,
                                    partner_shows_revenue, guest_pass_id)
  VALUES ('', left(p_pass.guest_name, 60),
          CASE WHEN v_kind = 'venue' THEN 'venue' ELSE 'organizer' END,
          CASE WHEN v_kind = 'venue' THEN v_id END,
          CASE WHEN v_kind = 'org' THEN v_id::uuid END,
          v_owner, 'event', p_pass.event_id, 'guest_' || p_channel, 'partner_link',
          left(p_pass.guest_name, 60), CASE p_pass.guest_kind WHEN 'venue' THEN 'venue' ELSE 'organization' END,
          left(coalesce(p_pass.contact_email, p_pass.contact_phone), 120), p_pass.language,
          p_pass.show_revenue, p_pass.id)
  RETURNING id, code INTO v_link, v_code;

  -- Un canal se lit dans l'adresse : « …-tia-felisa-insta ». Le code direct
  -- reste celui que la base a écrit.
  IF v_suffix IS NOT NULL THEN
    SELECT tl.code INTO v_base FROM public.tracked_links tl
     WHERE tl.guest_pass_id = p_pass.id AND tl.utm_source = 'guest_direct' ORDER BY tl.created_at LIMIT 1;
    v_base := coalesce(v_base, regexp_replace(v_code, '-[0-9]+$', ''));
    IF char_length(v_base || '-' || v_suffix) <= 60
       AND public.tracked_link_code_is_free(v_base || '-' || v_suffix, v_link) THEN
      UPDATE public.tracked_links SET code = v_base || '-' || v_suffix WHERE id = v_link;
    END IF;
  END IF;
  RETURN v_link;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_add_link(public.event_guest_passes, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. La part de guest list donnée à l'invité (créée, agrandie, réduite).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._guest_pass_set_places(p_pass public.event_guest_passes, p_places integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gl    public.guest_lists%ROWTYPE;
  v_kind  text := split_part(p_pass.created_by_party, ':', 1);
  v_id    text := substr(p_pass.created_by_party, length(split_part(p_pass.created_by_party, ':', 1)) + 2);
  v_taken integer;
BEGIN
  IF p_places IS NULL THEN RETURN; END IF;
  IF p_places < 0 OR p_places > 500 THEN RAISE EXCEPTION 'invalid_places'; END IF;
  SELECT * INTO v_gl FROM public.guest_lists WHERE guest_pass_id = p_pass.id;
  IF NOT FOUND THEN
    IF p_places = 0 THEN RETURN; END IF;
    INSERT INTO public.guest_lists (event_id, venue_id, organizer_user_id, quota, is_active, holder_type, holder_label,
                                    visible_on_club_page, guest_pass_id, entry_kind)
    VALUES (p_pass.event_id,
            CASE WHEN v_kind = 'venue' THEN v_id END,
            CASE WHEN v_kind = 'org' THEN v_id::uuid END,
            p_places, true, 'custom', left(p_pass.guest_name, 80), false, p_pass.id, 'normal');
    RETURN;
  END IF;
  SELECT count(*) INTO v_taken FROM public.guest_list_entries g WHERE g.guest_list_id = v_gl.id AND g.status <> 'cancelled';
  IF p_places < v_taken THEN RAISE EXCEPTION 'places_below_registered'; END IF;
  UPDATE public.guest_lists SET quota = p_places, is_active = p_places > 0, updated_at = now() WHERE id = v_gl.id;
END;
$$;
REVOKE ALL ON FUNCTION public._guest_pass_set_places(public.event_guest_passes, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Créer / modifier / lister les accès (partie principale, niveau ≥ 2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_event_guest_pass(
  p_event_id uuid,
  p_guest_kind text,
  p_guest_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_language text DEFAULT 'en',
  p_show_revenue boolean DEFAULT true,
  p_guest_list_places integer DEFAULT NULL,
  p_share_tickets_pct numeric DEFAULT NULL,
  p_share_tables_pct numeric DEFAULT NULL,
  p_guest_party text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_me    record;
  v_ev    record;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_name  text := btrim(regexp_replace(coalesce(p_guest_name, ''), '\s+', ' ', 'g'));
  v_lang  text := CASE WHEN p_language IN ('en', 'fr', 'es') THEN p_language ELSE 'en' END;
  v_money boolean;
  v_row   public.event_guest_passes%ROWTYPE;
  v_org_email text;
  v_org_phone text;
BEGIN
  SELECT * INTO v_me FROM public._guest_pass_manager(p_event_id);
  IF p_guest_kind NOT IN ('venue', 'org') THEN RAISE EXCEPTION 'invalid_kind'; END IF;

  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_ev.cancelled_at IS NOT NULL OR coalesce(v_ev.end_at, v_ev.start_at + interval '8 hours') < now() THEN
    RAISE EXCEPTION 'event_closed';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN RAISE EXCEPTION 'contact_required'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF v_phone IS NOT NULL AND (char_length(v_phone) > 40 OR regexp_replace(v_phone, '\D', '', 'g') !~ '^\d{6,15}$') THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF v_email IS NOT NULL
     AND (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF p_guest_party IS NOT NULL THEN
    IF split_part(p_guest_party, ':', 1) <> (CASE p_guest_kind WHEN 'venue' THEN 'venue' ELSE 'org' END)
       OR (p_guest_kind = 'venue' AND NOT EXISTS (SELECT 1 FROM public.venues v WHERE 'venue:' || v.id = p_guest_party AND v.decommissioned_at IS NULL))
       OR (p_guest_kind = 'org' AND NOT EXISTS (SELECT 1 FROM public.organizer_profiles op WHERE 'org:' || op.user_id = p_guest_party)) THEN
      RAISE EXCEPTION 'invalid_party';
    END IF;
    IF p_guest_party = v_me.party_key THEN RAISE EXCEPTION 'invalid_party'; END IF;
    IF (p_event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.coorg_party_is_demo(
         split_part(p_guest_party, ':', 1),
         (CASE WHEN p_guest_kind = 'venue' THEN substr(p_guest_party, 7) END),
         (CASE WHEN p_guest_kind = 'org' THEN substr(p_guest_party, 5)::uuid END)) THEN
      RAISE EXCEPTION 'demo_mismatch';
    END IF;
  END IF;
  IF (SELECT count(*) FROM public.event_guest_passes h WHERE h.event_id = p_event_id AND h.revoked_at IS NULL) >= 8 THEN
    RAISE EXCEPTION 'too_many_guest_passes';
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_guest_passes h
              WHERE h.event_id = p_event_id AND h.revoked_at IS NULL AND lower(h.guest_name) = lower(v_name)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  v_money := coalesce(p_show_revenue, true) AND v_me.level >= 3;
  SELECT u.email INTO v_org_email FROM auth.users u WHERE u.id = v_uid;
  v_org_phone := nullif(btrim(coalesce((SELECT pr.phone FROM public.profiles pr WHERE pr.id = v_uid), '')), '');

  INSERT INTO public.event_guest_passes (event_id, guest_kind, guest_name, contact_email, contact_phone, language, token,
                                         show_revenue, organizer_contact_email, organizer_contact_phone,
                                         created_by, created_by_party, guest_party,
                                         share_tickets_pct, share_tables_pct)
  VALUES (p_event_id, p_guest_kind, v_name, v_email, v_phone, v_lang, repeat('0', 32), v_money,
          left(v_org_email, 254), left(v_org_phone, 40), v_uid, v_me.party_key, p_guest_party,
          CASE WHEN v_me.level >= 3 THEN p_share_tickets_pct END,
          CASE WHEN v_me.level >= 3 THEN p_share_tables_pct END)
  RETURNING * INTO v_row;

  UPDATE public.event_guest_passes SET tracked_link_id = public._guest_pass_add_link(v_row, 'direct', v_uid)
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  PERFORM public._guest_pass_set_places(v_row, p_guest_list_places);

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'token', v_row.token,
                            'show_revenue', v_row.show_revenue, 'language', v_row.language);
END;
$$;
REVOKE ALL ON FUNCTION public.create_event_guest_pass(uuid, text, text, text, text, text, boolean, integer, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_guest_pass(uuid, text, text, text, text, text, boolean, integer, numeric, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_event_guest_pass(
  p_pass_id uuid,
  p_show_revenue boolean DEFAULT NULL,
  p_revoked boolean DEFAULT NULL,
  p_language text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_guest_list_places integer DEFAULT NULL,
  p_share_tickets_pct numeric DEFAULT NULL,
  p_share_tables_pct numeric DEFAULT NULL,
  p_clear_shares boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.event_guest_passes%ROWTYPE;
  v_me    record;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
BEGIN
  SELECT * INTO v_row FROM public.event_guest_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_me FROM public._guest_pass_manager(v_row.event_id);

  IF p_show_revenue IS TRUE AND NOT v_row.show_revenue AND v_me.level < 3 THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF (p_share_tickets_pct IS NOT NULL OR p_share_tables_pct IS NOT NULL OR p_clear_shares) AND v_me.level < 3 THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_language IS NOT NULL AND p_language NOT IN ('en', 'fr', 'es') THEN RAISE EXCEPTION 'invalid_language'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF v_email IS NOT NULL
     AND (v_row.event_id = ANY (public.demo_event_ids())) IS DISTINCT FROM public.is_demo_email(v_email) THEN
    RAISE EXCEPTION 'demo_mismatch';
  END IF;
  IF p_revoked IS FALSE AND v_row.revoked_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.event_guest_passes h
                  WHERE h.event_id = v_row.event_id AND h.revoked_at IS NULL AND h.id <> v_row.id
                    AND lower(h.guest_name) = lower(v_row.guest_name)) THEN
    RAISE EXCEPTION 'already_invited';
  END IF;

  UPDATE public.event_guest_passes SET
    show_revenue      = coalesce(p_show_revenue, show_revenue),
    revoked_at        = CASE WHEN p_revoked IS TRUE THEN coalesce(revoked_at, now())
                             WHEN p_revoked IS FALSE THEN NULL ELSE revoked_at END,
    language          = coalesce(p_language, language),
    contact_email     = coalesce(v_email, contact_email),
    contact_phone     = coalesce(v_phone, contact_phone),
    share_tickets_pct = CASE WHEN p_clear_shares THEN NULL ELSE coalesce(p_share_tickets_pct, share_tickets_pct) END,
    share_tables_pct  = CASE WHEN p_clear_shares THEN NULL ELSE coalesce(p_share_tables_pct, share_tables_pct) END,
    places_requested  = CASE WHEN p_guest_list_places IS NOT NULL THEN NULL ELSE places_requested END
  WHERE id = p_pass_id
  RETURNING * INTO v_row;

  PERFORM public._guest_pass_set_places(v_row, p_guest_list_places);
  UPDATE public.tracked_links
     SET partner_shows_revenue = v_row.show_revenue, partner_language = v_row.language
   WHERE guest_pass_id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'show_revenue', v_row.show_revenue,
                            'revoked', v_row.revoked_at IS NOT NULL, 'language', v_row.language);
END;
$$;
REVOKE ALL ON FUNCTION public.update_event_guest_pass(uuid, boolean, boolean, text, text, text, integer, numeric, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_event_guest_pass(uuid, boolean, boolean, text, text, text, integer, numeric, numeric, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_event_guest_passes(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me record;
BEGIN
  SELECT * INTO v_me FROM public._guest_pass_manager(p_event_id);
  RETURN jsonb_build_object(
    'ok', true,
    'can_show_revenue', v_me.level >= 3,
    'passes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id, 'guest_kind', h.guest_kind, 'guest_name', h.guest_name,
               'contact_email', h.contact_email, 'contact_phone', h.contact_phone,
               'language', h.language, 'token', h.token, 'show_revenue', h.show_revenue,
               'opened_count', h.opened_count, 'first_opened_at', h.first_opened_at, 'last_opened_at', h.last_opened_at,
               'email_sent_count', h.email_sent_count, 'email_sent_at', h.email_sent_at,
               'signup_clicks', h.signup_clicks, 'revoked', h.revoked_at IS NOT NULL, 'created_at', h.created_at,
               'share_tickets_pct', h.share_tickets_pct, 'share_tables_pct', h.share_tables_pct,
               'statement_response', h.statement_response, 'statement_reason', h.statement_reason,
               'statement_responded_at', h.statement_responded_at,
               'places_requested', h.places_requested, 'places_requested_at', h.places_requested_at,
               'guest_list', (SELECT jsonb_build_object('places', gl.quota,
                                'registered', (SELECT count(*) FROM public.guest_list_entries g
                                                WHERE g.guest_list_id = gl.id AND g.status <> 'cancelled'))
                                FROM public.guest_lists gl WHERE gl.guest_pass_id = h.id),
               'links', (SELECT count(*) FROM public.tracked_links tl WHERE tl.guest_pass_id = h.id),
               'link_clicks', (SELECT coalesce(sum(tl.clicks_count), 0) FROM public.tracked_links tl WHERE tl.guest_pass_id = h.id),
               'link_sales', (SELECT count(*) FROM public.tickets t JOIN public.tracked_links tl ON tl.id = t.tracked_link_id
                               WHERE tl.guest_pass_id = h.id AND t.status IN ('paid', 'used'))
                           + (SELECT count(*) FROM public.table_reservations r JOIN public.tracked_links tl ON tl.id = r.tracked_link_id
                               WHERE tl.guest_pass_id = h.id AND r.status IN ('paid', 'confirmed')),
               'guest_party', h.guest_party, 'claim_status', h.claim_status, 'claimed_at', h.claimed_at,
               'guest_party_name', (SELECT coalesce(v.name, op.display_name) FROM (SELECT 1) one
                                      LEFT JOIN public.venues v ON 'venue:' || v.id = h.guest_party
                                      LEFT JOIN public.organizer_profiles op ON 'org:' || op.user_id = h.guest_party),
               'guest_is_party', h.guest_party IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_parties(p_event_id) p WHERE p.party_key = h.guest_party),
               'guest_invited', h.guest_party IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.event_cohosts c
                  WHERE c.event_id = p_event_id AND c.status = 'pending'
                    AND ('venue:' || c.venue_id = h.guest_party OR 'org:' || c.organizer_user_id = h.guest_party))
             ) ORDER BY h.revoked_at IS NOT NULL, h.created_at DESC)
        FROM public.event_guest_passes h
       WHERE h.event_id = p_event_id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.list_event_guest_passes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_event_guest_passes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_event_guest_pass_email(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.event_guest_passes%ROWTYPE;
  v_ev  record;
  v_org text;
BEGIN
  SELECT * INTO v_row FROM public.event_guest_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM 1 FROM public._guest_pass_manager(v_row.event_id);
  IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v_row.contact_email IS NULL THEN RAISE EXCEPTION 'no_email'; END IF;
  IF v_row.email_sent_count >= 5 THEN RAISE EXCEPTION 'too_many_emails'; END IF;
  IF v_row.email_sent_at > now() - interval '10 minutes' THEN RAISE EXCEPTION 'email_too_soon'; END IF;

  SELECT e.title, e.start_at, coalesce(nullif(e.timezone, ''), 'Europe/Paris') AS tz,
         coalesce(e.poster_url, e.image_url) AS poster, e.location_name, e.location_city
    INTO v_ev FROM public.events e WHERE e.id = v_row.event_id;
  SELECT p.display_name INTO v_org FROM public.event_parties(v_row.event_id) p WHERE p.party_key = v_row.created_by_party;

  UPDATE public.event_guest_passes SET email_sent_count = email_sent_count + 1, email_sent_at = now() WHERE id = p_pass_id;

  RETURN jsonb_build_object(
    'ok', true, 'token', v_row.token, 'email', v_row.contact_email, 'language', v_row.language,
    'guest_kind', v_row.guest_kind, 'guest_name', v_row.guest_name, 'inviter_name', coalesce(v_org, 'Yuno'),
    'event_title', v_ev.title, 'event_start_at', v_ev.start_at, 'timezone', v_ev.tz,
    'poster_url', v_ev.poster, 'location_name', v_ev.location_name, 'location_city', v_ev.location_city,
    'is_demo', v_row.event_id = ANY (public.demo_event_ids()) OR public.is_demo_email(v_row.contact_email)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_event_guest_pass_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_event_guest_pass_email(uuid) TO authenticated;

-- Les accès de la v1 (démo seulement) : leur lien devient un lien d'invité.
UPDATE public.tracked_links tl SET guest_pass_id = h.id, utm_source = 'guest_direct'
  FROM public.event_guest_passes h
 WHERE h.tracked_link_id = tl.id AND tl.guest_pass_id IS NULL;
