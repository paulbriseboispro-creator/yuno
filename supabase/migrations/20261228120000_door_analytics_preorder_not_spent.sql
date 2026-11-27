-- Tables VIP, vague C bis — M6 : une précommande de bouteilles (statut `preorder`, rien encaissé, rien servi) n'est pas de la consommation.
-- `get_analytics_door` somme `vip_table_orders` hors annulées : les précommandes du checkout (vague C) gonflaient la « dépense » d'une table
-- par une simple intention. Patch CIBLÉ de la définition VIVANTE (jamais recopiée) : seul le filtre de statut change.
DO $patch$
DECLARE
  v_oid oid := 'public.get_analytics_door(text, uuid, uuid, timestamptz, timestamptz)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_new text;
BEGIN
  v_new := replace(v_def,
    $$o.status IS DISTINCT FROM 'cancelled'$$,
    $$o.status NOT IN ('cancelled', 'preorder')$$);
  IF v_new = v_def THEN
    RAISE EXCEPTION 'get_analytics_door : filtre de statut introuvable dans la définition vivante (patch refusé)';
  END IF;
  EXECUTE v_new;
END
$patch$;
