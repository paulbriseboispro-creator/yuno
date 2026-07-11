// Routeur Apple Wallet — monté DANS send-ticket-confirmation (décision D2 :
// hôte permanent, son URL est le webServiceURL des passes émis ; cap 402 =
// zéro nouvelle fonction). Routes (après le slug de la fonction) :
//
//   POST /wallet/issue                    — app authentifiée → { base64, downloadUrl }
//   GET  /wallet/pass/{serial}?t={token}  — lien email / SafariVC → .pkpass
//   —— Web service PassKit (spec Apple, auth « ApplePass <token> ») ——
//   POST   /wallet/v1/devices/{dlid}/registrations/{passType}/{serial}
//   DELETE /wallet/v1/devices/{dlid}/registrations/{passType}/{serial}
//   GET    /wallet/v1/devices/{dlid}/registrations/{passType}?passesUpdatedSince=
//   GET    /wallet/v1/passes/{passType}/{serial}
//   POST   /wallet/v1/log
//
// Les devices s'enregistrent dès la Phase 2 ; les pushes de mise à jour
// (topic = Pass Type ID, payload {}) arrivent en Phase 5.
// deno-lint-ignore-file no-explicit-any
import { buildPkpass, walletCertsFromEnv } from './signer.ts';
import { walletAssets } from './assets.ts';
import { buildTicketPass, buildVipPass, type PassBuild } from './passes.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PKPASS_MIME = 'application/vnd.apple.pkpass';

function log(step: string, details?: unknown) {
  console.log(`[WALLET] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparaison à temps constant (tokens de même longueur attendus). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Garantit la ligne wallet_passes d'une entité (idempotent — le token émis au
 * premier appel reste stable, il est embarqué dans les passes déjà ajoutés).
 * Utilisé par /wallet/issue ET par les emails de confirmation.
 */
export async function ensureWalletPass(
  admin: any,
  passType: 'ticket' | 'vip',
  referenceId: string,
  userId: string | null,
): Promise<{ serial: string; authToken: string }> {
  const serial = `${passType === 'ticket' ? 't' : 'v'}-${referenceId}`;
  const { data: existing } = await admin
    .from('wallet_passes')
    .select('serial, auth_token')
    .eq('serial', serial)
    .maybeSingle();
  if (existing) return { serial, authToken: existing.auth_token };

  const authToken = randomToken();
  const { error } = await admin.from('wallet_passes').insert({
    serial,
    pass_type: passType,
    reference_id: referenceId,
    user_id: userId,
    auth_token: authToken,
  });
  // Course entre deux émissions simultanées : relire la ligne gagnante.
  if (error) {
    const { data: raced } = await admin
      .from('wallet_passes')
      .select('auth_token')
      .eq('serial', serial)
      .maybeSingle();
    if (raced) return { serial, authToken: raced.auth_token };
    throw error;
  }
  return { serial, authToken };
}

/** URL de téléchargement direct d'un pass (emails, SafariVC). */
export function walletPassUrl(serial: string, authToken: string): string {
  const base = Deno.env.get('SUPABASE_URL') ?? 'https://fulawxvdlwtdlpkycixe.supabase.co';
  return `${base}/functions/v1/send-ticket-confirmation/wallet/pass/${serial}?t=${authToken}`;
}

/** Régénère le .pkpass signé d'une ligne wallet_passes. */
async function renderPass(admin: any, row: { serial: string; pass_type: string; reference_id: string; auth_token: string }): Promise<Uint8Array> {
  const build: PassBuild =
    row.pass_type === 'vip'
      ? await buildVipPass(admin, row.reference_id, row.auth_token)
      : await buildTicketPass(admin, row.reference_id, row.auth_token);
  return await buildPkpass(build.passJson, walletAssets(), walletCertsFromEnv());
}

function pkpassResponse(bytes: Uint8Array, serial: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': PKPASS_MIME,
      'Content-Disposition': `attachment; filename="yuno-${serial}.pkpass"`,
      'Cache-Control': 'no-store',
      'Last-Modified': new Date().toUTCString(),
    },
  });
}

function b64FromBytes(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Ligne wallet_passes par serial, ou null. */
async function passRow(admin: any, serial: string) {
  const { data } = await admin
    .from('wallet_passes')
    .select('serial, pass_type, reference_id, user_id, auth_token, voided, updated_at')
    .eq('serial', serial)
    .maybeSingle();
  return data;
}

/** Auth « ApplePass <token> » du web service PassKit. */
function applePassToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^ApplePass\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Point d'entrée : à appeler en tête de serve() de send-ticket-confirmation.
 * Retourne null si la requête ne concerne pas /wallet (→ flux email existant).
 */
export async function handleWalletRequest(req: Request, admin: any): Promise<Response | null> {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf('/wallet/');
  if (idx === -1) return null;
  const path = url.pathname.slice(idx + '/wallet'.length); // ex: /issue, /v1/passes/...

  try {
    // ── POST /wallet/issue — app authentifiée ─────────────────────────────
    if (path === '/issue' && req.method === 'POST') {
      const auth = req.headers.get('authorization') || '';
      const jwt = auth.replace(/^Bearer\s+/i, '');
      if (!jwt) return json({ error: 'Unauthorized' }, 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
      const user = userData?.user;
      if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

      const { type, id } = (await req.json()) as { type?: string; id?: string };
      const passType = type === 'table' || type === 'vip' ? 'vip' : type === 'ticket' ? 'ticket' : null;
      if (!passType || !id) return json({ error: 'type and id required' }, 400);

      // Contrôle de propriété AVANT toute émission.
      const table = passType === 'ticket' ? 'tickets' : 'table_reservations';
      const { data: row } = await admin.from(table).select('id, user_id, status').eq('id', id).maybeSingle();
      if (!row || row.user_id !== user.id) return json({ error: 'Not found' }, 404);
      if (row.status !== 'paid') return json({ error: 'Not paid' }, 400);

      const { serial, authToken } = await ensureWalletPass(admin, passType, id, user.id);
      const pass = await passRow(admin, serial);
      const bytes = await renderPass(admin, pass);
      log('issued', { serial, user: user.id });
      return json({ base64: b64FromBytes(bytes), downloadUrl: walletPassUrl(serial, authToken), serial });
    }

    // ── GET /wallet/pass/{serial}?t= — lien email / SafariVC ─────────────
    const passMatch = path.match(/^\/pass\/([A-Za-z0-9-]+)$/);
    if (passMatch && req.method === 'GET') {
      const row = await passRow(admin, passMatch[1]);
      const token = url.searchParams.get('t') || '';
      if (!row || !token || !safeEqual(token, row.auth_token)) {
        return json({ error: 'Not found' }, 404);
      }
      const bytes = await renderPass(admin, row);
      log('downloaded', { serial: row.serial });
      return pkpassResponse(bytes, row.serial);
    }

    // ── Web service PassKit ───────────────────────────────────────────────
    // POST/DELETE /v1/devices/{dlid}/registrations/{passType}/{serial}
    const regMatch = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/[^/]+\/([A-Za-z0-9-]+)$/);
    if (regMatch) {
      const [, deviceId, serial] = regMatch;
      const row = await passRow(admin, serial);
      const token = applePassToken(req);
      if (!row || !token || !safeEqual(token, row.auth_token)) return json({}, 401);

      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const pushToken = (body as any)?.pushToken;
        if (!pushToken) return json({}, 400);
        const { data: existing } = await admin
          .from('wallet_pass_registrations')
          .select('push_token')
          .eq('device_library_id', deviceId)
          .eq('pass_serial', serial)
          .maybeSingle();
        if (existing) {
          if (existing.push_token !== pushToken) {
            await admin
              .from('wallet_pass_registrations')
              .update({ push_token: pushToken })
              .eq('device_library_id', deviceId)
              .eq('pass_serial', serial);
          }
          return json({}, 200);
        }
        await admin.from('wallet_pass_registrations').insert({
          device_library_id: deviceId,
          pass_serial: serial,
          push_token: pushToken,
        });
        log('registered', { serial, device: deviceId.slice(0, 8) });
        return json({}, 201);
      }
      if (req.method === 'DELETE') {
        await admin
          .from('wallet_pass_registrations')
          .delete()
          .eq('device_library_id', deviceId)
          .eq('pass_serial', serial);
        return json({}, 200);
      }
    }

    // GET /v1/devices/{dlid}/registrations/{passType}?passesUpdatedSince=
    const listMatch = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/[^/]+$/);
    if (listMatch && req.method === 'GET') {
      const deviceId = listMatch[1];
      const since = url.searchParams.get('passesUpdatedSince');
      const { data: regs } = await admin
        .from('wallet_pass_registrations')
        .select('pass_serial, wallet_passes!inner(updated_at)')
        .eq('device_library_id', deviceId);
      const all = (regs ?? []) as Array<{ pass_serial: string; wallet_passes: { updated_at: string } }>;
      const sinceMs = since ? Date.parse(since) : 0;
      const changed = all.filter((r) => !since || Date.parse(r.wallet_passes.updated_at) > sinceMs);
      if (changed.length === 0) return new Response(null, { status: 204, headers: CORS });
      const lastUpdated = changed
        .map((r) => r.wallet_passes.updated_at)
        .sort()
        .at(-1)!;
      return json({ serialNumbers: changed.map((r) => r.pass_serial), lastUpdated });
    }

    // GET /v1/passes/{passType}/{serial}
    const getMatch = path.match(/^\/v1\/passes\/[^/]+\/([A-Za-z0-9-]+)$/);
    if (getMatch && req.method === 'GET') {
      const row = await passRow(admin, getMatch[1]);
      const token = applePassToken(req);
      if (!row || !token || !safeEqual(token, row.auth_token)) return json({}, 401);
      const bytes = await renderPass(admin, row);
      return pkpassResponse(bytes, row.serial);
    }

    // POST /v1/log — journal d'erreurs des devices (précieux en debug)
    if (path === '/v1/log' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      log('device-log', body);
      return json({}, 200);
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('[WALLET] Error:', e);
    return json({ error: e instanceof Error ? e.message : 'Wallet error' }, 500);
  }
}
