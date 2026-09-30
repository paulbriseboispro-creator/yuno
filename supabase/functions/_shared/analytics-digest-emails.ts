// Digests d'analyse par email (Analytics v3, phase 3 — spec §4.9).
//
//   • Le bilan du lendemain : entrées / attendus, no-show, CA et revenu par
//     personne, meilleur promoteur, nouveaux vs habitués, écart avec la soirée
//     comparable. Envoyé par dispatchNightRecaps (night-recap.ts) à 11 h Paris,
//     dans le même passage que la cloche et le push.
//   • L'hebdo du lundi : les 7 derniers jours vs les 7 d'avant, les soirées à
//     venir, et UN segment actionnable (« 34 habitués ne sont pas revenus »),
//     avec le bouton « Créer une campagne ».
// Gatés par le registre /admin/notifications (email_night_recap,
// email_weekly_digest), jamais pour la démo (demo-scope + is_demo_email).
// Design : email-kit (DESIGN_SYSTEM_PUBLIC). Envoi : Resend, une requête par email.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { isAutoPushEnabled, resolveUserLang, type AutoPushLang } from "./auto-push.ts";
import { body, ctaPill, esc, mono, ruleLabel, section, shell, title, C } from "./email-kit.ts";

const APP_URL = Deno.env.get("APP_BASE_URL") ?? "https://yunoapp.eu";
const LOCALE: Record<AutoPushLang, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES" };

type Lang = AutoPushLang;
const T = {
  fr: {
    recapSubject: (t: string) => `Bilan de ${t}`,
    recapPre: "Tes chiffres de la nuit, en trois lignes.",
    entered: "Entrées", expected: "attendus", noShow: "no-show", revenue: "CA de la nuit", perHead: "par personne présente",
    tickets: "billets", tables: "tables", gl: "guest list", newCustomers: "nouveaux clients", returning: "habitués",
    bestPromoter: "Meilleur promoteur", vs: "Comparé à", moreThan: "de plus que", lessThan: "de moins que", sameAs: "autant que",
    openReport: "Ouvrir le rapport", notScanned: "La porte n'a pas scanné : les entrées ne sont pas connues.",
    weeklySubject: (n: string) => `Ta semaine chez ${n}`, weeklyPre: "Sept jours de ventes, et ce qu'il faut faire cette semaine.",
    lastWeek: "Les 7 derniers jours", nights: "soirées", prevWeek: "vs les 7 jours d'avant", upcoming: "Cette semaine",
    sold: "vendus", places: "places", actionTitle: "Une action pour cette semaine",
    atRisk: (n: string) => `${n} habitués ne sont pas revenus depuis plus de 30 jours.`, atRiskCta: "Créer une campagne",
    pillars: (n: string) => `${n} piliers et fidèles à choyer.`, quiet: "Semaine calme : aucune soirée terminée.",
    openAnalytics: "Voir l'analyse", noAction: "Rien d'urgent : continue.",
  },
  en: {
    recapSubject: (t: string) => `${t}: last night in numbers`,
    recapPre: "Your night, in three lines.",
    entered: "Entries", expected: "expected", noShow: "no-show", revenue: "Night revenue", perHead: "per person present",
    tickets: "tickets", tables: "tables", gl: "guest list", newCustomers: "new customers", returning: "returning",
    bestPromoter: "Best promoter", vs: "Compared to", moreThan: "more than", lessThan: "less than", sameAs: "same as",
    openReport: "Open the report", notScanned: "The door did not scan: entries are unknown.",
    weeklySubject: (n: string) => `Your week at ${n}`, weeklyPre: "Seven days of sales, and what to do this week.",
    lastWeek: "Last 7 days", nights: "nights", prevWeek: "vs the 7 days before", upcoming: "This week",
    sold: "sold", places: "places", actionTitle: "One action for this week",
    atRisk: (n: string) => `${n} regulars have not come back for more than 30 days.`, atRiskCta: "Create a campaign",
    pillars: (n: string) => `${n} pillars and regulars to look after.`, quiet: "Quiet week: no finished night.",
    openAnalytics: "See the analytics", noAction: "Nothing urgent: keep going.",
  },
  es: {
    recapSubject: (t: string) => `${t}: la noche en cifras`,
    recapPre: "Tu noche, en tres líneas.",
    entered: "Entradas", expected: "esperados", noShow: "no-show", revenue: "Ingresos de la noche", perHead: "por persona presente",
    tickets: "entradas", tables: "mesas", gl: "guest list", newCustomers: "clientes nuevos", returning: "habituales",
    bestPromoter: "Mejor promotor", vs: "Comparado con", moreThan: "más que", lessThan: "menos que", sameAs: "igual que",
    openReport: "Abrir el informe", notScanned: "La puerta no escaneó: las entradas no se conocen.",
    weeklySubject: (n: string) => `Tu semana en ${n}`, weeklyPre: "Siete días de ventas y qué hacer esta semana.",
    lastWeek: "Últimos 7 días", nights: "noches", prevWeek: "vs los 7 días anteriores", upcoming: "Esta semana",
    sold: "vendidas", places: "plazas", actionTitle: "Una acción para esta semana",
    atRisk: (n: string) => `${n} habituales no han vuelto desde hace más de 30 días.`, atRiskCta: "Crear una campaña",
    pillars: (n: string) => `${n} pilares y habituales que cuidar.`, quiet: "Semana tranquila: ninguna noche terminada.",
    openAnalytics: "Ver la analítica", noAction: "Nada urgente: sigue así.",
  },
} as const;

const n = (lang: Lang, v: number) => new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(v);
const eur = (lang: Lang, v: number) => new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: "EUR", maximumFractionDigits: v < 100 ? 2 : 0 }).format(v);
const dateLong = (lang: Lang, iso: string, tz: string) => new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date(iso));

/** Trois gros chiffres côte à côte (tableau email-safe). */
function bigStats(items: { label: string; value: string; sub?: string }[]): string {
  const cells = items.map((i) => `
    <td valign="top" style="padding:0 6px 0 0;width:${Math.floor(100 / items.length)}%">
      <div style="background:${C.card};border:1px solid ${C.border};border-radius:4px;padding:14px 14px">
        ${mono(esc(i.label), C.gray2, 10)}
        <div style="font-family:'Space Grotesk','Helvetica Neue',Arial,sans-serif;font-size:26px;font-weight:700;color:${C.white};letter-spacing:-0.02em;line-height:1.05;margin-top:6px">${esc(i.value)}</div>
        ${i.sub ? `<div style="font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:12px;color:${C.gray2};margin-top:6px">${esc(i.sub)}</div>` : ""}
      </div>
    </td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
}

function deltaSentence(lang: Lang, cur: number, ref: number, fmt: (v: number) => string, refLabel: string): string {
  const t = T[lang];
  if (ref <= 0) return "";
  const diff = cur - ref;
  if (Math.abs(diff) < 0.5) return `${t.vs} ${refLabel} : ${t.sameAs}.`;
  const pct = Math.round((Math.abs(diff) / ref) * 100);
  const how = ref >= 20 && pct <= 300 ? `${pct} %` : fmt(Math.abs(diff));
  return `${t.vs} ${refLabel} : ${how} ${diff > 0 ? t.moreThan : t.lessThan}.`;
}

export interface NightRecapEmailData {
  ok: boolean; demo: boolean; event_id: string; title: string; start_at: string; tz: string;
  venue_id: string | null; organizer_user_id: string | null; recipient: string; recipient_email: string | null;
  entered: number; expected: number; tickets: number; tables: number; gl: number;
  revenue: number; rev_tickets: number; rev_tables: number; rev_bar: number; per_head: number | null; no_show_pct: number | null;
  customers: number; new_customers: number;
  promoter: { name: string; orders: number; amount: number } | null;
  ref: { title: string; start_at: string; entered: number; revenue: number; tickets: number } | null;
}

export function buildNightRecapEmail(d: NightRecapEmailData, lang: Lang): { subject: string; html: string } {
  const t = T[lang];
  const path = d.venue_id ? `/owner/analytics?tab=overview&event=${d.event_id}` : `/organizer-app/analytics?tab=overview&event=${d.event_id}`;
  const scanned = d.entered > 0;
  const stats = scanned
    ? [
        { label: t.entered, value: `${n(lang, d.entered)} / ${n(lang, d.expected)}`, sub: d.no_show_pct != null ? `${d.no_show_pct} % ${t.noShow}` : undefined },
        { label: t.revenue, value: eur(lang, d.revenue), sub: d.per_head != null ? `${eur(lang, d.per_head)} ${t.perHead}` : undefined },
        { label: t.newCustomers, value: n(lang, d.new_customers), sub: `${n(lang, Math.max(0, d.customers - d.new_customers))} ${t.returning}` },
      ]
    : [
        { label: t.tickets, value: n(lang, d.tickets), sub: `${n(lang, d.tables)} ${t.tables} · ${n(lang, d.gl)} ${t.gl}` },
        { label: t.revenue, value: eur(lang, d.revenue) },
        { label: t.newCustomers, value: n(lang, d.new_customers), sub: `${n(lang, Math.max(0, d.customers - d.new_customers))} ${t.returning}` },
      ];
  const refLabel = d.ref ? `${d.ref.title} (${dateLong(lang, d.ref.start_at, d.tz)})` : "";
  const cmp = d.ref
    ? (scanned && d.ref.entered > 0
        ? deltaSentence(lang, d.entered, d.ref.entered, (v) => n(lang, v), refLabel)
        : deltaSentence(lang, d.revenue, d.ref.revenue, (v) => eur(lang, v), refLabel))
    : "";
  const parts = [
    section(ruleLabel(esc(dateLong(lang, d.start_at, d.tz))) + title(esc(d.title))),
    section(bigStats(stats)),
    !scanned ? section(body(esc(t.notScanned), C.gray2)) : "",
    cmp ? section(body(esc(cmp))) : "",
    d.promoter && d.promoter.orders > 0 ? section(ruleLabel(esc(t.bestPromoter)) + body(`${esc(d.promoter.name)} · ${n(lang, d.promoter.orders)} · ${eur(lang, d.promoter.amount)}`)) : "",
    section(ctaPill(t.openReport, `${APP_URL}${path}`), { padTop: 8 }),
  ].join("");
  return { subject: t.recapSubject(d.title), html: shell({ preheader: t.recapPre, body: parts, title: t.recapSubject(d.title) }) };
}

export interface WeeklyDigestEmailData {
  ok: boolean; name: string | null; tz: string; venue_id: string | null; organizer_user_id: string | null;
  nights: number; revenue: number; tickets: number; entries: number; expected: number; customers: number; new_customers: number;
  prev: { nights: number; revenue: number; tickets: number; entries: number } | null;
  upcoming: { id: string; title: string; start_at: string; tickets: number; cap: number | null; gl: number; tables: number }[];
  at_risk: number; pillars: number;
}

export function buildWeeklyDigestEmail(d: WeeklyDigestEmailData, lang: Lang): { subject: string; html: string } {
  const t = T[lang];
  const base = d.venue_id ? "/owner" : "/organizer-app";
  const name = d.name ?? "Yuno";
  const stats = [
    { label: t.lastWeek, value: eur(lang, d.revenue), sub: `${n(lang, d.nights)} ${t.nights} · ${n(lang, d.tickets)} ${t.tickets}` },
    { label: t.entered, value: n(lang, d.entries), sub: d.expected > 0 ? `/ ${n(lang, d.expected)} ${t.expected}` : undefined },
    { label: t.newCustomers, value: n(lang, d.new_customers), sub: `${n(lang, Math.max(0, d.customers - d.new_customers))} ${t.returning}` },
  ];
  const cmp = d.prev && d.prev.nights > 0 ? deltaSentence(lang, d.revenue, d.prev.revenue, (v) => eur(lang, v), t.prevWeek) : "";
  const upcoming = d.upcoming.length
    ? section(ruleLabel(esc(t.upcoming)) + d.upcoming.map((u) =>
        body(`<strong style="color:${C.white}">${esc(u.title)}</strong> · ${esc(dateLong(lang, u.start_at, d.tz))} · ${n(lang, u.tickets)}${u.cap ? ` / ${n(lang, u.cap)}` : ""} ${t.sold}${u.gl ? ` · ${n(lang, u.gl)} ${t.gl}` : ""}${u.tables ? ` · ${n(lang, u.tables)} ${t.tables}` : ""}`)).join(""))
    : "";
  const action = d.at_risk >= 10
    ? section(ruleLabel(esc(t.actionTitle)) + body(esc(t.atRisk(n(lang, d.at_risk)))) + ctaPill(t.atRiskCta, `${APP_URL}${base}/campaigns/new?rfm=at_risk`), { padTop: 8 })
    : d.pillars >= 10
      ? section(ruleLabel(esc(t.actionTitle)) + body(esc(t.pillars(n(lang, d.pillars)))) + ctaPill(t.atRiskCta, `${APP_URL}${base}/campaigns/new?rfm=champions,loyal`), { padTop: 8 })
      : section(ruleLabel(esc(t.actionTitle)) + body(esc(t.noAction)));
  const parts = [
    section(ruleLabel(esc(name)) + title(esc(t.weeklySubject(name)))),
    section(d.nights > 0 ? bigStats(stats) : body(esc(t.quiet), C.gray2)),
    cmp ? section(body(esc(cmp))) : "",
    upcoming,
    action,
    section(ctaPill(t.openAnalytics, `${APP_URL}${base}/analytics?tab=overview&period=7d`), { padTop: 8 }),
  ].join("");
  return { subject: t.weeklySubject(name), html: shell({ preheader: t.weeklyPre, body: parts, title: t.weeklySubject(name) }) };
}

/** Un email transactionnel au pro, via Resend. Ne lève jamais. */
export async function sendProEmail(to: string, subject: string, html: string, tag: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !to) return false;
  const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
  const from = rawFrom ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`) : "Yuno <noreply@yunoapp.eu>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [to], subject, html, tags: [{ name: "kind", value: tag }] }),
    });
    if (!res.ok) console.error(`[DIGEST-EMAIL] ${tag} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (e) {
    console.error(`[DIGEST-EMAIL] ${tag} failed:`, String(e));
    return false;
  }
}

/** Le bilan du lendemain par email, appelé par dispatchNightRecaps après la cloche et le push. */
export async function sendNightRecapEmail(admin: SupabaseClient, eventId: string): Promise<boolean> {
  if (!(await isAutoPushEnabled(admin, "email_night_recap"))) return false;
  const { data } = await admin.rpc("night_recap_email_data", { p_event_id: eventId });
  const d = data as NightRecapEmailData | null;
  if (!d?.ok || d.demo || !d.recipient_email) return false;
  if (d.expected <= 0 && d.entered <= 0 && d.revenue <= 0) return false;
  const lang = await resolveUserLang(admin, d.recipient);
  const mail = buildNightRecapEmail(d, lang);
  return sendProEmail(d.recipient_email, mail.subject, mail.html, "night_recap");
}

/**
 * L'hebdo du lundi par email (9 h – 12 h UTC), une fois par destinataire et par
 * semaine (audience_recap_log, subject_type 'venue_email' / 'organizer_email').
 */
export async function dispatchWeeklyDigestEmails(admin: SupabaseClient): Promise<{ processed: number; sent: number }> {
  const now = new Date();
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 9 || now.getUTCHours() >= 12) return { processed: 0, sent: 0 };
  if (!(await isAutoPushEnabled(admin, "email_weekly_digest"))) return { processed: 0, sent: 0 };
  const monday = new Date(now); monday.setUTCHours(0, 0, 0, 0); monday.setUTCDate(monday.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  const { data: targets } = await admin.rpc("weekly_digest_email_targets");
  if (!Array.isArray(targets) || targets.length === 0) return { processed: 0, sent: 0 };
  let processed = 0, sent = 0;
  for (const tg of targets as { subject_type: string; subject_id: string; recipient: string; recipient_email: string | null; tz: string }[]) {
    try {
      if (!tg.recipient_email) continue;
      const { error: claimErr } = await admin.from("audience_recap_log").insert({ subject_type: `${tg.subject_type}_email`, subject_id: tg.subject_id, week_start: weekStart });
      if (claimErr) continue;
      const { data } = await admin.rpc("weekly_digest_email_data", tg.subject_type === "venue"
        ? { p_venue_id: tg.subject_id, p_organizer_user_id: null } : { p_venue_id: null, p_organizer_user_id: tg.subject_id });
      const d = data as WeeklyDigestEmailData | null;
      if (!d?.ok) continue;
      // Rien à raconter : pas de soirée terminée, rien à venir, aucun segment.
      if (d.nights <= 0 && d.upcoming.length === 0 && d.at_risk < 10 && d.pillars < 10) continue;
      processed++;
      const lang = await resolveUserLang(admin, tg.recipient);
      const mail = buildWeeklyDigestEmail(d, lang);
      if (await sendProEmail(tg.recipient_email, mail.subject, mail.html, "weekly_digest")) sent++;
    } catch (e) {
      console.error(`[WEEKLY-DIGEST] ${tg.subject_type} ${tg.subject_id} failed:`, String(e));
    }
  }
  return { processed, sent };
}
