-- ─────────────────────────────────────────────────────────────────────────────
-- Abonnement RP (agence) — la table de follow + le wrapper source-aware.
--
-- Aujourd'hui un client peut s'abonner à un club (favorites type 'club') et à un
-- organisateur (organizer_profile_followers), mais PAS à un RP/agence. Sa page
-- publique /rp/:slug ne permet que de favoriter une soirée, jamais l'agence.
-- On crée le chaînon manquant : une table de follow keyée sur agencies.id
-- (l'identité maître de l'entité fusionnée agence↔affilié), calquée trait pour
-- trait sur organizer_profile_followers.
--
-- La page publique résout affiliates.agency_id → agencies.id ; le follow vise
-- toujours l'agence (là où vivent le cockpit /agency-app, les contrats et les
-- analytics d'audience). Un affilié sans identité d'agence (agency_id NULL) ne
-- reçoit pas de bouton d'abonnement — il n'a pas de tableau de bord pour lire
-- ses abonnés.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agency_followers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id  uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_followers_agency ON public.agency_followers(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_followers_user   ON public.agency_followers(user_id);

ALTER TABLE public.agency_followers ENABLE ROW LEVEL SECURITY;

-- Lecture ouverte : les compteurs d'abonnés sont publics (page /rp/:slug, cartes
-- favoris) — comme organizer_profile_followers. Les écritures restent self-only.
CREATE POLICY "Anyone can view agency followers"
  ON public.agency_followers FOR SELECT USING (true);

CREATE POLICY "Users can follow agencies"
  ON public.agency_followers FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unfollow agencies"
  ON public.agency_followers FOR DELETE USING (auth.uid() = user_id);

-- ── Wrapper d'insert qui pose la source d'acquisition dans la MÊME transaction ──
-- Miroir de follow_organizer (20260728171100) : le GUC yuno.follow_source doit
-- être posé dans la transaction de l'INSERT (le pooling PostgREST ne conserve pas
-- un set_config d'une requête séparée) pour que le trigger de journal audience le
-- lise. SECURITY INVOKER → la RLS ci-dessus (auth.uid() = user_id) s'applique.
CREATE OR REPLACE FUNCTION public.follow_agency(
  p_agency_id uuid,
  p_source    text DEFAULT NULL
)
RETURNS SETOF public.agency_followers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('yuno.follow_source', COALESCE(NULLIF(btrim(p_source), ''), 'trigger'), true);
  RETURN QUERY
    INSERT INTO public.agency_followers (agency_id, user_id)
    VALUES (p_agency_id, auth.uid())
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.follow_agency(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.follow_agency(uuid, text) TO authenticated;
