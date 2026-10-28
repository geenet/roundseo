// JWT token management for RoundSEO
import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  globalThis.env?.JWT_SECRET || 'dev-secret-key-change-in-production'
);

export interface JWTPayload {
  userId: string;
  email: string;
  organizationId?: string;
  iat: number;
  exp: number;
}

export async function createToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, expiresIn = '7d'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expireSeconds = parseExpiration(expiresIn);

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + expireSeconds)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const verified = await jwtVerify(token, JWT_SECRET);
    return verified.payload as JWTPayload;
  } catch {
    return null;
  }
}

function parseExpiration(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60; // default 7 days

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case 'd':
      return num * 24 * 60 * 60;
    case 'h':
      return num * 60 * 60;
    case 'm':
      return num * 60;
    case 's':
      return num;
    default:
      return 7 * 24 * 60 * 60;
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
