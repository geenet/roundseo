import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeRequest } from '../../src/worker/api/router';
import { createToken } from '../../src/worker/auth/jwt';
import { readIntelligenceConfig } from '../../src/worker/intelligence/config';
import { assetSignature } from '../../src/worker/services/signed-assets';
import { captureFavicon, captureThumbnail, detectImageType, extractIconCandidates, FAVICON_MAX_BYTES, pngDimensions, type MediaScope } from '../../src/worker/services/website-media';
import { d1, migratedDatabase, seedWorkspace } from './helpers/intelligence-db';

const SECRET = 'test-only-signing-secret-with-at-least-32-bytes';
const ORIGIN = 'https://api.example.test';
const RUNNER_URL = 'https://runner.example.test';
const RUNNER_TOKEN = 'runner-token-for-media-tests-0123456789';
const ONE_BY_ONE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ICO = Buffer.from('000001000100101000000000', 'hex');

function bytesResponse(body: Uint8Array | string, contentType: string, status = 200): Response {
  return new Response(body as BodyInit, { status, headers: { 'content-type': contentType } });
}

function page(head: string): Response {
  return bytesResponse(`<html><head>${head}</head><body><h1>Example</h1></body></html>`, 'text/html; charset=utf-8');
}

/** An in-memory R2 bucket with the three operations the media code uses. */
function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    put: async (key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string } }) => { objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata.contentType }); },
    get: async (key: string) => objects.has(key) ? { body: new Response(objects.get(key)!.bytes.slice().buffer).body } : null,
    delete: async (key: string) => { objects.delete(key); },
  };
}

let database: Database.Database;
let db: ReturnType<typeof d1>;

beforeEach(() => {
  database = migratedDatabase();
  seedWorkspace(database);
  db = d1(database);
});

afterEach(() => {
  vi.unstubAllGlobals();
  database.close();
});

describe('favicon discovery', () => {
  it('prefers declared icons by specificity and size, resolves relative links, and falls back to /favicon.ico', () => {
    const html = [
      '<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">',
      '<link rel="icon" sizes="16x16" href="icons/16.png">',
      '<link rel="shortcut icon" sizes="64x64" href="https://cdn.example.com/64.png">',
      '<link rel="icon" href="/vector.svg">',
      '<link rel="stylesheet" href="/site.css">',
    ].join('');
    expect(extractIconCandidates(html, 'https://example.com/en/')).toEqual([
      'https://cdn.example.com/64.png',
      'https://example.com/en/icons/16.png',
      'https://example.com/touch.png',
      'https://example.com/favicon.ico',
    ]);
  });

  it('never selects SVG icons, which are not stored or served from the API origin', () => {
    expect(extractIconCandidates('<link rel="icon" type="image/svg+xml" href="/logo.svg">', 'https://example.com/')).toEqual(['https://example.com/favicon.ico']);
  });

  it('recognizes images by their signature bytes and never by a declared type alone', () => {
    expect(detectImageType(ONE_BY_ONE_PNG)?.contentType).toBe('image/png');
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.contentType).toBe('image/jpeg');
    expect(detectImageType(Buffer.from('GIF89a'))?.contentType).toBe('image/gif');
    expect(detectImageType(ICO)?.contentType).toBe('image/x-icon');
    expect(detectImageType(Buffer.from('<html>not an image</html>'))).toBeNull();
  });

  it('reads PNG dimensions from the header', () => {
    expect(pngDimensions(ONE_BY_ONE_PNG)).toEqual({ width: 1, height: 1 });
    expect(pngDimensions(Buffer.from('<svg/>'))).toBeNull();
  });
});

function scope(overrides: Partial<MediaScope> = {}): MediaScope {
  return {
    db,
    websiteId: 'site-1',
    websiteUrl: 'https://example.com/',
    config: readIntelligenceConfig({ INTELLIGENCE_ASSET_SECRET: SECRET, R2: memoryBucket() as unknown as R2Bucket }),
    now: () => new Date('2026-11-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('favicon capture', () => {
  it('stores a declared PNG icon in R2 and records it as available', async () => {
    const bucket = memoryBucket();
    const fetcher = async (input: string) => input === 'https://example.com/'
      ? page('<link rel="icon" href="/icon.png">')
      : bytesResponse(ONE_BY_ONE_PNG, 'image/png');
    const item = await captureFavicon(scope({ config: readIntelligenceConfig({ INTELLIGENCE_ASSET_SECRET: SECRET, R2: bucket as unknown as R2Bucket }), fetcher }));
    expect(item).toMatchObject({ kind: 'favicon', status: 'available', capturedAt: '2026-11-01T12:00:00.000Z' });
    expect(bucket.objects.get('website-media/site-1/favicon.png')?.contentType).toBe('image/png');
    expect(await db.prepare('SELECT status, storage_key FROM website_media WHERE website_id = ? AND kind = ?').bind('site-1', 'favicon').first())
      .toEqual({ status: 'available', storage_key: 'website-media/site-1/favicon.png' });
  });

  it('reports a site without any icon as missing, with the reason, and removes stale bytes', async () => {
    const bucket = memoryBucket();
    bucket.objects.set('website-media/site-1/favicon.png', { bytes: ONE_BY_ONE_PNG, contentType: 'image/png' });
    const item = await captureFavicon(scope({
      config: readIntelligenceConfig({ INTELLIGENCE_ASSET_SECRET: SECRET, R2: bucket as unknown as R2Bucket }),
      fetcher: async input => input === 'https://example.com/' ? page('') : bytesResponse('not found', 'text/plain', 404),
    }));
    expect(item).toMatchObject({ status: 'missing', reason: 'This site does not declare an icon, and /favicon.ico is not available.' });
    expect(bucket.objects.has('website-media/site-1/favicon.png')).toBe(false);
  });

  it('skips a candidate whose bytes do not match an image, and uses the next one', async () => {
    const item = await captureFavicon(scope({
      fetcher: async input => {
        if (input === 'https://example.com/') return page('<link rel="icon" href="/fake.png"><link rel="icon" href="/real.ico" sizes="32x32">');
        if (input === 'https://example.com/fake.png') return bytesResponse('<html>blocked</html>', 'image/png');
        if (input === 'https://example.com/real.ico') return bytesResponse(ICO, 'image/x-icon');
        return bytesResponse('', 'text/plain', 404);
      },
    }));
    expect(item).toMatchObject({ status: 'available' });
  });

  it('refuses icons larger than the storage limit rather than truncating them', async () => {
    const item = await captureFavicon(scope({
      fetcher: async input => input === 'https://example.com/'
        ? page('<link rel="icon" href="/huge.png">')
        : bytesResponse(new Uint8Array(FAVICON_MAX_BYTES + 1), 'image/png'),
    }));
    expect(item.status).toBe('missing');
  });

  it('reports a site that does not respond as failed, with a plain reason', async () => {
    const item = await captureFavicon(scope({ fetcher: async () => { throw new Error('network down'); } }));
    expect(item.status).toBe('failed');
    expect(item.reason).toMatch(/could not be reached|did not respond/);
  });
});

describe('preview capture', () => {
  it('reports previews as unavailable with the reason when the browser runner is not configured', async () => {
    const item = await captureThumbnail(scope());
    expect(item).toMatchObject({ kind: 'thumbnail', status: 'unavailable', reason: 'Page previews need the browser runner, which is not configured on this deployment.' });
  });

  it('stores a runner PNG with its dimensions, and asks the runner for the small preview mode', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const item = await captureThumbnail(scope({
      config: readIntelligenceConfig({ INTELLIGENCE_ASSET_SECRET: SECRET, R2: memoryBucket() as unknown as R2Bucket, ROUNDSEO_PERFORMANCE_RUNNER_URL: RUNNER_URL, ROUNDSEO_RUNNER_TOKEN: RUNNER_TOKEN }),
      fetcher: async (input, init) => {
        calls.push({ url: input, body: String(init?.body) });
        return Response.json({ base64: ONE_BY_ONE_PNG.toString('base64') });
      },
    }));
    expect(item).toMatchObject({ status: 'available', width: 1, height: 1 });
    expect(calls[0].url).toBe(`${RUNNER_URL}/screenshot`);
    expect(JSON.parse(calls[0].body)).toMatchObject({ device: 'desktop', fullPage: false, thumbnail: true });
  });

  it('records a runner response that is not a PNG as failed', async () => {
    const item = await captureThumbnail(scope({
      config: readIntelligenceConfig({ INTELLIGENCE_ASSET_SECRET: SECRET, R2: memoryBucket() as unknown as R2Bucket, ROUNDSEO_PERFORMANCE_RUNNER_URL: RUNNER_URL, ROUNDSEO_RUNNER_TOKEN: RUNNER_TOKEN }),
      fetcher: async () => Response.json({ base64: Buffer.from('<html/>').toString('base64') }),
    }));
    expect(item).toMatchObject({ status: 'failed', reason: 'The browser runner returned a non-PNG preview.' });
  });
});

describe('website media routes', () => {
  async function authorization(userId: string, email: string) {
    return `Bearer ${await createToken({ userId, email }, SECRET)}`;
  }

  function env(bucket: ReturnType<typeof memoryBucket>) {
    return { JWT_SECRET: SECRET, DB: db, INTELLIGENCE_ASSET_SECRET: SECRET, R2: bucket, ROUNDSEO_PERFORMANCE_RUNNER_URL: RUNNER_URL, ROUNDSEO_RUNNER_TOKEN: RUNNER_TOKEN };
  }

  function stubSite(): void {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${RUNNER_URL}/screenshot`) return Response.json({ base64: ONE_BY_ONE_PNG.toString('base64') });
      if (url === 'https://example.com/') return page('<link rel="icon" href="/icon.png">');
      if (url === 'https://example.com/icon.png') return bytesResponse(ONE_BY_ONE_PNG, 'image/png');
      void init;
      return bytesResponse('', 'text/plain', 404);
    }));
  }

  it('lists each organization website with signed URLs only for images that exist', async () => {
    stubSite();
    const bucket = memoryBucket();
    const owner = await authorization('user-owner', 'owner@example.test');
    const refresh = await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-1/media/refresh`, { method: 'POST', headers: { Authorization: owner } }), db, env(bucket));
    expect(refresh?.status).toBe(200);
    const listed = await routeRequest(new Request(`${ORIGIN}/api/v2/organizations/org-1/website-media`, { headers: { Authorization: owner } }), db, env(bucket));
    const body = await listed?.json() as { media: Array<{ websiteId: string; favicon: { status: string; url: string | null }; thumbnail: { status: string; url: string | null } }> };
    const site1 = body.media.find(item => item.websiteId === 'site-1');
    const site2 = body.media.find(item => item.websiteId === 'site-2');
    expect(site1?.favicon).toMatchObject({ status: 'available' });
    expect(site1?.favicon.url).toMatch(/\/api\/v2\/websites\/site-1\/media\/favicon\?expires=\d+&sig=[a-f0-9]{64}$/);
    expect(site2?.favicon).toMatchObject({ status: 'missing', url: null });
  });

  it('refuses media listings to users outside the organization', async () => {
    const response = await routeRequest(new Request(`${ORIGIN}/api/v2/organizations/org-1/website-media`, { headers: { Authorization: await authorization('user-outsider', 'outsider@example.test') } }), db, env(memoryBucket()));
    expect(response?.status).toBe(404);
  });

  it('lets a client-role member read previews but not refresh them', async () => {
    const client = await authorization('user-client', 'client@example.test');
    const read = await routeRequest(new Request(`${ORIGIN}/api/v2/organizations/org-1/website-media`, { headers: { Authorization: client } }), db, env(memoryBucket()));
    expect(read?.status).toBe(200);
    const refresh = await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-1/media/refresh`, { method: 'POST', headers: { Authorization: client } }), db, env(memoryBucket()));
    expect(refresh?.status).toBe(403);
    expect(await refresh?.json()).toMatchObject({ code: 'WEBSITE_ROLE_REQUIRED' });
  });

  it('serves stored images only through a valid, unexpired signature for the same website and purpose', async () => {
    stubSite();
    const bucket = memoryBucket();
    const owner = await authorization('user-owner', 'owner@example.test');
    await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-1/media/refresh`, { method: 'POST', headers: { Authorization: owner } }), db, env(bucket));
    const listed = await (await routeRequest(new Request(`${ORIGIN}/api/v2/organizations/org-1/website-media`, { headers: { Authorization: owner } }), db, env(bucket)))?.json() as { media: Array<{ websiteId: string; favicon: { url: string } }> };
    const url = new URL(listed.media.find(item => item.websiteId === 'site-1')!.favicon.url);

    const served = await routeRequest(new Request(url.href), db, env(bucket));
    expect(served?.status).toBe(200);
    expect(served?.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served!.arrayBuffer()).equals(ONE_BY_ONE_PNG)).toBe(true);

    const expires = url.searchParams.get('expires')!;
    const crossPurpose = await assetSignature(SECRET, 'intelligence-asset', 'site-1', 'favicon', Number(expires));
    const replay = await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-1/media/favicon?expires=${expires}&sig=${crossPurpose}`), db, env(bucket));
    expect(replay?.status).toBe(404);
    const expired = await routeRequest(new Request(`${ORIGIN}/api/v2/websites/site-1/media/favicon?expires=1&sig=${url.searchParams.get('sig')}`), db, env(bucket));
    expect(expired?.status).toBe(404);
  });
});
