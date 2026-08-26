-- ============================================================================
-- Comptes vitrine ORGANISATEUR — la réclamation fonctionne AUSSI quand le
-- prospect est déjà organisateur (parité avec les clubs).
--
-- Avant : handoff_showcase_organizer refusait net (`prospect_already_organizer`,
-- collision de PK) — un cas « à traiter à la main », alors que côté club
-- n'importe quel compte existant peut réclamer. Désormais deux modes :
--
--   • ADOPTION (prospect sans profil orga — chemin d'origine, inchangé) : le
--     profil vitrine change de porteur.
--   • FUSION (prospect déjà organisateur) : le CONTENU vitrine (events, guest
--     lists, tables, équipe…) rejoint son profil existant, qui ADOPTE la
--     présentation construite par l'admin (nom, bio, images, réseaux — c'est
--     tout l'intérêt de la vitrine) ; son ancien nom/slug sont archivés en
--     alias par le trigger de slug, et le slug vitrine exact lui revient (le
--     profil fantôme est supprimé et ses alias transférés AVANT le re-slug,
--     donc gen_organizer_slug ne voit plus d'occupant). Les rares tables à
--     contrainte UNIQUE par organisateur sont dédoublonnées avant le
--     re-parentage — en pratique des no-ops : une vitrine n'a ni ventes, ni
--     SMS, ni factures (paiements gatés), le garde-fou est là pour la forme.
--
-- Nuance assumée en FUSION : le profil du prospect garde SA visibilité. S'il
-- est déjà public (le cas normal d'un orga existant), le contenu vitrine
-- devient public immédiatement — cohérent. S'il est privé, ses events peuvent
-- redevenir découvrables avant publication (cartes Explore → pages
-- « introuvable ») : cas rarissime, qui se répare seul à la publication.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handoff_showcase_organizer(p_shadow_user_id uuid, p_new_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_shadow boolean;
  v_merge boolean;
  v_shadow_profile public.organizer_profiles%ROWTYPE;
  v_aliases text[];
  v_pair text[];
  v_pairs constant text[][] := ARRAY[
    -- Cœur : le contenu construit par l'admin.
    ARRAY['events', 'organizer_user_id'],
    ARRAY['events', 'partner_organizer_id'],
    ARRAY['events', 'tables_owner_user_id'],
    ARRAY['guest_lists', 'organizer_user_id'],
    ARRAY['guest_list_templates', 'organizer_user_id'],
    ARRAY['ticket_presets', 'organizer_user_id'],
    ARRAY['table_zones', 'created_by_user_id'],
    ARRAY['table_packs', 'created_by_user_id'],
    ARRAY['venue_floor_plans', 'owner_user_id'],
    ARRAY['owner_recurring_templates', 'organizer_user_id'],
    ARRAY['owner_recurring_templates', 'partner_organizer_id'],
    ARRAY['organizer_onboarding', 'user_id'],
    -- Équipe, staff, invitations.
    ARRAY['org_members', 'organizer_user_id'],
    ARRAY['org_staff', 'organizer_user_id'],
    ARRAY['staff_invitations', 'organizer_user_id'],
    ARRAY['onboarding_links', 'organizer_user_id'],
    -- CRM, notifications, audience.
    ARRAY['organizer_notifications', 'organizer_user_id'],
    ARRAY['organizer_profile_followers', 'organizer_user_id'],
    ARRAY['organizer_banned_emails', 'organizer_user_id'],
    ARRAY['organizer_customer_incidents', 'organizer_user_id'],
    ARRAY['organizer_customer_notes', 'organizer_user_id'],
    ARRAY['customer_activity_log', 'organizer_user_id'],
    ARRAY['email_campaigns', 'organizer_user_id'],
    ARRAY['newsletter_subscriptions', 'organizer_user_id'],
    ARRAY['marketing_consent_events', 'organizer_user_id'],
    ARRAY['sms_credit_balances', 'organizer_id'],
    ARRAY['sms_credit_transactions', 'organizer_id'],
    ARRAY['sms_logs', 'organizer_id'],
    ARRAY['sms_campaigns', 'organizer_id'],
    -- Tracking & analytics bruts.
    ARRAY['tracked_links', 'organizer_user_id'],
    ARRAY['attribution_touchpoints', 'organizer_user_id'],
    ARRAY['visitor_events', 'organizer_user_id'],
    ARRAY['visitor_sessions', 'organizer_user_id'],
    ARRAY['live_visitor_pings', 'organizer_user_id'],
    -- Facturation.
    ARRAY['invoices', 'organizer_user_id'],
    ARRAY['invoice_numbers', 'organizer_user_id'],
    -- Promoteurs.
    ARRAY['promoters', 'organizer_user_id'],
    ARRAY['promoter_teams', 'organizer_user_id'],
    ARRAY['promoter_announcements', 'organizer_user_id'],
    ARRAY['promoter_payouts', 'organizer_user_id'],
    ARRAY['promoter_invitations', 'organizer_user_id'],
    ARRAY['commission_templates', 'organizer_user_id'],
    -- DJ.
    ARRAY['djs', 'organizer_user_id'],
    ARRAY['dj_sets', 'organizer_user_id'],
    ARRAY['dj_invitations', 'organizer_user_id'],
    ARRAY['dj_booking_requests', 'organizer_user_id'],
    ARRAY['dj_residencies', 'organizer_user_id'],
    ARRAY['dj_booking_contracts', 'organizer_user_id'],
    -- Collab & partenariats.
    ARRAY['event_collab_contracts', 'organizer_user_id'],
    ARRAY['event_collab_series_contracts', 'organizer_user_id'],
    ARRAY['event_collab_amendments', 'organizer_user_id'],
    ARRAY['event_collab_action_requests', 'organizer_user_id'],
    ARRAY['collab_table_settlements', 'organizer_user_id'],
    ARRAY['venue_organizer_partnerships', 'organizer_user_id'],
    ARRAY['venue_claim_invitations', 'organizer_user_id'],
    -- Agence.
    ARRAY['agency_venue_contracts', 'organizer_user_id'],
    ARRAY['agency_conversions', 'organizer_user_id'],
    ARRAY['agency_payouts', 'organizer_user_id']
  ];
BEGIN
  IF p_shadow_user_id IS NULL OR p_new_owner_id IS NULL THEN
    RAISE EXCEPTION 'handoff_bad_args';
  END IF;
  IF p_shadow_user_id = p_new_owner_id THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  SELECT op.is_showcase_shadow INTO v_is_shadow
    FROM public.organizer_profiles op
   WHERE op.user_id = p_shadow_user_id
   FOR UPDATE;
  IF NOT FOUND OR NOT v_is_shadow THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  SELECT * INTO v_shadow_profile FROM public.organizer_profiles WHERE user_id = p_shadow_user_id;
  v_merge := EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = p_new_owner_id);

  IF NOT v_merge THEN
    -- ── Mode ADOPTION : le profil vitrine change de porteur ──────────────────
    -- Alias détachés (FK sans ON UPDATE CASCADE) puis re-posés.
    SELECT array_agg(slug) INTO v_aliases
      FROM public.organizer_slug_aliases WHERE user_id = p_shadow_user_id;
    DELETE FROM public.organizer_slug_aliases WHERE user_id = p_shadow_user_id;

    -- is_showcase_shadow reste TRUE jusqu'à la fin : pendant le re-parentage
    -- des events, zz_showcase_hide_event les maintient non-découvrables (le
    -- profil est privé — pas de cartes Explore vers des pages introuvables).
    UPDATE public.organizer_profiles
       SET user_id = p_new_owner_id
     WHERE user_id = p_shadow_user_id;

    IF v_aliases IS NOT NULL THEN
      INSERT INTO public.organizer_slug_aliases (slug, user_id)
      SELECT unnest(v_aliases), p_new_owner_id
      ON CONFLICT (slug) DO NOTHING;
    END IF;
  ELSE
    -- ── Mode FUSION : le contenu rejoint le profil orga existant ─────────────
    -- Dédoublonnage des tables à contrainte UNIQUE par organisateur (no-ops en
    -- pratique — une vitrine n'a ni ventes ni SMS) AVANT le re-parentage.
    DELETE FROM public.organizer_profile_followers f
     WHERE f.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.organizer_profile_followers x
                    WHERE x.organizer_user_id = p_new_owner_id AND x.user_id = f.user_id);
    DELETE FROM public.org_staff s
     WHERE s.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.org_staff x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND lower(x.email) = lower(s.email) AND x.role = s.role);
    DELETE FROM public.organizer_banned_emails b
     WHERE b.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.organizer_banned_emails x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND lower(x.email) = lower(b.email));
    DELETE FROM public.newsletter_subscriptions n
     WHERE n.organizer_user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.newsletter_subscriptions x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND lower(x.email) = lower(n.email));
    DELETE FROM public.venue_organizer_partnerships vp
     WHERE vp.organizer_user_id = p_shadow_user_id
       AND vp.status IN ('pending', 'active')
       AND EXISTS (SELECT 1 FROM public.venue_organizer_partnerships x
                    WHERE x.organizer_user_id = p_new_owner_id
                      AND x.venue_id = vp.venue_id AND x.status IN ('pending', 'active'));
    -- L'état du prospect prime (lignes uniques par user) :
    DELETE FROM public.organizer_onboarding o
     WHERE o.user_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.organizer_onboarding x WHERE x.user_id = p_new_owner_id);
    DELETE FROM public.sms_credit_balances s
     WHERE s.organizer_id = p_shadow_user_id
       AND EXISTS (SELECT 1 FROM public.sms_credit_balances x WHERE x.organizer_id = p_new_owner_id);
    DELETE FROM public.audience_daily_snapshots a
     WHERE a.subject_type = 'organizer' AND a.subject_id = p_shadow_user_id::text
       AND EXISTS (SELECT 1 FROM public.audience_daily_snapshots x
                    WHERE x.subject_type = 'organizer'
                      AND x.subject_id = p_new_owner_id::text
                      AND x.snapshot_date = a.snapshot_date);

    -- Les alias du fantôme passent au prospect (sa row organizer_profiles
    -- existe, la FK est satisfaite).
    UPDATE public.organizer_slug_aliases
       SET user_id = p_new_owner_id
     WHERE user_id = p_shadow_user_id;
  END IF;

  -- Re-parentage de toutes les données keyées sur le fantôme (commun).
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', v_pair[1], v_pair[2], v_pair[2])
      USING p_new_owner_id, p_shadow_user_id;
  END LOOP;

  -- Journal d'audience (subject_id est un text).
  UPDATE public.audience_follow_events
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;
  UPDATE public.audience_daily_snapshots
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;
  UPDATE public.audience_recap_log
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;

  IF v_merge THEN
    -- Le profil fantôme disparaît (libère son slug), qui devient un alias du
    -- prospect — les liens d'aperçu partagés continuent de résoudre.
    DELETE FROM public.organizer_profiles WHERE user_id = p_shadow_user_id;
    IF COALESCE(v_shadow_profile.slug, '') <> '' THEN
      INSERT INTO public.organizer_slug_aliases (slug, user_id)
      VALUES (v_shadow_profile.slug, p_new_owner_id)
      ON CONFLICT (slug) DO NOTHING;
    END IF;

    -- Le profil existant ADOPTE la présentation vitrine. Le trigger de slug
    -- regénère depuis le nouveau display_name : le slug vitrine exact est
    -- libre (profil supprimé, alias au prospect → exclus de la
    -- désambiguïsation) et l'ancien slug du prospect est archivé en alias.
    -- Le cooldown de renommage laisse passer (auth.uid() NULL en service role).
    UPDATE public.organizer_profiles
       SET display_name = v_shadow_profile.display_name,
           bio = COALESCE(v_shadow_profile.bio, bio),
           avatar_url = COALESCE(v_shadow_profile.avatar_url, avatar_url),
           cover_url = COALESCE(v_shadow_profile.cover_url, cover_url),
           city = COALESCE(v_shadow_profile.city, city),
           instagram_url = COALESCE(v_shadow_profile.instagram_url, instagram_url),
           website_url = COALESCE(v_shadow_profile.website_url, website_url)
     WHERE user_id = p_new_owner_id;
  END IF;

  -- Le fantôme redevient un compte inerte : plus organisateur, plus de rôle.
  -- (Neutraliser profile_type d'abord, sinon le trigger de synchro recréerait
  -- le rôle.)
  UPDATE public.profiles
     SET profile_type = 'club', organization_name = NULL
   WHERE id = p_shadow_user_id;
  DELETE FROM public.user_roles
   WHERE user_id = p_shadow_user_id AND role = 'organizer';

  -- Les liens preview de la vitrine meurent avec la réclamation.
  UPDATE public.demo_preview_links
     SET is_active = false, revoked_at = now()
   WHERE organizer_user_id = p_shadow_user_id AND revoked_at IS NULL;

  UPDATE public.showcase_claim_requests
     SET status = 'completed', completed_at = now(), updated_at = now()
   WHERE organizer_user_id = p_shadow_user_id AND status = 'pending';

  IF NOT v_merge THEN
    -- Fin de vitrine (adoption) : le marqueur tombe. Les events restent
    -- volontairement non-découvrables tant que le profil est privé — la
    -- publication du profil relance leur évaluation (20260826115000).
    UPDATE public.organizer_profiles
       SET is_showcase_shadow = false
     WHERE user_id = p_new_owner_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'shadow_user_id', p_shadow_user_id, 'merged', v_merge);
END;
$$;

REVOKE ALL ON FUNCTION public.handoff_showcase_organizer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_showcase_organizer(uuid, uuid) TO service_role;
