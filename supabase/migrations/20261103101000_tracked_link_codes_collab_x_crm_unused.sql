-- Liens suivis lisibles, deux compléments à 20261103100000 (2026-10-19).
--
-- 1. Un titre trop long perd d'abord les « x » des collabs avant d'être coupé
--    au mot : « CLUB SONORE X EXCLUSIVE X WOH & FRIENDS… » donnait
--    `club-sonore-x-exclusive-x-insta-bio`, il donne
--    `club-sonore-exclusive-woh-insta-bio`. Un titre qui tient garde son « x »
--    (`osmoz-x-revival-face-2-face-insta`). Miroir : `linkSlug`
--    (src/lib/trackedLinkCode.ts), cas partagés tracked-link-codes.json.
-- 2. Les liens d'une soirée Shotgun qui n'ont JAMAIS servi (aucun clic, aucun
--    billet Shotgun qui porte leur code) reçoivent eux aussi leur adresse
--    lisible : rien n'est perdu, l'ancien code reste en alias. Un lien qui a
--    déjà un clic ou une vente garde son code (Shotgun rapporte
--    `yuno-<code>` sur chaque billet). Le SMS garde toujours un code court.

CREATE OR REPLACE FUNCTION public.tracked_link_slug(p_text text, p_max integer DEFAULT 28)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
DECLARE
  v      text;
  w      text;
  v_t    text;
  v_prev text;
  v_out  text := '';
BEGIN
  -- Ligatures, puis accents retirés, puis minuscules : le même ordre que le TS.
  v := coalesce(p_text, '');
  v := replace(replace(v, 'œ', 'oe'), 'Œ', 'oe');
  v := replace(replace(v, 'æ', 'ae'), 'Æ', 'ae');
  v := replace(replace(v, 'ß', 'ss'), 'ẞ', 'ss');
  v := lower(regexp_replace(normalize(v, NFD), '[̀-ͯ]', '', 'g'));
  v := btrim(regexp_replace(v, '[^a-z0-9]+', '-', 'g'), '-');
  IF v = '' OR p_max < 1 THEN RETURN ''; END IF;
  IF length(v) <= p_max THEN RETURN v; END IF;
  -- Trop long : les « x » des collabs sautent avant de couper.
  v_t := '-' || v || '-';
  LOOP
    v_prev := v_t;
    v_t := replace(v_t, '-x-', '-');
    EXIT WHEN v_t = v_prev;
  END LOOP;
  v := btrim(v_t, '-');
  IF length(v) <= p_max THEN RETURN v; END IF;
  -- Coupé au MOT : jamais « house-of-masquer ».
  FOREACH w IN ARRAY string_to_array(v, '-') LOOP
    EXIT WHEN length(v_out) + (CASE WHEN v_out = '' THEN 0 ELSE 1 END) + length(w) > p_max;
    v_out := CASE WHEN v_out = '' THEN w ELSE v_out || '-' || w END;
  END LOOP;
  IF v_out = '' THEN v_out := rtrim(left(v, p_max), '-'); END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.tracked_link_slug(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracked_link_slug(text, integer) TO service_role;

DO $$
DECLARE
  v_link public.tracked_links%ROWTYPE;
  v_code text;
  v_done integer := 0;
BEGIN
  FOR v_link IN
    SELECT tl.*
      FROM public.tracked_links tl
      JOIN public.events e ON e.id = tl.event_id
     WHERE e.external_source IS NOT NULL
       AND lower(coalesce(tl.utm_source, '')) <> 'sms'
       AND tl.code ~ '^[a-z0-9]{8}$'
       AND tl.clicks_count = 0
       AND NOT EXISTS (SELECT 1 FROM public.tracked_link_clicks c WHERE c.tracked_link_id = tl.id)
       -- Toute la table, pas la seule soirée : un code ne doit apparaître sur
       -- AUCUN billet rapporté.
       AND NOT EXISTS (SELECT 1 FROM public.external_tickets t
                        WHERE t.utm::text LIKE '%' || tl.code || '%')
     ORDER BY e.start_at DESC, tl.created_at, tl.id
  LOOP
    v_code := public.tracked_link_readable_code(v_link);
    IF v_code IS DISTINCT FROM v_link.code THEN
      UPDATE public.tracked_links SET code = v_code WHERE id = v_link.id;
      v_done := v_done + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'liens Shotgun jamais utilisés renommés : %', v_done;
END;
$$;
