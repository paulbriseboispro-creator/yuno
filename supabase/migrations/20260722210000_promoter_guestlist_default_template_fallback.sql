-- ============================================================================
-- Guest list promoteur : repli sur le MODÈLE PAR DÉFAUT du club / organisateur.
--
-- Bug constaté : un owner règle l'allocation guest list sur son preset « par
-- défaut » (commission_templates.is_default), mais ses promoteurs ont
-- default_commission_template_id = NULL (aucun modèle explicite assigné). La
-- matérialisation lisait UNIQUEMENT le modèle explicite du promoteur → aucune
-- part créée → « Aucune guest list allouée » côté promoteur.
--
-- Correctif : quand le promoteur n'a pas de modèle explicite portant une
-- allocation, on retombe sur le modèle is_default de SON club (venue_id) ou de
-- SON organisateur (organizer_user_id). « J'ai réglé le preset par défaut » ⇒ il
-- s'applique. Un modèle explicite du promoteur reste prioritaire.
--
-- Même repli pour la commission guest list au scan (helper), pour rester
-- cohérent : places ET rémunération viennent du même modèle effectif.
--
-- + backfill unique : matérialise les parts des assignations actives à venir
-- déjà en place (le trigger ne couvre que les nouvelles).
-- ============================================================================

-- ── Helper commission : repli sur le modèle par défaut de la soirée ──────────
CREATE OR REPLACE FUNCTION public.promoter_guestlist_head_commission(
  v_rules jsonb,
  p_entry_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_val numeric;
  v_venue text;
  v_org uuid;
  v_def jsonb;
BEGIN
  IF p_entry_id IS NOT NULL THEN
    SELECT entry_type INTO v_type FROM public.guest_list_entries WHERE id = p_entry_id;
  END IF;
  v_type := COALESCE(v_type, 'normal');

  -- 1. Modèle résolu du promoteur (transmis par record_promoter_conversion).
  v_val := NULLIF(v_rules -> 'guestlist_allocation' -> 'types' -> v_type ->> 'commission', '')::numeric;
  IF v_val IS NULL THEN
    v_val := NULLIF(v_rules -> 'guestlist' ->> 'value', '')::numeric;
  END IF;

  -- 2. Repli : modèle PAR DÉFAUT du club / organisateur hôte de la part.
  IF v_val IS NULL AND p_entry_id IS NOT NULL THEN
    SELECT gl.venue_id, gl.organizer_user_id INTO v_venue, v_org
    FROM public.guest_list_entries gle
    JOIN public.guest_lists gl ON gl.id = gle.guest_list_id
    WHERE gle.id = p_entry_id;

    SELECT ct.rules INTO v_def
    FROM public.commission_templates ct
    WHERE ct.is_default
      AND ((v_venue IS NOT NULL AND ct.venue_id = v_venue)
        OR (v_org IS NOT NULL AND ct.organizer_user_id = v_org))
    LIMIT 1;

    v_val := NULLIF(v_def -> 'guestlist_allocation' -> 'types' -> v_type ->> 'commission', '')::numeric;
    IF v_val IS NULL THEN
      v_val := NULLIF(v_def -> 'guestlist' ->> 'value', '')::numeric;
    END IF;
  END IF;

  RETURN COALESCE(v_val, 0);
END;
$$;

-- ── Matérialisation : repli sur le modèle par défaut du promoteur ────────────
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
  v_e_venue text;
  v_e_org uuid;
BEGIN
  -- Nom + scope du promoteur + rules de SON modèle explicite (s'il en a un).
  SELECT ct.rules,
         COALESCE(NULLIF(btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.promo_code),
         p.venue_id, p.organizer_user_id
    INTO v_rules, v_label, v_p_venue, v_p_org
  FROM public.promoters p
  LEFT JOIN public.commission_templates ct ON ct.id = p.default_commission_template_id
  WHERE p.id = p_promoter_id
    AND p.is_active;

  IF v_label IS NULL THEN
    RETURN; -- promoteur introuvable ou inactif
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

-- ── Backfill unique : les assignations actives à venir déjà en place ─────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pea.promoter_id, pea.event_id
    FROM public.promoter_event_assignments pea
    JOIN public.events e ON e.id = pea.event_id
    WHERE pea.status = 'active'
      AND e.end_at >= now()
  LOOP
    PERFORM public.create_promoter_guestlist_part(r.promoter_id, r.event_id);
  END LOOP;
END $$;
