// Moteur de notifications Yuno — rédaction d'une notification choisie par
// l'arbitre (push_engine_claim). Module PUR : aucune dépendance Deno ni réseau,
// testé côté front (src/lib/__tests__/pushEngineText.test.ts).
//
// Les textes vivent en base (push_rule_templates : règle × variante × raison ×
// langue, éditables depuis /admin/notifications) ; ce module choisit le bon,
// remplit les variables dans le fuseau de la soirée et construit l'URL.

export type EngineLang = "fr" | "en" | "es";
export type EngineFamily = "marketing" | "urgent" | "event" | "reminder";

export interface EngineTemplate {
  rule_key: string;
  variant: string;
  reason: string;
  lang: string;
  title: string;
  body: string;
}

/** Une ligne rendue par push_engine_claim(). */
export interface ClaimedRow {
  candidate_id: number;
  user_id: string;
  rule_key: string;
  variant: string;
  family: string;
  reason: string;
  reason_party: string | null;
  event_id: string | null;
  vars: Record<string, unknown> | null;
  lang: string | null;
  event_title: string | null;
  start_at: string | null;
  tz: string | null;
  venue_name: string | null;
  host_names: string | null;
  party_name: string | null;
}

export interface EngineNotification {
  title: string;
  body: string;
  /** Chemin de l'app (relatif) ; le paramètre ?pc= est ajouté à l'envoi. */
  url: string;
}

export type TemplateIndex = Map<string, { title: string; body: string }>;

const TITLE_MAX = 80;
const BODY_MAX = 178;

// Raisons qui nomment la PARTIE par laquelle la personne est touchée (« Nouveau
// chez Club Un ») plutôt que l'affiche entière de la soirée (« Club Un × Orga B »).
const PARTY_NAMED_REASONS = new Set(["host_follower", "past_customer"]);

export function normLang(lang: string | null | undefined): EngineLang {
  return lang === "en" || lang === "es" ? lang : "fr";
}

const keyOf = (rule: string, variant: string, reason: string, lang: string) =>
  `${rule}|${variant}|${reason}|${lang}`;

export function indexTemplates(rows: readonly EngineTemplate[]): TemplateIndex {
  const out: TemplateIndex = new Map();
  for (const t of rows) {
    if (!t?.rule_key || !t.title) continue;
    out.set(keyOf(t.rule_key, t.variant || "default", t.reason || "any", normLang(t.lang)), { title: t.title, body: t.body || "" });
  }
  return out;
}

const FALLBACK: Record<EngineLang, { title: string; body: string }> = {
  fr: { title: "{event}", body: "{date} — {hosts}" },
  en: { title: "{event}", body: "{date} — {hosts}" },
  es: { title: "{event}", body: "{date} — {hosts}" },
};

/**
 * Texte le plus précis disponible : variante + raison, puis variante seule,
 * puis texte par défaut de la raison, puis texte par défaut de la règle — dans
 * la langue de la personne, sinon en français, sinon n'importe quel texte de
 * la règle. Jamais de notification vide.
 */
export function pickTemplate(
  index: TemplateIndex,
  rule: string,
  variant: string,
  reason: string,
  lang: EngineLang,
): { title: string; body: string } {
  const langs: EngineLang[] = lang === "fr" ? ["fr"] : [lang, "fr"];
  const variants = variant && variant !== "default" ? [variant, "default"] : ["default"];
  for (const l of langs) {
    for (const v of variants) {
      for (const r of [reason, "any"]) {
        const hit = index.get(keyOf(rule, v, r, l));
        if (hit) return hit;
      }
    }
  }
  for (const l of langs) {
    for (const [k, v] of index) {
      if (k.startsWith(`${rule}|`) && k.endsWith(`|${l}`)) return v;
    }
  }
  return FALLBACK[lang];
}

const LOCALE: Record<EngineLang, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES" };

/** « sam. 21 juin » dans le fuseau de la soirée (le runtime tourne en UTC). */
export function formatDay(iso: string | null | undefined, tz: string | null | undefined, lang: EngineLang): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(LOCALE[lang], {
      weekday: "short", day: "numeric", month: "short", timeZone: tz || "Europe/Paris",
    }).format(d).replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** « 23:30 » dans le fuseau de la soirée. */
export function formatTime(iso: string | null | undefined, tz: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz || "Europe/Paris",
    }).formatToParts(d);
    const h = parts.find((p) => p.type === "hour")?.value ?? "";
    const m = parts.find((p) => p.type === "minute")?.value ?? "";
    return h && m ? `${h === "24" ? "00" : h}:${m}` : "";
  } catch {
    return "";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export function engineVars(row: ClaimedRow): Record<string, string> {
  const lang = normLang(row.lang);
  const vars = row.vars ?? {};
  const hosts = row.host_names || row.venue_name || "Yuno";
  return {
    name: PARTY_NAMED_REASONS.has(row.reason) && row.party_name ? row.party_name : hosts,
    hosts,
    venue: row.venue_name || row.host_names || "",
    event: row.event_title || "",
    date: formatDay(row.start_at, row.tz, lang),
    time: formatTime(row.start_at, row.tz),
    dj: str(vars.dj) || row.party_name || "",
    agency: str(vars.agency) || row.party_name || "",
    next_event: str(vars.next_event),
    next_date: formatDay(str(vars.next_start) || null, row.tz, lang),
  };
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/** Remplit les {variables}, retire celles qui restent vides, nettoie la ponctuation orpheline. */
export function renderEngineText(text: string, vars: Record<string, string>, max: number): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v ?? "");
  out = out
    .replace(/\{[a-z_]+\}/g, "")
    .replace(/(—|-)\s*([,.])/g, "$2")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return clamp(out, max);
}

/** Où ouvre la notification. `/event/<uuid>` se résout toujours (club comme organisateur). */
export function engineUrl(row: ClaimedRow): string {
  const ev = row.event_id ? `/event/${row.event_id}` : "/";
  const vars = row.vars ?? {};
  switch (row.rule_key) {
    case "event_day_reminder":
      if (row.variant === "drinks" && row.event_id) return `/order/upsell?event=${row.event_id}`;
      return row.reason === "guest" ? "/my-orders" : "/my-orders?tab=tickets";
    case "doors_open":
      return row.reason === "guest" ? "/my-orders" : "/my-orders?tab=tickets";
    case "after_thanks": {
      const next = str(vars.next_event_id);
      return next ? `/event/${next}` : ev;
    }
    default:
      return ev;
  }
}

export function withCampaign(url: string, campaignId: string): string {
  const base = url || "/";
  return base.includes("?") ? `${base}&pc=${campaignId}` : `${base}?pc=${campaignId}`;
}

/**
 * Type écrit dans notification_log : 'marketing' entre dans les plafonds,
 * 'event_campaign' (soirée achetée) et 'reminder' n'y entrent pas.
 */
export function logTypeFor(family: string): "marketing" | "event_campaign" | "reminder" {
  if (family === "reminder") return "reminder";
  if (family === "event") return "event_campaign";
  return "marketing";
}

export function composeEngineNotification(row: ClaimedRow, index: TemplateIndex): EngineNotification {
  const lang = normLang(row.lang);
  const tpl = pickTemplate(index, row.rule_key, row.variant || "default", row.reason || "any", lang);
  const vars = engineVars(row);
  const title = renderEngineText(tpl.title, vars, TITLE_MAX) || renderEngineText("{event}", vars, TITLE_MAX) || "Yuno";
  const body = renderEngineText(tpl.body, vars, BODY_MAX);
  return { title, body, url: engineUrl(row) };
}
