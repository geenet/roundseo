/**
 * AES-GCM encryption for Google refresh tokens at rest (spec: "encrypt
 * refresh tokens"). The key is derived from GOOGLE_TOKEN_ENCRYPTION_KEY (or
 * JWT_SECRET as a fallback, so local dev needs no extra secret) via
 * SHA-256, the same WebCrypto surface used elsewhere (src/worker/services/signed-assets.ts).
 */

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function tokenEncryptionSecret(env: { GOOGLE_TOKEN_ENCRYPTION_KEY?: string; JWT_SECRET?: string }): string | null {
  const value = env.GOOGLE_TOKEN_ENCRYPTION_KEY || env.JWT_SECRET;
  return value && value.trim() ? value.trim() : null;
}

export async function encryptToken(secret: string, plaintext: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext));
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(secret: string, stored: string): Promise<string> {
  const [ivHex, cipherHex] = stored.split(':');
  if (!ivHex || !cipherHex) throw new Error('Stored token is not in the expected encrypted format.');
  const key = await deriveKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(ivHex) as BufferSource }, key, hexToBytes(cipherHex) as BufferSource);
  return new TextDecoder().decode(plaintext);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
