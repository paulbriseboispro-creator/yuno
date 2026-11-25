-- Tables VIP, vague A — P3.1 : une formule de table ne peut pas être fausse.
--
-- Constat (audit 4) : seuls « zone, nom, prix requis » étaient vérifiés. Un acompte fixe > prix, un pourcentage > 100, un
-- prix négatif ou une capacité de 0 s'enregistraient puis faisaient payer au client plus que la table (côté edge,
-- l'acompte est maintenant borné au prix, mais la formule fausse restait publiée).
--
-- Trigger de validation (pas de CHECK) : il ne juge que les lignes ÉCRITES — jamais celles déjà en base. Mesuré le 24/11 sur la
-- prod : 19 formules, 0 ligne qui violerait ces règles, mais un CHECK ferait échouer toute mise à jour d'une ligne héritée.
-- Sur un UPDATE, on ne juge que si une des colonnes concernées CHANGE (un client qui renvoie toute la ligne ne bloque rien).
--
-- Règles (message `table_pack_invalid:<raison>`, SQLSTATE YU002, lisibles par le front) :
--   price_negative              base_price < 0
--   extra_price_negative        extra_person_price < 0
--   minimum_spend_negative      minimum_spend < 0
--   deposit_negative            deposit < 0
--   capacity_min                base_capacity < 1
--   extra_persons_negative      max_extra_persons < 0
--   deposit_exceeds_price       paiement en ligne, acompte FIXE > prix de base
--   deposit_percent_range       paiement en ligne, acompte en pourcentage hors ]0, 100]
-- Un acompte à 0 reste « paiement intégral » (règle du checkout) pour un acompte fixe ; une formule réglée sur place
-- (payment_mode = 'on_site') n'a pas d'acompte : seules les règles de signe et de capacité s'y appliquent.

CREATE OR REPLACE FUNCTION public.validate_table_pack()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.base_price          IS NOT DISTINCT FROM OLD.base_price
     AND NEW.extra_person_price  IS NOT DISTINCT FROM OLD.extra_person_price
     AND NEW.minimum_spend       IS NOT DISTINCT FROM OLD.minimum_spend
     AND NEW.deposit             IS NOT DISTINCT FROM OLD.deposit
     AND NEW.deposit_type        IS NOT DISTINCT FROM OLD.deposit_type
     AND NEW.base_capacity       IS NOT DISTINCT FROM OLD.base_capacity
     AND NEW.max_extra_persons   IS NOT DISTINCT FROM OLD.max_extra_persons
     AND NEW.payment_mode        IS NOT DISTINCT FROM OLD.payment_mode THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.base_price, 0) < 0 THEN
    v_reason := 'price_negative';
  ELSIF COALESCE(NEW.extra_person_price, 0) < 0 THEN
    v_reason := 'extra_price_negative';
  ELSIF COALESCE(NEW.minimum_spend, 0) < 0 THEN
    v_reason := 'minimum_spend_negative';
  ELSIF COALESCE(NEW.deposit, 0) < 0 THEN
    v_reason := 'deposit_negative';
  ELSIF COALESCE(NEW.base_capacity, 1) < 1 THEN
    v_reason := 'capacity_min';
  ELSIF COALESCE(NEW.max_extra_persons, 0) < 0 THEN
    v_reason := 'extra_persons_negative';
  ELSIF COALESCE(NEW.payment_mode, 'online') = 'online' THEN
    IF COALESCE(NEW.deposit_type, 'fixed') = 'fixed' AND COALESCE(NEW.deposit, 0) > COALESCE(NEW.base_price, 0) THEN
      v_reason := 'deposit_exceeds_price';
    ELSIF NEW.deposit_type = 'percentage' AND (COALESCE(NEW.deposit, 0) <= 0 OR NEW.deposit > 100) THEN
      v_reason := 'deposit_percent_range';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'table_pack_invalid:%', v_reason USING ERRCODE = 'YU002';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_table_pack ON public.table_packs;
CREATE TRIGGER trg_validate_table_pack
  BEFORE INSERT OR UPDATE ON public.table_packs
  FOR EACH ROW EXECUTE FUNCTION public.validate_table_pack();

REVOKE ALL ON FUNCTION public.validate_table_pack() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_table_pack() TO service_role;
