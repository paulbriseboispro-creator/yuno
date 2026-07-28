// Notifications push AUTOMATIQUES — registre plateforme piloté par le super
// admin (/admin/notifications, table platform_notification_settings).
//
// Toute notification push envoyée automatiquement par le système (achat,
// remboursement, commande prête, rappels, marketing…) passe par sendAutoPush() :
//   1. GATE    : le toggle global du type est lu (ligne absente = activé,
//                fail-open — une transactionnelle ne meurt jamais d'un seed
//                oublié). Cache mémoire 60 s par instance.
//   2. TEXTE   : rendu dans la langue du destinataire (profiles.preferred_language,
//                défaut fr) depuis le catalogue AUTO_PUSH ci-dessous — miroir du
//                pattern _shared/push-automations.ts.
//   3. ENVOI   : relay send-push-notification (service role), APNs iOS.
//   4. TRACKING: auto_push_events (sent/failed) + notification_log (anti-spam).
//                Le clic est attribué via ?an=<key> dans l'URL, loggé côté
//                client par PushClickTracker (miroir du ?pc= des campagnes).
//
// Les push auto en FAN-OUT (automatisations club, nouvel événement) ne passent
// pas par ici : ils utilisent la mécanique campagnes (push-automations.ts) dont
// le tracking est déjà complet. La RPC get_auto_push_stats() agrège les deux.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export type AutoPushLang = "fr" | "en" | "es";
type Tpl = { title: string; body: string };
type TplByLang = Record<AutoPushLang, Tpl>;

// Une personne peut avoir les DEUX apps sur le même téléphone (un patron de club
// est aussi un client). Sans audience explicite, le relay livrait sur toutes ses
// plateformes et la même notif arrivait en double, sur Yuno ET sur Yuno Pro.
// Chaque clé déclare donc l'app à laquelle elle appartient :
//   client → app Yuno (platform 'ios')      : billets, boissons, marketing…
//   pro    → app Yuno Pro (platform 'ios_pro') : règlements, exploitation…
export type PushAudience = "client" | "pro";

/** Plateformes push correspondant à une audience (colonne push_subscriptions.platform). */
export function audiencePlatforms(audience: PushAudience): string[] {
  return audience === "pro" ? ["ios_pro"] : ["ios"];
}

type AutoPushDef = {
  // Type écrit dans notification_log — les caps anti-spam existants comptent
  // sur ces valeurs ('marketing'/'campaign'/'reminder' pour les plafonds).
  logType: "transactional" | "reminder" | "marketing" | "dj_lineup";
  // App destinataire — jamais les deux (cf. PushAudience).
  audience: PushAudience;
  variants: Record<string, TplByLang>;
};

export const AUTO_PUSH: Record<string, AutoPushDef> = {
  // ── Collaborations club ↔ organisateur ──────────────────────────────────
  // Un avenant est une demande de SIGNATURE : sans push, le partenaire ne la
  // découvre qu'en ouvrant sa page Collaborations par hasard.
  collab_amendment_proposed: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Avenant à signer ✍️", body: "{partner} propose de modifier la répartition sur {subject}." },
        en: { title: "Amendment to sign ✍️", body: "{partner} proposes changing the split on {subject}." },
        es: { title: "Adenda por firmar ✍️", body: "{partner} propone cambiar el reparto en {subject}." },
      },
    },
  },
  collab_amendment_signed: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Avenant signé ✅", body: "{partner} a signé l'avenant sur {subject}. Les nouvelles conditions s'appliquent." },
        en: { title: "Amendment signed ✅", body: "{partner} signed the amendment on {subject}. The new terms now apply." },
        es: { title: "Adenda firmada ✅", body: "{partner} firmó la adenda en {subject}. Las nuevas condiciones ya se aplican." },
      },
    },
  },
  // Récap hebdo poussé au pro : l'habitude qui donne une raison de faire plus d'events.
  audience_weekly_recap: {
    logType: "reminder",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Ta semaine sur Yuno 📊", body: "+{followers} abonnés, {pushes} push, {revenue} de ventes cette semaine." },
        en: { title: "Your week on Yuno 📊", body: "+{followers} subscribers, {pushes} pushes, {revenue} in sales this week." },
        es: { title: "Tu semana en Yuno 📊", body: "+{followers} suscriptores, {pushes} push, {revenue} en ventas esta semana." },
      },
    },
  },
  purchase_ticket: {
    logType: "transactional",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Billet confirmé 🎟️", body: "{date} – {event}. Ton QR est prêt." },
        en: { title: "Ticket confirmed 🎟️", body: "{date} – {event}. Your QR is ready." },
        es: { title: "Entrada confirmada 🎟️", body: "{date} – {event}. Tu QR está listo." },
      },
    },
  },
  purchase_table: {
    logType: "transactional",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Table confirmée 🥂", body: "VIP – {event} – {amount}€" },
        en: { title: "Table confirmed 🥂", body: "VIP – {event} – {amount}€" },
        es: { title: "Mesa confirmada 🥂", body: "VIP – {event} – {amount}€" },
      },
    },
  },
  order_ready: {
    logType: "transactional",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Ta commande est prête 🍹", body: "Récupère-la au bar avec le code {pin}." },
        en: { title: "Your order is ready 🍹", body: "Pick it up at the bar with code {pin}." },
        es: { title: "Tu pedido está listo 🍹", body: "Recógelo en la barra con el código {pin}." },
      },
      nopin: {
        fr: { title: "Ta commande est prête 🍹", body: "Récupère-la au bar." },
        en: { title: "Your order is ready 🍹", body: "Pick it up at the bar." },
        es: { title: "Tu pedido está listo 🍹", body: "Recógelo en la barra." },
      },
    },
  },
  refund_confirmed: {
    logType: "transactional",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Remboursement traité 💸", body: "{amount}€ remboursés sur ton moyen de paiement." },
        en: { title: "Refund processed 💸", body: "{amount}€ refunded to your payment method." },
        es: { title: "Reembolso procesado 💸", body: "{amount}€ devueltos a tu método de pago." },
      },
    },
  },
  guest_list_added: {
    logType: "transactional",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Tu es sur la guest list ✨", body: "{event} – ton QR d'entrée t'attend dans l'app." },
        en: { title: "You're on the guest list ✨", body: "{event} – your entry QR is waiting in the app." },
        es: { title: "Estás en la guest list ✨", body: "{event} – tu QR de entrada te espera en la app." },
      },
    },
  },
  event_reminder_4h: {
    logType: "reminder",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Ce soir à {time} 🔥", body: "{event} – Entrée rapide avec ton QR." },
        en: { title: "Tonight at {time} 🔥", body: "{event} – Fast entry with your QR." },
        es: { title: "Esta noche a las {time} 🔥", body: "{event} – Entrada rápida con tu QR." },
      },
    },
  },
  event_reminder_30m: {
    logType: "reminder",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Ouverture dans 30 min 🎶", body: "{event} – Évite la file, ton QR est prêt." },
        en: { title: "Doors open in 30 min 🎶", body: "{event} – Skip the line, your QR is ready." },
        es: { title: "Apertura en 30 min 🎶", body: "{event} – Evita la cola, tu QR está listo." },
      },
    },
  },
  waitlist_presale: {
    logType: "transactional",
    audience: "client",
    variants: {
      default: {
        fr: { title: "🎉 Billets disponibles !", body: "Les billets pour {event} sont en vente. Tu as un accès prioritaire !" },
        en: { title: "🎉 Tickets available!", body: "Tickets for {event} are on sale. You have priority access!" },
        es: { title: "🎉 ¡Entradas disponibles!", body: "Las entradas para {event} están a la venta. ¡Tienes acceso prioritario!" },
      },
    },
  },
  cart_abandonment: {
    logType: "marketing",
    audience: "client",
    variants: {
      ticket: {
        fr: { title: "Toujours dispo 🎟️", body: "Tes billets pour {event} sont encore disponibles." },
        en: { title: "Still available 🎟️", body: "Your tickets for {event} are still available." },
        es: { title: "Aún disponible 🎟️", body: "Tus entradas para {event} siguen disponibles." },
      },
      drinks: {
        fr: { title: "Finaliser ta commande ? 🍹", body: "Tes cocktails sont toujours dans ton panier." },
        en: { title: "Finish your order? 🍹", body: "Your cocktails are still in your cart." },
        es: { title: "¿Terminas tu pedido? 🍹", body: "Tus cócteles siguen en tu carrito." },
      },
    },
  },
  inactivity_reminder: {
    logType: "marketing",
    audience: "client",
    variants: {
      default: {
        fr: { title: "On ne t'a pas vu récemment 👋", body: "Nouvelle programmation ce mois-ci. Découvre les prochaines soirées." },
        en: { title: "We haven't seen you lately 👋", body: "New lineup this month. Check out the upcoming nights." },
        es: { title: "Hace tiempo que no te vemos 👋", body: "Nueva programación este mes. Descubre las próximas fiestas." },
      },
    },
  },
  weekly_digest: {
    logType: "marketing",
    audience: "client",
    variants: {
      default: {
        fr: { title: "Ton week-end commence ici 🎉", body: "{events} ce week-end. Découvre la programmation." },
        en: { title: "Your weekend starts here 🎉", body: "{events} this weekend. Check out the lineup." },
        es: { title: "Tu finde empieza aquí 🎉", body: "{events} este fin de semana. Descubre la programación." },
      },
    },
  },
  // ── Découverte (relance de TOUS les membres, par goûts + ville) ───────────
  // Personnalisé : nomme UNE soirée qui colle aux goûts (TasteQuiz) et à la
  // ville, et laisse entendre qu'il y en a d'autres. Envoyé par le cron
  // weekly-digest (lundi → week, jeudi → weekend). Vars: {city}, {event}.
  discovery_weekend: {
    logType: "marketing",
    audience: "client",
    variants: {
      default: {
        fr: { title: "🎉 Ce week-end à {city}", body: "{event} et d'autres soirées pour toi. Découvre." },
        en: { title: "🎉 This weekend in {city}", body: "{event} and more nights for you. Take a look." },
        es: { title: "🎉 Este finde en {city}", body: "{event} y más noches para ti. Échale un ojo." },
      },
    },
  },
  discovery_week: {
    logType: "marketing",
    audience: "client",
    variants: {
      default: {
        fr: { title: "🎶 Cette semaine à {city}", body: "{event} pourrait te plaire. Découvre les soirées près de toi." },
        en: { title: "🎶 This week in {city}", body: "{event} might be your vibe. Discover nights near you." },
        es: { title: "🎶 Esta semana en {city}", body: "{event} puede que te guste. Descubre noches cerca de ti." },
      },
    },
  },
  // ── Découverte « cerveau unique » (Taste Engine) ─────────────────────────
  // Reco par vecteur de goût fusionné (quiz + comportement), envoi ADAPTATIF.
  // Le cron weekly-digest fait tourner les variantes ci-dessous. Vars :
  // {count} (nb de soirées), {genres} (ex. « House, Open Format »), {event}
  // (titre de la meilleure), {city}. Le sender fournit toujours les quatre.
  taste_discovery: {
    logType: "marketing",
    audience: "client",
    variants: {
      genres_led: {
        fr: { title: "{count} soirées faites pour toi 🎯", body: "{genres} près de toi. On a trié les meilleures." },
        en: { title: "{count} nights made for you 🎯", body: "{genres} near you. We picked the best ones." },
        es: { title: "{count} fiestas hechas para ti 🎯", body: "{genres} cerca de ti. Elegimos las mejores." },
      },
      event_led: {
        fr: { title: "{event} pourrait te plaire 🔥", body: "Et {count} autres soirées taillées pour tes goûts." },
        en: { title: "{event} might be your thing 🔥", body: "Plus {count} more nights cut for your taste." },
        es: { title: "{event} puede ser lo tuyo 🔥", body: "Y {count} fiestas más a tu medida." },
      },
      city_led: {
        fr: { title: "Ta semaine à {city} 🌃", body: "{count} soirées {genres} qu'on a choisies pour toi." },
        en: { title: "Your week in {city} 🌃", body: "{count} {genres} nights we picked for you." },
        es: { title: "Tu semana en {city} 🌃", body: "{count} fiestas {genres} elegidas para ti." },
      },
      curated: {
        fr: { title: "Sélection maison pour toi ✨", body: "{count} soirées {genres}. Rien au hasard." },
        en: { title: "Hand-picked for you ✨", body: "{count} {genres} nights. Nothing random." },
        es: { title: "Selección para ti ✨", body: "{count} fiestas {genres}. Nada al azar." },
      },
      fomo: {
        fr: { title: "Tu vas vouloir être là 👀", body: "{event} et {count} soirées faites pour tes goûts." },
        en: { title: "You'll want to be there 👀", body: "{event} and {count} nights made for your taste." },
        es: { title: "Vas a querer estar ahí 👀", body: "{event} y {count} fiestas para tus gustos." },
      },
      direct: {
        fr: { title: "{genres}, ça te parle ? 🎧", body: "{count} soirées pour toi, près de chez toi." },
        en: { title: "{genres} — your sound? 🎧", body: "{count} nights for you, close to home." },
        es: { title: "{genres}, ¿te suena? 🎧", body: "{count} fiestas para ti, cerca de ti." },
      },
      agenda: {
        fr: { title: "De quoi remplir ton agenda 📅", body: "{count} soirées {genres} triées pour toi." },
        en: { title: "Fill up your calendar 📅", body: "{count} {genres} nights sorted for you." },
        es: { title: "Llena tu agenda 📅", body: "{count} fiestas {genres} para ti." },
      },
      profile: {
        fr: { title: "On commence à te connaître 😏", body: "{count} soirées {genres} qui collent à ton profil." },
        en: { title: "We're getting to know you 😏", body: "{count} {genres} nights that fit your profile." },
        es: { title: "Ya te vamos conociendo 😏", body: "{count} fiestas {genres} que encajan contigo." },
      },
    },
  },

  // ── Cycle de règlement promoteur ─────────────────────────────────────────
  // Le seul push réellement indispensable est `promoter_payout_declared` : sans
  // lui, le promoteur ne sait pas qu'on attend son accusé de réception, et le
  // lot part en litige tout seul au bout de quelques jours.
  // ── Vie du promoteur (app Yuno Pro) ──────────────────────────────────────
  // Alimentees par la file promoter_push_queue : la coalescence a lieu a
  // l'insertion, pas ici. Un soir de grosse vente, `promoter_sale_first` part
  // une fois et c'est `promoter_night_digest` qui raconte la nuit le lendemain.
  promoter_sale_first: {
    logType: "reminder",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Ca demarre 🔥", body: "Premiere vente de la soiree : +{amount}€ de commission." },
        en: { title: "It's started 🔥", body: "First sale of the night: +{amount}€ commission." },
        es: { title: "Ha empezado 🔥", body: "Primera venta de la noche: +{amount}€ de comision." },
      },
    },
  },
  promoter_night_digest: {
    logType: "reminder",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Ta soiree en resume 🌙", body: "{count} ventes, {amount}€ de commissions." },
        en: { title: "Your night, wrapped 🌙", body: "{count} sales, {amount}€ in commissions." },
        es: { title: "Tu noche en resumen 🌙", body: "{count} ventas, {amount}€ en comisiones." },
      },
    },
  },
  promoter_goal_reached: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Objectif atteint 🎯", body: "{event} : tu as passe la barre des {goal} entrees." },
        en: { title: "Goal reached 🎯", body: "{event}: you passed the {goal} entries mark." },
        es: { title: "Objetivo alcanzado 🎯", body: "{event}: has superado las {goal} entradas." },
      },
    },
  },
  promoter_team_override: {
    logType: "reminder",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Ton equipe rapporte 👥", body: "+{amount}€ de commission d'equipe aujourd'hui." },
        en: { title: "Your team is delivering 👥", body: "+{amount}€ in team commission today." },
        es: { title: "Tu equipo rinde 👥", body: "+{amount}€ de comision de equipo hoy." },
      },
    },
  },
  promoter_announcement: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "{sender} t'a ecrit 📣", body: "{title}" },
        en: { title: "{sender} posted 📣", body: "{title}" },
        es: { title: "{sender} te ha escrito 📣", body: "{title}" },
      },
    },
  },
  promoter_event_assigned: {
    logType: "reminder",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Nouvelle soiree pour toi 🎟️", body: "{event} — {date}. Ton lien est deja actif." },
        en: { title: "A new night for you 🎟️", body: "{event} — {date}. Your link is already live." },
        es: { title: "Nueva fiesta para ti 🎟️", body: "{event} — {date}. Tu enlace ya esta activo." },
      },
    },
  },
  promoter_commission_cancelled: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Commission annulee", body: "{count} vente(s) remboursee(s) : -{amount}€ sur ton solde." },
        en: { title: "Commission cancelled", body: "{count} sale(s) refunded: -{amount}€ off your balance." },
        es: { title: "Comision anulada", body: "{count} venta(s) reembolsada(s): -{amount}€ de tu saldo." },
      },
    },
  },
  promoter_payout_declared: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Virement déclaré 💸", body: "{payer} déclare t'avoir versé {amount}€. Confirme la réception dans l'app." },
        en: { title: "Transfer declared 💸", body: "{payer} says they paid you {amount}€. Confirm receipt in the app." },
        es: { title: "Transferencia declarada 💸", body: "{payer} declara haberte pagado {amount}€. Confirma la recepción en la app." },
      },
    },
  },
  promoter_payout_reminder: {
    logType: "reminder",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Tu as reçu {amount}€ ?", body: "{payer} attend ton accusé de réception. Sans réponse, le règlement passe en litige." },
        en: { title: "Did you receive {amount}€?", body: "{payer} is waiting for your acknowledgement. Without an answer it turns into a dispute." },
        es: { title: "¿Recibiste {amount}€?", body: "{payer} espera tu acuse de recibo. Sin respuesta, la liquidación pasa a disputa." },
      },
    },
  },
  // Destiné au club : son promoteur a confirmé, la dette est soldée des deux
  // côtés et le reçu contresigné est disponible.
  promoter_payout_confirmed: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Règlement confirmé ✅", body: "{promoter} a accusé réception de {amount}€. Reçu disponible." },
        en: { title: "Settlement confirmed ✅", body: "{promoter} acknowledged receipt of {amount}€. Receipt available." },
        es: { title: "Liquidación confirmada ✅", body: "{promoter} acusó recibo de {amount}€. Recibo disponible." },
      },
    },
  },
  promoter_payout_disputed: {
    logType: "transactional",
    audience: "pro",
    variants: {
      default: {
        fr: { title: "Litige sur un règlement ⚠️", body: "{promoter} ne trouve pas le virement de {amount}€. Vérifie la référence {reference}." },
        en: { title: "Settlement disputed ⚠️", body: "{promoter} cannot find the {amount}€ transfer. Check reference {reference}." },
        es: { title: "Liquidación en disputa ⚠️", body: "{promoter} no encuentra la transferencia de {amount}€. Comprueba la referencia {reference}." },
      },
    },
  },
};

// ───────────────────────────────────────────────────────────────────────────

// Valeur de variable : chaîne unique, ou déclinée par langue ({fr, en, es}).
export type AutoPushVar = string | Record<AutoPushLang, string>;

function renderText(text: string, vars: Record<string, AutoPushVar>, lang: AutoPushLang): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    const value = typeof v === "string" ? v : (v[lang] ?? v.fr ?? "");
    out = out.split(`{${k}}`).join(value);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function renderAutoTpl(
  key: string,
  lang: AutoPushLang,
  vars: Record<string, AutoPushVar>,
  variant = "default",
): Tpl | null {
  const def = AUTO_PUSH[key];
  const tpl = def?.variants[variant]?.[lang] ?? def?.variants[variant]?.fr;
  if (!tpl) return null;
  return { title: renderText(tpl.title, vars, lang), body: renderText(tpl.body, vars, lang) };
}

/**
 * Date « sam. 21 juin » déclinée dans les trois langues (pour les vars par langue).
 * Le mois est indispensable : un push part dans les 48 h suivant la création de
 * la soirée, qui peut avoir lieu des mois plus tard — « samedi 21 » seul laissait
 * croire à la semaine en cours. Format court pour tenir dans une ligne de notif.
 */
export function localizedDate(iso: string | null | undefined): Record<AutoPushLang, string> {
  if (!iso) return { fr: "", en: "", es: "" };
  const d = new Date(iso);
  const fmt = (locale: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(d);
    } catch {
      return "";
    }
  };
  return { fr: fmt("fr-FR"), en: fmt("en-GB"), es: fmt("es-ES") };
}

/** Ajoute le paramètre d'attribution de clic ?an=<key> (nettoyé par PushClickTracker). */
export function autoTrackUrl(url: string, key: string): string {
  return url.includes("?") ? `${url}&an=${key}` : `${url}?an=${key}`;
}

// ── Gate : toggle global super admin ────────────────────────────────────────

const settingsCache = new Map<string, { enabled: boolean; at: number }>();
const SETTINGS_TTL_MS = 60_000;

export async function isAutoPushEnabled(admin: SupabaseClient, key: string): Promise<boolean> {
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.enabled;
  try {
    const { data } = await admin
      .from("platform_notification_settings")
      .select("enabled")
      .eq("notification_key", key)
      .maybeSingle();
    const enabled = data ? data.enabled === true : true; // absent = activé
    settingsCache.set(key, { enabled, at: Date.now() });
    return enabled;
  } catch {
    return true; // fail-open : ne jamais bloquer une transactionnelle sur une erreur DB
  }
}

export async function resolveUserLang(admin: SupabaseClient, userId: string): Promise<AutoPushLang> {
  try {
    const { data } = await admin
      .from("profiles").select("preferred_language").eq("id", userId).maybeSingle();
    const l = data?.preferred_language;
    return l === "en" || l === "es" ? l : "fr";
  } catch {
    return "fr";
  }
}

// ── Tracking ────────────────────────────────────────────────────────────────

/** Journalise l'issue d'un envoi unitaire (auto_push_events + notification_log). */
export async function logAutoPushOutcome(
  admin: SupabaseClient,
  key: string,
  userId: string,
  outcome: "sent" | "failed",
  title: string,
): Promise<void> {
  try {
    await admin.from("auto_push_events").insert({
      notification_key: key,
      user_id: userId,
      event_type: outcome,
      // Reflète l'app réellement ciblée : une notif pro part sur 'ios_pro', et
      // écrire 'ios' en dur faussait les stats par plateforme.
      platform: audiencePlatforms(AUTO_PUSH[key]?.audience ?? "client")[0],
    });
    if (outcome === "sent") {
      const logType = AUTO_PUSH[key]?.logType ?? "transactional";
      await admin.from("notification_log").insert({
        user_id: userId,
        notification_type: logType,
        title,
      });
    }
  } catch (e) {
    console.error(`[AUTO-PUSH] tracking failed for ${key}:`, e);
  }
}

// ── Envoi unitaire complet (gate → texte localisé → relay → tracking) ───────

export async function sendAutoPush(admin: SupabaseClient, opts: {
  key: string;
  userId: string;
  url: string;
  vars?: Record<string, AutoPushVar>;
  variant?: string;
}): Promise<{ sent: number }> {
  const { key, userId, url } = opts;

  if (!(await isAutoPushEnabled(admin, key))) return { sent: 0 };

  const lang = await resolveUserLang(admin, userId);
  const tpl = renderAutoTpl(key, lang, opts.vars ?? {}, opts.variant ?? "default");
  if (!tpl) {
    console.error(`[AUTO-PUSH] unknown key/variant: ${key}/${opts.variant ?? "default"}`);
    return { sent: 0 };
  }
  const platforms = audiencePlatforms(AUTO_PUSH[key].audience);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        user_id: userId,
        platforms,
        payload: { title: tpl.title, body: tpl.body, url: autoTrackUrl(url, key) },
      }),
    });
    const d = await resp.json().catch(() => ({} as Record<string, unknown>));
    const sent = Number(d.sent || 0);
    const total = Number(d.total || 0);

    // Pas d'abonnement push → pas d'événement (on ne compte ni envoi ni échec :
    // le stat « failed » doit refléter des tokens morts, pas des non-abonnés).
    if (sent > 0) await logAutoPushOutcome(admin, key, userId, "sent", tpl.title);
    else if (total > 0) await logAutoPushOutcome(admin, key, userId, "failed", tpl.title);

    return { sent };
  } catch (e) {
    console.error(`[AUTO-PUSH] send failed for ${key}:`, e);
    return { sent: 0 };
  }
}
