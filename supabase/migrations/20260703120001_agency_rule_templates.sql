-- Agency rule templates: define reusable permission + commission + discount profiles
-- Applied to individual promoters or entire groups.
-- Flow: club grants rights to agency (via contract) → agency creates templates → applies to promoters.

CREATE TABLE IF NOT EXISTS public.agency_rule_templates (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id                uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  description              text,
  color                    text NOT NULL DEFAULT '#E8192C',
  is_default               boolean NOT NULL DEFAULT false,

  -- Permissions
  can_sell_tickets         boolean NOT NULL DEFAULT true,
  can_sell_tables          boolean NOT NULL DEFAULT false,
  can_scan_entries         boolean NOT NULL DEFAULT false,
  guestlist_quota          integer,      -- NULL=not authorized, 0=unlimited, N=max spots

  -- Capacity caps (NULL = unlimited)
  ticket_cap               integer,
  table_cap                integer,

  -- Sub-commission paid to the promoter
  ticket_commission_type   text NOT NULL DEFAULT 'percentage'
    CHECK (ticket_commission_type IN ('percentage', 'fixed')),
  ticket_commission_value  numeric(8,2) NOT NULL DEFAULT 0,

  table_commission_type    text NOT NULL DEFAULT 'percentage'
    CHECK (table_commission_type IN ('percentage', 'fixed')),
  table_commission_value   numeric(8,2) NOT NULL DEFAULT 0,

  -- Discount the promo code gives to buyers
  customer_discount_type   text NOT NULL DEFAULT 'none'
    CHECK (customer_discount_type IN ('none', 'percentage', 'fixed')),
  customer_discount_value  numeric(8,2) NOT NULL DEFAULT 0,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agency_rule_templates_agency ON public.agency_rule_templates(agency_id);

ALTER TABLE public.agency_rule_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency owner manages rule templates"
  ON public.agency_rule_templates FOR ALL TO authenticated
  USING  (public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (public.is_agency_owner(auth.uid(), agency_id));

CREATE POLICY "Super admin manages rule templates"
  ON public.agency_rule_templates FOR ALL TO authenticated
  USING  (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Track which template is applied to each promoter + add guest list quota
ALTER TABLE public.promoters
  ADD COLUMN IF NOT EXISTS agency_rule_template_id uuid
    REFERENCES public.agency_rule_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agency_guestlist_quota integer;

-- Assignment audit trail: which template was last applied to which target
CREATE TABLE IF NOT EXISTS public.agency_rule_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES public.agency_rule_templates(id) ON DELETE CASCADE,
  agency_id    uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  target_type  text NOT NULL CHECK (target_type IN ('promoter', 'group')),
  promoter_id  uuid REFERENCES public.promoters(id) ON DELETE CASCADE,
  group_id     uuid REFERENCES public.agency_promoter_groups(id) ON DELETE CASCADE,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_rule_assignment_target CHECK (
    (target_type = 'promoter' AND promoter_id IS NOT NULL AND group_id IS NULL) OR
    (target_type = 'group'    AND group_id    IS NOT NULL AND promoter_id IS NULL)
  )
);

CREATE INDEX idx_rule_assignments_template ON public.agency_rule_assignments(template_id);
CREATE INDEX idx_rule_assignments_promoter ON public.agency_rule_assignments(promoter_id) WHERE promoter_id IS NOT NULL;
CREATE INDEX idx_rule_assignments_group    ON public.agency_rule_assignments(group_id)    WHERE group_id    IS NOT NULL;

ALTER TABLE public.agency_rule_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency owner manages rule assignments"
  ON public.agency_rule_assignments FOR ALL TO authenticated
  USING  (public.is_agency_owner(auth.uid(), agency_id))
  WITH CHECK (public.is_agency_owner(auth.uid(), agency_id));

-- RPC: apply a rule template to a promoter or an entire group
CREATE OR REPLACE FUNCTION public.apply_agency_rule_template(
  p_template_id  uuid,
  p_target_type  text,   -- 'promoter' | 'group'
  p_target_id    uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_agency_id  uuid;
  v_tpl        public.agency_rule_templates%ROWTYPE;
  v_count      integer := 0;
BEGIN
  SELECT * INTO v_tpl FROM public.agency_rule_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  v_agency_id := v_tpl.agency_id;

  IF NOT public.is_agency_owner(auth.uid(), v_agency_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_target_type = 'promoter' THEN
    UPDATE public.promoters SET
      agency_can_sell_tickets   = v_tpl.can_sell_tickets,
      agency_can_sell_tables    = v_tpl.can_sell_tables,
      agency_ticket_cap         = v_tpl.ticket_cap,
      agency_table_cap          = v_tpl.table_cap,
      can_scan_entries          = v_tpl.can_scan_entries,
      agency_guestlist_quota    = v_tpl.guestlist_quota,
      ticket_commission_type    = v_tpl.ticket_commission_type,
      ticket_commission_value   = v_tpl.ticket_commission_value,
      table_commission_type     = v_tpl.table_commission_type,
      table_commission_value    = v_tpl.table_commission_value,
      customer_discount_type    = v_tpl.customer_discount_type,
      customer_discount_value   = v_tpl.customer_discount_value,
      agency_rule_template_id   = p_template_id
    WHERE id = p_target_id AND agency_id = v_agency_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    DELETE FROM public.agency_rule_assignments
      WHERE agency_id = v_agency_id AND target_type = 'promoter' AND promoter_id = p_target_id;
    INSERT INTO public.agency_rule_assignments (template_id, agency_id, target_type, promoter_id)
      VALUES (p_template_id, v_agency_id, 'promoter', p_target_id);

  ELSIF p_target_type = 'group' THEN
    UPDATE public.promoters SET
      agency_can_sell_tickets   = v_tpl.can_sell_tickets,
      agency_can_sell_tables    = v_tpl.can_sell_tables,
      agency_ticket_cap         = v_tpl.ticket_cap,
      agency_table_cap          = v_tpl.table_cap,
      can_scan_entries          = v_tpl.can_scan_entries,
      agency_guestlist_quota    = v_tpl.guestlist_quota,
      ticket_commission_type    = v_tpl.ticket_commission_type,
      ticket_commission_value   = v_tpl.ticket_commission_value,
      table_commission_type     = v_tpl.table_commission_type,
      table_commission_value    = v_tpl.table_commission_value,
      customer_discount_type    = v_tpl.customer_discount_type,
      customer_discount_value   = v_tpl.customer_discount_value,
      agency_rule_template_id   = p_template_id
    WHERE agency_group_id = p_target_id AND agency_id = v_agency_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    DELETE FROM public.agency_rule_assignments
      WHERE agency_id = v_agency_id AND target_type = 'group' AND group_id = p_target_id;
    INSERT INTO public.agency_rule_assignments (template_id, agency_id, target_type, group_id)
      VALUES (p_template_id, v_agency_id, 'group', p_target_id);

  ELSE
    RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
  END IF;

  RETURN json_build_object('applied_to', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_agency_rule_template(uuid, text, uuid) TO authenticated;
