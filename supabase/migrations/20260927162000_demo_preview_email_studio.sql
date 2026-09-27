-- Lien démo : l'Email Studio se TESTE, rien ne part (2026-09-27).
--
-- Demande de Paul : les prospects doivent pouvoir créer un email, cibler une
-- audience et voir la segmentation intelligente sur une base de 1 200
-- contacts fictifs (scripts/demo/seed-demo-contacts.mjs) — sans rien envoyer.
--
-- 20260927160000 met toute session d'aperçu en lecture seule. On rouvre ici,
-- et SEULEMENT pour la composition :
--   • tables email_campaigns / email_campaign_templates : INSERT et UPDATE
--     (brouillon, autosave du Studio, « enregistrer comme modèle ») ; jamais
--     DELETE (un prospect n'efface pas les campagnes de la démo) ;
--   • RPC de composition : segments enregistrés, compteur d'usage d'un
--     modèle, actualisation de la base vivante.
-- Et on ferme la sortie : une session d'aperçu ne fait jamais passer une
-- campagne en `sending` / `scheduled` (trigger ci-dessous). Derrière, tout
-- envoi du périmètre démo est de toute façon refusé par les trois workers
-- (send-campaign, send-sms-campaign, send-push-campaign → `demo_no_send`),
-- quelle que soit la session : c'est la vraie garantie.

-- ─── 1. RPC inscriptibles en aperçu (liste complète, remplace 160000) ───────
CREATE OR REPLACE FUNCTION public.demo_preview_writable_rpc(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
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
    'refresh_contact_engagement', 'refresh_campaign_list_impacts'
  ]::text[]);
$$;

-- ─── 2. Tables inscriptibles en aperçu (INSERT / UPDATE seulement) ──────────
CREATE OR REPLACE FUNCTION public.demo_preview_writable_table(p_name text, p_method text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(coalesce(p_method, '')) IN ('POST', 'PATCH')
     AND lower(coalesce(p_name, '')) = ANY (ARRAY['email_campaigns', 'email_campaign_templates']::text[]);
$$;

GRANT EXECUTE ON FUNCTION public.demo_preview_writable_table(text, text) TO anon, authenticated, service_role, authenticator;

-- ─── 3. Hook pre-request : même corps + la porte des tables ─────────────────
CREATE OR REPLACE FUNCTION public.pgrst_demo_preview_guard()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_path text;
  v_fn   text;
BEGIN
  IF NOT public.is_demo_preview_session() THEN
    RETURN;
  END IF;

  BEGIN
    v_path := coalesce(current_setting('request.path', true), '');
    IF v_path LIKE '%/rpc/%' THEN
      v_fn := lower(split_part(substring(v_path FROM position('/rpc/' IN v_path) + 5), '/', 1));
      IF public.demo_preview_writable_rpc(v_fn) THEN
        RETURN;
      END IF;
    ELSIF public.demo_preview_writable_table(
            split_part(ltrim(v_path, '/'), '/', 1),
            current_setting('request.method', true)) THEN
      RETURN;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- chemin illisible : on tombe dans la lecture seule
  END;

  -- Les exports sont des LECTURES, que la lecture seule laisse passer : un
  -- aperçu n'en sort aucun fichier.
  IF v_fn LIKE 'export\_%' THEN
    RAISE EXCEPTION 'demo_read_only' USING ERRCODE = '42501',
      HINT = 'Aperçu de démonstration : export désactivé.';
  END IF;

  PERFORM set_config('transaction_read_only', 'on', true);
END;
$$;

-- ─── 4. Une session d'aperçu ne met jamais une campagne en route ────────────
-- Discrimine sur le JWT (is_demo_preview_session), pas sur current_user :
-- peut donc rester SECURITY INVOKER sans se désactiver. Une campagne déjà
-- planifiée que le Studio ré-enregistre (statut inchangé) passe.
CREATE OR REPLACE FUNCTION public.demo_preview_campaign_draft_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('sending', 'scheduled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND public.is_demo_preview_session() THEN
    RAISE EXCEPTION 'demo_no_send' USING ERRCODE = '42501',
      HINT = 'Aperçu de démonstration : composer oui, envoyer non.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS demo_preview_campaign_draft_only ON public.email_campaigns;
CREATE TRIGGER demo_preview_campaign_draft_only
  BEFORE INSERT OR UPDATE OF status ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.demo_preview_campaign_draft_only();
