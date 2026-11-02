import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitBacklinkImport, previewBacklinkImport } from '../../src/worker/backlinks/imports';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
});

afterEach(() => database.close());

const CSV = [
  'source_url,target_url',
  'https://news.example/a,https://example.com/pricing',
  'https://news.example/b,https://example.com/features',
  'https://news.example/a,https://example.com/pricing', // exact duplicate within the file
].join('\n');

describe('backlink CSV import', () => {
  it('previews accepted and duplicate rows without creating anything yet', async () => {
    const preview = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', CSV, 'key-1');
    expect(preview.acceptedCount).toBe(2);
    expect(preview.duplicateCount).toBe(1);
    const monitorCount = database.prepare('SELECT COUNT(*) AS count FROM backlink_monitors').get() as any;
    expect(monitorCount.count).toBe(0);
  });

  it('AC2: retrying the same commit (same Idempotency-Key) never creates duplicate monitors or double-charges capacity', async () => {
    const preview = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', CSV, 'key-2');
    await commitBacklinkImport(db, preview.importId, 'org-1', 'user-owner');
    await commitBacklinkImport(db, preview.importId, 'org-1', 'user-owner'); // retry
    const monitors = database.prepare('SELECT COUNT(*) AS count FROM backlink_monitors').get() as any;
    expect(monitors.count).toBe(2);
    const capacity = database.prepare('SELECT used_count FROM backlink_capacity WHERE organization_id = ?').get('org-1') as any;
    expect(capacity.used_count).toBe(2);
  });

  it('AC2: re-previewing with the same Idempotency-Key returns the same import rather than re-parsing', async () => {
    const first = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', CSV, 'key-3');
    const second = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', 'source_url,target_url\nhttps://other.example/x,https://example.com/other', 'key-3');
    expect(second.importId).toBe(first.importId);
    expect(second.acceptedCount).toBe(first.acceptedCount);
  });

  it('AC4: concurrent imports cannot together exceed the workspace capacity', async () => {
    database.prepare(`INSERT INTO backlink_capacity (organization_id, limit_count, used_count, updated_at) VALUES ('org-1', 1, 0, '2026-11-01T00:00:00.000Z')`).run();
    const preview = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', CSV, 'key-4');
    expect(preview.acceptedCount).toBe(1); // only one of the two unique rows fits
    expect(preview.overLimitCount).toBe(1);
    await commitBacklinkImport(db, preview.importId, 'org-1', 'user-owner');
    const capacity = database.prepare('SELECT used_count, limit_count FROM backlink_capacity WHERE organization_id = ?').get('org-1') as any;
    expect(capacity.used_count).toBeLessThanOrEqual(capacity.limit_count);
  });

  it('AC5: a source-only row becomes a candidate, not a monitor, until a target is known', async () => {
    const csv = 'source_url\nhttps://news.example/mentions-us';
    const preview = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', csv, 'key-5');
    expect(preview.acceptedCount).toBe(1);
    await commitBacklinkImport(db, preview.importId, 'org-1', 'user-owner');
    const monitors = database.prepare('SELECT COUNT(*) AS count FROM backlink_monitors').get() as any;
    expect(monitors.count).toBe(0);
    const candidates = database.prepare(`SELECT source_url, target_url, enrollment_status FROM backlink_candidates`).get() as any;
    expect(candidates.target_url).toBeNull();
    expect(candidates.enrollment_status).toBe('pending');
  });

  it('marks an invalid URL as invalid, not accepted', async () => {
    const csv = 'source_url,target_url\nnot a url,https://example.com/pricing';
    const preview = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', csv, 'key-6');
    expect(preview.invalidCount).toBe(1);
    expect(preview.rows[0].status).toBe('invalid');
  });

  it('marks a row that already matches an existing monitor as a duplicate, consuming no extra slot', async () => {
    const first = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', 'source_url,target_url\nhttps://news.example/a,https://example.com/pricing', 'key-7a');
    await commitBacklinkImport(db, first.importId, 'org-1', 'user-owner');
    const second = await previewBacklinkImport(db, 'site-1', 'org-1', 'user-owner', 'source_url,target_url\nhttps://news.example/a,https://example.com/pricing', 'key-7b');
    expect(second.duplicateCount).toBe(1);
    expect(second.acceptedCount).toBe(0);
  });
});
