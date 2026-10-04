# PROMPT — Audit indépendant de Yuno CRM (à coller dans une session NEUVE, après le build)

Tu es un auditeur indépendant. Tu n'as PAS construit ce code. Ton but : prouver que Yuno CRM est correctement construit et sûr, et produire un rapport qui permette à Paul de tout relire en ~75 minutes (voir `docs/designs/CRM_REVIEW_PLAN.md`). **Tu ne modifies pas le produit.** Tu écris seulement dans `docs/audits/` (rapport + planche-contact). Une correction triviale (faute de frappe, clé i18n manquante) est listée, pas appliquée, sauf si Paul le demande ensuite. Rien n'est déployé, aucun envoi réel, aucune écriture hors périmètre démo, aucune écriture chez Stripe. Un contrôle lourd à la fois, `timeout` et `nice`.

Contexte à lire d'abord : `CLAUDE.md` (sections Yuno CRM), `docs/designs/CRM_REDESIGN_STATUS.md`, `.crm-tools/PROMPT_SUITE.md` (règles serveur). Worktree `/Users/paul/Desktop/yuno-crm.nosync`, branche `crm/redesign`. Outils : `.crm-tools/` (`q.py` lecture SQL, `crmshot.mjs`, `bench.py`, `dshot.mjs`), preview `yuno-crm-dev` (8081).

Chaque contrôle donne **PASS / FAIL / À SURVEILLER** + la preuve (commande + extrait). Sévérité : *Bloquant* (argent, droits, fuite de données, perte de données, page cassée) ou *À surveiller*. Le rapport (`docs/audits/CRM_AUDIT_<date>.md`) s'ouvre sur un tableau de synthèse, puis le détail par section.

## 1. Santé du code (automatique)
- `timeout 280 npx tsc -p tsconfig.app.json --noEmit` ; `npx eslint src supabase/functions` (0 erreur) ; `npx vitest run` ; `npm run build` ; `supabase db lint --linked` (les « relation does not exist » sur tables temporaires sont des faux positifs : le dire).
- Migrations : toutes celles de la branche sont dans `supabase_migrations.schema_migrations`, aucun doublon de version, ordre croissant, aucune migration « marquée appliquée mais jamais jouée » (vérifier que chaque fonction / table citée en tête de migration existe).

## 2. Droits et fuites (le plus important)
Écris des requêtes SQL (via `q.py`) et colle leur résultat :
1. **Aucun appel anonyme** : toute fonction `public.crm_*`, `public._crm_*`, `public.crm_admin_*` : `has_function_privilege('anon', oid, 'execute')` doit être faux (liste les exceptions : seule `crm_pricing_config` est publique, et pourquoi).
2. **Fonctions SECURITY DEFINER** du périmètre : `proconfig` contient `search_path` ; une garde qui renvoie NULL pour un inconnu ne doit nulle part servir de condition `IF NOT …` (cherche le motif, lis chaque garde).
3. **Tables nouvelles** (`crm_*`, `crm_admin_*`, `crm_prospects*`, `crm_pricing_history`) : RLS activée, aucun droit pour `anon` / `authenticated`, aucune policy « créateur = moi » qui accorde un rôle.
4. **Matrice de rôles** : pour chaque RPC de lecture de la Console, appelle-la comme (a) inconnu, (b) lecteur, (c) éditeur, (d) titulaire, (e) membre d'une AUTRE organisation, (f) super admin. Attendu : (a) et (e) refusés (42501), (b) lit sans montants, (d) tout, (f) tout. Pour chaque RPC d'écriture : (a), (b), (e) refusés. Utilise le gabarit `.crm-tools/sql/smoke_journey_roles.sql` (blocs DO annulés). Fais-le pour TOUTES les RPC `crm_*` de la Console, pas un échantillon : génère la liste depuis `pg_proc`.
5. **Montants** : toute RPC qui renvoie `revenue`, `prev_revenue`, `attributed_revenue`, `spent`, `amount` passe par `_crm_money_gate` ; prouve-le par lecture du corps ou par appel en lecteur.
6. **Admin** : chaque `crm_admin_*` lève 42501 pour un utilisateur non super admin (appel avec un id non admin) ; chaque geste écrit une ligne `admin_audit_log` ; le motif vide est refusé.
7. **Aperçu démo** : toute lecture qui crée des tables temporaires est dans `demo_preview_writable_rpc` ; un lien d'aperçu ne peut écrire nulle part (essaie une écriture avec une session d'aperçu si l'outillage le permet).
8. **Secrets** : `git grep -nE "sk_(live|test)|whsec_|service_role|eyJ[A-Za-z0-9_-]{20,}"` sur les fichiers de la branche : rien de réel. Aucun jeton dans `.crm-tools/` commité.

## 3. Argent et prix
- Aucun prix en dur : `git grep -nE "\b(24|29|34|39|288|348|468) ?€"` hors `docs/` ; chaque occurrence est une lecture de config ou un commentaire. Aucun « néons » à l'écran (clés `yc.*`, `adm.crm.*`, `ohelp.crm.*`).
- `crm_pricing_config()` = 24 / 34 / 288 ; les prix Stripe live (lecture seule via le MCP Stripe : `GetPrices` par `lookup_key`) = mêmes montants ; `club-subscription/crm.ts` retrouve les prix par `lookup_key`.
- Yunits : un envoi débite avant l'appel fournisseur et rembourse seulement sur refus ; jamais de débit pour un test / contact écarté / refus (lis `crm_yunits_debit`, `crm_yunits_refund` et leurs appelants).
- `crm_admin_pricing_set` : refuse une clé inconnue, une valeur négative, un motif vide ; écrit l'historique ; **ne touche pas Stripe**.
- Le gel d'envoi : un envoi programmé ou immédiat d'un compte gelé est refusé (campagne e-mail et SMS) ; une recette est mise en pause sans exception.

## 4. Complétude par rapport au design
- Inventaire : liste les 60 fichiers `.crm-tools/design/files/*.dc.html` et mets en face la route et le fichier de code qui les porte ; **tout écran sans correspondance est listé** (attendus : Pages inscription, FanPage, Instagram, Landing/Inscription dans l'autre dépôt, composants de design). Vérifie que `nav.ts`, `routes.tsx` et la sidebar s'accordent (aucune route orpheline, aucun lien mort : parcours automatique de tous les liens de `nav.ts` et de `AdminNav`).
- Chaque clé i18n utilisée existe en EN, FR et ES (script : extrais les clés littérales de `src/crm` et `src/crm/admin`, compare aux dictionnaires ; liste les clés dynamiques et vérifie leurs familles).
- Marqueurs : `git grep -nE "TODO|FIXME|XXX|lorem|à venir|coming soon" src/crm` : chacun est justifié ou listé.

## 5. Rendu (planche-contact pour Paul)
Pour CHAQUE route de la Console, de l'Admin (avec `bench.py on` pour l'Admin, puis `off`) et chaque état d'erreur : une capture 1440 px et une capture 390 px (`crmshot.mjs`), enregistrées dans `docs/audits/review/<zone>/…`. Génère `docs/audits/review/index.html` : planches par zone, légende = route + date, deux colonnes ordinateur / téléphone. Pour chaque page, relève automatiquement : erreurs console (`errors:`), défilement horizontal en 390 px (`scrollWidth > innerWidth`), textes de la forme `yc.` / `adm.crm.` / `undefined` / `NaN` / `[object` visibles à l'écran, requêtes 4xx/5xx. Les captures vides ou ≥ 2 erreurs sont FAIL.

## 6. Parcours de bout en bout (compte démo, rien ne part)
Joue avec `crmsteps.mjs` : (1) ouverture de la Console → Accueil sans erreur ; (2) import d'un petit fichier de test (contacts fictifs @example.*) → annulation de l'import ; (3) création d'une campagne e-mail → étapes jusqu'à l'écran d'envoi → refus propre en démo ; (4) activation / coupure d'une recette ; (5) page Yunits : calcul d'une recharge (arrêt avant Stripe) ; (6) Compte › Facturation : bascule mensuel/annuel affichée ; (7) coupure réseau simulée (`offline` event) → bandeau ; (8) URL inconnue → 404 ; (9) déconnexion sur une page profonde → 401 → retour. Pour l'Admin (banc) : liste, fiche, gestes en boîte de dialogue (sans valider).

## 7. Robustesse
- Performance : durée de chaque RPC de lecture sur la démo (`EXPLAIN ANALYZE` si > 1 s) ; signale tout `contact_rows` appelé dans une boucle côté liste (`_crm_admin_rows` l'appelle une fois par compte : estime le coût à 200 comptes).
- Concurrence : double clic sur « Envoyer », double soumission d'un geste admin, deux onglets : pas de double débit, pas de doublon d'audit.
- Données absentes : chaque écran avec 0 donnée (compte neuf), avec 1 donnée, avec 10 000 contacts (lecture seule sur copie de la démo).
- Erreurs : coupe une RPC (nom inexistant en test) : `CrmLoadError` apparaît, pas d'écran blanc.

## 8. Livrables
1. `docs/audits/CRM_AUDIT_<date>.md` : tableau de synthèse (section · contrôle · PASS/FAIL/À SURVEILLER · sévérité), puis preuves ; tout FAIL a une **recommandation chiffrée** (fichier, ligne, correctif d'une phrase).
2. `docs/audits/review/` : planche-contact.
3. En fin de rapport : « Ce que Paul doit regarder » = uniquement les lignes À SURVEILLER et ce que l'audit n'a pas pu juger (rendu subjectif, textes, plausibilité des chiffres), avec le lien du palier correspondant dans `CRM_REVIEW_PLAN.md`.

Ne commite que `docs/audits/`. Ne pousse pas.
