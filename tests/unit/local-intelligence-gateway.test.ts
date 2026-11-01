import Database from 'better-sqlite3';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalIntelligenceGateway, toApiPath } from '../../src/local/intelligence-gateway';

function fakeRequest(url: string, options: { method?: string; headers?: Record<string, string>; address?: string } = {}) {
  const listeners: Record<string, Array<(value?: unknown) => void>> = {};
  const request = {
    url,
    method: options.method ?? 'GET',
    headers: { host: 'localhost:5175', ...(options.headers ?? {}) },
    socket: { remoteAddress: options.address ?? '127.0.0.1' },
    on(event: string, listener: (value?: unknown) => void) {
      (listeners[event] ||= []).push(listener);
      return request;
    },
    destroy() { /* no-op */ },
    emitEnd() { for (const listener of listeners.end || []) listener(); },
  };
  return request as unknown as import('node:http').IncomingMessage & { emitEnd(): void };
}

function fakeResponse() {
  const captured: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const response = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers; return response; },
    end(body?: string | Buffer) { captured.body = body === undefined ? '' : String(body); },
  };
  return { response: response as unknown as import('node:http').ServerResponse, captured };
}

describe('local intelligence gateway path mapping', () => {
  it('maps the local namespace onto the Worker routes it mirrors and keeps query strings', () => {
    expect(toApiPath('/__roundseo/intelligence/status')).toBe('/api/v2/intelligence/status');
    expect(toApiPath('/__roundseo/intelligence/websites/site-1/runs?limit=5')).toBe('/api/v2/websites/site-1/intelligence/runs?limit=5');
    expect(toApiPath('/__roundseo/intelligence/websites/site-1/runs/run-1/refresh')).toBe('/api/v2/websites/site-1/intelligence/runs/run-1/refresh');
    expect(toApiPath('/__roundseo/intelligence/websites/site-1/evidence?capability=page_intelligence')).toBe('/api/v2/websites/site-1/intelligence/evidence?capability=page_intelligence');
    expect(toApiPath('/__roundseo/intelligence/websites/site-1/assets/asset-1?expires=9&sig=ab')).toBe('/api/v2/websites/site-1/intelligence/assets/asset-1?expires=9&sig=ab');
  });

  it('leaves unrelated paths and unknown gateway routes alone', () => {
    expect(toApiPath('/api/v2/intelligence/status')).toBeNull();
    expect(toApiPath('/__roundseo/intelligence/unknown')).toBeNull();
    expect(toApiPath('/__roundseo/intelligence/websites/site-1/unknown')).toBeNull();
  });
});

describe('local intelligence gateway guards', () => {
  const databasePath = path.join(mkdtempSync(path.join(tmpdir(), 'roundseo-gateway-')), 'missing.db');
  const gateway = createLocalIntelligenceGateway({ databasePath, environment: {} });

  it('refuses requests that do not come from this machine', () => {
    const { response, captured } = fakeResponse();
    gateway.handle(fakeRequest('/__roundseo/intelligence/status', { address: '203.0.113.9' }), response, () => undefined);
    expect(captured.status).toBe(403);
  });

  it('refuses cross-site changes even from the loopback address', () => {
    const { response, captured } = fakeResponse();
    gateway.handle(fakeRequest('/__roundseo/intelligence/websites/site-1/runs', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }), response, () => undefined);
    expect(captured.status).toBe(403);
  });

  it('reports a missing local database instead of creating an empty one', () => {
    const { response, captured } = fakeResponse();
    gateway.handle(fakeRequest('/__roundseo/intelligence/status'), response, () => undefined);
    expect(captured.status).toBe(503);
    expect(JSON.parse(captured.body || '{}')).toMatchObject({ code: 'LOCAL_DATABASE_MISSING' });
  });

  it('reports a database without the Intelligence tables instead of migrating it or failing inside a route', () => {
    const legacyPath = path.join(mkdtempSync(path.join(tmpdir(), 'roundseo-legacy-')), 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    legacy.close();
    const legacyGateway = createLocalIntelligenceGateway({ databasePath: legacyPath, environment: {} });
    const { response, captured } = fakeResponse();
    legacyGateway.handle(fakeRequest('/__roundseo/intelligence/status'), response, () => undefined);
    expect(captured.status).toBe(503);
    expect(JSON.parse(captured.body || '{}')).toMatchObject({ code: 'LOCAL_DATABASE_NOT_READY' });
    const check = new Database(legacyPath, { readonly: true });
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'intelligence_runs'").get()).toBeUndefined();
    check.close();
  });

  it('recognizes gateway paths after the middleware strips its mount prefix, using the original URL', () => {
    const request = fakeRequest('/status') as unknown as IncomingMessage & { originalUrl?: string };
    request.originalUrl = '/__roundseo/intelligence/status';
    const { response, captured } = fakeResponse();
    let nextCalled = false;
    createLocalIntelligenceGateway({ databasePath: path.join(tmpdir(), 'roundseo-absent-gateway.db'), environment: {} })
      .handle(request, response, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(captured.status).toBe(503);
    expect(JSON.parse(captured.body || '{}')).toMatchObject({ code: 'LOCAL_DATABASE_MISSING' });
  });

  it('passes non-intelligence requests to the next middleware', () => {
    let nextCalled = false;
    const { response } = fakeResponse();
    gateway.handle(fakeRequest('/__roundseo/intelligence/elsewhere'), response, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
