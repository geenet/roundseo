import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeRequest } from '../../src/worker/api/router';
import { createToken } from '../../src/worker/auth/jwt';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

const SECRET = 'test-only-signing-secret-with-at-least-32-bytes';
const ORIGIN = 'https://api.example.test';
const env = {
  JWT_SECRET: SECRET, GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_INDEXING_REDIRECT_URI: 'https://api.example.test/api/v2/websites/site-1/google-connection/callback',
};

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => { database = migratedDatabase(); seedWorkspace(database); db = d1(database); });
afterEach(() => { vi.unstubAllGlobals(); database.close(); });

async function authorization(userId: string, email: string): Promise<string> {
  return `Bearer ${await createToken({ userId, email }, SECRET)}`;
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

function envFor(database: ReturnType<typeof d1>) { return { ...env, DB: database }; }

describe('Google indexing OAuth state (regression: no identity embedded in the client-roundtripped state)', () => {
  it('the consent URL\'s state is a bare nonce with a matching server-side pending row, and a forged state is refused even with a valid cookie', async () => {
    const owner = await authorization('user-owner', 'owner@example.test');
    const start = await routeRequest(request('/api/v2/websites/site-1/google-connection/start', { headers: { Authorization: owner } }), db, envFor(db));
    expect(start?.status).toBe(200);
    const { url: consentUrl } = await start!.json() as { url: string };
    const state = new URL(consentUrl).searchParams.get('state')!;
    expect(state).not.toContain('.'); // a plain UUID nonce, not websiteId.userId.scope.nonce
    const pending = database.prepare('SELECT website_id, user_id FROM google_oauth_states WHERE nonce = ?').get(state) as any;
    expect(pending.website_id).toBe('site-1');
    expect(pending.user_id).toBe('user-owner');

    const cookie = start!.headers.get('Set-Cookie')!.split(';')[0];

    // A forged state (right shape, but a nonce nobody ever issued) must be refused even with a
    // structurally-valid cookie pointed at it — there's no server-side pending row to resolve it.
    const forgedCookie = `roundseo_indexing_oauth_state=not-a-real-nonce`;
    const forged = await routeRequest(
      new Request(`${ORIGIN}/api/v2/websites/site-1/google-connection/callback?code=abc&state=not-a-real-nonce`, { headers: { Cookie: forgedCookie } }),
      db, envFor(db),
    );
    expect(forged?.status).toBe(400);
    void cookie;
  });

  it('the pending state is consumed (deleted) after one callback attempt, so a replayed callback cannot succeed twice', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/webmasters.readonly' });
      if (url.includes('openidconnect.googleapis.com')) return Response.json({ email: 'owner@gmail.example' });
      return new Response('not found', { status: 404 });
    }));
    const owner = await authorization('user-owner', 'owner@example.test');
    const start = await routeRequest(request('/api/v2/websites/site-1/google-connection/start', { headers: { Authorization: owner } }), db, envFor(db));
    const { url: consentUrl } = await start!.json() as { url: string };
    const state = new URL(consentUrl).searchParams.get('state')!;
    const cookie = start!.headers.get('Set-Cookie')!.split(';')[0];

    const first = await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-1/google-connection/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }), db, envFor(db));
    expect(first?.status).toBe(200);

    const replay = await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-1/google-connection/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }), db, envFor(db));
    expect(replay?.status).toBe(400);
  });

  it('a mismatched website in the callback URL is refused even with the right nonce and cookie', async () => {
    database.prepare(`INSERT INTO websites (id, organization_id, name, domain, url, created_at, updated_at) VALUES ('site-2b', 'org-1', 'Other', 'other2.test', 'https://other2.test/', ?, ?)`).run('2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
    const owner = await authorization('user-owner', 'owner@example.test');
    const start = await routeRequest(request('/api/v2/websites/site-1/google-connection/start', { headers: { Authorization: owner } }), db, envFor(db));
    const { url: consentUrl } = await start!.json() as { url: string };
    const state = new URL(consentUrl).searchParams.get('state')!;
    const cookie = start!.headers.get('Set-Cookie')!.split(';')[0];

    const mismatched = await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-2b/google-connection/callback?code=abc&state=${state}`, { headers: { Cookie: cookie } }), db, envFor(db));
    expect(mismatched?.status).toBe(400);
  });
});
