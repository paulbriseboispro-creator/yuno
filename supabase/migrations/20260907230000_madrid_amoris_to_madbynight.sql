-- Madrid : Mad by Night reprend l'intégralité du bras externe d'Amoris.
--
-- Décision produit (2026-09-07) : Amoris cesse d'exister publiquement, Mad by
-- Night devient la seule agence de Madrid. L'entité Amoris n'est PAS supprimée
-- — compte, agence, cockpit et historique restent en place.
--
-- INVARIANT : aucune soirée ne doit disparaître de Yuno. Les URL publiques sont
-- /affiliate-event/<slug> et /affiliate-venue/<slug>, les slugs sont uniques
-- GLOBALEMENT, et toutes les portes de visibilité (RLS anon,
-- get_links_featured_events, get_taste_events_for_user,
-- count_zone_events_for_user) filtrent sur affiliate_events.status et
-- affiliate_venues.is_active — JAMAIS sur l'affilié parent. On ne touche donc ni
-- `id`, ni `slug`, ni `status`, ni `external_ticket_url` : seul le propriétaire
-- change. Les soirées en ligne restent en ligne, à la même adresse, avec le même
-- lien billetterie.
--
-- Le générateur d'occurrences (create-affiliate-recurring-events) hérite
-- `affiliate_id` du modèle : les futures occurrences naîtront sous Mad by Night
-- toutes seules. Sa passe de synchro ne touche que les occurrences rattachées à
-- un modèle et respecte `ticket_url_overridden`, que portent les occurrences
-- dont un humain a posé le lien ; les soirées autonomes, elle ne les voit pas.

DO $$
DECLARE
  v_amoris_aff  uuid := '213e5471-bef8-4c2e-91e3-29c6e4d79015';
  v_mbn_aff     uuid := 'e3266355-d177-4151-9ae3-b0fb54950df3';
  v_amoris_agc  uuid := '008cb1f8-9ef6-4f75-8b4b-b61ec04c7ba0';
  v_mbn_agc     uuid := '5bc6f8e8-892a-471c-8826-c28697903b96';
  v_n           bigint;
BEGIN
  -- Migration de données de production : no-op silencieux partout ailleurs
  -- (base fraîche, dev, seed) plutôt qu'un `db push` en échec.
  IF NOT EXISTS (SELECT 1 FROM public.affiliates WHERE id = v_amoris_aff)
     OR NOT EXISTS (SELECT 1 FROM public.affiliates WHERE id = v_mbn_aff) THEN
    RAISE NOTICE 'Madrid: affiliés Amoris/Mad by Night absents — migration ignorée.';
    RETURN;
  END IF;

  ---------------------------------------------------------------------------
  -- 1. Le catalogue : clubs, soirées, modèles récurrents.
  ---------------------------------------------------------------------------
  UPDATE public.affiliate_venues
     SET affiliate_id = v_mbn_aff
   WHERE affiliate_id = v_amoris_aff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Madrid: % clubs transférés.', v_n;

  -- trg_affiliate_events_link_gate est un BEFORE UPDATE : sans changement de
  -- external_ticket_url, c'est un no-op. trg_auto_event_published est un
  -- `UPDATE OF status` : il ne se déclenche pas ici, aucun push parasite ne part.
  UPDATE public.affiliate_events
     SET affiliate_id = v_mbn_aff
   WHERE affiliate_id = v_amoris_aff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Madrid: % soirées transférées (statuts et liens inchangés).', v_n;

  -- Les modèles gardent leur id : le générateur suit tout seul. Le trigger
  -- stamp_template_publication_url ne réagit qu'à publication_url, intact ici :
  -- les liens de la semaine en cours ne sont pas ré-horodatés, donc pas expirés.
  UPDATE public.affiliate_recurring_templates
     SET affiliate_id = v_mbn_aff
   WHERE affiliate_id = v_amoris_aff;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Madrid: % modèles récurrents transférés.', v_n;

  -- Mise en avant du linktree et liens de report par club : suivent le club.
  UPDATE public.affiliate_linktree_events SET affiliate_id = v_mbn_aff WHERE affiliate_id = v_amoris_aff;
  UPDATE public.affiliate_report_links    SET affiliate_id = v_mbn_aff WHERE affiliate_id = v_amoris_aff;

  ---------------------------------------------------------------------------
  -- 2. L'historique de trafic suit les clubs qu'il mesure. Sans ça, les
  --    analyses de Mad by Night afficheraient zéro visite sur des clubs qu'elle
  --    possède. Aucune de ces lignes n'est rattachée à un membre (Amoris n'en a
  --    jamais eu) : il n'y a rien à réattribuer.
  ---------------------------------------------------------------------------
  UPDATE public.affiliate_clicks           SET affiliate_id = v_mbn_aff WHERE affiliate_id = v_amoris_aff;
  UPDATE public.affiliate_visitor_sessions SET affiliate_id = v_mbn_aff WHERE affiliate_id = v_amoris_aff;
  UPDATE public.affiliate_live_pings       SET affiliate_id = v_mbn_aff WHERE affiliate_id = v_amoris_aff;

  ---------------------------------------------------------------------------
  -- 3. Ce qui est vivant côté humain : abonnés et invitation en cours.
  ---------------------------------------------------------------------------
  -- Les personnes qui suivaient Amoris suivent Mad by Night : sinon l'agence
  -- disparaît de leurs favoris sans rien à la place.
  INSERT INTO public.agency_followers (agency_id, user_id)
  SELECT v_mbn_agc, f.user_id FROM public.agency_followers f WHERE f.agency_id = v_amoris_agc
  ON CONFLICT (agency_id, user_id) DO NOTHING;
  DELETE FROM public.agency_followers WHERE agency_id = v_amoris_agc;

  -- Invitation promoteur encore en attente : le lien déjà parti par email doit
  -- ouvrir sur Mad by Night, pas sur une agence éteinte.
  UPDATE public.platform_invitations pi
     SET organization_name = 'Mad by Night'
   WHERE pi.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM public.affiliate_invitations_meta m
        WHERE m.invitation_token = pi.token::text
          AND m.affiliate_id = v_amoris_aff
     );

  UPDATE public.affiliate_invitations_meta
     SET affiliate_id = v_mbn_aff, affiliate_name = 'Mad by Night'
   WHERE affiliate_id = v_amoris_aff;

  ---------------------------------------------------------------------------
  -- 4. Les adresses publiques d'Amoris atterrissent sur Mad by Night.
  --    resolve_affiliate_slug cherche d'abord un slug canonique ACTIF, puis un
  --    alias dont l'affilié est actif. /p/amoris, /rp/amoris, /p/madbynight
  --    (l'alias hérité du partage du 2026-08-07) redirigent donc vers
  --    /p/mad-by-night : un QR imprimé ou un lien en bio continue de marcher.
  ---------------------------------------------------------------------------
  INSERT INTO public.affiliate_slug_aliases (slug, affiliate_id)
  VALUES ('amoris', v_mbn_aff), ('madbynight', v_mbn_aff)
  ON CONFLICT (slug) DO UPDATE SET affiliate_id = EXCLUDED.affiliate_id;

  ---------------------------------------------------------------------------
  -- 5. Amoris sort de la vue publique. On ne supprime rien. DEUX verrous, et
  --    les deux sont nécessaires.
  ---------------------------------------------------------------------------
  -- Verrou 1 — immédiat. La policy anon « Public read active affiliate
  -- profiles » ne voit plus la ligne, la recherche Explore la filtre,
  -- /p/:slug et /rp/:slug ne la résolvent plus, get_event_rp_agencies l'exclut.
  -- La policy « Affiliate full access to own profile » (user_id = auth.uid())
  -- reste : Paul garde la main sur sa propre ligne.
  --
  -- On ne touche PAS agencies.is_active : côté cockpit, ce drapeau signifie
  -- « agence suspendue » et dresse un mur « contactez le support » avec
  -- déconnexion forcée (AgencyAppLayout). Masquer n'est pas suspendre.
  UPDATE public.affiliates SET is_active = false WHERE id = v_amoris_aff;

  -- Verrou 2 — durable, et c'est le plus important. La synchro d'identité
  -- trg_agencies_sync_affiliate_identity recopie `is_active` de l'agence vers
  -- l'affilié à CHAQUE sauvegarde du profil agence (update_agency_profile
  -- touche name/bio/logo/instagram..., toutes surveillées par le trigger).
  -- Le verrou 1 seul serait donc défait au premier « Enregistrer » de Paul, et
  -- Amoris reviendrait en public sans que personne l'ait demandé. Sans slug
  -- public, il n'y a plus d'adresse à ressusciter : /p/ et /rp/ n'ont plus rien
  -- à résoudre et la recherche Explore exige `linktree_slug is not null`.
  -- Le trigger sync_affiliate_linktree_slug ne crée pas d'alias vers NULL, et
  -- gen_affiliate_linktree_slug ne régénère rien quand l'ancien slug est NULL :
  -- un renommage ultérieur ne rouvre pas la porte non plus.
  UPDATE public.affiliates SET linktree_slug = NULL WHERE id = v_amoris_aff;

  -- Le slug d'agence `madbynight` traînait sur Amoris depuis le partage de
  -- Madrid : il revient à son propriétaire légitime. Colonne sans lecteur
  -- aujourd'hui (aucune route ne s'y résout), mais sous index unique : la
  -- laisser sur l'agence éteinte serait une mine pour une future feature.
  UPDATE public.agencies SET slug = 'amoris'     WHERE id = v_amoris_agc AND slug = 'madbynight';
  UPDATE public.agencies SET slug = 'madbynight' WHERE id = v_mbn_agc;

  ---------------------------------------------------------------------------
  -- 6. Garde-fou : rien de visible ne doit rester orphelin sous Amoris.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_n FROM public.affiliate_venues WHERE affiliate_id = v_amoris_aff AND is_active;
  IF v_n > 0 THEN RAISE EXCEPTION 'Madrid: % club(s) actifs restent sous Amoris éteint.', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.affiliate_events
   WHERE affiliate_id = v_amoris_aff AND status IN ('published', 'featured');
  IF v_n > 0 THEN RAISE EXCEPTION 'Madrid: % soirée(s) publiées restent sous Amoris éteint.', v_n; END IF;

  RAISE NOTICE 'Madrid: Mad by Night est désormais la seule agence publique.';
END $$;
