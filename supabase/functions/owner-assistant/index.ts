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
  "audience-tracking": {
    title: "Suivre son audience (abonnés)",
    keywords: ["audience", "abonnés", "abonnes", "subscribers", "followers", "suivis", "fans", "statistiques abonnés", "démographie", "demographics", "portée", "reachable", "joignables", "croissance", "growth", "segmentation", "notifications", "efficacité notifs", "revenu abonnés", "clients fidèles", "valeur par abonné", "ltv", "combien rapporte un abonné", "entonnoir", "funnel", "conversion", "ré-acheteurs", "attribution", "revenu par push", "combien a rapporté mon push", "benchmark", "médiane ville", "comparaison", "percentile", "source d'acquisition", "d'où viennent mes abonnés", "cohorte", "rétention", "récap hebdo", "audience partagée", "chevauchement", "collab", "net-new"],
    path: "/owner/audience",
    snippet: "La page Audience (menu Aperçu) montre qui suit ton club et ce que ça rapporte. La couche argent est en tête : (0) Valeur de l'audience — combien vaut chaque abonné (revenu net qu'ils génèrent ÷ leur nombre, sur 90j) avec taux de conversion et panier moyen ; un entonnoir Abonnés → Joignables → Engagés → Acheteurs → Ré-acheteurs ; et l'attribution push→vente qui chiffre chaque campagne (« ton dernier push a rapporté X€ » = abonnés qui ont cliqué puis acheté dans les 72h). Puis : (1) Croissance — nombre d'abonnés et évolution nette dans le temps (le suivi net démarre avec la capture ; avant, c'est l'historique brut, sans les désabonnements passés). (2) Portée & notifications — combien de tes abonnés peuvent recevoir un push (le reste a coupé les notifs), le meilleur créneau d'envoi, et le taux de clic + revenu attribué de tes campagnes. (3) Démographie agrégée et anonyme — âge, sexe (estimé via guest lists), villes, langues, goûts musicaux. (4) Segmentation & revenu — abonnés engagés/passifs/injoignables, abonnés qui ont acheté chez toi et leur valeur, et combien de ton chiffre vient de tes abonnés vs des non-abonnés. (5) Comparaison, sources & récap — ta position face aux autres clubs de ta ville (percentiles anonymes, « ta portée mieux que 60% »), d'où viennent tes abonnés (quelle surface les déclenche), la rétention par cohorte, et chaque lundi un récap de ta semaine (abonnés, push, ventes) poussé sur ton app Pro. Sur une soirée en collab, une carte « Audience partagée » montre les abonnés communs avec le co-organisateur et le net-new que la collab débloque. Une zone « Performance marketing » compare les canaux côte à côte : revenus attribués du push, de l'email et des liens trackés sur 90 j. Le bouton « Notifier mes abonnés » ouvre l'envoi de push. Tout est agrégé : tu ne vois jamais l'identité de chaque abonné. (Valeur/entonnoir/attribution = clubs uniquement ; côté DJ/organisateur, l'audience reste démographie + portée.)",
  },
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
  "publish-page": {
    title: "Publier ma page (page cachée / compte vitrine)",
    keywords: ["publier", "publish", "page cachée", "hidden", "invisible", "visible", "en ligne", "vitrine", "showcase", "activer", "activation", "compte pré-construit", "preview", "aperçu", "ma page n'apparaît pas", "introuvable"],
    path: "/owner/venue",
    snippet: "Si ta page club est encore invisible du public (par exemple l'équipe Yuno a pré-construit ton compte et tu viens de l'activer), une carte « Publier ma page » apparaît en haut de Paramètres > Mon club. Vérifie ta page avec le lien d'aperçu, puis clique « Publier ma page » : elle devient immédiatement visible dans l'app et sur le web. Tu peux publier avant de connecter Stripe — les ventes de billets, tables et boissons restent simplement fermées tant que Stripe n'est pas configuré. Tant que la page est cachée, seuls toi et l'équipe Yuno pouvez la voir.",
  },
  "staff-roles": {
    title: "Rôles du staff",
    keywords: ["staff", "employé", "barman", "bouncer", "videur", "manager", "vestiaire", "cloakroom", "rôle", "PIN"],
    path: "/owner/staff",
    snippet: "Rôles disponibles : Barman, Bouncer, VIP Host, Vestiaire (Cloakroom), Manager. Chaque employé a un PIN à 6 chiffres. L'employé doit déjà avoir un compte Yuno. Le Manager a des permissions granulaires configurables. Tu peux mettre autant de personnes que tu veux sur le même rôle (plusieurs barmans, plusieurs videurs) : chacun garde son compte, son PIN et ses propres statistiques. Une personne ne peut en revanche être rattachée qu'à un seul club à la fois.",
  },
  "staff-account": {
    title: "Le compte personnel du staff",
    keywords: ["compte staff", "profil staff", "mon compte", "personnalisation", "surnom", "photo staff", "intitulé", "poste", "identité", "équipe", "stats staff", "statistiques employé", "qui a scanné", "performance staff", "onboarding staff", "relevé"],
    path: "/owner/staff",
    snippet: "Chaque membre du staff a un vrai compte personnel. Depuis son dashboard il tape sur son nom en haut à gauche pour ouvrir « Mon compte » : il y choisit son nom d'affichage et sa photo de service, et y consulte son relevé de travail — scans, commandes servies, dépôts au vestiaire, consos VIP, nuits travaillées sur 30 jours — et la liste de l'équipe. L'intitulé de poste (« Responsable porte », « Chef de rang ») est défini par TOI depuis la page Staff, sur la carte de chaque membre ; sans intitulé, l'écran affiche le nom du rôle. À la première connexion, chaque nouveau membre passe par un accueil d'une minute (poste, photo, nom). Chaque action est attribuée à la personne qui l'a faite : le centre de commandement montre qui a scanné, qui a servi, qui tient le vestiaire.",
  },
  "staff-briefing": {
    title: "Consigne du soir et pouls de la nuit",
    keywords: ["consigne", "brief", "briefing", "consigne du soir", "équipe connectée", "en poste", "appel de poste", "radio staff", "qui est en poste", "fin de service", "récap staff", "prise de poste"],
    path: "/owner/staff",
    snippet: "La page Staff a trois onglets. ÉQUIPE : gestion des comptes, rôles, PIN et intitulés de poste. BRIEFING : tu écris la consigne du soir (dress code, tarifs, priorités, interdits) — elle s'affiche en haut de l'écran de chaque staff avec un push, et tu vois qui l'a lue (« Vu par 4/6 ») et qui est en poste en ce moment. ACTIVITÉ : le relevé de travail de chaque membre sur 30 jours (nuits, actions par domaine, dernière action), trié par ancienneté — jamais un classement. Côté staff, chaque écran porte un panneau « Ce soir » avec les chiffres de son poste en direct, la prise de poste à l'ouverture, le récap en fin de service, et un bouton pour appeler un autre poste (renfort, sécurité, arrivée VIP, stock).",
  },
  "vip-tables": {
    title: "Tables VIP",
    keywords: ["table", "VIP", "réservation", "zone", "minimum", "consommation", "acompte", "deposit", "heure d'arrivée", "arrivée limite", "arrival cutoff", "retard", "arriver tard", "late"],
    path: "/owner/tables",
    snippet: "Les Tables VIP permettent de créer des zones avec tables, capacité et minimum de consommation. Les clients réservent avec un acompte. Le VIP host gère les arrivées et les consommations sur place. Sur chaque pack tu peux activer une Heure d'arrivée limite optionnelle (ex. 01:00) : quand elle est active, elle s'affiche au client au moment de la réservation (« Arrivée avant … ») pour éviter que des clients arrivent très tard et gardent une table toute la nuit. Pas d'annulation automatique : l'heure est aussi rappelée au videur au scan d'entrée et à l'hôte VIP sur la fiche de la table.",
  },
  "subscription-plans": {
    title: "Tarification — lancement gratuit",
    keywords: ["abonnement", "plan", "essential", "pro", "elite", "prix", "tarif", "billing", "gratuit", "coût", "combien", "subscription", "pricing", "free"],
    path: "/owner/billing",
    snippet: "Pendant le lancement, Yuno est GRATUIT pour les clubs : aucune mensualité, toutes les fonctionnalités incluses (billetterie, tables VIP, fidélité, CRM, promoteurs, DJs, analytics). Seules les commissions par transaction s'appliquent (voir structure des frais). Des plans payants arriveront plus tard ; les clubs actifs seront prévenus à l'avance.",
  },
  "guest-list": {
    title: "Guest List",
    keywords: ["guest", "list", "liste", "invité", "gratuit", "free", "quota", "places restantes", "remaining spots", "compteur", "modèle", "template", "promoteur", "allocation", "part", "lien unique", "lien d'invitation", "invite link", "ajout direct", "types proposés", "boisson", "vip"],
    path: "/owner/guest-list",
    snippet: "La guest list permet d'offrir l'entrée gratuite avant une certaine heure. Configure un quota (global ou par genre), active/désactive par event. Crée des parts déléguées par promoteur, DJ ou nom libre, avec quota par type (standard/boisson/VIP) ou « Sans limite » (illimité) : le détenteur ajoute alors autant d'invités qu'il veut et suit ses places restantes en direct dans son app. TROIS CANAUX DE DISTRIBUTION sur chaque part : 1) le LIEN PUBLIC — le détenteur choisit les types d'entrée proposés dessus (« Types proposés sur le lien public » : normale, boisson, VIP ou un mélange ; à plusieurs types, l'invité choisit en s'inscrivant) ; 2) l'AJOUT DIRECT (« Ajouter un invité ») — prénom, nom, email et type, l'invité reçoit son QR par email ; 3) les LIENS D'INVITATION uniques — un lien personnel à type imposé et nombre de places limité (ex. 2 places VIP pour un invité et son +1), qu'on peut NOMMER (« Ana +1 », « Presse ») pour s'y retrouver, copiable ou envoyé par email, révocable à tout moment. En plus, chaque part porte des LIENS PAR CANAL, qui sont les MÊMES liens suivis que pour partager une soirée (système tracked_links, URL /l/<code>) : quatre canaux (Instagram, TikTok, Newsletter, WhatsApp) sont créés automatiquement sur la part, le détenteur n'a qu'à copier et partager. Chaque lien compte ses clics, ses inscrits et son taux de conversion ; on peut en ajouter ou en renommer. Sur un lien de promoteur, son code de parrainage est réinjecté à l'arrivée, donc ses inscriptions restent rattachées à sa commission. Supprimer un lien de canal ne supprime pas les invités déjà inscrits. Les canaux d'une part déléguée appartiennent à son détenteur (DJ, promoteur) et se gèrent depuis SON app, pas depuis la page Guest List du club. Les DJs et promoteurs ont les trois mêmes canaux dans leur propre app, limités aux types accordés dans leur allocation. Chaque modèle de guest list (onglet Modèles) porte aussi le réglage « Afficher les places restantes » : activé, le public lit « 42 places restantes » ; désactivé, il voit seulement si la liste est ouverte ou complète. Le réglage est repris sur chaque part et modifiable soirée par soirée. POUR LES PROMOTEURS, le plus simple est de piloter la guest list depuis le MODÈLE DE COMMISSION (Promoteurs > Modèles), où la guest list est une section à part. Tu y fixes des places par TYPE — Normale, Avec boisson, Accès VIP — chacune avec SA commission par tête (la commission guest list n'est plus globale : elle dépend du type de l'invité scanné). En option, tu répartis par sexe (quotas Femmes/Hommes) et fixes l'heure d'entrée gratuite. Chaque promoteur portant ce modèle reçoit automatiquement ces places sur chaque soirée reliée (la part est créée à l'assignation) ; il ajoute ses invités depuis son app en choisissant le type, et le sexe si tu l'as activé. IMPORTANT : si c'est le modèle PAR DÉFAUT du club, l'allocation s'applique AUSSI aux promoteurs qui n'ont pas de modèle assigné (default_commission_template_id NULL) — inutile de l'assigner un par un. Cette page Guest List reste là pour ajuster une soirée précise à la main.",
  },
  "agency-guest-list": {
    title: "Enveloppe guest list pour une agence de promoteurs",
    keywords: ["agence", "agency", "agence de promoteurs", "promoter agency", "enveloppe", "envelope", "guest list agence", "répartir", "répartition", "distribute", "partition", "pool", "libre accès", "quota agence", "places agence", "contrat agence", "partenaire"],
    path: "/owner/agencies",
    snippet: "Quand tu travailles avec une AGENCE de promoteurs (contrat actif sur /owner/agencies), tu ne gères pas ses promoteurs un par un : tu accordes à l'agence une ENVELOPPE de places guest list, un total qu'elle répartit ensuite elle-même entre SES promoteurs. Deux façons d'accorder : 1) un défaut STANDING — sur la fiche de l'agence (page Agences partenaires), tu fixes « X places par soirée » une fois, et l'enveloppe se matérialise toute seule pour chaque soirée où un de ses promoteurs est assigné ; 2) un octroi PAR SOIRÉE — depuis la page Guest List d'une soirée, bloc « Enveloppe guest list agence », qui écrase le défaut pour ce soir-là. Tu choisis aussi le MODE de répartition : PARTITION (l'agence donne à chaque promoteur un quota fixe, la somme ne dépasse jamais l'enveloppe) ou POOL (tous ses promoteurs puisent dans la même enveloppe, premier arrivé premier servi, jusqu'à épuisement). L'agence pilote la répartition depuis SON cockpit (elle bascule le mode, distribue les sous-quotas, voit les places prises) ; toi tu ne fixes que la taille de l'enveloppe et le mode par défaut. Règle clé : seuls les clubs Yuno sous contrat génèrent une enveloppe et une commission — un promoteur d'une agence rattaché à un club EXTERNE (hors Yuno) ne peut pas être rémunéré ni recevoir de places via Yuno, car l'achat ne se fait pas sur Yuno.",
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
    keywords: ["promoteur", "promoter", "affiliation", "commission", "lien", "linktree", "agenda", "remboursement", "bonus", "assignation", "relier", "rattacher", "auto-assignation", "événements", "soirées"],
    path: "/owner/promoters",
    snippet: "Les promoteurs ont un lien de parrainage unique (yunoapp.eu/promoteur/CODE — le code est unique par personne, partagé entre ses clubs). Ils gagnent une commission par ticket ou table vendue. Configure les taux par type via les modèles de commission : taux fixes ou en pourcentage, paliers de ventes, bonus au franchissement d'un seuil, fenêtres horaires de validité au scan. IMPORTANT — le rattachement fait foi : un promoteur ne voit, ne promeut sur son linktree public et n'est payé QUE sur les soirées auxquelles il est relié ; une soirée non reliée n'apparaît pas sur son linktree (pas de promo sans commission en retour). Trois façons de le relier : à l'unité depuis une soirée ; via « Auto-assignation aux soirées » dans sa fiche (Réglages), qui le rattache d'un coup à toutes les soirées à venir — récurrentes et co-events inclus — et aux futures automatiquement ; ou via le toggle « Relier à tous les événements » porté par un modèle de commission (appliquer ce modèle à un promoteur pré-active son auto-assignation). Chaque promoteur a aussi une page Agenda publique (yunoapp.eu/promoteur/CODE/agenda) qui liste TOUTES ses soirées reliées : le linktree met en avant les soirées que le promoteur épingle depuis son app (onglet Linktree ; sans épingle, ses 8 prochaines), l'agenda montre tout ; le QR de l'agenda (dans son app, onglet Liens) s'ouvre toujours dans le navigateur et chaque soirée bascule vers l'app Yuno si elle est installée — clics et ventes y sont trackés et commissionnés pareil. Son scanner détecte automatiquement la soirée en cours. Un remboursement annule automatiquement la commission en attente liée à la vente.",
  },
  "promoter-notifications": {
    title: "Notifications des promoteurs (app Yuno Pro)",
    keywords: ["notification", "notifications", "push", "alerte", "alert", "promoteur", "promoter", "prevenu", "prévenu", "telephone", "téléphone", "app pro", "yuno pro", "annonce", "brief", "spam"],
    path: "/owner/promoters",
    snippet: "Tes promoteurs sont notifiés automatiquement dans l'app Yuno Pro, rien à configurer côté club. Ils reçoivent : leur première vente de la soirée, le bilan du lendemain matin (nombre de ventes + commissions), l'objectif d'une soirée atteint, une soirée que tu leur confies (assignation manuelle ou automatique), une commission d'équipe pour un chef d'équipe, et une commission annulée par un remboursement. Un promoteur reçoit aussi une relance quand un règlement attend son accusé de réception.\n\nDeux choses ne sont VOLONTAIREMENT pas notifiées : chaque vente, et chaque invité qui passe la porte. Un promoteur à cinquante ventes un samedi recevrait cinquante push et désactiverait tout : il en reçoit deux, et c'est le bilan du lendemain qui raconte la nuit. Les commissions d'équipe sont cumulées (un seul push par jour, montant total), et une commission annulée en pleine nuit est livrée le matin à 10 h, jamais à 3 h.\n\nQuand tu publies une annonce depuis Promoteurs > Annonces, elle part en notification chez chacun de tes promoteurs : c'est le moyen le plus fiable de faire passer un brief avant une soirée. Chaque type de notification reste coupable par le super admin depuis /admin/notifications.",
  },
  "promoter-settlement": {
    title: "Régler un promoteur (virement en trois temps)",
    keywords: ["régler", "regler", "règlement", "reglement", "payer promoteur", "settle", "payout", "virement", "iban", "virer", "commission due", "dette", "solder", "reçu", "recu", "litige", "dispute", "référence", "reference", "accusé de réception", "accuse de reception"],
    path: "/owner/promoters/finance",
    snippet: "Le règlement d'un promoteur se fait en trois temps depuis Promoteurs > Finance, et Yuno ne touche JAMAIS l'argent : le virement part du compte bancaire du club vers celui du promoteur, comme un virement SEPA normal. Yuno sécurise l'accord et l'horodate.\n1. **Préparer le règlement** : Yuno fige un lot (montant, liste exacte des commissions couvertes, date). La ligne passe en « Préparé ». Rien n'est soldé, c'est encore annulable.\n2. **Faire le virement** : l'écran affiche l'IBAN complet, le montant et une référence de virement du type YUNO-PAULB-2607, chacun avec un bouton copier. Le club vire depuis sa banque en reportant cette référence, puis clique « J'ai effectué le virement ».\n3. **Le promoteur accuse réception** : il voit dans son app « Le club déclare t'avoir versé 237,74 €. Bien reçu ? ». C'est SEULEMENT quand il confirme que les commissions passent en payé. Un club ne peut pas solder une dette tout seul, et un promoteur ne peut pas prétendre ne pas avoir été payé.\nSans accusé de réception sous 5 jours, la ligne bascule en litige et le club est alerté. Le promoteur peut aussi signaler immédiatement n'avoir rien reçu. Le club tranche alors : « Le virement est bien parti » (relance le compte à rebours) ou « Annuler le règlement » (les commissions redeviennent dues). Une fois confirmé, un reçu PDF contresigné, horodaté des deux côtés, est téléchargeable par les deux parties. Sécurité : si le promoteur change son IBAN, les règlements sont gelés 24 h — c'est ce qui empêche de détourner un virement en modifiant l'IBAN au dernier moment. Un promoteur géré par une agence est réglé par son agence, pas par le club.",
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
    keywords: ["événement", "event", "soirée", "créer", "create", "publier", "publish", "poster", "affiche", "line-up", "privé", "mot de passe", "visibilité", "secret", "fuseau", "fuseau horaire", "timezone", "heure", "décalage"],
    path: "/owner/events",
    snippet: "Depuis Événements, crée une soirée : titre, dates, fuseau horaire, affiche, genre musical, line-up DJ. Le champ Fuseau horaire fixe le fuseau dans lequel les heures de début/fin que tu saisis sont interprétées ET affichées (clients, notifications, billets) ; il est pré-rempli avec le fuseau de la ville de ton club et tu peux le changer par soirée. Ainsi une soirée saisie à 23h30 reste 23h30 partout, sans décalage. Ajouter au line-up un DJ qui a un compte Yuno envoie une demande de booking (horaires du set, cachet proposé, message pour le style attendu) : il n'apparaît sur l'affiche qu'après avoir accepté depuis son app, et reste « En attente » d'ici là ; un profil sans compte est ajouté directement. Active ensuite la billetterie, la guest list et les tables VIP selon tes besoins. Une soirée peut être publique (visible dans Explorer) ou privée avec mot de passe. Les événements sans lieu fixe peuvent utiliser une adresse secrète révélée aux acheteurs.",
  },
  "recurring-events": {
    title: "Soirées récurrentes",
    keywords: ["récurrent", "récurrence", "recurring", "hebdomadaire", "weekly", "série", "series", "chaque semaine", "répéter", "guest list automatique", "résidence", "residency", "contrat-cadre"],
    path: "/owner/events",
    snippet: "Crée une soirée récurrente (ex. tous les vendredis) : chaque occurrence est générée automatiquement avec les presets billets standard/VIP et le preset de tables VIP de la série. Le bloc « Guest list automatique » du réglage de la série te laisse épingler un modèle de guest list : chaque soirée générée naît alors avec sa guest list club déjà publiée (laisse « Pas de guest list automatique » pour la gérer soirée par soirée). Les rounds de billets s'activent automatiquement à chaque occurrence. Tu peux marquer une occurrence complète manuellement et tu reçois un rappel pour ajouter le line-up DJ de chaque date. Si tu montes la série avec un organisateur partenaire, le bloc « Co-organisation » te fait choisir le MODE de collaboration (co-soirée, location de salle, ou hébergement par le club — les mêmes que sur une soirée unique) puis QUI FAIT QUOI (création, billetterie, opérations, promotion), et ajoute une étape contrat : soit tu reprends un contrat déjà signé avec lui (autre résidence ou conditions du partenariat), soit tu en rédiges un nouveau avec un partage détaillé billets / tables VIP / boissons et la règle d'annulation. À l'enregistrement, l'organisateur reçoit le récap de la série et les conditions ; une seule signature de sa part ouvre toutes les dates à la vente.",
  },
  "collab-responsibilities": {
    title: "Qui fait quoi dans une collaboration",
    keywords: ["qui fait quoi", "who does what", "responsabilité", "responsabilités", "responsibilities", "qui décide", "qui gère", "domaine", "création", "creative", "affiche", "design", "logistique", "opérations", "operations", "chacun son métier", "mode de collaboration", "location de salle", "venue rental", "hébergée", "org hosted", "lecture seule", "read only", "je ne peux pas modifier", "modifier l'affiche", "avenant", "amendment", "adenda", "renégocier", "renegocier", "changer le contrat", "modifier le contrat", "nouvelle signature", "contresigner"],
    path: "/owner/collaborations",
    snippet: "Dans une collaboration, DEUX choses se négocient séparément. Le PARTAGE DES RECETTES dit qui touche l'argent (billets, tables VIP, boissons). L'axe QUI FAIT QUOI dit qui a la main sur quoi, et c'est indépendant. Deux faces seulement. Le DESIGN : affiche, titre, description, genres musicaux, line-up DJ, et la façon dont la soirée est montrée (visibilité, découverte, référencement). L'OPÉRATIONNEL : la billetterie complète avec les prix et les paliers, les tables VIP et le plan de salle, les horaires, le lieu et les accès. Pour chacune, trois choix : le club, l'organisateur, ou les deux. La configuration la plus courante est le club sur l'opérationnel et l'organisateur sur le design. Le réglage est APPLIQUÉ, pas seulement affiché : si le design revient à l'organisateur, le club ne peut plus changer l'affiche ni ajouter un DJ, et inversement. Si quelqu'un dit « je ne peux pas modifier l'affiche / la billetterie / les tables » sur une co-soirée, c'est presque toujours que cette face est confiée à l'autre partie. Verrouiller n'aveugle pas pour autant : depuis la page de la soirée, la face qu'on ne tient PAS reste CONSULTABLE en aperçu lecture seule. Les tuiles « Infos & affiche » et « Billetterie » s'ouvrent quand même, avec un badge « Aperçu », et montrent exactement ce que voit le public — l'affiche, les genres et le line-up côté design ; les prix, les paliers et le nombre de ventes côté opérationnel. Seule la MODIFICATION passe par un avenant, jamais la simple consultation. Sur une résidence, le jour et l'heure restent au club même si l'organisateur tient l'opérationnel : ils sont gelés dans le contrat-cadre. Une soirée existante garde son comportement d'avant tant que personne n'a réparti. La répartition FIGURE SUR LE CONTRAT SIGNÉ (article « Répartition des responsabilités »). Pour la changer une fois le contrat signé, pas besoin de résilier : chaque contrat en vigueur a un bouton « Avenant » sur la page Collaborations. Le club comme l'organisateur peuvent en proposer un, l'autre partie le signe, et RIEN ne change tant que les deux signatures ne sont pas là. L'avenant ne réécrit jamais le contrat d'origine : il s'y ajoute avec l'état d'avant, l'état d'après, le motif et les deux horodatages. Un avenant peut aussi déplacer le partage des revenus, sauf sur une soirée dont les ventes ont déjà commencé.",
  },
  "collaborations": {
    title: "Co-organisations (clubs ↔ organisateurs)",
    keywords: ["collaboration", "collab", "co-organisation", "co-org", "organisateur", "organizer", "BDE", "partenaire", "partage", "split", "contrat", "signature", "contrat-cadre", "résidence", "reprendre un contrat", "pilier", "hors du deal", "que les tables", "bloquer billets", "bloquer boissons", "périmètre", "scope"],
    path: "/owner/collaborations",
    snippet: "Les collaborations permettent de monter une soirée à deux : ton club + un organisateur externe (asso, BDE, promoteur d'événements). Un contrat numérique définit le partage des revenus (billets, tables VIP, boissons) et doit être signé par LES DEUX parties avant que les ventes ouvrent. Les paiements sont ensuite répartis automatiquement selon le contrat. Le contrat peut aussi SORTIR un pilier du deal : dans l'éditeur de répartition, chaque pilier (billets, tables, boissons) a un interrupteur — un deal « tables uniquement » bloque la vente de billets et la commande de boissons dans l'app sur cette soirée, et seul un avenant signé des deux parties peut les réactiver. Gère les propositions reçues et envoyées depuis l'onglet Collaborations. Pour une série récurrente, c'est un CONTRAT-CADRE : signé une seule fois, il couvre toutes les dates de la résidence, présentes et à venir, et se résilie pour l'avenir depuis la carte de la série (les soirées déjà ouvertes à la vente restent inchangées). Au moment de créer la série, tu peux reprendre les conditions d'un contrat déjà signé avec cet organisateur plutôt que d'en resaisir un ; l'organisateur reçoit alors le récap de la série (jour, horaires, billetterie, tables, guest list, prochaines dates) avec les conditions à signer. Les boissons restent à 100% club tant que l'organisateur n'a pas attesté sa licence de vente d'alcool. Le contrat porte aussi la répartition des RESPONSABILITÉS (qui tient la création, la billetterie, les opérations, la promotion) — voir l'article « Qui fait quoi dans une collaboration ».",
  },
  "collab-table-settlement": {
    title: "Tables en collab : acompte ou total dépensé, et le règlement de fin de soirée",
    keywords: ["total dépensé", "total spend", "base du partage", "basis", "acompte", "deposit", "complément tables", "top-up", "virement organisateur", "règlement collab", "fin de soirée", "iban organisateur", "double vérification", "litige", "combien je dois à l'organisateur", "régler l'organisateur"],
    path: "/owner/collaborations",
    snippet: "Le partage des tables VIP d'une collab a une BASE, choisie dans le contrat. « Acompte en ligne » (défaut) : le % ne s'applique qu'à l'acompte payé sur Yuno, partagé automatiquement via Stripe ; ce qui se dépense sur place reste au club. « Total dépensé » : le % s'applique à tout ce que les tables ont dépensé (acompte + solde sur place + extras au-delà du budget, enregistrés par le service VIP). L'acompte reste partagé via Stripe ; le COMPLÉMENT dû à l'organisateur est calculé automatiquement en fin de soirée, réservation par réservation (part théorique moins ce que l'organisateur a déjà touché via Stripe). La carte « Complément tables » sur la page de la co-soirée montre le même calcul aux deux parties. Règlement en double vérification, comme les promoteurs : le club prépare le lot (IBAN de l'organisateur + référence de virement affichés), déclare le virement SEPA parti, et SEUL l'organisateur confirme la réception ; sans réponse dans le délai, litige automatique. Yuno ne touche jamais les fonds. L'organisateur renseigne son IBAN dans son app (onglet Paiements) ; le club ne le voit qu'au moment de régler. Une soirée non terminée affiche des chiffres provisoires : le lot ne se prépare qu'une fois la soirée finie.",
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
    keywords: ["email", "campagne", "campaign", "newsletter", "mailing", "éditeur", "studio", "email studio", "bloc", "blocs yuno", "a/b", "objet b", "compte à rebours", "exclusions", "nuit", "quiet", "débit", "throttle", "envoi", "ouvertures", "désabonnement", "revenu campagne", "combien a rapporté", "segment personnalisé", "envoi de masse", "masse", "bulk", "spam", "délivrabilité", "delivrabilite", "warm-up", "plafond", "quota", "bounce", "rebond", "plainte", "pause automatique", "envoi bloqué", "envoi en cours", "5000 emails", "modèle", "template", "supprimer", "brouillon"],
    path: "/owner/campaigns",
    snippet: "Crée des campagnes email dans l'Email Studio : un parcours en cinq écrans (Studio → Audience → Planification → Récap → Envoi). Le Studio compose l'email par blocs avec aperçu fidèle desktop/mobile, 4 thèmes et des variables ({{prénom}}, {{ville}}, {{nom_club}}…). Dans un bloc texte, sélectionne une partie du texte puis utilise la barre de mise en forme : gras, italique, barré, souligné, couleur, taille, lien. Chaque bloc règle ses marges internes (0 = blocs collés, sans espace), chaque bouton peut avoir sa propre couleur (le texte s'adapte automatiquement), les images peuvent avoir des coins arrondis, et le compte à rebours accepte une date précise même sans événement relié. Le bloc En-tête reprend automatiquement le nom et le logo de ton compte (club ou organisateur) : tu ne téléverses une image que si tu veux un logo différent pour CET email, et le petit « x » sur l'aperçu te ramène au logo du compte. Le PIED DE PAGE se clique directement dans l'aperçu (ou depuis l'onglet Structure) : ça ouvre ses réglages — les réseaux sociaux (interrupteur pour les couper + les liens Instagram, TikTok, Facebook, X, site) et les deux couleurs de la bande. Coupe les réseaux si tu poses déjà un bloc « Réseaux » dans le corps, sinon les pastilles apparaissent deux fois (la checklist pré-envoi te prévient dans ce cas). En revanche les mentions légales du pied de page — nom de l'expéditeur, raison de réception, copyright, lien de désinscription — sont affichées mais NON MODIFIABLES, et le pied de page ne peut être ni déplacé ni supprimé : ce sont des obligations légales, Yuno les écrit à chaque envoi. Les blocs Yuno à données live — Événement, Billetterie, Table VIP, Compte à rebours — sont branchés sur une soirée réelle et rafraîchis AU MOMENT de l'envoi (prix courant, épuisé, décompte juste) ; une soirée sans billetterie (guest list seule) n'affiche simplement pas le bloc Billetterie, rien n'est inventé. Audience : cumule plusieurs segments (fidèles, inactifs, VIP… ou un segment sauvegardé de la page Clients — toujours croisé avec l'opt-in newsletter) et exclus les contacts touchés récemment ou déjà acheteurs de la soirée ; le compteur montre le net réel après dédoublonnage et liste de suppression. Tu peux tester deux objets (A/B) : envoyés à un échantillon, le gagnant à l'ouverture part au reste. Options d'envoi : programmation, lissage du débit, pas d'envoi la nuit (23 h → 9 h). Chaque bloc peut porter une règle de visibilité (« VIP · Table », « Nouveaux abonnés », « A déjà acheté ») vérifiée à l'envoi, destinataire par destinataire. Une checklist pré-envoi vérifie objet, preheader, bouton d'action, alt des images, poids Gmail, désinscription et domaine authentifié. Puis suis le rapport : ouvertures, clics, désabonnements, ET les revenus attribués — les ventes des destinataires qui ont cliqué l'email puis acheté sous 72 h, net de frais (colonne Revenu directement dans la liste des campagnes). Le rapport montre aussi le duel A/B (taux d'ouverture de chaque objet sur l'échantillon, gagnant marqué) et les liens les plus cliqués de l'email — tu vois où ton audience est vraiment allée. Les destinataires désabonnés sont exclus automatiquement des envois suivants. Un gros envoi ne part pas d'un bloc : le premier envoi de masse est plafonné à 300 emails par jour puis monte (600, 1200, 2500, 5000, 10000) — quand le plafond du jour est atteint l'envoi reprend TOUT SEUL le lendemain, ce n'est pas un échec. Le compteur de rodage démarre au PREMIER envoi de masse et court en jours calendaires, qu'on envoie ou non : un petit envoi de test aujourd'hui fait gagner des jours sur la grosse campagne de la semaine prochaine. Au bout d'une semaine il n'y a plus de plafond de rodage. La barre de progression sur la page Campagnes montre en temps réel les envoyés et les reçus, et permet de mettre en pause ou d'annuler. Si plus de 0,2 % des destinataires signalent l'email comme indésirable, ou si plus de 5 % des adresses n'existent plus, la campagne se met en pause automatiquement : c'est une protection, au-delà de 0,3 % de plaintes Gmail bloque tous les emails du club, y compris les confirmations de billets.",
  },
  "email-templates": {
    title: "Modèles d'email réutilisables",
    keywords: ["modèle", "modele", "template", "gabarit", "réutiliser", "reutiliser", "recréer", "refaire le même email", "même design", "invitation type", "email type", "chaque soirée", "à chaque fois", "enregistrer le design", "partir de zéro", "page blanche", "départs rapides", "dupliquer un email", "copier une campagne"],
    path: "/owner/campaigns",
    snippet: "Un modèle enregistre le DESIGN d'une campagne — blocs, couleurs, objet, pré-en-tête — pour le rejouer sur chaque nouvelle soirée. Dans le studio, bouton « Modèle » en haut à droite : soit un nouveau modèle (nom + description), soit « Remplacer un modèle » pour faire évoluer un modèle existant. Ensuite, « + Nouvelle campagne » n'ouvre plus une page blanche mais un écran de choix : les modèles du club, les départs rapides fournis par Yuno (Invitation, Dernières places, Tables VIP, Annonce), ou la page blanche — puis on choisit la SOIRÉE et la campagne s'ouvre déjà montée. C'est le point clé : les blocs Yuno (Événement, Billetterie, Table VIP, Compte à rebours) d'un modèle sont enregistrés SANS soirée, l'affiche et le lien figés sont effacés, et tout se rebranche sur la soirée choisie — donc tarifs, jauge et affiche du soir, jamais ceux du mois dernier. Si des blocs Yuno restent sans soirée, la checklist pré-envoi le signale (« Blocs Yuno reliés à une soirée ») : sans soirée, un bloc Billetterie afficherait ses lignes d'exemple. Un modèle ne retient JAMAIS l'audience ni la planification : ces deux décisions se reprennent à chaque envoi. Les vignettes de l'écran de choix permettent de renommer, dupliquer ou supprimer un modèle ; supprimer un modèle ne touche aucune campagne déjà créée.",
  },
  "delete-campaign-draft": {
    title: "Supprimer un brouillon de campagne",
    keywords: ["supprimer une campagne", "supprimer un brouillon", "effacer une campagne", "corbeille", "poubelle", "nettoyer mes campagnes", "trop de brouillons", "campagne de test", "delete campaign", "delete draft", "annuler une campagne", "supprimer campagne envoyée"],
    path: "/owner/campaigns",
    snippet: "Dans la liste des campagnes, une corbeille au bout de la ligne supprime le brouillon — définitivement, il n'y a pas de corbeille de récupération. Elle n'apparaît QUE sur les brouillons : une campagne envoyée est une archive (destinataires, ouvertures, clics, revenu attribué), et le serveur refuse sa suppression même si la demande ne vient pas du bouton. Une campagne PLANIFIÉE n'est pas supprimable telle quelle : l'ouvrir, la repasser en envoi manuel, puis supprimer le brouillon. Une campagne EN COURS d'envoi se met en pause ou s'annule depuis sa barre de progression, elle ne se supprime pas. Supprimer une campagne ne ressuscite JAMAIS une adresse sortie de la base : la liste de suppression est globale et survit à ses campagnes. Le studio crée une ligne dès l'ouverture d'une nouvelle campagne, donc les brouillons d'essai s'accumulent vite — c'est normal de faire le ménage.",
  },
  "import-email-list": {
    title: "Importer une base email existante",
    keywords: ["importer", "import", "importer ma liste", "liste email", "base email", "csv", "fichier", "mailchimp", "brevo", "contacts", "ajouter des contacts", "j'ai déjà une liste", "j'ai 0 client", "aucun client", "consentement", "attestation", "rgpd import", "liste importée", "segment importé", "deux listes", "plusieurs fichiers"],
    path: "/owner/campaigns",
    snippet: "Bouton « Importer ma liste » en haut de la page Campagnes. Accepte un fichier CSV, un export d'un autre outil d'emailing, ou un simple copier-coller d'adresses : les colonnes (email, prénom, nom) sont détectées automatiquement quel que soit l'ordre ou le séparateur. Avant de valider, on donne un nom à la liste (prérempli avec le nom du fichier, modifiable) — c'est sous ce nom qu'on la retrouve ensuite au moment de choisir l'audience d'une campagne. Il faut aussi déclarer d'où vient le consentement et depuis quand la collecte a lieu, puis cocher une attestation — c'est obligatoire et c'est la pièce à produire si un destinataire conteste (RGPD). Les adresses en double, illisibles, ou déjà connues comme mortes sont écartées et comptées dans le rapport final. Une personne qui s'était désabonnée du club n'est JAMAIS réactivée par un import. Chaque fichier importé reste un segment à part : à l'écran Audience d'une campagne, la section « Listes importées » donne une case par liste, sous son nom (le crayon au bout de la ligne la renomme à tout moment), avec son effectif du moment, ce qui permet d'envoyer d'abord à une seule liste (par exemple les gens qui ont coché la newsletter) avant d'élargir aux autres. Les listes cochées se cumulent et se dédoublonnent.",
  },
  "email-bounces": {
    title: "Adresses mortes, plaintes et nettoyage de la liste",
    keywords: ["bounce", "rebond", "rebondi", "adresse morte", "adresse invalide", "adresse qui n'existe plus", "nettoyer ma liste", "nettoyage", "liste sale", "plainte", "indésirable", "signalé spam", "suppression", "liste de suppression", "pourquoi moins de destinataires", "boîte pleine", "envoi en pause", "pause automatique"],
    path: "/owner/campaigns",
    snippet: "Une adresse qui n'existe plus (bounce dur) ou une personne qui signale l'email comme indésirable sort de la base MARKETING toute seule et définitivement : elle entre dans la liste de suppression, son opt-in est coupé, et plus aucune campagne ni relance automatique ne la touche — chez ce club comme chez tous les autres. Le pro n'a rien à nettoyer ni à réimporter : la liste se nettoie en s'envoyant. Un bounce MOU (boîte pleine, serveur temporairement indisponible) ne supprime personne, c'est volontaire. Une confirmation de billet part TOUJOURS, même vers une adresse supprimée : la suppression ne filtre que le marketing. Conséquence directe : le premier envoi vers une base importée sert à deux choses, il mesure ce qu'elle vaut et il la nettoie — d'où l'intérêt de la montée en charge, qui limite la casse à 300 adresses le premier jour si la liste s'avère mauvaise. Le rapport de campagne affiche le nombre d'adresses mortes et de plaintes avec leur pourcentage. Au-delà de 0,2 % de plaintes ou 5 % d'adresses mortes, la campagne se met en pause automatiquement et demande une reprise explicite.",
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
    keywords: ["push", "notification", "notif", "automatique", "auto", "soirée live", "event live", "remerciement", "thank you", "rappel", "reminder", "bientôt complet", "sold out", "happy hour", "tables vip", "guest list", "campagne push", "programmer", "programmé", "planifier", "schedule", "meilleur créneau", "meilleur moment", "annuler un push"],
    path: "/owner/push",
    snippet: "La page Notifications push a DEUX familles bien séparées. 1) AUTOMATIQUES : tu actives un toggle, Yuno envoie tout seul au bon moment — Rappel jour J (6 h avant, aux acheteurs), La soirée commence (à l'ouverture, aux acheteurs), Remerciement (après la soirée, aux clients entrés), Bientôt complet (à 85 % de billets vendus, aux followers), Pré-commande boissons (l'après-midi, aux acheteurs), et trois automations CRM : Upsell table VIP (à J-2, aux détenteurs de billet SANS table — le plus gros panier de la nuit), Reconquête (client inactif depuis N jours, paramétrable 30/45/60/90, max une fois par trimestre par client) et Anniversaire (le jour J, une fois par an). Reconquête et Anniversaire respectent le plafond global de 3 push non transactionnels par client et par 24 h. Désactivées par défaut, chacune ne part qu'une fois par soirée et dans la langue de chaque client, et ne compte PAS dans la limite de 4 campagnes/24 h. 2) MANUELLES : tu composes et envoies un push ponctuel (Promotion, Happy hour, Dernières places, Tables VIP, Guest list, Concours ou message libre), en ciblant l'audience (acheteurs, clients entrés, followers, segment). L'envoi peut être immédiat ou PROGRAMMÉ à une date/heure précise ; Yuno suggère le meilleur créneau d'envoi calculé sur les habitudes de l'audience, et un push programmé reste annulable depuis l'historique tant qu'il n'est pas parti. Plafond 4 campagnes/24 h.",
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
    keywords: ["client", "customer", "crm", "segment", "rfm", "ban", "bannir", "fiche client", "historique", "export", "segment sauvegardé", "segment enregistré", "mes segments", "saved segment", "cibler un segment"],
    path: "/owner/customers",
    snippet: "La page Clients regroupe tous tes clients avec leur historique (visites, dépenses, panier moyen) et une segmentation automatique RFM (champions, fidèles, prometteurs, nouveaux, à risque, dormants, perdus — calculée côté serveur, la même que le ciblage push). Tu peux bannir un client par email — le videur est alerté si son billet est scanné. SEGMENTS SAUVEGARDÉS : compose des filtres (segment RFM, palier, récence, pilier, churn), puis « Enregistrer comme segment » — le segment devient réutilisable comme audience dans les push ET les campagnes email (toujours croisé avec l'opt-in newsletter pour l'email). Le contenu est dynamique : recalculé à chaque envoi, un client qui ne matche plus en sort tout seul. L'outil list_saved_segments te donne la liste et la taille live de chaque segment.",
  },
  "analytics": {
    title: "Analytics",
    keywords: ["analytics", "statistiques", "stats", "démographie", "audience", "origine", "villes", "âge", "funnel", "performance", "attach boisson", "temps de service", "par bar", "bilan par soirée", "rotation table", "réservé consommé", "anticipation des ventes", "revenu par tête", "piliers", "vue d'ensemble"],
    path: "/owner/analytics",
    snippet: "Analytics s'organise par pilier : une Vue d'ensemble (KPI, bilan par soirée, funnel, audience, trafic, règlement) puis un onglet plein écran par pilier de vente — Billetterie, Boissons, Tables VIP, Remboursements — chacun affichant son propre CA. Billetterie : attach boisson (billets avec conso incluse) et sa récupération, upgrades, fidélité, achat invité, et l'anticipation des ventes (à combien de jours de la soirée les billets partent). Boissons : temps de service médian, cycle de préparation (payées → prêtes → servies), performance par bar, CA par soirée. Tables VIP : réservé vs consommé (upsell au-delà du minimum), revenu par tête, taille des groupes, rotation des tables, top bouteilles et classement des hôtes. La Vue d'ensemble contient le « Bilan par soirée » : billets + boissons + tables + guest list + remboursements, une ligne nette par nuit. Après chaque soirée, une analyse post-event résume la performance.",
  },
  "analytics-guest-list": {
    title: "Analytics guest list",
    keywords: ["guest list", "guestlist", "invité", "invités", "no-show", "no show", "présence", "taux de présence", "remplissage", "quota", "peak time", "heure d'arrivée", "valeur invité", "rentabilité guest list", "guest list roi"],
    path: "/owner/analytics",
    snippet: "La zone Guest list d'Analytics répond à « est-ce que mes guest lists rapportent ? ». Elle donne le nombre d'inscrits, le taux de présence et de no-show, le remplissage vs quota (les listes illimitées en sont exclues), l'heure d'arrivée réelle à la porte avec le pic, et surtout la valeur par invité : ce qu'un invité consomme au bar et en VIP une fois entré. Un comparatif place l'invité guest list face au détenteur de billet payant sur les mêmes soirées. Le détail se décline par type d'invitation, genre, délai d'inscription et soirée par soirée. La liste « Par détenteur de liste » est un déroulant : en cliquant sur un promoteur, un DJ ou un organisateur, l'owner voit ses chiffres a lui — CA bar et VIP séparés, panier moyen, taux de conversion, no-show, remplissage de ses listes, heure de pic, courbe d'arrivées et meilleure soirée. C'est la vue qui permet de comparer deux promoteurs entre eux.",
  },
  "dj-booking": {
    title: "DJs & booking",
    keywords: ["dj", "booking", "booker", "résident", "line-up", "marketplace", "artiste", "réserver un dj", "app dj", "yuno pro dj", "dj sur téléphone", "dj app mobile"],
    path: "/owner/djs",
    snippet: "Gère tes DJs résidents depuis la page DJs (profils, sets, line-up des soirées). Pour trouver de nouveaux artistes, [Book DJ](/owner/book-dj) cherche dans la marketplace par ville, rayon, genre et cachet — envoie une demande de booking directement au DJ, qui est aussi poussé sur son téléphone (app Yuno Pro). Quand la demande est liée à une soirée, l'acceptation du DJ l'inscrit automatiquement au line-up public de l'événement (même mécanique que l'ajout au line-up depuis le formulaire de soirée) et tu es prévenu dans ta cloche de notifications. Côté DJ, chaque artiste de ton roster a son propre espace Yuno (ses dates tous clubs confondus, ses cachets en attente et réglés, ses demandes de booking, ses liens trackés), et cet espace s'ouvre dans l'APP YUNO PRO sur iPhone : il se connecte avec son compte, choisit « DJ » sur l'écran d'accueil, et travaille depuis son téléphone, protégé par son code PIN comme n'importe quel poste. Donc un set ajouté au calendrier, un cachet marqué payé ou une demande de booking envoyée lui arrivent sans qu'il ouvre un ordinateur — et la relance « cachet impayé » qu'il t'envoie part de cette même app.",
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
  "support-access": {
    title: "Assistance Yuno (accès assisté à ton compte)",
    keywords: ["assistance", "assistance yuno", "accès assisté", "acces assiste", "support access", "assisted access", "support", "aide à la configuration", "configurer à ma place", "yuno dans mon compte", "équipe yuno", "accorder l'accès", "couper l'accès", "révoquer", "revoquer", "revoke", "grant", "autorisation", "journal d'activité", "audit", "session support", "quelqu'un accède à mon compte", "sécurité accès", "yuno peut configurer mon compte", "configurer pour moi", "faire à ma place", "je n'ai pas le temps", "pas le temps de tout paramétrer", "demander de l'aide", "aidez-moi", "help me set up", "set up for me", "vous voyez mes coordonnées bancaires", "voir mon iban", "acces a mon argent", "qui a accès à mon compte", "invitation assistance"],
    path: "/owner/support-access",
    snippet: "Quand tu demandes un coup de main pour configurer ton compte, l'équipe Yuno t'envoie une DEMANDE d'accès assisté : elle arrive en notification et s'affiche dans Réglages → Assistance Yuno, et il ne se passe strictement rien tant que tu n'as pas cliqué « Accorder l'accès ». Une fois accordé, un membre de l'équipe Yuno peut ouvrir une session dans ton compte pour créer et modifier tes soirées, tes tarifs et tes créneaux, configurer guest lists, liens d'invitation, tables VIP et plan de salle, et compléter ton profil public (nom, logo, bio, liens). Ce qu'il ne peut PAS faire n'est pas une promesse mais un refus de la base de données : compte Stripe et coordonnées bancaires, virements et remboursements, cycle de règlement des promoteurs, email de connexion, code PIN, double authentification, suppression ou suspension du compte — chaque tentative est rejetée, y compris s'accorder plus d'accès. Chaque écriture faite pendant une session est journalisée et tu lis le journal sur cette même page (« Modifié · Guest list », horodaté), avec l'historique de tes autorisations passées. Les durées sont courtes et automatiques : l'autorisation expire au bout de 7 jours, une session au bout de 12 heures, et le bouton « Couper l'accès » arrête immédiatement toute session en cours — tu peux couper à tout moment, sans justification. Tant qu'une session est ouverte, une bannière « Assistance Yuno » reste affichée en permanence à l'écran : personne ne travaille dans ton compte en silence. La même page existe pour les managers (/manager/support-access) et pour les organisateurs (/organizer-app/support-access). Tu n'as pas besoin d'attendre qu'on te sollicite : le bouton « Demander à Yuno de tout configurer », sur cette page, ouvre l'accès immédiatement — ton clic vaut accord, il n'y a pas de second écran de confirmation. La proposition apparaît aussi à deux autres moments : en haut du guide de configuration pour un club, sur la dernière étape de l'onboarding pour un organisateur, et — si Yuno t'a invité — juste après l'activation de ton compte, avec le détail des garanties. Répondre « non merci » ne bloque rien : tu peux changer d'avis quand tu veux depuis Réglages → Assistance Yuno. À noter enfin : ton numéro SIRET, ta raison sociale et ton compte Stripe restent à remplir par toi — ce sont des actes qui engagent ton entreprise, la base les refuse à quiconque d'autre.",
  },
  "print-export-lists": {
    title: "Imprimer et exporter les listes (porte, complète, tableur)",
    keywords: ["imprimer", "impression", "print", "exporter", "export", "pdf", "csv", "tableur", "excel", "google sheets", "liste de porte", "door list", "feuille de porte", "liste papier", "imprimer la guest list", "imprimer les tables", "imprimer les billets", "liste complète", "télécharger la liste", "download list", "donner la liste au videur", "sans réseau", "papier"],
    path: "/owner/guest-list",
    snippet: "Le bouton « Imprimer / Exporter » sort une liste en PDF prêt à imprimer ou en tableur. Il vit à trois endroits : la page Guest list (choisis d'abord la soirée — l'export sort TOUTES les parts de la soirée), et Commandes dans les onglets Tables VIP et Billets (si plusieurs soirées sont listées, on te demande laquelle) ; ces deux onglets emportent le même bouton dans le tiroir d'une co-soirée. TROIS FORMATS, choisis selon qui va lire la feuille : 1) LISTE DE PORTE (PDF) — gros noms classés de A à Z avec un séparateur par lettre, une case à cocher devant chacun, deux colonnes par page, et ni email, ni téléphone, ni montants : c'est la feuille qu'on donne au videur sans exposer les données de tes clients. 2) LISTE COMPLÈTE (PDF) — toutes les colonnes en tableau paysage (contacts, statut, heures d'entrée, montants), pour toi et ton équipe, jamais pour la porte. 3) TABLEUR (CSV) — s'ouvre directement dans Excel ou Google Sheets, accents compris. L'export repart des données au moment du clic et ignore la recherche et les filtres affichés à l'écran : tu obtiens la soirée entière, pas ce que l'écran montre. Sur iPhone (app Yuno Pro) le fichier passe par la feuille de partage iOS — « Imprimer » (AirPrint) ou « Enregistrer dans Fichiers » ; sur le web il se télécharge. Les deux formats complets contiennent des données personnelles : le PDF porte une mention de confidentialité rappelant de le détruire après la soirée (RGPD) — c'est précisément pour ça que la liste de porte existe.",
  },
  "door-name-search": {
    title: "Faire entrer un invité par son nom (onglet Liste du videur)",
    keywords: ["videur", "bouncer", "porte", "door", "onglet liste", "liste", "recherche par nom", "chercher un nom", "search by name", "sans qr", "qr perdu", "billet perdu", "téléphone déchargé", "batterie", "faire entrer", "let in", "entrée manuelle", "check-in manuel", "manual check-in", "invité introuvable", "hors ligne", "offline", "sans réseau", "déjà entré"],
    path: "/owner/staff",
    snippet: "À côté du scanner, l'app du videur a un onglet « Liste » : il tape le début d'un nom (deux lettres minimum, accents et majuscules ignorés — « kev du » retrouve « Kevin Dupont ») et fait entrer la personne d'un tap. C'est la réponse au téléphone déchargé, au QR introuvable dans une boîte mail et à l'invité ajouté dix minutes avant : la porte ne s'arrête plus, et personne ne t'appelle. La liste est la MÊME que celle du scanner — invités de la guest list, porteurs de billets et tables de la soirée — et une entrée à la main est enregistrée EXACTEMENT comme un scan : heure limite d'entrée gratuite appliquée, doublon refusé, billet d'un autre club refusé, commission guest list du promoteur comptée pareil, et le nom du videur enregistré. En haut de l'écran il lit combien de personnes sont sur la liste et combien sont déjà entrées ; les gens pas encore entrés remontent en premier, et un nom déjà scanné affiche « Déjà entré » et ne peut pas repasser. Dans l'app Yuno Pro, l'onglet fonctionne aussi SANS RÉSEAU à partir de la copie de la liste téléchargée avant la soirée (badge « copie hors ligne »), donc un Wi-Fi qui tombe à 1 h du matin n'arrête pas la porte ; le bouton « Actualiser » recharge dès que ça revient. Important : cet onglet ne contourne aucune règle, il ne fait entrer que des gens DÉJÀ sur la liste — pour un invité de dernière minute, ajoute-le d'abord à la guest list, puis demande au videur d'actualiser.",
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
      name: "list_saved_segments",
      description: "List the venue's saved CRM segments (name + live customer count). Use when the owner asks about their segments, how many customers match one, or which segments exist.",
      parameters: { type: "object", properties: {}, required: [] },
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
  {
    type: "function",
    function: {
      name: "set_night_brief",
      description: "Write (or clear) tonight's staff brief. It shows on top of every staff screen (door, bar, cloakroom, VIP) with a push notification, and the owner sees who read it. Use when the owner wants to brief the team: dress code, pricing changes, priorities, banned guests. Empty body clears the brief.",
      parameters: {
        type: "object",
        properties: {
          body: { type: "string", description: "The brief text (max 800 chars). Empty string clears tonight's brief." },
        },
        required: ["body"],
      },
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
  "set_night_brief",
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
      case "list_saved_segments": {
        const { data: segs } = await supabase
          .from("venue_segments")
          .select("id, name, definition, created_at")
          .eq("venue_id", venueId)
          .order("created_at", { ascending: false })
          .limit(20);
        const withCounts = await Promise.all((segs || []).map(async (seg: { id: string; name: string; definition: unknown; created_at: string }) => {
          const { data: n } = await supabase.rpc("count_venue_segment", {
            p_venue_id: venueId, p_definition: seg.definition,
          });
          return {
            name: seg.name,
            customers_today: typeof n === "number" ? n : null,
            conditions: Array.isArray((seg.definition as { conditions?: unknown[] })?.conditions)
              ? ((seg.definition as { conditions: unknown[] }).conditions).length
              : 0,
            created_at: seg.created_at,
          };
        }));
        return JSON.stringify({ segments: withCounts, note: "Segments are dynamic: counts are computed live. Owners create them from Clients > filters > Save as segment, and target them in Push and Email campaigns." });
      }

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

      // ─── ÉQUIPE ───
      case "set_night_brief": {
        // Réplique d'upsert_staff_brief pour le client service-role (auth.uid()
        // absent) : le périmètre venue est déjà garanti par l'appelant.
        const body = (args.body || "").trim();
        const { data: nightDate } = await supabase.rpc("paris_night_date");
        if (!nightDate) return JSON.stringify({ error: "could not resolve night date" });

        if (!body) {
          await supabase.from("staff_briefs").delete().eq("venue_id", venueId).eq("night_date", nightDate);
          return JSON.stringify({ success: true, cleared: true });
        }
        if (body.length > 800) return JSON.stringify({ error: "Brief too long (800 chars max)" });

        const { data: venue } = await supabase.from("venues").select("owner_id").eq("id", venueId).maybeSingle();
        if (!venue) return JSON.stringify({ error: "Venue not found" });

        const { error: upErr } = await supabase.from("staff_briefs").upsert(
          { venue_id: venueId, night_date: nightDate, body, updated_by: venue.owner_id, updated_at: new Date().toISOString() },
          { onConflict: "venue_id,night_date" },
        );
        if (upErr) return JSON.stringify({ error: upErr.message });

        // Réveil du staff terrain, throttlé à 15 min (même règle que la RPC).
        const { data: lastNotif } = await supabase
          .from("staff_notifications").select("created_at")
          .eq("venue_id", venueId).eq("notification_type", "night_brief")
          .gte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
          .limit(1);
        if (!lastNotif?.length) {
          const rows = ["bouncer", "barman", "cloakroom", "vip_host"].map((role) => ({
            venue_id: venueId, target_role: role, notification_type: "night_brief",
            title: "Consigne du soir", message: body.slice(0, 180), priority: "high",
            metadata: { body_preview: body.slice(0, 140) },
          }));
          await supabase.from("staff_notifications").insert(rows);
        }
        return JSON.stringify({ success: true, night_date: nightDate, body_length: body.length });
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

    const conversationMessages: any[] = [
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
