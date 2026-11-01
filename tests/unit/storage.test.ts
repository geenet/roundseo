import { afterEach, describe, expect, it, vi } from 'vitest';
import { pendingWriteCount, readStoredJson, removeStoredValue, retryPendingWrites, writeStoredJson } from '../../src/ui/storage';

afterEach(() => { removeStoredValue('test-workspace'); vi.unstubAllGlobals(); });
describe('browser workspace persistence', () => {
  it('retains an unsaved value for reading and retries after storage is available', () => {
    const values = new Map<string, string>();
    const setItem = vi.fn().mockImplementationOnce(() => { throw new Error('Quota exceeded'); }).mockImplementation((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null, setItem, removeItem: (key: string) => values.delete(key) });
    expect(writeStoredJson('test-workspace', [{ id: 'saved-audit' }])).toBe(false);
    expect(readStoredJson('test-workspace', [])).toEqual([{ id: 'saved-audit' }]);
    expect(pendingWriteCount()).toBe(1);
    retryPendingWrites();
    expect(pendingWriteCount()).toBe(0);
    expect(values.get('test-workspace')).toContain('saved-audit');
  });
  it('rejects malformed stored collection shapes without crashing the application', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{"invalid":"collection"}', removeItem: vi.fn() });
    expect(readStoredJson('test-workspace', [])).toEqual([]);
  });
});
