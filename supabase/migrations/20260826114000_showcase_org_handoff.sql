-- ============================================================================
-- Comptes vitrine ORGANISATEUR — handoff à la réclamation (re-parentage).
--
-- Contrairement au club (venue_id stable, transfert = un owner_id), l'identité
-- d'un organisateur EST son user : toutes les données orga sont keyées sur
-- user_id. La réclamation re-parente donc TOUT ce qui pointe sur le fantôme
-- vers le compte du vrai client. La liste des (table, colonne) ci-dessous
-- vient d'un audit exhaustif du schéma (2026-08-26) ; la plupart seront des
-- no-ops (un fantôme fraîchement construit n'a ni SMS, ni collab, ni agence),
-- mais un UPDATE sur zéro ligne ne coûte rien et la liste est la garantie.
--
-- Appelé EXPLICITEMENT par les deux edges (service role) :
--   • invite-platform-user, branche « user existant » (conversion immédiate,
--     sans acceptation — pas de point d'accroche pour un trigger) ;
--   • accept-platform-invitation, action accept, quand l'invitation porte
--     showcase_shadow_user_id.
--
-- Pièges gérés :
--   • organizer_slug_aliases.user_id → FK organizer_profiles(user_id) SANS
--     ON UPDATE CASCADE : détacher les alias avant l'UPDATE de la PK, les
--     re-poser après.
--   • trg_sync_organizer_role_from_profile recrée user_roles 'organizer'
--     depuis profiles.profile_type : retirer le rôle du fantôme APRÈS avoir
--     neutralisé son profile_type.
--   • organizer_payout_details : PAS re-parenté — l'IBAN est celui du vrai
--     client, il le saisit lui-même (le fantôme n'en a pas).
--   • analytics_daily_rollup est une MATERIALIZED VIEW : rien à UPDATE, elle
--     se rafraîchit à son rythme (les lignes fantômes sont du bruit de démo).
--   • Le re-parentage des events (UPDATE) re-déclenche
--     evaluate_event_discoverability. Le marqueur vitrine reste posé PENDANT
--     tout le re-parentage (il n'est retiré qu'en toute fin) : ainsi
--     zz_showcase_hide_event maintient is_discoverable=false, et les events ne
--     surgissent pas dans Explore tant que le profil orga est privé — sinon on
--     montrerait des cartes dont la page répond « introuvable » (le profil
--     is_public=false bloque EventDetails pour anon). C'est la PUBLICATION du
--     profil qui re-déclenche l'évaluation (20260826115000).
--
-- Pas de EXCEPTION WHEN OTHERS avaleur : un handoff qui échoue doit faire
-- échouer la réclamation (visible, rejouable), pas laisser un état partiel.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handoff_showcase_organizer(p_shadow_user_id uuid, p_new_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_shadow boolean;
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

  -- Un prospect qui a DÉJÀ un profil orga ne peut pas absorber une vitrine
  -- (collision de PK et de contraintes UNIQUE partout) : cas à traiter à la
  -- main par l'admin. On refuse net.
  IF EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = p_new_owner_id) THEN
    RAISE EXCEPTION 'prospect_already_organizer';
  END IF;

  -- 1) Détacher les alias de slug (FK sans ON UPDATE CASCADE), re-posés en 3).
  SELECT array_agg(slug) INTO v_aliases
    FROM public.organizer_slug_aliases WHERE user_id = p_shadow_user_id;
  DELETE FROM public.organizer_slug_aliases WHERE user_id = p_shadow_user_id;

  -- 2) Le profil orga change de porteur. display_name inchangé → le trigger de
  --    slug ne bouge pas ; is_public reste false (le client publie lui-même).
  --    is_showcase_shadow reste TRUE jusqu'à l'étape 8 : pendant le
  --    re-parentage des events (étape 4), zz_showcase_hide_event doit encore
  --    les maintenir non-découvrables.
  UPDATE public.organizer_profiles
     SET user_id = p_new_owner_id
   WHERE user_id = p_shadow_user_id;

  -- 3) Les anciens slugs résolvent vers le nouveau porteur.
  IF v_aliases IS NOT NULL THEN
    INSERT INTO public.organizer_slug_aliases (slug, user_id)
    SELECT unnest(v_aliases), p_new_owner_id
    ON CONFLICT (slug) DO NOTHING;
  END IF;

  -- 4) Re-parentage de toutes les données keyées sur le fantôme.
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2', v_pair[1], v_pair[2], v_pair[2])
      USING p_new_owner_id, p_shadow_user_id;
  END LOOP;

  -- 5) Journal d'audience (subject_id est un text).
  UPDATE public.audience_follow_events
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;
  UPDATE public.audience_daily_snapshots
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;
  UPDATE public.audience_recap_log
     SET subject_id = p_new_owner_id::text
   WHERE subject_type = 'organizer' AND subject_id = p_shadow_user_id::text;

  -- 6) Le fantôme redevient un compte inerte : plus organisateur, plus de rôle.
  --    (L'ordre compte : neutraliser profile_type d'abord, sinon le trigger de
  --    synchro recréerait le rôle.)
  UPDATE public.profiles
     SET profile_type = 'club', organization_name = NULL
   WHERE id = p_shadow_user_id;
  DELETE FROM public.user_roles
   WHERE user_id = p_shadow_user_id AND role = 'organizer';

  -- 7) Les liens preview de la vitrine meurent avec la réclamation.
  UPDATE public.demo_preview_links
     SET is_active = false, revoked_at = now()
   WHERE organizer_user_id = p_shadow_user_id AND revoked_at IS NULL;

  UPDATE public.showcase_claim_requests
     SET status = 'completed', completed_at = now(), updated_at = now()
   WHERE organizer_user_id = p_shadow_user_id AND status = 'pending';

  -- 8) Fin de vitrine : le marqueur tombe. Les events restent volontairement
  --    non-découvrables tant que le profil est privé — la publication du
  --    profil (toggle is_public de /organizer-app/profile) relance leur
  --    évaluation (trigger de 20260826115000).
  UPDATE public.organizer_profiles
     SET is_showcase_shadow = false
   WHERE user_id = p_new_owner_id;

  RETURN jsonb_build_object('ok', true, 'shadow_user_id', p_shadow_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.handoff_showcase_organizer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_showcase_organizer(uuid, uuid) TO service_role;
