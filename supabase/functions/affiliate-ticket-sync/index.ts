import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";

// ============================================================================
// affiliate-ticket-sync — pose les liens billetterie Whan sur les soirées
// récurrentes d'un affilié (aujourd'hui : Mad by Night seul, cf.
// affiliate_ticket_sources).
//
// Modes :
//   sync   (cron 18 h Madrid, bouton de la page Soirées) — pour chaque
//          occurrence à venir d'un modèle relié à une série Whan
//          (external_series_key) et SANS lien : trouve la soirée Whan du même
//          club la même nuit, pose le lien du compte prioritaire qui la vend.
//          Édition spéciale (autre nom Whan ce soir-là) → titre et affiche de
//          l'édition sur cette date seulement.
//   import (à la demande, `apply: true` pour écrire, sinon plan à blanc) —
//          détecte les séries Whan (≥ 3 dates, même club, même jour, même
//          nom), les relie aux modèles existants ou crée les modèles manquants
//          (affiche, horaires, prix de Whan), relance le générateur, puis
//          synchronise en silence (aucune notification « Nouvelle soirée »).
//
// Toute écriture sur une soirée passe par affiliate_ticket_sync_apply : c'est
// là que vit la garde « un lien posé n'est jamais remplacé ».
// ============================================================================

const WHAN = "https://app.whan.es";
const BUCKET = "affiliate-media";
const SERIES_MIN = 3;
const TODO_HORIZON_DAYS = 8;
const UNMATCHED_HORIZON_DAYS = 14;
const UA = "Mozilla/5.0 (compatible; YunoTicketSync/1.0; +https://yunoapp.eu)";

type WhanEvent = {
  id: string;
  name: string;
  start: string; // ISO avec décalage, heure locale du club
  end: string;
  clubSlug: string;
  clubName: string;
  mainImage: string | null;
  account: string; // compte prioritaire qui la vend
  accounts: string[]; // tous les comptes qui la listent
  night: string; // YYYY-MM-DD
  band: "night" | "day";
  base: string;
  venueId?: string;
};

type Template = {
  id: string;
  affiliate_venue_id: string | null;
  name: string;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  flyer_url: string | null;
  is_active: boolean;
  external_series_key: string | null;
  genres: string[] | null;
};

type Occurrence = {
  id: string;
  name: string;
  flyer_url: string | null;
  event_date: string;
  external_ticket_url: string | null;
  flyer_overridden: boolean | null;
  name_overridden: boolean | null;
  recurring_template_id: string;
  external_event_ref: string | null;
};

// ── Normalisation ───────────────────────────────────────────────────────────
const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";
const DATE_IN_NAME = new RegExp(`\\b\\d{1,2}\\s*(de\\s+)?(${MONTHS})\\b`, "gi");

function baseName(name: string): string {
  return fold(name).replace(DATE_IN_NAME, " ").replace(/[^a-z]+/g, " ").trim().replace(/\s+/g, " ");
}

// Nom affichable d'une série : le nom Whan sans la date (« TARDEO … 3 DE OCTUBRE »).
function displayName(name: string): string {
  const folded = fold(name);
  let out = "";
  let last = 0;
  for (const m of folded.matchAll(DATE_IN_NAME)) {
    out += name.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
  }
  out += name.slice(last);
  return out.replace(/\s+/g, " ").replace(/[\s\-–—·@]+$/, "").trim();
}

const norm = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");

const DAY_SYN: Record<string, string> = {
  lunes: "monday", martes: "tuesday", miercoles: "wednesday", jueves: "thursday",
  viernes: "friday", sabado: "saturday", domingo: "sunday",
  lundi: "monday", mardi: "tuesday", mercredi: "wednesday", jeudi: "thursday",
  vendredi: "friday", samedi: "saturday", dimanche: "sunday",
};
const STOP = new Set(["at", "x", "by", "the", "de", "la", "el", "en", "and", "y", "club", "madrid"]);

function tokens(s: string, clubTokens: Set<string>): Set<string> {
  const out = new Set<string>();
  for (let t of baseName(s).split(" ")) {
    if (!t || STOP.has(t) || clubTokens.has(t)) continue;
    t = DAY_SYN[t] ?? t;
    if (t.length > 3 && t.endsWith("s")) t = t.slice(0, -1);
    out.add(t);
  }
  return out;
}
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((t) => b.has(t)).length;

function slugify(text: string): string {
  return fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Temps ───────────────────────────────────────────────────────────────────
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Nuit d'une soirée = date locale du début moins 8 h (un début à 00 h 30
// appartient à la nuit de la veille). Le décalage est dans la chaîne Whan :
// on lit l'heure locale telle quelle.
function nightOf(localIso: string): { night: string; band: "night" | "day"; hhmm: string } {
  const [date, time] = localIso.slice(0, 16).split("T");
  const [h, mi] = time.split(":").map(Number);
  const night = h < 8 ? addDays(date, -1) : date;
  return { night, band: h >= 12 && h < 20 ? "day" : "night", hhmm: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` };
}

function bandOfTime(t: string | null): "night" | "day" {
  const h = Number((t ?? "23:00").slice(0, 2));
  return h >= 12 && h < 20 ? "day" : "night";
}

function dowOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function madridParts(d = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

// Même règle que currentNightDate() : la nuit en cours jusqu'à 08 h.
const currentNight = () => madridParts(new Date(Date.now() - 8 * 3600_000)).date;

// ── Whan ────────────────────────────────────────────────────────────────────
async function fetchWhanAccount(slug: string): Promise<Array<Omit<WhanEvent, "account" | "accounts" | "night" | "band" | "base">>> {
  const res = await fetch(`${WHAN}/api/v1/public/rrpp/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`whan ${slug}: HTTP ${res.status}`);
  const json = await res.json();
  const out = [];
  for (const x of json?.included ?? []) {
    if (x?.type !== "rrpp-events") continue;
    const a = x.attributes ?? {};
    if (!a.startDateTime || !a.club) continue;
    out.push({
      id: String(x.id),
      name: String(a.name ?? "").trim(),
      start: String(a.startDateTime),
      end: String(a.endDateTime ?? ""),
      clubSlug: String(a.club.slug ?? ""),
      clubName: String(a.club.name ?? "").trim(),
      mainImage: a.mainImage ? String(a.mainImage) : null,
    });
  }
  return out;
}

const pageCache = new Map<string, Promise<{ canonical: string | null; lowPrice: number | null }>>();
function fetchWhanPage(id: string) {
  let p = pageCache.get(id);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${WHAN}/event/${encodeURIComponent(id)}`, { headers: { "User-Agent": UA } });
        if (!res.ok) return { canonical: null, lowPrice: null };
        const html = await res.text();
        const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
        const low = html.match(/"lowPrice":\s*([\d.]+)/)?.[1];
        return { canonical, lowPrice: low != null ? Number(low) : null };
      } catch {
        return { canonical: null, lowPrice: null };
      }
    })();
    pageCache.set(id, p);
  }
  return p;
}

async function ticketUrlFor(e: WhanEvent): Promise<string> {
  const { canonical } = await fetchWhanPage(e.id);
  const base = canonical && canonical.startsWith(`${WHAN}/event/`) ? canonical : `${WHAN}/event/${e.id}`;
  return `${base}?ref=${encodeURIComponent(e.account)}`;
}

// Copie l'affiche Whan dans le Storage Yuno (clé = nom du fichier Whan : une
// même image n'est copiée qu'une fois, et deux dates qui la partagent pointent
// sur la même URL).
async function ensureImage(admin: SupabaseClient, affiliateId: string, e: WhanEvent): Promise<string | null> {
  if (!e.mainImage) return null;
  const file = e.mainImage.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${affiliateId}/whan/${file}`;
  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  try {
    const head = await fetch(publicUrl, { method: "HEAD" });
    if (head.ok) return publicUrl;
    const res = await fetch(`${WHAN}/event/img/${encodeURIComponent(e.id)}?v=${encodeURIComponent(e.mainImage)}`, {
      headers: { "User-Agent": UA },
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true });
    if (error) return null;
    return publicUrl;
  } catch {
    return null;
  }
}

const isWhanImage = (url: string | null, e: WhanEvent) =>
  !!url && !!e.mainImage && url.endsWith(`/whan/${e.mainImage.replace(/[^A-Za-z0-9._-]/g, "_")}`);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// ── Cœur ────────────────────────────────────────────────────────────────────
type RunOpts = { mode: "sync" | "import"; apply: boolean; trigger: "cron" | "manual" | "import"; force?: boolean };

function latestPerNight(list: WhanEvent[]): WhanEvent[] {
  const groups = new Map<string, WhanEvent[]>();
  for (const e of list) {
    const k = `${e.venueId}|${e.night}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: WhanEvent[] = [];
  for (const g of groups.values()) {
    const start = Math.max(...g.map((e) => Date.parse(e.start)));
    const late = g.filter((e) => Date.parse(e.start) === start);
    const end = Math.max(...late.map((e) => Date.parse(e.end) || 0));
    out.push(...late.filter((e) => (Date.parse(e.end) || 0) === end));
  }
  return out;
}

async function runForAffiliate(admin: SupabaseClient, affiliateId: string, opts: RunOpts) {
  const errors: string[] = [];

  const { data: sources } = await admin
    .from("affiliate_ticket_sources")
    .select("account_slug, priority, create_one_offs")
    .eq("affiliate_id", affiliateId)
    .eq("provider", "whan")
    .eq("is_active", true)
    .order("priority");
  if (!sources?.length) return { skipped: "no_sources" };

  // 1. Soirées Whan, chacune attribuée au compte le plus prioritaire qui la vend.
  const events = new Map<string, WhanEvent>();
  for (const s of sources) {
    try {
      for (const raw of await fetchWhanAccount(s.account_slug)) {
        const known = events.get(raw.id);
        if (known) { known.accounts.push(s.account_slug); continue; }
        const t = nightOf(raw.start);
        events.set(raw.id, { ...raw, account: s.account_slug, accounts: [s.account_slug], night: t.night, band: t.band, base: baseName(raw.name) });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (events.size === 0) return { skipped: "whan_unreachable", errors };

  // 2. Clubs Whan → clubs de l'affilié.
  const { data: venues } = await admin
    .from("affiliate_venues").select("id, name, slug").eq("affiliate_id", affiliateId);
  const venueFor = new Map<string, string>();
  const clubTokens = new Map<string, Set<string>>();
  for (const e of events.values()) {
    if (!venueFor.has(e.clubSlug)) {
      const c = norm(e.clubName);
      const cs = norm(e.clubSlug);
      const v = (venues ?? []).find((v) => {
        const vn = norm(v.name);
        const vs = norm(v.slug ?? "");
        return vn === c || vs === cs || vn.startsWith(c) || c.startsWith(vn) || vs.startsWith(cs);
      });
      venueFor.set(e.clubSlug, v?.id ?? "");
      if (v) clubTokens.set(v.id, new Set([...baseName(v.name).split(" "), ...baseName(e.clubName).split(" ")]));
    }
    e.venueId = venueFor.get(e.clubSlug) || undefined;
  }
  const today = currentNight();
  const allUpcoming = [...events.values()].filter((e) => e.venueId && e.night >= today);
  // Deux soirées Whan dans le même club la même nuit (un tardeo à 18 h puis la
  // soirée, deux salles…) : Yuno ne garde que la PLUS TARDIVE — début le plus
  // tard, puis fin la plus tard. Règle de Paul (2026-09-28). Les ex-aequo
  // restent tous candidats : un lien posé à la main les départage.
  const upcoming = latestPerNight(allUpcoming);

  // 3. Modèles de l'affilié.
  const loadTemplates = async () => {
    const { data } = await admin
      .from("affiliate_recurring_templates")
      .select("id, affiliate_venue_id, name, day_of_week, start_time, end_time, flyer_url, is_active, external_series_key, genres")
      .eq("affiliate_id", affiliateId);
    return (data ?? []) as Template[];
  };
  let templates = await loadTemplates();

  const plan: Record<string, unknown> = {};

  if (opts.mode === "import") {
    const res = await importSeries(admin, affiliateId, upcoming, templates, clubTokens, opts.apply, errors);
    plan.series = res.report;
    if (opts.apply) {
      // Le générateur crée les occurrences des nouveaux modèles (en brouillon)
      // et recopie les nouvelles affiches sur les occurrences non personnalisées.
      const gen = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/create-affiliate-recurring-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": Deno.env.get("CRON_SECRET") ?? "" },
        body: "{}",
      });
      plan.generator = gen.ok ? await gen.json().catch(() => null) : `HTTP ${gen.status}`;
      templates = await loadTemplates();
    } else {
      templates = res.simulated;
    }
  }

  // 4. Synchro des occurrences.
  const keyed = templates.filter((t) => t.external_series_key && t.affiliate_venue_id);
  const tplById = new Map(keyed.map((t) => [t.id, t]));
  const keyedIds = keyed.map((t) => t.id).filter((id) => !id.startsWith("new:"));
  const occurrences: Occurrence[] = [];
  for (let from = 0; keyedIds.length > 0; from += 1000) {
    const { data, error } = await admin
      .from("affiliate_events")
      .select("id, name, event_date, external_ticket_url, flyer_url, flyer_overridden, name_overridden, recurring_template_id, external_event_ref")
      .eq("affiliate_id", affiliateId)
      .in("recurring_template_id", keyedIds)
      .gte("event_date", today)
      .order("id")
      .range(from, from + 999);
    if (error) { errors.push(error.message); break; }
    occurrences.push(...((data ?? []) as Occurrence[]));
    if (!data || data.length < 1000) break;
  }

  // Liens déjà posés sur le compte : une soirée Whan déjà reliée ailleurs n'est
  // jamais reprise pour une autre date.
  const { data: linked } = await admin
    .from("affiliate_events")
    .select("external_ticket_url, external_event_ref")
    .eq("affiliate_id", affiliateId)
    .gte("event_date", addDays(today, -1))
    .or("external_ticket_url.not.is.null,external_event_ref.not.is.null");
  const claimedText = (linked ?? []).map((l) => `${l.external_ticket_url ?? ""} ${l.external_event_ref ?? ""}`).join("\n");
  const isClaimed = (e: WhanEvent) =>
    claimedText.includes(e.id) || claimedText.includes(`/event/${slugify(e.name)}-${e.start.slice(0, 10)}`);

  const groupByVenueNight = (list: WhanEvent[]) => {
    const m = new Map<string, WhanEvent[]>();
    for (const e of list) {
      const k = `${e.venueId}|${e.night}`;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  };
  const byVenueNight = groupByVenueNight(upcoming);
  const allByVenueNight = groupByVenueNight(allUpcoming);

  // La soirée Whan qu'un lien déjà posé désigne (id ou slug canonique
  // « nom-date »), parmi TOUTES celles du club cette nuit-là.
  const linkedEventOf = (occ: Occurrence, venueId: string): WhanEvent | undefined => {
    const url = occ.external_ticket_url ?? "";
    const refId = occ.external_event_ref?.startsWith("whan:") ? occ.external_event_ref.slice(5) : null;
    const path = url.includes("whan.es/event/") ? url.split("/event/")[1].split("?")[0] : "";
    if (!refId && !path) return undefined;
    return (allByVenueNight.get(`${venueId}|${occ.event_date}`) ?? []).find((e) =>
      e.id === refId || path === e.id || path.startsWith(`${slugify(e.name)}-${e.start.slice(0, 10)}`));
  };
  const keyBase = (t: Template) => (t.external_series_key ?? "").split(":").slice(2).join(":");
  const seriesBasesOfVenue = new Map<string, Set<string>>();
  for (const t of keyed) {
    const set = seriesBasesOfVenue.get(t.affiliate_venue_id!) ?? new Set<string>();
    set.add(keyBase(t));
    seriesBasesOfVenue.set(t.affiliate_venue_id!, set);
  }

  type Pending = { occ: Occurrence; tpl: Template; ev: WhanEvent; setLink: boolean; replaceLink: boolean };
  const pending: Pending[] = [];
  const todo: Array<Record<string, unknown>> = [];
  const used = new Set<string>();

  for (const occ of occurrences.sort((a, b) => a.event_date.localeCompare(b.event_date))) {
    const tpl = tplById.get(occ.recurring_template_id)!;
    const cands = (byVenueNight.get(`${tpl.affiliate_venue_id}|${occ.event_date}`) ?? [])
      .filter((e) => e.band === bandOfTime(tpl.start_time));
    const exact = cands.filter((e) => e.base === keyBase(tpl));
    let ev: WhanEvent | undefined;
    let reason: string | null = null;
    if (exact.length === 1) ev = exact[0];
    else if (exact.length > 1) reason = "ambiguous";
    else {
      const others = cands.filter((e) => !seriesBasesOfVenue.get(tpl.affiliate_venue_id!)?.has(e.base));
      if (others.length === 1) ev = others[0]; // édition spéciale de la série
      else reason = others.length > 1 ? "ambiguous" : "not_on_whan";
    }

    // Un lien déjà posé qui désigne une soirée Whan de ce club cette nuit-là
    // est le choix du pro : on s'aligne dessus, on ne le remplace jamais.
    const linkedEv = linkedEventOf(occ, tpl.affiliate_venue_id!);
    if (linkedEv) {
      used.add(linkedEv.id);
      pending.push({ occ, tpl, ev: linkedEv, setLink: false, replaceLink: false });
      continue;
    }
    if (ev) used.add(ev.id);
    const isWhanLink = !!occ.external_ticket_url && occ.external_ticket_url.includes("whan.es/");
    if (ev && !occ.external_ticket_url && !isClaimed(ev)) {
      pending.push({ occ, tpl, ev, setLink: true, replaceLink: false });
    } else if (ev && opts.force && isWhanLink && !isClaimed(ev)) {
      // Lien Whan qui ne désigne aucune soirée de cette nuit (périmé, mauvais
      // club) : remplacé, seulement en alignement forcé.
      pending.push({ occ, tpl, ev, setLink: true, replaceLink: true });
    } else if (!occ.external_ticket_url && occ.event_date <= addDays(today, TODO_HORIZON_DAYS)) {
      todo.push({ id: occ.id, date: occ.event_date, name: occ.name, reason: reason ?? "already_linked_elsewhere" });
    }
  }

  const rows = await mapLimit(pending, 4, async ({ occ, tpl, ev, setLink, replaceLink }) => {
    const row: Record<string, string> = { id: occ.id };
    if (setLink) {
      row.url = await ticketUrlFor(ev);
      row.ref = `whan:${ev.id}`;
      if (replaceLink) row.replace = "true";
    }
    // Chaque date porte le nom et l'affiche de SA soirée Whan (édition
    // spéciale comprise). Hors alignement forcé : jamais sur une date
    // personnalisée à la main, et l'affiche seulement si le modèle suit Whan.
    const name = displayName(ev.name) || ev.name;
    if (name && name !== occ.name && (opts.force || !occ.name_overridden)) row.name = name;
    if (ev.mainImage && !isWhanImage(occ.flyer_url, ev)
      && (opts.force || (!occ.flyer_overridden && tpl.flyer_url?.includes("/whan/")))) {
      const url = opts.apply ? await ensureImage(admin, affiliateId, ev) : `(whan image ${ev.mainImage})`;
      if (url) row.flyer_url = url;
    }
    return row;
  });
  const writes = rows.filter((r) => Object.keys(r).length > 1);

  // Soirées ponctuelles déjà créées sans affiche (Whan n'en avait pas encore) :
  // l'affiche arrive dès que Whan la publie. Jamais une affiche existante remplacée.
  const { data: bareOneOffs } = await admin
    .from("affiliate_events")
    .select("id, external_event_ref")
    .eq("affiliate_id", affiliateId)
    .is("recurring_template_id", null)
    .is("flyer_url", null)
    .like("external_event_ref", "whan:%")
    .gte("event_date", today);
  for (const o of bareOneOffs ?? []) {
    const ev = events.get((o.external_event_ref as string).slice(5));
    if (!ev?.mainImage) continue;
    const url = opts.apply ? await ensureImage(admin, affiliateId, ev) : `(whan image ${ev.mainImage})`;
    if (url) writes.push({ id: o.id as string, flyer_url: url });
  }

  let applied = { links: 0, flyers: 0, names: 0 };
  if (opts.apply && writes.length > 0) {
    const { data, error } = await admin.rpc("affiliate_ticket_sync_apply", {
      p_affiliate_id: affiliateId,
      p_rows: writes,
      p_silent: opts.trigger === "import",
      p_force: !!opts.force,
    });
    if (error) errors.push(error.message);
    else applied = data as typeof applied;
  }

  // 5. Soirées ponctuelles : une soirée Whan de nuit qui n'appartient à aucune
  // série et tombe une nuit que AUCUN modèle actif du club ne couvre (sinon
  // c'est au modèle de la prendre : série ou édition spéciale) est créée seule.
  const oneOffAccounts = new Set(sources.filter((s) => s.create_one_offs).map((s) => s.account_slug));
  const covered = (e: WhanEvent) => templates.some((t) =>
    t.is_active && t.affiliate_venue_id === e.venueId && t.day_of_week === dowOf(e.night)
    && bandOfTime(t.start_time) === "night");
  const oneOffs = oneOffAccounts.size === 0 ? [] : upcoming.filter((e) =>
    e.band === "night" && !used.has(e.id) && !isClaimed(e) && !covered(e)
    && e.accounts.some((a) => oneOffAccounts.has(a)));
  const oneOffRows = await mapLimit(oneOffs, 4, async (e) => {
    const { lowPrice } = await fetchWhanPage(e.id);
    const genres = templates
      .filter((t) => t.affiliate_venue_id === e.venueId && bandOfTime(t.start_time) === "night")
      .flatMap((t) => t.genres ?? []);
    const counts = new Map<string, number>();
    for (const g of genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    const topGenre = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      ref: `whan:${e.id}`,
      venue_id: e.venueId,
      name: displayName(e.name) || e.name,
      event_date: e.night,
      start_time: `${nightOf(e.start).hhmm}:00`,
      end_time: e.end ? `${e.end.slice(11, 16)}:00` : "",
      price_from: lowPrice != null && lowPrice > 0 ? String(lowPrice) : "",
      is_free: lowPrice === 0,
      flyer_url: opts.apply ? (await ensureImage(admin, affiliateId, e)) ?? "" : (e.mainImage ? `(whan image ${e.mainImage})` : ""),
      url: await ticketUrlFor(e),
      genres: topGenre ? [topGenre] : [],
    };
  });
  let oneOffsCreated = 0;
  if (opts.apply && oneOffRows.length > 0) {
    const { data, error } = await admin.rpc("affiliate_ticket_sync_create_one_offs", {
      p_affiliate_id: affiliateId,
      p_rows: oneOffRows,
    });
    if (error) errors.push(error.message);
    else oneOffsCreated = (data as { created: number }).created;
  }
  for (const e of oneOffs) used.add(e.id);

  const unmatched = upcoming
    .filter((e) => !used.has(e.id) && !isClaimed(e) && e.night <= addDays(today, UNMATCHED_HORIZON_DAYS))
    .sort((a, b) => a.night.localeCompare(b.night))
    .map((e) => ({ date: e.night, club: e.clubName, name: e.name, account: e.account }));

  if (opts.apply) {
    await admin.from("affiliate_ticket_sync_runs").insert({
      affiliate_id: affiliateId,
      trigger: opts.trigger,
      links_filled: applied.links,
      images_set: applied.flyers,
      one_offs_created: oneOffsCreated,
      names_set: applied.names,
      todo,
      unmatched,
      errors,
    });
  }

  return {
    whan_events: events.size,
    applied: opts.apply ? { ...applied, one_offs: oneOffsCreated } : undefined,
    one_offs: opts.apply ? undefined : oneOffRows,
    preview: opts.apply ? undefined : writes,
    todo,
    unmatched,
    errors,
    ...plan,
  };
}

// Détection des séries Whan et rapprochement avec les modèles Yuno.
async function importSeries(
  admin: SupabaseClient,
  affiliateId: string,
  upcoming: WhanEvent[],
  templates: Template[],
  clubTokens: Map<string, Set<string>>,
  apply: boolean,
  errors: string[],
) {
  const groups = new Map<string, WhanEvent[]>();
  for (const e of upcoming) {
    const k = `${e.venueId}|${dowOf(e.night)}|${e.band}|${e.base}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  // Seules les soirées de NUIT deviennent des modèles : un tardeo de fin
  // d'après-midi n'est jamais repris sur Yuno (règle de Paul, 2026-09-28),
  // même les jours où il est seul.
  const series = [...groups.values()]
    .filter((g) => g.length >= SERIES_MIN && g[0].band === "night")
    .map((g) => g.sort((a, b) => a.night.localeCompare(b.night)));

  // Ce que les liens déjà posés à la main disent de chaque modèle
  // (« holy-fridays-2026-10-02 » → série « holy fridays »).
  const { data: past } = await admin
    .from("affiliate_events")
    .select("recurring_template_id, external_ticket_url")
    .eq("affiliate_id", affiliateId)
    .not("recurring_template_id", "is", null)
    .ilike("external_ticket_url", "%whan.es/event/%");
  const learned = new Map<string, Set<string>>();
  for (const p of past ?? []) {
    const slug = (p.external_ticket_url as string).split("/event/")[1]?.split("?")[0] ?? "";
    const base = slug.startsWith("event_")
      ? upcoming.find((e) => e.id === slug)?.base ?? ""
      : slug.replace(/-\d{4}-\d{2}-\d{2}(-\d+)?$/, "").replace(/-/g, " ");
    if (!base) continue;
    const set = learned.get(p.recurring_template_id as string) ?? new Set<string>();
    set.add(base);
    learned.set(p.recurring_template_id as string, set);
  }

  const mostCommon = <T,>(xs: T[]): T => {
    const c = new Map<T, number>();
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const assigned = new Map<Template, WhanEvent[]>();
  const unassigned: WhanEvent[][] = [];
  const cellKey = (venue: string, dow: number, band: string) => `${venue}|${dow}|${band}`;
  const cells = new Map<string, { tpls: Template[]; series: WhanEvent[][] }>();
  for (const s of series) {
    const k = cellKey(s[0].venueId!, dowOf(s[0].night), s[0].band);
    const cell = cells.get(k) ?? { tpls: [], series: [] };
    cell.series.push(s);
    cells.set(k, cell);
  }
  for (const t of templates) {
    if (!t.affiliate_venue_id) continue;
    const cell = cells.get(cellKey(t.affiliate_venue_id, t.day_of_week, bandOfTime(t.start_time)));
    if (cell) cell.tpls.push(t);
  }
  for (const cell of cells.values()) {
    const pairs: Array<{ t: Template; s: WhanEvent[]; score: number }> = [];
    for (const t of cell.tpls) {
      for (const s of cell.series) {
        const key = `whan:${s[0].clubSlug}:${s[0].base}`;
        const ct = clubTokens.get(t.affiliate_venue_id!) ?? new Set<string>();
        let score = overlap(tokens(t.name, ct), tokens(s[0].name, ct)) * 10;
        if (learned.get(t.id)?.has(s[0].base)) score += 100;
        if (t.external_series_key === key) score += 1000;
        if (t.is_active) score += 1;
        pairs.push({ t, s, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    const tLeft = new Set(cell.tpls);
    const sLeft = new Set(cell.series);
    for (const p of pairs) {
      if (!tLeft.has(p.t) || !sLeft.has(p.s)) continue;
      const alone = tLeft.size === 1 && sLeft.size === 1;
      if (p.score >= 10 || alone) {
        assigned.set(p.t, p.s);
        tLeft.delete(p.t);
        sLeft.delete(p.s);
      }
    }
    unassigned.push(...sLeft);
  }

  const report: Array<Record<string, unknown>> = [];
  const simulated = templates.map((t) => ({ ...t }));

  const seriesFacts = async (s: WhanEvent[]) => {
    const main = mostCommon(s.map((e) => e.mainImage ?? ""));
    const ref = s.find((e) => (e.mainImage ?? "") === main) ?? s[0];
    const start = mostCommon(s.map((e) => nightOf(e.start).hhmm));
    const end = mostCommon(s.map((e) => e.end.slice(11, 16)));
    const { lowPrice } = await fetchWhanPage(s[0].id);
    return { ref, start, end, lowPrice };
  };

  for (const [t, s] of assigned) {
    const f = await seriesFacts(s);
    const key = `whan:${s[0].clubSlug}:${s[0].base}`;
    const patch: Record<string, unknown> = {
      name: displayName(mostCommon(s.map((e) => e.name))) || t.name,
      external_series_key: key,
      start_time: `${f.start}:00`,
      end_time: f.end ? `${f.end}:00` : t.end_time,
      is_active: true,
    };
    if (f.lowPrice != null && f.lowPrice > 0) patch.price_from = f.lowPrice;
    if (apply && f.ref.mainImage) {
      const img = await ensureImage(admin, affiliateId, f.ref);
      if (img) patch.flyer_url = img;
    } else if (f.ref.mainImage) patch.flyer_url = `(whan image ${f.ref.mainImage})`;
    report.push({ action: "update", template: t.name, whan: s[0].name, dates: s.length, patch });
    const sim = simulated.find((x) => x.id === t.id)!;
    Object.assign(sim, patch);
    if (apply) {
      const { error } = await admin.from("affiliate_recurring_templates").update(patch).eq("id", t.id);
      if (error) errors.push(`update ${t.name}: ${error.message}`);
      // Les dates déjà générées qui portaient l'ancien nom du modèle suivent
      // (celles que Whan n'a pas encore publiées ; les autres prennent le nom
      // de leur soirée Whan à la synchro).
      else if (patch.name !== t.name) {
        const { error: e2 } = await admin.from("affiliate_events")
          .update({ name: patch.name as string })
          .eq("recurring_template_id", t.id)
          .eq("name", t.name)
          .gte("event_date", currentNight());
        if (e2) errors.push(`rename ${t.name}: ${e2.message}`);
      }
    }
  }

  for (const s of unassigned) {
    const f = await seriesFacts(s);
    const venueId = s[0].venueId!;
    const siblings = templates.filter((t) => t.affiliate_venue_id === venueId);
    // Un tardeo (après-midi) n'est pas la soirée du club : pas de genre hérité.
    const genres = s[0].band === "night"
      ? siblings.filter((t) => bandOfTime(t.start_time) === "night").flatMap((t) => t.genres ?? [])
      : [];
    const name = displayName(mostCommon(s.map((e) => e.name))) || s[0].name;
    const row: Record<string, unknown> = {
      affiliate_id: affiliateId,
      affiliate_venue_id: venueId,
      name,
      slug: slugify(`${name}-${s[0].clubSlug}-${dowOf(s[0].night)}`),
      day_of_week: dowOf(s[0].night),
      start_time: `${f.start}:00`,
      end_time: f.end ? `${f.end}:00` : null,
      price_from: f.lowPrice != null && f.lowPrice > 0 ? f.lowPrice : null,
      is_free: f.lowPrice === 0,
      is_active: true,
      genres: genres.length ? [mostCommon(genres)] : [],
      external_series_key: `whan:${s[0].clubSlug}:${s[0].base}`,
      has_tables: false,
      tables_only: false,
      has_guest_list: false,
    };
    if (apply && f.ref.mainImage) row.flyer_url = await ensureImage(admin, affiliateId, f.ref);
    else if (f.ref.mainImage) row.flyer_url = `(whan image ${f.ref.mainImage})`;
    report.push({ action: "create", template: name, club: s[0].clubName, dates: s.length, row });
    if (apply) {
      const { error } = await admin.from("affiliate_recurring_templates").insert(row);
      if (error) errors.push(`create ${name}: ${error.message}`);
    } else {
      simulated.push({ ...(row as unknown as Template), id: `new:${name}` });
    }
  }

  const covered = new Set([...assigned.keys()].map((t) => t.id));
  for (const t of templates) {
    if (!t.is_active || covered.has(t.id) || !t.affiliate_venue_id) continue;
    if (![...clubTokens.keys()].includes(t.affiliate_venue_id)) continue;
    report.push({ action: "no_whan_series", template: t.name });
  }

  return { report, simulated };
}

// ── HTTP ────────────────────────────────────────────────────────────────────
serve(async (req) => {
  const corsHeaders = {
    ...restrictedCorsHeaders(req),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({})) as { mode?: string; apply?: boolean; trigger?: string; affiliate_id?: string; force?: boolean };
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const mode = body.mode === "import" ? "import" : "sync";
    let affiliateIds: string[];
    let trigger: RunOpts["trigger"] = mode === "import" ? "import" : "manual";
    let apply = mode === "import" ? body.apply === true : body.apply !== false;

    if (isCron) {
      if (body.trigger === "cron") {
        trigger = "cron";
        apply = true;
        // Le cron tape 16 h et 17 h UTC : seul le passage de 18 h à Madrid travaille.
        if (madridParts().hour !== 18) return json({ skipped: "not_18h_madrid" });
      }
      if (body.affiliate_id) affiliateIds = [body.affiliate_id];
      else {
        const { data } = await admin.from("affiliate_ticket_sources").select("affiliate_id").eq("is_active", true);
        affiliateIds = [...new Set((data ?? []).map((r) => r.affiliate_id as string))];
      }
    } else {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: aff } = await admin.from("affiliates").select("id").eq("user_id", user.id).eq("is_active", true).maybeSingle();
      if (!aff) return json({ error: "Affiliate profile required" }, 403);
      affiliateIds = [aff.id];
    }

    const results: Record<string, unknown> = {};
    for (const id of affiliateIds) {
      // L'alignement forcé (écrase titres / affiches personnalisés) n'est
      // ouvert qu'au serveur, jamais au bouton de la Console.
      results[id] = await runForAffiliate(admin, id, { mode, apply, trigger, force: isCron && body.force === true });
    }
    return json({ success: true, mode, apply, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("affiliate-ticket-sync:", message);
    return json({ error: message }, 500);
  }
});
