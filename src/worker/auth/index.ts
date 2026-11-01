// Main auth handler for RoundSEO
import { createToken, type AuthEnvironment } from './jwt';
import { hashPassword, verifyPassword, validatePassword } from './password';
import { requireAuth, validateEmail } from './middleware';
import { getGoogleOAuthConfig, getGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo } from './google';

export { requireAuth, validateEmail } from './middleware';
export type { AuthContext } from './middleware';

interface SignupRequest {
  email: string;
  name: string;
  password: string;
}

interface LoginRequest {
  email: string;
  password: string;
}

interface GoogleCallbackRequest {
  code: string;
  state: string;
}

export async function handleSignup(request: Request, db: any, env: AuthEnvironment): Promise<Response> {
  try {
    const input = (await request.json()) as SignupRequest;
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const password = input.password;
    if (!env.JWT_SECRET) return new Response(JSON.stringify({ error: 'Authentication is not configured' }), { status: 503 });

    // Validate inputs
    if (!validateEmail(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400 });
    }

    if (!name || name.length < 2) {
      return new Response(JSON.stringify({ error: 'Name must be at least 2 characters' }), { status: 400 });
    }

    const passValidation = validatePassword(password);
    if (!passValidation.valid) {
      return new Response(JSON.stringify({ error: passValidation.error }), { status: 400 });
    }

    // Check if user already exists
    const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'User already exists' }), { status: 409 });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const userId = `user_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO users (id, email, name, auth_method, password_hash, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(userId, email, name, 'email_password', passwordHash, false, now, now).run();

    // Create auth token
    const token = await createToken({ userId, email }, env.JWT_SECRET);

    return new Response(JSON.stringify({ user: { id: userId, email, name }, token }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function handleLogin(request: Request, db: any, env: AuthEnvironment): Promise<Response> {
  try {
    const input = (await request.json()) as LoginRequest;
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = input.password;
    if (!env.JWT_SECRET) return new Response(JSON.stringify({ error: 'Authentication is not configured' }), { status: 503 });
    if (!validateEmail(email) || typeof password !== 'string') return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });

    // Find user
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
    }

    if (!user.password_hash.startsWith('pbkdf2$')) {
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id).run();
    }

    // Create auth token
    const token = await createToken({ userId: user.id, email: user.email }, env.JWT_SECRET);

    // Update last login
    await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), user.id)
      .run();

    return new Response(JSON.stringify({ user: { id: user.id, email: user.email, name: user.name }, token }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Login error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export function handleGoogleStart(request: Request, env: any): Response {
  const config = getGoogleOAuthConfig(env);
  if (!env.JWT_SECRET || !config.clientId || !config.clientSecret || !config.redirectUri) return new Response(JSON.stringify({ error: 'Google sign-in is not configured' }), { status: 503 });
  const state = crypto.randomUUID();
  return new Response(null, {
    status: 302,
    headers: {
      Location: getGoogleAuthUrl(config.clientId, config.redirectUri, state),
      'Set-Cookie': `roundseo_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/v2/auth/google; Max-Age=600${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleGoogleCallback(request: Request, env: any, db: any): Promise<Response> {
  try {
    const { code, state } = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : (await request.json()) as GoogleCallbackRequest;

    if (typeof code !== 'string' || typeof state !== 'string' || !code || !state) {
      return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 });
    }

    const stateCookie = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('roundseo_oauth_state='))?.slice('roundseo_oauth_state='.length);
    if (!stateCookie || stateCookie !== state) {
      return new Response(JSON.stringify({ error: 'OAuth session expired. Start Google sign-in again.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const config = getGoogleOAuthConfig(env);
    const tokenResponse = await exchangeGoogleCode(code, config);
    if (!tokenResponse) {
      return new Response(JSON.stringify({ error: 'Failed to exchange code' }), { status: 400 });
    }

    const googleUser = await getGoogleUserInfo(tokenResponse.access_token);
    if (!googleUser || !googleUser.email_verified) {
      return new Response(JSON.stringify({ error: 'Failed to get user info' }), { status: 400 });
    }

    // Check if user exists
    let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleUser.sub).first();

    if (!user) {
      const existing = await db.prepare('SELECT * FROM users WHERE email = ?').bind(googleUser.email.toLowerCase()).first();
      if (existing) {
        return new Response(JSON.stringify({ error: 'This email already has an account. Use its existing sign-in method.' }), { status: 409 });
      }
    }

    if (!user) {
      // Create new user
      const userId = `google_${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await db.prepare(`
        INSERT INTO users (id, email, name, auth_method, google_id, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(userId, googleUser.email, googleUser.name, 'google_oauth', googleUser.sub, true, now, now).run();

      user = { id: userId, email: googleUser.email, name: googleUser.name };
    }

    // Create auth token
    const token = await createToken({ userId: user.id, email: user.email }, env.JWT_SECRET);

    return new Response(JSON.stringify({ user: { id: user.id, email: user.email, name: user.name }, token }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': 'roundseo_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/v2/auth/google; Max-Age=0' },
    });
  } catch (error) {
    console.error('Google callback error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function handleGetMe(request: Request, env: AuthEnvironment): Promise<Response> {
  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  return new Response(JSON.stringify({ user: { userId: auth.userId, email: auth.email } }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleRefresh(request: Request, env: AuthEnvironment): Promise<Response> {
  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  const newToken = await createToken(
    { userId: auth.userId, email: auth.email, organizationId: auth.organizationId },
    env.JWT_SECRET
  );

  return new Response(JSON.stringify({ token: newToken }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
