-- Mode Live — barre de minimum conso pour les clients en table.
--
-- `vip_consumptions` est volontairement staff/owner-only en RLS : le client
-- ne peut pas lire ses propres consommations. Ce RPC SECURITY DEFINER expose
-- UNIQUEMENT l'agrégat (minimum du pack + total consommé) et UNIQUEMENT au
-- titulaire de la réservation (tr.user_id = auth.uid()) — pas le détail des
-- lignes, pas les autres tables.

CREATE OR REPLACE FUNCTION public.get_my_table_spend(p_reservation_id uuid)
RETURNS TABLE (
  minimum_spend numeric,
  consumed_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(tp.minimum_spend, 0)::numeric,
    COALESCE((
      SELECT SUM(vc.total_price)
      FROM public.vip_consumptions vc
      WHERE vc.table_reservation_id = tr.id
    ), 0)::numeric
  FROM public.table_reservations tr
  LEFT JOIN public.table_packs tp ON tp.id = tr.pack_id
  WHERE tr.id = p_reservation_id
    AND tr.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_table_spend(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_table_spend(uuid) TO authenticated;
