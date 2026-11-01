import type { AppMarketplace } from '../../shared/intelligence';
import { IntelligenceError } from './errors';
import { attributeValue, decodeEntities } from './html';
import { fetchWithTimeout, readBoundedText, type IntelligenceFetch } from './http';

export const APP_STORE_METHOD = 'app-store-search-v1';
const APP_TIMEOUT_MS = 15_000;
const APP_MAX_BYTES = 2 * 1024 * 1024;
const PLAY_APP_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const APPLE_APP_ID = /^\d{1,15}$/;

export interface StoreApp {
  appId: string;
  title: string | null;
  url: string | null;
}

export function validAppId(marketplace: AppMarketplace, appId: string): boolean {
  return marketplace === 'apple_app_store' ? APPLE_APP_ID.test(appId) : PLAY_APP_ID.test(appId);
}

/** Look up one app's public listing. Returns null when the store has no such app. */
export async function lookupStoreApp(
  marketplace: AppMarketplace,
  appId: string,
  countryCode: string,
  options: { fetcher?: IntelligenceFetch } = {},
): Promise<StoreApp | null> {
  assertValidAppId(marketplace, appId);
  const country = countryCode.toLowerCase();
  if (marketplace === 'apple_app_store') {
    const body = await getJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}&country=${country}`, options.fetcher);
    const record = arrayOf(body.results)[0];
    if (!record) return null;
    return { appId: String(record.trackId ?? appId), title: stringOf(record.trackName), url: stringOf(record.trackViewUrl) };
  }
  const html = await getHtml(`https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en&gl=${country}`, options.fetcher);
  if (html === null) return null;
  const title = metaContent(html, 'og:title');
  if (!title) return null;
  return { appId, title: title.replace(/\s*-\s*Apps on Google Play\s*$/i, '').trim() || null, url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}` };
}

/** Ranked store results for one term, in the order the store returned them. */
export async function searchStore(
  marketplace: AppMarketplace,
  term: string,
  countryCode: string,
  limit: number,
  options: { fetcher?: IntelligenceFetch } = {},
): Promise<StoreApp[]> {
  const country = countryCode.toLowerCase();
  const query = term.trim().slice(0, 120);
  if (!query) return [];
  if (marketplace === 'apple_app_store') {
    const body = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=${country}&entity=software&limit=${Math.min(200, Math.max(1, limit))}`, options.fetcher);
    return arrayOf(body.results).map(record => ({
      appId: String(record.trackId ?? ''),
      title: stringOf(record.trackName),
      url: stringOf(record.trackViewUrl),
    })).filter(app => app.appId);
  }
  const html = await getHtml(`https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=${country}`, options.fetcher);
  if (html === null) return [];
  const seen = new Set<string>();
  const apps: StoreApp[] = [];
  for (const match of html.matchAll(/\/store\/apps\/details\?id=([A-Za-z0-9_.]+)/g)) {
    const appId = match[1];
    if (!PLAY_APP_ID.test(appId) || seen.has(appId)) continue;
    seen.add(appId);
    apps.push({ appId, title: null, url: `https://play.google.com/store/apps/details?id=${appId}` });
    if (apps.length >= limit) break;
  }
  return apps;
}

export function assertValidAppId(marketplace: AppMarketplace, appId: string): void {
  if (!validAppId(marketplace, appId)) {
    throw new IntelligenceError(marketplace === 'apple_app_store'
      ? 'Apple App Store app IDs are numeric.'
      : 'Google Play app IDs look like com.example.app.', { status: 400, code: 'INVALID_APP_ID' });
  }
}

async function getJson(url: string, fetcher?: IntelligenceFetch): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetcher ?? fetch, url, { method: 'GET', redirect: 'follow', headers: { Accept: 'application/json' } }, APP_TIMEOUT_MS);
  if (!response.ok) throw new IntelligenceError('The app store did not return a listing for this request.', { status: 502, code: 'APP_STORE_UNAVAILABLE' });
  const { text } = await readBoundedText(response, APP_MAX_BYTES);
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    throw new IntelligenceError('The app store returned an unreadable response.', { status: 502, code: 'APP_STORE_UNAVAILABLE' });
  }
}

async function getHtml(url: string, fetcher?: IntelligenceFetch): Promise<string | null> {
  const response = await fetchWithTimeout(fetcher ?? fetch, url, {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: 'text/html', 'Accept-Language': 'en;q=0.8', 'User-Agent': 'Mozilla/5.0 (compatible; RoundSEO-Intelligence/1.0)' },
  }, APP_TIMEOUT_MS);
  if (response.status === 404) { await response.body?.cancel().catch(() => undefined); return null; }
  if (!response.ok) throw new IntelligenceError('The app store page could not be read.', { status: 502, code: 'APP_STORE_UNAVAILABLE' });
  const { text } = await readBoundedText(response, APP_MAX_BYTES);
  return text;
}

function metaContent(html: string, property: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attributeValue(match[0], 'property') === property) return decodeEntities(attributeValue(match[0], 'content') || '').trim() || null;
  }
  return null;
}

function arrayOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
