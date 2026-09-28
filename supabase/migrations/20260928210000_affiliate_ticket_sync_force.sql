-- ============================================================================
-- affiliate_ticket_sync_apply : alignement forcé (2026-09-28).
--
-- Paul veut chaque soirée récurrente de Mad by Night EXACTEMENT alignée sur sa
-- soirée Whan : nom, affiche, lien. p_force (ouvert au seul serveur, jamais au
-- bouton de la Console) passe outre name_overridden / flyer_overridden et
-- remplace un lien Whan qui ne désigne aucune soirée de cette nuit-là
-- (`replace: "true"` sur la ligne). Un lien qui n'est PAS un lien Whan n'est
-- jamais remplacé, même forcé.
-- ============================================================================

DROP FUNCTION IF EXISTS public.affiliate_ticket_sync_apply(uuid, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.affiliate_ticket_sync_apply(
  p_affiliate_id uuid,
  p_rows jsonb,
  p_silent boolean DEFAULT false,
  p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_links int := 0;
  v_flyers int := 0;
  v_names int := 0;
  v_n int;
BEGIN
  IF p_silent THEN
    PERFORM set_config('yuno.silent_publish', 'on', true);
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) LOOP
    IF nullif(v_row->>'url', '') IS NOT NULL THEN
      UPDATE affiliate_events
         SET external_ticket_url = v_row->>'url',
             ticket_url_overridden = true,
             external_event_ref = nullif(v_row->>'ref', '')
       WHERE id = (v_row->>'id')::uuid
         AND affiliate_id = p_affiliate_id
         AND (external_ticket_url IS NULL
              OR (p_force AND v_row->>'replace' = 'true' AND external_ticket_url ILIKE '%whan.es/%'));
      GET DIAGNOSTICS v_n = ROW_COUNT; v_links := v_links + v_n;
    END IF;

    IF nullif(v_row->>'flyer_url', '') IS NOT NULL THEN
      UPDATE affiliate_events
         SET flyer_url = v_row->>'flyer_url'
       WHERE id = (v_row->>'id')::uuid
         AND affiliate_id = p_affiliate_id
         AND (p_force OR NOT flyer_overridden)
         AND flyer_url IS DISTINCT FROM v_row->>'flyer_url';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_flyers := v_flyers + v_n;
    END IF;

    IF nullif(v_row->>'name', '') IS NOT NULL THEN
      UPDATE affiliate_events
         SET name = v_row->>'name'
       WHERE id = (v_row->>'id')::uuid
         AND affiliate_id = p_affiliate_id
         AND (p_force OR NOT name_overridden)
         AND name IS DISTINCT FROM v_row->>'name';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_names := v_names + v_n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('links', v_links, 'flyers', v_flyers, 'names', v_names);
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_ticket_sync_apply(uuid, jsonb, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_ticket_sync_apply(uuid, jsonb, boolean, boolean) TO service_role;
