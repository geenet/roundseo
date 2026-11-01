// Auth middleware for verifying JWT tokens
import { verifyToken, extractTokenFromHeader, type AuthEnvironment } from './jwt';

export interface AuthContext {
  userId: string;
  email: string;
  organizationId?: string;
  token: string;
}

export async function requireAuth(request: Request, env: AuthEnvironment = {}): Promise<{ auth: AuthContext | null; error: string | null }> {
  const authHeader = request.headers.get('Authorization');
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    return { auth: null, error: 'No authorization token provided' };
  }

  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) {
    return { auth: null, error: 'Invalid or expired token' };
  }

  return {
    auth: {
      userId: payload.userId,
      email: payload.email,
      organizationId: payload.organizationId,
      token,
    },
    error: null,
  };
}

export function createAuthResponse(message: string, status = 401) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}
