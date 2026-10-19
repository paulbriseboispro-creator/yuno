// Alertes d'inscription pro → Cockpit de Paul (migration 20261103410000).
//
// Deux temps, appelés par process-scheduled-campaigns (tâche
// `pro_signup_alerts`, réveillée par le déclencheur à chaque alerte, plus le
// passage régulier du cron qui rattrape) :
//   1. ENVOI : chaque alerte réclamée devient une fiche (RPC
//      pro_signup_alert_payload, mise en forme par pro-signup-fiche.ts) postée
//      au Cockpit, qui crée ou met à jour le prospect et pousse la
//      notification sur le téléphone de Paul. Échec = réessai 1, 2, 4… min.
//   2. RECHERCHE : une fois la fiche partie, on cherche sur le web qui est la
//      structure (org-research.ts) et on complète la fiche (sans nouvelle
//      notification). Une recherche déjà faite pour la même structure et la
//      même ville est réutilisée.
//
// Secrets : COCKPIT_URL, COCKPIT_SIGNUP_TOKEN (sinon rien ne part, les alertes
// restent dans /admin/alerts) ; OPENAI_API_KEY pour la recherche.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { enrichFiche, researchInput, type RawFiche } from './pro-signup-fiche.ts';
import { researchOrg, type OrgResearch } from './org-research.ts';
import { logAiUsage } from './ai-usage.ts';
import { buildProSignupEmail } from './pro-signup-email.ts';
import { sendProEmail } from './analytics-digest-emails.ts';

type AlertRow = { id: string; kind: string; attempts: number; research: unknown; cockpit: { prospect_id?: string } | null };

async function postCockpit(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: unknown }> {
  const base = (Deno.env.get('COCKPIT_URL') ?? '').replace(/\/+$/, '');
  const token = Deno.env.get('COCKPIT_SIGNUP_TOKEN') ?? '';
  const res = await fetch(`${base}/api/yuno/signup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

export async function dispatchProSignupAlerts(
  admin: SupabaseClient,
  opts: { budgetMs?: number; research?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (!Deno.env.get('COCKPIT_URL') || !Deno.env.get('COCKPIT_SIGNUP_TOKEN')) {
    return { skipped: 'cockpit_not_configured' };
  }
  const budgetMs = opts.budgetMs ?? 60_000;
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  let sent = 0;
  let failed = 0;
  let researched = 0;

  // 1. Envoi des fiches.
  const { data: claimed, error: claimErr } = await admin.rpc('claim_pro_signup_alerts', { p_limit: 10 });
  if (claimErr) return { error: claimErr.message };
  for (const a of (claimed ?? []) as AlertRow[]) {
    try {
      const { data: raw, error } = await admin.rpc('pro_signup_alert_payload', { p_alert_id: a.id });
      if (error || !raw) throw new Error(error?.message ?? 'no_payload');
      const fiche = enrichFiche(raw as RawFiche);
      // Une recherche déjà faite (fiche renvoyée après un échec) repart avec elle.
      const r = await postCockpit({ type: 'signup', ...fiche, ...(a.research ? { research: a.research } : {}) });
      if (!r.ok) throw new Error(`cockpit_${r.status}`);
      await admin.rpc('finish_pro_signup_alert', { p_id: a.id, p_ok: true, p_error: null, p_cockpit: r.json ?? null });
      sent++;
    } catch (e) {
      failed++;
      await admin.rpc('finish_pro_signup_alert', {
        p_id: a.id, p_ok: false, p_error: e instanceof Error ? e.message : String(e), p_cockpit: null,
      });
    }
  }

  // 2. Recherche sur la structure (une IA coûte : une fois par alerte, jamais
  //    sur un compte supprimé, réutilisée pour la même structure).
  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
  while (opts.research !== false && apiKey && left() > 50_000) {
    const { data: rows, error } = await admin.rpc('claim_pro_signup_research', { p_limit: 1 });
    if (error || !rows?.length) break;
    const a = (rows as AlertRow[])[0];
    const { data: raw } = await admin.rpc('pro_signup_alert_payload', { p_alert_id: a.id });
    const input = raw ? researchInput(raw as RawFiche) : null;
    if (!input) {
      await admin.rpc('save_pro_signup_research', { p_id: a.id, p_status: 'skipped', p_research: null });
      continue;
    }

    let research: OrgResearch | null = null;
    const { data: known } = await admin.rpc('find_pro_signup_research', { p_org: input.name, p_city: input.city ?? '' });
    if (known) {
      research = known as OrgResearch;
    } else {
      const run = await researchOrg(input, apiKey);
      logAiUsage(admin, {
        assistant: 'signup_research',
        model: run.model,
        status: run.research ? 'ok' : 'error',
        error: run.error,
        promptTokens: run.usage.input,
        completionTokens: run.usage.output,
        latencyMs: run.latencyMs,
        toolCalls: ['web_search'],
        promptPreview: `${input.name}${input.city ? ` (${input.city})` : ''} · ${input.kind}`,
      });
      research = run.research;
      if (!research) {
        await admin.rpc('save_pro_signup_research', { p_id: a.id, p_status: 'failed', p_research: { error: run.error } });
        continue;
      }
    }
    await admin.rpc('save_pro_signup_research', { p_id: a.id, p_status: 'done', p_research: research });
    researched++;
    try {
      await postCockpit({ type: 'research', alert_id: a.id, research });
    } catch (e) {
      console.warn('[pro-signup-alerts] research → cockpit', e instanceof Error ? e.message : e);
    }
  }

  // 3. Filet : le Cockpit n'a joint aucun téléphone (aucun appareil abonné) →
  //    la fiche part par e-mail à Paul, recherche comprise.
  let emailed = 0;
  const to = Deno.env.get('SIGNUP_ALERT_EMAIL') ?? '';
  if (to) {
    const { data: due } = await admin.rpc('claim_pro_signup_emails', { p_limit: 5 });
    for (const a of (due ?? []) as AlertRow[]) {
      try {
        const { data: raw } = await admin.rpc('pro_signup_alert_payload', { p_alert_id: a.id });
        if (!raw) throw new Error('no_payload');
        const { subject, html } = buildProSignupEmail(
          enrichFiche(raw as RawFiche),
          (a.research && typeof a.research === 'object' && 'org_name' in (a.research as object)) ? a.research as OrgResearch : null,
          a.cockpit?.prospect_id ?? null,
        );
        if (!(await sendProEmail(to, subject, html, 'pro_signup_alert'))) throw new Error('email_failed');
        emailed++;
      } catch (e) {
        console.warn('[pro-signup-alerts] email', e instanceof Error ? e.message : e);
        await admin.rpc('release_pro_signup_email', { p_id: a.id });
      }
    }
  }

  return { sent, failed, researched, emailed };
}
