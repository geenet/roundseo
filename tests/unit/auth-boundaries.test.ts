import { describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createToken, verifyToken } from '../../src/worker/auth/jwt';
import { hashPassword, verifyPassword } from '../../src/worker/auth/password';
import { handleGoogleCallback } from '../../src/worker/auth';
import { routeRequest } from '../../src/worker/api/router';

const env = { JWT_SECRET: 'test-only-signing-secret-with-at-least-32-bytes' };

describe('authentication and tenant boundaries', () => {
  it('requires the configured signing key and verifies required identity claims', async () => {
    const token = await createToken({ userId: 'user-1', email: 'owner@example.test' }, env.JWT_SECRET);
    expect(await verifyToken(token, env.JWT_SECRET)).toMatchObject({ userId: 'user-1' });
    expect(await verifyToken(token, 'different-signing-key')).toBeNull();
    expect(await verifyToken(token, undefined)).toBeNull();
    await expect(createToken({ userId: 'user-1', email: 'a@b.test' }, undefined)).rejects.toThrow('JWT_SECRET');
    const incomplete = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifyToken(incomplete, env.JWT_SECRET)).toBeNull();
  });

  it('salts password hashes and can verify existing legacy hashes during migration', async () => {
    const first = await hashPassword('TestPassword123');
    const second = await hashPassword('TestPassword123');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^pbkdf2\$100000\$/);
    expect(await verifyPassword('TestPassword123', first)).toBe(true);
    expect(await verifyPassword('wrong-password', first)).toBe(false);
    const legacy = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('legacy-password'))), byte => byte.toString(16).padStart(2, '0')).join('');
    expect(await verifyPassword('legacy-password', legacy)).toBe(true);
    expect(await verifyPassword('password', '')).toBe(false);
  });

  it('rejects Google callbacks without the initiating browser session', async () => {
    const db = { prepare: vi.fn() };
    const response = await handleGoogleCallback(new Request('https://api.example.test/api/v2/auth/google/callback', { method: 'POST', body: JSON.stringify({ code: 'code', state: 'untrusted-state' }) }), env, db);
    expect(response.status).toBe(400);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it('blocks cross-tenant reads and writes for secondary resource routes', async () => {
    const run = vi.fn();
    const db = { prepare: (sql: string) => ({ bind: () => ({
      first: async () => sql.includes('JOIN') ? null : sql.includes('tracked_keywords') ? { id: 'keyword-1', website_id: 'foreign-site' } : sql.includes('FROM reports') ? { id: 'report-1', organization_id: 'foreign-org' } : sql.includes('FROM pages') ? { url: 'https://foreign.test', website_id: 'foreign-site' } : null,
      all: async () => ({ results: [] }), run,
    }) }) };
    const token = await createToken({ userId: 'user-1', email: 'owner@example.test' }, env.JWT_SECRET);
    for (const [path, method] of [
      ['/organizations/foreign-org/reports', 'GET'], ['/reports/report-1/share', 'POST'],
      ['/websites/foreign-site/keywords', 'GET'], ['/keywords/keyword-1/ranking', 'POST'],
      ['/organizations/foreign-org/competitors', 'GET'], ['/pages/page-1/analyze', 'POST'],
      ['/websites/foreign-site/intelligence/runs', 'POST'],
    ]) {
      const request = new Request(`https://api.example.test/api/v2${path}`, { method, headers: { Authorization: `Bearer ${token}` }, ...(method === 'POST' ? { body: JSON.stringify({ html: '<main>Test</main>', title: 'Test', rank: 1 }) } : {}) });
      expect((await routeRequest(request, db, env))?.status, path).toBe(404);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('does not expose intelligence capability state without authentication', async () => {
    const response = await routeRequest(new Request('https://api.example.test/api/v2/intelligence/status'), { prepare: vi.fn() }, env);
    expect(response?.status).toBe(401);
  });

  it('reports only the public RoundSEO Intelligence capability state to an authenticated user', async () => {
    const token = await createToken({ userId: 'user-1', email: 'owner@example.test' }, env.JWT_SECRET);
    const response = await routeRequest(new Request('https://api.example.test/api/v2/intelligence/status', {
      headers: { Authorization: `Bearer ${token}` },
    }), { prepare: vi.fn() }, env);
    const body = await response?.text();
    expect(response?.status).toBe(200);
    expect(body).toContain('"available":true');
    expect(body).toContain('"keyword_research"');
    expect(body).not.toContain('private-');
  });

  it('does not let one website refresh an intelligence run it does not own', async () => {
    const token = await createToken({ userId: 'user-1', email: 'owner@example.test' }, env.JWT_SECRET);
    const db = { prepare: (sql: string) => ({ bind: () => ({
      first: async () => sql.includes('FROM intelligence_runs') ? null : sql.includes('FROM websites website') ? { id: 'site-1' } : null,
    }) }) };
    const response = await routeRequest(new Request('https://api.example.test/api/v2/websites/site-1/intelligence/runs/native-run/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }), db, env);
    expect(response?.status).toBe(404);
  });

  it('routes valid public report shares and rejects expired shares without exposing internal metadata', async () => {
    let expiresAt = new Date(Date.now() + 60_000).toISOString();
    const run = vi.fn().mockResolvedValue({ success: true });
    const db = { prepare: () => ({ bind: () => ({ first: async () => ({ id: 'report-1', title: 'SEO report', report_type: 'full', is_shared: 1, is_password_protected: 0, expires_at: expiresAt, created_by: 'private-user', organization_id: 'private-org', shared_token: 'private-token' }), run }) }) };
    const request = new Request('https://api.example.test/api/v2/reports/share-token/view');
    const response = await routeRequest(request, db, env);
    expect(response?.status).toBe(200);
    expect(await response?.text()).not.toContain('private-');
    expiresAt = '2020-01-01T00:00:00.000Z';
    expect((await routeRequest(request, db, env))?.status).toBe(404);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
