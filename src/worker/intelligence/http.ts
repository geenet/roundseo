import { isPublicCrawlUrl } from '../crawlers/base';
import { IntelligenceError } from './errors';

export type IntelligenceFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchedPage {
  /** Final URL after every redirect hop was checked. */
  url: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  html: string;
  truncated: boolean;
}

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

const BROWSER_LIKE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (compatible; RoundSEO-Intelligence/1.0; +https://roundseo.com/bot)',
  Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'Accept-Language': 'en;q=0.8',
};

/**
 * Fetch a public page with every redirect hop validated against the public-URL
 * policy. Private, credentialed, or non-HTTP targets are refused before any
 * request leaves the Worker.
 */
export async function fetchPublicPage(
  value: string,
  options: { fetcher?: IntelligenceFetch; timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> } = {},
): Promise<FetchedPage> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_PAGE_BYTES;
  let current = value;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isPublicCrawlUrl(current)) {
      throw new IntelligenceError('Only public HTTP or HTTPS page addresses can be inspected.', { status: 400, code: 'PUBLIC_URL_REQUIRED' });
    }
    const response = await fetchWithTimeout(fetcher, current, {
      method: 'GET',
      redirect: 'manual',
      headers: { ...BROWSER_LIKE_HEADERS, ...(options.headers || {}) },
    }, timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    const { text, truncated } = await readBoundedText(response, maxBytes);
    return {
      url: current,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      headers: pickHeaders(response.headers),
      html: text,
      truncated,
    };
  }
  throw new IntelligenceError('The page redirected too many times to inspect safely.', { status: 502, code: 'INTELLIGENCE_REDIRECT_LIMIT' });
}

/** Read a JSON provider response with a timeout and host allowlist. */
export async function fetchProviderJson(
  url: string,
  init: RequestInit,
  options: { fetcher?: IntelligenceFetch; allowedHosts: string[]; timeoutMs?: number },
): Promise<{ status: number; body: unknown; text: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !options.allowedHosts.includes(parsed.hostname)) {
    throw new IntelligenceError('A search source request was sent to an unapproved host.', { status: 500, code: 'INVALID_PROVIDER_ENDPOINT' });
  }
  const response = await fetchWithTimeout(options.fetcher ?? fetch, url, { ...init, redirect: 'error' }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const { text } = await readBoundedText(response, 4 * 1024 * 1024);
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: response.status, body, text };
}

export async function fetchWithTimeout(fetcher: IntelligenceFetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new IntelligenceError('The source did not respond in time.', { status: 504, code: 'INTELLIGENCE_TIMEOUT' });
    throw new IntelligenceError('The source could not be reached.', { status: 502, code: 'INTELLIGENCE_UNREACHABLE' });
  } finally {
    clearTimeout(timer);
  }
}

export async function readBoundedText(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - received;
    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, Math.max(0, remaining)));
      received = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    received += value.byteLength;
  }
  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder('utf-8').decode(combined), truncated };
}

function pickHeaders(headers: Headers): Record<string, string> {
  const allowed = ['content-type', 'x-robots-tag', 'content-language', 'last-modified'];
  const output: Record<string, string> = {};
  for (const name of allowed) {
    const value = headers.get(name);
    if (value) output[name] = value;
  }
  return output;
}

export interface FetchedBytes {
  url: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Fetch a public binary resource (such as an icon) with every redirect hop checked.
 * Responses larger than maxBytes are refused rather than truncated.
 */
export async function fetchPublicBytes(
  value: string,
  options: { fetcher?: IntelligenceFetch; timeoutMs?: number; maxBytes: number },
): Promise<FetchedBytes> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current = value;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isPublicCrawlUrl(current)) {
      throw new IntelligenceError('Only public HTTP or HTTPS addresses can be fetched.', { status: 400, code: 'PUBLIC_URL_REQUIRED' });
    }
    const response = await fetchWithTimeout(fetcher, current, { method: 'GET', redirect: 'manual', headers: { ...BROWSER_LIKE_HEADERS, Accept: 'image/*,*/*;q=0.5' } }, timeoutMs);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    return { url: current, status: response.status, contentType: response.headers.get('content-type') || '', bytes: await readBoundedBytes(response, options.maxBytes) };
  }
  throw new IntelligenceError('The resource redirected too many times to fetch safely.', { status: 502, code: 'INTELLIGENCE_REDIRECT_LIMIT' });
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new IntelligenceError('The resource is larger than RoundSEO stores.', { status: 413, code: 'RESOURCE_TOO_LARGE' });
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined;
}
