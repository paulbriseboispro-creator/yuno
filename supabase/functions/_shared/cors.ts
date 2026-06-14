const ALLOWED_ORIGINS = [
  "https://yunoapp.eu",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:8080",
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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}
