-- ─── Le plafond d'une formule est la loi ; le plan doit la respecter ─────────
--
-- Une formule plafonnée (limit_tables) à N tables ne peut pas se voir lier
-- plus de N tables sur un plan, et son plafond ne peut pas descendre sous le
-- nombre de tables déjà liées. Deux gardes symétriques, SQLSTATE 'YU001'
-- (classe libre, distincte de check_violation pour que le front l'identifie).
-- SECURITY DEFINER : un pack invisible via RLS ne doit pas faire passer la
-- garde en silence ; ces fonctions ne discriminent pas sur current_user.

CREATE OR REPLACE FUNCTION public.guard_floor_plan_pack_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_name text;
  v_max integer;
BEGIN
  FOR r IN
    SELECT (t->>'packId')::uuid AS pack_id, COUNT(*)::int AS n
      FROM jsonb_array_elements(COALESCE(NEW.layout->'tables', '[]'::jsonb)) t
     WHERE t->>'packId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     GROUP BY 1
  LOOP
    SELECT p.name, p.tables_count INTO v_name, v_max
      FROM public.table_packs p
     WHERE p.id = r.pack_id AND p.limit_tables AND p.tables_count > 0 AND r.n > p.tables_count;
    IF FOUND THEN
      RAISE EXCEPTION 'La formule "%" est limitée à % tables : le plan en lie %. Retirez une table de cette formule ou augmentez son plafond.',
        v_name, v_max, r.n
        USING ERRCODE = 'YU001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_floor_plan_pack_limits ON public.venue_floor_plans;
CREATE TRIGGER trg_guard_floor_plan_pack_limits
  BEFORE INSERT OR UPDATE OF layout ON public.venue_floor_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_floor_plan_pack_limits();

CREATE OR REPLACE FUNCTION public.guard_pack_limit_vs_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bound integer := 0;
BEGIN
  IF NOT NEW.limit_tables OR COALESCE(NEW.tables_count, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  -- Plan du même périmètre que la formule : celui de la soirée, ou celui du club.
  SELECT COUNT(*)::int INTO v_bound
    FROM public.venue_floor_plans fp,
         jsonb_array_elements(COALESCE(fp.layout->'tables', '[]'::jsonb)) t
   WHERE t->>'packId' = NEW.id::text
     AND (
       (NEW.event_id IS NOT NULL AND fp.event_id = NEW.event_id)
       OR (NEW.event_id IS NULL AND NEW.venue_id IS NOT NULL AND fp.venue_id = NEW.venue_id AND fp.event_id IS NULL)
     );
  IF v_bound > NEW.tables_count THEN
    RAISE EXCEPTION 'La formule "%" a déjà % tables liées sur le plan : son plafond ne peut pas descendre à %. Retirez d''abord des tables sur le plan.',
      NEW.name, v_bound, NEW.tables_count
      USING ERRCODE = 'YU001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_pack_limit_vs_plan ON public.table_packs;
CREATE TRIGGER trg_guard_pack_limit_vs_plan
  BEFORE UPDATE OF tables_count, limit_tables ON public.table_packs
  FOR EACH ROW EXECUTE FUNCTION public.guard_pack_limit_vs_plan();
