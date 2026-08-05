-- =====================================================================
-- Guest list agence — octroi (club) & répartition (agence).
--
--   CÔTÉ CLUB (propriétaire de la capacité de la porte) :
--     • set_agency_contract_gl_default    — fixe l'enveloppe STANDING du contrat.
--     • grant_agency_guestlist_allocation — octroie/écrase l'enveloppe d'UNE soirée.
--   CÔTÉ AGENCE (répartit entre SES promoteurs) :
--     • set_agency_guestlist_mode  — bascule partition ↔ pool.
--     • distribute_agency_guestlist — partition : sous-parts promoteur, somme ≤ enveloppe.
--
-- Le POOL n'a pas de RPC de répartition : la part 'agency' EST le pool, ses
-- promoteurs y ajoutent directement (edge promoter-add-guest), le trigger de
-- capacité garde le quota. La PARTITION matérialise des sous-parts 'promoter'
-- ordinaires, chacune gardée par le trigger ; l'invariant d'enveloppe est la
-- garde de somme ci-dessous.
-- =====================================================================

-- ── CLUB : enveloppe standing du contrat ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_agency_contract_gl_default(
  p_contract_id uuid,
  p_quota integer,                       -- NULL = aucune ; 0 = illimité ; N = places
  p_normal integer DEFAULT 0,
  p_drink integer DEFAULT 0,
  p_table integer DEFAULT 0,
  p_female integer DEFAULT NULL,
  p_male integer DEFAULT NULL,
  p_free_before time DEFAULT NULL,
  p_mode text DEFAULT 'partition'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.agency_venue_contracts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  SELECT * INTO v_c FROM public.agency_venue_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrat introuvable';
  END IF;

  -- Seul le CLUB (venue owner/manager ou organisateur) fixe l'enveloppe.
  IF NOT (
    (v_c.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), v_c.venue_id))
    OR (v_c.organizer_user_id IS NOT NULL AND public.can_manage_organizer(v_c.organizer_user_id))
    OR public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Seul le club peut fixer l''enveloppe guest list de l''agence';
  END IF;

  IF p_mode NOT IN ('partition', 'pool') THEN
    RAISE EXCEPTION 'Mode de répartition invalide';
  END IF;
  IF p_quota IS NOT NULL AND p_quota < 0 THEN
    RAISE EXCEPTION 'Quota d''enveloppe invalide';
  END IF;

  UPDATE public.agency_venue_contracts
     SET gl_default_quota  = p_quota,
         gl_default_normal = GREATEST(COALESCE(p_normal, 0), 0),
         gl_default_drink  = GREATEST(COALESCE(p_drink, 0), 0),
         gl_default_table  = GREATEST(COALESCE(p_table, 0), 0),
         gl_default_female = p_female,
         gl_default_male   = p_male,
         gl_default_free_before = p_free_before,
         gl_default_mode   = p_mode,
         updated_at = now()
   WHERE id = p_contract_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_agency_contract_gl_default(uuid, integer, integer, integer, integer, integer, integer, time, text) TO authenticated;

-- ── CLUB : octroi / écrasement de l'enveloppe d'UNE soirée ───────────────────
CREATE OR REPLACE FUNCTION public.grant_agency_guestlist_allocation(
  p_event_id uuid,
  p_agency_id uuid,
  p_quota integer,                       -- 0 = illimité ; N = places (NULL interdit : octroi explicite)
  p_normal integer DEFAULT 0,
  p_drink integer DEFAULT 0,
  p_table integer DEFAULT 0,
  p_female integer DEFAULT NULL,
  p_male integer DEFAULT NULL,
  p_free_before time DEFAULT NULL,
  p_mode text DEFAULT NULL                -- NULL = garder le mode existant, sinon défaut 'partition'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_e_venue text;
  v_e_org uuid;
  v_label text;
  v_total int;
  v_mode text;
  v_existing_mode text;
  v_gl_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  IF NOT public.can_manage_event_guestlist_house(v_uid, p_event_id) THEN
    RAISE EXCEPTION 'Seule la partie qui gère l''opérationnel peut octroyer une enveloppe';
  END IF;
  IF p_quota IS NULL OR p_quota < 0 THEN
    RAISE EXCEPTION 'Quota d''enveloppe invalide';
  END IF;

  SELECT venue_id, organizer_user_id INTO v_e_venue, v_e_org
  FROM public.events WHERE id = p_event_id;

  -- Un contrat Yuno ACTIF est requis (jamais d'enveloppe pour un club hors-contrat).
  IF NOT EXISTS (
    SELECT 1 FROM public.agency_venue_contracts c
    WHERE c.agency_id = p_agency_id AND c.status = 'active'
      AND ((v_e_venue IS NOT NULL AND c.venue_id = v_e_venue)
        OR (v_e_org  IS NOT NULL AND c.organizer_user_id = v_e_org))
  ) THEN
    RAISE EXCEPTION 'Aucun contrat actif avec cette agence pour cette soirée';
  END IF;

  SELECT name INTO v_label FROM public.agencies WHERE id = p_agency_id;

  v_total := GREATEST(COALESCE(p_normal, 0), 0) + GREATEST(COALESCE(p_drink, 0), 0) + GREATEST(COALESCE(p_table, 0), 0);
  IF v_total <= 0 THEN
    v_total := p_quota;
  END IF;

  SELECT agency_distribution_mode INTO v_existing_mode
  FROM public.guest_lists
  WHERE event_id = p_event_id AND agency_id = p_agency_id AND holder_type = 'agency';
  v_mode := COALESCE(p_mode, v_existing_mode, 'partition');
  IF v_mode NOT IN ('partition', 'pool') THEN
    RAISE EXCEPTION 'Mode de répartition invalide';
  END IF;

  INSERT INTO public.guest_lists
    (event_id, venue_id, organizer_user_id, holder_type, agency_id, holder_label,
     quota, quota_normal, quota_drink, quota_table, quota_female, quota_male,
     free_before_time, includes_drink, visible_on_club_page, is_active,
     agency_distribution_mode)
  VALUES
    (p_event_id, v_e_venue, v_e_org, 'agency', p_agency_id,
     COALESCE(NULLIF(btrim(v_label), ''), 'Agence'),
     v_total, GREATEST(COALESCE(p_normal, 0), 0), GREATEST(COALESCE(p_drink, 0), 0), GREATEST(COALESCE(p_table, 0), 0),
     p_female, p_male, COALESCE(p_free_before, '02:00'::time),
     (GREATEST(COALESCE(p_drink, 0), 0) > 0), false, true, v_mode)
  ON CONFLICT (event_id, agency_id) WHERE holder_type = 'agency'
  DO UPDATE SET
     quota            = EXCLUDED.quota,
     quota_normal     = EXCLUDED.quota_normal,
     quota_drink      = EXCLUDED.quota_drink,
     quota_table      = EXCLUDED.quota_table,
     quota_female     = EXCLUDED.quota_female,
     quota_male       = EXCLUDED.quota_male,
     free_before_time = EXCLUDED.free_before_time,
     includes_drink   = EXCLUDED.includes_drink,
     agency_distribution_mode = EXCLUDED.agency_distribution_mode,
     is_active = true
  RETURNING id INTO v_gl_id;

  RETURN v_gl_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_agency_guestlist_allocation(uuid, uuid, integer, integer, integer, integer, integer, integer, time, text) TO authenticated;

-- ── AGENCE : bascule du mode de répartition ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_agency_guestlist_mode(
  p_guest_list_id uuid,
  p_mode text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gl public.guest_lists%ROWTYPE;
  v_cnt int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  IF p_mode NOT IN ('partition', 'pool') THEN
    RAISE EXCEPTION 'Mode de répartition invalide';
  END IF;

  SELECT * INTO v_gl FROM public.guest_lists WHERE id = p_guest_list_id;
  IF NOT FOUND OR v_gl.holder_type <> 'agency' THEN
    RAISE EXCEPTION 'Enveloppe agence introuvable';
  END IF;
  IF NOT public.is_agency_owner(auth.uid(), v_gl.agency_id) THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;
  IF v_gl.agency_distribution_mode = p_mode THEN
    RETURN;
  END IF;

  IF p_mode = 'partition' THEN
    -- Des invités déjà posés dans le pool deviendraient orphelins.
    SELECT count(*) INTO v_cnt FROM public.guest_list_entries
     WHERE guest_list_id = p_guest_list_id AND status <> 'cancelled';
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'Des invités sont déjà inscrits dans le pool : videz-le avant de passer en partition'
        USING HINT = 'Annulez les invités du pool, puis basculez.';
    END IF;
  ELSE
    -- Des sous-parts promoteur distribuées deviendraient sans objet.
    SELECT count(*) INTO v_cnt FROM public.guest_lists sp
     WHERE sp.event_id = v_gl.event_id AND sp.holder_type = 'promoter' AND sp.is_active
       AND EXISTS (SELECT 1 FROM public.promoters p
                   WHERE p.id = sp.promoter_id AND p.agency_id = v_gl.agency_id);
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'Des sous-parts promoteur existent : remettez leurs quotas à zéro avant de passer en pool'
        USING HINT = 'Videz la répartition, puis basculez.';
    END IF;
  END IF;

  UPDATE public.guest_lists SET agency_distribution_mode = p_mode WHERE id = p_guest_list_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_agency_guestlist_mode(uuid, text) TO authenticated;

-- ── AGENCE : répartition en PARTITION (sous-parts promoteur, somme ≤ enveloppe) ─
CREATE OR REPLACE FUNCTION public.distribute_agency_guestlist(
  p_guest_list_id uuid,
  p_allocations jsonb                    -- [{promoter_id, normal, drink, table, female, male}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gl public.guest_lists%ROWTYPE;
  v_e_venue text;
  v_e_org uuid;
  v_sum_normal int := 0;
  v_sum_drink int := 0;
  v_sum_table int := 0;
  v_sum_female int := 0;
  v_sum_male int := 0;
  v_sum_total int := 0;
  a jsonb;
  v_pid uuid;
  v_n int; v_d int; v_t int; v_f int; v_m int; v_tot int;
  v_label text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT * INTO v_gl FROM public.guest_lists WHERE id = p_guest_list_id;
  IF NOT FOUND OR v_gl.holder_type <> 'agency' THEN
    RAISE EXCEPTION 'Enveloppe agence introuvable';
  END IF;
  IF NOT public.is_agency_owner(auth.uid(), v_gl.agency_id) THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;
  IF v_gl.agency_distribution_mode <> 'partition' THEN
    RAISE EXCEPTION 'La répartition n''est possible qu''en mode partition';
  END IF;

  -- 1) Somme des allocations demandées.
  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    v_sum_normal := v_sum_normal + GREATEST(COALESCE(NULLIF(a ->> 'normal', '')::int, 0), 0);
    v_sum_drink  := v_sum_drink  + GREATEST(COALESCE(NULLIF(a ->> 'drink', '')::int, 0), 0);
    v_sum_table  := v_sum_table  + GREATEST(COALESCE(NULLIF(a ->> 'table', '')::int, 0), 0);
    v_sum_female := v_sum_female + GREATEST(COALESCE(NULLIF(a ->> 'female', '')::int, 0), 0);
    v_sum_male   := v_sum_male   + GREATEST(COALESCE(NULLIF(a ->> 'male', '')::int, 0), 0);
  END LOOP;
  v_sum_total := v_sum_normal + v_sum_drink + v_sum_table;

  -- 2) Garde d'enveloppe (0/NULL sur l'enveloppe = illimité pour cette dimension).
  IF COALESCE(v_gl.quota_normal, 0) > 0 AND v_sum_normal > v_gl.quota_normal THEN
    RAISE EXCEPTION 'Places normales réparties (%) au-delà de l''enveloppe (%)', v_sum_normal, v_gl.quota_normal;
  END IF;
  IF COALESCE(v_gl.quota_drink, 0) > 0 AND v_sum_drink > v_gl.quota_drink THEN
    RAISE EXCEPTION 'Places conso réparties (%) au-delà de l''enveloppe (%)', v_sum_drink, v_gl.quota_drink;
  END IF;
  IF COALESCE(v_gl.quota_table, 0) > 0 AND v_sum_table > v_gl.quota_table THEN
    RAISE EXCEPTION 'Places table réparties (%) au-delà de l''enveloppe (%)', v_sum_table, v_gl.quota_table;
  END IF;
  IF COALESCE(v_gl.quota_female, 0) > 0 AND v_sum_female > v_gl.quota_female THEN
    RAISE EXCEPTION 'Places filles réparties (%) au-delà de l''enveloppe (%)', v_sum_female, v_gl.quota_female;
  END IF;
  IF COALESCE(v_gl.quota_male, 0) > 0 AND v_sum_male > v_gl.quota_male THEN
    RAISE EXCEPTION 'Places gars réparties (%) au-delà de l''enveloppe (%)', v_sum_male, v_gl.quota_male;
  END IF;
  IF v_gl.quota IS NOT NULL AND v_gl.quota > 0 AND v_sum_total > v_gl.quota THEN
    RAISE EXCEPTION 'Total réparti (%) au-delà de l''enveloppe (%)', v_sum_total, v_gl.quota;
  END IF;

  SELECT venue_id, organizer_user_id INTO v_e_venue, v_e_org
  FROM public.events WHERE id = v_gl.event_id;

  -- 3) Applique : upsert d'une sous-part promoteur par allocation.
  FOR a IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    v_pid := NULLIF(a ->> 'promoter_id', '')::uuid;
    IF v_pid IS NULL THEN
      CONTINUE;
    END IF;
    v_n := GREATEST(COALESCE(NULLIF(a ->> 'normal', '')::int, 0), 0);
    v_d := GREATEST(COALESCE(NULLIF(a ->> 'drink', '')::int, 0), 0);
    v_t := GREATEST(COALESCE(NULLIF(a ->> 'table', '')::int, 0), 0);
    v_f := GREATEST(COALESCE(NULLIF(a ->> 'female', '')::int, 0), 0);
    v_m := GREATEST(COALESCE(NULLIF(a ->> 'male', '')::int, 0), 0);
    v_tot := v_n + v_d + v_t;

    -- Éligibilité : promoteur de CETTE agence, assigné à la soirée.
    SELECT COALESCE(NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''), p.promo_code)
      INTO v_label
    FROM public.promoters p
    WHERE p.id = v_pid AND p.agency_id = v_gl.agency_id;
    IF v_label IS NULL THEN
      CONTINUE; -- pas un promoteur de l'agence
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.promoter_event_assignments pea
      WHERE pea.promoter_id = v_pid AND pea.event_id = v_gl.event_id
    ) THEN
      CONTINUE; -- pas assigné à la soirée
    END IF;

    IF v_tot <= 0 THEN
      -- Allocation nulle ⇒ retire la sous-part VIDE si elle existe.
      DELETE FROM public.guest_lists
       WHERE event_id = v_gl.event_id AND holder_type = 'promoter' AND promoter_id = v_pid
         AND NOT EXISTS (
           SELECT 1 FROM public.guest_list_entries e
           WHERE e.guest_list_id = guest_lists.id AND e.status <> 'cancelled'
         );
      CONTINUE;
    END IF;

    INSERT INTO public.guest_lists
      (event_id, venue_id, organizer_user_id, holder_type, promoter_id, holder_label,
       quota, quota_normal, quota_drink, quota_table, quota_female, quota_male,
       free_before_time, includes_drink, visible_on_club_page, is_active)
    VALUES
      (v_gl.event_id, v_e_venue, v_e_org, 'promoter', v_pid, v_label,
       v_tot, v_n, v_d, v_t, NULLIF(v_f, 0), NULLIF(v_m, 0),
       v_gl.free_before_time, (v_d > 0), false, true)
    ON CONFLICT (event_id, promoter_id) WHERE holder_type = 'promoter'
    DO UPDATE SET
       quota            = EXCLUDED.quota,
       quota_normal     = EXCLUDED.quota_normal,
       quota_drink      = EXCLUDED.quota_drink,
       quota_table      = EXCLUDED.quota_table,
       quota_female     = EXCLUDED.quota_female,
       quota_male       = EXCLUDED.quota_male,
       free_before_time = EXCLUDED.free_before_time,
       includes_drink   = EXCLUDED.includes_drink,
       is_active = true;

    UPDATE public.promoter_event_assignments
       SET can_access_guestlist = true
     WHERE promoter_id = v_pid AND event_id = v_gl.event_id
       AND can_access_guestlist IS DISTINCT FROM true;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.distribute_agency_guestlist(uuid, jsonb) TO authenticated;
