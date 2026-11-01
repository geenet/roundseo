// JWT token management for RoundSEO
import { SignJWT, jwtVerify } from 'jose';

export type AuthEnvironment = { JWT_SECRET?: string };

function signingKey(secret: string | undefined): Uint8Array {
  if (!secret?.trim()) throw new Error('JWT_SECRET must be configured');
  return new TextEncoder().encode(secret);
}

export interface JWTPayload {
  userId: string;
  email: string;
  organizationId?: string;
  iat: number;
  exp: number;
}

export async function createToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string | undefined, expiresIn = '7d'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expireSeconds = parseExpiration(expiresIn);

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + expireSeconds)
    .sign(signingKey(secret));
}

export async function verifyToken(token: string, secret: string | undefined): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: ['HS256'] });
    if (typeof payload.userId !== 'string' || !payload.userId || typeof payload.email !== 'string' || !payload.email || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.organizationId !== undefined && typeof payload.organizationId !== 'string') return null;
    return { userId: payload.userId, email: payload.email, iat: payload.iat, exp: payload.exp, ...(typeof payload.organizationId === 'string' ? { organizationId: payload.organizationId } : {}) };
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

export function extractTokenFromHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
