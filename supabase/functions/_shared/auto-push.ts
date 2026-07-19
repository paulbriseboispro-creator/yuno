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

export type AutoPushLang = "fr" | "en" | "es";
type Tpl = { title: string; body: string };
type TplByLang = Record<AutoPushLang, Tpl>;

type AutoPushDef = {
  // Type écrit dans notification_log — les caps anti-spam existants comptent
  // sur ces valeurs ('marketing'/'campaign'/'reminder' pour les plafonds).
  logType: "transactional" | "reminder" | "marketing" | "dj_lineup";
  variants: Record<string, TplByLang>;
};

export const AUTO_PUSH: Record<string, AutoPushDef> = {
  purchase_ticket: {
    logType: "transactional",
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
    variants: {
      default: {
        fr: { title: "Ton week-end commence ici 🎉", body: "{events} ce week-end. Découvre la programmation." },
        en: { title: "Your weekend starts here 🎉", body: "{events} this weekend. Check out the lineup." },
        es: { title: "Tu finde empieza aquí 🎉", body: "{events} este fin de semana. Descubre la programación." },
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

/** Date « samedi 21 » déclinée dans les trois langues (pour les vars par langue). */
export function localizedDate(iso: string | null | undefined): Record<AutoPushLang, string> {
  if (!iso) return { fr: "", en: "", es: "" };
  const d = new Date(iso);
  const fmt = (locale: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric" }).format(d);
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

// deno-lint-ignore no-explicit-any
export async function isAutoPushEnabled(admin: any, key: string): Promise<boolean> {
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

// deno-lint-ignore no-explicit-any
export async function resolveUserLang(admin: any, userId: string): Promise<AutoPushLang> {
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
// deno-lint-ignore no-explicit-any
export async function logAutoPushOutcome(
  admin: any,
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
      platform: "ios",
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

// deno-lint-ignore no-explicit-any
export async function sendAutoPush(admin: any, opts: {
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
      body: JSON.stringify({
        user_id: userId,
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
