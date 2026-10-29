-- Yuno CRM « Vos clients » — lot 4 : l'aperçu démo (transaction en lecture seule)
-- peut lire ce qu'une campagne « Tous vos clients » viserait. Cette lecture bâtit
-- les tables temporaires de _crm_people_build, comme crm_email_audience_preview,
-- déjà sur la liste. Aucune écriture réelle n'en sort.
DO $$
DECLARE v_def text; v_new text;
  v_anchor text := '''tix_segments_fill_anchors'', ''tix_segment_catalog'', ''tix_import_check'', ''tix_sms_audience_count''';
BEGIN
  v_def := pg_get_functiondef('public.demo_preview_writable_rpc(text)'::regprocedure);
  IF position('crm_customer_audience_preview' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'demo_preview_writable_rpc : repère de fin de liste introuvable';
  END IF;
  v_new := replace(v_def, v_anchor, v_anchor || ',
    -- Yuno CRM « Vos clients » : ce que viserait « Tous vos clients » (20261114130000)
    ''crm_customer_audience_preview''');
  EXECUTE v_new;
END $$;
