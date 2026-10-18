// La course « campagne déprogrammée pendant le passage du cron » (audit du
// 18/10, MAIL-04) : le VRAI passage du cron (`dispatchScheduledEmailCampaigns`)
// et la VRAIE règle de send-campaign (`scheduledSendRefusal`), contre une
// fausse base où le pro remet sa campagne en brouillon à chaque instant
// possible. Aucun réseau.
// Lancer : cd supabase/functions && deno test --no-lock process-scheduled-campaigns/scheduled_test.ts

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { dispatchScheduledEmailCampaigns, scheduledSendRefusal, NOT_SCHEDULED_ANYMORE } from "../_shared/scheduled-email-campaigns.ts";

type Row = { id: string; status: string; scheduled_at: string; error_message?: string | null };
interface Res { data: unknown; error: null }

class FakeDb {
  rows = new Map<string, Row>();
  /** Appelé juste avant chaque requête du cron : le pro agit à ce moment-là. */
  beforeQuery: (op: string) => void = () => {};
  constructor(...rows: Row[]) { for (const r of rows) this.rows.set(r.id, { ...r }); }
  status(id: string) { return this.rows.get(id)?.status; }
}

class Query implements PromiseLike<Res> {
  private op = "select";
  private payload: Partial<Row> = {};
  private filters: [string, unknown][] = [];
  private lteAt: string | null = null;
  constructor(private db: FakeDb) {}
  select(_c?: string) { return this; }
  update(p: Partial<Row>) { this.op = "update"; this.payload = p; return this; }
  eq(k: string, v: unknown) { this.filters.push([k, v]); return this; }
  lte(_k: string, v: string) { this.lteAt = v; return this; }
  limit(_n: number) { return this; }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
  private run(): Res {
    this.db.beforeQuery(this.op);
    const match = [...this.db.rows.values()].filter((r) =>
      this.filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v) && (!this.lteAt || r.scheduled_at <= this.lteAt));
    if (this.op === "update") for (const r of match) Object.assign(r, this.payload);
    return { data: match.map((r) => ({ id: r.id })), error: null };
  }
}

const fakeAdmin = (db: FakeDb) => ({ from: () => new Query(db) }) as unknown as SupabaseClient;

/** send-campaign en miniature : la règle réelle, puis « envoyé » si elle passe. */
function fakeSend(db: FakeDb, sent: string[], during: () => void = () => {}) {
  return (id: string) => {
    during();
    const refusal = scheduledSendRefusal(true, db.status(id));
    if (refusal) return Promise.resolve(new Response(JSON.stringify({ error: refusal }), { status: 409 }));
    sent.push(id);
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
}

const due = (id: string): Row => ({ id, status: "scheduled", scheduled_at: "2026-10-18T10:00:00.000Z" });
const NOW = new Date("2026-10-18T10:05:00.000Z");

Deno.test("sans course : la campagne échue est prise et envoyée", async () => {
  const db = new FakeDb(due("c1"));
  const sent: string[] = [];
  assertEquals(await dispatchScheduledEmailCampaigns(fakeAdmin(db), fakeSend(db, sent), NOW), 1);
  assertEquals(sent, ["c1"]);
  assertEquals(db.status("c1"), "sending");
});

Deno.test("déprogrammée entre la lecture et la prise : rien ne part, le brouillon reste", async () => {
  const db = new FakeDb(due("c1"));
  db.beforeQuery = (op) => { if (op === "update" && db.status("c1") === "scheduled") db.rows.get("c1")!.status = "draft"; };
  const sent: string[] = [];
  assertEquals(await dispatchScheduledEmailCampaigns(fakeAdmin(db), fakeSend(db, sent), NOW), 0);
  assertEquals(sent, []);
  assertEquals(db.status("c1"), "draft");
});

Deno.test("remise en brouillon après la prise : send-campaign refuse, le cron n'écrit pas « failed »", async () => {
  const db = new FakeDb(due("c1"));
  const sent: string[] = [];
  await dispatchScheduledEmailCampaigns(fakeAdmin(db), fakeSend(db, sent, () => { db.rows.get("c1")!.status = "draft"; }), NOW);
  assertEquals(sent, []);
  assertEquals(db.status("c1"), "draft");
});

Deno.test("send-campaign en panne pendant que le pro reprend son brouillon : jamais « failed » sur le brouillon", async () => {
  const db = new FakeDb(due("c1"), due("c2"));
  const invoke = (id: string) => {
    if (id === "c1") { db.rows.get("c1")!.status = "draft"; return Promise.resolve(new Response("{}", { status: 500 })); }
    return Promise.resolve(new Response("{}", { status: 500 }));
  };
  await dispatchScheduledEmailCampaigns(fakeAdmin(db), invoke, NOW);
  assertEquals(db.status("c1"), "draft");
  assertEquals(db.status("c2"), "failed"); // encore « sending » : l'échec est écrit
});

Deno.test("réseau coupé pendant l'appel et brouillon repris : jamais « failed » sur le brouillon", async () => {
  const db = new FakeDb(due("c1"));
  const invoke = () => { db.rows.get("c1")!.status = "draft"; return Promise.reject(new Error("connection reset")); };
  await dispatchScheduledEmailCampaigns(fakeAdmin(db), invoke, NOW);
  assertEquals(db.status("c1"), "draft");
});

Deno.test("deux passages du cron en même temps : un seul envoi", async () => {
  const db = new FakeDb(due("c1"));
  const sent: string[] = [];
  await Promise.all([
    dispatchScheduledEmailCampaigns(fakeAdmin(db), fakeSend(db, sent), NOW),
    dispatchScheduledEmailCampaigns(fakeAdmin(db), fakeSend(db, sent), NOW),
  ]);
  assertEquals(sent, ["c1"]);
});

Deno.test("règle de send-campaign : un appel du cron sur autre chose que « sending » est refusé", () => {
  for (const s of ["draft", "scheduled", "paused", "cancelled", "sent"]) assertEquals(scheduledSendRefusal(true, s), NOT_SCHEDULED_ANYMORE);
  assertEquals(scheduledSendRefusal(true, "sending"), null);
  assertEquals(scheduledSendRefusal(undefined, "draft"), null); // envoi du pro, pas du cron
});
