-- Plafond des codes de connexion du staff de nuit (4 par adresse et par 15 min).
--
-- La migration 20260512100000 (table + fonction) est notée appliquée mais n'a
-- jamais tourné : `upsert_staff_pin_rate_limit` n'existait pas, l'edge
-- `accept-staff-invitation` recevait une erreur qu'elle ignorait, et aucun
-- plafond ne s'appliquait aux codes envoyés par e-mail (constaté le 27/10 en
-- rejouant le parcours d'un videur). On recrée les deux, à l'identique.
-- La purge RGPD quotidienne (`purge_expired_personal_data`) vide déjà la table
-- quand elle existe ; une ligne périmée est aussi remise à 1 à la lecture.

CREATE TABLE IF NOT EXISTS public.staff_pin_rate_limits (
  ip_address text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_address)
);

ALTER TABLE public.staff_pin_rate_limits ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul service_role (les fonctions edge) y touche.
REVOKE ALL ON TABLE public.staff_pin_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_staff_pin_rate_limit(
  p_ip text,
  p_window_cutoff timestamptz,
  p_max_attempts integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts integer;
BEGIN
  INSERT INTO public.staff_pin_rate_limits (ip_address, attempts, window_start)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip_address) DO UPDATE
    SET
      attempts = CASE
        WHEN staff_pin_rate_limits.window_start < p_window_cutoff THEN 1
        ELSE LEAST(staff_pin_rate_limits.attempts + 1, p_max_attempts + 1)
      END,
      window_start = CASE
        WHEN staff_pin_rate_limits.window_start < p_window_cutoff THEN now()
        ELSE staff_pin_rate_limits.window_start
      END
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_staff_pin_rate_limit(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_staff_pin_rate_limit(text, timestamptz, integer) TO service_role;
