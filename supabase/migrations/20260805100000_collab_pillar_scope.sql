-- =============================================================================
-- Contrat collab : périmètre par PILIER (billets / tables / boissons).
--
-- CONSTAT (Paul) : un deal peut ne porter QUE sur la vente de tables. Le contrat
-- ne savait pas le dire — split_rules ne porte que des pourcentages, et un
-- pilier « à 0 % orga » reste en vente (l'argent va juste ailleurs). Résultat :
-- impossible de dealer uniquement sur les tables en bloquant billets et
-- boissons sans avenant.
--
-- CE QUE CETTE MIGRATION POSE :
--   • La convention `enabled` par pilier dans split_rules :
--       { tickets: { organizer_pct, venue_pct, enabled: false }, ... }
--     Absent = true (tous les contrats existants restent inchangés). Seul un
--     `false` explicite sort le pilier du périmètre du deal.
--   • La VRAIE porte est côté checkout (create-ticket-checkout,
--     create-table-checkout, create-checkout boissons lisent le flag et
--     refusent la vente). Ici on pose l'outillage SQL :
--       1. split_pillar_enabled() — lecteur unique du flag.
--       2. enforce_drinks_alcohol_gate() apprend à PRÉSERVER les clés
--          additionnelles du bloc drinks (avant, jsonb_set remplaçait le bloc
--          entier : le `enabled:false` d'un pilier boissons désactivé aurait
--          été silencieusement effacé pour tout organisateur sans licence).
--       3. Un trigger sur events qui reflète le périmètre signé dans les
--          toggles opérationnels (ticketing_enabled / tables_enabled → false).
--          Jamais l'inverse : un avenant qui réactive un pilier ne rallume
--          rien tout seul — le détenteur du domaine `operations` le fait.
-- =============================================================================

-- ── 1. Lecteur unique du flag de pilier ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.split_pillar_enabled(p_rules jsonb, p_pillar text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  -- Seul un false explicite désactive : absent, null, ou valeur illisible = actif.
  SELECT lower(COALESCE(p_rules->p_pillar->>'enabled', 'true')) NOT IN ('false', 'f', '0');
$fn$;

COMMENT ON FUNCTION public.split_pillar_enabled(jsonb, text) IS
  'Lit le flag enabled d''un pilier (tickets/tables/drinks) dans des split_rules canoniques. Absent = true : seul un false explicite sort le pilier du périmètre du contrat collab.';

-- ── 2. La porte alcool préserve désormais les clés additionnelles ────────────
-- Même signature, même règle métier. Seule différence : le bloc drinks est
-- FUSIONNÉ (|| ) au lieu d'être remplacé, pour que `enabled` (et toute clé
-- future) survive au passage en 100 % club.
CREATE OR REPLACE FUNCTION public.enforce_drinks_alcohol_gate(p_rules jsonb, p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_alcohol boolean;
BEGIN
  IF p_rules IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(can_sell_alcohol, false) INTO v_alcohol
  FROM public.organizer_profiles WHERE user_id = p_org_id;
  IF NOT COALESCE(v_alcohol, false) OR NOT (p_rules ? 'drinks') THEN
    RETURN jsonb_set(
      p_rules,
      '{drinks}',
      COALESCE(p_rules->'drinks', '{}'::jsonb)
        || jsonb_build_object('organizer_pct', 0, 'venue_pct', 100)
    );
  END IF;
  RETURN p_rules;
END; $$;

-- ── 3. Le périmètre signé se reflète dans les toggles opérationnels ──────────
-- À chaque écriture de revenue_split_rules (signature de contrat, balayage de
-- série, avenant appliqué, génération d'occurrence), un pilier désactivé force
-- son toggle event à false. Le checkout refuse de toute façon ; ceci aligne
-- l'UI (les CTA billets / tables disparaissent) sans double source de vérité.
-- Sens unique : on ne force JAMAIS un toggle à true — rallumer appartient au
-- détenteur du domaine operations, pas au contrat.
CREATE OR REPLACE FUNCTION public.sync_pillar_toggles_from_split_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.revenue_split_rules IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.revenue_split_rules IS NOT DISTINCT FROM OLD.revenue_split_rules THEN
    RETURN NEW;
  END IF;
  IF NOT public.split_pillar_enabled(NEW.revenue_split_rules, 'tickets') THEN
    NEW.ticketing_enabled := false;
  END IF;
  IF NOT public.split_pillar_enabled(NEW.revenue_split_rules, 'tables') THEN
    NEW.tables_enabled := false;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_pillar_toggles ON public.events;
CREATE TRIGGER trg_sync_pillar_toggles
  BEFORE INSERT OR UPDATE OF revenue_split_rules ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_pillar_toggles_from_split_rules();
