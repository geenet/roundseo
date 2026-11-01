const pending = new Map<string, string | null>();
export const STORAGE_EVENT = 'roundseo-storage-status';
function notify(): void { if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORAGE_EVENT)); }

export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = pending.has(key) ? pending.get(key) : localStorage.getItem(key);
    if (!raw) return fallback;
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(fallback) && !Array.isArray(value)) return fallback;
    return value as T;
  } catch { return fallback; }
}

export function writeStoredJson(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
    if (pending.delete(key)) notify();
    return true;
  } catch { pending.set(key, raw); notify(); return false; }
}

export function removeStoredValue(key: string): void {
  try { localStorage.removeItem(key); pending.delete(key); } catch { pending.set(key, null); }
  notify();
}

export function retryPendingWrites(): void {
  for (const [key, raw] of [...pending]) {
    try {
      if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
      pending.delete(key);
    } catch { /* Keep the unsaved value available for retry or download. */ }
  }
  notify();
}

export function pendingWriteCount(): number { return pending.size; }
export function pendingBackup(): string {
  return JSON.stringify({ savedAt: new Date().toISOString(), unsavedEntries: Object.fromEntries([...pending].filter(([key]) => !key.includes('token')).map(([key, raw]) => [key, raw === null ? null : JSON.parse(raw)])) }, null, 2);
}
