// Contrat simulé de la synchro Shotgun (audit du 18/10) : la VRAIE passe
// `syncConnection` contre un faux Shotgun (pagination et curseur « date_id »
// comme la doc officielle du 18/10) et une fausse base. Aucun réseau.
// Lancer : cd supabase/functions && deno test --no-lock affiliate-ticket-sync/ticketing_test.ts
//
// Ce que ça prouve : toutes les pages sont lues, rejouer ne double rien, une
// passe coupée reprend sans perte, le curseur n'avance jamais au-delà de ce
// qui est enregistré, un billet ancien modifié revient, 401 / 429 / 5xx /
// JSON invalide / forme inconnue / délai dépassé ne font ni boucle ni faux
// succès, et 5 pannes de suite mettent la connexion en erreur.

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type ConnRow, syncConnection } from "./ticketing.ts";

type Row = Record<string, unknown>;
interface Res { data: unknown; error: { message: string } | null }

// ── Fausse base ─────────────────────────────────────────────────────────────
class FakeDb {
  conn: ConnRow & Row; // + ce que la passe écrit (next_sync_at, last_ok_at…)
  tickets = new Map<string, Row>();
  events = new Map<string, Row>();
  runs: Row[] = [];
  upsertCalls = 0;
  failUpsertAt = -1; // n° d'appel d'upsert qui échoue
  constructor() {
    this.conn = {
      id: "conn-1", venue_id: null, organizer_user_id: "org-1", provider: "shotgun", external_org_id: "173027",
      external_org_name: null, status: "active", include_cohosted: true, tickets_cursor: null, events_synced_at: null,
      initial_import_done_at: null, locked_until: null, sync_interval_minutes: 15, fail_count: 0, amount_divisor: 100, schema_sample: null,
    };
  }
}

class Query implements PromiseLike<Res> {
  private op = "";
  private payload: unknown = null;
  private filters: [string, unknown][] = [];
  constructor(private db: FakeDb, private table: string) {}
  insert(p: unknown) { this.op = "insert"; this.payload = p; return this; }
  update(p: unknown) { this.op = "update"; this.payload = p; return this; }
  upsert(p: unknown, _o?: unknown) { this.op = "upsert"; this.payload = p; return this; }
  select(_c?: string) { return this; }
  eq(k: string, v: unknown) { this.filters.push([k, v]); return this; }
  single() { return this; }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run(): Res {
    const db = this.db;
    if (this.table === "ticketing_sync_runs") {
      if (this.op === "insert") {
        const id = `run-${db.runs.length}`;
        db.runs.push({ id, ...(this.payload as Row) });
        return { data: { id }, error: null };
      }
      const r = db.runs.find((x) => x.id === this.filters[0]?.[1]);
      if (r) Object.assign(r, this.payload as Row);
      return { data: null, error: null };
    }
    if (this.table === "ticketing_connections" && this.op === "update") {
      Object.assign(db.conn, this.payload as Row);
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      db.upsertCalls++;
      if (db.upsertCalls === db.failUpsertAt) return { data: null, error: { message: "db down" } };
      if (this.table === "external_tickets") {
        for (const row of this.payload as Row[]) db.tickets.set(`${row.connection_id}|${row.external_id}`, row);
      }
      if (this.table === "external_events") {
        for (const row of this.payload as Row[]) db.events.set(String(row.external_id), row);
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
}

function fakeAdmin(db: FakeDb): SupabaseClient {
  const admin = {
    rpc(name: string): Promise<Res> {
      if (name === "consume_ticketing_rate") return Promise.resolve({ data: 1, error: null });
      if (name === "get_ticketing_token") return Promise.resolve({ data: "tok_test_1234567890", error: null });
      return Promise.resolve({ data: {}, error: null });
    },
    from(table: string) { return new Query(db, table); },
  };
  return admin as unknown as SupabaseClient;
}

// ── Faux Shotgun ────────────────────────────────────────────────────────────
interface FakeTicket { ticket_id: number; ticket_updated_at: string; ticket_status: string; event_id: number; deal_price: number; contact_email: string; ordered_at: string }

class FakeShotgun {
  tickets: FakeTicket[] = [];
  /** Réponse de l'API Events (la même à chaque page : la lecture s'arrête sur une page sans soirée nouvelle). */
  events: Row[] = [];
  ticketCalls = 0;
  /** n° de requête /tickets → réponse forcée */
  faults = new Map<number, () => Response | Promise<Response>>();
  constructor(n: number) {
    const base = Date.parse("2026-09-01T10:00:00Z");
    for (let i = 1; i <= n; i++) {
      // Trois billets par horodatage : le curseur doit départager par l'id.
      const at = new Date(base + Math.floor(i / 3) * 60_000).toISOString();
      this.tickets.push({ ticket_id: 1000 + i, ticket_updated_at: at.replace("T", " ").replace("Z", ""), ticket_status: "valid",
        event_id: 77, deal_price: 1500, contact_email: `p${i}@example.test`, ordered_at: at });
    }
  }
  /** Shotgun : un billet modifié passe en fin de liste (date de mise à jour). */
  touch(id: number, status: string) {
    const t = this.tickets.find((x) => x.ticket_id === id)!;
    t.ticket_status = status;
    t.ticket_updated_at = new Date(Date.parse("2026-10-18T09:00:00Z")).toISOString().replace("T", " ").replace("Z", "");
  }
  private key(t: FakeTicket): [number, number] { return [Date.parse(`${t.ticket_updated_at.replace(" ", "T")}Z`), t.ticket_id]; }
  handle = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "smartboard-api.shotgun.live") return Response.json(this.events);
    this.ticketCalls++;
    const fault = this.faults.get(this.ticketCalls);
    if (fault) return await fault();
    const after = url.searchParams.get("after");
    let from: [number, number] = [-Infinity, -Infinity];
    if (after) {
      const i = after.lastIndexOf("_");
      const utc = (d: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d.replace(" ", "T")}Z`);
      from = i > 0 ? [utc(after.slice(0, i)), Number(after.slice(i + 1))] : [utc(after), -Infinity];
    }
    const rest = [...this.tickets].sort((a, b) => this.key(a)[0] - this.key(b)[0] || a.ticket_id - b.ticket_id)
      .filter((t) => { const [d, id] = this.key(t); return d > from[0] || (d === from[0] && id > from[1]); });
    const page = rest.slice(0, 100);
    const last = page[page.length - 1];
    const next = page.length === 100
      ? `https://api.shotgun.live/tickets?organizer_id=173027&after=${encodeURIComponent(`${last.ticket_updated_at}_${last.ticket_id}`)}`
      : null;
    return Response.json({ params: {}, pagination: { next }, data: page });
  };
}

async function withShotgun<T>(sg: FakeShotgun, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = sg.handle as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const pass = (db: FakeDb, sg: FakeShotgun) =>
  withShotgun(sg, () => syncConnection(fakeAdmin(db), { ...db.conn }, "test", Date.now() + 60_000));
const statuses = (db: FakeDb) => [...db.tickets.values()].map((t) => t.status);

// ── Les cas ─────────────────────────────────────────────────────────────────
Deno.test("toutes les pages sont importées, au-delà de la première", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(350);
  const r = await pass(db, sg);
  assertEquals(r.status, "ok");
  assertEquals(db.tickets.size, 350);
  assertEquals(sg.ticketCalls, 4);
  assert(String(db.conn.tickets_cursor).endsWith("_1350"));
  assert(db.conn.initial_import_done_at, "premier import marqué fini");
});

Deno.test("rejouer le même import ne crée aucun doublon", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(250);
  await pass(db, sg);
  db.conn.tickets_cursor = null; // reprise complète (procédure de rattrapage)
  const r = await pass(db, sg);
  assertEquals(r.status, "ok");
  assertEquals(db.tickets.size, 250);
});

Deno.test("une passe coupée (5xx) reprend au curseur, sans perte ni doublon", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(350);
  sg.faults.set(3, () => new Response("bad gateway", { status: 502 }));
  const r1 = await pass(db, sg);
  assertEquals(r1.status, "error");
  assertEquals(db.tickets.size, 200);
  assert(String(db.conn.tickets_cursor).endsWith("_1200"), "curseur posé après la 2e page");
  assertEquals(db.conn.fail_count, 1);
  const r2 = await pass(db, sg);
  assertEquals(r2.status, "ok");
  assertEquals(db.tickets.size, 350);
  assertEquals(db.conn.fail_count, 0);
});

Deno.test("le curseur n'avance jamais au-delà de ce qui est enregistré", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(350);
  db.failUpsertAt = 3; // la 3e page n'arrive pas en base
  const r = await pass(db, sg);
  assertEquals(r.status, "error");
  assertEquals(db.tickets.size, 200);
  assert(String(db.conn.tickets_cursor).endsWith("_1200"), `curseur = ${db.conn.tickets_cursor}`);
});

Deno.test("un billet ancien modifié chez Shotgun (remboursé) est rattrapé", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(120);
  await pass(db, sg);
  sg.touch(1005, "refunded");
  const r = await pass(db, sg);
  assertEquals(r.status, "ok");
  assertEquals(db.tickets.size, 120);
  assertEquals(db.tickets.get("conn-1|1005")?.status, "refunded");
});

Deno.test("401 : connexion coupée, une seule requête, aucun faux succès", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(50);
  sg.faults.set(1, () => new Response("", { status: 401 }));
  const r = await pass(db, sg);
  assertEquals(r.status, "error");
  assertEquals(db.conn.status, "token_invalid");
  assertEquals(sg.ticketCalls, 1);
  assertEquals(db.tickets.size, 0);
});

Deno.test("429 : la passe s'arrête et reprend dans 2 minutes, sans compter une panne", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(50);
  sg.faults.set(1, () => new Response("", { status: 429 }));
  const r = await pass(db, sg);
  assertEquals(r.status, "rate_limited");
  assertEquals(db.conn.fail_count, 0);
  const wait = Date.parse(String(db.conn.next_sync_at)) - Date.now();
  assert(wait > 100_000 && wait <= 120_000, `prochaine passe dans ${wait} ms`);
});

Deno.test("JSON invalide : panne comptée, pas de succès", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(50);
  sg.faults.set(1, () => new Response("<html>maintenance</html>", { status: 200 }));
  const r = await pass(db, sg);
  assertEquals(r.status, "error");
  assertEquals(db.conn.fail_count, 1);
  assertEquals(db.conn.initial_import_done_at, null);
});

Deno.test("200 de forme inconnue : panne, jamais « import terminé » (SYNC-02)", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(50);
  sg.faults.set(1, () => Response.json({ error: "maintenance" }));
  const r = await pass(db, sg);
  assertEquals(r.status, "error");
  assertEquals(r.error, "unexpected_response");
  assertEquals(db.conn.initial_import_done_at, null);
  assertEquals(db.runs[0].status, "error");
});

Deno.test("délai dépassé côté réseau : panne comptée, repli exponentiel", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(50);
  sg.faults.set(1, () => { throw new DOMException("The signal has been aborted", "AbortError"); });
  const r = await pass(db, sg);
  assertEquals(r.status, "error");
  assertEquals(db.conn.fail_count, 1);
  const wait = Date.parse(String(db.conn.next_sync_at)) - Date.now();
  assert(wait > 4 * 60_000 && wait <= 5 * 60_000, `repli de ${wait} ms`);
});

Deno.test("5 pannes de suite : connexion en erreur (alerte), jamais une boucle", async () => {
  const db = new FakeDb(); const sg = new FakeShotgun(50);
  for (let i = 1; i <= 5; i++) sg.faults.set(i, () => new Response("down", { status: 503 }));
  for (let i = 0; i < 5; i++) await pass(db, sg);
  assertEquals(db.conn.fail_count, 5);
  assertEquals(db.conn.status, "error");
  assertEquals(sg.ticketCalls, 5);
});

Deno.test("case « co-organisées » éteinte : une soirée editor / viewer n'entre pas (DATA-05)", async () => {
  const evs = [
    { id: 501, name: "Ma soirée", startTime: "2026-09-05T22:00:00Z", role: "organizer" },
    { id: 502, name: "Co-organisée", startTime: "2026-09-06T22:00:00Z", role: "editor" },
    { id: 503, name: "Invitée", startTime: "2026-09-07T22:00:00Z", role: "viewer" },
  ];
  const off = new FakeDb(); off.conn.include_cohosted = false;
  const sgOff = new FakeShotgun(10); sgOff.events = evs;
  assertEquals((await pass(off, sgOff)).status, "ok");
  assertEquals([...off.events.keys()].sort(), ["501"]);
  const on = new FakeDb();
  const sgOn = new FakeShotgun(10); sgOn.events = evs;
  assertEquals((await pass(on, sgOn)).status, "ok");
  assertEquals([...on.events.keys()].sort(), ["501", "502", "503"]);
});
