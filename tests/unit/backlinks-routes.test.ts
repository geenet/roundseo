import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routeRequest } from '../../src/worker/api/router';
import { createToken } from '../../src/worker/auth/jwt';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

const SECRET = 'test-only-signing-secret-with-at-least-32-bytes';
const ORIGIN = 'https://api.example.test';

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
  // A second, unrelated organization and website — the tenant-isolation negative case.
  database.prepare(`INSERT INTO users (id, email, name, auth_method, created_at, updated_at) VALUES ('user-rival', 'rival@example.test', 'Rival', 'email_password', ?, ?)`).run('2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  database.prepare(`INSERT INTO organizations (id, name, slug, owner_id, billing_email, created_at, updated_at) VALUES ('org-2', 'Rival Co', 'rival-co', 'user-rival', 'billing@rival.test', ?, ?)`).run('2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  database.prepare(`INSERT INTO websites (id, organization_id, name, domain, url, created_at, updated_at) VALUES ('site-rival', 'org-2', 'Rival Site', 'rival.test', 'https://rival.test/', ?, ?)`).run('2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
});

afterEach(() => database.close());

async function authorization(userId: string, email: string): Promise<string> {
  return `Bearer ${await createToken({ userId, email }, SECRET)}`;
}

function request(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

// In production, `env.DB` and the `db` passed separately to routeRequest are the same
// object (worker/index.ts calls `routeRequest(request, env.DB, env, ctx)`); job dispatch
// code reads `env.DB`, so the test env must mirror that invariant.
function envFor(database: ReturnType<typeof d1>) { return { JWT_SECRET: SECRET, DB: database }; }

describe('backlink monitor routes', () => {
  it('creates a monitor for the owning organization and refuses an outsider on the same route', async () => {
    const owner = await authorization('user-owner', 'owner@example.test');
    const createResponse = await routeRequest(
      request('/api/v2/websites/site-1/backlinks', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ sourceUrl: 'https://news.example/a', expectedTargetUrl: 'https://example.com/pricing' }) }),
      db, envFor(db),
    );
    expect(createResponse?.status).toBe(201);
    const { monitor } = await createResponse!.json() as any;
    expect(monitor.sourceUrl).toBe('https://news.example/a');

    const rival = await authorization('user-rival', 'rival@example.test');
    const patchResponse = await routeRequest(
      request(`/api/v2/backlinks/${monitor.id}`, { method: 'PATCH', headers: { Authorization: rival }, body: JSON.stringify({ notes: 'hijack attempt' }) }),
      db, envFor(db),
    );
    expect(patchResponse?.status).toBe(404);

    const listResponse = await routeRequest(request('/api/v2/websites/site-1/backlinks', { headers: { Authorization: rival } }), db, envFor(db));
    expect(listResponse?.status).toBe(404);
  });

  it('queues a manual recheck and returns 202', async () => {
    const owner = await authorization('user-owner', 'owner@example.test');
    const create = await routeRequest(
      request('/api/v2/websites/site-1/backlinks', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ sourceUrl: 'https://news.example/b', expectedTargetUrl: 'https://example.com/pricing' }) }),
      db, envFor(db),
    );
    const { monitor } = await create!.json() as any;
    const check = await routeRequest(request(`/api/v2/backlinks/${monitor.id}/checks`, { method: 'POST', headers: { Authorization: owner } }), db, envFor(db));
    expect(check?.status).toBe(202);
  });

  it('reports workspace capacity usage', async () => {
    const owner = await authorization('user-owner', 'owner@example.test');
    await routeRequest(request('/api/v2/websites/site-1/backlinks', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ sourceUrl: 'https://news.example/c', expectedTargetUrl: 'https://example.com/pricing' }) }), db, envFor(db));
    const usage = await routeRequest(request('/api/v2/organizations/org-1/backlinks/usage', { headers: { Authorization: owner } }), db, envFor(db));
    const body = await usage!.json() as any;
    expect(body.capacity.used).toBe(1);
  });
});

describe('backlink list sharing (AC24)', () => {
  it('shares only the list it was created for, and stops resolving once revoked', async () => {
    const owner = await authorization('user-owner', 'owner@example.test');
    const create = await routeRequest(
      request('/api/v2/websites/site-1/backlinks', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ sourceUrl: 'https://news.example/d', expectedTargetUrl: 'https://example.com/pricing', notes: 'private note' }) }),
      db, envFor(db),
    );
    const { monitor } = await create!.json() as any;
    const listResponse = await routeRequest(request('/api/v2/websites/site-1/backlink-lists', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ name: 'Client report' }) }), db, envFor(db));
    const { list } = await listResponse!.json() as any;
    await routeRequest(request(`/api/v2/backlink-lists/${list.id}/members`, { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ monitorIds: [monitor.id] }) }), db, envFor(db));
    const shareResponse = await routeRequest(request(`/api/v2/backlink-lists/${list.id}/shares`, { method: 'POST', headers: { Authorization: owner } }), db, envFor(db));
    const { share } = await shareResponse!.json() as any;

    const publicView = await routeRequest(request(`/api/v2/backlink-shares/${share.sharedToken}`), db, envFor(db));
    expect(publicView?.status).toBe(200);
    const viewBody = await publicView!.json() as any;
    expect(viewBody.share.rows).toHaveLength(1);
    expect(JSON.stringify(viewBody.share)).not.toContain('private note'); // notes are never exposed

    await routeRequest(request(`/api/v2/backlink-shares/${share.id}/revoke`, { method: 'POST', headers: { Authorization: owner } }), db, envFor(db));
    const afterRevoke = await routeRequest(request(`/api/v2/backlink-shares/${share.sharedToken}`), db, envFor(db));
    expect(afterRevoke?.status).toBe(404);
  });

  it('cross-tenant: a monitorId from another organization cannot be enrolled into a list, even via a bulk request the caller otherwise owns (regression)', async () => {
    const owner = await authorization('user-owner', 'owner@example.test');
    const rival = await authorization('user-rival', 'rival@example.test');

    const rivalCreate = await routeRequest(
      request('/api/v2/websites/site-rival/backlinks', { method: 'POST', headers: { Authorization: rival }, body: JSON.stringify({ sourceUrl: 'https://news.example/rival', expectedTargetUrl: 'https://rival.test/private' }) }),
      db, envFor(db),
    );
    const { monitor: rivalMonitor } = await rivalCreate!.json() as any;

    const ownerCreate = await routeRequest(
      request('/api/v2/websites/site-1/backlinks', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ sourceUrl: 'https://news.example/mine', expectedTargetUrl: 'https://example.com/pricing' }) }),
      db, envFor(db),
    );
    const { monitor: ownMonitor } = await ownerCreate!.json() as any;
    const listResponse = await routeRequest(request('/api/v2/websites/site-1/backlink-lists', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ name: 'My list' }) }), db, envFor(db));
    const { list } = await listResponse!.json() as any;

    const enrollResponse = await routeRequest(
      request(`/api/v2/backlink-lists/${list.id}/members`, { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ monitorIds: [ownMonitor.id, rivalMonitor.id] }) }),
      db, envFor(db),
    );
    const { added } = await enrollResponse!.json() as any;
    expect(added).toBe(1); // only the owner's own monitor was added

    const members = database.prepare('SELECT monitor_id FROM backlink_list_members WHERE list_id = ?').all(list.id) as any[];
    expect(members.map(m => m.monitor_id)).toEqual([ownMonitor.id]);
    expect(members.map(m => m.monitor_id)).not.toContain(rivalMonitor.id);
  });
});
