// Jetons et empreintes du serveur MCP. Les jetons ne quittent le Worker que
// vers l'IA ; la base ne reçoit que leur empreinte sha256 (hex), calculée ici
// comme `_mcp_sha256()` la calcule en SQL (UTF-8 → sha256 → hex).

const enc = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(prefix: string, bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return prefix + base64url(b);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// PKCE S256 (RFC 7636) : BASE64URL(SHA256(ASCII(code_verifier))).
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return base64url(new Uint8Array(digest));
}

export const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
