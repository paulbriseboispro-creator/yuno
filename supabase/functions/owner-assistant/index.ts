import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.83.0";
import { SUBSCRIPTIONS_ENABLED } from "../_shared/venue-plan.ts";

// Modèle OpenAI — changer ici suffit (clé : secret Supabase OPENAI_API_KEY)
const OPENAI_MODEL = "gpt-4o-mini";
// Modèle dédié à la génération de contenu marketing (action hors chat) —
// séparé du chat pour évoluer indépendamment.
const CONTENT_MODEL = "gpt-5-mini";
// Modèle du Night Report narratif (analyse post-soirée).
const REPORT_MODEL = "gpt-5-mini";
// Modèle du next-best-action quotidien (carte dashboard).
const ACTIONS_MODEL = "gpt-5-mini";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════
// SYSTEM PROMPT — Condensé, strict, data-driven
// ═══════════════════════════════════════════

const OWNER_SYSTEM_PROMPT = `Tu es Yuno Pro, l'assistant IA opérationnel des propriétaires de clubs sur Yuno. Tutoie l'owner. Réponds dans sa langue (français, anglais, espagnol).

═══ RÈGLE ABSOLUE ═══
Tu es un MOTEUR DE REQUÊTES, pas un chatbot.
- Pour TOUTE question factuelle (stats, événements, staff, revenus, commandes…) → APPELLE D'ABORD un tool.
- Si aucun tool ne peut répondre → dis "Je n'ai pas cette donnée."
- Tu ne DOIS JAMAIS inventer, deviner ou approximer un chiffre, un nom d'événement, ou un statut.
- Les seules réponses sans tool sont : remerciements, salutations, questions de clarification, explications de fonctionnalités.

═══ FORMAT DE RÉPONSE ═══
1. Commence par le RÉSULTAT (chiffre, action, donnée)
2. Ajoute du CONTEXTE si pertinent
3. Suggère la PROCHAINE ACTION
Utilise du Markdown : **gras**, listes, tableaux.

Exemple bon : "Le CA Club de ce soir est de **4 120€** (CA Net : **3 980€**). 18 commandes en attente. Tu veux vérifier la performance du bar ?"
Exemple mauvais : "Les ventes se passent bien !"

═══ CONFIRMATION OBLIGATOIRE ═══
AVANT d'exécuter une action qui MODIFIE des données :
1. Appelle list_events (ou le tool pertinent) pour identifier l'objet
2. Si ambiguïté (même nom, différentes dates) → liste les options avec dates et statut
3. Résume ce que tu vas faire en **gras**
4. Demande "**Tu confirmes ?**"
5. Exécute UNIQUEMENT après réponse affirmative ("oui", "ok", "go", "confirme")

⚠️ TOUJOURS cibler les événements À VENIR par défaut, jamais les passés.
⚠️ JAMAIS d'action write sans confirmation explicite.

═══ MÉTRIQUES DE REVENUS ═══
Quand tu donnes des chiffres de revenus, présente TOUJOURS :
- **CA Club** = Total payé - Frais Yuno (service_fee + insurance_fee)
- **CA Net** = CA Club - Frais Stripe (1.5% + 0.25€)

Formate en tableau Markdown :
| Source | CA Club | CA Net |
|--------|---------|--------|
| Boissons | X€ | Y€ |
| Billets | X€ | Y€ |
| Tables VIP | X€ | Y€ |
| **Total** | **X€** | **Y€** |

═══ TARIFICATION (période de lancement) ═══
Yuno est GRATUIT pour les clubs pendant le lancement : aucune mensualité, TOUTES les fonctionnalités sont incluses (billetterie, tables VIP, fidélité, CRM, promoteurs, DJs, analytics…).
Seules les commissions par transaction s'appliquent (voir la structure des frais via search_help_articles).
Si l'owner demande le prix d'un abonnement : explique que c'est gratuit actuellement, que des plans payants arriveront plus tard, et que les early adopters seront prévenus à l'avance.
Ne bloque JAMAIS une fonctionnalité pour une question de plan.

═══ NAVIGATION ═══
Utilise des liens Markdown : [Événements](/owner/events), [Menu](/owner/menu), [Staff](/owner/staff), [Billetterie](/owner/ticketing), [Tables VIP](/owner/tables), [Analytics](/owner/analytics), [Paramètres](/owner/venue), [Clients](/owner/customers), [Fidélité](/owner/loyalty), [DJs](/owner/djs), [Promoteurs](/owner/promoters), [Mode d'emploi](/owner/help)

═══ NE MÉLANGE JAMAIS ═══
- Ne mélange PAS documentation et réponses data
- Pour les questions "comment ça marche" → utilise search_help_articles
- Pour les questions "combien / quoi / qui" → utilise les tools data`;

// ═══════════════════════════════════════════
// HELP ARTICLES INDEX
// ═══════════════════════════════════════════

const HELP_ARTICLES: Record<string, { title: string; keywords: string[]; path: string; snippet: string }> = {
  "staff-push-notifications": {
    title: "Alertes push du staff (app Yuno Pro)",
    keywords: ["notification", "notifications", "push", "alerte", "alert", "app pro", "yuno pro", "staff", "barman", "videur", "bouncer", "hôte vip", "vip host", "téléphone", "prévenu", "alerté"],
    path: "/owner/staff",
    snippet: "Le staff installe l'app « Yuno Pro » et accepte les notifications à la première ouverture. Chacun est ensuite alerté sur son téléphone, même verrouillé, uniquement sur ce qui le concerne : l'hôte VIP quand un client VIP passe la porte et quand une table demande une commande ; le barman quand une commande arrive alors que sa file était vide ; les videurs quand un incident est signalé à la porte. On ne pousse QUE l'important — un push par commande un samedi soir serait ingérable, donc le bar n'est réveillé que si plus rien n'attendait. Le reste de l'activité reste visible en temps réel dans l'app. Rien à configurer côté owner : c'est actif dès que le staff a le rôle et l'app.",
  },
  "ticketing-modes": {
    title: "Modes de billetterie",
    keywords: ["ticket", "billet", "mode", "round", "simple", "timed", "créneau", "billetterie", "ticketing", "entrée"],
    path: "/owner/ticketing",
    snippet: "Yuno propose 3 modes de billetterie :\n1. **Simple** : Un seul type de billet à prix fixe, sans rounds. Idéal pour les soirées simples.\n2. **Rounds** (tours de vente) : Plusieurs tarifs progressifs (Early Bird → Regular → Last Minute). Chaque round a un nom, prix, quota et dates. Quand un round est sold out, le suivant s'active automatiquement.\n3. **Créneaux horaires (Timed Entry)** : Billets liés à des créneaux horaires spécifiques. Permet de gérer le flux d'entrées et d'éviter la surcharge.\n\nChaque mode inclut les frais de service Yuno. L'assurance annulation n'est plus commercialisée : le toggle a été retiré de la page Billetterie et l'option n'apparaît plus au checkout client. Les billets vendus avec assurance avant son retrait restent annulables normalement et continuent d'apparaître en compta.",
  },
  "stripe-connect": {
    title: "Stripe Connect & Paiements",
    keywords: ["stripe", "paiement", "payment", "IBAN", "virement", "bank", "connect", "argent"],
    path: "/owner/venue",
    snippet: "Yuno utilise Stripe Connect (Standard) pour les paiements. Chaque club a son propre compte Stripe connecté. L'argent va directement sur le compte du club. Yuno prélève une commission automatiquement. Pour connecter Stripe : va dans Paramètres > Paiements et clique 'Connecter Stripe'. Stripe vérifie le compte en 24-48h.",
  },
  "staff-roles": {
    title: "Rôles du staff",
    keywords: ["staff", "employé", "barman", "bouncer", "videur", "manager", "vestiaire", "cloakroom", "rôle", "PIN"],
    path: "/owner/staff",
    snippet: "Rôles disponibles : Barman, Bouncer, VIP Host, Vestiaire (Cloakroom), Manager. Chaque employé a un PIN à 6 chiffres. L'employé doit déjà avoir un compte Yuno. Le Manager a des permissions granulaires configurables. Tu peux mettre autant de personnes que tu veux sur le même rôle (plusieurs barmans, plusieurs videurs) : chacun garde son compte, son PIN et ses propres statistiques. Une personne ne peut en revanche être rattachée qu'à un seul club à la fois.",
  },
  "staff-account": {
    title: "Le compte personnel du staff",
    keywords: ["compte staff", "profil staff", "mon compte", "personnalisation", "surnom", "photo staff", "emoji", "couleur", "identité", "équipe", "stats staff", "statistiques employé", "qui a scanné", "performance staff"],
    path: "/owner/staff",
    snippet: "Chaque membre du staff a désormais un vrai compte personnel, pas juste un écran de poste. Depuis son dashboard il tape sur son nom en haut à gauche pour ouvrir « Mon compte » : il y choisit le nom affiché sur ses écrans (un surnom de service s'il préfère), un intitulé de poste personnalisé (« Chef de rang » plutôt que « Barman »), un emoji, une couleur d'accent qui colore toute son interface, et une photo de profil pro. Il y retrouve aussi ses propres chiffres — scans, commandes servies, dépôts au vestiaire, consos VIP, nuits travaillées sur 30 jours — et la liste de l'équipe avec qui il bosse. Rien à configurer côté owner : chaque personne gère sa propre fiche. Côté club, ça change une chose importante : chaque action est maintenant attribuée à la personne qui l'a faite, donc le centre de commandement live montre correctement qui a scanné, qui a servi et qui tient le vestiaire.",
  },
  "vip-tables": {
    title: "Tables VIP",
    keywords: ["table", "VIP", "réservation", "zone", "minimum", "consommation", "acompte", "deposit"],
    path: "/owner/tables",
    snippet: "Les Tables VIP permettent de créer des zones avec tables, capacité et minimum de consommation. Les clients réservent avec un acompte. Le VIP host gère les arrivées et les consommations sur place.",
  },
  "subscription-plans": {
    title: "Tarification — lancement gratuit",
    keywords: ["abonnement", "plan", "essential", "pro", "elite", "prix", "tarif", "billing", "gratuit", "coût", "combien", "subscription", "pricing", "free"],
    path: "/owner/billing",
    snippet: "Pendant le lancement, Yuno est GRATUIT pour les clubs : aucune mensualité, toutes les fonctionnalités incluses (billetterie, tables VIP, fidélité, CRM, promoteurs, DJs, analytics). Seules les commissions par transaction s'appliquent (voir structure des frais). Des plans payants arriveront plus tard ; les clubs actifs seront prévenus à l'avance.",
  },
  "guest-list": {
    title: "Guest List",
    keywords: ["guest", "list", "liste", "invité", "gratuit", "free", "quota", "places restantes", "remaining spots", "compteur", "modèle", "template"],
    path: "/owner/guest-list",
    snippet: "La guest list permet d'offrir l'entrée gratuite avant une certaine heure. Configure un quota (global ou par genre), active/désactive par event. Crée des parts déléguées par promoteur, DJ ou nom libre, avec quota par type (standard/boisson/VIP) ou « Sans limite » (illimité) : le détenteur ajoute alors autant d'invités qu'il veut et suit ses places restantes en direct dans son app. Chaque modèle de guest list (onglet Modèles) porte aussi le réglage « Afficher les places restantes » : activé, le public lit « 42 places restantes » ; désactivé, il voit seulement si la liste est ouverte ou complète. Le réglage est repris sur chaque part et modifiable soirée par soirée.",
  },
  "onboarding": {
    title: "Parcours de configuration",
    keywords: ["onboarding", "configuration", "configurer", "commencer", "démarrer", "setup"],
    path: "/owner/onboarding",
    snippet: "L'onboarding en 9 étapes : 1) Infos de base, 2) Design (logo/bannière), 3) Branding (couleur), 4) Stripe Connect, 5) Staff, 6) Menu, 7) Premier événement, 8) Prévisualisation, 9) Publication.",
  },
  "fee-structure": {
    title: "Structure des frais",
    keywords: ["frais", "fee", "commission", "service", "pourcentage", "coût", "stripe"],
    path: "/owner/help",
    snippet: "Frais Yuno : 3% sur commandes boissons, max(0.99€, 4%) sur billets. Sur les acomptes VIP c'est aussi max(0.99€, 4%) mais plafonné à 25€ : le frais est calculé sur le montant réellement débité (l'acompte, pas le prix total de la table), et il ne dépasse jamais 25€ même sur une très grosse table. Le club paie les frais Stripe (1.5% + 0.25€ par transaction). CA Club = Total - Frais Yuno. CA Net = CA Club - Frais Stripe.",
  },
  "loyalty": {
    title: "Programme de fidélité",
    keywords: ["fidélité", "loyalty", "points", "récompense", "reward"],
    path: "/owner/loyalty",
    snippet: "Le programme de fidélité permet d'attribuer des points par euro dépensé. Configure un bonus de bienvenue, des récompenses échangeables. Paliers clients : Bronze, Silver, Gold, Platinum.",
  },
  "promoters": {
    title: "Système de promoteurs",
    keywords: ["promoteur", "promoter", "affiliation", "commission", "lien", "remboursement", "bonus"],
    path: "/owner/promoters",
    snippet: "Les promoteurs ont un lien de parrainage unique (yunoapp.eu/promoteur/CODE — le code est unique par personne, partagé entre ses clubs). Ils gagnent une commission par ticket ou table vendue. Configure les taux par type via les modèles de commission : taux fixes ou en pourcentage, paliers de ventes, bonus au franchissement d'un seuil, fenêtres horaires de validité au scan. Active « Auto-assignation aux soirées » dans la fiche d'un promoteur pour le relier automatiquement à chaque nouvelle soirée (récurrentes et co-events inclus). Son scanner détecte automatiquement la soirée en cours. Un remboursement annule automatiquement la commission en attente liée à la vente.",
  },
  "menu": {
    title: "Gestion de la carte",
    keywords: ["menu", "carte", "boisson", "drink", "cocktail", "prix", "prévente", "presale", "commande"],
    path: "/owner/menu",
    snippet: "Catégories : Cocktails, Shooters, Bières, Vins/Champagnes, Spiritueux, Soft, Snacks, Autres. Chaque boisson a un nom, prix, image. Active/désactive sans supprimer. Prix promo disponible, et prix presale par boisson (activable en masse) — utilisé par la page upsell post-achat de billet.",
  },
  "drinks-upsell": {
    title: "Upsell boissons post-achat",
    keywords: ["upsell", "post-achat", "post-purchase", "presale", "prévente", "boisson après billet", "drinks after ticket", "page upsell", "zéro file", "skip queue"],
    path: "/owner/menu",
    snippet: "Juste après l'achat d'un billet, le client voit une page boissons (presale d'abord, prix barré) et peut commander en un geste — la commande est liée à la soirée, retrait au bar par QR le soir J. Activée par défaut, toggle « Upsell post-achat » dans Opérations → Menu. Complément : automatisation push « Boissons jour J » (Notifications push) et bouton commande dans l'email de confirmation de billet.",
  },
  "live-mode": {
    title: "Mode Live (soirée)",
    keywords: ["mode live", "live mode", "live", "scan", "entrée", "entry", "takeover", "push bienvenue", "welcome push", "soirée", "night mode"],
    path: "/owner/menu",
    snippet: "Au scan d'entrée (billet, guest list ou résa VIP), l'app du client bascule en mode soirée plein écran : ta carte en premier plan, re-commande 1 tap, statut de commande en direct avec QR de retrait, crédits conso et upsell « X tables restantes ». Le client reçoit aussi un push de bienvenue. Activé par défaut — toggle « Mode Live » dans Opérations → Menu pour le couper. Dure jusqu'à 2 h après la fin de l'événement.",
  },
  "solo-bottles": {
    title: "Bouteilles sans table (Mode Live)",
    keywords: ["bouteille sans table", "bottle without table", "vente solo", "solo sale", "bouteille bar", "bouteille", "bottle"],
    path: "/owner/vip-service",
    snippet: "Option du Mode Live : le club peut vendre des bouteilles entières SANS réservation de table. Le client achète depuis le menu de soirée et retire au bar avec un QR, comme une commande de boissons (le barman scanne pareil). Activation : Opérations → Service VIP → Carte → « Vente de bouteilles sans table ». Exclusion possible bouteille par bouteille (switch « Vente solo »). Les bouteilles à diluant gardent l'étape mixers.",
  },
  "events-create": {
    title: "Créer et publier une soirée",
    keywords: ["événement", "event", "soirée", "créer", "create", "publier", "publish", "poster", "affiche", "line-up", "privé", "mot de passe", "visibilité", "secret"],
    path: "/owner/events",
    snippet: "Depuis Événements, crée une soirée : titre, dates, affiche, genre musical, line-up DJ. Active ensuite la billetterie, la guest list et les tables VIP selon tes besoins. Une soirée peut être publique (visible dans Explorer) ou privée avec mot de passe. Les événements sans lieu fixe peuvent utiliser une adresse secrète révélée aux acheteurs.",
  },
  "recurring-events": {
    title: "Soirées récurrentes",
    keywords: ["récurrent", "récurrence", "recurring", "hebdomadaire", "weekly", "série", "series", "chaque semaine", "répéter", "guest list automatique", "résidence", "residency", "contrat-cadre"],
    path: "/owner/events",
    snippet: "Crée une soirée récurrente (ex. tous les vendredis) : chaque occurrence est générée automatiquement avec les presets billets standard/VIP et le preset de tables VIP de la série. Le bloc « Guest list automatique » du réglage de la série te laisse épingler un modèle de guest list : chaque soirée générée naît alors avec sa guest list club déjà publiée (laisse « Pas de guest list automatique » pour la gérer soirée par soirée). Les rounds de billets s'activent automatiquement à chaque occurrence. Tu peux marquer une occurrence complète manuellement et tu reçois un rappel pour ajouter le line-up DJ de chaque date. Si tu montes la série avec un organisateur partenaire, le bloc « Co-organisation » te fait choisir le MODE de collaboration (co-soirée, location de salle, ou hébergement par le club — les mêmes que sur une soirée unique) puis QUI FAIT QUOI (création, billetterie, opérations, promotion), et ajoute une étape contrat : soit tu reprends un contrat déjà signé avec lui (autre résidence ou conditions du partenariat), soit tu en rédiges un nouveau avec un partage détaillé billets / tables VIP / boissons et la règle d'annulation. À l'enregistrement, l'organisateur reçoit le récap de la série et les conditions ; une seule signature de sa part ouvre toutes les dates à la vente.",
  },
  "collab-responsibilities": {
    title: "Qui fait quoi dans une collaboration",
    keywords: ["qui fait quoi", "who does what", "responsabilité", "responsabilités", "responsibilities", "qui décide", "qui gère", "domaine", "création", "creative", "affiche", "design", "logistique", "opérations", "operations", "chacun son métier", "mode de collaboration", "location de salle", "venue rental", "hébergée", "org hosted", "lecture seule", "read only", "je ne peux pas modifier", "modifier l'affiche"],
    path: "/owner/collaborations",
    snippet: "Dans une collaboration, DEUX choses se négocient séparément. Le PARTAGE DES RECETTES dit qui touche l'argent (billets, tables VIP, boissons). L'axe QUI FAIT QUOI dit qui a la main sur quoi, et c'est indépendant. Quatre domaines : la création (affiche, titre, description, genres musicaux), la billetterie (prix, quotas, ouverture des ventes), les opérations (tables VIP, plan de salle, accès, lieu) et la promotion (visibilité, découverte, référencement). Chaque domaine va au club, à l'organisateur, ou aux deux. Quatre répartitions types existent en un clic : « Chacun son métier » (le club tient la salle, les tables et la billetterie, l'organisateur habille la soirée et la remplit — la plus courante), « Tout à deux », « L'orga pilote », « Le club pilote ». Tu peux aussi régler chaque domaine à la main. Le réglage est APPLIQUÉ, pas seulement affiché : si la création revient à l'organisateur, le club ne peut plus changer l'affiche, et inversement. Si quelqu'un dit « je ne peux pas modifier l'affiche / la billetterie / les tables » sur une co-soirée, c'est presque toujours que ce domaine est confié à l'autre partie. Une soirée existante garde son comportement d'avant tant que personne n'a réparti les domaines. Une fois le contrat signé la répartition est engagée et s'affiche en lecture seule : pour la changer il faut résilier le contrat et en proposer un nouveau. Ce réglage se pose à la proposition d'une soirée unique comme d'une série récurrente.",
  },
  "collaborations": {
    title: "Co-organisations (clubs ↔ organisateurs)",
    keywords: ["collaboration", "collab", "co-organisation", "co-org", "organisateur", "organizer", "BDE", "partenaire", "partage", "split", "contrat", "signature", "contrat-cadre", "résidence", "reprendre un contrat"],
    path: "/owner/collaborations",
    snippet: "Les collaborations permettent de monter une soirée à deux : ton club + un organisateur externe (asso, BDE, promoteur d'événements). Un contrat numérique définit le partage des revenus (billets, tables VIP, boissons) et doit être signé par LES DEUX parties avant que les ventes ouvrent. Les paiements sont ensuite répartis automatiquement selon le contrat. Gère les propositions reçues et envoyées depuis l'onglet Collaborations. Pour une série récurrente, c'est un CONTRAT-CADRE : signé une seule fois, il couvre toutes les dates de la résidence, présentes et à venir, et se résilie pour l'avenir depuis la carte de la série (les soirées déjà ouvertes à la vente restent inchangées). Au moment de créer la série, tu peux reprendre les conditions d'un contrat déjà signé avec cet organisateur plutôt que d'en resaisir un ; l'organisateur reçoit alors le récap de la série (jour, horaires, billetterie, tables, guest list, prochaines dates) avec les conditions à signer. Les boissons restent à 100% club tant que l'organisateur n'a pas attesté sa licence de vente d'alcool. Le contrat porte aussi la répartition des RESPONSABILITÉS (qui tient la création, la billetterie, les opérations, la promotion) — voir l'article « Qui fait quoi dans une collaboration ».",
  },
  "scarcity-fomo": {
    title: "Rareté & FOMO",
    keywords: ["scarcity", "rareté", "fomo", "urgence", "urgency", "dernières places", "jauge", "compteur", "sold out", "pression"],
    path: "/owner/scarcity",
    snippet: "Les outils Rareté/FOMO affichent aux clients des signaux d'urgence : jauge de remplissage, dernières places d'un round, compte à rebours. Bien réglés, ils accélèrent les ventes en début et fin de cycle. Configure-les par événement depuis la page Rareté.",
  },
  "hype-score": {
    title: "Hype Score",
    keywords: ["hype", "score", "engagement", "popularité", "prévision", "forecast", "tendance"],
    path: "/owner/hype",
    snippet: "Le Hype Score mesure l'engagement autour de tes soirées (vues, favoris, abonnés, ventes) et projette la tendance de remplissage. Utilise-le pour repérer tôt une soirée qui décolle ou qui a besoin d'un coup de promo.",
  },
  "live-night": {
    title: "Centre de commandement soirée (Live)",
    keywords: ["live", "direct", "ce soir", "tonight", "scans", "entrées", "temps réel", "real time", "monitoring", "commandement", "command center", "jauge", "capacité", "incidents", "radio staff", "alertes", "briefing"],
    path: "/owner/live",
    snippet: "Le centre de commandement suit ta soirée comme si tu étais partout à la fois : jauge de remplissage vs capacité, comparaison avec ta dernière soirée comparable, stations Porte / Bar / Tables VIP / Vestiaire / Staff, fil « radio staff » narratif, incidents signalés en 1 tap par ton bouncer et ruptures produit du bar. Les alertes critiques (bar débordé, minimum conso à risque, jauge 95 %) arrivent dans ta cloche et en push sur ton téléphone. Le bouton Briefing me demande un point de situation à tout moment.",
  },
  "email-campaigns": {
    title: "Campagnes email",
    keywords: ["email", "campagne", "campaign", "newsletter", "mailing", "éditeur", "envoi", "ouvertures", "désabonnement"],
    path: "/owner/campaigns",
    snippet: "Crée des campagnes email vers tes clients avec l'éditeur intégré (visuel ou avancé). Cible par segments (fidèles, inactifs, VIP…), envoie, puis suis le rapport : ouvertures, clics, désabonnements. Les destinataires désabonnés sont exclus automatiquement des envois suivants.",
  },
  "marketing-consent": {
    title: "Consentement marketing (RGPD)",
    keywords: ["consentement", "consent", "opt-in", "optin", "rgpd", "gdpr", "désabonnement", "désabonné", "unsubscribe", "case à cocher", "acceptation", "preuve", "cnil", "liste marketing"],
    path: "/owner/help",
    snippet: "L'accord d'un client vaut pour TON club entier, pas pour une soirée : il coche la case une seule fois, puis les réservations suivantes affichent juste « inscrit » avec un lien de désinscription. L'accord donné à un autre club ne te profite jamais, et le tien ne profite à personne d'autre — un nouveau client voit toujours une case décochée portant TON nom. Tu ne peux pas ajouter à la main ni importer une liste : les campagnes email et SMS ne partent qu'aux contacts au consentement actif pour ton club, vérifié au moment de l'envoi. Chaque accord est archivé avec sa date, son canal, sa langue et la phrase exacte affichée, donc la preuve existe en cas de contrôle CNIL. Côté SMS, la mention « STOP pour ne plus recevoir » est ajoutée automatiquement à la fin de CHAQUE campagne (obligation légale distincte du consentement) et tu ne peux pas la retirer ; quand quelqu'un répond STOP, il est retiré immédiatement de toutes les listes SMS.",
  },
  "sms": {
    title: "SMS & crédits SMS",
    keywords: ["sms", "texto", "crédit", "credits", "campagne sms", "message"],
    path: "/owner/sms",
    snippet: "Les campagnes SMS fonctionnent avec des crédits prépayés : achète des crédits depuis la page SMS, puis compose et cible ta campagne comme pour l'email. Le solde de crédits restants est affiché avant chaque envoi.",
  },
  "push-notifications": {
    title: "Notifications push",
    keywords: ["push", "notification", "notif", "automatique", "auto", "soirée live", "event live", "remerciement", "thank you", "rappel", "reminder", "bientôt complet", "sold out", "happy hour", "tables vip", "guest list", "campagne push"],
    path: "/owner/push",
    snippet: "La page Notifications push a DEUX familles bien séparées. 1) AUTOMATIQUES : tu actives un toggle, Yuno envoie tout seul au bon moment — Rappel jour J (6 h avant, aux acheteurs), La soirée commence (à l'ouverture, aux acheteurs), Remerciement (après la soirée, aux clients entrés), Bientôt complet (à 85 % de billets vendus, aux followers). Désactivées par défaut, chacune ne part qu'une fois par soirée et dans la langue de chaque client, et ne compte PAS dans la limite de 4 campagnes/24 h. 2) MANUELLES : tu composes et envoies un push ponctuel (Promotion, Happy hour, Dernières places, Tables VIP, Guest list, Concours ou message libre), en ciblant l'audience (acheteurs, clients entrés, followers, segment). Plafond 4 campagnes/24 h.",
  },
  "refund-management": {
    title: "Remboursements",
    keywords: ["remboursement", "refund", "rembourser", "annulation", "cancel", "litige", "client mécontent"],
    path: "/owner/refunds",
    snippet: "Les remboursements sont à l'initiative du club : depuis Remboursements, retrouve la commande ou le billet (par référence, email ou nom) et rembourse en un clic — le client est recrédité via Stripe sous 5 à 10 jours ouvrés. En cas d'annulation d'événement, rembourse les billets depuis la même page.",
  },
  "invoices-accounting": {
    title: "Comptabilité & factures",
    keywords: ["comptabilité", "accounting", "facture", "invoice", "TVA", "export", "rapport", "bilan", "chiffres"],
    path: "/owner/accounting",
    snippet: "L'onglet Comptabilité produit un rapport par soirée : CA par source (billets, boissons, tables), TVA, frais, et exports téléchargeables pour ton comptable. Les factures Yuno sont disponibles dans [Factures](/owner/invoices).",
  },
  "waitlist": {
    title: "Liste d'attente",
    keywords: ["waitlist", "liste d'attente", "attente", "complet", "sold out", "places libérées"],
    path: "/owner/waitlist",
    snippet: "Quand une soirée est complète, les clients peuvent rejoindre la liste d'attente. Si des places se libèrent (remboursement, nouveau round), les inscrits sont notifiés dans l'ordre. Consulte et gère les listes d'attente par événement.",
  },
  "promoter-teams": {
    title: "Équipes de promoteurs",
    keywords: ["équipe", "team", "promoteurs", "groupe", "chef d'équipe", "recrutement"],
    path: "/owner/promoters",
    snippet: "Organise tes promoteurs en équipes avec un responsable par équipe. Compare les performances (conversions, commissions) par équipe et par promoteur depuis la page Promoteurs.",
  },
  "agencies": {
    title: "Agences de promotion",
    keywords: ["agence", "agency", "agences", "prestataire", "externe"],
    path: "/owner/agencies",
    snippet: "Les agences sont des structures externes qui gèrent leurs propres promoteurs pour ton club. Invite une agence, définis les commissions, et elle pilote son équipe de son côté — tu suis les résultats consolidés depuis la page Agences.",
  },
  "customers-crm": {
    title: "Clients & CRM",
    keywords: ["client", "customer", "crm", "segment", "rfm", "ban", "bannir", "fiche client", "historique", "export"],
    path: "/owner/customers",
    snippet: "La page Clients regroupe tous tes clients avec leur historique (visites, dépenses, panier moyen) et une segmentation automatique (fidèles, réguliers, à risque, inactifs). Tu peux bannir un client par email — le videur est alerté si son billet est scanné. Utilise les segments pour cibler tes campagnes email/SMS.",
  },
  "analytics": {
    title: "Analytics",
    keywords: ["analytics", "statistiques", "stats", "démographie", "audience", "origine", "villes", "âge", "funnel", "performance"],
    path: "/owner/analytics",
    snippet: "Analytics couvre tes ventes (CA par source et par soirée), ton audience (âge, sexe, villes d'origine des participants), le funnel d'achat, et une zone Guest list dédiée. Après chaque soirée, une analyse post-event résume la performance. Utilise ces données pour caler ta programmation et tes prix.",
  },
  "analytics-guest-list": {
    title: "Analytics guest list",
    keywords: ["guest list", "guestlist", "invité", "invités", "no-show", "no show", "présence", "taux de présence", "remplissage", "quota", "peak time", "heure d'arrivée", "valeur invité", "rentabilité guest list", "guest list roi"],
    path: "/owner/analytics",
    snippet: "La zone Guest list d'Analytics répond à « est-ce que mes guest lists rapportent ? ». Elle donne le nombre d'inscrits, le taux de présence et de no-show, le remplissage vs quota (les listes illimitées en sont exclues), l'heure d'arrivée réelle à la porte avec le pic, et surtout la valeur par invité : ce qu'un invité consomme au bar et en VIP une fois entré. Un comparatif place l'invité guest list face au détenteur de billet payant sur les mêmes soirées. Le détail se décline par type d'invitation, genre, délai d'inscription et soirée par soirée. La liste « Par détenteur de liste » est un déroulant : en cliquant sur un promoteur, un DJ ou un organisateur, l'owner voit ses chiffres a lui — CA bar et VIP séparés, panier moyen, taux de conversion, no-show, remplissage de ses listes, heure de pic, courbe d'arrivées et meilleure soirée. C'est la vue qui permet de comparer deux promoteurs entre eux.",
  },
  "dj-booking": {
    title: "DJs & booking",
    keywords: ["dj", "booking", "booker", "résident", "line-up", "marketplace", "artiste", "réserver un dj"],
    path: "/owner/djs",
    snippet: "Gère tes DJs résidents depuis la page DJs (profils, sets, line-up des soirées). Pour trouver de nouveaux artistes, [Book DJ](/owner/book-dj) cherche dans la marketplace par ville, rayon, genre et cachet — envoie une demande de booking directement au DJ.",
  },
  "managers": {
    title: "Managers & permissions",
    keywords: ["manager", "managers", "permission", "droits", "accès", "déléguer", "équipe de direction"],
    path: "/owner/managers",
    snippet: "Un manager est un compte de confiance avec des permissions granulaires : événements, menu, staff, commandes, tables, billetterie, analytics, clients, fidélité, promoteurs, DJs, guest list, paramètres. Active uniquement ce dont il a besoin — tu restes le seul owner.",
  },
  "security-mfa": {
    title: "Sécurité & MFA",
    keywords: ["mfa", "2fa", "double authentification", "sécurité", "security", "totp", "code", "authenticator"],
    path: "/owner/venue",
    snippet: "Le compte owner est protégé par la double authentification (MFA) : un code temporaire généré par une app d'authentification est demandé à la connexion. C'est obligatoire car le compte owner contrôle les paiements et les données clients. Configure ou réinitialise la MFA depuis les paramètres.",
  },
  "notifications-settings": {
    title: "Notifications",
    keywords: ["notification", "notif", "alertes", "push", "email", "préférences"],
    path: "/owner/notifications",
    snippet: "Choisis quelles alertes tu reçois (ventes, réservations VIP, guest list, commandes, collaborations) et par quel canal. Les notifications de vente incluent un lien direct vers la commande concernée.",
  },
  "upsell-offers": {
    title: "Offres upsell",
    keywords: ["upsell", "offre", "pack", "bundle", "billet + conso", "vente additionnelle"],
    path: "/owner/upsell",
    snippet: "Les offres upsell proposent au client d'ajouter quelque chose au moment de l'achat : conso avec le billet, upgrade de table, vestiaire prépayé. Configure les offres par événement pour augmenter le panier moyen.",
  },
  "vip-service": {
    title: "Service VIP en salle",
    keywords: ["vip host", "hôte", "service", "salle", "arrivée", "conso sur place", "bouteille"],
    path: "/owner/vip-service",
    snippet: "La page Service VIP est l'outil de l'hôte VIP pendant la soirée : arrivées des réservations, installation des groupes, suivi du minimum de consommation et commandes de bouteilles à la table. Le staff VIP host y accède avec son PIN.",
  },
  "ai-content-generation": {
    title: "Générer tes campagnes avec l'IA",
    keywords: ["ia", "ai", "générer", "generate", "rédiger", "texte", "campagne", "push", "email", "sms", "contenu", "variante", "traduction", "multi-langue", "langues"],
    path: "/owner/push",
    snippet: "Sur les pages Push, Email et SMS, le bouton « Générer avec l'IA » rédige 3 variantes de message en anglais, français et espagnol à partir des vraies données de ta soirée (date, prix, remplissage). Choisis un ton (hype, élégant, amical, urgent), ajoute une instruction libre si tu veux, puis « Utiliser ce texte » : le texte remplit le formulaire et tu restes l'éditeur final — rien ne part sans ton accord. Pour les push, « Utiliser dans les 3 langues » envoie à chaque client SA langue (badge EN·FR·ES) ; modifier le texte à la main repasse en langue unique.",
  },
  "ai-daily-actions": {
    title: "« À faire aujourd'hui » — les 3 actions du jour",
    keywords: ["ia", "ai", "actions", "aujourd'hui", "priorité", "dashboard", "conseil", "quoi faire", "recommandation", "daily", "todo"],
    path: "/owner/dashboard",
    snippet: "En haut du dashboard, la carte « À faire aujourd'hui » propose chaque jour 3 actions priorisées par l'IA à partir de l'état réel du club : remplissage des soirées à venir, temps écoulé depuis la dernière campagne, clients à risque, automations désactivées. Chaque action donne sa raison chiffrée et mène directement à la bonne page. Recalculée une fois par jour — l'IA suggère, l'owner décide.",
  },
  "ai-night-report": {
    title: "Analyse IA de la soirée",
    keywords: ["ia", "ai", "analyse", "rapport", "night report", "post-event", "soirée", "enseignements", "insights", "bilan", "hype"],
    path: "/owner/hype",
    snippet: "Dans l'analyse post-soirée (page Hype), la carte « Analyse IA de la soirée » transforme les chiffres en 5 enseignements et 3 actions concrètes pour la prochaine fois (marketing, tarifs, opérations, expérience). L'analyse n'utilise QUE tes chiffres réels et te dit honnêtement quand les données sont trop maigres. Elle est mise en cache et ne se régénère que si les chiffres changent.",
  },
  "ai-dj-matching": {
    title: "Les DJs qui collent à ta soirée",
    keywords: ["dj", "booking", "matching", "affinité", "ia", "ai", "recommandation dj", "trouver un dj", "book a dj", "marketplace"],
    path: "/owner/book-dj",
    snippet: "Sur la page Booking DJ, le bandeau « Les DJs qui collent à ta soirée » compare l'univers de ta soirée (titre, genres, ambiance, lieu) à celui de chaque DJ (nom de scène, genres, bio, ville) et sort les meilleurs profils avec un pourcentage d'affinité. Sélectionne la soirée concernée dans le menu déroulant. C'est complémentaire au classement du marketplace (qui remonte les profils les mieux tenus) : ici c'est l'affinité musicale qui parle. Le cachet, la dispo et le feeling restent ton jugement.",
  },
  "ai-recommendations": {
    title: "Recommandations personnalisées côté client",
    keywords: ["recommandation", "pour toi", "for you", "personnalisé", "découverte", "explore", "visibilité", "reco", "recherche"],
    path: "/owner/events",
    snippet: "Les clients voient une section « Pour toi » dans Explorer : des soirées recommandées selon leurs achats et favoris. Tes événements y apparaissent automatiquement s'ils sont publics et découvrables — aucune configuration requise. La recherche des clients repêche aussi tes soirées par le SENS de leur requête quand les mots-clés ne donnent rien. Dans les deux cas : plus tes fiches événement sont complètes (titre, genres musicaux, description), mieux elles matchent avec les bons clients.",
  },
};

// ═══════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_venue_stats",
      description: "Get venue KPIs: CA Club, CA Net, orders, tickets, tables. MUST use for any revenue/stats question.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "all"], description: "Time period" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_revenue_breakdown",
      description: "Get detailed revenue breakdown by source. Use for detailed CA questions.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["today", "yesterday", "7d", "30d", "all"], description: "Time period" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_revenue",
      description: "Get revenue (CA Club + CA Net) for a specific event. Use when asking about revenue for a particular event.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_events",
      description: "List events for the venue with filter. MUST use before any event-related action.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["upcoming", "past", "all"], description: "Filter events. Default: upcoming" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_event",
      description: "Get the currently active event (ongoing) or the next upcoming one. Use for 'ma soirée', 'ce soir', 'tonight'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tonight_stats",
      description: "Get live stats for tonight's event: revenue, orders, tickets scanned, pending orders. Use for 'ce soir', 'tonight', 'live'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pending_orders",
      description: "Get orders that are paid but not yet served. Use for 'commandes en attente', 'pending orders'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_ops",
      description: "MUST use for any question about the night currently in progress ('comment se passe ma soirée', 'briefing', 'point de situation', 'que se passe-t-il en ce moment'). Returns the full command-center state: door (entries, pace, VIP no-shows), bar (backlog, oldest waiting order, out-of-stock products), VIP tables (arrived, min-spend at risk), cloakroom, staff on duty, tonight's incidents and active alerts. Complements get_tonight_stats (which is revenue-focused).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_details",
      description: "Get full details of a specific event including ticket stats and revenue.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_ticket_rounds",
      description: "List ticket rounds for a specific event.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_ticket_round",
      description: "Activate or deactivate a ticket round. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          round_id: { type: "string", description: "UUID of the ticket round" },
          activate: { type: "boolean", description: "true to activate, false to deactivate" },
        },
        required: ["round_id", "activate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_drinks",
      description: "List all drinks on the venue menu.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_drink",
      description: "Activate or deactivate a drink. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          drink_id: { type: "string", description: "UUID of the drink" },
          active: { type: "boolean", description: "true to activate, false to deactivate" },
        },
        required: ["drink_id", "active"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_drink_price",
      description: "Update the price of a drink. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          drink_id: { type: "string", description: "UUID of the drink" },
          price: { type: "number", description: "New price in euros" },
          promo_price: { type: "number", description: "Optional promo price" },
        },
        required: ["drink_id", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_post_checkout_upsell",
      description: "Enable or disable the post-purchase drinks upsell page (shown right after a ticket purchase, presale prices). WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_staff_list",
      description: "List all staff members for the venue.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reservations",
      description: "List VIP table reservations for an event.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event (optional, defaults to next event)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_event_ticketing",
      description: "Enable or disable ticketing for an event. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["event_id", "enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_event_tables",
      description: "Enable or disable VIP tables for an event. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["event_id", "enabled"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description: "Update event details. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          title: { type: "string", description: "New title" },
          description: { type: "string", description: "New description" },
          music_genres: { type: "array", items: { type: "string" }, description: "New music genres array (e.g. ['House', 'Techno'])" },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_guest_list",
      description: "Activate or deactivate guest list for an event. WRITE action — requires confirmation.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "UUID of the event" },
          active: { type: "boolean", description: "true to activate, false to deactivate" },
        },
        required: ["event_id", "active"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_onboarding_status",
      description: "Get onboarding progress.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_help_articles",
      description: "Search Yuno documentation. Use ONLY for 'how does X work' questions, NOT for data questions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_insights",
      description: "Get top customers, segments, spending stats. Requires Pro plan.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of top customers (default 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_drinks",
      description: "Get best-selling drinks by order count.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["yesterday", "7d", "30d", "all"], description: "Time period" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_checklist",
      description: "Get personalized pre-party checklist.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_promoter_stats",
      description: "Get promoter performance stats for the venue. Requires Pro plan.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];
// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════

function calcStripeFee(totalEuros: number): number {
  if (totalEuros <= 0) return 0;
  return Math.round((totalEuros * 0.015 + 0.25) * 100) / 100;
}

const WRITE_TOOLS = new Set([
  "activate_ticket_round", "toggle_drink", "update_drink_price", "toggle_post_checkout_upsell",
  "toggle_event_ticketing", "update_event", "toggle_guest_list", "toggle_event_tables",
]);

const TOOL_MIN_PLAN: Record<string, string> = {
  get_customer_insights: "pro",
  get_promoter_stats: "pro",
  list_reservations: "elite",
  toggle_event_tables: "elite",
};

const PLAN_RANK: Record<string, number> = { essential: 0, pro: 1, elite: 2 };

function hasPlanAccess(currentPlan: string, requiredPlan: string): boolean {
  return (PLAN_RANK[currentPlan] || 0) >= (PLAN_RANK[requiredPlan] || 0);
}

function log(type: string, data: Record<string, any>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), type, ...data }));
}

// ═══════════════════════════════════════════
// PERIOD HELPERS
// ═══════════════════════════════════════════

function getPeriodFilter(period: string): string {
  const now = new Date();
  // Use Paris timezone offset for accurate local-time boundaries
  const parisOffset = getParisOffsetMs(now);
  const parisNow = new Date(now.getTime() + parisOffset);

  switch (period) {
    case "today": { const d = new Date(parisNow); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    case "yesterday": { const d = new Date(parisNow); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    case "7d": { const d = new Date(parisNow); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    case "30d": { const d = new Date(parisNow); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0); return new Date(d.getTime() - parisOffset).toISOString(); }
    default: return "2020-01-01T00:00:00Z";
  }
}

function getPeriodEnd(period: string): string | null {
  if (period !== "yesterday") return null;
  const now = new Date();
  const parisOffset = getParisOffsetMs(now);
  const parisNow = new Date(now.getTime() + parisOffset);
  const d = new Date(parisNow); d.setHours(0,0,0,0);
  return new Date(d.getTime() - parisOffset).toISOString();
}

// Get Paris UTC offset in milliseconds (handles DST)
function getParisOffsetMs(date: Date): number {
  // Format a date in Paris timezone and parse it back to get the offset
  const utc = date.getTime();
  const parisStr = date.toLocaleString("en-US", { timeZone: "Europe/Paris" });
  const parisDate = new Date(parisStr);
  return parisDate.getTime() - utc + (date.getTimezoneOffset() * 60000);
}

// ═══════════════════════════════════════════
// REVENUE CALCULATION HELPERS
// ═══════════════════════════════════════════

function calcOrdersRevenue(orders: any[]): { caClub: number; caNet: number } {
  let caClub = 0, caNet = 0;
  for (const o of orders) {
    const total = o.total || 0;
    const sf = o.service_fee || 0;
    // CA Club = what the club earns = total paid by client minus Yuno service fee
    const club = total - sf;
    caClub += club;
    // CA Net = CA Club minus Stripe fee (Stripe charges on the full amount including Yuno fee)
    caNet += club - calcStripeFee(total);
  }
  return { caClub, caNet };
}

function calcTicketsRevenue(tickets: any[]): { caClub: number; caNet: number } {
  let caClub = 0, caNet = 0;
  for (const t of tickets) {
    const tp = t.total_price || 0;
    const sf = t.service_fee || 0;
    const inf = t.insurance_fee || 0;
    const club = tp - sf - inf;
    caClub += club;
    caNet += club - calcStripeFee(tp);
  }
  return { caClub, caNet };
}

function calcTablesRevenue(tables: any[]): { caClub: number; caNet: number } {
  let caClub = 0, caNet = 0;
  for (const t of tables) {
    const tp = t.total_price || 0;
    const sf = t.service_fee || 0;
    const mf = t.management_fee || 0;
    const club = tp - sf - mf;
    caClub += club;
    caNet += club - calcStripeFee(tp);
  }
  return { caClub, caNet };
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ═══════════════════════════════════════════
// TOOL EXECUTORS
// ═══════════════════════════════════════════

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  supabase: any,
  venueId: string
): Promise<string> {
  try {
    switch (toolName) {

      // ─── STATS ───
      case "get_venue_stats": {
        const since = getPeriodFilter(args.period || "30d");
        const periodEnd = getPeriodEnd(args.period || "30d");

        const { data: venueEvents } = await supabase.from("events").select("id").eq("venue_id", venueId);
        const eventIds = (venueEvents || []).map((e: any) => e.id);
        const { data: venueZones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (venueZones || []).map((z: any) => z.id);

        let oq = supabase.from("orders").select("total, service_fee", { count: "exact" }).eq("venue_id", venueId).eq("status", "paid").gte("created_at", since);
        if (periodEnd) oq = oq.lt("created_at", periodEnd);
        const ordersRes = await oq;

        let ticketsData: any[] = [];
        let ticketsCount = 0;
        if (eventIds.length > 0) {
          let tq = supabase.from("tickets").select("total_price, service_fee, insurance_fee", { count: "exact" }).eq("status", "paid").in("event_id", eventIds).gte("created_at", since);
          if (periodEnd) tq = tq.lt("created_at", periodEnd);
          const tr = await tq;
          ticketsData = tr.data || [];
          ticketsCount = tr.count || 0;
        }

        let tablesData: any[] = [];
        let tablesCount = 0;
        if (zoneIds.length > 0) {
          let trq = supabase.from("table_reservations").select("total_price, service_fee, management_fee", { count: "exact" }).eq("status", "paid").in("zone_id", zoneIds).gte("created_at", since);
          if (periodEnd) trq = trq.lt("created_at", periodEnd);
          const tres = await trq;
          tablesData = tres.data || [];
          tablesCount = tres.count || 0;
        }

        const drinksRes = await supabase.from("drinks").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("active", true);

        const ord = calcOrdersRevenue(ordersRes.data || []);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          period: args.period,
          orders: { count: ordersRes.count || 0, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: ticketsCount, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesCount, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          active_drinks: drinksRes.count || 0,
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      case "get_revenue_breakdown": {
        const since = getPeriodFilter(args.period || "30d");
        const periodEnd = getPeriodEnd(args.period || "30d");

        const { data: venueEvts } = await supabase.from("events").select("id").eq("venue_id", venueId);
        const evtIds = (venueEvts || []).map((e: any) => e.id);
        const { data: venueZns } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const znIds = (venueZns || []).map((z: any) => z.id);

        let oq = supabase.from("orders").select("total, service_fee").eq("venue_id", venueId).eq("status", "paid").gte("created_at", since);
        if (periodEnd) oq = oq.lt("created_at", periodEnd);
        const ordersRes = await oq;

        let ticketsData: any[] = [];
        if (evtIds.length > 0) {
          let tq = supabase.from("tickets").select("total_price, service_fee, insurance_fee").eq("status", "paid").in("event_id", evtIds).gte("created_at", since);
          if (periodEnd) tq = tq.lt("created_at", periodEnd);
          ticketsData = (await tq).data || [];
        }

        let tablesData: any[] = [];
        if (znIds.length > 0) {
          let trq = supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("status", "paid").in("zone_id", znIds).gte("created_at", since);
          if (periodEnd) trq = trq.lt("created_at", periodEnd);
          tablesData = (await trq).data || [];
        }

        const ord = calcOrdersRevenue(ordersRes.data || []);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          period: args.period,
          orders: { count: (ordersRes.data || []).length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: ticketsData.length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesData.length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      // ─── EVENTS ───
      case "list_events": {
        const filter = args.filter || "upcoming";
        const now = new Date().toISOString();

        let query = supabase
          .from("events")
          .select("id, title, start_at, end_at, is_active, ticketing_enabled, tables_enabled, music_genres, event_type, ticket_selling_mode")
          .eq("venue_id", venueId);

        if (filter === "upcoming") {
          query = query.gte("end_at", now).order("start_at", { ascending: true });
        } else if (filter === "past") {
          query = query.lt("end_at", now).order("start_at", { ascending: false });
        } else {
          query = query.order("start_at", { ascending: false });
        }
        query = query.limit(20);

        const { data } = await query;

        const enriched = await Promise.all((data || []).map(async (e: any) => {
          const { count } = await supabase.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", e.id).eq("status", "paid");
          let status = "🔜 À venir";
          if (e.end_at < now) status = "✅ Passée";
          else if (e.start_at <= now && e.end_at >= now) status = "🟢 En cours";
          return {
            ...e,
            music_genres: e.music_genres || [],
            tickets_sold: count || 0,
            event_status: status,
          };
        }));

        return JSON.stringify(enriched);
      }

      case "get_active_event": {
        const now = new Date().toISOString();
        const eventSelect = "id, title, start_at, end_at, is_active, ticketing_enabled, tables_enabled, music_genres, event_type, ticket_selling_mode";
        // Try ongoing first
        const { data: ongoing } = await supabase
          .from("events")
          .select(eventSelect)
          .eq("venue_id", venueId)
          .lte("start_at", now)
          .gte("end_at", now)
          .limit(1)
          .maybeSingle();

        if (ongoing) {
          return JSON.stringify({ ...ongoing, music_genres: ongoing.music_genres || [], event_status: "🟢 En cours" });
        }

        // Fallback: next upcoming
        const { data: next } = await supabase
          .from("events")
          .select(eventSelect)
          .eq("venue_id", venueId)
          .gt("start_at", now)
          .order("start_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (next) {
          return JSON.stringify({ ...next, music_genres: next.music_genres || [], event_status: "🔜 À venir" });
        }

        return JSON.stringify({ message: "Aucun événement en cours ou à venir." });
      }

      case "get_tonight_stats": {
        const now = new Date();
        const parisOffset = getParisOffsetMs(now);
        const parisNow = new Date(now.getTime() + parisOffset);

        // Tonight window in Paris time: 18:00 → 06:00
        const tonightStartParis = new Date(parisNow);
        tonightStartParis.setHours(18, 0, 0, 0);
        if (parisNow.getHours() < 6) {
          tonightStartParis.setDate(tonightStartParis.getDate() - 1);
        }
        const tonightEndParis = new Date(tonightStartParis);
        tonightEndParis.setDate(tonightEndParis.getDate() + 1);
        tonightEndParis.setHours(6, 0, 0, 0);

        // Convert back to UTC
        const since = new Date(tonightStartParis.getTime() - parisOffset).toISOString();
        const until = new Date(tonightEndParis.getTime() - parisOffset).toISOString();

        const { data: venueEvents } = await supabase.from("events").select("id").eq("venue_id", venueId);
        const eventIds = (venueEvents || []).map((e: any) => e.id);
        const { data: venueZones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (venueZones || []).map((z: any) => z.id);

        const ordersRes = await supabase.from("orders").select("total, service_fee, status", { count: "exact" }).eq("venue_id", venueId).eq("status", "paid").gte("created_at", since).lt("created_at", until);
        const pendingRes = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("status", "paid").is("served_at", null).gte("created_at", since).lt("created_at", until);

        let ticketsData: any[] = [];
        let ticketsScanned = 0;
        if (eventIds.length > 0) {
          const tr = await supabase.from("tickets").select("total_price, service_fee, insurance_fee, entry_scanned").eq("status", "paid").in("event_id", eventIds).gte("created_at", since).lt("created_at", until);
          ticketsData = tr.data || [];
          ticketsScanned = ticketsData.filter((t: any) => t.entry_scanned).length;
        }

        let tablesData: any[] = [];
        if (zoneIds.length > 0) {
          const tres = await supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("status", "paid").in("zone_id", zoneIds).gte("created_at", since).lt("created_at", until);
          tablesData = tres.data || [];
        }

        const ord = calcOrdersRevenue(ordersRes.data || []);
        const tik = calcTicketsRevenue(ticketsData);
        const tab = calcTablesRevenue(tablesData);

        return JSON.stringify({
          window: { from: since, to: until },
          orders: { count: ordersRes.count || 0, pending: pendingRes.count || 0, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { sold: ticketsData.length, scanned: ticketsScanned, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: tablesData.length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      case "get_pending_orders": {
        const { data, count } = await supabase
          .from("orders")
          .select("id, order_number, total, items, created_at", { count: "exact" })
          .eq("venue_id", venueId)
          .eq("status", "paid")
          .is("served_at", null)
          .order("created_at", { ascending: true })
          .limit(20);

        return JSON.stringify({
          pending_count: count || 0,
          orders: (data || []).map((o: any) => {
            const items = Array.isArray(o.items) ? o.items : [];
            const itemNames = items.map((i: any) => {
              const name = i.name || i.drink_name || "?";
              const qty = i.qty || i.quantity || 1;
              return qty > 1 ? `${name} x${qty}` : name;
            }).join(", ");
            return {
              order_number: o.order_number,
              total: o.total,
              items_summary: itemNames,
              items_count: items.length,
              created_at: o.created_at,
            };
          }),
        });
      }

      case "get_live_ops": {
        // État complet du centre de commandement — même fenêtre de nuit Paris
        // que get_tonight_stats, JSON compact (le modèle n'a pas besoin du
        // détail ligne à ligne).
        const now = new Date();
        const parisOffset = getParisOffsetMs(now);
        const parisNow = new Date(now.getTime() + parisOffset);
        const tonightStartParis = new Date(parisNow);
        tonightStartParis.setHours(18, 0, 0, 0);
        if (parisNow.getHours() < 6) tonightStartParis.setDate(tonightStartParis.getDate() - 1);
        const since = new Date(tonightStartParis.getTime() - parisOffset).toISOString();
        const nowIso = now.toISOString();

        const { data: activeEvt } = await supabase
          .from("events").select("id, title, start_at, end_at")
          .eq("venue_id", venueId).eq("is_active", true)
          .lte("start_at", nowIso).gte("end_at", nowIso)
          .order("start_at").limit(1).maybeSingle();

        const [ordersRes, tablesRes, opsRes, stockRes, alertsRes, cloakRes] = await Promise.all([
          supabase.from("orders")
            .select("id, order_number, status, prep_status, created_at, ready_at, refunded_at")
            .eq("venue_id", venueId).gte("created_at", since),
          activeEvt
            ? supabase.from("table_reservations")
                .select("id, full_name, status, checked_in_at, entry_scanned, minimum_spend")
                .eq("event_id", activeEvt.id).neq("status", "cancelled")
            : Promise.resolve({ data: [] }),
          supabase.from("night_ops_events")
            .select("kind, note, created_at")
            .eq("venue_id", venueId).gte("created_at", since)
            .order("created_at", { ascending: false }).limit(30),
          supabase.from("drinks").select("name").eq("venue_id", venueId).eq("out_of_stock", true),
          supabase.from("staff_notifications")
            .select("notification_type, title, created_at")
            .eq("venue_id", venueId).like("notification_type", "liveops_%")
            .gte("created_at", since).order("created_at", { ascending: false }).limit(10),
          supabase.from("cloakroom_transactions")
            .select("retrieved").eq("venue_id", venueId).gte("created_at", since),
        ]);

        const orders: any[] = ordersRes.data || [];
        const tables: any[] = (tablesRes as any).data || [];
        const backlog = orders.filter((o) => o.status === "paid" && !o.refunded_at && (!o.prep_status || o.prep_status === "queue" || o.prep_status === "preparing"));
        const oldestWaiting = backlog.reduce<string | null>((min, o) => (min === null || o.created_at < min ? o.created_at : min), null);

        let scannedEntries = 0;
        let recentEntries = 0;
        if (activeEvt) {
          const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
          const { data: scans } = await supabase.from("tickets")
            .select("entry_scanned_at").eq("event_id", activeEvt.id)
            .eq("status", "paid").eq("entry_scanned", true);
          scannedEntries = (scans || []).length;
          recentEntries = (scans || []).filter((t: any) => t.entry_scanned_at && t.entry_scanned_at >= tenMinAgo).length;
        }

        let vipSpend: Record<string, number> = {};
        if (tables.length > 0) {
          const { data: cons } = await supabase.from("vip_consumptions")
            .select("table_reservation_id, total_price")
            .eq("venue_id", venueId).gte("served_at", since);
          vipSpend = (cons || []).reduce((acc: Record<string, number>, c: any) => {
            acc[c.table_reservation_id] = (acc[c.table_reservation_id] || 0) + Number(c.total_price || 0);
            return acc;
          }, {});
        }
        const arrivedTables = tables.filter((t) => t.checked_in_at || t.entry_scanned);
        const atRisk = arrivedTables
          .filter((t) => Number(t.minimum_spend || 0) > 0 && (vipSpend[t.id] || 0) < Number(t.minimum_spend) * 0.6)
          .map((t) => ({ name: t.full_name || "VIP", spent: r2(vipSpend[t.id] || 0), minimum: r2(Number(t.minimum_spend)) }));

        const ops: any[] = opsRes.data || [];
        const cloak: any[] = cloakRes.data || [];

        return JSON.stringify({
          active_event: activeEvt ? { title: activeEvt.title, start_at: activeEvt.start_at, end_at: activeEvt.end_at } : null,
          door: {
            entries_scanned: scannedEntries + arrivedTables.length,
            entries_last_10min: recentEntries,
            vip_no_shows: tables.length - arrivedTables.length,
          },
          bar: {
            backlog: backlog.length,
            oldest_waiting_minutes: oldestWaiting ? Math.floor((now.getTime() - new Date(oldestWaiting).getTime()) / 60_000) : null,
            out_of_stock: (stockRes.data || []).map((d: any) => d.name),
          },
          vip: {
            tables_total: tables.length,
            tables_arrived: arrivedTables.length,
            min_spend_at_risk: atRisk.slice(0, 5),
          },
          cloakroom: { active: cloak.filter((c) => !c.retrieved).length, retrieved: cloak.filter((c) => c.retrieved).length },
          staff_shift_starts: ops.filter((e) => e.kind === "shift_start").map((e) => e.note).filter(Boolean),
          incidents: ops.filter((e) => e.kind !== "shift_start").map((e) => ({ kind: e.kind, at: e.created_at })),
          alerts_tonight: (alertsRes.data || []).map((a: any) => ({ type: a.notification_type, title: a.title, at: a.created_at })),
        });
      }

      // ─── TICKET ROUNDS ───
      case "list_ticket_rounds": {
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { data } = await supabase.from("ticket_rounds").select("id, name, price, max_tickets, tickets_sold, is_active, position").eq("event_id", args.event_id).order("position");
        return JSON.stringify(data || []);
      }

      case "activate_ticket_round": {
        const { data: round } = await supabase.from("ticket_rounds").select("id, event_id").eq("id", args.round_id).maybeSingle();
        if (!round) return JSON.stringify({ error: "Round not found" });
        const { data: evt } = await supabase.from("events").select("id").eq("id", round.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { error } = await supabase.from("ticket_rounds").update({ is_active: args.activate }).eq("id", args.round_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, round_id: args.round_id, is_active: args.activate });
      }

      // ─── DRINKS ───
      case "list_drinks": {
        const { data } = await supabase.from("drinks").select("id, name, price, promo_price, active, collection, presale_active, presale_price").eq("venue_id", venueId).order("collection").order("name");
        return JSON.stringify(data || []);
      }

      case "toggle_drink": {
        const { data: drink } = await supabase.from("drinks").select("id, name").eq("id", args.drink_id).eq("venue_id", venueId).maybeSingle();
        if (!drink) return JSON.stringify({ error: "Drink not found for this venue" });
        const { error } = await supabase.from("drinks").update({ active: args.active }).eq("id", args.drink_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, drink: drink.name, active: args.active });
      }

      case "update_drink_price": {
        const { data: drink } = await supabase.from("drinks").select("id, name, price").eq("id", args.drink_id).eq("venue_id", venueId).maybeSingle();
        if (!drink) return JSON.stringify({ error: "Drink not found for this venue" });
        const updates: any = { price: args.price };
        if (args.promo_price !== undefined) updates.promo_price = args.promo_price;
        const { error } = await supabase.from("drinks").update(updates).eq("id", args.drink_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, drink: drink.name, old_price: drink.price, new_price: args.price });
      }

      case "toggle_post_checkout_upsell": {
        // Page upsell boissons post-achat billet (voir docs/SYSTEME_VENTE_BOISSONS.md).
        const { error } = await supabase.from("venues").update({ post_checkout_upsell_enabled: args.enabled === true }).eq("id", venueId);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, post_checkout_upsell_enabled: args.enabled === true });
      }

      // ─── STAFF ───
      case "get_staff_list": {
        const { data } = await supabase.from("profiles").select("id, first_name, last_name, email").eq("venue_id", venueId);
        if (!data || data.length === 0) return JSON.stringify([]);
        const userIds = data.map((p: any) => p.id);
        const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("user_id", userIds).in("role", ["barman", "bouncer", "vip_host", "cloakroom", "manager"]);
        const staffWithRoles = data.map((p: any) => ({ ...p, roles: (roles || []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role) })).filter((p: any) => p.roles.length > 0);
        return JSON.stringify(staffWithRoles);
      }

      // ─── RESERVATIONS ───
      case "list_reservations": {
        let eventId = args.event_id;
        if (!eventId) {
          const { data: nextEvt } = await supabase.from("events").select("id").eq("venue_id", venueId).gte("start_at", new Date().toISOString()).order("start_at").limit(1).maybeSingle();
          eventId = nextEvt?.id;
        }
        if (!eventId) return JSON.stringify({ message: "No upcoming event found" });
        const { data: zones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        if (!zones || zones.length === 0) return JSON.stringify([]);
        const zoneIds = zones.map((z: any) => z.id);
        const { data } = await supabase.from("table_reservations").select("id, full_name, status, total_price, zone_id, created_at").in("zone_id", zoneIds).eq("event_id", eventId).order("created_at", { ascending: false });
        return JSON.stringify(data || []);
      }

      // ─── EVENT DETAILS (with revenue) ───
      case "get_event_details": {
        const { data: evt } = await supabase.from("events").select("*").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found" });

        // Fetch ticket rounds, tickets data, orders, and table zones in parallel
        const { data: zones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (zones || []).map((z: any) => z.id);

        const [roundsRes, ticketsDataRes, ordersDataRes, tablesDataRes] = await Promise.all([
          supabase.from("ticket_rounds").select("id, name, price, max_tickets, tickets_sold, is_active").eq("event_id", args.event_id).order("position"),
          supabase.from("tickets").select("total_price, service_fee, insurance_fee", { count: "exact" }).eq("event_id", args.event_id).eq("status", "paid"),
          supabase.from("orders").select("total, service_fee").eq("event_id", args.event_id).eq("venue_id", venueId).eq("status", "paid"),
          zoneIds.length > 0
            ? supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("event_id", args.event_id).eq("status", "paid").in("zone_id", zoneIds)
            : Promise.resolve({ data: [] }),
        ]);

        const tik = calcTicketsRevenue(ticketsDataRes.data || []);
        const ord = calcOrdersRevenue(ordersDataRes.data || []);
        const tab = calcTablesRevenue(tablesDataRes.data || []);

        const now = new Date().toISOString();
        let status = "🔜 À venir";
        if (evt.end_at < now) status = "✅ Passée";
        else if (evt.start_at <= now && evt.end_at >= now) status = "🟢 En cours";

        return JSON.stringify({
          event: {
            id: evt.id, title: evt.title, start_at: evt.start_at, end_at: evt.end_at,
            is_active: evt.is_active, ticketing_enabled: evt.ticketing_enabled,
            tables_enabled: evt.tables_enabled, music_genres: evt.music_genres || [],
            event_type: evt.event_type, description: evt.description,
            ticket_selling_mode: evt.ticket_selling_mode, event_status: status,
          },
          ticket_rounds: roundsRes.data || [],
          tickets_sold: ticketsDataRes.count || 0,
          revenue: {
            orders: { count: (ordersDataRes.data || []).length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
            tickets: { count: (ticketsDataRes.data || []).length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
            tables: { count: (tablesDataRes.data || []).length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
            total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
            total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
          },
        });
      }

      // ─── EVENT REVENUE (standalone) ───
      case "get_event_revenue": {
        const { data: evt } = await supabase.from("events").select("id, title").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });

        const { data: zones } = await supabase.from("table_zones").select("id").eq("venue_id", venueId);
        const zoneIds = (zones || []).map((z: any) => z.id);

        const [ticketsDataRes, ordersDataRes, tablesDataRes] = await Promise.all([
          supabase.from("tickets").select("total_price, service_fee, insurance_fee").eq("event_id", args.event_id).eq("status", "paid"),
          supabase.from("orders").select("total, service_fee").eq("event_id", args.event_id).eq("venue_id", venueId).eq("status", "paid"),
          zoneIds.length > 0
            ? supabase.from("table_reservations").select("total_price, service_fee, management_fee").eq("event_id", args.event_id).eq("status", "paid").in("zone_id", zoneIds)
            : Promise.resolve({ data: [] }),
        ]);

        const tik = calcTicketsRevenue(ticketsDataRes.data || []);
        const ord = calcOrdersRevenue(ordersDataRes.data || []);
        const tab = calcTablesRevenue(tablesDataRes.data || []);

        return JSON.stringify({
          event_id: args.event_id,
          event_title: evt.title,
          orders: { count: (ordersDataRes.data || []).length, ca_club: r2(ord.caClub), ca_net: r2(ord.caNet) },
          tickets: { count: (ticketsDataRes.data || []).length, ca_club: r2(tik.caClub), ca_net: r2(tik.caNet) },
          tables: { count: (tablesDataRes.data || []).length, ca_club: r2(tab.caClub), ca_net: r2(tab.caNet) },
          total_ca_club: r2(ord.caClub + tik.caClub + tab.caClub),
          total_ca_net: r2(ord.caNet + tik.caNet + tab.caNet),
        });
      }

      // ─── EVENT WRITE ACTIONS ───
      case "toggle_event_ticketing": {
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { error } = await supabase.from("events").update({ ticketing_enabled: args.enabled }).eq("id", args.event_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, ticketing_enabled: args.enabled });
      }

      case "toggle_event_tables": {
        const { data: evt } = await supabase.from("events").select("id, title").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const { error } = await supabase.from("events").update({ tables_enabled: args.enabled }).eq("id", args.event_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, event_title: evt.title, tables_enabled: args.enabled });
      }

      case "update_event": {
        const { data: evt } = await supabase.from("events").select("id, title").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        const updates: any = {};
        if (args.title) updates.title = args.title;
        if (args.description !== undefined) updates.description = args.description;
        if (args.music_genres && Array.isArray(args.music_genres)) {
          updates.music_genres = args.music_genres;
          // Rétrocompat: also write old field
          updates.music_genre = args.music_genres.join(", ");
        }
        if (Object.keys(updates).length === 0) return JSON.stringify({ error: "No fields to update" });
        const { error } = await supabase.from("events").update(updates).eq("id", args.event_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, updated_fields: Object.keys(updates) });
      }

      case "toggle_guest_list": {
        const { data: evt } = await supabase.from("events").select("id").eq("id", args.event_id).eq("venue_id", venueId).maybeSingle();
        if (!evt) return JSON.stringify({ error: "Event not found for this venue" });
        // dj_id IS NULL = the host's own list (DJ-scoped lists are separate rows now).
        const { data: gl } = await supabase.from("guest_lists").select("id").eq("event_id", args.event_id).is("dj_id", null).maybeSingle();
        if (!gl) return JSON.stringify({ error: "No guest list configured for this event." });
        const { error } = await supabase.from("guest_lists").update({ is_active: args.active }).eq("id", gl.id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, event_id: args.event_id, guest_list_active: args.active });
      }

      // ─── ONBOARDING ───
      case "get_onboarding_status": {
        const { data } = await supabase.from("venue_onboarding").select("current_step, completed_steps").eq("venue_id", venueId).maybeSingle();
        const { data: venue } = await supabase.from("venues").select("stripe_account_id, name").eq("id", venueId).maybeSingle();
        return JSON.stringify({
          current_step: data?.current_step || "not_started",
          completed_steps: data?.completed_steps || [],
          stripe_connected: !!venue?.stripe_account_id,
          venue_name: venue?.name,
        });
      }

      // ─── HELP ───
      case "search_help_articles": {
        const query = (args.query || "").toLowerCase();
        const tokens = query.split(/\s+/).filter(Boolean);

        const scored = Object.entries(HELP_ARTICLES).map(([id, article]) => {
          let score = 0;
          for (const token of tokens) {
            if (article.title.toLowerCase().includes(token)) score += 10;
            if (article.keywords.some(k => k.toLowerCase().includes(token))) score += 5;
          }
          return { id, ...article, score };
        }).filter(a => a.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

        if (scored.length === 0) {
          return JSON.stringify({ message: "Aucun article trouvé. L'owner peut consulter le [Mode d'emploi](/owner/help)." });
        }

        return JSON.stringify({
          results: scored.map(a => ({
            title: a.title,
            path: a.path,
            snippet: a.snippet,
          })),
        });
      }

      // ─── CUSTOMER INSIGHTS ───
      case "get_customer_insights": {
        const limit = args.limit || 10;
        const [topCustomers, totalCustomers] = await Promise.all([
          supabase.from("venue_customers").select("id, first_name, last_name, email, total_spent, order_count, ticket_count, table_count, last_visit_at").eq("venue_id", venueId).order("total_spent", { ascending: false }).limit(limit),
          supabase.from("venue_customers").select("total_spent").eq("venue_id", venueId),
        ]);
        const customers = totalCustomers.data || [];
        const totalSpent = customers.reduce((s: number, c: any) => s + (c.total_spent || 0), 0);
        const avgSpent = customers.length > 0 ? totalSpent / customers.length : 0;
        const segments = {
          platinum: customers.filter((c: any) => (c.total_spent || 0) >= 1000).length,
          gold: customers.filter((c: any) => (c.total_spent || 0) >= 500 && (c.total_spent || 0) < 1000).length,
          silver: customers.filter((c: any) => (c.total_spent || 0) >= 200 && (c.total_spent || 0) < 500).length,
          bronze: customers.filter((c: any) => (c.total_spent || 0) < 200).length,
        };
        return JSON.stringify({
          total_customers: customers.length,
          total_revenue: r2(totalSpent),
          average_spend: r2(avgSpent),
          segments,
          top_customers: (topCustomers.data || []).map((c: any) => ({
            name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email,
            total_spent: c.total_spent,
            orders: c.order_count,
            tickets: c.ticket_count,
            tables: c.table_count,
          })),
        });
      }

      // ─── TOP DRINKS ───
      case "get_top_drinks": {
        const since = getPeriodFilter(args.period || "30d");
        const { data: orders } = await supabase.from("orders").select("items").eq("venue_id", venueId).eq("status", "paid").gte("created_at", since);
        if (!orders || orders.length === 0) return JSON.stringify({ message: "Aucune commande pour cette période", top_drinks: [] });
        const drinkSales: Record<string, { name: string; qty: number; revenue: number }> = {};
        for (const order of orders) {
          const items = order.items as any[];
          if (!items) continue;
          for (const item of items) {
            const name = item.name || item.drink_name || "Unknown";
            const qty = item.qty || item.quantity || 1;
            const price = item.price || item.unit_price || 0;
            if (!drinkSales[name]) drinkSales[name] = { name, qty: 0, revenue: 0 };
            drinkSales[name].qty += qty;
            drinkSales[name].revenue += qty * price;
          }
        }
        const sorted = Object.values(drinkSales).sort((a, b) => b.qty - a.qty).slice(0, 10);
        return JSON.stringify({ period: args.period, top_drinks: sorted });
      }

      // ─── CHECKLIST ───
      case "get_checklist": {
        const [eventsRes, drinksRes, staffRes, venueRes] = await Promise.all([
          supabase.from("events").select("id, title, start_at, ticketing_enabled, tables_enabled, ticket_selling_mode").eq("venue_id", venueId).gte("start_at", new Date().toISOString()).order("start_at").limit(1).maybeSingle(),
          supabase.from("drinks").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("active", true),
          supabase.from("profiles").select("id", { count: "exact", head: true }).eq("venue_id", venueId),
          supabase.from("venues").select("stripe_account_id").eq("id", venueId).maybeSingle(),
        ]);
        const checklist: { item: string; status: string; detail: string }[] = [];
        checklist.push(venueRes.data?.stripe_account_id ? { item: "Stripe Connect", status: "ok", detail: "Connecté ✅" } : { item: "Stripe Connect", status: "missing", detail: "Non connecté — impossible de vendre !" });
        if (eventsRes.data) {
          checklist.push({ item: "Prochain event", status: "ok", detail: `${eventsRes.data.title} le ${eventsRes.data.start_at}` });
          const modeLabel = eventsRes.data.ticket_selling_mode === "rounds" ? "Rounds" : eventsRes.data.ticket_selling_mode === "timed_entry" ? "Créneaux horaires" : "Simple";
          checklist.push(eventsRes.data.ticketing_enabled ? { item: "Billetterie", status: "ok", detail: `Activée (mode ${modeLabel})` } : { item: "Billetterie", status: "warning", detail: "Désactivée" });
        } else {
          checklist.push({ item: "Prochain event", status: "missing", detail: "Aucun événement à venir" });
        }
        const dc = drinksRes.count || 0;
        checklist.push(dc === 0 ? { item: "Menu", status: "missing", detail: "Aucune boisson active" } : dc < 5 ? { item: "Menu", status: "warning", detail: `${dc} boissons actives — ajoute-en plus` } : { item: "Menu", status: "ok", detail: `${dc} boissons actives` });
        const sc = staffRes.count || 0;
        checklist.push(sc === 0 ? { item: "Staff", status: "missing", detail: "Aucun employé" } : { item: "Staff", status: "ok", detail: `${sc} membres` });
        return JSON.stringify({ checklist });
      }

      // ─── PROMOTER STATS ───
      case "get_promoter_stats": {
        const { data: promoters } = await supabase
          .from("promoters")
          .select("id, first_name, last_name, pending_amount, total_paid, total_conversions, is_active")
          .eq("venue_id", venueId)
          .order("total_conversions", { ascending: false });

        if (!promoters || promoters.length === 0) {
          return JSON.stringify({ message: "Aucun promoteur configuré pour ce club.", promoters: [] });
        }

        return JSON.stringify({
          total_promoters: promoters.length,
          active: promoters.filter((p: any) => p.is_active).length,
          promoters: promoters.map((p: any) => ({
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            conversions: p.total_conversions || 0,
            pending: r2(p.pending_amount || 0),
            total_paid: r2(p.total_paid || 0),
            active: p.is_active,
          })),
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    log("tool_error", { tool: toolName, error: String(err) });
    return JSON.stringify({ error: `Failed to execute ${toolName}` });
  }
}

// ═══════════════════════════════════════════
// GÉNÉRATION DE CONTENU MARKETING (action hors chat)
// ═══════════════════════════════════════════

const CHANNEL_RULES: Record<string, string> = {
  push: "Notification push mobile. title : max 40 caractères, percutant. body : max 120 caractères, une seule idée, max 1 emoji. preheader : chaîne vide.",
  sms: "SMS. body : max 160 caractères TOUT COMPRIS, un seul call-to-action, pas d'emoji superflu. title et preheader : chaînes vides.",
  email: "Email. title = objet (max 60 caractères). preheader : max 90 caractères, complète l'objet sans le répéter. body : 2 paragraphes courts séparés par une ligne vide, un call-to-action clair.",
};

const CHANNEL_LIMITS: Record<string, { title: number; preheader: number; body: number }> = {
  push: { title: 40, preheader: 0, body: 120 },
  sms: { title: 0, preheader: 0, body: 160 },
  email: { title: 60, preheader: 90, body: 2000 },
};

const CONTENT_LANG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "preheader", "body"],
  properties: {
    title: { type: "string" },
    preheader: { type: "string" },
    body: { type: "string" },
  },
};

const CONTENT_SCHEMA = {
  name: "marketing_variants",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["variants"],
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["en", "fr", "es"],
          properties: {
            en: CONTENT_LANG_SCHEMA,
            fr: CONTENT_LANG_SCHEMA,
            es: CONTENT_LANG_SCHEMA,
          },
        },
      },
    },
  },
};

async function handleGenerateContent(
  body: Record<string, any>,
  ctx: { supabase: any; venueId: string; userId: string },
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const { supabase, venueId, userId } = ctx;

  const channel = String(body.channel || "");
  if (!CHANNEL_RULES[channel]) {
    return new Response(JSON.stringify({ error: "Invalid channel" }), { status: 400, headers: jsonHeaders });
  }
  const eventId = typeof body.eventId === "string" ? body.eventId : null;
  const segment = typeof body.segment === "string" ? body.segment.substring(0, 100) : null;
  const tone = typeof body.tone === "string" ? body.tone.substring(0, 50) : null;
  const customInstructions = typeof body.customInstructions === "string" ? body.customInstructions.substring(0, 500) : null;

  // Contexte 100 % requêté côté serveur (anti-injection) : le client ne
  // fournit que des identifiants et des préférences, jamais les données.
  const { data: venue } = await supabase.from("venues").select("name").eq("id", venueId).maybeSingle();
  const contextLines: string[] = [`- Club : ${venue?.name || "inconnu"}`];

  if (eventId) {
    const { data: evt } = await supabase
      .from("events")
      .select("id, title, start_at, music_genres, max_tickets")
      .eq("id", eventId)
      .eq("venue_id", venueId)
      .maybeSingle();
    if (!evt) {
      return new Response(JSON.stringify({ error: "Event not found for this venue" }), { status: 404, headers: jsonHeaders });
    }
    contextLines.push(`- Événement : ${evt.title} — ${evt.start_at}`);
    if (Array.isArray(evt.music_genres) && evt.music_genres.length) {
      contextLines.push(`- Genres musicaux : ${evt.music_genres.join(", ")}`);
    }
    const { data: rounds } = await supabase
      .from("ticket_rounds")
      .select("name, price, tickets_sold, max_tickets, is_active")
      .eq("event_id", eventId)
      .order("position");
    const activeRound = (rounds || []).find((r: any) => r.is_active);
    if (activeRound) {
      contextLines.push(`- Prix billet actuel : ${activeRound.price}€ (round « ${activeRound.name} »)`);
    }
    const sold = (rounds || []).reduce((s: number, r: any) => s + (r.tickets_sold || 0), 0);
    const cap = evt.max_tickets || (rounds || []).reduce((s: number, r: any) => s + (r.max_tickets || 0), 0);
    if (cap > 0) contextLines.push(`- Remplissage : ${sold}/${cap} billets vendus`);
  }
  if (segment) contextLines.push(`- Audience ciblée : ${segment}`);

  const systemPrompt = `Tu es le copywriter marketing d'un club de nuit sur Yuno.
Génère EXACTEMENT 3 variantes distinctes de contenu marketing pour le canal demandé.
Chaque variante existe en anglais (en), français (fr) et espagnol (es) : mêmes idées, adaptées idiomatiquement — jamais de traduction mot à mot.
Règles du canal : ${CHANNEL_RULES[channel]}
CONTRAINTE ABSOLUE : le contexte ci-dessous est ta SEULE source de vérité. N'invente aucun prix, aucune date, aucun chiffre, aucune offre qui n'y figure pas.`;

  const userPrompt = `Contexte réel :
${contextLines.join("\n")}
${tone ? `Ton demandé : ${tone}` : "Ton : engageant, direct."}
${customInstructions ? `Instructions de l'owner (à respecter si compatibles avec les règles du canal) : ${customInstructions}` : ""}`;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CONTENT_MODEL,
      reasoning_effort: "minimal",
      max_completion_tokens: 3000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_schema", json_schema: CONTENT_SCHEMA },
    }),
  });

  if (!aiResponse.ok) {
    if (aiResponse.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: jsonHeaders });
    }
    const t = await aiResponse.text();
    log("content_ai_error", { status: aiResponse.status, body: t.substring(0, 200) });
    throw new Error("AI gateway error");
  }

  const aiData = await aiResponse.json();
  let parsed: any = null;
  try { parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "{}"); } catch { /* empty */ }
  const limits = CHANNEL_LIMITS[channel];
  const variants = (parsed?.variants || []).slice(0, 3).map((v: any) => {
    const clamp = (l: any) => ({
      title: String(l?.title || "").substring(0, limits.title),
      preheader: String(l?.preheader || "").substring(0, limits.preheader),
      body: String(l?.body || "").substring(0, limits.body),
    });
    return { en: clamp(v?.en), fr: clamp(v?.fr), es: clamp(v?.es) };
  });

  if (!variants.length) {
    log("content_empty", { channel });
    return new Response(JSON.stringify({ error: "Generation failed" }), { status: 502, headers: jsonHeaders });
  }

  try {
    await supabase.from("owner_ai_audit_log").insert({
      user_id: userId,
      venue_id: venueId,
      tool_name: "generate_marketing_content",
      tool_args: { channel, event_id: eventId, segment, tone },
      result: JSON.stringify(variants).substring(0, 1000),
    });
  } catch { /* ignore */ }

  log("content_generated", { channel, variants: variants.length });
  return new Response(JSON.stringify({ variants }), { headers: jsonHeaders });
}

// ═══════════════════════════════════════════
// NIGHT REPORT NARRATIF (action hors chat)
// ═══════════════════════════════════════════

const REPORT_SCHEMA = {
  name: "night_report",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "insights", "actions"],
    properties: {
      headline: { type: "string" },
      insights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "metric", "sentiment"],
          properties: {
            text: { type: "string" },
            metric: { type: "string" },
            sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          },
        },
      },
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "category"],
          properties: {
            text: { type: "string" },
            category: { type: "string", enum: ["marketing", "pricing", "operations", "experience"] },
          },
        },
      },
    },
  },
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function handleGenerateNightReport(
  body: Record<string, any>,
  ctx: { supabase: any; venueId: string; userId: string },
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const { supabase, venueId, userId } = ctx;

  const eventId = typeof body.eventId === "string" ? body.eventId : null;
  const language = ["en", "fr", "es"].includes(body.language) ? body.language : "en";
  const stats = body.stats;
  if (!eventId || !stats || typeof stats !== "object") {
    return new Response(JSON.stringify({ error: "Missing eventId or stats" }), { status: 400, headers: jsonHeaders });
  }
  const statsJson = JSON.stringify(stats);
  if (statsJson.length > 20_000) {
    return new Response(JSON.stringify({ error: "Stats payload too large" }), { status: 400, headers: jsonHeaders });
  }

  // Garde-fou : l'event doit appartenir au venue de l'owner.
  const { data: evt } = await supabase
    .from("events")
    .select("id, title, start_at")
    .eq("id", eventId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (!evt) {
    return new Response(JSON.stringify({ error: "Event not found for this venue" }), { status: 404, headers: jsonHeaders });
  }

  // Cache : un rapport par event × langue, invalidé quand les stats changent.
  const statsHash = await sha256Hex(statsJson);
  const { data: cached } = await supabase
    .from("event_ai_reports")
    .select("report, stats_hash")
    .eq("event_id", eventId)
    .eq("language", language)
    .maybeSingle();
  if (cached && cached.stats_hash === statsHash) {
    return new Response(JSON.stringify({ report: cached.report, cached: true }), { headers: jsonHeaders });
  }

  const langName = language === "fr" ? "français" : language === "es" ? "espagnol" : "anglais";
  const systemPrompt = `Tu es l'analyste nightlife d'un club sur Yuno. On te donne les statistiques calculées d'une soirée passée (JSON).
Produis, en ${langName} :
- headline : une phrase-verdict de la soirée (concrète, avec le chiffre le plus marquant).
- insights : EXACTEMENT 5 enseignements. Chacun cite sa métrique source (champ metric = nom du champ JSON utilisé) et un sentiment (positive/neutral/negative). Compare aux moyennes du club quand les deltas existent (champs *ChangePct).
- actions : EXACTEMENT 3 actions concrètes pour la prochaine soirée, chacune classée (marketing/pricing/operations/experience).
RÈGLES ABSOLUES : n'utilise QUE les chiffres présents dans le JSON — n'invente rien, ne recalcule pas. Si les données sont maigres (peu de billets, pas de scans : hasScanData=false, volumes faibles), dis-le honnêtement dans les insights plutôt que d'inventer des tendances. Tutoie l'owner, sois direct et utile, pas de flatterie.`;

  const userPrompt = `Soirée : ${evt.title} (${evt.start_at})\nStatistiques :\n${statsJson}`;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REPORT_MODEL,
      reasoning_effort: "medium",
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_schema", json_schema: REPORT_SCHEMA },
    }),
  });

  if (!aiResponse.ok) {
    if (aiResponse.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: jsonHeaders });
    }
    const t = await aiResponse.text();
    log("report_ai_error", { status: aiResponse.status, body: t.substring(0, 200) });
    throw new Error("AI gateway error");
  }

  const aiData = await aiResponse.json();
  let report: any = null;
  try { report = JSON.parse(aiData.choices?.[0]?.message?.content || "null"); } catch { /* empty */ }
  if (!report?.headline || !Array.isArray(report?.insights) || !Array.isArray(report?.actions)) {
    log("report_empty", { event_id: eventId });
    return new Response(JSON.stringify({ error: "Generation failed" }), { status: 502, headers: jsonHeaders });
  }
  report.insights = report.insights.slice(0, 5);
  report.actions = report.actions.slice(0, 3);

  try {
    await supabase.from("event_ai_reports").upsert({
      event_id: eventId,
      venue_id: venueId,
      language,
      report,
      model: REPORT_MODEL,
      stats_hash: statsHash,
      created_at: new Date().toISOString(),
    }, { onConflict: "event_id,language" });
  } catch { /* ignore */ }

  try {
    await supabase.from("owner_ai_audit_log").insert({
      user_id: userId,
      venue_id: venueId,
      tool_name: "generate_night_report",
      tool_args: { event_id: eventId, language },
      result: JSON.stringify(report).substring(0, 1000),
    });
  } catch { /* ignore */ }

  log("report_generated", { event_id: eventId, language });
  return new Response(JSON.stringify({ report, cached: false }), { headers: jsonHeaders });
}

// ═══════════════════════════════════════════
// NEXT-BEST-ACTION QUOTIDIEN (action hors chat)
// ═══════════════════════════════════════════

// Chemins autorisés dans les actions — enum strict pour empêcher tout lien
// halluciné. Miroir de la navigation du dashboard owner.
const ACTION_PATHS = [
  "/owner/push", "/owner/campaigns", "/owner/sms-campaigns", "/owner/ticketing",
  "/owner/scarcity", "/owner/tables", "/owner/customers", "/owner/events",
  "/owner/hype", "/owner/menu", "/owner/loyalty", "/owner/promoters",
  "/owner/analytics", "/owner/upsell",
] as const;

const NBA_SCHEMA = {
  name: "next_best_actions",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["actions"],
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "why", "category", "path"],
          properties: {
            title: { type: "string" },
            why: { type: "string" },
            category: { type: "string", enum: ["marketing", "pricing", "operations", "experience"] },
            path: { type: "string", enum: [...ACTION_PATHS] },
          },
        },
      },
    },
  },
};

async function handleNextBestActions(
  body: Record<string, any>,
  ctx: { supabase: any; venueId: string; userId: string },
): Promise<Response> {
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  const { supabase, venueId, userId } = ctx;
  const language = ["en", "fr", "es"].includes(body.language) ? body.language : "en";
  const today = new Date().toISOString().slice(0, 10);

  // Cache : une génération par venue × jour × langue.
  const { data: cached } = await supabase
    .from("venue_ai_actions")
    .select("actions")
    .eq("venue_id", venueId)
    .eq("day", today)
    .eq("language", language)
    .maybeSingle();
  if (cached) {
    return new Response(JSON.stringify({ actions: cached.actions, cached: true }), { headers: jsonHeaders });
  }

  // ── État réel du club, requêté côté serveur ──
  const now = new Date();
  const in14d = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString();
  const [venueRes, eventsRes, lastPushRes, lastEmailRes, customersRes, automationsRes] = await Promise.all([
    supabase.from("venues").select("name").eq("id", venueId).maybeSingle(),
    supabase.from("events")
      .select("id, title, start_at, max_tickets, ticketing_enabled, tables_enabled")
      .eq("venue_id", venueId).eq("is_active", true)
      .gte("start_at", now.toISOString()).lte("start_at", in14d)
      .order("start_at").limit(6),
    supabase.from("push_campaigns").select("created_at").eq("venue_id", venueId)
      .eq("source", "manual").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("email_campaigns").select("created_at").eq("venue_id", venueId)
      .eq("status", "sent").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("venue_customers").select("last_visit_at").eq("venue_id", venueId).eq("is_banned", false).limit(2000),
    supabase.from("venue_push_automations").select("automation_key, enabled").eq("venue_id", venueId),
  ]);

  const lines: string[] = [`Club : ${venueRes.data?.name || "inconnu"} — date : ${today}`];

  const events = eventsRes.data || [];
  if (events.length === 0) {
    lines.push("Aucune soirée programmée dans les 14 prochains jours.");
  } else {
    for (const evt of events) {
      const { data: rounds } = await supabase
        .from("ticket_rounds")
        .select("price, tickets_sold, max_tickets, is_active")
        .eq("event_id", evt.id);
      const sold = (rounds || []).reduce((s: number, r: any) => s + (r.tickets_sold || 0), 0);
      const cap = evt.max_tickets || (rounds || []).reduce((s: number, r: any) => s + (r.max_tickets || 0), 0);
      const daysOut = Math.max(0, Math.round((new Date(evt.start_at).getTime() - now.getTime()) / 86400000));
      const fill = cap > 0 ? Math.round((sold / cap) * 100) : null;
      lines.push(`Soirée « ${evt.title} » dans ${daysOut} j : ${sold} billets vendus${cap ? ` / ${cap} (${fill}%)` : ""}${evt.ticketing_enabled ? "" : " — billetterie DÉSACTIVÉE"}${evt.tables_enabled ? "" : " — tables désactivées"}.`);
    }
  }

  const daysSince = (iso: string | null | undefined) =>
    iso ? Math.round((now.getTime() - new Date(iso).getTime()) / 86400000) : null;
  const dPush = daysSince(lastPushRes.data?.created_at);
  const dEmail = daysSince(lastEmailRes.data?.created_at);
  lines.push(`Dernier push manuel : ${dPush === null ? "jamais" : `il y a ${dPush} j`}. Dernière campagne email : ${dEmail === null ? "jamais" : `il y a ${dEmail} j`}.`);

  const customers = customersRes.data || [];
  if (customers.length > 0) {
    const bucket = (lo: number, hi: number | null) => customers.filter((c: any) => {
      const d = daysSince(c.last_visit_at);
      return d !== null && d >= lo && (hi === null || d < hi);
    }).length;
    lines.push(`Base clients : ${customers.length} — actifs <30 j : ${bucket(0, 30)}, à risque 30-90 j : ${bucket(30, 90)}, perdus >90 j : ${bucket(90, null)}.`);
  } else {
    lines.push("Base clients vide pour l'instant.");
  }

  const autos = automationsRes.data || [];
  const autosOn = autos.filter((a: any) => a.enabled).length;
  lines.push(`Notifications automatiques : ${autosOn}/4 activées.`);

  const systemPrompt = `Tu es le conseiller opérationnel quotidien d'un club sur Yuno. On te donne l'état réel du club ce matin.
Propose EXACTEMENT 3 actions concrètes et priorisées à faire AUJOURD'HUI, la plus impactante d'abord, en ${language === "fr" ? "français" : language === "es" ? "espagnol" : "anglais"}.
Pour chaque action : title = l'action en une phrase impérative courte ; why = la raison chiffrée tirée des données (1 phrase) ; category ; path = la page du dashboard où la faire (choisis dans la liste imposée).
RÈGLES : n'utilise QUE les chiffres fournis, n'invente rien. Si tout va bien, propose des actions d'optimisation (fidélité, upsell, analyse) plutôt que d'alarmer. Tutoie l'owner, direct, zéro flatterie.`;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ACTIONS_MODEL,
      reasoning_effort: "low",
      max_completion_tokens: 2500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: lines.join("\n") },
      ],
      response_format: { type: "json_schema", json_schema: NBA_SCHEMA },
    }),
  });

  if (!aiResponse.ok) {
    if (aiResponse.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: jsonHeaders });
    }
    const t = await aiResponse.text();
    log("nba_ai_error", { status: aiResponse.status, body: t.substring(0, 200) });
    throw new Error("AI gateway error");
  }

  const aiData = await aiResponse.json();
  let parsed: any = null;
  try { parsed = JSON.parse(aiData.choices?.[0]?.message?.content || "null"); } catch { /* empty */ }
  const actions = (parsed?.actions || []).slice(0, 3)
    .filter((a: any) => ACTION_PATHS.includes(a?.path));
  if (!actions.length) {
    log("nba_empty", { venue_id: venueId });
    return new Response(JSON.stringify({ error: "Generation failed" }), { status: 502, headers: jsonHeaders });
  }

  try {
    await supabase.from("venue_ai_actions").upsert({
      venue_id: venueId,
      day: today,
      language,
      actions,
      model: ACTIONS_MODEL,
    }, { onConflict: "venue_id,day,language" });
  } catch { /* ignore */ }

  try {
    await supabase.from("owner_ai_audit_log").insert({
      user_id: userId,
      venue_id: venueId,
      tool_name: "generate_next_best_actions",
      tool_args: { language, day: today },
      result: JSON.stringify(actions).substring(0, 1000),
    });
  } catch { /* ignore */ }

  log("nba_generated", { venue_id: venueId, language });
  return new Response(JSON.stringify({ actions, cached: false }), { headers: jsonHeaders });
}

// ═══════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid authentication" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify owner role
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isOwner = roles?.some((r: any) => r.role === "owner");
    if (!isOwner) {
      return new Response(JSON.stringify({ error: "Owner role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get venue
    const { data: venueData } = await supabase.from("venues").select("id").eq("owner_id", user.id).limit(1).maybeSingle();
    if (!venueData) {
      return new Response(JSON.stringify({ error: "No venue found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const venueId = venueData.id;
    const body = await req.json();

    // Actions structurées hors chat — même auth/rôle/venue que le chat,
    // mais réponse JSON directe sans boucle de tools.
    if (body?.action === "generate_marketing_content") {
      return await handleGenerateContent(body, { supabase, venueId, userId: user.id });
    }
    if (body?.action === "generate_night_report") {
      return await handleGenerateNightReport(body, { supabase, venueId, userId: user.id });
    }
    if (body?.action === "generate_next_best_actions") {
      return await handleNextBestActions(body, { supabase, venueId, userId: user.id });
    }

    const { messages, venueContext } = body;

    // Fetch subscription plan — inutile pendant le lancement (abonnement coupé,
    // tout est débloqué), on économise l'aller-retour.
    let venuePlan = "essential";
    if (SUBSCRIPTIONS_ENABLED) {
      try {
        const subRes = await fetch(`${supabaseUrl}/functions/v1/club-subscription`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ action: "check", venueId }),
        });
        if (subRes.ok) {
          const subData = await subRes.json();
          venuePlan = subData?.subscriptionPlan || "essential";
        }
      } catch (e) { log("plan_fetch_error", { error: String(e) }); }
    }

    // Build context
    let contextBlock = `\n\n📍 CONTEXTE :`;
    if (venueContext?.venueName) contextBlock += `\n- Club : ${venueContext.venueName}`;
    if (venueContext?.stripeConnected !== undefined) contextBlock += `\n- Stripe : ${venueContext.stripeConnected ? "Connecté" : "Non connecté"}`;
    if (venueContext?.eventsCount !== undefined) contextBlock += `\n- Events : ${venueContext.eventsCount}`;
    if (venueContext?.staffCount !== undefined) contextBlock += `\n- Staff : ${venueContext.staffCount}`;
    if (venueContext?.drinksCount !== undefined) contextBlock += `\n- Boissons actives : ${venueContext.drinksCount}`;
    if (venueContext?.currentPage) contextBlock += `\n- Page actuelle : ${venueContext.currentPage}`;
    contextBlock += SUBSCRIPTIONS_ENABLED
      ? `\n- Plan : ${venuePlan.toUpperCase()}`
      : `\n- Plan : LANCEMENT — toutes les fonctionnalités incluses`;

    // NB : l'ancienne injection FAQ depuis la table chatbot_training a été retirée
    // (données non maintenues, redondantes avec HELP_ARTICLES qui est versionné).
    const systemPrompt = OWNER_SYSTEM_PROMPT + contextBlock;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const aiHeaders = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    };

    log("request_start", { venue_id: venueId, plan: venuePlan, msg_count: messages.length });

    // ═══════════════════════════════════════
    // MULTI-ROUND TOOL CALLING (max 3 rounds)
    // ═══════════════════════════════════════

    let conversationMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const MAX_ROUNDS = 3;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const roundResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: aiHeaders,
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: conversationMessages,
          tools: TOOLS,
          tool_choice: "auto",
          stream: false,
        }),
      });

      if (!roundResponse.ok) {
        const status = roundResponse.status;
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await roundResponse.text();
        log("ai_error", { round, status, body: t.substring(0, 200) });
        throw new Error("AI gateway error");
      }

      const roundResult = await roundResponse.json();
      const choice = roundResult.choices?.[0];

      // No tool calls → use the content we already have (no redundant API call)
      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        const finalContent = choice?.message?.content || "";
        log("final_answer", { round, content_length: finalContent.length });

        // Format as SSE manually from the already-obtained content
        const ssePayload = `data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(ssePayload, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Execute tool calls
      const toolCalls = choice.message.tool_calls;
      log("tool_calls", { round, tools: toolCalls.map((tc: any) => tc.function.name) });

      // Add assistant message with tool calls
      conversationMessages.push(choice.message);

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        let fnArgs: Record<string, any> = {};
        try { fnArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }

        // Plan gating — désactivé pendant le lancement (SUBSCRIPTIONS_ENABLED=false) :
        // aucun tool n'est bloqué. La map TOOL_MIN_PLAN reste prête pour la réactivation.
        const minPlan = SUBSCRIPTIONS_ENABLED ? TOOL_MIN_PLAN[fnName] : undefined;
        if (minPlan && !hasPlanAccess(venuePlan, minPlan)) {
          log("plan_blocked", { tool: fnName, plan: venuePlan, required: minPlan });
          conversationMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              error: "plan_insufficient",
              current_plan: venuePlan,
              required_plan: minPlan,
              message: `Cette fonctionnalité nécessite le plan ${minPlan.toUpperCase()}. Plan actuel : ${venuePlan.toUpperCase()}.`,
            }),
          });
          continue;
        }

        log("tool_exec", { round, tool: fnName, args: fnArgs });
        const result = await executeTool(fnName, fnArgs, supabase, venueId);
        log("tool_result", { round, tool: fnName, result_length: result.length });

        conversationMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });

        // Audit log for write tools
        if (WRITE_TOOLS.has(fnName)) {
          try {
            await supabase.from("owner_ai_audit_log").insert({
              user_id: user.id,
              venue_id: venueId,
              tool_name: fnName,
              tool_args: fnArgs,
              result: result.substring(0, 1000),
            });
          } catch { /* ignore */ }
        }
      }

      // Continue loop → next round will check if model wants more tools
    }

    // If we exhausted rounds, do a final stream without tools
    log("max_rounds_reached", { rounds: MAX_ROUNDS });
    const finalStream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: conversationMessages,
        stream: true,
      }),
    });

    if (!finalStream.ok) throw new Error("Final stream error");

    return new Response(finalStream.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (e) {
    log("fatal_error", { error: String(e) });
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
