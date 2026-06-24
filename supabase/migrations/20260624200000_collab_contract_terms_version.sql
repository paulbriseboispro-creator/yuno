-- =============================================================================
-- Geler la VERSION des conditions légales du contrat de co-soirée à la signature.
--
-- Le texte des articles du contrat (définitions, frais, remboursements, annulation,
-- preuve, responsabilité Yuno) est un template versionné côté app
-- (src/lib/collabContractTerms.ts, COLLAB_TERMS_VERSION). Pour qu'un contrat signé
-- reste immuable, la version en vigueur au moment de la double signature est figée
-- dans event_collab_contracts.terms_snapshot.terms_version. Le PDF re-rend CETTE
-- version au téléchargement (pas la dernière) → le contrat affiché = le contrat signé.
--
-- On ajoute un paramètre p_terms_version (DEFAULT NULL) à sign_event_collab_contract
-- et on l'enregistre dans terms_snapshot quand les deux parties ont signé.
-- On DROP la signature à 3 args d'abord : sinon PostgREST a deux candidats (3 et 4
-- args, tous deux satisfaits par un appel à 3 args) et lève une ambiguïté. Le DROP
-- garde la rétro-compat : un vieux client qui n'envoie que 3 args matche la nouvelle
-- fonction (p_terms_version prend son DEFAULT NULL).
-- =============================================================================

DROP FUNCTION IF EXISTS public.sign_event_collab_contract(uuid, text, text);

CREATE OR REPLACE FUNCTION public.sign_event_collab_contract(
  p_contract_id   uuid,
  p_ip            text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL,
  p_terms_version text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c          public.event_collab_contracts%ROWTYPE;
  v_is_venue boolean;
  v_is_org   boolean;
  v_both     boolean;
BEGIN
  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Le contrat n''attend pas de signature (statut=%)', c.status;
  END IF;

  v_is_venue := public.is_venue_owner(auth.uid(), c.venue_id);
  v_is_org   := (c.organizer_user_id = auth.uid());
  IF NOT (v_is_venue OR v_is_org) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_venue THEN
    UPDATE public.event_collab_contracts
       SET venue_signed_at = COALESCE(venue_signed_at, now()),
           venue_signed_by = COALESCE(venue_signed_by, auth.uid()),
           venue_signed_ip = COALESCE(venue_signed_ip, p_ip),
           venue_signed_user_agent = COALESCE(venue_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
    UPDATE public.events SET split_approved_by_venue = true WHERE id = c.event_id;
  ELSE
    UPDATE public.event_collab_contracts
       SET org_signed_at = COALESCE(org_signed_at, now()),
           org_signed_by = COALESCE(org_signed_by, auth.uid()),
           org_signed_ip = COALESCE(org_signed_ip, p_ip),
           org_signed_user_agent = COALESCE(org_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
    UPDATE public.events SET split_approved_by_organizer = true WHERE id = c.event_id;
  END IF;

  SELECT * INTO c FROM public.event_collab_contracts WHERE id = p_contract_id;
  v_both := c.venue_signed_at IS NOT NULL AND c.org_signed_at IS NOT NULL;

  IF v_both THEN
    UPDATE public.event_collab_contracts
       SET status = 'active',
           terms_snapshot = jsonb_build_object(
             'split_rules', c.split_rules,
             'cancellation_policy', c.cancellation_policy,
             'currency', c.currency,
             'venue_id', c.venue_id,
             'organizer_user_id', c.organizer_user_id,
             'event_id', c.event_id,
             'venue_signed_at', c.venue_signed_at,
             'org_signed_at', c.org_signed_at,
             'terms_version', p_terms_version,
             'frozen_at', now()
           )
     WHERE id = p_contract_id;
    -- Le GUARD : copier la proposition dans les règles en vigueur + purger la proposition.
    UPDATE public.events
       SET revenue_split_rules = c.split_rules,
           revenue_split_proposal = NULL,
           split_proposed_by = NULL,
           split_proposed_at = NULL,
           split_approved_by_venue = false,
           split_approved_by_organizer = false
     WHERE id = c.event_id;
    RETURN 'active';
  END IF;

  RETURN 'pending_signatures';
END; $$;

GRANT EXECUTE ON FUNCTION public.sign_event_collab_contract(uuid, text, text, text) TO authenticated;
