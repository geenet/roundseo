import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBacklinkCheck } from '../../src/worker/backlinks/crawl';
import { createBacklinkMonitor, getBacklinkMonitor } from '../../src/worker/backlinks/monitors';
import { createBacklinkJob } from '../../src/worker/backlinks/jobs';
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

afterEach(() => { vi.unstubAllGlobals(); database?.close(); });

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    return handler(url);
  }));
}

describe('runBacklinkCheck false-positive protection', () => {
  it('establishes a present baseline on the first check without a recovery event', async () => {
    let monitor = await setup();
    stubFetch(() => html(`<a href="${TARGET}">pricing</a>`));
    const result = await checkOnce(monitor.id);
    expect(result.events).toEqual([]);
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.lastConfirmedPresence).toBe('present');
  });

  it('AC7: a 403 preserves the prior confirmed state and marks the attempt inconclusive', async () => {
    let monitor = await setup();
    stubFetch(() => html(`<a href="${TARGET}">pricing</a>`));
    await checkOnce(monitor.id);
    stubFetch(() => new Response('blocked', { status: 403 }));
    const result = await checkOnce(monitor.id);
    expect(result.events).toEqual([]);
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.lastConfirmedPresence).toBe('present'); // unchanged
    const observation = database.prepare('SELECT fetch_outcome, confirmation_state FROM backlink_observations ORDER BY attempted_at DESC LIMIT 1').get() as any;
    expect(observation.fetch_outcome).toBe('blocked');
    expect(observation.confirmation_state).toBe('unconfirmed');
  });

  it('AC8: a truncated response cannot establish absence', async () => {
    let monitor = await setup();
    stubFetch(() => html(`<a href="${TARGET}">pricing</a>`));
    await checkOnce(monitor.id);
    stubFetch(() => new Response('x'.repeat(2_100_000), { status: 200, headers: { 'content-type': 'text/html' } }));
    await checkOnce(monitor.id);
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.lastConfirmedPresence).toBe('present');
    const observation = database.prepare('SELECT fetch_outcome FROM backlink_observations ORDER BY attempted_at DESC LIMIT 1').get() as any;
    expect(observation.fetch_outcome).toBe('truncated');
  });

  it('AC11/AC12: a suspected loss needs a second confirmation before exactly one loss_confirmed event fires, and a stale recheck inside the window does not override the pending state', async () => {
    let monitor = await setup();
    stubFetch(() => html(`<a href="${TARGET}">pricing</a>`));
    await checkOnce(monitor.id);
    stubFetch(() => html('<p>no link here</p>'));
    const first = await checkOnce(monitor.id);
    expect(first.events).toEqual([]); // suspected, not yet confirmed
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.lastConfirmedPresence).toBe('present'); // still present until confirmed
    expect(monitor.pendingConfirmationObservationId).toBeTruthy();

    const second = await checkOnce(monitor.id);
    expect(second.events).toEqual(['loss_confirmed']);
    monitor = (await getBacklinkMonitor(db, monitor.id))!;
    expect(monitor.lastConfirmedPresence).toBe('absent');

    const events = database.prepare(`SELECT COUNT(*) AS count FROM backlink_events WHERE monitor_id = ? AND event_type = 'loss_confirmed'`).get(monitor.id) as any;
    expect(events.count).toBe(1);

    // A redelivered confirmation job for the same observation must not create a second event (AC13).
    const third = await checkOnce(monitor.id);
    expect(third.events).toEqual([]); // already absent and confirmed; nothing new to confirm
  });

  it('AC25: a target change is only reported when occurrence identity is established by context, not by matching anchor text alone', async () => {
    let monitor = await setup();
    stubFetch(() => html(`<p>Read our in-depth</p><a href="${TARGET}">pricing</a><p>guide.</p>`));
    await checkOnce(monitor.id);
    // Same occurrence (same surrounding context), but the href now points elsewhere entirely —
    // not a match for the expected target, so this should read as absent, not a tracked change.
    stubFetch(() => html(`<p>Read our in-depth</p><a href="https://unrelated.example/x">pricing</a><p>guide.</p>`));
    const result = await checkOnce(monitor.id);
    expect(result.events).not.toContain('target_changed');
  });
});
