-- =====================================================================
-- Matérialisation de l'enveloppe guest list agence + garde du slot promoteur.
--
--   • create_agency_guestlist_part(agency, event) : sème une part 'agency'
--     depuis l'enveloppe STANDING du contrat actif. Idempotent (ON CONFLICT
--     DO NOTHING) ⇒ ne réécrit jamais une enveloppe ajustée (octroi par soirée).
--   • create_promoter_guestlist_part : GARDE — pour un promoteur d'AGENCE, on
--     ne matérialise PAS la part promoteur pilotée par le modèle du club. Ses
--     places viennent exclusivement de l'enveloppe agence (partition/pool),
--     sinon les deux se disputeraient l'index (event_id, promoter_id). C'est un
--     changement de comportement GUEST LIST, pas un changement du code argent.
--   • on_assignment_materialize_guestlist : à la 1re assignation d'un promoteur
--     d'agence sur une soirée (first-touch), matérialise aussi l'enveloppe.
--   • backfill idempotent des soirées à venir déjà reliées.
-- =====================================================================

-- ── Enveloppe agence : sème une part 'agency' depuis le contrat standing ─────
CREATE OR REPLACE FUNCTION public.create_agency_guestlist_part(
  p_agency_id uuid,
  p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_e_venue text;
  v_e_org uuid;
  v_c RECORD;
  v_label text;
  v_total int;
BEGIN
  -- Hôte de la soirée (club, ou organisateur pour une soirée org).
  SELECT venue_id, organizer_user_id INTO v_e_venue, v_e_org
  FROM public.events WHERE id = p_event_id;

  -- Contrat Yuno ACTIF de l'agence pour ce club/organisateur + ses défauts GL.
  SELECT c.gl_default_quota  AS quota,
         c.gl_default_normal AS normal,
         c.gl_default_drink  AS drink,
         c.gl_default_table  AS tbl,
         c.gl_default_female AS female,
         c.gl_default_male   AS male,
         c.gl_default_free_before AS free_before,
         c.gl_default_mode   AS mode
    INTO v_c
  FROM public.agency_venue_contracts c
  WHERE c.agency_id = p_agency_id
    AND c.status = 'active'
    AND ((v_e_venue IS NOT NULL AND c.venue_id = v_e_venue)
      OR (v_e_org  IS NOT NULL AND c.organizer_user_id = v_e_org))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN; -- pas de contrat actif ⇒ pas d'enveloppe (club externe/affilié inclus)
  END IF;

  IF v_c.quota IS NULL THEN
    RETURN; -- aucune enveloppe standing : le club octroiera par soirée
  END IF;

  SELECT name INTO v_label FROM public.agencies WHERE id = p_agency_id;

  -- Quota total = somme ventilée si présente, sinon le total brut (0 = illimité).
  v_total := COALESCE(v_c.normal, 0) + COALESCE(v_c.drink, 0) + COALESCE(v_c.tbl, 0);
  IF v_total <= 0 THEN
    v_total := v_c.quota;
  END IF;

  INSERT INTO public.guest_lists
    (event_id, venue_id, organizer_user_id, holder_type, agency_id, holder_label,
     quota, quota_normal, quota_drink, quota_table, quota_female, quota_male,
     free_before_time, includes_drink, visible_on_club_page, is_active,
     agency_distribution_mode)
  VALUES
    (p_event_id, v_e_venue, v_e_org, 'agency', p_agency_id,
     COALESCE(NULLIF(btrim(v_label), ''), 'Agence'),
     v_total, COALESCE(v_c.normal, 0), COALESCE(v_c.drink, 0), COALESCE(v_c.tbl, 0),
     v_c.female, v_c.male,
     COALESCE(v_c.free_before, '02:00'::time),
     (COALESCE(v_c.drink, 0) > 0), false, true,
     v_c.mode)
  ON CONFLICT (event_id, agency_id) WHERE holder_type = 'agency' DO NOTHING;
END;
$$;

-- ── create_promoter_guestlist_part : GARDE promoteur d'agence + corps 210000 ─
-- Corps identique à 20260722210000, précédé de la garde early-return. Un
-- promoteur d'agence (agency_id IS NOT NULL) n'obtient JAMAIS de part via le
-- modèle du club — ses places viennent de l'enveloppe agence.
CREATE OR REPLACE FUNCTION public.create_promoter_guestlist_part(
  p_promoter_id uuid,
  p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rules jsonb;
  v_alloc jsonb;
  v_types jsonb;
  v_normal int;
  v_drink int;
  v_table int;
  v_total int;
  v_female int;
  v_male int;
  v_free_before time;
  v_label text;
  v_p_venue text;
  v_p_org uuid;
  v_p_agency uuid;
  v_e_venue text;
  v_e_org uuid;
BEGIN
  -- Nom + scope + agency_id + rules du modèle explicite (s'il en a un).
  SELECT ct.rules,
         COALESCE(NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.promo_code),
         p.venue_id, p.organizer_user_id, p.agency_id
    INTO v_rules, v_label, v_p_venue, v_p_org, v_p_agency
  FROM public.promoters p
  LEFT JOIN public.commission_templates ct ON ct.id = p.default_commission_template_id
  WHERE p.id = p_promoter_id
    AND p.is_active;

  IF v_label IS NULL THEN
    RETURN; -- promoteur introuvable ou inactif
  END IF;

  -- GARDE : promoteur d'agence ⇒ places via l'enveloppe agence, pas le modèle club.
  IF v_p_agency IS NOT NULL THEN
    RETURN;
  END IF;

  v_alloc := v_rules -> 'guestlist_allocation';

  -- Repli : modèle PAR DÉFAUT du club / organisateur du promoteur.
  IF v_alloc IS NULL THEN
    SELECT ct.rules -> 'guestlist_allocation' INTO v_alloc
    FROM public.commission_templates ct
    WHERE ct.is_default
      AND ((v_p_venue IS NOT NULL AND ct.venue_id = v_p_venue)
        OR (v_p_org IS NOT NULL AND ct.organizer_user_id = v_p_org))
    LIMIT 1;
  END IF;

  IF v_alloc IS NULL THEN
    RETURN; -- aucune allocation (ni modèle explicite, ni défaut)
  END IF;

  v_types := v_alloc -> 'types';
  v_normal := COALESCE(NULLIF(v_types -> 'normal' ->> 'spots', '')::int, 0);
  v_drink  := COALESCE(NULLIF(v_types -> 'drink'  ->> 'spots', '')::int, 0);
  v_table  := COALESCE(NULLIF(v_types -> 'table'  ->> 'spots', '')::int, 0);
  IF v_types IS NULL THEN
    v_normal := COALESCE(NULLIF(v_alloc ->> 'spots', '')::int, 0);
  END IF;

  v_total := v_normal + v_drink + v_table;
  IF v_total <= 0 THEN
    RETURN;
  END IF;

  v_female := COALESCE(NULLIF(v_alloc -> 'gender' ->> 'female', '')::int, 0);
  v_male   := COALESCE(NULLIF(v_alloc -> 'gender' ->> 'male', '')::int, 0);
  v_free_before := COALESCE(NULLIF(v_alloc ->> 'free_before', ''), '02:00')::time;

  SELECT venue_id, organizer_user_id INTO v_e_venue, v_e_org
  FROM public.events WHERE id = p_event_id;

  INSERT INTO public.guest_lists
    (event_id, venue_id, organizer_user_id, holder_type, promoter_id, holder_label,
     quota, quota_normal, quota_drink, quota_table, quota_female, quota_male,
     free_before_time, includes_drink, visible_on_club_page, is_active)
  VALUES
    (p_event_id, v_e_venue, v_e_org, 'promoter', p_promoter_id, v_label,
     v_total, v_normal, v_drink, v_table, v_female, v_male,
     v_free_before, (v_drink > 0), false, true)
  ON CONFLICT (event_id, promoter_id) WHERE holder_type = 'promoter' DO NOTHING;

  UPDATE public.promoter_event_assignments
     SET can_access_guestlist = true
   WHERE promoter_id = p_promoter_id
     AND event_id = p_event_id
     AND can_access_guestlist IS DISTINCT FROM true;
END;
$$;

-- ── Trigger d'assignation : part promoteur (no-op pour agence) + enveloppe ────
CREATE OR REPLACE FUNCTION public.on_assignment_materialize_guestlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id uuid;
BEGIN
  -- Part promoteur pilotée par le modèle (no-op si promoteur d'agence, cf. garde).
  BEGIN
    PERFORM public.create_promoter_guestlist_part(NEW.promoter_id, NEW.event_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Enveloppe agence en first-touch — matérialise l'enveloppe standing du
  -- contrat dès qu'un promoteur d'agence est relié à la soirée. Ne bloque jamais
  -- l'assignation (le rattachement prime).
  BEGIN
    SELECT agency_id INTO v_agency_id FROM public.promoters WHERE id = NEW.promoter_id;
    IF v_agency_id IS NOT NULL THEN
      PERFORM public.create_agency_guestlist_part(v_agency_id, NEW.event_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- ── Backfill : enveloppes des soirées à venir déjà reliées à un promoteur d'agence ─
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT p.agency_id, pea.event_id
    FROM public.promoter_event_assignments pea
    JOIN public.promoters p ON p.id = pea.promoter_id
    JOIN public.events e ON e.id = pea.event_id
    WHERE pea.status = 'active'
      AND p.agency_id IS NOT NULL
      AND e.end_at >= now()
  LOOP
    PERFORM public.create_agency_guestlist_part(r.agency_id, r.event_id);
  END LOOP;
END $$;
