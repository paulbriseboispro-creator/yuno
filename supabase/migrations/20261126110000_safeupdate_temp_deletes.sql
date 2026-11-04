-- Un DELETE sans WHERE est refusé par l'API (2026-11-03).
--
-- authenticator charge l'extension `safeupdate` (rolconfig
-- session_preload_libraries) : toute requête passée par PostgREST — clé
-- service comprise — refuse « DELETE requires a WHERE clause », y compris
-- dans une fonction plpgsql qui vide sa propre table temporaire.
-- Constaté sur le premier envoi réel d'une campagne « Vos clients » (3AM,
-- Act III) : send-campaign → enqueue → _crm_customer_after_enqueue
-- (`DELETE FROM _ccq;`) → « Audience resolution failed », rien n'est parti.
-- Même faute dans tix_journey__core (`DELETE FROM _cmk;`, canal push du
-- Parcours client de Yuno Tickets).
--
-- Correction : `WHERE true`, que safeupdate accepte. Réécriture CIBLÉE de la
-- définition vivante (pg_get_functiondef), jamais une copie d'un ancien fichier.

DO $$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, x.stmt
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN (VALUES ('_crm_customer_after_enqueue', 'DELETE FROM _ccq;'),
                   ('tix_journey__core', 'DELETE FROM _cmk;')) AS x(fn, stmt) ON x.fn = p.proname
     WHERE n.nspname = 'public'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, r.stmt, replace(r.stmt, ';', ' WHERE true;'));
    IF v_new = v_def THEN
      RAISE EXCEPTION 'safeupdate fix: % ne contient plus « % »', r.proname, r.stmt;
    END IF;
    EXECUTE v_new;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosrc ~* 'DELETE FROM [a-z_]+\s*;'
  ) THEN
    RAISE EXCEPTION 'safeupdate fix: il reste un DELETE sans WHERE dans public';
  END IF;
END $$;
