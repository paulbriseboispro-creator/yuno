-- ───────────────────────────────────────────────────────────────────────────
-- Modèles d'email (Email Studio) — un design réutilisable, pas une campagne.
--
-- Le besoin : « je veux ma template d'invitation, et la rejouer sur chaque
-- nouvelle soirée ». Un modèle enregistre donc le DESIGN (blocs, thème, objet,
-- pré-en-tête, réseaux) et JAMAIS les données d'une soirée précise : les blocs
-- Yuno (event / tickets / table / countdown) y sont stockés SANS eventId. Au
-- moment de créer la campagne, le pro choisit la soirée, elle est posée sur
-- `email_campaigns.event_id`, et l'edge relie les blocs sans eventId propre à
-- cet événement (fetchStudioLiveData) — les tarifs et la jauge sont donc
-- toujours ceux du soir, jamais ceux figés à la composition.
--
-- Ce qui n'est PAS dans un modèle, volontairement : l'audience, la
-- planification, l'A/B. Ces choix-là se reprennent à chaque envoi.
--
-- Portée identique à email_campaigns : club (venue_id) OU organisateur
-- (organizer_user_id), jamais les deux.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_campaign_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'promotional' CHECK (type IN ('promotional','informational')),
  subject text NOT NULL DEFAULT '',
  preheader text NOT NULL DEFAULT '',
  blocks_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocks_version integer NOT NULL DEFAULT 2,
  theme_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  social_links_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_url text,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_campaign_templates_owner_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL)
  ),
  CONSTRAINT email_campaign_templates_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT email_campaign_templates_desc_check CHECK (char_length(description) <= 240)
);

CREATE INDEX IF NOT EXISTS idx_email_templates_venue
  ON public.email_campaign_templates(venue_id, updated_at DESC) WHERE venue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_templates_organizer
  ON public.email_campaign_templates(organizer_user_id, updated_at DESC) WHERE organizer_user_id IS NOT NULL;

ALTER TABLE public.email_campaign_templates ENABLE ROW LEVEL SECURITY;

-- Même porte que email_campaigns : propriétaire du club, ou l'organisateur
-- lui-même. Rien d'anonyme, rien de public — un modèle est du matériel de marque.
DROP POLICY IF EXISTS "Owners manage email templates" ON public.email_campaign_templates;
CREATE POLICY "Owners manage email templates"
  ON public.email_campaign_templates FOR ALL
  USING (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  )
  WITH CHECK (
    (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
    OR public.is_super_admin()
  );

DROP TRIGGER IF EXISTS trg_email_campaign_templates_updated_at ON public.email_campaign_templates;
CREATE TRIGGER trg_email_campaign_templates_updated_at
  BEFORE UPDATE ON public.email_campaign_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Compteur d'utilisation ──────────────────────────────────────────────────
-- SECURITY INVOKER : la RLS ci-dessus reste la seule porte. L'incrément est
-- atomique côté base plutôt qu'un lire-puis-écrire côté client.
CREATE OR REPLACE FUNCTION public.bump_email_template_usage(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_campaign_templates
     SET use_count = use_count + 1,
         last_used_at = now()
   WHERE id = p_template_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_email_template_usage(uuid) TO authenticated;

COMMENT ON TABLE public.email_campaign_templates IS
  'Modèles d''email réutilisables (Email Studio). Design uniquement : les blocs Yuno y sont stockés sans eventId, la soirée est choisie à la création de la campagne. Aucune audience, aucune planification.';
