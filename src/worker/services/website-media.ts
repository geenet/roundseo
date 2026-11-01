import type { WebsiteMedia, WebsiteMediaItem, WebsiteMediaKind, WebsiteMediaStatus } from '../../shared/website-media';
import { attributeValue, absoluteHttpUrl } from '../intelligence/html';
import type { IntelligenceConfig } from '../intelligence/config';
import { IntelligenceError } from '../intelligence/errors';
import { fetchPublicBytes, fetchPublicPage, fetchWithTimeout, readBoundedText, type IntelligenceFetch } from '../intelligence/http';

export const FAVICON_MAX_BYTES = 256 * 1024;
export const THUMBNAIL_MAX_BYTES = 1024 * 1024;
const MAX_ICON_CANDIDATES = 4;
const RUNNER_TIMEOUT_MS = 60_000;

export interface MediaScope {
  db: any;
  websiteId: string;
  websiteUrl: string;
  config: IntelligenceConfig;
  fetcher?: IntelligenceFetch;
  now?: () => Date;
}

interface StoredRow {
  website_id: string;
  kind: WebsiteMediaKind;
  status: WebsiteMediaStatus;
  storage_key: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
  reason: string | null;
  captured_at: string;
}

/**
 * Icon URLs declared by the homepage, most specific first, then the conventional
 * /favicon.ico. SVG icons are skipped: they are not stored or served from the API origin.
 */
export function extractIconCandidates(html: string, pageUrl: string): string[] {
  const declared: Array<{ href: string; score: number }> = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attributeValue(tag, 'rel') || '').toLowerCase().split(/\s+/);
    const isIcon = rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!isIcon) continue;
    const href = attributeValue(tag, 'href');
    const url = href ? absoluteHttpUrl(href, pageUrl) : null;
    if (!url) continue;
    const type = (attributeValue(tag, 'type') || '').toLowerCase();
    if (type.includes('svg') || /\.svg(?:[?#]|$)/i.test(url)) continue;
    const sizes = /(\d+)x(\d+)/.exec(attributeValue(tag, 'sizes') || '');
    const area = sizes ? Number(sizes[1]) * Number(sizes[2]) : 0;
    declared.push({ href: url, score: (rel.includes('icon') ? 1_000_000 : 0) + Math.min(area, 512 * 512) });
  }
  const ordered = declared.sort((left, right) => right.score - left.score).map(item => item.href);
  ordered.push(new URL('/favicon.ico', pageUrl).href);
  return [...new Set(ordered)].slice(0, MAX_ICON_CANDIDATES);
}

/** Recognize an image by its signature bytes. The declared content type is never trusted alone. */
export function detectImageType(bytes: Uint8Array): { contentType: string; extension: string } | null {
  const startsWith = (signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: 'image/png', extension: 'png' };
  if (startsWith([0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return { contentType: 'image/gif', extension: 'gif' };
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return { contentType: 'image/webp', extension: 'webp' };
  if (startsWith([0x00, 0x00, 0x01, 0x00])) return { contentType: 'image/x-icon', extension: 'ico' };
  return null;
}

/** Width and height from a PNG header (IHDR), or null when the bytes are not a PNG. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || detectImageType(bytes)?.extension !== 'png') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function captureFavicon(scope: MediaScope): Promise<WebsiteMediaItem> {
  const capturedAt = now(scope);
  let page;
  try {
    page = await fetchPublicPage(scope.websiteUrl, { fetcher: scope.fetcher });
  } catch (error) {
    return store(scope, 'favicon', 'failed', capturedAt, { reason: describe(error, 'The site did not respond, so its icon could not be checked.') });
  }
  for (const candidate of extractIconCandidates(page.html, page.url)) {
    let icon;
    try {
      icon = await fetchPublicBytes(candidate, { fetcher: scope.fetcher, maxBytes: FAVICON_MAX_BYTES });
    } catch {
      continue;
    }
    if (icon.status !== 200) continue;
    const type = detectImageType(icon.bytes);
    if (!type) continue;
    if (!scope.config.assetStore) {
      return store(scope, 'favicon', 'unavailable', capturedAt, { reason: 'Icon storage (R2) is not configured on this deployment.' });
    }
    const key = `website-media/${scope.websiteId}/favicon.${type.extension}`;
    await removeFaviconObjects(scope, key);
    await scope.config.assetStore.put(key, icon.bytes, { httpMetadata: { contentType: type.contentType } });
    return store(scope, 'favicon', 'available', capturedAt, { storageKey: key, contentType: type.contentType });
  }
  await removeFaviconObjects(scope);
  return store(scope, 'favicon', 'missing', capturedAt, { reason: 'This site does not declare an icon, and /favicon.ico is not available.' });
}

export async function captureThumbnail(scope: MediaScope): Promise<WebsiteMediaItem> {
  const capturedAt = now(scope);
  if (!scope.config.runner) {
    return store(scope, 'thumbnail', 'unavailable', capturedAt, { reason: 'Page previews need the browser runner, which is not configured on this deployment.' });
  }
  if (!scope.config.assetStore) {
    return store(scope, 'thumbnail', 'unavailable', capturedAt, { reason: 'Preview storage (R2) is not configured on this deployment.' });
  }
  try {
    const response = await fetchWithTimeout(scope.fetcher ?? fetch, `${scope.config.runner.url}/screenshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${scope.config.runner.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url: scope.websiteUrl, device: 'desktop', fullPage: false, thumbnail: true }),
    }, RUNNER_TIMEOUT_MS);
    if (!response.ok) throw new IntelligenceError('The browser runner could not capture a preview.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
    const { text } = await readBoundedText(response, Math.ceil(THUMBNAIL_MAX_BYTES * 1.4));
    const body = JSON.parse(text) as { base64?: unknown };
    const encoded = typeof body.base64 === 'string' ? body.base64 : '';
    if (!/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new IntelligenceError('The browser runner returned no image.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
    const bytes = base64ToBytes(encoded);
    const dimensions = pngDimensions(bytes);
    if (!dimensions) throw new IntelligenceError('The browser runner returned a non-PNG preview.', { status: 502, code: 'INTELLIGENCE_RUNNER_FAILED' });
    if (bytes.byteLength > THUMBNAIL_MAX_BYTES) throw new IntelligenceError('The preview is larger than RoundSEO stores.', { status: 413, code: 'RESOURCE_TOO_LARGE' });
    const key = `website-media/${scope.websiteId}/thumbnail.png`;
    await scope.config.assetStore.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    return store(scope, 'thumbnail', 'available', capturedAt, { storageKey: key, contentType: 'image/png', width: dimensions.width, height: dimensions.height });
  } catch (error) {
    return store(scope, 'thumbnail', 'failed', capturedAt, { reason: describe(error, 'The preview could not be captured.') });
  }
}

/** Capture both media kinds for one website and return the stored state. */
export async function captureWebsiteMedia(scope: MediaScope): Promise<WebsiteMedia> {
  const favicon = await captureFavicon(scope);
  const thumbnail = await captureThumbnail(scope);
  return { websiteId: scope.websiteId, favicon, thumbnail };
}

/** Stored media rows for many websites. Websites never captured have null entries. */
export async function listWebsiteMedia(db: any, websiteIds: string[]): Promise<Map<string, Record<WebsiteMediaKind, StoredRow | null>>> {
  const result = new Map<string, Record<WebsiteMediaKind, StoredRow | null>>();
  for (const id of websiteIds) result.set(id, { favicon: null, thumbnail: null });
  if (websiteIds.length === 0) return result;
  const placeholders = websiteIds.map(() => '?').join(', ');
  const rows = await db.prepare(`SELECT * FROM website_media WHERE website_id IN (${placeholders})`).bind(...websiteIds).all();
  for (const row of (rows?.results ?? rows ?? []) as StoredRow[]) {
    const entry = result.get(row.website_id);
    if (entry) entry[row.kind] = row;
  }
  return result;
}

/** A stored row as the API shape. The signed URL is added by the caller, and only for available images. */
export function mediaItem(row: StoredRow | null, kind: WebsiteMediaKind, url: string | null): WebsiteMediaItem {
  if (!row) return { kind, status: 'missing', url: null, width: null, height: null, capturedAt: null, reason: 'Not captured yet.' };
  return {
    kind,
    status: row.status,
    url: row.status === 'available' ? url : null,
    width: row.width,
    height: row.height,
    capturedAt: row.captured_at,
    reason: row.reason,
  };
}

/** The R2 object key for an available image, or null when the row has no stored bytes. */
export function storedKey(row: StoredRow | null): string | null {
  return row && row.status === 'available' ? row.storage_key : null;
}

async function store(
  scope: MediaScope,
  kind: WebsiteMediaKind,
  status: WebsiteMediaStatus,
  capturedAt: string,
  details: { storageKey?: string; contentType?: string; width?: number; height?: number; reason?: string },
): Promise<WebsiteMediaItem> {
  await scope.db.prepare(`
    INSERT INTO website_media (website_id, kind, status, storage_key, content_type, width, height, source_url, reason, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(website_id, kind) DO UPDATE SET
      status = excluded.status,
      storage_key = excluded.storage_key,
      content_type = excluded.content_type,
      width = excluded.width,
      height = excluded.height,
      source_url = excluded.source_url,
      reason = excluded.reason,
      captured_at = excluded.captured_at
  `).bind(
    scope.websiteId,
    kind,
    status,
    details.storageKey ?? null,
    details.contentType ?? null,
    details.width ?? null,
    details.height ?? null,
    scope.websiteUrl,
    details.reason ?? null,
    capturedAt,
  ).run();
  return {
    kind,
    status,
    url: null,
    width: details.width ?? null,
    height: details.height ?? null,
    capturedAt,
    reason: details.reason ?? null,
  };
}

const FAVICON_EXTENSIONS = ['png', 'jpg', 'gif', 'webp', 'ico'];

/** Delete favicon bytes stored under any extension except the one being kept, so R2 holds only what is shown. */
async function removeFaviconObjects(scope: MediaScope, keep?: string): Promise<void> {
  if (!scope.config.assetStore) return;
  for (const extension of FAVICON_EXTENSIONS) {
    const key = `website-media/${scope.websiteId}/favicon.${extension}`;
    if (key !== keep) await scope.config.assetStore.delete(key).catch(() => undefined);
  }
}

function now(scope: MediaScope): string {
  return (scope.now ? scope.now() : new Date()).toISOString();
}

function describe(error: unknown, fallback: string): string {
  return error instanceof IntelligenceError ? error.message : fallback;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
