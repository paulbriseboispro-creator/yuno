// Porte démo des envois fermée sur panne (audit du 18/10, MAIL-12).
// Lancer : cd supabase/functions && deno test --no-lock _shared/demo-guard_test.ts
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { demoMarketingScopeState } from "./demo-guard.ts";

const answers = (...xs: Array<{ data: unknown; error: unknown } | Error>) => {
  let i = 0;
  const calls: number[] = [];
  const rpc = () => {
    calls.push(i);
    const x = xs[Math.min(i++, xs.length - 1)];
    return x instanceof Error ? Promise.reject(x) : Promise.resolve(x);
  };
  return { rpc, calls };
};

Deno.test("démo / réel lus normalement", async () => {
  assertEquals(await demoMarketingScopeState("club", null, answers({ data: true, error: null }).rpc), "demo");
  assertEquals(await demoMarketingScopeState(null, "org", answers({ data: false, error: null }).rpc), "real");
});

Deno.test("portée plateforme : jamais démo, sans lecture", async () => {
  const a = answers({ data: true, error: null });
  assertEquals(await demoMarketingScopeState(null, null, a.rpc), "real");
  assertEquals(a.calls.length, 0);
});

Deno.test("panne passagère : retentée une fois", async () => {
  const a = answers({ data: null, error: { message: "503" } }, { data: false, error: null });
  assertEquals(await demoMarketingScopeState("club", null, a.rpc), "real");
  assertEquals(a.calls.length, 2);
});

Deno.test("panne qui dure : « inconnu », jamais « pas démo » (avant : l'envoi partait)", async () => {
  assertEquals(await demoMarketingScopeState("club", null, answers({ data: null, error: { message: "503" } }).rpc), "unknown");
  assertEquals(await demoMarketingScopeState("club", null, answers(new Error("network")).rpc), "unknown");
  assertEquals(await demoMarketingScopeState("club", null, answers({ data: "oui", error: null }).rpc), "unknown");
});
