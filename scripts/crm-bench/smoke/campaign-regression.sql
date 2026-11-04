-- Non-régression : une copie de la prochaine campagne Billetterie programmée, mise en file
-- puis réclamée comme le ferait send-campaign — tout est annulé (SMOKE_OK).
DO $$
DECLARE v_src uuid := '9914b332-4ee4-449d-919a-a8ae850f6cd6'; v_id uuid := gen_random_uuid(); v jsonb; n int; nb int; out text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.email_campaigns SELECT (jsonb_populate_record(NULL::public.email_campaigns,
    to_jsonb(c) || jsonb_build_object('id', v_id, 'status', 'draft', 'scheduled_at', NULL, 'name', 'smoke copie'))).* FROM public.email_campaigns c WHERE c.id = v_src;
  v := public.enqueue_campaign_recipients(v_id);
  SELECT count(*) INTO n FROM public.claim_campaign_recipients(v_id, 100);
  SELECT count(*) INTO nb FROM public.email_campaign_recipients WHERE campaign_id = v_id AND legal_basis IS NOT NULL;
  out := 'file ' || v::text || E'\n1er lot ' || n || ' lignes, lignes marquées « base légale » : ' || nb;
  RAISE EXCEPTION 'SMOKE_OK %', out;
END $$;
