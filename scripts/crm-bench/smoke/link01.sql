-- LINK-01 sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/link01.sql \
--     20261024100100_crm_link_create_image_regex.sql
-- Après la migration : l'expression `{1,480}` a disparu, le compte démo CRM crée
-- un lien de story AVEC sa capture (gardée), et une URL http est écartée sans
-- erreur. Tout est annulé : aucun lien ne reste. Validé au banc par link01.mjs run.
DO $smoke$
DECLARE
  v_org uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_event uuid;
  v_img text := 'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/email-assets/crm/links/smoke-story.jpg';
  v_r jsonb;
  v_r2 jsonb;
BEGIN
  IF position('{1,480}' IN (SELECT prosrc FROM pg_proc
                             WHERE oid = 'public.crm_link_create(text, uuid, uuid, text, text, text, text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'SMOKE_FAIL crm_link_create contient encore {1,480}';
  END IF;
  IF v_org IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL compte démo crm@womber.fr introuvable'; END IF;

  SELECT e.id INTO v_event FROM public.events e
   WHERE e.organizer_user_id = v_org AND e.external_source IS NOT NULL
     AND public._crm_link_event_ok(NULL, v_org, e.id)
   ORDER BY e.start_at DESC NULLS LAST
   LIMIT 1;
  IF v_event IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL aucune soirée miroir du compte démo'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_org::text, true);

  v_r := public.crm_link_create(NULL, v_org, v_event, 'instagram', 'story', 'Story smoke', v_img);
  IF v_r->>'image_url' IS DISTINCT FROM v_img THEN
    RAISE EXCEPTION 'SMOKE_FAIL capture non gardée : %', v_r;
  END IF;
  v_r2 := public.crm_link_create(NULL, v_org, v_event, 'instagram', 'story', 'Story smoke http', 'http://exemple.fr/story.jpg');
  IF v_r2->>'image_url' IS NOT NULL THEN
    RAISE EXCEPTION 'SMOKE_FAIL une URL http a été gardée : %', v_r2;
  END IF;

  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('lien_avec_capture', v_r->>'label', 'capture', 'gardée',
                                                    'url_http', 'écartée sans erreur');
END
$smoke$;
