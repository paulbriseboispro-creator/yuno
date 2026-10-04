// Yuno CRM : envoi des e-mails du cycle de vie (Yuno → pro). La base décide
// (crm_lifecycle_collect : interrupteurs, déclencheurs, registre anti-doublon,
// démo écartée, liste de suppression, politique d'envoi) ; ce module rend et
// envoie par Resend, une requête par e-mail, avec une clé d'idempotence = la
// ligne du registre (deux passes concurrentes ne font jamais deux envois).
// Tout est ÉTEINT par défaut : sans interrupteur allumé, la collecte rend vide.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { isDemoEmail } from "./demo-scope.ts";
import { renderLifecycleEmail, type LifecycleCopy, type LifecycleKey, type LifecycleLang } from "./crm-lifecycle-html.ts";

const ORIGIN = Deno.env.get("APP_BASE_URL") ?? "https://yunoapp.eu";

interface Queued { id: string; key: LifecycleKey; scope_key: string; email: string | null; lang: string; meta: Record<string, unknown> | null }
interface Collect { new: number; queued: Queued[]; copies: Record<string, Record<LifecycleLang, LifecycleCopy>> | null }

export async function dispatchCrmLifecycleEmails(admin: SupabaseClient, opts: { timeBudgetMs?: number } = {}): Promise<{ queued: number; sent: number; failed: number }> {
  const out = { queued: 0, sent: 0, failed: 0 };
  const stop = Date.now() + (opts.timeBudgetMs ?? 20_000);
  const { data, error } = await admin.rpc("crm_lifecycle_collect", { p_limit: 100 });
  if (error) { console.error("[CRM-LIFECYCLE] collect:", error.message); return out; }
  const d = data as Collect | null;
  const rows = d?.queued ?? [];
  out.queued = rows.length;
  const key = Deno.env.get("RESEND_API_KEY");
  const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
  const from = rawFrom ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`) : "Yuno <noreply@yunoapp.eu>";
  for (const r of rows) {
    if (Date.now() > stop) break;
    const mark = (ok: boolean, reason?: string) => admin.rpc("crm_lifecycle_mark", { p_id: r.id, p_ok: ok, p_reason: reason ?? null });
    // Double garde : la base écarte déjà la démo, on ne parie pas dessus.
    if (!r.email || isDemoEmail(r.email)) { await mark(false, "demo_no_send"); out.failed++; continue; }
    const lang: LifecycleLang = r.lang === "en" || r.lang === "es" ? r.lang : "fr";
    const copy = d?.copies?.[r.key]?.[lang] ?? d?.copies?.[r.key]?.fr;
    if (!copy || !key) { await mark(false, !key ? "no_resend_key" : "no_copy"); out.failed++; continue; }
    const vars: Record<string, string> = {};
    if (typeof r.meta?.balance === "number") vars.balance = new Intl.NumberFormat(lang === "en" ? "en-GB" : lang === "es" ? "es-ES" : "fr-FR").format(r.meta.balance as number);
    const { subject, html } = renderLifecycleEmail({ copy, lang, key: r.key, origin: ORIGIN, vars });
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Idempotency-Key": `crm-lifecycle-${r.id}` },
        body: JSON.stringify({ from, to: [r.email], subject, html, tags: [{ name: "kind", value: `crm_lifecycle_${r.key}` }] }),
      });
      if (res.ok) { await mark(true); out.sent++; }
      else { await mark(false, `resend_${res.status}`); out.failed++; console.error(`[CRM-LIFECYCLE] ${r.key} → ${res.status} ${(await res.text()).slice(0, 200)}`); }
    } catch (e) {
      await mark(false, "network"); out.failed++;
      console.error("[CRM-LIFECYCLE] send failed:", String(e));
    }
  }
  return out;
}
