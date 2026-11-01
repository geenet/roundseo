const ITERATIONS = 100_000;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array): string => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${hex(salt)}$${hex(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof hash !== 'string') return false;
  const match = hash.match(/^pbkdf2\$(\d+)\$([a-f0-9]{32})\$([a-f0-9]{64})$/);
  if (match) {
    const iterations = Number(match[1]);
    if (iterations !== ITERATIONS) return false;
    const salt = Uint8Array.from(match[2].match(/.{2}/g)!, value => parseInt(value, 16));
    return equal(hex(await derive(password, salt, iterations)), match[3]);
  }
  // Existing SHA-256 records are upgraded after a successful login.
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  return equal(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(password)))), hash);
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain an uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain a number' };
  }
  return { valid: true };
}
