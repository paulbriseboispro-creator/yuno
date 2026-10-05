// Yuno CRM — lecture des réponses de l'API Shotgun (lot 1).
// Plan : docs/designs/YUNO_CRM_PLAN.md §5.2.
//
// Module PUR (aucun import Deno, aucun réseau) : importé par la fonction
// `affiliate-ticket-sync` et testé par vitest
// (src/lib/__tests__/ticketingShotgun.test.ts).
//
// Ce que Shotgun documente publiquement (relu le 05/10/2026, référence
// complète : docs/designs/SHOTGUN_API_REFERENCE.md) :
//   • Events  : GET smartboard-api.shotgun.live/api/shotgun/organizers/{id}/events
//               ?key=…  (upcoming par défaut ; past_events=true + page/limit ;
//               updated_after). Montants des tarifs (`deals`) en EUROS.
//   • Tickets : GET api.shotgun.live/tickets?organizer_id=…&after=…
//               (Bearer ; 100 par page ; pagination.next ; tri par mise à
//               jour puis id). Un objet = un billet, champs `ticket_*`,
//               `deal_*`, `contact_*` ; montants en CENTIMES.
// Le schéma des billets n'était pas publié au 02/10 : chaque champ se cherche
// d'abord sous son NOM DOCUMENTÉ, puis sous des noms plausibles (repli pour
// un changement de schéma), la réponse brute est gardée, et les CLÉS vues
// sont relevées (jamais les valeurs) à chaque synchro.

export type Json = Record<string, unknown>;

// ── Accès par chemin ────────────────────────────────────────────────────────

/** Valeur au chemin « a.b.0.c » (null si absente). */
export function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null) return null;
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i)) return null;
      cur = cur[i];
    } else if (typeof cur === "object") {
      cur = (cur as Json)[part];
    } else {
      return null;
    }
  }
  return cur === undefined ? null : cur;
}

/** Première valeur non vide parmi plusieurs chemins. */
export function pick(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = at(obj, p);
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return null;
}

export function str(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s.slice(0, max) : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "oui", "y"].includes(s)) return true;
    if (["false", "0", "no", "non", "n"].includes(s)) return false;
  }
  return null;
}

/** Date ISO normalisée (null si illisible). Accepte secondes / ms epoch. */
export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let d: Date;
  if (typeof v === "number") {
    d = new Date(v < 1e12 ? v * 1000 : v);
  } else if (typeof v === "string") {
    d = new Date(v);
  } else {
    return null;
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function email(v: unknown): string | null {
  const s = str(v, 320);
  if (!s) return null;
  const e = s.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Montant en unité monétaire. `divisor` = 100 si le fournisseur parle en centimes. */
export function money(v: unknown, divisor: number): number | null {
  const n = num(v);
  if (n === null) return null;
  const d = divisor > 0 ? divisor : 1;
  return Math.round((n / d) * 100) / 100;
}

// ── Pagination ──────────────────────────────────────────────────────────────

export interface Page {
  items: Json[];
  next: string | null;
}

/** Les listes peuvent être à la racine ou sous data / tickets / results / events. */
export function extractPage(body: unknown): Page {
  let items: unknown[] = [];
  if (Array.isArray(body)) items = body;
  else if (body && typeof body === "object") {
    for (const k of ["data", "tickets", "results", "events", "items"]) {
      const v = (body as Json)[k];
      if (Array.isArray(v)) { items = v; break; }
    }
  }
  const next = str(pick(body, ["pagination.next", "pagination.next_url", "next", "links.next"]), 2000);
  return {
    items: items.filter((x): x is Json => !!x && typeof x === "object" && !Array.isArray(x)),
    next,
  };
}

/** N'accepte de suivre un lien « page suivante » que sur l'hôte attendu. */
export function safeNextUrl(next: string | null, expectedHost: string): string | null {
  if (!next) return null;
  try {
    const u = new URL(next);
    return u.protocol === "https:" && u.hostname === expectedHost ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Clés (jamais les valeurs) d'un objet, sur deux niveaux : « contact.email »… */
export function schemaKeys(obj: unknown, depth = 2, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth <= 0) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Json)) {
    const key = prefix ? `${prefix}.${k}` : k;
    out.push(key);
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...schemaKeys(v, depth - 1, key));
  }
  return out.slice(0, 200);
}

// ── Billets ─────────────────────────────────────────────────────────────────

// Le premier nom de chaque liste est le nom DOCUMENTÉ par Shotgun ; les
// suivants ne servent que de repli.
const P = {
  id: ["ticket_id", "id", "ticketId", "uuid", "ticket.id"],
  orderId: ["order_id", "orderId", "order.id", "order_uuid", "purchase_id", "booking_id"],
  eventId: ["event_id", "eventId", "event.id"],
  dealId: ["deal_id", "dealId", "deal.id", "deal.product_id", "product_id", "productId", "ticket_type_id"],
  dealName: ["deal_title", "deal_name", "dealName", "dealTitle", "deal.name", "deal.title", "product_name", "ticket_type", "ticket_title"],
  status: ["ticket_status", "status", "state", "ticketStatus"],
  price: ["ticket_price", "price", "unit_price", "price_paid", "amount", "deal.price"],
  fees: ["user_fees", "service_fee", "service_fees", "buyer_fees", "booking_fee", "fees", "deal.user_fees"],
  currency: ["currency", "currency_code", "currencyCode", "deal.currency"],
  quantity: ["quantity", "qty"],
  buyerEmail: ["contact_email", "buyer_email", "purchaser_email", "customer_email", "email", "buyer.email", "contact.email", "customer.email", "user.email", "purchaser.email"],
  buyerFirst: ["contact_first_name", "buyer_first_name", "customer_first_name", "first_name", "firstname", "firstName", "buyer.first_name", "buyer.firstName", "contact.first_name", "contact.firstName", "contact.firstname", "customer.first_name", "user.first_name"],
  buyerLast: ["contact_last_name", "buyer_last_name", "customer_last_name", "last_name", "lastname", "lastName", "buyer.last_name", "buyer.lastName", "contact.last_name", "contact.lastName", "contact.lastname", "customer.last_name", "user.last_name"],
  buyerPhone: ["contact_phone", "buyer_phone", "customer_phone", "phone", "phone_number", "phoneNumber", "buyer.phone", "contact.phone", "contact.phone_number", "customer.phone", "user.phone"],
  buyerRef: ["contact_id", "buyer_id", "user_id", "userId", "customer_id", "buyer.id", "contact.id", "customer.id", "user.id"],
  holderEmail: ["holder_email", "attendee_email", "ticket_holder_email", "beneficiary_email", "holder.email", "attendee.email", "owner.email", "beneficiary.email"],
  holderFirst: ["holder_first_name", "attendee_first_name", "ticket_holder_first_name", "holder.first_name", "holder.firstName", "attendee.first_name", "owner.first_name"],
  holderLast: ["holder_last_name", "attendee_last_name", "ticket_holder_last_name", "holder.last_name", "holder.lastName", "attendee.last_name", "owner.last_name"],
  optin: ["contact_newsletter_optin", "newsletter_optin", "newsletterOptin", "newsletter_opt_in", "marketing_optin", "optin", "opt_in", "subscribed_to_newsletter", "contact.newsletter_optin", "buyer.newsletter_optin", "contact.newsletterOptin"],
  age: ["age", "buyer_age", "contact.age", "buyer.age"],
  birthdate: ["contact_birthday", "birthdate", "birthday", "birth_date", "date_of_birth", "contact.birthdate", "contact.birthday", "buyer.birthdate"],
  gender: ["contact_gender", "gender", "buyer_gender", "sex", "contact.gender", "buyer.gender"],
  city: ["contact_locality", "city", "buyer_city", "contact_city", "contact.city", "buyer.city", "address.city"],
  zip: ["contact_postal_code", "zip_code", "zipcode", "zipCode", "postal_code", "zip", "contact.zip_code", "contact.zipcode", "address.zip_code", "address.postal_code"],
  country: ["contact_country", "country_code", "countryCode", "country", "contact.country_code", "contact.country", "address.country_code"],
  purchasedAt: ["ordered_at", "order_date", "orderedAt", "purchased_at", "purchasedAt", "paid_at", "purchase_date", "created_at", "createdAt", "order.created_at"],
  scannedAt: ["ticket_scanned_at", "scanned_at", "scannedAt", "scan_date", "checked_in_at", "checkedInAt", "used_at", "last_scan_at", "scan.scanned_at", "scans.0.scanned_at", "scans.0.date"],
  refundedAt: ["ticket_canceled_at", "refunded_at", "refundedAt", "refund_date", "cancelled_at", "canceled_at", "cancelledAt", "canceledAt"],
  updatedAt: ["ticket_updated_at", "updated_at", "updatedAt", "last_updated_at", "modified_at", "modifiedAt"],
};

/** Montants que Shotgun documente EN CENTIMES (billets) : toujours ÷ 100. */
const CENTS = {
  price: "deal_price",
  userFees: "deal_user_service_fee",
};

// Nom de pays → code ISO (Shotgun rend `contact_country` en toutes lettres :
// « France »). Table construite une fois depuis Intl, en trois langues.
let countryIndex: Map<string, string> | null = null;
function foldName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}
export function countryCodeFrom(v: unknown): string | null {
  const s = str(v, 80);
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  if (!countryIndex) {
    countryIndex = new Map();
    for (const lang of ["en", "fr", "es"]) {
      let dn: Intl.DisplayNames;
      try { dn = new Intl.DisplayNames([lang], { type: "region" }); } catch { continue; }
      for (let a = 65; a < 91; a++) {
        for (let b = 65; b < 91; b++) {
          const code = String.fromCharCode(a, b);
          let name: string | undefined;
          try { name = dn.of(code); } catch { name = undefined; }
          if (name && name !== code) {
            const k = foldName(name);
            if (k && !countryIndex.has(k)) countryIndex.set(k, code);
          }
        }
      }
    }
    for (const [k, code] of [["unitedstates", "US"], ["usa", "US"], ["uk", "GB"], ["england", "GB"], ["greatbritain", "GB"]] as const) {
      countryIndex.set(k, code);
    }
  }
  return countryIndex.get(foldName(s)) ?? null;
}

export type TicketStatus = "valid" | "refunded" | "cancelled" | "transferred" | "other";

export function normalizeTicketStatus(raw: Json): { status: TicketStatus; rawStatus: string | null } {
  const rawStatus = str(pick(raw, P.status), 60);
  if (bool(pick(raw, ["refunded", "is_refunded", "isRefunded"])) === true) return { status: "refunded", rawStatus };
  if (bool(pick(raw, ["cancelled", "canceled", "is_cancelled", "is_canceled"])) === true) return { status: "cancelled", rawStatus };
  const s = (rawStatus ?? "").toLowerCase();
  if (!s) return { status: "valid", rawStatus };
  if (/refund|rembours/.test(s)) return { status: "refunded", rawStatus };
  // `rejected` = demande d'achat refusée par l'organisateur : jamais un billet.
  // `payment_plan_pending` / `pending_approval` restent « other » : ni vendus,
  // ni annulés, tant que Shotgun ne les a pas validés.
  if (/cancel|annul|void|revok|reject/.test(s)) return { status: "cancelled", rawStatus };
  if (/transfer|resold|resale|revendu|swap/.test(s)) return { status: "transferred", rawStatus };
  if (/^(valid|validated|paid|confirmed|completed|complete|ok|active|scanned|used|issued|sold)$/.test(s)) return { status: "valid", rawStatus };
  return { status: "other", rawStatus };
}

function ageFrom(raw: Json, now: Date): number | null {
  const a = num(pick(raw, P.age));
  if (a !== null && a >= 10 && a <= 100) return Math.round(a);
  const bd = isoDate(pick(raw, P.birthdate));
  if (!bd) return null;
  const b = new Date(bd);
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age >= 10 && age <= 100 ? age : null;
}

function genderFrom(v: unknown): string | null {
  const s = (str(v, 20) ?? "").toLowerCase();
  if (!s) return null;
  if (/^(f|female|femme|woman|w)$/.test(s)) return "female";
  if (/^(m|male|homme|man|h)$/.test(s)) return "male";
  return "other";
}

function utmFrom(raw: Json): Json | null {
  const out: Json = {};
  for (const [k, v] of Object.entries(raw)) {
    if (/^utm_/i.test(k) && v != null && v !== "") out[k.toLowerCase()] = String(v).slice(0, 200);
  }
  const nested = at(raw, "utm") ?? at(raw, "utms") ?? at(raw, "tracking");
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [k, v] of Object.entries(nested as Json)) {
      if (v != null && v !== "") out[(k.startsWith("utm_") ? k : `utm_${k}`).toLowerCase()] = String(v).slice(0, 200);
    }
  }
  return Object.keys(out).length ? out : null;
}

export interface MappedTicket {
  external_id: string;
  external_order_id: string | null;
  external_event_id: string | null;
  deal_id: string | null;
  deal_name: string | null;
  status: TicketStatus;
  raw_status: string | null;
  quantity: number;
  price: number | null;
  fees: number | null;
  currency: string | null;
  buyer_email: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_phone: string | null;
  buyer_ref: string | null;
  holder_email: string | null;
  holder_first_name: string | null;
  holder_last_name: string | null;
  newsletter_optin: boolean | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  zip_code: string | null;
  country_code: string | null;
  purchased_at: string | null;
  scanned_at: string | null;
  refunded_at: string | null;
  source_updated_at: string | null;
  utm: Json | null;
  raw: Json;
}

export function mapShotgunTicket(raw: Json, divisor = 1, now = new Date()): MappedTicket | null {
  const id = str(pick(raw, P.id), 120);
  if (!id) return null;
  const { status, rawStatus } = normalizeTicketStatus(raw);
  const qty = num(pick(raw, P.quantity));
  // Champs documentés en centimes d'abord ; `divisor` (réglage de la
  // connexion) ne vaut que pour un nom de repli non documenté.
  const price = money(at(raw, CENTS.price), 100) ?? money(pick(raw, P.price), divisor);
  const fees = money(at(raw, CENTS.userFees), 100) ?? money(pick(raw, P.fees), divisor);
  return {
    external_id: id,
    external_order_id: str(pick(raw, P.orderId), 120),
    external_event_id: str(pick(raw, P.eventId), 120),
    deal_id: str(pick(raw, P.dealId), 120),
    deal_name: str(pick(raw, P.dealName), 200),
    status,
    raw_status: rawStatus,
    quantity: qty && qty > 0 && qty < 1000 ? Math.round(qty) : 1,
    price,
    fees,
    currency: (str(pick(raw, P.currency), 8) ?? "").toUpperCase() || null,
    buyer_email: email(pick(raw, P.buyerEmail)),
    buyer_first_name: str(pick(raw, P.buyerFirst), 120),
    buyer_last_name: str(pick(raw, P.buyerLast), 120),
    buyer_phone: str(pick(raw, P.buyerPhone), 40),
    buyer_ref: str(pick(raw, P.buyerRef), 120),
    holder_email: email(pick(raw, P.holderEmail)),
    holder_first_name: str(pick(raw, P.holderFirst), 120),
    holder_last_name: str(pick(raw, P.holderLast), 120),
    newsletter_optin: bool(pick(raw, P.optin)),
    age: ageFrom(raw, now),
    gender: genderFrom(pick(raw, P.gender)),
    city: str(pick(raw, P.city), 120),
    zip_code: str(pick(raw, P.zip), 20),
    country_code: countryCodeFrom(pick(raw, P.country)),
    purchased_at: isoDate(pick(raw, P.purchasedAt)),
    scanned_at: isoDate(pick(raw, P.scannedAt)),
    refunded_at: status === "refunded" || status === "cancelled" ? isoDate(pick(raw, P.refundedAt)) : null,
    source_updated_at: isoDate(pick(raw, P.updatedAt)),
    utm: utmFrom(raw),
    raw,
  };
}

/**
 * Curseur `after` de /tickets : « date_idBillet » du DERNIER billet d'une page
 * (tri par date de mise à jour puis id). Sans date lisible : null — la passe
 * suivra alors `pagination.next` et repartira du dernier curseur sauvé.
 */
export function ticketCursor(raw: Json): string | null {
  const updated = isoDate(pick(raw, P.updatedAt));
  const id = str(pick(raw, P.id), 120);
  if (!updated || !id) return null;
  return `${updated}_${id}`;
}

// ── Soirées (schéma documenté) ──────────────────────────────────────────────

export interface MappedDeal {
  id: string | null;
  name: string | null;
  price: number | null;
  quantity: number | null;
  organizer_fees: number | null;
  user_fees: number | null;
  visibility: string | null;
  sales_channel: string | null;
  category: string | null;
}

export interface MappedEvent {
  external_id: string;
  name: string | null;
  slug: string | null;
  url: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  description: string | null;
  cover_url: string | null;
  street: string | null;
  city: string | null;
  zip_code: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  address_visibility: string | null;
  genres: string[];
  artists: { id: string | null; name: string; slug: string | null; avatar: string | null; url: string | null }[];
  deals: MappedDeal[];
  left_tickets: number | null;
  published_at: string | null;
  launched_at: string | null;
  cancelled_at: string | null;
  external_role: string | null;
  type_of_place: string | null;
  organizer_name: string | null;
  raw: Json;
}

export function mapShotgunEvent(raw: Json, divisor = 1): MappedEvent | null {
  const id = str(pick(raw, ["id", "event_id", "eventId"]), 120);
  if (!id) return null;
  const artistsRaw = at(raw, "artists");
  const genresRaw = at(raw, "genres");
  const dealsRaw = at(raw, "deals");
  const country = str(pick(raw, ["geolocation.countryIsoCode", "geolocation.country_iso_code", "countryIsoCode"]), 4);
  const url = str(pick(raw, ["url"]), 500);
  return {
    external_id: id,
    name: str(pick(raw, ["name", "title"]), 300),
    slug: str(pick(raw, ["slug"]), 300),
    url: url && /^https:\/\//.test(url) ? url : null,
    start_at: isoDate(pick(raw, ["startTime", "start_time", "startAt", "start_at"])),
    end_at: isoDate(pick(raw, ["endTime", "end_time", "endAt", "end_at"])),
    timezone: str(pick(raw, ["timezone", "timeZone"]), 60),
    description: str(pick(raw, ["description"]), 8000),
    cover_url: str(pick(raw, ["coverUrl", "cover_url", "coverThumbnailUrl", "image"]), 1000),
    street: str(pick(raw, ["geolocation.street", "address"]), 300),
    city: str(pick(raw, ["geolocation.city", "city"]), 120),
    zip_code: str(pick(raw, ["geolocation.zipCode", "geolocation.zip_code"]), 20),
    country_code: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    latitude: num(pick(raw, ["geolocation.latitude"])),
    longitude: num(pick(raw, ["geolocation.longitude"])),
    address_visibility: str(pick(raw, ["addressVisibility", "address_visibility"]), 20),
    genres: Array.isArray(genresRaw)
      ? genresRaw.map((g) => str(typeof g === "string" ? g : at(g, "name"), 60)).filter((g): g is string => !!g).slice(0, 20)
      : [],
    artists: Array.isArray(artistsRaw)
      ? artistsRaw.map((a) => ({
          id: str(at(a, "id"), 60),
          name: str(at(a, "name"), 120) ?? "",
          slug: str(at(a, "slug"), 120),
          avatar: str(at(a, "avatar"), 1000),
          url: str(at(a, "url"), 500),
        })).filter((a) => a.name).slice(0, 60)
      : [],
    deals: Array.isArray(dealsRaw)
      ? dealsRaw.map((d) => ({
          id: str(pick(d, ["product_id", "productId", "id"]), 60),
          name: str(pick(d, ["name", "title"]), 200),
          price: money(pick(d, ["price"]), divisor),
          quantity: num(pick(d, ["quantity"])),
          organizer_fees: money(pick(d, ["organizer_fees", "organizerFees"]), divisor),
          user_fees: money(pick(d, ["user_fees", "userFees"]), divisor),
          visibility: str(pick(d, ["visibility", "visiblity"]), 30),
          sales_channel: str(pick(d, ["sales_channel", "salesChannel"]), 30),
          category: str(pick(d, ["subcategory.name"]), 120),
        })).slice(0, 100)
      : [],
    left_tickets: num(pick(raw, ["leftTicketsCount", "left_tickets_count"])),
    published_at: isoDate(pick(raw, ["publishedAt", "published_at"])),
    launched_at: isoDate(pick(raw, ["launchedAt", "launched_at"])),
    cancelled_at: isoDate(pick(raw, ["cancelledAt", "canceledAt", "cancelled_at"])),
    external_role: str(pick(raw, ["role"]), 30),
    type_of_place: str(pick(raw, ["typeOfPlace", "type_of_place"]), 40),
    organizer_name: str(pick(raw, ["organizer.name"]), 200),
    raw,
  };
}

// ── URL ─────────────────────────────────────────────────────────────────────

export const SHOTGUN_TICKETS_HOST = "api.shotgun.live";
export const SHOTGUN_EVENTS_HOST = "smartboard-api.shotgun.live";

export function ticketsUrl(organizerId: string, opts: { after?: string | null; includeCohosted?: boolean; eventId?: string | null }): string {
  const u = new URL(`https://${SHOTGUN_TICKETS_HOST}/tickets`);
  u.searchParams.set("organizer_id", organizerId);
  if (opts.includeCohosted !== false) u.searchParams.set("include_cohosted_events", "1");
  if (opts.eventId) u.searchParams.set("event_id", opts.eventId);
  if (opts.after) u.searchParams.set("after", opts.after);
  return u.toString();
}

export function eventsUrl(
  organizerId: string,
  auth: { param: "key" | "token"; value: string },
  opts: { past?: boolean; page?: number; limit?: number; updatedAfter?: string | null },
): string {
  const u = new URL(`https://${SHOTGUN_EVENTS_HOST}/api/shotgun/organizers/${encodeURIComponent(organizerId)}/events`);
  u.searchParams.set(auth.param, auth.value);
  if (opts.past) {
    u.searchParams.set("past_events", "true");
    u.searchParams.set("page", String(opts.page ?? 0));
    u.searchParams.set("limit", String(opts.limit ?? 100));
  }
  if (opts.updatedAfter) u.searchParams.set("updated_after", opts.updatedAfter);
  return u.toString();
}

/** ID organisateur Shotgun : chiffres (ex. 173027), on tolère lettres / tirets. */
export function isValidOrganizerId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v.trim());
}
