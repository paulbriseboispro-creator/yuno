-- ────────────────────────────────────────────────────────────────────────────
--  drinks.out_of_stock : rupture produit signalée par le bar
--  Distinct de drinks.active (curation du menu par l'owner) : un produit en
--  rupture reste visible côté client, grisé « Épuisé », et remonte dans la
--  station Bar du centre de commandement. drinks est déjà dans la publication
--  realtime → la rupture apparaît en direct sans travail supplémentaire.
--  RLS Postgres ne fait pas de colonne-level : le barman passe par un RPC
--  SECURITY DEFINER qui ne touche que ces trois colonnes.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.drinks
  ADD COLUMN IF NOT EXISTS out_of_stock    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS out_of_stock_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS out_of_stock_by UUID;

CREATE OR REPLACE FUNCTION public.staff_set_drink_stock(p_drink_id TEXT, p_out BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_venue_id TEXT;
BEGIN
  SELECT venue_id INTO v_venue_id FROM drinks WHERE id = p_drink_id;
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION 'Unknown drink %', p_drink_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    is_super_admin()
    OR is_venue_owner(auth.uid(), v_venue_id)
    OR manager_has_permission(auth.uid(), v_venue_id, 'menu')
    OR (has_role(auth.uid(), 'barman') AND get_user_venue_id(auth.uid()) = v_venue_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized for venue %', v_venue_id USING ERRCODE = '42501';
  END IF;

  UPDATE drinks
  SET out_of_stock = p_out,
      out_of_stock_at = CASE WHEN p_out THEN now() ELSE NULL END,
      out_of_stock_by = CASE WHEN p_out THEN auth.uid() ELSE NULL END
  WHERE id = p_drink_id;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_set_drink_stock(TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_set_drink_stock(TEXT, BOOLEAN) TO authenticated;
