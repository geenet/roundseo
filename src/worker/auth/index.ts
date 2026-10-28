// Main auth handler for RoundSEO
import { createToken, verifyToken } from './jwt';
import { hashPassword, verifyPassword, validatePassword } from './password';
import { requireAuth, validateEmail } from './middleware';
import { getGoogleOAuthConfig, getGoogleAuthUrl, exchangeGoogleCode, getGoogleUserInfo, createGoogleAuthToken } from './google';

export { requireAuth, validateEmail } from './middleware';
export type { AuthContext } from './middleware';

interface User {
  id: string;
  email: string;
  name: string;
  authMethod: string;
  emailVerified: boolean;
  createdAt: string;
}

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

export async function handleSignup(request: Request, db: any): Promise<Response> {
  try {
    const { email, name, password } = (await request.json()) as SignupRequest;

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
    const token = await createToken({ userId, email }, '7d');

    return new Response(JSON.stringify({ user: { id: userId, email, name }, token }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function handleLogin(request: Request, db: any): Promise<Response> {
  try {
    const { email, password } = (await request.json()) as LoginRequest;

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

    // Create auth token
    const token = await createToken({ userId: user.id, email: user.email }, '7d');

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

export async function handleGoogleCallback(request: Request, env: any, db: any): Promise<Response> {
  try {
    const { code, state } = (await request.json()) as GoogleCallbackRequest;

    if (!code || !state) {
      return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 });
    }

    // Verify state from session (in production, check against stored state)
    // For now, we'll skip this

    const config = getGoogleOAuthConfig(env);
    const tokenResponse = await exchangeGoogleCode(code, config);
    if (!tokenResponse) {
      return new Response(JSON.stringify({ error: 'Failed to exchange code' }), { status: 400 });
    }

    const googleUser = await getGoogleUserInfo(tokenResponse.access_token);
    if (!googleUser) {
      return new Response(JSON.stringify({ error: 'Failed to get user info' }), { status: 400 });
    }

    // Check if user exists
    let user = await db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleUser.sub).first();

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
    const token = await createGoogleAuthToken(googleUser);

    return new Response(JSON.stringify({ user, token }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Google callback error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}

export async function handleGetMe(request: Request): Promise<Response> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  return new Response(JSON.stringify({ user: { userId: auth.userId, email: auth.email } }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleRefresh(request: Request): Promise<Response> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  const newToken = await createToken(
    { userId: auth.userId, email: auth.email, organizationId: auth.organizationId },
    '7d'
  );

  return new Response(JSON.stringify({ token: newToken }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
