// Secret de reçu d'une table payée (I4 de la relecture) : un jeton aléatoire que create-table-checkout renvoie au
// NAVIGATEUR de l'acheteur (jamais dans une URL : l'adresse de retour Stripe part aux outils de mesure) et dont seul le
// hachage SHA-256 est gardé sur la réservation (`receipt_token_hash`). verify-table-payment ne rend le QR de la table
// qu'avec ce jeton, ou à son titulaire connecté. PUR (Web Crypto) : testé par src/lib/__tests__/receiptToken.test.ts.

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

/** 32 octets aléatoires, en hexadécimal (64 caractères). */
export function newReceiptToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Un jeton plausible : 64 caractères hexadécimaux (le reste n'a jamais été émis). */
export function isReceiptTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

export async function hashReceiptToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/** Le jeton fourni correspond-il au hachage stocké ? Comparaison en temps constant. */
export async function receiptTokenMatches(token: unknown, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash || !isReceiptTokenShape(token)) return false;
  const given = await hashReceiptToken(token);
  if (given.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
