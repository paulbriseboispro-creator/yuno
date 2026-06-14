// TOTP implementation for Deno
// Based on RFC 6238: https://tools.ietf.org/html/rfc6238

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(length: number = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

export function base32Encode(data: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
    bits += 8;

    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return result;
}

export function base32Decode(encoded: string): Uint8Array {
  encoded = encoded.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < encoded.length; i++) {
    const index = BASE32_CHARS.indexOf(encoded[i]);
    if (index === -1) throw new Error('Invalid base32 character');

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  // Create new ArrayBuffers to avoid SharedArrayBuffer issues
  const keyBuffer = new ArrayBuffer(key.length);
  const keyView = new Uint8Array(keyBuffer);
  keyView.set(key);
  
  const messageBuffer = new ArrayBuffer(message.length);
  const messageView = new Uint8Array(messageBuffer);
  messageView.set(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageBuffer);
  return new Uint8Array(signature);
}

function dynamicTruncation(hmac: Uint8Array): number {
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return code % 1000000;
}

export async function generateTOTP(secret: string, window: number = 0): Promise<string> {
  const time = Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / 30) + window;

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter), false);

  const key = base32Decode(secret);
  const hmac = await hmacSha1(key, new Uint8Array(buffer));
  const code = dynamicTruncation(hmac);

  return code.toString().padStart(6, '0');
}

export async function verifyTOTP(
  token: string,
  secret: string,
  window: number = 1
): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) {
    return false;
  }

  for (let w = -window; w <= window; w++) {
    const expectedToken = await generateTOTP(secret, w);
    if (token === expectedToken) {
      return true;
    }
  }

  return false;
}

export function generateOTPAuthURL(
  issuer: string,
  accountName: string,
  secret: string
): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?${params}`;
}
