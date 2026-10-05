# Plan de revue — Yuno CRM (≈ 75 min, dans cet ordre, arrêt possible à chaque palier)

Principe : tu ne vérifies que ce qu'une machine ne peut pas juger (le rendu, l'argent, les droits, les textes). Tout le reste est fait avant par l'audit (`CRM_AUDIT_PROMPT.md`) et tu lis son rapport : **un tableau PASS / FAIL, rien d'autre à ouvrir si tout est PASS.**

## Palier 0 — le rapport d'audit (5 min, avant tout)
Ouvre `docs/audits/CRM_AUDIT_<date>.md`. Si une ligne « Bloquant » est FAIL : stop, on corrige avant de continuer. Les lignes « À surveiller » ne bloquent pas.

## Palier 1 — planche-contact (15 min, aucun clic)
L'audit génère `docs/audits/review/index.html` : toutes les pages en capture, ordinateur (1440) et téléphone (390), groupées par zone. Tu fais défiler, tu coches seulement ce qui te choque.
- Console : ~30 écrans. Admin : 11 écrans. Erreurs : 8 états.
- Ce que tu regardes : texte coupé, chevauchement, page vide, « Bientôt » restant par erreur, prix ≠ 24 / 34 / 288, mot « néons » à l'écran, mélange de langues.

## Palier 2 — 7 parcours à cliquer toi-même (35 min, compte démo `crm@womber.fr`)
1. **Inscription → premier envoi** (10 min) : landing → créer un compte → connecter Shotgun (ou voir le message d'erreur propre) → importer un fichier → écrire un e-mail → écran d'envoi → vérifier le coût en Yunits. *Attendu : en démo rien ne part, le message le dit.*
2. **Recharge de Yunits** (4 min) : page Yunits → « Recharger » → arrêt avant Stripe (ne PAS payer) ; vérifier le montant HT/TTC et le bonus.
3. **Facturation** (4 min) : Compte → Facturation → bascule mensuel/annuel affichée avec les bons prix ; « S'abonner » mène à Stripe (arrêt avant paiement).
4. **Automatisations** (4 min) : activer / couper une recette, ouvrir un modèle dans le Studio.
5. **Rôles** (6 min) : se connecter en lecteur / éditeur (comptes de test de `sql/smoke_journey_roles.sql`) : un lecteur ne voit ni montants ni boutons d'envoi.
6. **Erreurs** (4 min) : couper le réseau → bandeau ; ouvrir `/crm/nimportequoi` → 404 ; se déconnecter sur une page profonde → 401 puis retour au même endroit.
7. **SMS** (hors de ce build, traité à part) : saute ce parcours ; vérifie seulement qu'aucun « Bientôt » ne reste sur les écrans SMS.

## Palier 3 — Admin CRM, avec TA session super admin (15 min)
Ouvre `/admin/crm` (les comptes démo ne sont pas admin).
1. Active « démo incluse » : Pilotage, Clients (3 onglets), fiche du compte démo.
2. **Gestes** (sur le compte démo uniquement) : offrir 2 000 Yunits, geler l'envoi, vérifier qu'un envoi est refusé dans la Console, dégeler. Chaque geste doit apparaître dans « Journal d'audit de ce compte ». Le motif est obligatoire.
3. Argent → Marge par compte : les chiffres te paraissent-ils plausibles ? (les coûts viennent de Réglages).
4. Réglages : change un prix → l'écran demande un motif → vérifie que la page Tarifs publique suit → **remets le prix** (24 / 34 / 288).
5. Vente : crée un prospect, glisse-le d'une colonne à l'autre, passe-le en « Perdu » (motif obligatoire).

## Palier 4 — argent et sécurité (5 min, lecture)
Dans le rapport d'audit, section « Droits » : aucune fonction `crm_*` / `crm_admin_*` appelable sans connexion ; montants masqués sans accès à l'argent ; `price_*` jamais écrits en dur. Si tout est PASS, rien à faire.

## Palier 5 — décisions à trancher après la revue (pas de revue)
Fournisseur SMS (session à part) · allumer ou non les e-mails du cycle de vie · activer le prix public chez Stripe au 50ᵉ compte payant.

## Avant de fusionner (checklist de 6 lignes)
- [ ] Rapport d'audit : 0 « Bloquant » FAIL
- [ ] Build Cloudflare de la PR vert
- [ ] Palier 2 parcours 1, 3 et 5 faits
- [ ] Palier 3 gestes faits (et prix remis)
- [ ] Edge déployées (liste dans le statut)
- [ ] SMS : géré dans sa session (hors de cette revue)
