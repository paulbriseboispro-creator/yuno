import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.83.0";

// Modèle OpenAI — changer ici suffit (clé : secret Supabase OPENAI_API_KEY)
const OPENAI_MODEL = "gpt-4o-mini";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════
// SYSTEM PROMPT — Condensé, strict, data-driven
// ═══════════════════════════════════════════

const AGENCY_SYSTEM_PROMPT = `Tu es Yuno Agency, le bras droit IA des chefs d'agences de promoteurs sur Yuno. Tutoie l'utilisateur. Réponds dans sa langue (français, anglais, espagnol).

═══ LE MODÈLE AGENCE ═══
Une agence a DEUX bras pilotés depuis un seul cockpit :
- Bras Yuno : clubs présents sur Yuno, liés par CONTRAT. Les promoteurs vendent des billets in-app via des liens trackés ; chaque vente crée une conversion (brut, marge agence, part promoteur).
- Bras externe : clubs hors Yuno. L'agence publie leurs soirées, Yuno redirige vers leur billetterie et mesure vues + clics (trafic), les commissions externes se déclarent à part.
L'identité publique (nom, logo, bio, réseaux) est MAÎTRE sur le profil agence et se synchronise vers les deux pages publiques : la page RP (/rp/slug, vitrine marketplace dans Yuno) et le linktree (/p/slug, lien de bio/QR).

═══ RÈGLE ABSOLUE ═══
Tu es un MOTEUR DE REQUÊTES, pas un chatbot.
- Pour TOUTE question factuelle (ventes, promoteurs, contrats, trafic, finance…) → APPELLE D'ABORD un tool.
- Si aucun tool ne peut répondre → dis "Je n'ai pas cette donnée."
- Tu ne DOIS JAMAIS inventer, deviner ou approximer un chiffre, un nom ou un statut.
- Les seules réponses sans tool : salutations, clarifications, explications de fonctionnement (via search_help_articles si besoin).

═══ FORMAT DE RÉPONSE ═══
1. Commence par le RÉSULTAT (chiffre, donnée, action)
2. Ajoute du CONTEXTE si pertinent
3. Suggère la PROCHAINE ACTION
Utilise du Markdown : **gras**, listes, tableaux.

═══ CONFIRMATION OBLIGATOIRE ═══
AVANT toute action qui MODIFIE des données (annonce à l'équipe, bio, tri du linktree) :
1. Résume ce que tu vas faire en **gras** (texte exact de l'annonce inclus)
2. Demande "**Tu confirmes ?**"
3. Exécute UNIQUEMENT après réponse affirmative ("oui", "ok", "go", "confirme")
⚠️ JAMAIS d'action write sans confirmation explicite.

═══ ARGENT ═══
- Présente toujours : à recevoir des clubs (conversions en attente), à reverser aux promoteurs, marge agence.
- Tu ne DÉCLENCHES JAMAIS un règlement, un virement ou un changement de statut financier. Le cycle de règlement (préparer → déclarer envoyé → le promoteur confirme) se fait uniquement sur [Finance](/agency-app/finance). Yuno ne touche jamais les fonds (virements SEPA de banque à banque).

═══ NAVIGATION ═══
Utilise des liens Markdown : [Tableau de bord](/agency-app), [Ma vitrine](/agency-app/vitrine), [Profil de l'agence](/agency-app/profile), [Promoteurs](/agency-app/promoters), [Groupes](/agency-app/groups), [Guest lists](/agency-app/guest-lists), [Contrats clubs](/agency-app/clubs), [Événements](/agency-app/events), [Stats de ventes](/agency-app/stats), [Graphiques](/agency-app/analytics), [Finance](/agency-app/finance), [Règles](/agency-app/rules), [Rémunération](/agency-app/pay), [Annonces](/agency-app/announcements), [Assignations](/affiliate/assignments), [Suivi](/affiliate/suivi), [Clubs externes](/affiliate/venues), [Soirées externes](/affiliate/events), [Analytics trafic](/affiliate/analytics), [Commissions externes](/affiliate/commissions), [Linktree & externe](/affiliate/settings), [Mode d'emploi](/agency-app/help)

═══ NE MÉLANGE JAMAIS ═══
- Question "comment ça marche" → search_help_articles
- Question "combien / quoi / qui" → tools data`;

// ═══════════════════════════════════════════
// HELP ARTICLES INDEX
// ═══════════════════════════════════════════

const HELP_ARTICLES: Record<string, { title: string; keywords: string[]; path: string; snippet: string }> = {
  "agency-model": {
    title: "Le modèle : une agence, deux bras",
    keywords: ["modèle", "model", "agence", "agency", "bras", "arm", "externe", "external", "cockpit", "comment ça marche", "overview", "structure"],
    path: "/agency-app",
    snippet: "L'agence pilote deux mondes depuis un cockpit unique. Bras Yuno : les clubs sur Yuno signent un contrat ; les promoteurs vendent in-app via des liens trackés, chaque vente est attribuée et la commission calculée. Bras externe : clubs hors Yuno ; l'agence publie leurs soirées, Yuno redirige vers leur billetterie et mesure vues/clics. L'identité, l'équipe et la vitrine publique sont communes aux deux bras.",
  },
  "showcase": {
    title: "Ma vitrine (pages publiques)",
    keywords: ["vitrine", "showcase", "page publique", "public page", "complétude", "checklist", "partager", "share", "adresse"],
    path: "/agency-app/vitrine",
    snippet: "Ma vitrine (menu Réglages) montre les deux pages publiques (page RP /rp/slug et linktree /p/slug) avec URLs à copier, une check-list de complétude en 8 points (slug, logo, bio, ville, réseau, club, soirée à venir, stats de confiance) et des raccourcis vers chaque éditeur. Règle de répartition : identité → Profil de l'agence ; adresse/tri/QR → Linktree & externe ; catalogue → Clubs externes / Soirées externes.",
  },
  "master-identity": {
    title: "L'identité maître (profil)",
    keywords: ["profil", "profile", "identité", "identity", "logo", "bio", "instagram", "tiktok", "whatsapp", "site web", "réseaux", "socials", "synchronisation", "sync"],
    path: "/agency-app/profile",
    snippet: "Nom, ville, bio, logo, Instagram, TikTok, WhatsApp et site web s'éditent UNIQUEMENT sur le profil de l'agence — chaque enregistrement se synchronise automatiquement vers la page RP, le linktree et les cartes RP des fiches soirée. L'email de contact reste privé (relances Finance). Les anciens champs identité de Linktree & externe sont des renvois vers le profil maître.",
  },
  "rp-page": {
    title: "La page RP (/rp/slug)",
    keywords: ["page rp", "rp", "marketplace", "fiche soirée", "event page", "interstitiel", "interstitial", "découverte", "carte rp"],
    path: "/agency-app/vitrine",
    snippet: "La page RP est la vitrine marketplace de l'agence dans Yuno : logo, bio, réseaux, clubs partenaires (contrats Yuno actifs + clubs externes) et soirées à venir des deux bras. Elle s'alimente toute seule. Le public y arrive par les cartes « RP » des fiches soirée. Un clic sur une soirée externe passe par un interstitiel avant la billetterie du club et compte dans le trafic.",
  },
  "linktree": {
    title: "Le linktree (/p/slug)",
    keywords: ["linktree", "slug", "adresse publique", "bio instagram", "qr", "qr code", "tri", "sort", "trust stats", "stats de confiance", "agenda"],
    path: "/affiliate/settings",
    snippet: "Le linktree est le lien unique de bio/stories/QR : identité, stats de confiance qui défilent, toutes les soirées à venir, agenda complet sur /p/slug/agenda. Le slug se choisit dans Linktree & externe et alimente AUSSI la page RP. Tri des soirées : par jour, par genre, par prix ou manuel ; les QR imprimables se génèrent dans la même page.",
  },
  "promoters": {
    title: "Promoteurs, groupes, invitations",
    keywords: ["promoteur", "promoter", "inviter", "invite", "roster", "équipe", "team", "groupe", "group", "membre"],
    path: "/agency-app/promoters",
    snippet: "Promoteurs liste le roster : invitation par lien, activation, rangement en groupes (ville, club, séniorité) pour assigner et communiquer en masse. Chaque promoteur a son espace avec ses soirées assignées, son lien tracké, son QR, sa guest list et ses gains — il ne voit jamais les marges de l'agence ni les chiffres des autres.",
  },
  "assignments": {
    title: "Assignations et suivi terrain",
    keywords: ["assigner", "assign", "assignation", "assignment", "suivi", "tracking", "terrain", "annonce", "announcement"],
    path: "/affiliate/assignments",
    snippet: "Les assignations distribuent chaque soirée à des promoteurs ou groupes ; une assignation active rend la soirée visible dans l'espace du promoteur avec son lien tracké (c'est la source de vérité partout). Le Suivi montre qui partage, vend, remplit sa guest list. Les Annonces envoient un message à toute l'équipe.",
  },
  "guest-lists": {
    title: "Guest lists d'agence",
    keywords: ["guest list", "guestlist", "liste d'invités", "quota", "part", "enveloppe", "porte", "door", "entrées"],
    path: "/agency-app/guest-lists",
    snippet: "Sur une soirée Yuno, le club peut ouvrir une part de guest list à l'agence (quota vide = illimité). L'agence la répartit entre ses promoteurs ; chaque nom est scanné à la porte comme une entrée Yuno et attribué au bon promoteur. Les modèles de rémunération peuvent auto-provisionner une part de guest list à chaque assignation.",
  },
  "rules-pay": {
    title: "Règles et modèles de rémunération",
    keywords: ["règles", "rules", "rémunération", "pay", "commission", "modèle", "template", "barème", "par tête", "par billet"],
    path: "/agency-app/pay",
    snippet: "Les modèles de rémunération définissent les barèmes (commission par billet, montant par tête en guest list, part de guest list auto-provisionnée) et s'appliquent à un promoteur ou un groupe ; chaque nouvelle assignation en hérite. Les Règles centralisent ce que les promoteurs peuvent faire (tri de leur linktree, visibilité…).",
  },
  "contracts": {
    title: "Contrats clubs Yuno",
    keywords: ["contrat", "contract", "club", "signature", "signer", "sign", "actif", "active", "pause", "commission club"],
    path: "/agency-app/clubs",
    snippet: "Le contrat fixe la commission de l'agence et ouvre tout : soirées assignables, ventes trackées, club affiché sur la page RP. Cycle : proposition → signature agence → contre-signature club → actif. Pause ou fin possibles des deux côtés, l'historique reste. Sans contrat actif, rien ne circule.",
  },
  "yuno-events": {
    title: "Soirées Yuno et liens trackés",
    keywords: ["soirée", "event", "événement", "yuno", "lien tracké", "tracked link", "vente", "billets", "tickets", "conversion"],
    path: "/agency-app/events",
    snippet: "Événements liste les soirées à venir des clubs sous contrat actif — le club publie, l'agence assigne et vend. Chaque promoteur a son lien personnel par soirée : billet vendu via son lien = conversion attribuée (brut, marge agence, part promoteur) visible dans Stats et Finance.",
  },
  "stats": {
    title: "Stats de ventes et graphiques",
    keywords: ["stats", "statistiques", "analytics", "ventes", "sales", "graphiques", "charts", "classement", "leaderboard", "performance"],
    path: "/agency-app/stats",
    snippet: "Stats de ventes agrège le bras Yuno : volume, commissions, détail par club, soirée et promoteur. Graphiques déroule les tendances. Le bras externe se lit dans Analytics trafic (vues, clics billetterie, conversions déclarées). Les deux ensemble constituent l'argumentaire de valeur auprès des clubs.",
  },
  "external-catalog": {
    title: "Clubs externes (catalogue)",
    keywords: ["club externe", "external club", "venue", "catalogue", "catalog", "hors yuno", "logo", "photos", "page club"],
    path: "/affiliate/venues",
    snippet: "Le catalogue référence les clubs hors Yuno avec logo, photo de couverture, description et réseaux ; chaque club a sa page publique. Ces clubs nourrissent la page RP (section clubs partenaires) et portent les soirées externes.",
  },
  "external-events": {
    title: "Soirées externes et récurrences",
    keywords: ["soirée externe", "external event", "billetterie externe", "récurrence", "recurring", "semaine", "week", "publier", "publish", "genres", "prix"],
    path: "/affiliate/events",
    snippet: "Une soirée externe (club, date, genres, prix, lien billetterie) publiée apparaît sur le linktree, la page RP et l'agenda public ; le clic vers la billetterie passe par l'interstitiel et compte dans le trafic. Les soirées hebdomadaires se créent une fois en modèle récurrent, la vue Semaine montre le planning.",
  },
  "traffic": {
    title: "Trafic et commissions externes",
    keywords: ["trafic", "traffic", "vues", "views", "clics", "clicks", "conversion externe", "commission externe", "facturation"],
    path: "/affiliate/analytics",
    snippet: "Analytics trafic mesure les vues des pages publiques et les clics vers les billetteries externes (30 jours, trafic interne filtré). Les commissions externes se déclarent et se suivent dans Commissions : c'est l'outil de facturation du bras externe auprès des clubs.",
  },
  "finance": {
    title: "Finance : les deux flux",
    keywords: ["finance", "argent", "money", "marge", "margin", "à recevoir", "receivable", "à reverser", "owed", "relance", "email"],
    path: "/agency-app/finance",
    snippet: "Finance montre : à recevoir des clubs (conversions en attente), à reverser aux promoteurs, et la marge agence. Détail club par club avec relance email en un geste. Yuno ne touche jamais les fonds : les virements sont SEPA de banque à banque, Yuno horodate et sécurise l'accord.",
  },
  "settlement": {
    title: "Régler un promoteur (cycle en 3 temps)",
    keywords: ["régler", "settle", "règlement", "payout", "virement", "iban", "référence", "confirmation", "accusé", "litige", "dispute"],
    path: "/agency-app/finance",
    snippet: "Cycle en trois temps : 1) Préparer — Finance calcule le dû, fournit IBAN et référence. 2) Déclarer — après le virement bancaire, l'agence le déclare envoyé avec sa référence. 3) Confirmer — le promoteur confirme la réception dans son app ; le cycle est clos et horodaté. Sans confirmation après un délai, le dossier passe en litige. Personne ne peut solder unilatéralement.",
  },
  "help-center": {
    title: "Mode d'emploi complet",
    keywords: ["mode d'emploi", "manuel", "guide", "aide", "help", "documentation", "tutoriel"],
    path: "/agency-app/help",
    snippet: "Le mode d'emploi complet de l'espace agence (menu Aide) couvre tout : le modèle, la vitrine publique, l'équipe, les clubs Yuno, les clubs externes et la finance — avec recherche, visuels et pas-à-pas en 3 langues.",
  },
};

// ═══════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_agency_overview",
      description: "KPIs de l'agence : à recevoir des clubs, à reverser aux promoteurs, marge, volume total, taille du roster, contrats actifs, taille du bras externe. À utiliser pour toute question générale de performance ou d'état.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_promoters",
      description: "Classement des promoteurs par volume de ventes (brut) sur une période. À utiliser pour 'meilleur promoteur', 'qui vend', 'classement'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["7d", "30d", "month", "all"], description: "Période (month = mois calendaire en cours)" },
          limit: { type: "number", description: "Nombre de promoteurs (défaut 10)" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_promoters",
      description: "Liste du roster : nom, code promo, club de rattachement, actif ou non, montant en attente de reversement, total déjà payé.",
      parameters: {
        type: "object",
        properties: { only_active: { type: "boolean", description: "Ne garder que les actifs" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contracts",
      description: "Contrats avec les clubs Yuno : club, statut (pending_signatures/active/paused/ended), commission, enveloppe guest list par défaut.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_yuno_events",
      description: "Soirées Yuno à venir des clubs sous contrat actif, avec le nombre de promoteurs assignés. À utiliser pour 'prochaines soirées', 'quoi ce week-end', 'soirées sans promoteur'.",
      parameters: {
        type: "object",
        properties: { days_ahead: { type: "number", description: "Horizon en jours (défaut 30)" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_external_events",
      description: "Soirées externes (clubs hors Yuno) à venir publiées par l'agence : nom, date, club, statut.",
      parameters: {
        type: "object",
        properties: { days_ahead: { type: "number", description: "Horizon en jours (défaut 30)" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_external_venues",
      description: "Catalogue des clubs externes : nom, ville, actif, logo/couverture renseignés ou non.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_traffic_stats",
      description: "Trafic du bras externe : vues des pages publiques et clics vers les billetteries externes sur une période (trafic interne exclu).",
      parameters: {
        type: "object",
        properties: { period: { type: "string", enum: ["7d", "30d", "90d"], description: "Période" } },
        required: ["period"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_finance_summary",
      description: "Détail financier : à recevoir par club (conversions en attente), à reverser par promoteur, marge réalisée. À utiliser pour toute question d'argent. Ne déclenche RIEN.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_showcase_status",
      description: "État de la vitrine publique : slug, URLs des deux pages (/rp et /p), et check-list de complétude (logo, bio, ville, réseaux, clubs, soirées, trust stats).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_announcements",
      description: "Dernières annonces envoyées à l'équipe de promoteurs.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "Nombre (défaut 5)" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_help_articles",
      description: "Recherche dans le mode d'emploi (fonctionnement de la plateforme). À utiliser pour toute question 'comment ça marche'.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Mots-clés de recherche" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_team_announcement",
      description: "ÉCRITURE — Envoie une annonce à toute l'équipe de promoteurs. Exige une confirmation explicite de l'utilisateur AVANT l'appel (montre le titre et le texte exacts).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titre court de l'annonce" },
          content: { type: "string", description: "Texte de l'annonce" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_agency_bio",
      description: "ÉCRITURE — Met à jour la bio publique de l'agence (synchronisée vers la page RP et le linktree). Exige une confirmation explicite AVANT l'appel (montre la nouvelle bio exacte).",
      parameters: {
        type: "object",
        properties: { bio: { type: "string", description: "Nouvelle bio (1-2 phrases)" } },
        required: ["bio"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_linktree_sort_mode",
      description: "ÉCRITURE — Change l'ordre des soirées sur le linktree public. Exige une confirmation explicite AVANT l'appel.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["by_day", "by_genre", "by_price", "custom"], description: "Mode de tri" },
        },
        required: ["mode"],
      },
    },
  },
];

const WRITE_TOOLS = new Set(["send_team_announcement", "update_agency_bio", "set_linktree_sort_mode"]);

function log(type: string, data: Record<string, any>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), type, ...data }));
}

function periodStart(period: string): string {
  const now = new Date();
  switch (period) {
    case "7d": { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
    case "30d": { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString(); }
    case "90d": { const d = new Date(now); d.setDate(d.getDate() - 90); return d.toISOString(); }
    case "month": { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(); }
    default: return "2020-01-01T00:00:00Z";
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function promoterDisplayName(p: any): string {
  const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return full || p.name || p.promo_code || "Promoteur";
}

// ═══════════════════════════════════════════
// TOOL EXECUTION
// ═══════════════════════════════════════════

type Ctx = { agencyId: string; affiliateId: string | null };

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  supabase: any,
  ctx: Ctx,
): Promise<string> {
  const { agencyId, affiliateId } = ctx;
  try {
    switch (toolName) {
      case "get_agency_overview": {
        const [convRes, promRes, ctrRes, venRes, evRes] = await Promise.all([
          supabase.from("agency_conversions").select("gross_amount, margin_amount, club_status").eq("agency_id", agencyId),
          supabase.from("promoters").select("id, is_active, pending_amount").eq("agency_id", agencyId),
          supabase.from("agency_venue_contracts").select("id, status").eq("agency_id", agencyId),
          affiliateId
            ? supabase.from("affiliate_venues").select("id", { count: "exact", head: true }).eq("affiliate_id", affiliateId).eq("is_active", true)
            : Promise.resolve({ count: 0 }),
          affiliateId
            ? supabase.from("affiliate_events").select("id", { count: "exact", head: true })
                .eq("affiliate_id", affiliateId).in("status", ["published", "featured"])
                .gte("event_date", new Date().toISOString().split("T")[0])
            : Promise.resolve({ count: 0 }),
        ]);
        const conversions = convRes.data ?? [];
        const promoters = promRes.data ?? [];
        const contracts = ctrRes.data ?? [];
        return JSON.stringify({
          receivable_from_clubs_eur: r2(conversions.filter((c: any) => c.club_status === "pending").reduce((s: number, c: any) => s + Number(c.gross_amount || 0), 0)),
          payable_to_promoters_eur: r2(promoters.reduce((s: number, p: any) => s + Number(p.pending_amount || 0), 0)),
          agency_margin_eur: r2(conversions.reduce((s: number, c: any) => s + Number(c.margin_amount || 0), 0)),
          gross_volume_eur: r2(conversions.reduce((s: number, c: any) => s + Number(c.gross_amount || 0), 0)),
          roster_count: promoters.length,
          active_promoters: promoters.filter((p: any) => p.is_active).length,
          active_contracts: contracts.filter((c: any) => c.status === "active").length,
          total_contracts: contracts.length,
          external_active_venues: venRes.count ?? 0,
          external_upcoming_events: evRes.count ?? 0,
        });
      }

      case "get_top_promoters": {
        const limit = Math.min(Number(args.limit) || 10, 25);
        const { data: convs } = await supabase
          .from("agency_conversions")
          .select("promoter_id, gross_amount, created_at")
          .eq("agency_id", agencyId)
          .gte("created_at", periodStart(args.period || "30d"));
        const byPromoter = new Map<string, number>();
        for (const c of convs ?? []) {
          if (!c.promoter_id) continue;
          byPromoter.set(c.promoter_id, (byPromoter.get(c.promoter_id) || 0) + Number(c.gross_amount || 0));
        }
        const { data: promoters } = await supabase
          .from("promoters")
          .select("id, first_name, last_name, name, promo_code, venues(name)")
          .eq("agency_id", agencyId);
        const ranked = (promoters ?? [])
          .map((p: any) => ({
            name: promoterDisplayName(p),
            promo_code: p.promo_code,
            venue: p.venues?.name ?? null,
            gross_eur: r2(byPromoter.get(p.id) || 0),
          }))
          .sort((a: any, b: any) => b.gross_eur - a.gross_eur)
          .slice(0, limit);
        return JSON.stringify({ period: args.period || "30d", top: ranked });
      }

      case "list_promoters": {
        let q = supabase
          .from("promoters")
          .select("first_name, last_name, name, promo_code, is_active, pending_amount, total_paid, venues(name)")
          .eq("agency_id", agencyId)
          .order("created_at", { ascending: false });
        if (args.only_active) q = q.eq("is_active", true);
        const { data } = await q;
        return JSON.stringify({
          count: (data ?? []).length,
          promoters: (data ?? []).map((p: any) => ({
            name: promoterDisplayName(p),
            promo_code: p.promo_code,
            venue: p.venues?.name ?? null,
            is_active: p.is_active,
            pending_eur: r2(Number(p.pending_amount || 0)),
            total_paid_eur: r2(Number(p.total_paid || 0)),
          })),
        });
      }

      case "list_contracts": {
        const { data } = await supabase
          .from("agency_venue_contracts")
          .select("status, override_type, override_value, agency_signed_at, club_signed_at, gl_default_quota, venues(name)")
          .eq("agency_id", agencyId)
          .order("created_at", { ascending: false });
        return JSON.stringify({
          contracts: (data ?? []).map((c: any) => ({
            club: c.venues?.name ?? "Club",
            status: c.status,
            commission: c.override_type ? `${c.override_value}${c.override_type === "percentage" ? "%" : "€"}` : null,
            agency_signed: !!c.agency_signed_at,
            club_signed: !!c.club_signed_at,
            guest_list_default_quota: c.gl_default_quota,
          })),
        });
      }

      case "list_yuno_events": {
        const { data } = await supabase.rpc("get_agency_upcoming_events", {
          p_agency_id: agencyId,
          p_days_ahead: Number(args.days_ahead) || 30,
        });
        return JSON.stringify({
          events: (data ?? []).map((e: any) => ({
            title: e.title,
            start_at: e.start_at,
            venue: e.venue_name,
            assigned_promoters: e.assigned_promoter_count,
          })),
        });
      }

      case "list_external_events": {
        if (!affiliateId) return JSON.stringify({ events: [], note: "Pas de bras externe provisionné." });
        const days = Number(args.days_ahead) || 30;
        const today = new Date().toISOString().split("T")[0];
        const limitDate = new Date();
        limitDate.setDate(limitDate.getDate() + days);
        const { data } = await supabase
          .from("affiliate_events")
          .select("name, event_date, start_time, status, affiliate_venues(name)")
          .eq("affiliate_id", affiliateId)
          .in("status", ["published", "featured"])
          .gte("event_date", today)
          .lte("event_date", limitDate.toISOString().split("T")[0])
          .order("event_date");
        return JSON.stringify({
          events: (data ?? []).map((e: any) => ({
            name: e.name,
            date: e.event_date,
            time: e.start_time,
            status: e.status,
            venue: (Array.isArray(e.affiliate_venues) ? e.affiliate_venues[0] : e.affiliate_venues)?.name ?? null,
          })),
        });
      }

      case "list_external_venues": {
        if (!affiliateId) return JSON.stringify({ venues: [], note: "Pas de bras externe provisionné." });
        const { data } = await supabase
          .from("affiliate_venues")
          .select("name, city, is_active, logo_url, cover_image_url")
          .eq("affiliate_id", affiliateId)
          .order("name");
        return JSON.stringify({
          venues: (data ?? []).map((v: any) => ({
            name: v.name,
            city: v.city,
            is_active: v.is_active,
            has_logo: !!v.logo_url,
            has_cover: !!v.cover_image_url,
          })),
        });
      }

      case "get_traffic_stats": {
        if (!affiliateId) return JSON.stringify({ note: "Pas de bras externe provisionné." });
        const since = periodStart(args.period || "30d");
        const [v, c] = await Promise.all([
          supabase.from("affiliate_visitor_sessions")
            .select("id", { count: "exact", head: true })
            .eq("affiliate_id", affiliateId).eq("is_internal", false)
            .gte("visited_at", since),
          supabase.from("affiliate_clicks")
            .select("id", { count: "exact", head: true })
            .eq("affiliate_id", affiliateId).eq("is_internal", false)
            .gte("clicked_at", since),
        ]);
        return JSON.stringify({
          period: args.period || "30d",
          page_views: v.count ?? 0,
          ticket_clicks: c.count ?? 0,
        });
      }

      case "get_finance_summary": {
        const [convRes, promRes] = await Promise.all([
          supabase.from("agency_conversions")
            .select("gross_amount, margin_amount, club_status, venue_id")
            .eq("agency_id", agencyId),
          supabase.from("promoters")
            .select("first_name, last_name, name, promo_code, pending_amount")
            .eq("agency_id", agencyId)
            .gt("pending_amount", 0),
        ]);
        const conversions = convRes.data ?? [];
        // Résolution des noms de clubs sans supposer de FK jointive.
        const venueIds = [...new Set(conversions.map((c: any) => c.venue_id).filter(Boolean))];
        const venueNames = new Map<string, string>();
        if (venueIds.length > 0) {
          const { data: venues } = await supabase.from("venues").select("id, name").in("id", venueIds);
          for (const v of venues ?? []) venueNames.set(v.id, v.name);
        }
        const byClub = new Map<string, number>();
        for (const c of conversions) {
          if (c.club_status !== "pending") continue;
          const club = venueNames.get(c.venue_id) ?? "Club";
          byClub.set(club, (byClub.get(club) || 0) + Number(c.gross_amount || 0));
        }
        return JSON.stringify({
          receivable_by_club: [...byClub.entries()].map(([club, eur]) => ({ club, eur: r2(eur) })),
          payable_by_promoter: (promRes.data ?? []).map((p: any) => ({
            promoter: promoterDisplayName(p),
            eur: r2(Number(p.pending_amount || 0)),
          })),
          margin_realized_eur: r2(conversions.reduce((s: number, c: any) => s + Number(c.margin_amount || 0), 0)),
          note: "Le règlement se fait UNIQUEMENT sur /agency-app/finance (cycle en 3 temps).",
        });
      }

      case "get_showcase_status": {
        const { data: agency } = await supabase
          .from("agencies")
          .select("name, city, bio, logo_url, instagram_url, tiktok_url, website_url")
          .eq("id", agencyId)
          .maybeSingle();
        let arm: any = null;
        let venuesCount = 0;
        let eventsCount = 0;
        if (affiliateId) {
          const today = new Date().toISOString().split("T")[0];
          const [a, v, e] = await Promise.all([
            supabase.from("affiliates").select("linktree_slug, trust_stats").eq("id", affiliateId).maybeSingle(),
            supabase.from("affiliate_venues").select("id", { count: "exact", head: true }).eq("affiliate_id", affiliateId).eq("is_active", true),
            supabase.from("affiliate_events").select("id", { count: "exact", head: true })
              .eq("affiliate_id", affiliateId).in("status", ["published", "featured"]).gte("event_date", today),
          ]);
          arm = a.data;
          venuesCount = v.count ?? 0;
          eventsCount = e.count ?? 0;
        }
        const slug = arm?.linktree_slug ?? null;
        return JSON.stringify({
          slug,
          rp_page_url: slug ? `https://yunoapp.eu/rp/${slug}` : null,
          linktree_url: slug ? `https://yunoapp.eu/p/${slug}` : null,
          checklist: {
            has_slug: !!slug,
            has_logo: !!agency?.logo_url,
            has_bio: !!agency?.bio?.trim(),
            has_city: !!agency?.city?.trim(),
            has_social: !!(agency?.instagram_url || agency?.tiktok_url || agency?.website_url),
            has_club: venuesCount > 0,
            has_upcoming_external_event: eventsCount > 0,
            has_trust_stats: Array.isArray(arm?.trust_stats) && arm.trust_stats.length > 0,
          },
        });
      }

      case "get_recent_announcements": {
        const { data } = await supabase
          .from("promoter_announcements")
          .select("title, content, created_at")
          .eq("agency_id", agencyId)
          .order("created_at", { ascending: false })
          .limit(Math.min(Number(args.limit) || 5, 20));
        return JSON.stringify({ announcements: data ?? [] });
      }

      case "search_help_articles": {
        const query = String(args.query || "").toLowerCase();
        const words = query.split(/\s+/).filter((w: string) => w.length > 2);
        const scored = Object.entries(HELP_ARTICLES)
          .map(([id, article]) => {
            let score = 0;
            for (const w of words) {
              if (article.title.toLowerCase().includes(w)) score += 3;
              if (article.keywords.some((k) => k.toLowerCase().includes(w) || w.includes(k.toLowerCase()))) score += 2;
              if (article.snippet.toLowerCase().includes(w)) score += 1;
            }
            return { id, article, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        if (scored.length === 0) {
          return JSON.stringify({ results: [], note: "Aucun article trouvé. Renvoyer vers /agency-app/help." });
        }
        return JSON.stringify({
          results: scored.map(({ article }) => ({
            title: article.title,
            path: article.path,
            content: article.snippet,
          })),
        });
      }

      case "send_team_announcement": {
        const title = String(args.title || "").trim();
        const content = String(args.content || "").trim();
        if (!title || !content) return JSON.stringify({ error: "title_and_content_required" });
        const { error } = await supabase
          .from("promoter_announcements")
          .insert({ agency_id: agencyId, title: title.slice(0, 120), content: content.slice(0, 2000) });
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, title });
      }

      case "update_agency_bio": {
        const bio = String(args.bio || "").trim().slice(0, 300);
        if (!bio) return JSON.stringify({ error: "bio_required" });
        // Le trigger de synchro propage vers le bras externe et les pages publiques.
        const { error } = await supabase.from("agencies").update({ bio }).eq("id", agencyId);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, bio });
      }

      case "set_linktree_sort_mode": {
        if (!affiliateId) return JSON.stringify({ error: "no_external_arm" });
        const mode = String(args.mode || "");
        if (!["by_day", "by_genre", "by_price", "custom"].includes(mode)) {
          return JSON.stringify({ error: "invalid_mode" });
        }
        const { error } = await supabase.from("affiliates").update({ linktree_sort_mode: mode }).eq("id", affiliateId);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, mode });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    log("tool_error", { tool: toolName, error: String(e) });
    return JSON.stringify({ error: "Tool execution failed" });
  }
}

// ═══════════════════════════════════════════
// HTTP HANDLER
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

    // Autorisation : rôle agency + propriété de la ligne agencies.
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isAgency = roles?.some((r: any) => r.role === "agency");
    if (!isAgency) {
      return new Response(JSON.stringify({ error: "Agency role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: agencyRow } = await supabase
      .from("agencies")
      .select("id, name, is_active")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!agencyRow) {
      return new Response(JSON.stringify({ error: "No agency found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (agencyRow.is_active === false) {
      return new Response(JSON.stringify({ error: "Agency deactivated" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agencyId = agencyRow.id as string;
    const { data: arm } = await supabase
      .from("affiliates")
      .select("id")
      .eq("agency_id", agencyId)
      .maybeSingle();
    const ctx: Ctx = { agencyId, affiliateId: (arm?.id as string) ?? null };

    const body = await req.json();
    const { messages, agencyContext } = body;
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filtre défensif : jamais de message system côté client, historique borné.
    const safeMessages = messages
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-30)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    let contextBlock = `\n\n📍 CONTEXTE :\n- Agence : ${agencyRow.name}`;
    if (agencyContext?.currentPage) contextBlock += `\n- Page actuelle : ${agencyContext.currentPage}`;
    contextBlock += `\n- Date : ${new Date().toISOString().split("T")[0]}`;

    const systemPrompt = AGENCY_SYSTEM_PROMPT + contextBlock;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const aiHeaders = {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    };

    log("request_start", { agency_id: agencyId, msg_count: safeMessages.length });

    // ═══ Boucle multi-tours (max 3) — même mécanique qu'owner-assistant ═══
    const conversationMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...safeMessages,
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

      // Pas de tool call → réponse finale, emballée en SSE single-chunk.
      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        const finalContent = choice?.message?.content || "";
        log("final_answer", { round, content_length: finalContent.length });
        const ssePayload = `data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(ssePayload, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      const toolCalls = choice.message.tool_calls;
      log("tool_calls", { round, tools: toolCalls.map((tc: any) => tc.function.name) });
      conversationMessages.push(choice.message);

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        let fnArgs: Record<string, any> = {};
        try { fnArgs = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }

        log("tool_exec", { round, tool: fnName, args: fnArgs });
        const result = await executeTool(fnName, fnArgs, supabase, ctx);
        log("tool_result", { round, tool: fnName, result_length: result.length });

        conversationMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });

        if (WRITE_TOOLS.has(fnName)) {
          try {
            await supabase.from("agency_ai_audit_log").insert({
              user_id: user.id,
              agency_id: agencyId,
              tool_name: fnName,
              tool_args: fnArgs,
              result: result.substring(0, 1000),
            });
          } catch { /* l'audit ne doit pas casser la réponse */ }
        }
      }
    }

    // Tours épuisés → stream final sans tools.
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
