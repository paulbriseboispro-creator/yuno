-- ============================================================================
-- P0 COLLAB — Supprimer la surcharge legacy 3-args de
-- create_event_collab_contract.
--
-- Vérifié en prod le 2026-08-23 (pg_proc) : DEUX surcharges coexistent :
--   • create_event_collab_contract(uuid, jsonb, text)        ← legacy
--     (dernier corps : 20260623230000 — ignore p_responsibilities, écrase le
--      périmètre boissons/responsabilités du contrat)
--   • create_event_collab_contract(uuid, jsonb, text, jsonb) ← courante
--     (20260722140000, p_split_rules DEFAULT NULL,
--      p_cancellation_policy DEFAULT 'pro_rata_refund',
--      p_responsibilities DEFAULT NULL)
--
-- Le front appelle avec des arguments nommés. Deux formes coexistent :
--   • {p_event_id, p_cancellation_policy, p_responsibilities}
--     (useProposeCollab.ts:64, ClubProposeEventDialog.tsx:154,
--      OrgProposeEventDialog.tsx) → ne matche que la 4-args, OK ;
--   • {p_event_id, p_split_rules, p_cancellation_policy}
--     (useEventCollabContract.tsx:91) → matche LES DEUX (la 4-args via son
--     défaut) → PostgREST peut lever une ambiguïté (300) ou retomber sur la
--     legacy qui efface le périmètre. C'est le bug.
--
-- Correctif : DROP de la legacy — même geste que pour
-- sign_event_collab_contract (20260624200000 :
-- `DROP FUNCTION IF EXISTS public.sign_event_collab_contract(uuid, text, text);`).
-- La 4-args ayant des DEFAULT sur ses 3 derniers paramètres, TOUS les appels
-- nommés existants résolvent ensuite sur elle sans changement front.
-- PostgREST recharge son schema cache automatiquement sur DDL (event trigger
-- Supabase pgrst_ddl_watch).
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_event_collab_contract(uuid, jsonb, text);

-- Filet : la 4-args doit survivre, avec ses défauts (sinon l'appel 3-args
-- nommé du front ne résoudrait plus). Échoue le push si l'état attendu n'est
-- pas là.
DO $$
DECLARE
  v_args text;
BEGIN
  SELECT pg_get_function_arguments(p.oid) INTO v_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_event_collab_contract'
     AND p.pronargs = 4;

  IF v_args IS NULL THEN
    RAISE EXCEPTION 'create_event_collab_contract(uuid,jsonb,text,jsonb) is missing — aborting';
  END IF;

  IF v_args NOT LIKE '%p_responsibilities jsonb DEFAULT%' THEN
    RAISE EXCEPTION 'create_event_collab_contract 4-args has no DEFAULT on p_responsibilities (got: %) — 3-named-args calls would stop resolving', v_args;
  END IF;
END;
$$;
