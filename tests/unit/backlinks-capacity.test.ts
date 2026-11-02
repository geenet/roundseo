import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBacklinkCapacity, releaseBacklinkCapacity, reserveBacklinkCapacity, reserveBacklinkCapacitySlot } from '../../src/worker/backlinks/capacity';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
  database.prepare(`INSERT INTO backlink_capacity (organization_id, limit_count, used_count, updated_at) VALUES ('org-1', 3, 0, '2026-11-01T00:00:00.000Z')`).run();
});

afterEach(() => database.close());

describe('backlink capacity reservation', () => {
  it('reserves a slot only while under the limit', async () => {
    expect(await reserveBacklinkCapacitySlot(db, 'org-1')).toBe(true);
    expect(await reserveBacklinkCapacitySlot(db, 'org-1')).toBe(true);
    expect(await reserveBacklinkCapacitySlot(db, 'org-1')).toBe(true);
    expect(await reserveBacklinkCapacitySlot(db, 'org-1')).toBe(false); // at limit
    const capacity = await getBacklinkCapacity(db, 'org-1');
    expect(capacity).toEqual({ limit: 3, used: 3 });
  });

  it('never grants more than requested even when capacity is unlimited in practice', async () => {
    database.prepare(`UPDATE backlink_capacity SET limit_count = 1000`).run();
    expect(await reserveBacklinkCapacity(db, 'org-1', 5)).toBe(5);
  });

  it('grants a partial batch when capacity runs out mid-way (AC4)', async () => {
    expect(await reserveBacklinkCapacity(db, 'org-1', 10)).toBe(3);
    const capacity = await getBacklinkCapacity(db, 'org-1');
    expect(capacity.used).toBe(3);
  });

  it('releases unused reservations back to the pool', async () => {
    await reserveBacklinkCapacity(db, 'org-1', 3);
    await releaseBacklinkCapacity(db, 'org-1', 2);
    expect((await getBacklinkCapacity(db, 'org-1')).used).toBe(1);
  });

  it('never releases below zero', async () => {
    await releaseBacklinkCapacity(db, 'org-1', 100);
    expect((await getBacklinkCapacity(db, 'org-1')).used).toBe(0);
  });

  it('two "concurrent" imports together cannot exceed the limit (AC4)', async () => {
    // Interleave two reservation sequences one statement at a time, the way two
    // overlapping requests would race against the same row.
    let importA = 0;
    let importB = 0;
    for (let round = 0; round < 5; round += 1) {
      if (await reserveBacklinkCapacitySlot(db, 'org-1')) importA += 1;
      if (await reserveBacklinkCapacitySlot(db, 'org-1')) importB += 1;
    }
    expect(importA + importB).toBe(3);
    expect((await getBacklinkCapacity(db, 'org-1')).used).toBe(3);
  });
});
