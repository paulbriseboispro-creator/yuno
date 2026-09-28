-- ============================================================================
-- Synchro des liens billetterie depuis les pages promoteur Whan (2026-09-28).
--
-- Un affilié (aujourd'hui : Mad by Night seul) déclare ses comptes promoteur
-- Whan, par ordre de priorité (Paul Brisebois d'abord, Mad by Night ensuite).
-- L'edge `affiliate-ticket-sync` lit leur API publique
-- (/api/v1/public/rrpp/<slug>), rapproche chaque soirée Whan d'une occurrence
-- récurrente Yuno (club + nuit + série) et pose le lien du compte prioritaire
-- qui la vend. Tous les soirs à 18 h (Madrid) et à la demande.
--
-- Règles :
--  * un lien déjà posé n'est JAMAIS remplacé — la garde vit ici, dans
--    affiliate_ticket_sync_apply, pas dans le Deno ;
--  * un lien posé par la synchro est marqué ticket_url_overridden : sinon le
--    générateur de 06 h le remettrait sur le lien (expiré) du modèle ;
--  * aucune écriture client : sources et journal sont en lecture seule pour
--    l'affilié, tout passe par service_role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.affiliate_ticket_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'whan' CHECK (provider IN ('whan')),
  account_slug text NOT NULL,
  label        text,
  priority     int  NOT NULL DEFAULT 1,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, provider, account_slug)
);

COMMENT ON TABLE public.affiliate_ticket_sources IS
  'Comptes promoteur (Whan) lus par affiliate-ticket-sync. priority 1 = compte utilisé par défaut quand une soirée est sur plusieurs comptes.';

CREATE TABLE IF NOT EXISTS public.affiliate_ticket_sync_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  trigger      text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual', 'import')),
  links_filled int NOT NULL DEFAULT 0,
  images_set   int NOT NULL DEFAULT 0,
  names_set    int NOT NULL DEFAULT 0,
  todo         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- occurrences sans lien que la synchro n'a pas su trancher
  unmatched    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- soirées Whan sans occurrence Yuno
  errors       jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_affiliate_ticket_sync_runs_aff
  ON public.affiliate_ticket_sync_runs (affiliate_id, ran_at DESC);

ALTER TABLE public.affiliate_recurring_templates
  ADD COLUMN IF NOT EXISTS external_series_key text;
COMMENT ON COLUMN public.affiliate_recurring_templates.external_series_key IS
  'Série Whan suivie par ce modèle (« whan:<club>:<nom normalisé> »), posée par affiliate-ticket-sync. Sert à départager deux soirées Whan du même club la même nuit.';

ALTER TABLE public.affiliate_events
  ADD COLUMN IF NOT EXISTS external_event_ref text;
COMMENT ON COLUMN public.affiliate_events.external_event_ref IS
  'Soirée billetterie rapprochée (« whan:<event_id> ») par affiliate-ticket-sync.';

ALTER TABLE public.affiliate_ticket_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_ticket_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Affiliate reads own ticket sources" ON public.affiliate_ticket_sources;
CREATE POLICY "Affiliate reads own ticket sources" ON public.affiliate_ticket_sources
  FOR SELECT USING (affiliate_id IN (SELECT a.id FROM public.affiliates a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS "Affiliate reads own ticket sync runs" ON public.affiliate_ticket_sync_runs;
CREATE POLICY "Affiliate reads own ticket sync runs" ON public.affiliate_ticket_sync_runs
  FOR SELECT USING (affiliate_id IN (SELECT a.id FROM public.affiliates a WHERE a.user_id = auth.uid()));

-- La publication d'une soirée prévient l'équipe (« Nouvelle soirée : … »).
-- Un import qui publie des semaines d'un coup ne doit pas l'inonder :
-- `yuno.silent_publish = 'on'` (SET LOCAL, posé par affiliate_ticket_sync_apply
-- en mode silencieux) coupe cette notification pour la transaction seulement.
CREATE OR REPLACE FUNCTION public.auto_notify_event_published()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('published', 'featured') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'featured') THEN RETURN NEW; END IF;
  IF coalesce(current_setting('yuno.silent_publish', true), '') = 'on' THEN RETURN NEW; END IF;
  IF NOT aff_auto_enabled(NEW.affiliate_id, 'new_event_published') THEN RETURN NEW; END IF;

  INSERT INTO affiliate_notifications
    (affiliate_id, target_member_id, type, automation_type, title, body, action_url, auto_params)
  VALUES (
    NEW.affiliate_id, NULL, 'automation', 'new_event_published',
    'Nouvelle soirée : ' || NEW.name,
    to_char(NEW.event_date, 'DD/MM') || ' — ajoute-la à ton linktree et prépare ta promo.',
    '/affiliate/promoteur/linktree?event=' || NEW.id,
    jsonb_build_object('name', NEW.name, 'date', to_char(NEW.event_date, 'DD/MM'))
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

-- Seule porte d'écriture de la synchro sur les soirées. Chaque ligne :
--   {id, url?, ref?, flyer_url?, name?}
-- url  : posé SEULEMENT si la soirée n'a pas de lien (jamais de remplacement),
--        avec ticket_url_overridden = true et external_event_ref ;
-- flyer_url / name : posés seulement si l'occurrence n'a pas été
--        personnalisée à la main (flyer_overridden / name_overridden).
CREATE OR REPLACE FUNCTION public.affiliate_ticket_sync_apply(
  p_affiliate_id uuid,
  p_rows jsonb,
  p_silent boolean DEFAULT false
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
         AND external_ticket_url IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_links := v_links + v_n;
    END IF;

    IF nullif(v_row->>'flyer_url', '') IS NOT NULL THEN
      UPDATE affiliate_events
         SET flyer_url = v_row->>'flyer_url'
       WHERE id = (v_row->>'id')::uuid
         AND affiliate_id = p_affiliate_id
         AND NOT flyer_overridden
         AND flyer_url IS DISTINCT FROM v_row->>'flyer_url';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_flyers := v_flyers + v_n;
    END IF;

    IF nullif(v_row->>'name', '') IS NOT NULL THEN
      UPDATE affiliate_events
         SET name = v_row->>'name'
       WHERE id = (v_row->>'id')::uuid
         AND affiliate_id = p_affiliate_id
         AND NOT name_overridden
         AND name IS DISTINCT FROM v_row->>'name';
      GET DIAGNOSTICS v_n = ROW_COUNT; v_names := v_names + v_n;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('links', v_links, 'flyers', v_flyers, 'names', v_names);
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_ticket_sync_apply(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_ticket_sync_apply(uuid, jsonb, boolean) TO service_role;

-- Mad by Night : compte Paul Brisebois par défaut, Mad by Night ensuite.
INSERT INTO public.affiliate_ticket_sources (affiliate_id, provider, account_slug, label, priority)
SELECT a.id, 'whan', s.slug, s.label, s.prio
FROM public.affiliates a
CROSS JOIN (VALUES ('paul-brisebois-2', 'Paul Brisebois', 1),
                   ('milo-madbynight', 'Mad by Night', 2)) AS s(slug, label, prio)
WHERE a.id = 'e3266355-d177-4151-9ae3-b0fb54950df3'
ON CONFLICT (affiliate_id, provider, account_slug) DO NOTHING;

-- 18 h à Madrid = 16 h UTC l'été, 17 h UTC l'hiver : le cron tape les deux,
-- la fonction ne travaille que si l'heure de Madrid est 18.
DO $$
BEGIN
  PERFORM cron.unschedule('affiliate-ticket-sync')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'affiliate-ticket-sync');
  PERFORM cron.schedule(
    'affiliate-ticket-sync',
    '0 16,17 * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/affiliate-ticket-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.get_cron_secret()),
      body := '{"mode":"sync","trigger":"cron"}'::jsonb,
      timeout_milliseconds := 120000
    );
    $cron$
  );
END;
$$;
