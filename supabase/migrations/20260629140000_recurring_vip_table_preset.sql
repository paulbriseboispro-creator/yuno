-- Soirées récurrentes : épingler un preset de TABLES VIP (bottle service) sur le template
-- pour qu'il soit appliqué AUTOMATIQUEMENT à chaque occurrence générée, à l'image des
-- presets billets standard/VIP déjà copiés par generate_recurring_events().
--
-- Approche additive : on NE réécrit PAS generate_recurring_events() (fonction critique
-- revenu, ~150 lignes). On accroche un trigger AFTER INSERT sur events qui, pour toute
-- occurrence issue d'un template, recopie le table_pack_preset choisi dans
-- event_table_settings (même écriture que l'application manuelle dans OwnerTables) et
-- force tables_enabled. Les inserts manuels (recurring_template_id NULL) sont ignorés.

ALTER TABLE public.owner_recurring_templates
  ADD COLUMN IF NOT EXISTS table_preset_id uuid
    REFERENCES public.table_pack_presets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.owner_recurring_templates.table_preset_id IS
  'Preset de tables VIP (bottle service) auto-appliqué à chaque occurrence récurrente. Scope club uniquement (table_pack_presets est venue-scoped).';

CREATE OR REPLACE FUNCTION public.apply_recurring_table_preset()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preset_id uuid;
BEGIN
  -- Le template porte-t-il un preset de tables VIP ?
  SELECT table_preset_id INTO v_preset_id
  FROM public.owner_recurring_templates
  WHERE id = NEW.recurring_template_id;

  IF v_preset_id IS NOT NULL THEN
    -- Lie l'occurrence au preset (idempotent : UNIQUE(event_id)).
    INSERT INTO public.event_table_settings (event_id, preset_id)
    VALUES (NEW.id, v_preset_id)
    ON CONFLICT (event_id) DO UPDATE SET preset_id = EXCLUDED.preset_id, updated_at = now();

    -- Un preset de tables implique des tables en ligne, même si auto_enable_tables était à false.
    IF NOT COALESCE(NEW.tables_enabled, false) THEN
      UPDATE public.events SET tables_enabled = true WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_recurring_table_preset ON public.events;
CREATE TRIGGER trg_apply_recurring_table_preset
  AFTER INSERT ON public.events
  FOR EACH ROW
  WHEN (NEW.recurring_template_id IS NOT NULL)
  EXECUTE FUNCTION public.apply_recurring_table_preset();
