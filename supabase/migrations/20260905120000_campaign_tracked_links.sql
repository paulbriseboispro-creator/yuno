-- Campagnes email ↔ liens suivis : le bouton d'un bloc Yuno part enfin sur le
-- canal « newsletter » de la soirée, au lieu de l'URL nue de la page.
--
-- Avant : le bloc Billetterie/Entrée pointait sur /events/<host>/<slug>?yc=…
-- Le `yc` sert au webhook Resend (clics) et à l'attribution revenu à 72 h, mais
-- il ne pose JAMAIS de `tl=` : la ligne « newsletter » de la page Guest list
-- restait à 0 inscrit même quand l'email remplissait la soirée. Et pour une
-- soirée en liste invités seule, `get_email_campaign_attribution` ne voit rien
-- non plus (elle ne compte que tickets / tables / orders payés) : l'email
-- n'avait aucun moyen de prouver ce qu'il avait produit.
--
-- Cette fonction rend, par soirée, le code /l/<code> du canal demandé — pour
-- l'événement ET pour la part de guest list publique. L'edge s'en sert au
-- rendu ; le seed est idempotent, donc une soirée dont le pro n'a jamais
-- ouvert l'onglet Liens reçoit ses quatre canaux au premier envoi.
--
-- Appelée UNIQUEMENT par send-campaign (service_role). Pas de grant client :
-- rien ici n'est utile à un navigateur, et le seed écrit.

CREATE OR REPLACE FUNCTION public.resolve_campaign_tracked_links(
  p_event_ids uuid[],
  p_channel   text DEFAULT 'newsletter'
)
RETURNS TABLE (event_id uuid, event_code text, guest_list_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event   uuid;
  v_gl      uuid;
  v_channel text := lower(coalesce(nullif(btrim(p_channel), ''), 'newsletter'));
BEGIN
  IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_event IN ARRAY p_event_ids LOOP
    -- La part publique = celle que l'email montre déjà (pickPublicGuestList :
    -- la part maison d'abord, sinon la plus ancienne visible). Les deux côtés
    -- doivent désigner la MÊME part, sinon le lien n'ouvre pas la liste
    -- annoncée dans le corps du message.
    v_gl := NULL;
    SELECT gl.id INTO v_gl
      FROM public.guest_lists gl
     WHERE gl.event_id = v_event
       AND gl.is_active = true
       AND gl.visible_on_club_page = true
     ORDER BY (gl.holder_type = 'club') DESC, gl.created_at ASC
     LIMIT 1;

    -- Semer ne doit jamais faire échouer un envoi : au pire on repart sur
    -- l'URL nue de la page de la soirée.
    BEGIN
      PERFORM public.seed_event_tracked_links(v_event);
      IF v_gl IS NOT NULL THEN
        PERFORM public.seed_guest_list_tracked_links(v_gl);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN QUERY
    SELECT
      v_event,
      (
        -- Lien de la soirée appartenant à son hôte. `promoter_id`/`dj_id` NULL
        -- écarte le canal « newsletter » d'un promoteur sur la même soirée :
        -- sa commission n'a rien à faire dans la campagne du club.
        SELECT tl.code FROM public.tracked_links tl
         WHERE tl.target_kind = 'event'
           AND tl.event_id = v_event
           AND tl.promoter_id IS NULL
           AND tl.dj_id IS NULL
           AND tl.is_active
           AND lower(tl.label) = v_channel
         ORDER BY tl.created_at ASC
         LIMIT 1
      ),
      (
        SELECT tl.code FROM public.tracked_links tl
         WHERE tl.target_kind = 'guestlist'
           AND v_gl IS NOT NULL
           AND tl.guest_list_id = v_gl
           AND tl.is_active
           AND lower(tl.label) = v_channel
         ORDER BY tl.created_at ASC
         LIMIT 1
      );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_campaign_tracked_links(uuid[], text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_tracked_links(uuid[], text) TO service_role;
