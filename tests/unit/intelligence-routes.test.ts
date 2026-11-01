import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeRequest } from '../../src/worker/api/router';
import { createToken } from '../../src/worker/auth/jwt';
import { runIntelligenceJob } from '../../src/worker/services/intelligence-jobs';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

const SECRET = 'test-only-signing-secret-with-at-least-32-bytes';
const ORIGIN = 'https://api.example.test';
const RUNNER_TOKEN = 'runner-token-for-tests-0123456789';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const PAGE_HOME = '<html lang="en"><head><title>Example home page for the test suite</title><meta name="description" content="A home page description that is long enough for the check."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"></head><body><h1>Home</h1><p>' + 'words '.repeat(320) + '</p><a href="/about">About the company</a><a href="/private">Private area</a></body></html>';
const PAGE_ABOUT = '<html lang="en"><head><title>About page with a long enough title here</title></head><body><h1>About</h1><p>' + 'words '.repeat(320) + '</p><a href="/contact">Contact us today</a></body></html>';
const PAGE_CONTACT = '<html lang="en"><head><title>Contact page with a long enough title here</title></head><body><h1>Contact</h1><p>' + 'words '.repeat(320) + '</p></body></html>';

let database: Database.Database;
let db: ReturnType<typeof d1>;
let fetchCalls: string[];

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
  fetchCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  database.close();
});

/** Serve the test site (and optional browser runner) without any network access. */
function stubWeb() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.startsWith(`${RUNNER_URL}/screenshot`)) return Response.json({ base64: PNG.toString('base64'), finalUrl: 'https://example.com/' });
    if (url === 'https://example.com/robots.txt') return new Response('User-agent: *\nDisallow: /private', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (url === 'https://example.com/' || url === 'https://example.com') return html(PAGE_HOME);
    if (url === 'https://example.com/about') return html(PAGE_ABOUT);
    if (url === 'https://example.com/contact') return html(PAGE_CONTACT);
    if (url === 'https://example.com/private') return html(PAGE_HOME);
    return new Response('not found', { status: 404 });
  }));
}

const RUNNER_URL = 'https://runner.example.test';

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function authorization(userId = 'user-owner', email = 'owner@example.test'): Promise<string> {
  return `Bearer ${await createToken({ userId, email }, SECRET)}`;
}

function jobs() {
  const pending: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } }, settle: () => Promise.all(pending) };
}

async function api(path: string, init: RequestInit & { auth?: string | null } = {}, env: Record<string, unknown> = {}, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  const headers = new Headers(init.headers);
  if (init.auth !== null) headers.set('Authorization', init.auth ?? await authorization());
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await routeRequest(new Request(`${ORIGIN}${path}`, { ...init, headers }), db, { JWT_SECRET: SECRET, DB: db, ...env }, ctx);
  return response as Response;
}

function post(path: string, body: unknown, key = 'key-0000000001', extra: RequestInit & { auth?: string | null } = {}) {
  return { path, init: { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key }, ...extra } };
}

const pageInspection = { action: 'page_inspection', url: 'https://example.com/' };
/** A queue binding that accepts messages without running them, so a crawl stays queued for the test to act on. */
const QUEUED_ENV = { CRAWL_JOBS: { send: async () => undefined } };

describe('intelligence status', () => {
  it('requires authentication', async () => {
    const response = await api('/api/v2/intelligence/status', { auth: null });
    expect(response.status).toBe(401);
  });

  it('reports per-action availability for this deployment without any paid-provider vocabulary', async () => {
    const response = await api('/api/v2/intelligence/status');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/dataforseo|spend/i);
    const status = JSON.parse(text) as { available: boolean; capabilities: string[]; actions: Array<{ action: string; available: boolean; reason: string | null }> };
    expect(status.available).toBe(true);
    expect(status.capabilities).toEqual(expect.arrayContaining(['page_intelligence', 'serp_analysis']));
    expect(status.actions.find(item => item.action === 'keyword_discovery')).toMatchObject({ available: true });
    expect(status.actions.find(item => item.action === 'keyword_overview')).toMatchObject({ available: false });
    expect(status.actions.find(item => item.action === 'page_inspection')).toMatchObject({ available: true });
  });
});

describe('website scope and roles', () => {
  it('hides another organization\'s website and its runs', async () => {
    const response = await api('/api/v2/websites/site-1/intelligence/runs', { auth: await authorization('user-outsider', 'outsider@example.test') });
    expect(response.status).toBe(404);
  });

  it('lets a client-role team member read but not start collection', async () => {
    const auth = await authorization('user-client', 'client@example.test');
    const read = await api('/api/v2/websites/site-1/intelligence/runs', { auth });
    expect(read.status).toBe(200);
    const request = post('/api/v2/websites/site-1/intelligence/runs', pageInspection, 'key-0000000002', { auth });
    const write = await api(request.path, request.init);
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ code: 'INTELLIGENCE_ROLE_REQUIRED' });
  });
});

describe('request handling', () => {
  it('requires an Idempotency-Key for every collection request', async () => {
    const response = await api('/api/v2/websites/site-1/intelligence/runs', { method: 'POST', body: JSON.stringify(pageInspection) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('refuses an action whose source is not configured, before creating a run', async () => {
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'keyword_overview', keywords: ['seo'], countryCode: 'US', languageCode: 'en' }, 'key-keyword-0001');
    const response = await api(request.path, request.init);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
    expect((await api('/api/v2/websites/site-1/intelligence/runs')).status).toBe(200);
    expect(await (await api('/api/v2/websites/site-1/intelligence/runs')).json()).toMatchObject({ runs: [] });
  });

  it('pins domain analysis to the website it was requested for', async () => {
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'domain_rankings', domain: 'other.test', countryCode: 'US' }, 'key-domain-0001');
    const response = await api(request.path, request.init);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_INTELLIGENCE_REQUEST' });
  });

  it('refuses private page addresses before any request leaves the Worker', async () => {
    stubWeb();
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'page_inspection', url: 'http://127.0.0.1/admin' }, 'key-private-0001');
    const response = await api(request.path, request.init);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'PUBLIC_URL_REQUIRED' });
    expect(fetchCalls).toEqual([]);
  });

  it('collects a page once per idempotency key, replays the stored run, and rejects a changed body under the same key', async () => {
    stubWeb();
    const request = post('/api/v2/websites/site-1/intelligence/runs', pageInspection, 'key-page-00001');
    const created = await api(request.path, request.init);
    expect(created.status).toBe(201);
    const { run } = await created.json() as { run: { id: string; status: string; evidence: Array<{ kind: string; title: string; renderingMode: string }> } };
    expect(run.status).toBe('complete');
    expect(run.evidence[0]).toMatchObject({ kind: 'page', renderingMode: 'html', title: 'Example home page for the test suite' });
    const callsAfterFirst = fetchCalls.length;

    const replay = await api(request.path, request.init);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { run: { id: string } }).run.id).toBe(run.id);
    expect(fetchCalls.length).toBe(callsAfterFirst);

    const conflict = await api(request.path, { ...request.init, body: JSON.stringify({ action: 'page_inspection', url: 'https://example.com/about' }) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('stops collection at the daily live-request ceiling and records the run as failed', async () => {
    stubWeb();
    const env = { INTELLIGENCE_DAILY_REQUEST_LIMIT: '1' };
    const first = post('/api/v2/websites/site-1/intelligence/runs', pageInspection, 'key-limit-00001');
    expect((await api(first.path, first.init, env)).status).toBe(201);
    const second = post('/api/v2/websites/site-1/intelligence/runs', { action: 'page_inspection', url: 'https://example.com/about' }, 'key-limit-00002');
    const response = await api(second.path, second.init, env);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'INTELLIGENCE_DAILY_LIMIT' });
    const runs = await (await api('/api/v2/websites/site-1/intelligence/runs')).json() as { runs: Array<{ status: string; action: string }> };
    expect(runs.runs.map(run => run.status).sort()).toEqual(['complete', 'failed']);
  });
});

describe('durable site crawls', () => {
  it('queues a crawl, works through its frontier in batches, and respects robots rules', async () => {
    stubWeb();
    const tasks = jobs();
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'site_crawl', domain: 'example.com', maximumPages: 10 }, 'key-crawl-00001');
    const queued = await api(request.path, request.init, {}, tasks.ctx);
    expect(queued.status).toBe(202);
    const { run } = await queued.json() as { run: { id: string; status: string } };
    expect(run.status).toBe('queued');

    await tasks.settle();
    const finished = await (await api(`/api/v2/websites/site-1/intelligence/runs/${run.id}`)).json() as {
      run: { status: string; summary: { pagesCrawled: number }; evidence: Array<{ kind: string; url: string }>; unavailable: Array<{ reason: string }> };
    };
    expect(finished.run.status).toBe('partial');
    expect(finished.run.summary.pagesCrawled).toBe(3);
    expect(finished.run.evidence.map(item => item.url).sort()).toEqual(['https://example.com/', 'https://example.com/about', 'https://example.com/contact']);
    expect(finished.run.unavailable.map(item => item.reason).join(' ')).toMatch(/robots\.txt/);
    expect(fetchCalls).not.toContain('https://example.com/private');
  });

  it('stops at the page limit and reports the remaining pages as not crawled', async () => {
    stubWeb();
    const tasks = jobs();
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'site_crawl', domain: 'example.com', maximumPages: 2 }, 'key-crawl-00002');
    const { run } = await (await api(request.path, request.init, {}, tasks.ctx)).json() as { run: { id: string } };
    await tasks.settle();
    const finished = await (await api(`/api/v2/websites/site-1/intelligence/runs/${run.id}`)).json() as { run: { status: string; summary: { pagesCrawled: number; pagesQueued: number }; unavailable: Array<{ reason: string }> } };
    expect(finished.run.status).toBe('partial');
    expect(finished.run.summary.pagesCrawled).toBe(2);
    expect(finished.run.unavailable.map(item => item.reason).join(' ')).toMatch(/page limit/);
  });

  it('cancels a queued crawl so the next batch finishes it without fetching pages', async () => {
    stubWeb();
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'site_crawl', domain: 'example.com', maximumPages: 10 }, 'key-crawl-00003');
    const { run } = await (await api(request.path, request.init, QUEUED_ENV)).json() as { run: { id: string } };
    const cancelled = await api(`/api/v2/websites/site-1/intelligence/runs/${run.id}/cancel`, { method: 'POST' }, QUEUED_ENV);
    expect(cancelled.status).toBe(202);
    expect(await cancelled.json()).toMatchObject({ run: { id: run.id } });
    const outcome = await runIntelligenceJob({ DB: db, JWT_SECRET: SECRET }, { jobType: 'intelligence', websiteId: 'site-1', intelligenceRunId: run.id });
    expect(outcome).toBe('finished');
    const after = await (await api(`/api/v2/websites/site-1/intelligence/runs/${run.id}`)).json() as { run: { status: string } };
    expect(after.run.status).toBe('cancelled');
    expect(fetchCalls.filter(url => url.startsWith('https://example.com/') && !url.endsWith('robots.txt'))).toEqual([]);
  });

  it('refuses to refresh a crawl that is still running', async () => {
    stubWeb();
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'site_crawl', domain: 'example.com', maximumPages: 10 }, 'key-crawl-00004');
    const { run } = await (await api(request.path, request.init, QUEUED_ENV)).json() as { run: { id: string } };
    const refresh = await api(`/api/v2/websites/site-1/intelligence/runs/${run.id}/refresh`, { method: 'POST', headers: { 'Idempotency-Key': 'key-refresh-0001' } }, QUEUED_ENV);
    expect(refresh.status).toBe(409);
    expect(await refresh.json()).toMatchObject({ code: 'INTELLIGENCE_RUN_ACTIVE' });
  });

  it('refreshes a finished crawl as a new run linked to the one it refreshes', async () => {
    stubWeb();
    const tasks = jobs();
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'site_crawl', domain: 'example.com', maximumPages: 10 }, 'key-crawl-00005');
    const { run } = await (await api(request.path, request.init, {}, tasks.ctx)).json() as { run: { id: string } };
    await tasks.settle();
    const refresh = await api(`/api/v2/websites/site-1/intelligence/runs/${run.id}/refresh`, { method: 'POST', headers: { 'Idempotency-Key': 'key-refresh-0002' } }, {}, tasks.ctx);
    expect(refresh.status).toBe(202);
    const refreshed = await refresh.json() as { run: { id: string; action: string; parentRunId?: string } };
    expect(refreshed.run.action).toBe('site_crawl_refresh');
    expect(refreshed.run.id).not.toBe(run.id);
    await tasks.settle();
    const evidence = await (await api(`/api/v2/websites/site-1/intelligence/evidence?capability=page_intelligence`)).json() as { evidence: Array<{ kind: string }> };
    expect(evidence.evidence.filter(item => item.kind === 'page').length).toBeGreaterThanOrEqual(3);
  });
});

describe('screenshots', () => {
  const runnerEnv = {
    ROUNDSEO_PERFORMANCE_RUNNER_URL: RUNNER_URL,
    ROUNDSEO_RUNNER_TOKEN: RUNNER_TOKEN,
    INTELLIGENCE_ASSET_SECRET: 'asset-signing-secret-for-tests-0123456789',
  };

  function withAssetStore() {
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    return {
      objects,
      store: {
        put: async (key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string } }) => { objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata.contentType }); },
        get: async (key: string) => objects.has(key) ? { body: new Response(objects.get(key)!.bytes.slice().buffer).body } : null,
      },
    };
  }

  it('stores a screenshot in R2 and serves it only through a correctly signed, unexpired URL', async () => {
    stubWeb();
    const { store, objects } = withAssetStore();
    const env = { ...runnerEnv, R2: store };
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'page_screenshot', url: 'https://example.com/', browserProfile: 'desktop' }, 'key-shot-00001');
    const created = await api(request.path, request.init, env);
    expect(created.status).toBe(201);
    const { run } = await created.json() as { run: { evidence: Array<{ kind: string; screenshotUrl: string | null }> } };
    const page = run.evidence.find(item => item.kind === 'page');
    expect(page?.screenshotUrl).toMatch(/\/api\/v2\/websites\/site-1\/intelligence\/assets\/.+\?expires=\d+&sig=[a-f0-9]{64}$/);
    expect(objects.size).toBe(1);
    const [storageKey] = [...objects.keys()];
    expect(storageKey.startsWith('intelligence/site-1/')).toBe(true);

    const signed = new URL(page!.screenshotUrl!);
    const served = await api(`${signed.pathname}${signed.search}`, { method: 'GET', auth: null }, env);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);

    const tampered = await api(`${signed.pathname}?expires=${signed.searchParams.get('expires')}&sig=${'0'.repeat(64)}`, { method: 'GET', auth: null }, env);
    expect(tampered.status).toBe(404);
    const expired = await api(`${signed.pathname}?expires=1&sig=${signed.searchParams.get('sig')}`, { method: 'GET', auth: null }, env);
    expect(expired.status).toBe(404);
  });

  it('refuses screenshots when the browser runner or screenshot storage is not configured', async () => {
    stubWeb();
    const request = post('/api/v2/websites/site-1/intelligence/runs', { action: 'page_screenshot', url: 'https://example.com/' }, 'key-shot-00002');
    const response = await api(request.path, request.init, {});
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'INTELLIGENCE_SOURCE_UNAVAILABLE' });
  });
});

describe('evidence reads', () => {
  it('pages evidence for one capability and returns nothing for a website the caller cannot read', async () => {
    stubWeb();
    const request = post('/api/v2/websites/site-1/intelligence/runs', pageInspection, 'key-evidence-001');
    await api(request.path, request.init);
    const page = await api('/api/v2/websites/site-1/intelligence/evidence?capability=page_intelligence&limit=10&offset=0');
    expect(page.status).toBe(200);
    const body = await page.json() as { evidence: Array<{ kind: string }> };
    expect(body.evidence.map(item => item.kind)).toEqual(['page']);
    const other = await api('/api/v2/websites/site-1/intelligence/evidence', { auth: await authorization('user-outsider', 'outsider@example.test') });
    expect(other.status).toBe(404);
  });

  it('rejects invalid query bounds with a 400 rather than returning unbounded pages', async () => {
    const response = await api('/api/v2/websites/site-1/intelligence/evidence?limit=5000');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_INTELLIGENCE_QUERY' });
  });
});
