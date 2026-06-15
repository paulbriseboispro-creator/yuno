-- ============================================================================
-- Convertir 3 soirées du club démo Yuno en SOIRÉES RÉCURRENTES hebdo (owner@womber.fr) :
--   • Techno Sunrise   -> tous les JEUDI   (day_of_week = 4)
--   • Electronic Body  -> tous les VENDREDI (day_of_week = 5)  [house]
--   • Reggaeton Party  -> tous les SAMEDI  (day_of_week = 6)
-- Récurrent jusqu'à désactivation (owner_recurring_templates.is_active = true ;
-- tu désactives depuis l'onglet « Récurrentes » du dashboard Events quand tu veux).
--
-- À COLLER DANS : Supabase Dashboard > SQL Editor (projet fulawxvdlwtdlpkycixe).
-- Idempotent : si une soirée est déjà récurrente, elle est ignorée.
--
-- ⚠️ NE RELANCE PAS seed-demo-womber.sql après avoir édité tes events (vrais flyers) :
--    son teardown supprime les events tagués DEMO_SEED. Ce script-ci est SÉPARÉ et additif.
--
-- Reprend le flyer / la description / les paliers de billets ACTUELS de chaque event,
-- crée un preset billetterie + un template récurrent, puis génère les occurrences à venir.
-- ============================================================================

DO $$
DECLARE
  v_owner  uuid;
  v_venue  text;
  rec      record;
  nights   record;
  v_preset uuid;
  v_tpl    uuid;
  v_rounds jsonb;
  v_cap    int;
BEGIN
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'owner@womber.fr introuvable.'; END IF;
  SELECT v.id INTO v_venue FROM venues v WHERE v.owner_id = v_owner LIMIT 1;
  IF v_venue IS NULL THEN
    SELECT p.venue_id INTO v_venue FROM profiles p WHERE p.id = v_owner AND p.venue_id IS NOT NULL;
  END IF;
  IF v_venue IS NULL THEN RAISE EXCEPTION 'Club Yuno introuvable.'; END IF;

  FOR nights IN SELECT * FROM (VALUES
      ('%techno sunrise%',  4, 'techno'),   -- jeudi
      ('%electronic body%', 5, 'house'),    -- vendredi
      ('%reggaeton%',       6, 'latino')    -- samedi
    ) n(pat, dow, genre)
  LOOP
    -- Déjà converti ? -> on saute (idempotence).
    IF EXISTS (SELECT 1 FROM owner_recurring_templates WHERE venue_id = v_venue AND name ILIKE nights.pat) THEN
      RAISE NOTICE 'Déjà récurrent (%), ignoré.', nights.pat;
      CONTINUE;
    END IF;

    -- Soirée source (la plus récente qui matche, sur le club).
    SELECT * INTO rec FROM events
      WHERE venue_id = v_venue AND is_active = true AND title ILIKE nights.pat
      ORDER BY start_at DESC LIMIT 1;
    IF rec.id IS NULL THEN
      RAISE WARNING 'Aucune soirée "%": rien à convertir.', nights.pat;
      CONTINUE;
    END IF;

    -- Paliers billets actuels -> rounds preset (camelCase attendu par _insert_recurring_rounds).
    SELECT jsonb_agg(jsonb_build_object(
             'name', tr.name, 'price', tr.price, 'maxTickets', tr.max_tickets,
             'lastTicketsThreshold', COALESCE(tr.last_tickets_threshold, 20)
           ) ORDER BY tr.position),
           COALESCE(sum(tr.max_tickets), 0)
      INTO v_rounds, v_cap
      FROM ticket_rounds tr WHERE tr.event_id = rec.id;
    IF v_rounds IS NULL THEN
      v_rounds := '[{"name":"Early Bird","price":18,"maxTickets":150,"lastTicketsThreshold":20},
                    {"name":"Regular","price":28,"maxTickets":300,"lastTicketsThreshold":20},
                    {"name":"Last Tickets","price":39,"maxTickets":200,"lastTicketsThreshold":20}]'::jsonb;
      v_cap := 650;
    END IF;

    -- Preset billetterie.
    v_preset := gen_random_uuid();
    INSERT INTO ticket_presets (id, venue_id, name, rounds, total_capacity, selling_mode, ticket_type)
    VALUES (v_preset, v_venue, rec.title || ' — preset', v_rounds, v_cap, 'rounds', 'standard');

    -- Template récurrent (reprend le branding de l'event).
    v_tpl := gen_random_uuid();
    INSERT INTO owner_recurring_templates (id, venue_id, name, description, poster_url, poster_position,
      music_genres, event_type, day_of_week, start_time, end_time, advance_days,
      ticket_preset_id, auto_enable_tables, is_active)
    VALUES (v_tpl, v_venue, rec.title, rec.description, rec.poster_url, rec.poster_position,
      COALESCE(NULLIF(rec.music_genres, '{}'), ARRAY[nights.genre]), COALESCE(rec.event_type, 'club'),
      nights.dow,
      (rec.start_at AT TIME ZONE 'Europe/Paris')::time,
      (rec.end_at   AT TIME ZONE 'Europe/Paris')::time,
      7, v_preset, COALESCE(rec.tables_enabled, true), true);

    -- La soirée one-shot est remplacée par la série hebdo (le flyer vit dans le template).
    DELETE FROM events WHERE id = rec.id;

    -- Génère les occurrences à venir (fenêtre advance_days) tout de suite.
    PERFORM generate_recurring_events(v_tpl);

    RAISE NOTICE 'Converti "%": récurrent jour % (occurrences générées).', rec.title, nights.dow;
  END LOOP;

  -- Garder les occurrences générées masquées du public + taguées pour le teardown.
  UPDATE events SET visibility = 'private', is_discoverable = false, access_code = 'DEMO_SEED'
  WHERE venue_id = v_venue AND recurring_template_id IN (SELECT id FROM owner_recurring_templates WHERE venue_id = v_venue)
    AND access_code IS DISTINCT FROM 'DEMO_SEED';
END $$;

-- Récap : templates + nombre d'occurrences générées.
SELECT t.name AS soiree,
       CASE t.day_of_week WHEN 4 THEN 'jeudi' WHEN 5 THEN 'vendredi' WHEN 6 THEN 'samedi' ELSE t.day_of_week::text END AS jour,
       to_char(t.start_time, 'HH24:MI') || ' - ' || to_char(t.end_time, 'HH24:MI') AS horaire,
       t.is_active AS actif,
       (SELECT count(*) FROM events e WHERE e.recurring_template_id = t.id) AS occurrences
FROM owner_recurring_templates t
WHERE t.venue_id = (SELECT v.id FROM venues v JOIN auth.users u ON v.owner_id = u.id WHERE u.email = 'owner@womber.fr' LIMIT 1)
ORDER BY t.day_of_week;
