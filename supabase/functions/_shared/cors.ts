const ALLOWED_ORIGINS = [
  "https://yunoapp.eu",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:8080",
  // App native Capacitor : origine du WebView iOS (et Android en v2).
  "capacitor://localhost",
  "https://localhost",
];

// Cloudflare Workers preview deployments live under the account namespace
// `*.paul-brisebois-pro.workers.dev` (e.g. yuno.paul-brisebois-pro.workers.dev
// plus per-branch previews). Allow them so checkout works before the custom
// domain yunoapp.eu is wired. Scoped to this Cloudflare account only.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)?paul-brisebois-pro\.workers\.dev$/,
];

export const openCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function restrictedCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const isAllowed =
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  const allowed = isAllowed ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Vary": "Origin",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// URLs de retour Stripe (success_url / cancel_url / return_url / refresh_url).
//
// L'en-tête Origin est contrôlé par l'APPELANT. Sans liste blanche, un checkout
// invité forgé (Origin: https://evil.tld) produit une session Stripe LÉGITIME
// dont l'URL de retour — porteuse du session_id et de l'id du billet — pointe
// chez l'attaquant : il fait payer la victime puis encaisse le QR à sa place.
// Règle : on ne reflète JAMAIS une origine hors liste blanche CORS ci-dessus ;
// tout le reste retombe sur https://yunoapp.eu.
//
// App native (Capacitor) : son origine (`capacitor://localhost`, ou
// `https://localhost` sur iOS récent) est dans la liste CORS mais REFUSÉE par
// Stripe dans les URLs de retour (schéma/hôte non public) → rebasculée sur le
// domaine web ; l'appelant ajoute le flag `native=1` quand sa page verify le
// gère (deep-link yuno://). Même clamp que `safeEmailOrigin` de mfa/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_FALLBACK_ORIGIN = "https://yunoapp.eu";

export function isAllowedWebOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

export function resolveReturnOrigin(req: Request): { origin: string; isNativeApp: boolean } {
  const raw = req.headers.get("origin") ?? "";
  const isNativeApp = raw.startsWith("capacitor://") || raw === "https://localhost";
  if (isNativeApp || !isAllowedWebOrigin(raw)) {
    return { origin: PUBLIC_FALLBACK_ORIGIN, isNativeApp };
  }
  return { origin: raw, isNativeApp: false };
}

/**
 * Chemin de retour fourni par le client (cancelUrl…), concaténé à l'origine :
 * chemin même-site uniquement. `@evil.tld` déplacerait l'hôte (userinfo),
 * `//` et `\` sont ambigus pour les parseurs d'URL — tout ce qui n'est pas un
 * chemin absolu simple retombe sur le fallback.
 */
export function safeReturnPath(path: unknown, fallback: string): string {
  if (typeof path !== "string" || path.length === 0 || path.length > 2048) return fallback;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  return path;
}

/**
 * URL de retour ABSOLUE fournie par le client (returnUrl du onboarding owner…).
 * Acceptée seulement si son origine est dans la liste blanche ; une origine
 * native est rebasculée sur le domaine web (chemin + query conservés) ; un
 * chemin nu est résolu sur yunoapp.eu ; tout le reste retombe sur le fallback.
 */
export function safeReturnUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 || raw.includes("\\")) {
    return fallback;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw, PUBLIC_FALLBACK_ORIGIN);
  } catch {
    return fallback;
  }
  // NB : new URL("//evil.tld", base) résout l'hôte en evil.tld → rejeté plus bas.
  if (parsed.protocol === "capacitor:" || parsed.origin === "https://localhost") {
    return `${PUBLIC_FALLBACK_ORIGIN}${parsed.pathname}${parsed.search}`;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
  if (!isAllowedWebOrigin(parsed.origin)) return fallback;
  return parsed.toString();
}
