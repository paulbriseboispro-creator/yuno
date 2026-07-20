-- ============================================================================
-- La consigne du soir + les bravos d'équipe
-- ============================================================================
-- Avant chaque soirée, le patron briefe son équipe par WhatsApp ou de vive
-- voix : dress code, tarif porte qui change à 1h, untel interdit d'entrée,
-- la guest list ferme à minuit. Rien de tout ça ne vivait dans Yuno : le
-- staff ouvrait l'app sur un scanner nu.
--
-- Deux briques :
--   • staff_briefs — UNE consigne par club et par nuit, écrite par l'owner ou
--     un manager (permission staff), lue par tout le staff terrain. Accusés de
--     lecture dans staff_brief_reads (« vu par 4/6 » côté owner).
--   • staff_kudos — un bravo nominatif, visible par toute l'équipe du club.
--     C'est le social qui soude sans classer : pas de score, pas de rang,
--     juste une reconnaissance horodatée qui atterrit dans le récap de nuit.
--
-- Convention maison pour la nuit : elle démarre à 6h du matin HEURE DE PARIS
-- (cf. 20260718110000_staff_stats_paris_night.sql). paris_night_date() est le
-- bucket partagé par toutes les briques de nuit.
-- ============================================================================


-- ── 0. Le bucket de nuit partagé ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.paris_night_date(p_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (date_trunc('day', (p_at AT TIME ZONE 'Europe/Paris') - interval '6 hours'))::date
$$;


-- ── 1. La consigne du soir ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_briefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  night_date date NOT NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 800),
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, night_date)
);

ALTER TABLE public.staff_briefs ENABLE ROW LEVEL SECURITY;

-- Lecture : tout le staff de nuit du club (owner et manager inclus).
CREATE POLICY "night staff can read briefs"
  ON public.staff_briefs
  FOR SELECT
  USING (public.is_night_staff_of_venue(venue_id));

-- Écriture : uniquement via upsert_staff_brief (SECURITY DEFINER, garde owner/
-- manager). Aucune policy INSERT/UPDATE/DELETE : un videur ne réécrit pas la
-- consigne du patron.

-- La consigne peut tomber en plein service : les écrans staff l'écoutent.
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_briefs;


-- Accusés de lecture. PK composite : un « vu » par personne et par consigne.
CREATE TABLE IF NOT EXISTS public.staff_brief_reads (
  brief_id uuid NOT NULL REFERENCES public.staff_briefs(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL,
  read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brief_id, user_id)
);

ALTER TABLE public.staff_brief_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "night staff can mark brief read"
  ON public.staff_brief_reads
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.staff_briefs b
       WHERE b.id = brief_id
         AND public.is_night_staff_of_venue(b.venue_id)
    )
  );

CREATE POLICY "night staff can read brief reads"
  ON public.staff_brief_reads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_briefs b
       WHERE b.id = brief_id
         AND public.is_night_staff_of_venue(b.venue_id)
    )
  );


-- Écrire (ou effacer) la consigne de la nuit en cours.
-- p_body vide ou blanc = effacer. Notifie le staff terrain à la création, puis
-- au plus une fois par quart d'heure sur les rééditions — l'owner qui corrige
-- une faute ne doit pas faire vibrer quatre téléphones à chaque frappe.
CREATE OR REPLACE FUNCTION public.upsert_staff_brief(p_venue_id text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_body   text := NULLIF(btrim(COALESCE(p_body, '')), '');
  v_night  date := public.paris_night_date();
  v_brief  public.staff_briefs%ROWTYPE;
  v_last_notif timestamptz;
  v_role   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_venue_owner(v_uid, p_venue_id)
    OR public.manager_has_permission(v_uid, p_venue_id, 'staff')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_body IS NULL THEN
    DELETE FROM public.staff_briefs
     WHERE venue_id = p_venue_id AND night_date = v_night;
    RETURN jsonb_build_object('deleted', true);
  END IF;

  IF char_length(v_body) > 800 THEN
    RAISE EXCEPTION 'brief too long' USING ERRCODE = '22001';
  END IF;

  INSERT INTO public.staff_briefs (venue_id, night_date, body, updated_by)
  VALUES (p_venue_id, v_night, v_body, v_uid)
  ON CONFLICT (venue_id, night_date)
  DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING * INTO v_brief;

  -- Réveil du staff terrain : une notification par rôle (le pont push résout
  -- les destinataires par rôle), throttlée à 15 min pour les rééditions.
  SELECT max(created_at) INTO v_last_notif
    FROM public.staff_notifications
   WHERE venue_id = p_venue_id
     AND notification_type = 'night_brief'
     AND created_at >= (v_night::timestamp AT TIME ZONE 'Europe/Paris') + interval '6 hours';

  IF v_last_notif IS NULL OR v_last_notif < now() - interval '15 minutes' THEN
    FOREACH v_role IN ARRAY ARRAY['bouncer', 'barman', 'cloakroom', 'vip_host'] LOOP
      INSERT INTO public.staff_notifications (
        venue_id, target_role, notification_type, title, message, priority, metadata
      ) VALUES (
        p_venue_id, v_role, 'night_brief',
        'Consigne du soir',
        left(v_body, 180),
        'high',
        jsonb_build_object('actor_id', v_uid, 'body_preview', left(v_body, 140))
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', v_brief.id,
    'night_date', v_brief.night_date,
    'body', v_brief.body,
    'updated_at', v_brief.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_staff_brief(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_staff_brief(text, text) TO authenticated;


-- ── 2. Les bravos d'équipe ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_kudos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   text NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  night_date date NOT NULL DEFAULT public.paris_night_date(),
  from_user  uuid NOT NULL,
  to_user    uuid NOT NULL,
  body       text CHECK (body IS NULL OR char_length(body) <= 140),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_kudos_not_self CHECK (from_user <> to_user)
);

CREATE INDEX IF NOT EXISTS idx_staff_kudos_venue_night
  ON public.staff_kudos (venue_id, night_date DESC);
CREATE INDEX IF NOT EXISTS idx_staff_kudos_recipient
  ON public.staff_kudos (to_user, created_at DESC);

ALTER TABLE public.staff_kudos ENABLE ROW LEVEL SECURITY;

-- Un bravo est public dans l'équipe : c'est sa raison d'être.
CREATE POLICY "night staff can read kudos"
  ON public.staff_kudos
  FOR SELECT
  USING (public.is_night_staff_of_venue(venue_id));

-- Écriture via send_staff_kudos uniquement (garde + anti-spam + notification).


CREATE OR REPLACE FUNCTION public.send_staff_kudos(p_to_user uuid, p_body text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_venue     text;
  v_body      text := NULLIF(btrim(COALESCE(p_body, '')), '');
  v_from_name text;
  v_target_role text;
  v_kudos_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Le club de référence est celui du DESTINATAIRE : l'owner n'a pas toujours
  -- de profiles.venue_id, le staff si.
  SELECT p.venue_id INTO v_venue FROM public.profiles p WHERE p.id = p_to_user;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'recipient has no venue' USING ERRCODE = '22023';
  END IF;

  -- Émetteurs : owner, manager (permission staff), ou un collègue du même club.
  IF NOT public.is_night_staff_of_venue(v_venue) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Le destinataire doit être du staff terrain ou manager de ce club.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = p_to_user
       AND ur.role IN ('barman', 'bouncer', 'cloakroom', 'vip_host', 'manager')
  ) THEN
    RAISE EXCEPTION 'recipient is not staff' USING ERRCODE = '22023';
  END IF;

  -- Anti-spam : 10 bravos par émetteur et par nuit, largement assez.
  IF (
    SELECT count(*) FROM public.staff_kudos k
     WHERE k.from_user = v_uid AND k.night_date = public.paris_night_date()
  ) >= 10 THEN
    RAISE EXCEPTION 'kudos limit reached' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.staff_kudos (venue_id, from_user, to_user, body)
  VALUES (v_venue, v_uid, p_to_user, v_body)
  RETURNING id INTO v_kudos_id;

  -- Nom public de l'émetteur (mêmes replis que get_venue_staff_team).
  SELECT COALESCE(NULLIF(p.staff_display_name, ''), NULLIF(p.first_name, ''), split_part(p.email, '@', 1))
    INTO v_from_name
    FROM public.profiles p WHERE p.id = v_uid;

  -- Rôle principal du destinataire pour router l'inbox/push par rôle. Le pont
  -- push filtre ensuite sur metadata.recipient_id pour ne réveiller que lui.
  SELECT ur.role::text INTO v_target_role
    FROM public.user_roles ur
   WHERE ur.user_id = p_to_user
     AND ur.role IN ('manager', 'vip_host', 'cloakroom', 'bouncer', 'barman')
   ORDER BY array_position(
     ARRAY['manager', 'vip_host', 'cloakroom', 'bouncer', 'barman'], ur.role::text
   )
   LIMIT 1;

  IF v_target_role IS NOT NULL THEN
    INSERT INTO public.staff_notifications (
      venue_id, target_role, notification_type, title, message, priority, metadata
    ) VALUES (
      v_venue, v_target_role, 'staff_kudos',
      'Bravo !',
      COALESCE(v_body, 'Un bravo de l''équipe'),
      'normal',
      jsonb_build_object(
        'recipient_id', p_to_user,
        'from_name', v_from_name,
        'body', v_body,
        'actor_id', v_uid
      )
    );
  END IF;

  RETURN jsonb_build_object('id', v_kudos_id);
END;
$$;

REVOKE ALL ON FUNCTION public.send_staff_kudos(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_staff_kudos(uuid, text) TO authenticated;
