// Meta — connexion en un clic (Facebook Login for Business) : helpers purs.
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md §4/§5 phase 2 ;
// mise en service : docs/META_GO_LIVE_GUIDE.md.
//
// Ce module ne touche pas à la base. Il sait : construire l'URL du dialogue
// Meta, signer/vérifier le `state` (HMAC, 15 min), échanger un code contre un
// jeton, reconnaître un jeton de système « Business Integration » (n'expire
// pas) d'un jeton utilisateur (60 j après échange longue durée), découvrir
// les actifs (pixels, comptes pub, Pages) et vérifier les `signed_request`
// que Meta envoie pour la suppression de données / la désautorisation.
//
// Toute requête Graph porte `appsecret_proof` (HMAC du jeton par le secret
// d'app) : sans lui, un jeton volé suffit ; avec lui, il faut aussi le secret.

import { META_GRAPH_VERSION } from "./meta-capi.ts";

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
const STATE_TTL_MS = 15 * 60 * 1000;

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  /** Identifiant de la configuration Facebook Login for Business. */
  loginConfigId: string;
  redirectUri: string;
}

/** Lit la config depuis l'environnement ; null si la phase 2 n'est pas encore branchée. */
export function readMetaAppConfig(supabaseUrl: string): MetaAppConfig | null {
  const appId = Deno.env.get("META_APP_ID") ?? "";
  const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
  const loginConfigId = Deno.env.get("META_LOGIN_CONFIG_ID") ?? "";
  if (!appId || !appSecret || !loginConfigId) return null;
  return {
    appId,
    appSecret,
    loginConfigId,
    redirectUri: `${supabaseUrl}/functions/v1/meta-connect/oauth/callback`,
  };
}

// ── Crypto ───────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacRaw(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `appsecret_proof` = HMAC-SHA256(app_secret, access_token), hex. */
export async function appSecretProof(appSecret: string, token: string): Promise<string> {
  return hmacHex(appSecret, token);
}

// ── State OAuth (sans table : signé et daté) ─────────────────────────────────

export interface OAuthState {
  v: 1;
  venueId: string | null;
  organizerUserId: string | null;
  userId: string;
  returnTo: string;
  nonce: string;
  ts: number;
}

export async function signState(secret: string, state: OAuthState): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(state)));
  const sig = b64url(await hmacRaw(secret, payload));
  return `${payload}.${sig}`;
}

export async function verifyState(secret: string, raw: string | null): Promise<OAuthState | null> {
  if (!raw || !raw.includes(".")) return null;
  const [payload, sig] = raw.split(".", 2);
  const expected = b64url(await hmacRaw(secret, payload));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const state = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as OAuthState;
    if (state.v !== 1 || typeof state.ts !== "number") return null;
    if (Date.now() - state.ts > STATE_TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}

/** Seules les pages Intégrations (et le système admin) sont des retours valides. */
export function safeReturnTo(raw: unknown): string {
  const allowed = ["/owner/integrations", "/organizer-app/integrations", "/admin/system"];
  return typeof raw === "string" && allowed.includes(raw) ? raw : "/owner/integrations";
}

export function buildDialogUrl(cfg: MetaAppConfig, state: string): string {
  const u = new URL(DIALOG);
  u.searchParams.set("client_id", cfg.appId);
  u.searchParams.set("config_id", cfg.loginConfigId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("override_default_response_type", "true");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

// ── Graph ────────────────────────────────────────────────────────────────────

export interface GraphError { code?: number; error_subcode?: number; message?: string; error_user_msg?: string; error_user_title?: string; type?: string; fbtrace_id?: string }

export async function graphGet<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string>,
  opts: { token?: string; appSecret?: string; timeoutMs?: number } = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: GraphError }> {
  const u = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (opts.token) {
    u.searchParams.set("access_token", opts.token);
    if (opts.appSecret) u.searchParams.set("appsecret_proof", await appSecretProof(opts.appSecret, opts.token));
  }
  let res: Response;
  try {
    res = await fetch(u.toString(), { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
  } catch (e) {
    return { ok: false, status: 0, error: { message: e instanceof Error ? e.message : "network" } };
  }
  const json = await res.json().catch(() => null) as (T & { error?: GraphError }) | null;
  if (res.ok && json) return { ok: true, data: json };
  return { ok: false, status: res.status, error: json?.error ?? { message: `HTTP ${res.status}` } };
}

export async function graphDelete(path: string, token: string, appSecret: string): Promise<boolean> {
  const u = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  u.searchParams.set("access_token", token);
  u.searchParams.set("appsecret_proof", await appSecretProof(appSecret, token));
  try {
    const res = await fetch(u.toString(), { method: "DELETE", signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Échange le `code` du dialogue contre un jeton. */
export async function exchangeCode(cfg: MetaAppConfig, code: string) {
  return graphGet<{ access_token: string; token_type?: string; expires_in?: number }>("oauth/access_token", {
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    redirect_uri: cfg.redirectUri,
    code,
  });
}

/** Jeton utilisateur court → longue durée (~60 jours). */
export async function exchangeLongLived(cfg: MetaAppConfig, shortToken: string) {
  return graphGet<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: shortToken,
  });
}

export interface MetaAsset { id: string; name: string }
export interface MetaAssets { pixels: MetaAsset[]; ad_accounts: MetaAsset[]; pages: MetaAsset[] }

interface Edge { data?: Array<{ id: string; name?: string; account_id?: string }> }

async function edgeList(path: string, token: string, appSecret: string, fields: string): Promise<MetaAsset[]> {
  const r = await graphGet<Edge>(path, { fields, limit: "100" }, { token, appSecret });
  if (!r.ok || !Array.isArray(r.data.data)) return [];
  return r.data.data.map((x) => ({ id: String(x.id), name: x.name ?? (x.account_id ? `act_${x.account_id}` : x.id) }));
}

function dedupe(list: MetaAsset[]): MetaAsset[] {
  const seen = new Set<string>();
  return list.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

/**
 * Identité du jeton + actifs. Jeton de système « Business Integration » :
 * `/me` rend `client_business_id` et les actifs se lisent sur le portefeuille.
 * Jeton utilisateur (petit club sans Business Manager) : `/me/adaccounts`,
 * `/me/accounts`, pixels par compte pub.
 */
export async function discoverAssets(token: string, appSecret: string): Promise<{
  ok: boolean;
  kind: "bisu" | "user";
  metaUserId: string | null;
  businessId: string | null;
  assets: MetaAssets;
  error?: string;
}> {
  const me = await graphGet<{ id?: string; name?: string; client_business_id?: string }>("me", { fields: "id,name,client_business_id" }, { token, appSecret });
  if (!me.ok) return { ok: false, kind: "user", metaUserId: null, businessId: null, assets: { pixels: [], ad_accounts: [], pages: [] }, error: me.error.message };
  const metaUserId = me.data.id ?? null;
  const businessId = me.data.client_business_id ?? null;

  if (businessId) {
    const [op, cp, oa, ca, opg, cpg] = await Promise.all([
      edgeList(`${businessId}/owned_pixels`, token, appSecret, "id,name"),
      edgeList(`${businessId}/client_pixels`, token, appSecret, "id,name"),
      edgeList(`${businessId}/owned_ad_accounts`, token, appSecret, "id,name,account_id"),
      edgeList(`${businessId}/client_ad_accounts`, token, appSecret, "id,name,account_id"),
      edgeList(`${businessId}/owned_pages`, token, appSecret, "id,name"),
      edgeList(`${businessId}/client_pages`, token, appSecret, "id,name"),
    ]);
    return {
      ok: true, kind: "bisu", metaUserId, businessId,
      assets: { pixels: dedupe([...op, ...cp]), ad_accounts: dedupe([...oa, ...ca]), pages: dedupe([...opg, ...cpg]) },
    };
  }

  const [adAccounts, pages] = await Promise.all([
    edgeList("me/adaccounts", token, appSecret, "id,name,account_id"),
    edgeList("me/accounts", token, appSecret, "id,name"),
  ]);
  const pixelLists = await Promise.all(adAccounts.slice(0, 10).map((a) => edgeList(`${a.id}/adspixels`, token, appSecret, "id,name")));
  return {
    ok: true, kind: "user", metaUserId, businessId: null,
    assets: { pixels: dedupe(pixelLists.flat()), ad_accounts: adAccounts, pages },
  };
}

/** `debug_token` avec le jeton d'app (app_id|app_secret). */
export async function debugToken(cfg: MetaAppConfig, token: string) {
  return graphGet<{ data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; type?: string; error?: { message?: string } } }>(
    "debug_token",
    { input_token: token, access_token: `${cfg.appId}|${cfg.appSecret}` },
  );
}

/** Qualité du dataset (EMQ, couverture) — exige ads_read ; best-effort. */
export async function datasetQuality(pixelId: string, token: string, appSecret: string) {
  return graphGet<Record<string, unknown>>(`${pixelId}/dataset_quality`, {}, { token, appSecret });
}

// ── signed_request (suppression de données / désautorisation) ────────────────

export async function parseSignedRequest(appSecret: string, raw: string | null): Promise<{ user_id?: string; issued_at?: number } | null> {
  if (!raw || !raw.includes(".")) return null;
  const [sig, payload] = raw.split(".", 2);
  const expected = b64url(await hmacRaw(appSecret, payload));
  if (!timingSafeEqual(sig.replace(/=+$/, ""), expected)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { user_id?: string; issued_at?: number; algorithm?: string };
    if ((data.algorithm ?? "HMAC-SHA256").toUpperCase() !== "HMAC-SHA256") return null;
    return data;
  } catch {
    return null;
  }
}
