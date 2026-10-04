-- Yuno CRM — les écrans de la Console CRM s'ouvrent dans un aperçu démo.
--
-- Une session d'aperçu démo est en lecture seule (pgrst_demo_preview_guard),
-- et Postgres refuse toute table temporaire dans une transaction en lecture
-- seule. Or la base de clients de la Console se calcule dans des tables
-- temporaires (_crm_people_build → contact_build_rows, _crm_msg_build,
-- _crm_activity_build) : Clients, Segments, Accueil, E-mails, Soirées et
-- Réglages tombaient tous en erreur dès qu'un lien d'aperçu ouvrait le compte
-- CRM démo. Ces lectures rejoignent la liste des RPC autorisées en aperçu :
-- elles n'écrivent que des tables temporaires et des caches (base de
-- contacts, effectifs de segments, estimations d'envoi, rapports de
-- notifications). Rien qui envoie, importe, débite, enregistre ou exporte
-- n'y entre : crm_import_commit, crm_*_save, crm_clients_export,
-- crm_yunits_* restent refusés.

CREATE OR REPLACE FUNCTION public.demo_preview_writable_rpc(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT lower(coalesce(p_name, '')) = ANY (ARRAY[
    -- CTA « Activer mon compte » des sessions vitrine (seul canal d'écriture voulu)
    'request_showcase_claim',
    -- mesure d'audience / live view (battements, vues, clics)
    'ping_live_visitor', 'platform_heartbeat', 'track_platform_view',
    'track_links_event', 'ping_affiliate_live', 'flush_affiliate_session',
    'track_guest_artist_click',
    -- parcours client consultable depuis la démo (anti-flood, déverrouillage)
    'check_promo_code', 'unlock_event_sale', 'open_discovery_selection',
    -- écrans de lecture dont le calcul passe par une table temporaire / un cache
    'list_contact_base', 'count_contact_segment_def', 'analyze_contact_lists',
    'check_contact_import', 'get_contact_intelligence_overview',
    'get_contact_segment_panel', 'get_campaign_list_impact',
    'get_dj_audience', 'get_tracked_link_stats', 'get_user_nightlife_stats',
    'seed_event_tracked_links', 'seed_guest_list_tracked_links',
    'seed_venue_tracked_links', 'demo_is_live',
    -- composition d'un email (20260927162000) : rien de tout ça n'envoie
    'save_contact_segments', 'bump_email_template_usage',
    'refresh_contact_engagement', 'refresh_campaign_list_impacts',
    -- Console Yuno CRM : lectures calculées dans des tables temporaires
    'crm_home', 'crm_clients_overview', 'crm_clients_list', 'crm_client',
    'crm_audience_count', 'crm_audience_counts', 'crm_segments_brief',
    'crm_segments_overview', 'crm_segment_detail', 'crm_import_check',
    'crm_email_overview', 'crm_email_campaigns', 'crm_email_analysis',
    'crm_email_result', 'crm_email_result_segments', 'crm_email_recipients',
    'crm_email_recipient_emails', 'crm_email_send_options',
    'crm_email_audience_preview', 'crm_email_audience_sizes',
    'crm_night_detail', 'crm_rules_preview'
  ]::text[]);
$function$;
