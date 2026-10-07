-- ============================================================================
-- Yuno CRM — variables par personne dans un e-mail (2026-10-07).
-- Plan : docs/designs/CRM_ANALYSIS_NEXT_PLAN.md (lot N4).
--
-- {{artiste}}    l'artiste que la personne a vu le plus souvent ET qui joue à la
--                soirée de l'e-mail ; sinon son artiste le plus vu ; jamais un
--                résident (part des soirées du compte > resident_share : il
--                joue presque chaque fois, le nommer ne dit rien) ; sinon rien
--                (le rendu prend le repli « nos artistes »).
-- {{1re_soiree}} titre de sa 1re soirée (first_facts du profil d'analyse).
-- {{nb_soirees}} nombre de soirées faites (profil d'analyse).
--
-- Résolu PAR LOT par send-campaign (fetchRecipientCrmVars), jamais par
-- destinataire, et seulement si l'e-mail utilise une de ces variables. Lit
-- crm_person_profile de la portée de la campagne : un compte sans analyse
-- (Billetterie seule, fichier importé) rend rien, et chaque variable prend son
-- repli. service_role seul.
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_recipient_crm_vars(p_campaign_id uuid, p_emails text[])
 RETURNS TABLE(email text, artist text, first_night text, nights integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c       record;
  v_scope text;
  v_arts  text[];
  v_res   numeric := COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2);
BEGIN
  SELECT ec.venue_id, ec.organizer_user_id, ec.event_id INTO c
    FROM public.email_campaigns ec WHERE ec.id = p_campaign_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_scope := public.crm_scope_key(c.venue_id, c.organizer_user_id);
  IF v_scope IS NULL OR p_emails IS NULL OR cardinality(p_emails) = 0 THEN RETURN; END IF;

  -- Artistes de la soirée de l'e-mail (clé d'artiste du moteur d'analyse).
  SELECT array_agg(DISTINCT public._crm_artist_key(a)) INTO v_arts
    FROM public.external_events x
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) a
   WHERE c.event_id IS NOT NULL AND x.event_id = c.event_id;

  RETURN QUERY
  SELECT p.email,
         (SELECT ar->>'name'
            FROM jsonb_array_elements(COALESCE(p.agg->'artists', '[]'::jsonb)) WITH ORDINALITY z(ar, i)
            LEFT JOIN public.crm_artist_stats s ON s.scope_key = v_scope AND s.artist_key = ar->>'k'
           WHERE NULLIF(btrim(ar->>'name'), '') IS NOT NULL
             AND (s.share IS NULL OR s.share <= v_res)
           ORDER BY (ar->>'k' = ANY (COALESCE(v_arts, '{}'::text[]))) DESC, COALESCE((ar->>'n')::int, 0) DESC, z.i
           LIMIT 1),
         NULLIF(btrim(p.first_facts->>'title'), ''),
         p.nights
    FROM public.crm_person_profile p
   WHERE p.scope_key = v_scope
     AND p.email = ANY (SELECT lower(btrim(e)) FROM unnest(p_emails) e);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_recipient_crm_vars(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recipient_crm_vars(uuid, text[]) TO service_role;
