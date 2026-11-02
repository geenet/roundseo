import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBacklinkCheck } from '../../src/worker/backlinks/crawl';
import { createBacklinkMonitor, getBacklinkMonitor, nextCheckAt, patchBacklinkMonitor } from '../../src/worker/backlinks/monitors';
import { createBacklinkJob, processBacklinkJob } from '../../src/worker/backlinks/jobs';
import { extractOccurrences } from '../../src/worker/backlinks/parser';
import { reserveBacklinkCapacitySlot, getBacklinkCapacity } from '../../src/worker/backlinks/capacity';
import { previewBacklinkImport, commitBacklinkImport } from '../../src/worker/backlinks/imports';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

const SOURCE = 'https://news.example/post';
const TARGET = 'https://example.com/pricing';

let database: Database.Database;
let db: ReturnType<typeof d1>;

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function setup() {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
  const { monitor } = await createBacklinkMonitor(db, 'site-1', 'org-1', 'user-owner', { sourceUrl: SOURCE, expectedTargetUrl: TARGET });
  return monitor;
}

async function checkOnce(monitorId: string) {
  const jobId = (await createBacklinkJob(db, monitorId, 'site-1', 'manual_check', `k:${Math.random()}`))!;
  return runBacklinkCheck(db, {} as any, monitorId, jobId);
}

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    return handler(url);
  }));
}

afterEach(() => { vi.unstubAllGlobals(); database?.close(); });

describe('regression: confirmation window survives an inconclusive retry', () => {
  it('a 403 during the confirmation window does not reset the pending loss, so the next genuine absent check still confirms it', async () => {
    let monitor = await setup();
    stubFetch(() => html(`<a href="${TARGET}">pricing</a>`));
    await checkOnce(monitor.id); // baseline: present

    stubFetch(() => html('<p>no link here</p>'));
    await checkOnce(monitor.id); // suspected loss -> pending_confirmation
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    const pendingId = monitor.pendingConfirmationObservationId;
    expect(pendingId).toBeTruthy();

    // An inconclusive confirmation attempt (403) must NOT wipe the pending state.
    stubFetch(() => new Response('blocked', { status: 403 }));
    await checkOnce(monitor.id);
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.pendingConfirmationObservationId).toBe(pendingId);
    expect(monitor.lastConfirmedPresence).toBe('present'); // still not confirmed lost

    // The next genuinely absent check now correctly confirms the loss (not a fresh first-suspicion).
    stubFetch(() => html('<p>still no link</p>'));
    const result = await checkOnce(monitor.id);
    expect(result.events).toEqual(['loss_confirmed']);
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.lastConfirmedPresence).toBe('absent');
  });
});

describe('regression: attribute extraction does not match inside a longer hyphenated attribute', () => {
  it('extracts the real href, not a data-href tracking attribute', () => {
    const [occurrence] = extractOccurrences(`<a data-href="/tracking-only" href="${TARGET}">pricing</a>`, SOURCE);
    expect(occurrence.resolvedUrl).toBe(TARGET);
  });

  it('extracts the real rel, not a data-rel attribute', () => {
    const [occurrence] = extractOccurrences(`<a data-rel="tracked" rel="nofollow" href="${TARGET}">pricing</a>`, SOURCE);
    expect(occurrence.relTokens).toEqual(['nofollow']);
  });
});

describe('regression: render fallback is not disqualified by ordinary nav anchor count', () => {
  it('attempts the render path for an app-shell page even with several static nav links', async () => {
    let monitor = await setup();
    const shellHtml = `<html><body><div id="root"><nav><a href="/">Home</a><a href="/blog">Blog</a><a href="/contact">Contact</a></nav></div><script type="module" src="/app.js"></script></body></html>`;
    let renderCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.includes('/render')) { renderCalled = true; return Response.json({ html: `<a href="${TARGET}">pricing</a>`, finalUrl: SOURCE, status: 200 }); }
      return html(shellHtml);
    }));
    const env = { ROUNDSEO_PERFORMANCE_RUNNER_URL: 'https://runner.example.test', ROUNDSEO_RUNNER_TOKEN: 'runner-token-for-tests-0123456789' };
    const jobId = (await createBacklinkJob(db, monitor.id, 'site-1', 'manual_check', `k:${Math.random()}`))!;
    const result = await runBacklinkCheck(db, env as any, monitor.id, jobId);
    expect(renderCalled).toBe(true);
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.lastConfirmedPresence).toBe('present');
    const observation = database.prepare('SELECT presence_method FROM backlink_observations WHERE id = ?').get(result.observationId) as any;
    expect(observation.presence_method).toBe('rendered');
  });
});

describe('regression: a redelivered or double-dispatched job never processes twice', () => {
  it('running the same jobId twice records exactly one observation and one event', async () => {
    const monitor = await setup();
    stubFetch(() => html(`<a href="${TARGET}">pricing</a>`));
    await checkOnce(monitor.id); // baseline present
    stubFetch(() => html('<p>gone</p>'));
    await checkOnce(monitor.id); // suspected loss
    stubFetch(() => html('<p>still gone</p>'));

    const jobId = (await createBacklinkJob(db, monitor.id, 'site-1', 'manual_check', `k:${Math.random()}`))!;
    const env = { DB: db };
    await processBacklinkJob(env as any, { jobType: 'backlink_check', jobId, monitorId: monitor.id });
    // Simulate the job being reclaimed (e.g. a stale-lease recovery sweep) while conceptually "still running".
    await database.prepare(`UPDATE backlink_jobs SET status = 'retrying' WHERE id = ?`).run(jobId);
    await processBacklinkJob(env as any, { jobType: 'backlink_check', jobId, monitorId: monitor.id });

    const observations = database.prepare('SELECT COUNT(*) AS count FROM backlink_observations WHERE job_id = ?').get(jobId) as any;
    expect(observations.count).toBe(1);
    const events = database.prepare(`SELECT COUNT(*) AS count FROM backlink_events WHERE monitor_id = ? AND event_type = 'loss_confirmed'`).get(monitor.id) as any;
    expect(events.count).toBe(1);
  });
});

describe('regression: monthly cadence does not overflow past short months', () => {
  it('Jan 31 + monthly lands in February, not March', () => {
    expect(nextCheckAt('monthly', '2026-01-31T10:00:00.000Z')).toBe('2026-02-28T10:00:00.000Z');
  });

  it('Dec 31 + monthly rolls into January of the next year', () => {
    expect(nextCheckAt('monthly', '2026-12-31T10:00:00.000Z')).toBe('2027-01-31T10:00:00.000Z');
  });
});

describe('regression: reactivating the same monitor concurrently cannot double-charge capacity', () => {
  it('two concurrent reactivations of one paused monitor only reserve one slot', async () => {
    const monitor = await setup();
    await patchBacklinkMonitor(db, monitor.id, 'org-1', { status: 'paused' });
    const before = await getBacklinkCapacity(db, 'org-1');

    const [a, b] = await Promise.all([
      patchBacklinkMonitor(db, monitor.id, 'org-1', { status: 'active' }),
      patchBacklinkMonitor(db, monitor.id, 'org-1', { status: 'active' }),
    ]);
    expect(a?.status).toBe('active');
    expect(b?.status).toBe('active');
    const after = await getBacklinkCapacity(db, 'org-1');
    expect(after.used).toBe(before.used + 1); // not +2
  });
});

describe('regression: a source-only candidate does not duplicate on a second import', () => {
  it('re-importing the same source-only row twice yields one candidate row', async () => {
    database = migratedDatabase();
    seedWorkspace(database);
    db = d1(database);
    const csv = 'source_url\nhttps://news.example/mentions-us';
    const first = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', csv, 'k1');
    await commitBacklinkImport(db, first.importId, 'org-1', 'user-owner');
    const second = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', csv, 'k2');
    await commitBacklinkImport(db, second.importId, 'org-1', 'user-owner');
    const candidates = database.prepare('SELECT COUNT(*) AS count FROM backlink_candidates WHERE source_url = ?').get('https://news.example/mentions-us') as any;
    expect(candidates.count).toBe(1);
  });
});

describe('regression: reserving a capacity slot never exceeds the limit under repeated calls', () => {
  it('the limit holds exactly after N+1 attempts for an N-slot workspace', async () => {
    database = migratedDatabase();
    seedWorkspace(database);
    db = d1(database);
    database.prepare(`INSERT INTO backlink_capacity (organization_id, limit_count, used_count, updated_at) VALUES ('org-1', 2, 0, '2026-11-01T00:00:00.000Z')`).run();
    const results = [await reserveBacklinkCapacitySlot(db, 'org-1'), await reserveBacklinkCapacitySlot(db, 'org-1'), await reserveBacklinkCapacitySlot(db, 'org-1')];
    expect(results).toEqual([true, true, false]);
  });
});
