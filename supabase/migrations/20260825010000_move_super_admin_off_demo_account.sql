-- Sortir le rôle super admin du compte de démonstration.
--
-- PROBLÈME (vérifié en production le 2026-08-24) : `owner@womber.fr` était à la
-- fois le compte démo ET le seul super admin. Or l'edge function `demo-login`
-- est `verify_jwt = false` — publique par nécessité (le reviewer Apple doit
-- l'atteindre sans session). Conséquence : n'importe qui, sans clé API, sans
-- mot de passe et depuis n'importe quelle origine, pouvait obtenir une session
-- pour laquelle `is_super_admin()` renvoyait `true` — donc lire les données
-- personnelles de tous les clients, suspendre des comptes, annuler des soirées,
-- réinitialiser la 2FA de n'importe quel pro.
--
-- Ce n'était pas théorique : la chaîne a été reproduite de bout en bout depuis
-- une machine sans aucun accès.
--
-- CORRECTIF : le super admin devient un compte personnel réel
-- (paul.brisebois@free.fr), et le compte démo perd ce rôle. Le compte démo
-- garde tous ses autres rôles : le DemoSwitcher, les liens d'aperçu et la démo
-- du reviewer continuent de fonctionner à l'identique.
--
-- RÈGLE À RETENIR : un compte dont le mot de passe est un secret partagé
-- derrière un endpoint public ne doit JAMAIS porter de rôle privilégié. Si un
-- futur compte démo doit voir une page admin, on lui donne une capacité
-- dédiée — jamais `admin`.

DO $$
DECLARE
  v_demo_id  uuid;
  v_new_id   uuid;
  v_admins   int;
BEGIN
  SELECT id INTO v_demo_id FROM auth.users WHERE email = 'owner@womber.fr';
  SELECT id INTO v_new_id  FROM auth.users WHERE email = 'paul.brisebois@free.fr';

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'Compte super admin cible introuvable — rien n''est modifié.';
  END IF;

  -- Idempotent : le rôle a pu être posé à la main avant cette migration.
  INSERT INTO public.user_roles (user_id, role, email)
  SELECT v_new_id, 'admin'::app_role, 'paul.brisebois@free.fr'
   WHERE NOT EXISTS (
     SELECT 1 FROM public.user_roles
      WHERE user_id = v_new_id AND role = 'admin'::app_role
   );

  -- GARDE : ne jamais retirer le dernier admin. Se verrouiller hors de
  -- /admin coûterait plus cher que le trou qu'on ferme.
  SELECT count(*) INTO v_admins
    FROM public.user_roles
   WHERE role = 'admin'::app_role
     AND (v_demo_id IS NULL OR user_id <> v_demo_id);

  IF v_admins < 1 THEN
    RAISE EXCEPTION 'Aucun autre super admin que le compte démo — retrait annulé.';
  END IF;

  IF v_demo_id IS NOT NULL THEN
    DELETE FROM public.user_roles
     WHERE user_id = v_demo_id AND role = 'admin'::app_role;
  END IF;

  RAISE NOTICE 'Super admin déplacé. Admins restants : %', v_admins;
END $$;
