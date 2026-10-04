-- ============================================================================
-- Yuno CRM — un segment supprimé emporte son historique de tailles.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_segment_counts_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.crm_segment_counts WHERE scope_key = OLD.scope_key AND seg_key = OLD.id::text;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_segment_counts_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_segment_counts_on_delete ON public.crm_segments;
CREATE TRIGGER trg_crm_segment_counts_on_delete
  AFTER DELETE ON public.crm_segments
  FOR EACH ROW EXECUTE FUNCTION public.crm_segment_counts_on_delete();
