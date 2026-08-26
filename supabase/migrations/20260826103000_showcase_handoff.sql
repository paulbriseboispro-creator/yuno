-- ============================================================================
-- Comptes vitrine — handoff à la réclamation.
--
-- Quand la propriété d'une venue vitrine change (invitation owner acceptée, OU
-- branche « user existant » d'invite-owner qui transfère immédiatement), le
-- fantôme doit être nettoyé : profils/rôles détachés, liens preview révoqués,
-- demande d'activation soldée, marqueur remis à NULL.
--
-- Le handoff est accroché à un TRIGGER sur venues.owner_id (et pas aux edge
-- functions) : c'est le seul point qui couvre TOUS les chemins de transfert,
-- y compris de futurs. Le trigger ne modifie jamais owner_id → pas de
-- récursion ; il ne s'arme que si OLD.showcase_shadow_owner_id est posé →
-- no-op garanti sur toutes les venues normales.
--
-- Pas de EXCEPTION WHEN OTHERS avaleur : un handoff qui échoue doit faire
-- échouer la réclamation (visible, rejouable) plutôt que laisser un état
-- partiel (fantôme encore attaché, liens preview encore actifs).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handoff_showcase_venue(p_venue_id text, p_new_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shadow uuid;
BEGIN
  SELECT showcase_shadow_owner_id INTO v_shadow
    FROM public.venues WHERE id = p_venue_id
    FOR UPDATE;
  IF NOT FOUND OR v_shadow IS NULL OR v_shadow = p_new_owner_id THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  UPDATE public.profiles SET venue_id = NULL
   WHERE id = v_shadow AND venue_id = p_venue_id;

  -- Le fantôme perd son rôle owner, sauf s'il porte encore une autre vitrine.
  IF NOT EXISTS (
    SELECT 1 FROM public.venues WHERE owner_id = v_shadow AND id <> p_venue_id
  ) THEN
    DELETE FROM public.user_roles WHERE user_id = v_shadow AND role = 'owner';
  END IF;

  -- Les liens preview de la venue meurent avec la réclamation.
  UPDATE public.demo_preview_links
     SET is_active = false, revoked_at = now()
   WHERE venue_id = p_venue_id AND revoked_at IS NULL;

  UPDATE public.showcase_claim_requests
     SET status = 'completed', completed_at = now(), updated_at = now()
   WHERE venue_id = p_venue_id AND status = 'pending';

  UPDATE public.venues SET showcase_shadow_owner_id = NULL WHERE id = p_venue_id;

  RETURN jsonb_build_object('ok', true, 'shadow_user_id', v_shadow);
END;
$$;

-- Exposée à service_role seulement (réparation manuelle) ; le chemin nominal
-- est le trigger ci-dessous.
REVOKE ALL ON FUNCTION public.handoff_showcase_venue(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_showcase_venue(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.venues_showcase_handoff_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.handoff_showcase_venue(NEW.id, NEW.owner_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS venues_showcase_handoff ON public.venues;
CREATE TRIGGER venues_showcase_handoff
  AFTER UPDATE OF owner_id ON public.venues
  FOR EACH ROW
  WHEN (OLD.showcase_shadow_owner_id IS NOT NULL
        AND NEW.owner_id IS DISTINCT FROM OLD.showcase_shadow_owner_id)
  EXECUTE FUNCTION public.venues_showcase_handoff_tg();
