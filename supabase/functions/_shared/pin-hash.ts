import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

/**
 * Hash a PIN using SHA-256 with a random salt
 * Format: salt:hash
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${salt}:${hashHex}`;
}

/**
 * Verify a PIN against a stored hash.
 * Only the SHA-256 salt:hash format is accepted.
 * Legacy bcrypt ($2...) and any other format are rejected — user must reset their PIN.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  // SHA-256 format: "uuid-salt:hex-hash"
  if (storedHash.includes(':')) {
    const [salt, hash] = storedHash.split(':');
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return computedHash === hash;
  }

  // Bcrypt or unknown format — cannot verify, require PIN reset.
  console.warn('PIN hash format not supported (bcrypt or legacy). User must reset their PIN.');
  return false;
}
