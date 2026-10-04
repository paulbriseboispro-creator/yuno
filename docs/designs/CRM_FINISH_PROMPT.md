# PROMPT — Finir le build Yuno CRM (à coller dans une nouvelle session)

Tu finis le build de Yuno CRM. Pleine autonomie, un point d'arrêt obligatoire à chaque décision listée plus bas. Avant tout, lis : `CLAUDE.md` (sections « Yuno CRM »), `docs/designs/CRM_REDESIGN_STATUS.md` (l'état exact, la liste du reste à faire), `.crm-tools/PROMPT_SUITE.md` (la méthode et les règles serveur : elles s'appliquent toujours).

## Où travailler
- Worktree `/Users/paul/Desktop/yuno-crm.nosync`, branche `crm/redesign` (la PR #13 est ouverte vers `main` : tu continues sur la même branche, la PR se met à jour). Jamais `git add -A` / `git add .`, jamais `git stash` nu. Commits bissectés, message terminé par la ligne `Co-Authored-By` de la session. **Ne fusionne pas, ne déploie pas, n'écris rien chez Stripe, aucun envoi réel.** Les edge functions, c'est Paul qui les déploie.
- Dev server : preview `yuno-crm-dev` (port 8081). Outils : `.crm-tools/` (`crmshot.mjs`, `crmsteps.mjs`, `q.py`, `apply.py`, `bench.py`, `dshot.mjs`). Le banc `AdmBench.tsx` donne des données d'exemple pour l'Admin (aucun compte démo n'est super admin) ; `python3 .crm-tools/bench.py on|off` pose / retire ses routes : **toujours `off` avant de commiter `src/crm/routes.tsx`**.
- Périmètre démo seulement pour toute écriture ; jamais plusieurs contrôles lourds en parallèle ; attendre la fin réelle de `tsc` (le lancer en premier plan avec `timeout 280`, ne jamais lire un fichier de sortie avant qu'il soit fini).

## Méthode (par écran ou par lot)
Analyse du design (`.crm-tools/design/files/*.dc.html`, captures via `render_preview` + `dshot.mjs`) → serveur si besoin (migration > `20261005242000`, vérifier qu'elle n'existe ni en base ni sur main ; corps d'une fonction existante repris de `pg_get_functiondef`) → front branché sur les vraies données → captures ordinateur ET téléphone comparées au design → corrige → commit. Chaque migration : répétition annulée (`apply.py`), puis `--real`, puis un smoke en bloc DO annulé, puis `supabase db lint --linked`. Toute fonction SECURITY DEFINER finit par REVOKE/GRANT explicites ; toute garde est testée avec un utilisateur inconnu (NULL).

## À faire, dans l'ordre

### Lot A — SMS réellement ouvert  *(arrêt obligatoire : demande à Paul le fournisseur et le numéro avant de commencer)*
Suis `docs/designs/CRM_SMS_PLAN.md` : moteur d'envoi (débit des Yunits avant l'envoi, remboursement sur refus fournisseur seulement, variables, nom d'expéditeur + STOP, heures calmes, file avec reprise), webhook de statut, test d'envoi réel vers le numéro de Paul. Puis `CRM_SMS_ENGINE_READY = true` (`src/crm/lib/sms.ts`), retire la garde `crm_sms_not_open`, retire le toast « en cours de mise en place » des écrans Envoi et Composer, mets à jour `CLAUDE.md`. La démo reste en `demo_no_send`.

### Lot B — Admin CRM : les trous réels (sans inventer de données)
1. Durée médiane d'une synchro : vérifie que `affiliate-ticket-sync` écrit `ticketing_sync_runs.finished_at` (aujourd'hui aucune ligne n'est finie en base) ; si non, corrige l'écriture (edge : à déployer par Paul, dis-le) ; puis ajoute la durée médiane et le taux de réussite à Plateforme › Connecteurs.
2. Pilotage › « Activité en direct » : flux unique (inscriptions, achats de Yunits, envois, échecs de synchro, gestes admin) lu en base.
3. Réglages › « E-mails du cycle de vie » : liste des e-mails automatiques envoyés par Yuno aux comptes CRM (bienvenue, J+1, essai qui finit, paiement échoué…) ; **demande d'abord à Paul lesquels existent ou doivent exister** (aujourd'hui aucun n'est codé) ; ne construis que ce qui est confirmé.
4. Clients : tiroir latéral (résumé + gestes rapides) comme dans le design ; Vente : onglet « Comptes cibles » ; fiche : lien « Voir sa Console » (utilise l'accès assisté existant, jamais une session ouverte sans consentement) ; écran de connexion admin du design.
5. Branche `trial_extensions` (Réglages) à « Prolonger l'essai » (compteur de prolongations gratuites par compte, motif conservé) **ou** retire le réglage : propose ton choix à Paul avant de coder.
6. Passage au prix public : ajoute un bouton « Activer le prix public » dans Argent **qui n'écrit PAS chez Stripe tout seul** : il affiche la procédure et les `lookup_key` concernées ; l'activation Stripe reste un geste explicite de Paul.

### Lot C — Mesures qui n'existent pas encore  *(arrêt obligatoire : demande à Paul « oui / non » pour chacune ; ne construis que les oui)*
- Mesure de la landing (visites, profondeur de lecture, clics) : instrumentation côté dépôt `yuno-landing-crm` + table + RPC + blocs de l'Acquisition ; sans cookie, hash salé comme `links_events`.
- NPS et demandes de fonctionnalités : petit formulaire dans la Console (Compte › Aide) + lecture dans Produit.
- Registre d'incidents (CNIL 72 h) : table + écran Légal.

### Lot D — Pages d'inscription (builder + page publique fan) et Instagram  *(arrêt obligatoire : plan écrit puis validation de Paul)*
Écris d'abord un plan (`docs/designs/CRM_SIGNUP_PAGES_PLAN.md`) : modèle de données (page, champs, consentement horodaté et prouvé dans le registre existant `marketing_consent_events`), route publique, anti-abus, RGPD, ce que le pro voit. Instagram reste « Bientôt » (App Review Meta). Ne construis qu'après validation.

### Lot E — Dette et finitions
Les 30 avertissements d'export de fichiers (react-refresh) sans changer le comportement ; rejoue `node scripts/demo/audit.mjs` si le périmètre démo a bougé ; mets à jour `CLAUDE.md` et `docs/designs/CRM_REDESIGN_STATUS.md` (le statut doit rester vrai).

## Règles qui ne bougent pas
Textes : trois langues pour toute clé (`yc.*` dans `src/i18n/locales/crm/modules`, `adm.crm.*` dans `…/admin/modules`) ; le test des clés doit passer. Aucun prix en dur : tout vient de `crm_pricing`. Un nom ou une marque nouvelle : demande à Paul avant de l'écrire. Jamais « néons » à l'écran. Ne pas toucher la Suite sauf pour ce que ce prompt demande.

## Fin de session
1. `timeout 280 npx tsc -p tsconfig.app.json --noEmit` (0 erreur), `npx eslint src/crm …` (0 erreur), `npx vitest run` (tout vert), `npm run build` (exit 0), `supabase db lint --linked`.
2. Pousse la branche **seulement si Paul le demande** ; sinon liste les commits.
3. Rapport final pour Paul : ce qui est fait (avec preuve), ce qui ne l'est pas et pourquoi, ce qu'il doit déployer ou décider, et la liste des edge functions modifiées.
