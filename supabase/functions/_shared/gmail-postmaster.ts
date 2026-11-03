// Google Postmaster (API v2) : les chiffres que Gmail publie sur nos domaines.
//
// Gmail ne transmet aucun signalement « spam » un par un. Ce module lit, avec le
// jeton OAuth en LECTURE SEULE de Paul (scope postmaster.traffic.readonly, secrets
// POSTMASTER_*, posés par scripts/postmaster/authorize.mjs), pour chaque domaine :
// taux de signalements, erreurs de livraison, DMARC réussi, par jour, et l'état de
// conformité. Il écrit par record_gmail_postmaster (migration 20261127160000), qui
// alerte le super admin. Il ne lève jamais : une panne se lit dans last_error.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

const API = 'https://gmailpostmastertools.googleapis.com/v2';
export const POSTMASTER_DOMAINS = ['news.yunoapp.eu', 'yunoapp.eu'];

type GDate = { year: number; month: number; day: number };
type Stat = { metric?: string; date?: GDate; value?: { doubleValue?: number; floatValue?: number; intValue?: string } };

const gdate = (d: Date): GDate => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const iso = (d: GDate) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
const num = (v: Stat['value']) => v?.doubleValue ?? v?.floatValue ?? (v?.intValue != null ? Number(v.intValue) : null);

async function accessToken(): Promise<string> {
  const id = Deno.env.get('POSTMASTER_CLIENT_ID');
  const secret = Deno.env.get('POSTMASTER_CLIENT_SECRET');
  const refresh = Deno.env.get('POSTMASTER_REFRESH_TOKEN');
  if (!id || !secret || !refresh) throw new Error('postmaster_not_configured');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`oauth_${j.error ?? r.status}`);
  return j.access_token as string;
}

const METRICS = [
  { name: 'spam', baseMetric: { standardMetric: 'SPAM_RATE' } },
  { name: 'delivery_error', baseMetric: { standardMetric: 'DELIVERY_ERROR_RATE' } },
  { name: 'auth', baseMetric: { standardMetric: 'AUTH_SUCCESS_RATE' }, filter: 'auth_type = "dmarc"' },
];

async function queryDomain(token: string, domain: string, days: number) {
  const end = new Date(Date.now() - 864e5);
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  const rows = new Map<string, Record<string, number | null>>();
  for (const m of METRICS) {
    let pageToken: string | undefined;
    do {
      const r = await fetch(`${API}/domains/${domain}/domainStats:query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          timeQuery: { dateRanges: { dateRanges: [{ start: gdate(start), end: gdate(end) }] } },
          metricDefinitions: [m], aggregationGranularity: 'DAILY', pageSize: 200, pageToken,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${m.name}: ${j.error?.code ?? r.status} ${j.error?.message ?? ''}`.trim());
      for (const s of (j.domainStats ?? []) as Stat[]) {
        if (!s.date) continue;
        const k = iso(s.date);
        const row = rows.get(k) ?? {};
        row[m.name] = num(s.value);
        rows.set(k, row);
      }
      pageToken = j.nextPageToken || undefined;
    } while (pageToken);
  }
  return [...rows.entries()].map(([day, v]) => ({ day, spam: v.spam ?? null, delivery_error: v.delivery_error ?? null, auth: v.auth ?? null, raw: v }));
}

async function compliance(token: string, domain: string) {
  const r = await fetch(`${API}/domains/${domain}/complianceStatus`, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  return r.ok ? j : { error: j.error?.message ?? r.status };
}

export async function syncGmailPostmaster(admin: SupabaseClient, opts: { days?: number } = {}) {
  const days = Math.min(Math.max(opts.days ?? 10, 1), 120);
  const out: unknown[] = [];
  let token: string;
  try { token = await accessToken(); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const domain of POSTMASTER_DOMAINS) {
      await admin.rpc('record_gmail_postmaster', { p_domain: domain, p_days: [], p_compliance: null, p_error: msg });
    }
    return { ok: false, error: msg };
  }
  for (const domain of POSTMASTER_DOMAINS) {
    try {
      const rows = await queryDomain(token, domain, days);
      const comp = await compliance(token, domain);
      const { data, error } = await admin.rpc('record_gmail_postmaster', { p_domain: domain, p_days: rows, p_compliance: comp, p_error: null });
      out.push(error ? { domain, error: error.message } : { ...(data as object), sample: rows.slice(-3) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.rpc('record_gmail_postmaster', { p_domain: domain, p_days: [], p_compliance: null, p_error: msg });
      out.push({ domain, error: msg });
    }
  }
  return { ok: true, domains: out };
}
