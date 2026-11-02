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
  // A second organization/website pair, owned by a different user — the cross-tenant attack surface.
  database.prepare(`INSERT INTO users (id, email, name, auth_method, created_at, updated_at) VALUES ('user-rival', 'rival@example.test', 'Rival', 'email_password', ?, ?)`).run('2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  database.prepare(`INSERT INTO organizations (id, name, slug, owner_id, billing_email, created_at, updated_at) VALUES ('org-2', 'Rival Co', 'rival-co', 'user-rival', 'billing@rival.test', ?, ?)`).run('2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  database.prepare(`INSERT INTO websites (id, organization_id, name, domain, url, created_at, updated_at) VALUES ('site-rival', 'org-2', 'Rival Site', 'rival.test', 'https://rival.test/', ?, ?)`).run('2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
});

afterEach(() => database.close());

async function authorization(userId: string, email: string): Promise<string> {
  return `Bearer ${await createToken({ userId, email }, SECRET)}`;
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

function envFor(database: ReturnType<typeof d1>) { return { JWT_SECRET: SECRET, DB: database }; }

describe('cross-tenant inspection via a client-supplied inventoryId (regression)', () => {
  it('refuses to inspect a different website\'s inventory item even for an owner of this website', async () => {
    const owner = await authorization('user-owner', 'owner@example.test');
    const rival = await authorization('user-rival', 'rival@example.test');

    // The rival creates an inventory item on their own website.
    const rivalAdd = await routeRequest(
      request('/api/v2/websites/site-rival/indexing/inventory', { method: 'POST', headers: { Authorization: rival }, body: JSON.stringify({ urls: ['https://rival.test/secret-page'], source: 'manual' }) }),
      db, envFor(db),
    );
    expect(rivalAdd?.status).toBe(201);
    const rivalInventory = await routeRequest(request('/api/v2/websites/site-rival/indexing/inventory', { headers: { Authorization: rival } }), db, envFor(db));
    const { items } = await rivalInventory!.json() as any;
    const rivalInventoryId = items[0].id;

    // The owner of a different website (site-1) tries to inspect the rival's inventory item by id.
    const attempt = await routeRequest(
      request('/api/v2/websites/site-1/inspection-jobs', { method: 'POST', headers: { Authorization: owner }, body: JSON.stringify({ inventoryId: rivalInventoryId, reason: 'manual' }) }),
      db, envFor(db),
    );
    expect(attempt?.status).toBe(400);

    // No inspection job was created for the rival's inventory item from this request.
    const jobs = database.prepare('SELECT COUNT(*) AS count FROM inspection_jobs WHERE inventory_id = ?').get(rivalInventoryId) as any;
    expect(jobs.count).toBe(0);
  });
});
