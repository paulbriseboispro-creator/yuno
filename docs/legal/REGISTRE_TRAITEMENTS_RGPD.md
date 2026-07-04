# Registre des activités de traitement (art. 30 RGPD)

**Responsable de traitement** : Paul BRISEBOIS, entrepreneur individuel (WOMBER), SIREN 995 130 747,
25 avenue Mercure, 31130 Quint-Fonsegrives, France — contact@yunoapp.eu
**Plateforme** : Yuno (yunoapp.eu) — SaaS nightlife : billetterie, tables VIP, commande de boissons.
**Délégué à la protection des données (DPO)** : non désigné (non obligatoire à ce stade).
**Dernière mise à jour** : 2026-07-04. ⚠️ Document interne — à tenir à jour à chaque nouveau traitement.

> **Double casquette.** Pour les données des clients finaux traitées pour le compte des clubs/organisateurs
> (billetterie, guest lists, VIP, boissons, campagnes), Yuno agit en **sous-traitant** (art. 28 — voir le DPA
> `/legal/dpa`) ; ces traitements figurent en Partie B. Pour ses propres finalités (comptes, sécurité,
> facturation, amélioration), Yuno est **responsable de traitement** (Partie A).

---

## Partie A — Yuno responsable de traitement

### A1. Comptes utilisateurs (clients finaux)
- **Finalité** : création et gestion du compte, authentification, historique de commandes.
- **Base légale** : exécution du contrat (CGU).
- **Données** : nom, prénom, email, mot de passe (haché par Supabase Auth), langue, ville (géoloc approx. Explore).
- **Personnes concernées** : clients finaux.
- **Destinataires** : Supabase (hébergement, UE).
- **Conservation** : durée de vie du compte ; compte inactif 24 mois → suppression/anonymisation.
- **Sécurité** : RLS, HTTPS/TLS, Supabase Auth, MFA disponible.

### A2. Comptes professionnels (owners, organisateurs, promoteurs, affiliés, DJ, staff, agences)
- **Finalité** : gestion des espaces pro, rôles et permissions, onboarding (liens d'invitation).
- **Base légale** : exécution du contrat (Conditions Pro).
- **Données** : identité, email, rôle, établissement/organisation de rattachement, PIN staff (haché), nom de scène DJ, IBAN des bénéficiaires promoteurs/DJ (saisi par eux pour paiement hors plateforme).
- **Destinataires** : Supabase ; Stripe (comptes Connect owners/orgas).
- **Conservation** : durée du contrat + 5 ans (preuve).
- **Sécurité** : RLS par rôle et par établissement, MFA, guards de routes par rôle.

### A3. Paiements et facturation
- **Finalité** : encaissement (Stripe Connect double destination), calcul des frais/commissions, factures.
- **Base légale** : exécution du contrat ; obligation légale (comptabilité).
- **Données** : montants, références de commande (TK/VP-XXXXXX), identité de facturation. **Les données de carte ne transitent jamais par Yuno** (traitées par Stripe).
- **Destinataires** : Stripe (hors UE possible, clauses contractuelles types).
- **Conservation** : factures et pièces comptables 10 ans (obligation légale).
- **Sécurité** : webhooks signés, clés secrètes uniquement dans les secrets Supabase.

### A4. Sécurité, anti-fraude et modération
- **Finalité** : journalisation de sécurité, MFA, détection de fraude, kill-switch paiements, bans club-internes, avertissements bouncer, suspensions super admin.
- **Base légale** : intérêt légitime (sécurité de la plateforme et des établissements).
- **Données** : logs de sécurité (security_logs), email banni, motif, auteur de la décision, horodatages.
- **Conservation** : logs 12 mois ; bans : durée du ban + 12 mois.
- **Sécurité** : accès restreint super admin, RLS.

### A5. Preuves d'acceptation légale (clickwrap)
- **Finalité** : preuve du consentement aux CGU/Conditions Pro/Engagement de confidentialité (eIDAS).
- **Base légale** : intérêt légitime (preuve) ; obligation de conservation du consentement.
- **Données** : user_id/email, type et version du document, hash du contenu, horodatage, IP, user-agent (`legal_acceptances`, `terms_acceptances`).
- **Conservation** : 5 ans après la fin de la relation.
- **Sécurité** : table immuable, écriture uniquement via RPC contrôlée, lecture self/super admin.

### A6. Déclarations de majorité et autorisations mineurs
- **Finalité** : conformité vente d'alcool (déclaration de majorité sur les chemins alcool), autorisation parentale pour mineurs (billets).
- **Base légale** : obligation légale / intérêt légitime (conformité).
- **Données** : date de naissance déclarative, attestation de majorité horodatée, documents d'autorisation uploadés (⚠️ données sensibles par nature documentaire — accès restreint).
- **Conservation** : durée de l'événement + 12 mois (contestation) — ⚠️ à valider.
- **Sécurité** : stockage Supabase Storage à accès restreint.

### A7. Emails transactionnels et notifications
- **Finalité** : confirmations d'achat, billets/factures PDF, notifications de vente, invitations staff, push PWA.
- **Base légale** : exécution du contrat.
- **Données** : email, contenu de la commande, tokens push.
- **Destinataires** : Resend (expéditeur noreply@yunoapp.eu — hors UE possible, SCC).
- **Conservation** : logs d'envoi (notification_log) 12 mois.

### A8. Statistiques d'audience de la plateforme (super admin)
- **Finalité** : mesure d'audience interne (funnel, UTM, pings visiteurs), amélioration du produit.
- **Base légale** : intérêt légitime (pas de cookies tiers ; pings anonymes).
- **Données** : pages vues, ville/pays approximatifs, UTM.
- **Conservation** : agrégats sans limite ; données brutes 13 mois — ⚠️ à valider.

---

## Partie B — Yuno sous-traitant (pour le compte des clubs/organisateurs — cf. DPA)

### B1. Billetterie et check-in
- **Pour le compte de** : club ou organisateur vendeur.
- **Finalité** : vente, émission de QR, contrôle d'accès, no-show.
- **Données** : identité acheteur, email, billet, statut de scan, référence courte.
- **Conservation** : 5 ans (preuve/litiges — aligné commandes).

### B2. Guest lists (dont invités sans compte)
- **Finalité** : inscription, sous-listes/parts, remplissage, contrôle à l'entrée.
- **Données** : nom, email, genre (statistique), présence.

### B3. Tables VIP et précommandes bouteilles
- **Finalité** : réservation, acompte, conso à table, diluants, carnet client VIP (vip_consumption_facts).
- **Données** : identité, montants, historique de consommation par établissement.

### B4. Commandes de boissons et crédits conso
- **Finalité** : commande au bar, skip the queue, crédits liés à la soirée.
- **Données** : commandes, montants, retrait.

### B5. Campagnes de communication des clubs/orgas
- **Finalité** : emails marketing des établissements à LEURS clients, segmentation RFM, désabonnements.
- **Base légale (du responsable)** : consentement des clients finaux — le club en est responsable ; Yuno fournit l'outil + registre des désinscriptions.
- **Données** : email, segments, historique d'envoi, unsubscribes.

### B6. Statistiques et démographie d'audience des événements
- **Finalité** : analytics post-soirée, origines clients (villes/pays), âge/sexe agrégés.
- **Données** : agrégats démographiques (âge via date de naissance, genre via guest list), villes d'origine.

---

## Sous-traitants ultérieurs (chaîne complète)

| Sous-traitant | Rôle | Localisation | Garanties |
|---|---|---|---|
| Supabase | Base de données, auth, storage, edge functions | UE | Chiffrement transit, DPA Supabase |
| Stripe | Paiements (Connect) | UE/US | SCC, PCI-DSS |
| Resend | Emails transactionnels et campagnes | US possible | SCC |
| Mapbox | Cartes (clubs, globe origines) | US possible | SCC — ne reçoit pas d'identité |
| Cloudflare | Hébergement front (Workers), CDN | Monde | SCC — ne stocke pas de données client |

## Mesures de sécurité transverses

RLS systématique par tenant/rôle ; HTTPS/TLS partout ; CORS verrouillé sur yunoapp.eu ;
secrets uniquement dans Supabase secrets/.env.local ; MFA ; RPC/security definer pour les
écritures sensibles ; journaux de sécurité ; accès super admin journalisé ; mots de passe
et PIN hachés ; données de carte jamais stockées.

## ⚠️ Durées à valider par le responsable (décisions à prendre)

1. Autorisations mineurs : proposé événement + 12 mois.
2. Données brutes d'audience : proposé 13 mois (standard CNIL mesure d'audience).
3. Carnet client VIP (historique conso nominatif) : proposé 3 ans après dernière visite.
