// Yuno CRM — connecteurs de billetterie (lot 1), servis par affiliate-ticket-sync.
// Plan : docs/designs/YUNO_CRM_PLAN.md §5.2 ; tables : migration 20261002150000.
//
// Pourquoi ici : le quota de fonctions edge est atteint (402 depuis le 29/09),
// et cette fonction fait déjà de la synchro de billetterie (Whan) avec ses
// deux portes (cron + JWT). Le code Whan n'est pas touché : index.ts route
// vers ce module dès que le corps porte `action: "ticketing_*"`.
//
// Actions
//   ticketing_connect     (pro)  vérifie l'ID + le jeton chez Shotgun, garde le
//                                jeton dans le Vault, lance l'import.
//   ticketing_sync_now    (pro)  avance la prochaine passe (1 / 5 min).
//   ticketing_disconnect  (pro)  efface le jeton, GARDE les données.
//   ticketing_purge       (pro)  supprime la connexion ET les données importées.
//   ticketing_drain       (cron) réclame les connexions dues et les lit ~45 s,
//                                puis se relance tant qu'un import a du retard.
//
// Garde-fous
//   • Débit : consume_ticketing_rate('shotgun', 45) avant CHAQUE requête —
//     le quota Shotgun (100 / min / IP) est commun à tous les clients.
//   • Curseur sauvé après chaque page : une passe coupée reprend où elle était.
//   • 401 / 403 → connexion « token_invalid », alerte super admin + pro.
//   • 429 → la connexion attend 2 min ; 5 pannes de suite → « error » + alerte.
//   • Jamais d'écriture chez Shotgun, jamais de jeton dans une réponse.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { demoAccountGuard } from "../_shared/demo-guard.ts";
import {
  eventsUrl,
  extractPage,
  isValidOrganizerId,
  type Json,
  mapShotgunEvent,
  mapShotgunTicket,
  type MappedEvent,
  type MappedTicket,
  safeNextUrl,
  schemaKeys,
  SHOTGUN_TICKETS_HOST,
  ticketCursor,
  ticketsUrl,
} from "../_shared/ticketing-shotgun.ts";

const RATE_KEY = "shotgun";
const RATE_PER_MINUTE = 45;
const BUDGET_MS = 45_000;
const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;
const MAX_CHAIN = 60;
const MAX_FAILS = 5;
const UA = "YunoCRM/1.0 (+https://yunoapp.eu)";

type Json200 = (body: unknown, status?: number) => Response;

interface Ctx {
  req: Request;
  body: Json;
  admin: SupabaseClient;
  supabaseUrl: string;
  isCron: boolean;
  json: Json200;
  cors: Record<string, string>;
}

interface ConnRow {
  id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  provider: string;
  external_org_id: string;
  external_org_name: string | null;
  status: string;
  include_cohosted: boolean;
  tickets_cursor: string | null;
  events_synced_at: string | null;
  initial_import_done_at: string | null;
  sync_interval_minutes: number;
  fail_count: number;
  amount_divisor: number;
  schema_sample: Json | null;
}

interface Scope {
  venueId: string | null;
  organizerUserId: string | null;
}

// ── HTTP vers Shotgun ───────────────────────────────────────────────────────

class ProviderError extends Error {
  constructor(public kind: "auth" | "rate" | "http" | "network", public httpStatus: number | null, msg: string) {
    super(msg);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attend un créneau du limiteur commun ; false si l'échéance est dépassée. */
async function takeRateSlot(admin: SupabaseClient, deadline: number): Promise<boolean> {
  while (Date.now() < deadline - 3_000) {
    const { data, error } = await admin.rpc("consume_ticketing_rate", { p_key: RATE_KEY, p_limit: RATE_PER_MINUTE, p_n: 1 });
    if (!error && Number(data) >= 1) return true;
    await sleep(2_000);
  }
  return false;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA, ...headers }, signal: ctrl.signal });
  } catch (e) {
    throw new ProviderError("network", null, e instanceof Error ? e.message : "network_error");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new ProviderError("auth", res.status, `http_${res.status}`);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new ProviderError("rate", 429, "http_429");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ProviderError("http", res.status, `http_${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  return await res.json().catch(() => {
    throw new ProviderError("http", res.status, "invalid_json");
  });
}

// L'API Events attend `key` ; l'ancien paramètre `token` est marqué déprécié.
// On essaie `key`, puis `token` si Shotgun refuse, et on retient ce qui marche.
async function fetchEvents(
  admin: SupabaseClient, conn: Pick<ConnRow, "external_org_id">, token: string, deadline: number,
  opts: { past?: boolean; page?: number; updatedAfter?: string | null }, preferred: "key" | "token" | null,
  counter: { requests: number },
): Promise<{ items: Json[]; param: "key" | "token" }> {
  const order: ("key" | "token")[] = preferred === "token" ? ["token", "key"] : ["key", "token"];
  let lastAuth: ProviderError | null = null;
  for (const param of order) {
    if (!(await takeRateSlot(admin, deadline))) throw new ProviderError("rate", null, "budget");
    counter.requests++;
    try {
      const body = await getJson(eventsUrl(conn.external_org_id, { param, value: token }, { ...opts, limit: PAGE_SIZE }), {});
      return { items: extractPage(body).items, param };
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "auth") { lastAuth = e; continue; }
      throw e;
    }
  }
  throw lastAuth ?? new ProviderError("auth", 401, "http_401");
}

async function fetchTicketsPage(
  admin: SupabaseClient, url: string, token: string, deadline: number, counter: { requests: number },
): Promise<{ items: Json[]; next: string | null } | null> {
  if (!(await takeRateSlot(admin, deadline))) return null;
  counter.requests++;
  const body = await getJson(url, { Authorization: `Bearer ${token}` });
  const page = extractPage(body);
  return { items: page.items, next: safeNextUrl(page.next, SHOTGUN_TICKETS_HOST) };
}

// ── Écriture ────────────────────────────────────────────────────────────────

function eventRow(conn: ConnRow, e: MappedEvent) {
  const rest: Partial<MappedEvent> = { ...e };
  delete rest.organizer_name;
  return {
    ...rest,
    connection_id: conn.id,
    venue_id: conn.venue_id,
    organizer_user_id: conn.organizer_user_id,
    provider: conn.provider,
    synced_at: new Date().toISOString(),
  };
}

function ticketRow(conn: ConnRow, t: MappedTicket) {
  return {
    ...t,
    connection_id: conn.id,
    venue_id: conn.venue_id,
    organizer_user_id: conn.organizer_user_id,
    provider: conn.provider,
    synced_at: new Date().toISOString(),
  };
}

async function upsertChunks(admin: SupabaseClient, table: string, rows: Record<string, unknown>[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await admin.from(table).upsert(chunk, { onConflict: "connection_id,external_id" });
    if (error) throw new Error(`${table}_upsert: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

// ── Une passe sur une connexion ─────────────────────────────────────────────

interface SyncResult {
  more: boolean;
  status: "ok" | "partial" | "error" | "rate_limited";
  events: number;
  tickets: number;
  error?: string;
}

async function notifyPro(admin: SupabaseClient, conn: ConnRow, type: string, title: string, message: string, priority: string, metadata: Json, dedup: string | null) {
  try {
    if (conn.venue_id) {
      await admin.rpc("emit_staff_notification", {
        p_venue_id: conn.venue_id, p_target_role: "owner", p_type: type, p_title: title, p_message: message,
        p_priority: priority, p_reference_type: "ticketing_connection", p_reference_id: conn.id, p_event_id: null,
        p_metadata: metadata, p_dedup_key: dedup,
      });
    } else if (conn.organizer_user_id) {
      await admin.rpc("emit_organizer_notification", {
        p_organizer_user_id: conn.organizer_user_id, p_type: type, p_title: title, p_message: message,
        p_priority: priority, p_reference_type: "ticketing_connection", p_reference_id: conn.id, p_event_id: null,
        p_metadata: metadata, p_dedup_key: dedup,
      });
    }
  } catch (e) {
    console.error("[ticketing] notifyPro:", e instanceof Error ? e.message : String(e));
  }
}

async function notifyAdmin(admin: SupabaseClient, conn: ConnRow, type: string, title: string, message: string, dedup: string) {
  try {
    const scope = conn.venue_id ? `venue:${conn.venue_id}` : `org:${conn.organizer_user_id}`;
    await admin.rpc("emit_admin_notification", {
      p_type: type, p_title: title, p_message: `${message} (${scope}, ${conn.provider} ${conn.external_org_id})`,
      p_priority: "high", p_reference_type: "ticketing_connection", p_reference_id: conn.id,
      p_metadata: { scope, provider: conn.provider, external_org_id: conn.external_org_id }, p_dedup_key: dedup, p_event_id: null,
    });
  } catch (e) {
    console.error("[ticketing] notifyAdmin:", e instanceof Error ? e.message : String(e));
  }
}

async function syncConnection(admin: SupabaseClient, conn: ConnRow, trigger: string, deadline: number): Promise<SyncResult> {
  const startedIso = new Date().toISOString();
  const counter = { requests: 0 };
  let pages = 0;
  let eventsUpserted = 0;
  let ticketsUpserted = 0;
  const sample: Json = { ...(conn.schema_sample ?? {}) };

  const { data: runRow } = await admin.from("ticketing_sync_runs")
    .insert({ connection_id: conn.id, trigger }).select("id").single();
  const runId = (runRow as { id: string } | null)?.id ?? null;

  const finishRun = async (status: SyncResult["status"], error: string | null, detail: Json | null) => {
    if (!runId) return;
    await admin.from("ticketing_sync_runs").update({
      finished_at: new Date().toISOString(), status, requests: counter.requests, pages,
      events_upserted: eventsUpserted, tickets_upserted: ticketsUpserted, error, detail,
    }).eq("id", runId);
  };

  const { data: token } = await admin.rpc("get_ticketing_token", { p_connection_id: conn.id });
  if (typeof token !== "string" || !token) {
    await admin.from("ticketing_connections").update({ locked_until: null, status: "disconnected" }).eq("id", conn.id);
    await finishRun("error", "no_token", null);
    return { more: false, status: "error", events: 0, tickets: 0, error: "no_token" };
  }

  let cursor = conn.tickets_cursor;
  try {
    // 1. Soirées : à venir + passées. Premier import = tout l'historique ;
    //    ensuite seulement ce qui a changé depuis la dernière passe complète.
    const preferred = (sample.events_auth === "token" ? "token" : sample.events_auth === "key" ? "key" : null) as "key" | "token" | null;
    const updatedAfter = conn.events_synced_at;
    const events: MappedEvent[] = [];
    const up = await fetchEvents(admin, conn, token, deadline, { updatedAfter }, preferred, counter);
    sample.events_auth = up.param;
    for (const raw of up.items) {
      const m = mapShotgunEvent(raw, conn.amount_divisor);
      if (m) events.push(m);
    }
    for (let page = 0; page < 200; page++) {
      if (Date.now() > deadline - 6_000) break;
      const past = await fetchEvents(admin, conn, token, deadline, { past: true, page, updatedAfter }, up.param, counter);
      for (const raw of past.items) {
        const m = mapShotgunEvent(raw, conn.amount_divisor);
        if (m) events.push(m);
      }
      if (past.items.length < PAGE_SIZE) break;
    }
    if (events.length) {
      if (!sample.event_keys) sample.event_keys = schemaKeys(events[0].raw);
      const orgName = events.find((e) => e.external_role !== "cohost" && e.organizer_name)?.organizer_name ?? null;
      if (orgName && !conn.external_org_name) {
        await admin.from("ticketing_connections").update({ external_org_name: orgName }).eq("id", conn.id);
      }
      const byId = new Map(events.map((e) => [e.external_id, e]));
      eventsUpserted = await upsertChunks(admin, "external_events", [...byId.values()].map((e) => eventRow(conn, e)));
    }

    // 2. Billets : du curseur jusqu'à la fin, page par page.
    let url: string | null = ticketsUrl(conn.external_org_id, { after: cursor, includeCohosted: conn.include_cohosted });
    let caughtUp = false;
    while (url) {
      if (Date.now() > deadline - 6_000) break;
      const page = await fetchTicketsPage(admin, url, token, deadline, counter);
      if (!page) break; // plus de créneau de débit avant l'échéance
      pages++;
      const mapped = page.items.map((raw) => mapShotgunTicket(raw, conn.amount_divisor)).filter((t): t is MappedTicket => !!t);
      if (mapped.length && !sample.ticket_keys) sample.ticket_keys = schemaKeys(page.items[0]);
      if (mapped.length) {
        const byId = new Map(mapped.map((t) => [t.external_id, t]));
        ticketsUpserted += await upsertChunks(admin, "external_tickets", [...byId.values()].map((t) => ticketRow(conn, t)));
      }
      const last = page.items[page.items.length - 1];
      const nextCursor = last ? ticketCursor(last) : null;
      if (nextCursor) cursor = nextCursor;
      await admin.from("ticketing_connections").update({ tickets_cursor: cursor, schema_sample: sample }).eq("id", conn.id);
      if (page.items.length < PAGE_SIZE) { caughtUp = true; break; }
      url = page.next ?? (nextCursor ? ticketsUrl(conn.external_org_id, { after: nextCursor, includeCohosted: conn.include_cohosted }) : null);
      if (!url) { caughtUp = true; break; }
    }

    // 3. Fin de passe. Soirées miroir, billets reliés à leur soirée, accords
    //    newsletter versés au registre (migration 20261002160000) — aussi
    //    après une passe partielle, pour que la base se remplisse pendant un
    //    long import.
    let after: Json | null = null;
    {
      const { data: a, error: aErr } = await admin.rpc("ticketing_after_sync", { p_connection_id: conn.id });
      if (aErr) console.error("[ticketing] after_sync:", aErr.message);
      else after = (a ?? null) as Json | null;
    }
    if (caughtUp) {
      const now = new Date();
      const firstImport = !conn.initial_import_done_at;
      await admin.from("ticketing_connections").update({
        status: "active", fail_count: 0, last_ok_at: now.toISOString(), last_error: null, last_error_at: null,
        events_synced_at: startedIso, initial_import_done_at: conn.initial_import_done_at ?? now.toISOString(),
        next_sync_at: new Date(now.getTime() + conn.sync_interval_minutes * 60_000).toISOString(),
        locked_until: null, schema_sample: sample,
      }).eq("id", conn.id);
      const { data: stats } = await admin.rpc("ticketing_refresh_stats", { p_connection_id: conn.id });
      await finishRun("ok", null, after);
      if (firstImport) {
        const s = (stats ?? {}) as Json;
        await notifyPro(admin, conn, "ticketing_import_done", "Historique Shotgun importé",
          `${Number(s.tickets ?? 0)} billets et ${Number(s.buyers ?? 0)} acheteurs sont maintenant dans votre base Yuno.`,
          "normal", { tickets: s.tickets ?? 0, buyers: s.buyers ?? 0, events: s.events ?? 0 }, `ticketing_import_done:${conn.id}`);
      }
      return { more: false, status: "ok", events: eventsUpserted, tickets: ticketsUpserted };
    }
    // Échéance atteinte : on rend la main, la passe suivante reprend au curseur.
    await admin.from("ticketing_connections").update({
      locked_until: null, next_sync_at: new Date().toISOString(), last_ok_at: new Date().toISOString(),
      fail_count: 0, schema_sample: sample,
    }).eq("id", conn.id);
    await finishRun("partial", null, { cursor, ...(after ?? {}) });
    return { more: true, status: "partial", events: eventsUpserted, tickets: ticketsUpserted };
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError("http", null, e instanceof Error ? e.message : String(e));
    const nowIso = new Date().toISOString();
    if (err.kind === "auth") {
      await admin.from("ticketing_connections").update({
        status: "token_invalid", last_error: err.message, last_error_at: nowIso, locked_until: null, tickets_cursor: cursor,
      }).eq("id", conn.id);
      await finishRun("error", err.message, null);
      await notifyAdmin(admin, conn, "admin_ticketing_token_invalid", "Jeton Shotgun refusé",
        `Shotgun refuse le jeton d'une connexion (${err.message})`, `ticketing_token_invalid:${conn.id}`);
      await notifyPro(admin, conn, "ticketing_token_invalid", "Connexion Shotgun coupée",
        "Shotgun refuse votre jeton API. Générez un nouveau jeton dans Smartboard → Paramètres → Intégrations → Shotgun APIs, puis collez-le dans Réglages → Intégrations.",
        "high", { provider: conn.provider }, `ticketing_token_invalid:${conn.id}`);
      return { more: false, status: "error", events: eventsUpserted, tickets: ticketsUpserted, error: err.message };
    }
    if (err.kind === "rate") {
      await admin.from("ticketing_connections").update({
        locked_until: null, tickets_cursor: cursor, next_sync_at: new Date(Date.now() + 2 * 60_000).toISOString(),
      }).eq("id", conn.id);
      await finishRun("rate_limited", err.message, { cursor });
      return { more: false, status: "rate_limited", events: eventsUpserted, tickets: ticketsUpserted, error: err.message };
    }
    const fails = conn.fail_count + 1;
    const backoffMin = Math.min(5 * 2 ** (fails - 1), 120);
    await admin.from("ticketing_connections").update({
      fail_count: fails, last_error: err.message.slice(0, 300), last_error_at: nowIso, locked_until: null,
      tickets_cursor: cursor, status: fails >= MAX_FAILS ? "error" : "active",
      next_sync_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
    }).eq("id", conn.id);
    await finishRun("error", err.message.slice(0, 300), { cursor });
    if (fails >= MAX_FAILS) {
      await notifyAdmin(admin, conn, "admin_ticketing_sync_failing", "Synchro Shotgun en panne",
        `${fails} passes de suite en échec : ${err.message.slice(0, 120)}`, `ticketing_sync_failing:${conn.id}`);
    }
    return { more: false, status: "error", events: eventsUpserted, tickets: ticketsUpserted, error: err.message };
  }
}

// ── Drain (cron / chaîne) ───────────────────────────────────────────────────

async function drain(admin: SupabaseClient, trigger: string, connectionId: string | null): Promise<{ claimed: number; more: boolean; results: Json[] }> {
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const { data, error } = await admin.rpc("claim_ticketing_connections", {
    p_limit: connectionId ? 1 : 4, p_lease_seconds: 150, p_connection_id: connectionId,
  });
  if (error) throw new Error(`claim: ${error.message}`);
  const conns = (data ?? []) as ConnRow[];
  let more = false;
  const results: Json[] = [];
  for (const conn of conns) {
    if (Date.now() > deadline - 8_000) {
      await admin.from("ticketing_connections").update({ locked_until: null, next_sync_at: new Date().toISOString() }).eq("id", conn.id);
      more = true;
      continue;
    }
    const r = await syncConnection(admin, conn, trigger, deadline);
    if (r.more) more = true;
    results.push({ id: conn.id, status: r.status, events: r.events, tickets: r.tickets, error: r.error ?? null });
  }
  if (!connectionId && !more) {
    // D'autres connexions attendent peut-être (plus de 4 dues à la fois).
    const { count } = await admin.from("ticketing_connections").select("id", { count: "exact", head: true })
      .eq("status", "active").lte("next_sync_at", new Date().toISOString()).not("vault_secret_id", "is", null)
      .or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`);
    if ((count ?? 0) > 0) more = true;
  }
  return { claimed: conns.length, more, results };
}

function waitUntil(p: Promise<unknown>) {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch((e) => console.error("[ticketing] background:", e instanceof Error ? e.message : String(e))));
  else p.catch(() => undefined);
}

/** Relance la fonction (secret cron) : un import de 100 000 billets dure ~25 min. */
function chain(supabaseUrl: string, depth: number, connectionId: string | null) {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || depth >= MAX_CHAIN) return;
  waitUntil(fetch(`${supabaseUrl}/functions/v1/affiliate-ticket-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify({ action: "ticketing_drain", trigger: "chain", depth: depth + 1, connection_id: connectionId }),
  }).then((r) => r.body?.cancel()));
}

async function drainAndMaybeChain(admin: SupabaseClient, supabaseUrl: string, trigger: string, connectionId: string | null, depth: number) {
  const r = await drain(admin, trigger, connectionId);
  if (r.more) chain(supabaseUrl, depth, connectionId);
  return r;
}

// ── Actions du pro ──────────────────────────────────────────────────────────

function parseScope(raw: unknown): Scope | null {
  const s = (raw && typeof raw === "object" ? raw : {}) as Json;
  const venueId = typeof s.venueId === "string" && s.venueId.trim() ? s.venueId.trim() : null;
  const organizerUserId = typeof s.organizerUserId === "string" && /^[0-9a-f-]{36}$/i.test(s.organizerUserId) ? s.organizerUserId : null;
  if ((venueId === null) === (organizerUserId === null)) return null;
  return { venueId, organizerUserId };
}

async function findConnection(admin: SupabaseClient, scope: Scope, provider: string): Promise<ConnRow | null> {
  let q = admin.from("ticketing_connections").select("*").eq("provider", provider);
  q = scope.venueId ? q.eq("venue_id", scope.venueId) : q.eq("organizer_user_id", scope.organizerUserId!);
  const { data } = await q.maybeSingle();
  return (data ?? null) as ConnRow | null;
}

/** Vérifie l'ID + le jeton par deux lectures minimales (aucun historique lu). */
async function verifyShotgun(admin: SupabaseClient, organizerId: string, token: string): Promise<{ ok: true; orgName: string | null; eventsAuth: "key" | "token" | null } | { ok: false; error: string }> {
  const deadline = Date.now() + 30_000;
  const counter = { requests: 0 };
  try {
    // Billets mis à jour après « maintenant » : réponse vide, mais authentifiée.
    const probe = await fetchTicketsPage(admin, ticketsUrl(organizerId, { after: new Date().toISOString() }), token, deadline, counter);
    if (!probe) return { ok: false, error: "rate_limited" };
  } catch (e) {
    if (e instanceof ProviderError && e.kind === "auth") return { ok: false, error: "invalid_token" };
    if (e instanceof ProviderError && e.kind === "rate") return { ok: false, error: "rate_limited" };
    if (e instanceof ProviderError && e.httpStatus === 404) return { ok: false, error: "unknown_organizer" };
    return { ok: false, error: "provider_unreachable" };
  }
  try {
    const ev = await fetchEvents(admin, { external_org_id: organizerId }, token, deadline, {}, null, counter);
    const name = ev.items.map((r) => mapShotgunEvent(r)).find((m) => m && m.external_role !== "cohost" && m.organizer_name)?.organizer_name ?? null;
    return { ok: true, orgName: name, eventsAuth: ev.param };
  } catch {
    // Les billets passent : on accepte, la passe complète réessaiera les soirées.
    return { ok: true, orgName: null, eventsAuth: null };
  }
}

export async function handleTicketingAction(ctx: Ctx): Promise<Response> {
  const { req, body, admin, supabaseUrl, isCron, json, cors } = ctx;
  const action = String(body.action ?? "");

  if (action === "ticketing_drain") {
    if (!isCron) return json({ error: "forbidden" }, 403);
    const trigger = body.trigger === "chain" ? "chain" : "cron";
    const depth = Number(body.depth ?? 0) || 0;
    const connectionId = typeof body.connection_id === "string" ? body.connection_id : null;
    const r = await drainAndMaybeChain(admin, supabaseUrl, trigger, connectionId, depth);
    return json({ ok: true, ...r });
  }

  // Les autres actions sont celles du pro : JWT vérifié ici.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const scope = parseScope(body.scope);
  if (!scope) return json({ error: "invalid_scope" }, 400);
  const { data: allowed, error: allowErr } = await userClient.rpc("ticketing_scope_allowed", {
    p_venue_id: scope.venueId, p_organizer_user_id: scope.organizerUserId,
  });
  if (allowErr || allowed !== true) return json({ error: "forbidden" }, 403);
  const provider = body.provider === undefined ? "shotgun" : String(body.provider);
  if (provider !== "shotgun") return json({ error: "unsupported_provider" }, 400);

  const supportSession = await isSupportSessionToken(
    admin as unknown as Parameters<typeof isSupportSessionToken>[0], authHeader.slice(7),
  );

  if (action === "ticketing_connect") {
    if (supportSession) return json({ error: "support_session_forbidden" }, 403);
    const demoRefusal = await demoAccountGuard(req, cors);
    if (demoRefusal) return demoRefusal;
    const organizerId = typeof body.externalOrgId === "string" ? body.externalOrgId.trim() : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!isValidOrganizerId(organizerId)) return json({ error: "invalid_organizer_id" }, 400);
    if (token.length < 12 || token.length > 4000 || /\s/.test(token)) return json({ error: "invalid_token_format" }, 400);

    const check = await verifyShotgun(admin, organizerId, token);
    if (!check.ok) return json({ error: check.error }, check.error === "invalid_token" ? 400 : 502);

    const existing = await findConnection(admin, scope, provider);
    const sameOrg = existing?.external_org_id === organizerId;
    const patch = {
      external_org_id: organizerId,
      external_org_name: check.orgName ?? (sameOrg ? existing?.external_org_name ?? null : null),
      include_cohosted: body.includeCohosted !== false,
      status: "active",
      next_sync_at: new Date().toISOString(),
      locked_until: null,
      fail_count: 0,
      schema_sample: check.eventsAuth ? { ...(sameOrg ? existing?.schema_sample ?? {} : {}), events_auth: check.eventsAuth } : (sameOrg ? existing?.schema_sample ?? null : null),
      // Autre organisation Shotgun = autre historique : on repart de zéro.
      ...(sameOrg ? {} : { tickets_cursor: null, events_synced_at: null, initial_import_done_at: null }),
    };
    let connectionId: string;
    if (existing) {
      const { error } = await admin.from("ticketing_connections").update(patch).eq("id", existing.id);
      if (error) return json({ error: "save_failed", detail: error.message }, 500);
      connectionId = existing.id;
    } else {
      const { data, error } = await admin.from("ticketing_connections").insert({
        ...patch, provider, venue_id: scope.venueId, organizer_user_id: scope.organizerUserId, created_by: user.id,
      }).select("id").single();
      if (error || !data) return json({ error: "save_failed", detail: error?.message }, 500);
      connectionId = (data as { id: string }).id;
    }
    const { error: vaultErr } = await admin.rpc("store_ticketing_token", { p_connection_id: connectionId, p_token: token });
    if (vaultErr) return json({ error: "token_store_failed" }, 500);

    waitUntil(drainAndMaybeChain(admin, supabaseUrl, "connect", connectionId, 0));
    return json({ ok: true, connection_id: connectionId, org_name: patch.external_org_name });
  }

  const existing = await findConnection(admin, scope, provider);
  if (!existing) return json({ error: "not_connected" }, 404);

  if (action === "ticketing_sync_now") {
    if (existing.status === "disconnected") return json({ error: "not_connected" }, 409);
    const { data: last } = await admin.from("ticketing_sync_runs").select("started_at").eq("connection_id", existing.id)
      .eq("trigger", "manual").order("started_at", { ascending: false }).limit(1).maybeSingle();
    const lastAt = (last as { started_at?: string } | null)?.started_at;
    if (lastAt && Date.now() - new Date(lastAt).getTime() < 5 * 60_000) return json({ error: "too_soon" }, 429);
    await admin.from("ticketing_connections").update({
      next_sync_at: new Date().toISOString(),
      ...(existing.status === "error" ? { status: "active", fail_count: 0 } : {}),
    }).eq("id", existing.id);
    if (existing.status === "token_invalid") return json({ error: "token_invalid" }, 409);
    waitUntil(drainAndMaybeChain(admin, supabaseUrl, "manual", existing.id, 0));
    return json({ ok: true });
  }

  if (action === "ticketing_disconnect") {
    if (supportSession) return json({ error: "support_session_forbidden" }, 403);
    // Un compte démo garde sa connexion de démonstration (lien d'aperçu compris).
    const demoRefusal = await demoAccountGuard(req, cors);
    if (demoRefusal) return demoRefusal;
    const { error } = await admin.rpc("forget_ticketing_token", { p_connection_id: existing.id });
    if (error) return json({ error: "disconnect_failed" }, 500);
    return json({ ok: true });
  }

  if (action === "ticketing_purge") {
    if (supportSession) return json({ error: "support_session_forbidden" }, 403);
    const demoRefusal = await demoAccountGuard(req, cors);
    if (demoRefusal) return demoRefusal;
    const { error } = await admin.from("ticketing_connections").delete().eq("id", existing.id);
    if (error) return json({ error: "purge_failed", detail: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "unknown_action" }, 400);
}

