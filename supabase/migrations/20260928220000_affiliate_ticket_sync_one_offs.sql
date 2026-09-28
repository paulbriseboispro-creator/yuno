-- ============================================================================
-- Synchro Whan : soirées PONCTUELLES (2026-09-28).
--
-- Une soirée Whan qui n'appartient à aucune série (Thanksgiving un mardi,
-- « Domingos Santos »…) est créée dans Yuno comme soirée ponctuelle (sans
-- modèle), avec son lien, son affiche, ses horaires et son prix. Réglage par
-- compte : affiliate_ticket_sources.create_one_offs.
--
-- Garde-fous :
--  * une nuit de club couverte par un modèle récurrent reste au modèle
--    (série ou édition spéciale) — jamais de doublon, décidé côté edge ;
--  * affiliate_ticket_sync_seen retient chaque soirée Whan déjà créée : une
--    soirée ponctuelle supprimée par le pro n'est JAMAIS recréée ;
--  * seule écriture : affiliate_ticket_sync_create_one_offs (service_role).
-- ============================================================================

ALTER TABLE public.affiliate_ticket_sources
  ADD COLUMN IF NOT EXISTS create_one_offs boolean NOT NULL DEFAULT false;

ALTER TABLE public.affiliate_ticket_sync_runs
  ADD COLUMN IF NOT EXISTS one_offs_created int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.affiliate_ticket_sync_seen (
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  ref          text NOT NULL,
  event_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (affiliate_id, ref)
);
ALTER TABLE public.affiliate_ticket_sync_seen ENABLE ROW LEVEL SECURITY;

-- Lignes : {ref, venue_id, name, event_date, start_time, end_time, price_from,
--           is_free, flyer_url, url, genres[]}
CREATE OR REPLACE FUNCTION public.affiliate_ticket_sync_create_one_offs(
  p_affiliate_id uuid,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_base text;
  v_slug text;
  v_id uuid;
  v_created int := 0;
  v_i int;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) LOOP
    -- Déjà vue (créée, ou créée puis supprimée) : on n'y touche plus.
    INSERT INTO affiliate_ticket_sync_seen (affiliate_id, ref)
    VALUES (p_affiliate_id, v_row->>'ref')
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Le club doit appartenir à l'affilié.
    IF NOT EXISTS (SELECT 1 FROM affiliate_venues
                   WHERE id = (v_row->>'venue_id')::uuid AND affiliate_id = p_affiliate_id) THEN
      CONTINUE;
    END IF;

    v_base := trim(both '-' from regexp_replace(lower(unaccent_safe(
      (v_row->>'name') || '-' || (v_row->>'event_date'))), '[^a-z0-9]+', '-', 'g'));
    v_slug := v_base;
    v_i := 1;
    WHILE EXISTS (SELECT 1 FROM affiliate_events WHERE slug = v_slug) LOOP
      v_slug := v_base || '-' || v_i;
      v_i := v_i + 1;
    END LOOP;

    INSERT INTO affiliate_events (
      affiliate_id, affiliate_venue_id, name, slug, event_date, start_time, end_time,
      price_from, is_free, flyer_url, genres, external_ticket_url, external_event_ref, status
    ) VALUES (
      p_affiliate_id,
      (v_row->>'venue_id')::uuid,
      v_row->>'name',
      v_slug,
      (v_row->>'event_date')::date,
      nullif(v_row->>'start_time', '')::time,
      nullif(v_row->>'end_time', '')::time,
      nullif(v_row->>'price_from', '')::numeric,
      coalesce((v_row->>'is_free')::boolean, false),
      nullif(v_row->>'flyer_url', ''),
      coalesce(ARRAY(SELECT jsonb_array_elements_text(v_row->'genres')), '{}'::text[]),
      nullif(v_row->>'url', ''),
      v_row->>'ref',
      'published'
    ) RETURNING id INTO v_id;

    UPDATE affiliate_ticket_sync_seen SET event_id = v_id
     WHERE affiliate_id = p_affiliate_id AND ref = v_row->>'ref';
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_created);
END;
$$;

-- unaccent n'est pas garanti sur toutes les bases : repli sans accent maison.
CREATE OR REPLACE FUNCTION public.unaccent_safe(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN translate(p,
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñŠšŽžÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnSsZzYyy');
END;
$$;

REVOKE ALL ON FUNCTION public.affiliate_ticket_sync_create_one_offs(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_ticket_sync_create_one_offs(uuid, jsonb) TO service_role;

-- Réglage depuis la Console : l'affilié (propriétaire) allume ou coupe les
-- soirées ponctuelles pour tous ses comptes.
CREATE OR REPLACE FUNCTION public.set_affiliate_ticket_one_offs(p_enabled boolean)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE affiliate_ticket_sources s
     SET create_one_offs = p_enabled
   WHERE s.affiliate_id IN (SELECT a.id FROM affiliates a WHERE a.user_id = auth.uid());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.set_affiliate_ticket_one_offs(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_affiliate_ticket_one_offs(boolean) TO authenticated;

-- Mad by Night : allumé sur les deux comptes (demande de Paul).
UPDATE public.affiliate_ticket_sources
   SET create_one_offs = true
 WHERE affiliate_id = 'e3266355-d177-4151-9ae3-b0fb54950df3';
