# Registre des activités de traitement (art. 30 RGPD)

**Responsable de traitement** : Paul BRISEBOIS, entrepreneur individuel (WOMBER), SIREN 995 130 747,
25 avenue Mercure, 31130 Quint-Fonsegrives, France — contact@yunoapp.eu
**Plateforme** : Yuno (yunoapp.eu) — SaaS nightlife : billetterie, tables VIP, commande de boissons.
**Délégué à la protection des données (DPO)** : non désigné (non obligatoire à ce stade).
**Dernière mise à jour** : 2026-10-08 (Yuno CRM : B7 à B9, A9, sous-traitants). ⚠️ Document interne — à tenir à jour à chaque nouveau traitement.

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

### A9. Statistiques anonymes d'amélioration de Yuno CRM
- **Finalité** : améliorer les règles d'analyse de Yuno CRM (seuils de rareté, de délai, de distance) à partir de comptages agrégés venus des comptes clients.
- **Origine** : produits par Yuno en sous-traitant, sur autorisation contractuelle du client (DPA art. 12.6, CGV CRM art. 9), refus possible par le titulaire (Réglages › Données).
- **Données** : comptages O / E / V / n par famille d'analyse et par trimestre, n ≥ 10, rattachés à une clé aléatoire par compte (`crm_learning_keys`), aucune donnée personnelle, aucun titre de soirée, artiste ou ville. Publication commune à 5 comptes, aucun > 50 %.
- **Base légale** : intérêt légitime de Yuno (amélioration du service) pour l'exploitation des comptages anonymes ; la production (anonymisation) est un traitement autorisé par chaque responsable.
- **Conservation** : tant que le compte contributeur existe ; supprimés au refus ou à la suppression du compte. Drapeau global `crm_learning_settings.enabled`.

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

### B7. Yuno CRM — import de la billetterie connectée et base de contacts
- **Pour le compte de** : club, organisateur ou association abonné à Yuno CRM.
- **Finalité** : importer en lecture seule les soirées et billets de la billetterie du client (Shotgun), les fichiers qu'il importe, tenir sa base, son registre d'accords et de désinscriptions, ses segments.
- **Données** : nom, prénom, e-mail, téléphone, âge ou année de naissance, genre, ville, code postal, pays (si transmis), billets (soirée, tarif, montant, canal, source UTM), scan d'entrée, invitations, accord newsletter rapporté par la billetterie.
- **Conservation** : durée de l'abonnement ; durée choisie par le client sans activité (Réglages › Données : 2, 3 ou 5 ans, ou jamais — Yuno recommande 3 ans) ; purge à la déconnexion de la billetterie (profils d'analyse) ; suppression 12 mois après la fin de l'abonnement (engagement CGV CRM art. 13, procédure MANUELLE à ce jour).

### B8. Yuno CRM — analyse client et « Chances de venir » (profilage pour le compte du client)
- **Finalité** : tester des hypothèses sur ce qui fait revenir le public du client (artistes, genre, format, série, jour, habitudes d'achat, distance), estimer la chance d'achat de chaque client déjà venu pour une soirée à venir, proposer des groupes à contacter avec un groupe témoin de 10 %.
- **Base légale (du responsable)** : intérêt légitime (connaître et fidéliser son public) ; l'envoi qui en découle suit L. 34-5 CPCE.
- **Données** : celles de B7 + données déduites (hypothèses, niveau de chance et raisons, distance au lieu calculée depuis le code postal, appartenance à un segment).
- **Garanties** : calcul par compte, sans croisement entre comptes ; modèle statistique propre au compte (régression logistique en SQL), effacé avec lui ; jamais de pourcentage individuel ; jamais dans un export ; opposition par personne (`crm_profile_optout`, efface profil, scores, journal) ; pas de décision automatisée au sens de l'article 22.
- **Conservation** : recalcul chaque nuit ; journal prévu / réel par personne effacé au règlement de la soirée ; profils effacés avec la personne, la connexion, le compte.

### B9. Yuno CRM — envois e-mail et SMS, pages d'inscription, liens suivis
- **Finalité** : envoyer les messages du client, mesurer remise, ouverture, clic ; appliquer désinscriptions et STOP ; pages d'inscription (double confirmation) ; liens courts `/go/` (empreinte salée du jour, jamais l'IP).
- **Base légale (du responsable)** : consentement ou relation client (L. 34-5 CPCE) ; mesure d'ouverture : voir le dossier `CRM_ANALYSE_CLIENT_REVUE_JURIDIQUE.md` (recommandation CNIL sur les pixels).
- **Données** : e-mail, téléphone, événements d'envoi, preuves d'accord (`marketing_consent_events`).

---

## Sous-traitants ultérieurs (chaîne complète)

| Sous-traitant | Rôle | Localisation | Garanties |
|---|---|---|---|
| Supabase | Base de données, auth, storage, edge functions | UE | Chiffrement transit, DPA Supabase |
| Stripe | Paiements (Connect) | UE/US | SCC, PCI-DSS |
| Resend | Emails transactionnels et campagnes | US possible | SCC |
| Mapbox | Cartes (clubs, globe origines) | US possible | SCC — ne reçoit pas d'identité |
| Cloudflare | Hébergement front (Workers), CDN, liens courts /go/ | Monde | SCC — ne stocke pas de données client |
| Octopush | SMS (Yuno CRM, SMS de la Suite) | France | Société française, données en France |
| OpenAI | Assistant Console (questions du pro et données nécessaires à la réponse) | US | DPF / SCC, pas d'entraînement sur les données de l'API |
| PostHog | Mesure d'usage de l'app et de la Console | UE | Hébergement UE, consentement sur le web |

## Mesures de sécurité transverses

RLS systématique par tenant/rôle ; HTTPS/TLS partout ; CORS verrouillé sur yunoapp.eu ;
secrets uniquement dans Supabase secrets/.env.local ; MFA ; RPC/security definer pour les
écritures sensibles ; journaux de sécurité ; accès super admin journalisé ; mots de passe
et PIN hachés ; données de carte jamais stockées.

## ⚠️ Durées à valider par le responsable (décisions à prendre)

1. Autorisations mineurs : proposé événement + 12 mois.
2. Données brutes d'audience : proposé 13 mois (standard CNIL mesure d'audience).
3. Carnet client VIP (historique conso nominatif) : proposé 3 ans après dernière visite.
