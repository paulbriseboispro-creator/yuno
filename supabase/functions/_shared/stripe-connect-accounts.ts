// Comptes connectés Stripe — création, lien d'onboarding, lecture d'état.
//
// Porte UNIQUE : `stripe-connect` (club, organisateur, DJ) crée et lit les
// comptes ici, et les checkouts s'en servent pour réparer un drapeau
// « paiements prêts » resté en retard (healChargesEnabled).
//
// POURQUOI (2026-09-29) : le premier organisateur réel n'a pas pu relier son
// Stripe. Stripe refuse désormais, sur la plateforme Yuno, tout compte créé avec
// le champ hérité `type: "express"` — la plateforme y porterait les pertes :
//   « You tried to create an Accounts v1 connected account using the legacy
//     `type` field with your platform as the losses collector. Use Accounts v2,
//     remove `type`, and set `losses_collector` to `stripe` ».
// D'où Accounts v2 (POST /v2/core/accounts) avec :
//   • losses_collector = stripe — ce que Stripe exige ;
//   • fees_collector   = stripe — le VENDEUR paie ses frais Stripe. C'est le
//     modèle de Yuno en vente directe (payment-split.ts : « Stripe debits its fee
//     straight from the connected account » ; fees.ts : frais Stripe déduits du
//     net du pro). Avec `application`, Yuno les paierait sur sa commission ;
//   • dashboard = full — le tableau de bord qui va avec ces deux
//     responsabilités : le pro a SON compte Stripe (dashboard.stripe.com), il n'y
//     a plus de lien de connexion Express pour ces comptes.
// Le reste de Yuno parle v1 (Checkout, transferts, remboursements, webhook) : un
// compte v2 garde un id `acct_…`, accepté partout où v1 attend un compte connecté.
//
// FILETS : Stripe n'était pas joignable depuis le poste qui a écrit ce module ;
// les formes ci-dessous suivent le SDK officiel (stripe-node 22.6, API
// 2026-08-26.dahlia) mais n'ont pas pu être rejouées contre le compte live.
// Chaque forme REFUSÉE (400/403/404 : Stripe n'a rien créé) passe donc à la
// suivante — v2 sans pré-remplissage, v2 vendeur seul, puis v1 par `controller`
// (le remplaçant documenté de `type`, mêmes responsabilités). Une panne réseau,
// un 429 ou un 5xx n'enchaîne JAMAIS : le compte a pu naître, en créer un second
// laisserait un doublon.
//
// Aucun import du SDK ni d'URL : le module est testé tel quel par vitest
// (src/lib/__tests__/stripeConnectAccounts.test.ts).

export const STRIPE_V1_API_VERSION = "2025-08-27.basil";
export const STRIPE_V2_API_VERSION = "2026-08-26.dahlia";
/** Comptes « tableau de bord complet » : le pro se connecte chez Stripe, pas par un lien Yuno. */
export const STRIPE_FULL_DASHBOARD_URL = "https://dashboard.stripe.com/";

const API_BASE = "https://api.stripe.com";

export type ConnectPurpose = "seller" | "payee";
export type ConnectApi = "v1" | "v2";
export type DashboardType = "express" | "full" | "none";

export interface ConnectContext {
  secretKey: string;
  fetchImpl?: typeof fetch;
  log?: (step: string, details?: Record<string, unknown>) => void;
}

export interface NewConnectedAccount {
  /** seller = club / organisateur (vend en direct, reçoit les jambes d'une co-soirée) ; payee = DJ (reçoit un cachet). */
  purpose: ConnectPurpose;
  email?: string | null;
  displayName?: string | null;
  /** Pré-remplissage du formulaire Stripe. Jamais bloquant : retiré si Stripe le refuse. */
  entityType?: "company" | "individual" | "non_profit" | null;
  registeredName?: string | null;
  productDescription: string;
  mcc?: string;
  metadata: Record<string, string>;
}

export interface CreatedConnectedAccount {
  id: string;
  api: ConnectApi;
  /** Forme retenue (journal) : v2, v2-no-prefill, v2-merchant-only, v1-controller, v1-controller-bare. */
  shape: string;
}

export interface ConnectAccountState {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Le pro a fini ce que Stripe lui demande MAINTENANT (v1 : details_submitted). */
  detailsSubmitted: boolean;
  hasRequirements: boolean;
  requirements: { currently_due: string[]; past_due: string[] };
  dashboard: DashboardType | null;
  source: ConnectApi;
}

export type ConnectStatus = "pending" | "active" | "restricted";

export class StripeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly api: ConnectApi,
    readonly type?: string,
    readonly code?: string,
    readonly param?: string,
  ) {
    super(message);
    this.name = "StripeHttpError";
  }
}

export class ConnectAccountCreateError extends Error {
  constructor(message: string, readonly attempts: { shape: string; message: string }[]) {
    super(message);
    this.name = "ConnectAccountCreateError";
  }
}

/**
 * Refus DÉFINITIF de Stripe sur une requête : rien n'a été créé, on peut essayer
 * une autre forme. 400 (paramètre), 403 (fonction non ouverte à la plateforme),
 * 404 (ressource ou endpoint inconnu). Tout le reste — réseau, 401, 429, 5xx —
 * s'arrête là.
 */
export function isDefinitiveRejection(err: unknown): boolean {
  return err instanceof StripeHttpError && [400, 403, 404].includes(err.status);
}

// ─── Transport ──────────────────────────────────────────────────────────────

/** Encodage `application/x-www-form-urlencoded` de l'API v1 (miroir du SDK : a[b][0]=c). */
export function formEncode(data: Record<string, unknown>): string {
  const pairs: string[] = [];
  const enc = (v: string) => encodeURIComponent(v).replace(/%5B/g, "[").replace(/%5D/g, "]");
  const walk = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${key}[${k}]`, v);
      return;
    }
    pairs.push(`${enc(key)}=${enc(String(value))}`);
  };
  for (const [k, v] of Object.entries(data)) walk(k, v);
  return pairs.join("&");
}

/** Supprime récursivement les clés `undefined` / `null` et les objets vidés (corps JSON v2). */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(compact) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      const c = compact(v);
      if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out as T;
  }
  return value;
}

function idempotencyKey(): string {
  return `yuno-connect-${crypto.randomUUID()}`;
}

async function stripeRequest<T>(
  ctx: ConnectContext,
  api: ConnectApi,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.secretKey}`,
    "Stripe-Version": api === "v2" ? STRIPE_V2_API_VERSION : STRIPE_V1_API_VERSION,
    Accept: "application/json",
  };
  let payload: string | undefined;
  let url = `${API_BASE}${path}`;
  if (method === "POST") {
    headers["Idempotency-Key"] = idempotencyKey();
    if (api === "v2") {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(compact(body ?? {}));
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      payload = formEncode(body ?? {});
    }
  } else if (body && Object.keys(body).length > 0) {
    url += `?${formEncode(body)}`;
  }

  const res = await doFetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const e = (json.error ?? {}) as { message?: string; type?: string; code?: string; param?: string };
    throw new StripeHttpError(
      e.message || `Stripe ${api} ${method} ${path} → HTTP ${res.status}`,
      res.status,
      api,
      e.type,
      e.code,
      e.param,
    );
  }
  return json as T;
}

// ─── Création ───────────────────────────────────────────────────────────────

type V2Configuration = "merchant" | "recipient";

/** Corps POST /v2/core/accounts. Exporté pour les tests. */
export function v2AccountBody(
  spec: NewConnectedAccount,
  configurations: V2Configuration[],
  prefill: boolean,
): Record<string, unknown> {
  const mcc = spec.mcc ?? "7929";
  return compact({
    contact_email: spec.email ?? undefined,
    display_name: spec.displayName ?? undefined,
    dashboard: "full",
    identity: {
      country: "fr",
      entity_type: prefill ? spec.entityType ?? undefined : undefined,
      business_details: prefill && spec.registeredName && spec.entityType !== "individual"
        ? { registered_name: spec.registeredName }
        : undefined,
    },
    configuration: {
      merchant: configurations.includes("merchant")
        ? { capabilities: { card_payments: { requested: true } }, mcc }
        : undefined,
      recipient: configurations.includes("recipient")
        ? { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } }
        : undefined,
    },
    defaults: {
      currency: "eur",
      locales: ["fr-FR"],
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      profile: {
        product_description: spec.productDescription,
        doing_business_as: spec.displayName ?? undefined,
      },
    },
    metadata: spec.metadata,
  });
}

/** Corps POST /v1/accounts par `controller` (sans le champ `type` déprécié). Exporté pour les tests. */
export function v1ControllerAccountBody(
  spec: NewConnectedAccount,
  opts: { capabilities: boolean; prefill: boolean },
): Record<string, unknown> {
  const prefill = opts.prefill && !!spec.entityType;
  return {
    country: "FR",
    email: spec.email ?? undefined,
    controller: {
      fees: { payer: "account" },
      losses: { payments: "stripe" },
      requirement_collection: "stripe",
      stripe_dashboard: { type: "full" },
    },
    capabilities: opts.capabilities
      ? { card_payments: { requested: true }, transfers: { requested: true } }
      : undefined,
    business_type: prefill ? spec.entityType : undefined,
    company: prefill && spec.registeredName && spec.entityType !== "individual"
      ? { name: spec.registeredName }
      : undefined,
    business_profile: {
      name: spec.displayName ?? undefined,
      product_description: spec.productDescription,
      mcc: spec.mcc ?? "7929",
    },
    metadata: spec.metadata,
  };
}

/**
 * Crée le compte connecté. Essaie les formes dans l'ordre et ne passe à la
 * suivante que sur un refus définitif (rien créé chez Stripe).
 */
export async function createConnectedAccount(
  ctx: ConnectContext,
  spec: NewConnectedAccount,
): Promise<CreatedConnectedAccount> {
  const configs: V2Configuration[] = spec.purpose === "seller" ? ["merchant", "recipient"] : ["recipient"];
  const hasPrefill = !!spec.entityType || !!spec.registeredName;

  const attempts: { shape: string; api: ConnectApi; run: () => Promise<{ id?: string }> }[] = [
    { shape: "v2", api: "v2", run: () => stripeRequest(ctx, "v2", "POST", "/v2/core/accounts", v2AccountBody(spec, configs, true)) },
  ];
  if (hasPrefill) {
    attempts.push({ shape: "v2-no-prefill", api: "v2", run: () => stripeRequest(ctx, "v2", "POST", "/v2/core/accounts", v2AccountBody(spec, configs, false)) });
  }
  if (spec.purpose === "seller") {
    attempts.push({ shape: "v2-merchant-only", api: "v2", run: () => stripeRequest(ctx, "v2", "POST", "/v2/core/accounts", v2AccountBody(spec, ["merchant"], false)) });
  }
  attempts.push(
    { shape: "v1-controller", api: "v1", run: () => stripeRequest(ctx, "v1", "POST", "/v1/accounts", v1ControllerAccountBody(spec, { capabilities: true, prefill: true })) },
    { shape: "v1-controller-bare", api: "v1", run: () => stripeRequest(ctx, "v1", "POST", "/v1/accounts", v1ControllerAccountBody(spec, { capabilities: false, prefill: false })) },
  );

  const failures: { shape: string; message: string }[] = [];
  for (const attempt of attempts) {
    try {
      const account = await attempt.run();
      if (!account?.id) throw new Error(`Stripe ${attempt.shape}: réponse sans id de compte`);
      ctx.log?.("Connected account created", { shape: attempt.shape, accountId: account.id, previousFailures: failures });
      return { id: account.id, api: attempt.api, shape: attempt.shape };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ shape: attempt.shape, message });
      ctx.log?.("Connected account shape refused", { shape: attempt.shape, message });
      if (!isDefinitiveRejection(err)) {
        throw new ConnectAccountCreateError(message, failures);
      }
    }
  }
  throw new ConnectAccountCreateError(failures[0]?.message ?? "Stripe account creation failed", failures);
}

// ─── Lien d'onboarding ──────────────────────────────────────────────────────

/**
 * Lien Stripe-hosted qui fait remplir (ou reprendre) le formulaire au pro.
 * v2 d'abord (les comptes naissent en v2), sur les configurations que le compte
 * porte réellement ; v1 si Stripe refuse (compte créé par le filet v1).
 */
export async function createOnboardingLink(
  ctx: ConnectContext,
  accountId: string,
  urls: { refreshUrl: string; returnUrl: string },
): Promise<string> {
  try {
    const account = await stripeRequest<{ applied_configurations?: string[] }>(
      ctx, "v2", "GET", `/v2/core/accounts/${encodeURIComponent(accountId)}`,
    );
    const configurations = (account.applied_configurations ?? [])
      .filter((c): c is V2Configuration => c === "merchant" || c === "recipient");
    if (configurations.length > 0) {
      const link = await stripeRequest<{ url?: string }>(ctx, "v2", "POST", "/v2/core/account_links", {
        account: accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: { configurations, refresh_url: urls.refreshUrl, return_url: urls.returnUrl },
        },
      });
      if (link.url) return link.url;
    }
  } catch (err) {
    if (!isDefinitiveRejection(err)) throw err;
    ctx.log?.("v2 account link refused, using v1", { accountId, message: (err as Error).message });
  }
  const link = await stripeRequest<{ url?: string }>(ctx, "v1", "POST", "/v1/account_links", {
    account: accountId,
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: "account_onboarding",
  });
  if (!link.url) throw new Error("Stripe account link without url");
  return link.url;
}

// ─── État ───────────────────────────────────────────────────────────────────

interface V1AccountLike {
  type?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  requirements?: { currently_due?: string[] | null; past_due?: string[] | null } | null;
  controller?: { stripe_dashboard?: { type?: string } | null } | null;
}

/** Projection d'un compte v1 (API ou webhook `account.updated`). */
export function stateFromV1Account(a: V1AccountLike): ConnectAccountState {
  const currently_due = a.requirements?.currently_due ?? [];
  const past_due = a.requirements?.past_due ?? [];
  const legacy: Record<string, DashboardType> = { standard: "full", express: "express", custom: "none" };
  const dash = a.controller?.stripe_dashboard?.type;
  return {
    chargesEnabled: !!a.charges_enabled,
    payoutsEnabled: !!a.payouts_enabled,
    detailsSubmitted: !!a.details_submitted,
    hasRequirements: currently_due.length > 0 || past_due.length > 0,
    requirements: { currently_due, past_due },
    dashboard: dash === "express" || dash === "full" || dash === "none" ? dash : legacy[a.type ?? ""] ?? null,
    source: "v1",
  };
}

type CapabilityLike = { status?: string } | undefined;
interface V2AccountLike {
  dashboard?: string;
  configuration?: {
    merchant?: { capabilities?: { card_payments?: CapabilityLike; stripe_balance?: { payouts?: CapabilityLike } } };
    recipient?: { capabilities?: { stripe_balance?: { payouts?: CapabilityLike; stripe_transfers?: CapabilityLike } } };
  };
  requirements?: {
    entries?: { awaiting_action_from?: string; description?: string; minimum_deadline?: { status?: string } }[];
  };
}

/** Projection d'un compte v2 sur les drapeaux que Yuno a toujours stockés. */
export function stateFromV2Account(a: V2AccountLike): ConnectAccountState {
  const merchant = a.configuration?.merchant;
  const recipient = a.configuration?.recipient;
  const active = (c: CapabilityLike) => c?.status === "active";
  const chargesEnabled = merchant
    ? active(merchant.capabilities?.card_payments)
    : active(recipient?.capabilities?.stripe_balance?.stripe_transfers);
  const payoutsEnabled = active(merchant?.capabilities?.stripe_balance?.payouts)
    || active(recipient?.capabilities?.stripe_balance?.payouts);
  const userEntries = (a.requirements?.entries ?? []).filter((e) => e.awaiting_action_from === "user");
  const due = (status: string) =>
    userEntries.filter((e) => e.minimum_deadline?.status === status).map((e) => e.description ?? "requirement");
  const currently_due = due("currently_due");
  const past_due = due("past_due");
  const dash = a.dashboard;
  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted: currently_due.length === 0 && past_due.length === 0,
    hasRequirements: currently_due.length > 0 || past_due.length > 0,
    requirements: { currently_due, past_due },
    dashboard: dash === "express" || dash === "full" || dash === "none" ? dash : null,
    source: "v2",
  };
}

/** Même règle que le webhook et l'ancien `status` : active = encaissement ET virements. */
export function connectStatusOf(s: Pick<ConnectAccountState, "chargesEnabled" | "payoutsEnabled" | "detailsSubmitted" | "hasRequirements">): ConnectStatus {
  if (s.chargesEnabled && s.payoutsEnabled) return "active";
  if (s.detailsSubmitted && s.hasRequirements) return "restricted";
  return "pending";
}

/**
 * Lit l'état du compte. v1 d'abord : ce sont exactement les drapeaux que la base
 * miroite et que le webhook `account.updated` écrit — une seule sémantique. v2
 * si Stripe refuse la lecture v1 de ce compte.
 */
export async function readConnectAccountState(ctx: ConnectContext, accountId: string): Promise<ConnectAccountState> {
  try {
    const a = await stripeRequest<V1AccountLike>(ctx, "v1", "GET", `/v1/accounts/${encodeURIComponent(accountId)}`);
    return stateFromV1Account(a);
  } catch (err) {
    if (!isDefinitiveRejection(err)) throw err;
    ctx.log?.("v1 account read refused, using v2", { accountId, message: (err as Error).message });
  }
  const a = await stripeRequest<V2AccountLike>(ctx, "v2", "GET", `/v2/core/accounts/${encodeURIComponent(accountId)}`, {
    include: ["configuration.merchant", "configuration.recipient", "requirements"],
  });
  return stateFromV2Account(a);
}

/**
 * Où envoyer le pro qui clique « Tableau de bord Stripe ». Un compte Express a
 * un lien de connexion à usage unique ; un compte au tableau de bord complet se
 * connecte lui-même sur dashboard.stripe.com (Stripe n'émet pas de lien pour lui).
 */
export async function dashboardUrlFor(ctx: ConnectContext, accountId: string, state: ConnectAccountState): Promise<string> {
  if (state.dashboard === "express") {
    const link = await stripeRequest<{ url?: string }>(
      ctx, "v1", "POST", `/v1/accounts/${encodeURIComponent(accountId)}/login_links`,
    );
    if (link.url) return link.url;
  }
  return STRIPE_FULL_DASHBOARD_URL;
}

// ─── Miroirs en base ────────────────────────────────────────────────────────
// Mêmes colonnes et même règle que le webhook `account.updated` : un seul
// endroit décide de ce qui est écrit, quel que soit le chemin qui a lu Stripe.

/** Colonnes `venues` d'un compte de club. */
export function venueConnectColumns(state: ConnectAccountState): Record<string, unknown> {
  return {
    stripe_charges_enabled: state.chargesEnabled,
    stripe_payouts_enabled: state.payoutsEnabled,
    stripe_onboarding_complete: state.detailsSubmitted,
  };
}

/**
 * Colonnes `profiles` d'un compte d'organisateur. `onboardedAt` = la date déjà
 * connue : elle est gardée tant que le compte reste actif (sinon chaque
 * synchronisation la déplaçait à « maintenant »).
 */
export function organizerConnectColumns(
  state: ConnectAccountState,
  opts: { onboardedAt?: string | null; now?: Date } = {},
): Record<string, unknown> {
  const status = connectStatusOf(state);
  return {
    stripe_connect_status: status,
    stripe_connect_charges_enabled: state.chargesEnabled,
    stripe_connect_payouts_enabled: state.payoutsEnabled,
    stripe_connect_onboarded_at: status === "active"
      ? (opts.onboardedAt ?? (opts.now ?? new Date()).toISOString())
      : null,
  };
}

// ─── Auto-réparation au checkout ────────────────────────────────────────────

/**
 * Le drapeau `charges_enabled` en base n'est qu'un MIROIR : il est posé quand le
 * pro rouvre sa Console ou quand Stripe envoie `account.updated` (endpoint
 * Connect). Stripe active souvent l'encaissement quelques minutes APRÈS la fin
 * du formulaire, pendant que personne n'a la Console ouverte : le premier
 * acheteur se faisait refuser « paiements pas encore activés » alors que le
 * compte encaissait déjà. Quand un compte existe mais que la base dit « pas
 * prêt », le checkout redemande donc à Stripe et répare la base.
 *
 * Ne lève jamais : toute panne rend la valeur d'origine (la porte reste fermée).
 */
export async function healChargesEnabled(
  ctx: ConnectContext,
  accountId: string | null | undefined,
  chargesEnabled: boolean,
  persist: (state: ConnectAccountState) => Promise<void>,
): Promise<boolean> {
  if (chargesEnabled || !accountId || accountId.startsWith("acct_demo") || !ctx.secretKey) return chargesEnabled;
  try {
    const state = await readConnectAccountState(ctx, accountId);
    if (!state.chargesEnabled) return false;
    try {
      await persist(state);
    } catch (err) {
      ctx.log?.("Stripe state heal: persist failed", { accountId, message: (err as Error).message });
    }
    ctx.log?.("Stripe state healed at checkout", { accountId, payoutsEnabled: state.payoutsEnabled });
    return true;
  } catch (err) {
    ctx.log?.("Stripe state heal failed", { accountId, message: (err as Error).message });
    return chargesEnabled;
  }
}

// ─── Moyens de paiement du checkout ─────────────────────────────────────────

/**
 * Stripe refuse-t-il la session parce qu'un moyen de paiement listé n'est pas
 * activé sur le compte ? En vente directe la session naît sur le compte du pro :
 * si Link n'y est pas ouvert, `payment_method_types: ['card', 'link']` faisait
 * échouer la toute première vente.
 */
export function isPaymentMethodTypeRejection(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { type?: string; param?: string; message?: string; raw?: { param?: string } };
  const param = e.param ?? e.raw?.param ?? "";
  const message = e.message ?? "";
  const invalid = e.type === "StripeInvalidRequestError" || e.type === "invalid_request_error";
  return invalid && (/payment_method_types/.test(param) || /payment method type/i.test(message));
}

/**
 * Crée la session Checkout ; si Stripe refuse un moyen de paiement listé, la
 * recrée avec la carte seule (Apple Pay et Google Pay passent par `card`).
 */
export async function createSessionWithPaymentMethodFallback<P extends { payment_method_types?: string[] }, R>(
  create: (params: P) => Promise<R>,
  params: P,
  log?: (step: string, details?: Record<string, unknown>) => void,
): Promise<R> {
  try {
    return await create(params);
  } catch (err) {
    const types = params.payment_method_types ?? [];
    if (!isPaymentMethodTypeRejection(err) || types.length <= 1 || !types.includes("card")) throw err;
    log?.("Payment method refused on this account — retrying with card only", {
      refused: types,
      message: (err as Error).message,
    });
    return await create({ ...params, payment_method_types: ["card"] });
  }
}
