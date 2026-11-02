import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordTargetHealthFinding } from '../../src/worker/backlinks/destination-findings';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => { database = migratedDatabase(); seedWorkspace(database); db = d1(database); });
afterEach(() => database.close());

function action(actionKey: string) {
  return database.prepare('SELECT * FROM action_items WHERE action_key = ?').get(actionKey) as any;
}

describe('destination-problem findings (spec: valuable destination problems)', () => {
  it('a 404 target creates an open, high-severity action', async () => {
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl: 'https://example.com/broken', targetStatusCode: 404, targetFinalUrl: null, monitorCount: 1 });
    const key = `backlink_target:site-1:${fingerprintOf('https://example.com/broken')}`;
    const row = action(key);
    expect(row.status).toBe('open');
    expect(row.severity).toBe('high');
    expect(row.rule_id).toBe('backlink_target_broken');
  });

  it('a redirect to an unreviewed destination creates a medium-severity action', async () => {
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl: 'https://example.com/moved', targetStatusCode: 301, targetFinalUrl: 'https://example.com/elsewhere', monitorCount: 1 });
    const row = action(`backlink_target:site-1:${fingerprintOf('https://example.com/moved')}`);
    expect(row.status).toBe('open');
    expect(row.rule_id).toBe('backlink_target_redirected');
  });

  it('AC22: a redirect to a page already marked intended+indexed is not flagged (approved redirect)', async () => {
    database.prepare(`
      INSERT INTO indexing_inventory (id, website_id, url, url_normalized, intended_indexed, is_priority, source, first_seen_at, last_seen_at)
      VALUES ('inv-1', 'site-1', 'https://example.com/new-home', 'https://example.com/new-home', 1, 0, 'manual', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
    `).run();
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl: 'https://example.com/old-home', targetStatusCode: 301, targetFinalUrl: 'https://example.com/new-home', monitorCount: 1 });
    const row = action(`backlink_target:site-1:${fingerprintOf('https://example.com/old-home')}`);
    expect(row).toBeUndefined(); // no action created — this is an approved redirect
  });

  it('resolves the action once the destination recovers', async () => {
    const targetUrl = 'https://example.com/flaky';
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl, targetStatusCode: 500, targetFinalUrl: null, monitorCount: 1 });
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl, targetStatusCode: 200, targetFinalUrl: null, monitorCount: 1 });
    const row = action(`backlink_target:site-1:${fingerprintOf(targetUrl)}`);
    expect(row.status).toBe('verified_resolved');
  });

  it('regression: re-confirming a persistent problem escapes a stale awaiting_verification status back to open', async () => {
    const targetUrl = 'https://example.com/still-broken';
    const key = `backlink_target:site-1:${fingerprintOf(targetUrl)}`;
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl, targetStatusCode: 404, targetFinalUrl: null, monitorCount: 1 });
    // Simulate a user clicking the generic crawl-based "Verify" button on this action.
    database.prepare(`UPDATE action_items SET status = 'awaiting_verification' WHERE action_key = ?`).run(key);
    expect(action(key).status).toBe('awaiting_verification');
    // The next backlink recheck still finds the target broken — must not leave the action stuck.
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl, targetStatusCode: 404, targetFinalUrl: null, monitorCount: 1 });
    expect(action(key).status).toBe('open');
  });

  it('is idempotent across repeated identical findings (no duplicate action rows)', async () => {
    const targetUrl = 'https://example.com/repeat';
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl, targetStatusCode: 404, targetFinalUrl: null, monitorCount: 1 });
    await recordTargetHealthFinding(db, { websiteId: 'site-1', targetUrl, targetStatusCode: 404, targetFinalUrl: null, monitorCount: 1 });
    const count = database.prepare('SELECT COUNT(*) AS count FROM action_items WHERE action_key = ?').get(`backlink_target:site-1:${fingerprintOf(targetUrl)}`) as any;
    expect(count.count).toBe(1);
  });
});

function fingerprintOf(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
