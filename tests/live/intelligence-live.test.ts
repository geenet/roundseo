import { describe, expect, it } from 'vitest';
import { lookupStoreApp, searchStore } from '../../src/worker/intelligence/apps';
import { readIntelligenceConfig } from '../../src/worker/intelligence/config';
import { extractPageContent, inspectPage } from '../../src/worker/intelligence/pages';
import { renderPage, screenshotPage } from '../../src/local/browser-capture';

/**
 * Live checks against public sources. They make real requests, so they run only
 * when ROUNDSEO_LIVE_TESTS=1 is set, for example:
 *   ROUNDSEO_LIVE_TESTS=1 npx vitest run tests/live
 */
const live = process.env.ROUNDSEO_LIVE_TESTS === '1';
const observedAt = new Date().toISOString();
const config = readIntelligenceConfig({});

describe.skipIf(!live)('live public app-store sources', () => {
  it('reads ranked Apple App Store results from the public iTunes API', async () => {
    const apps = await searchStore('apple_app_store', 'habit tracker', 'US', 10);
    expect(apps.length).toBeGreaterThan(0);
    expect(apps.every(app => /^\d+$/.test(app.appId))).toBe(true);
    const listing = await lookupStoreApp('apple_app_store', apps[0].appId, 'US');
    expect(listing?.title).toBeTruthy();
  }, 60_000);

  it('reads Google Play result IDs from the public store search page', async () => {
    const apps = await searchStore('google_play', 'habit tracker', 'US', 10);
    expect(apps.length).toBeGreaterThan(0);
    expect(apps.every(app => /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(app.appId))).toBe(true);
    const listing = await lookupStoreApp('google_play', 'com.duolingo', 'US');
    expect(listing?.title).toMatch(/duolingo/i);
  }, 60_000);
});

describe.skipIf(!live)('live page inspection', () => {
  it('inspects a public page and records native checks against the live HTML', async () => {
    const analysis = await inspectPage('https://example.com/', { renderJavascript: false, config, observedAt });
    expect(analysis.page.title).toBe('Example Domain');
    expect(analysis.page.statusCode).toBe(200);
    expect(analysis.page.renderingMode).toBe('html');
    expect(analysis.page.issues.map(issue => issue.code)).toContain('thin_content');
  }, 60_000);

  it('extracts readable markdown from the live page', async () => {
    const analysis = await extractPageContent('https://example.com/', { renderJavascript: false, config, observedAt });
    expect(analysis.page.contentMarkdown).toContain('Example Domain');
  }, 60_000);
});

describe.skipIf(!live)('live browser runner capture', () => {
  it('renders the live page through the browser runner', async () => {
    const rendered = await renderPage({ url: 'https://example.com/', device: 'desktop', countryCode: 'US', languageCode: 'en' });
    expect(rendered.status).toBe(200);
    expect(rendered.html).toContain('Example Domain');
  }, 120_000);

  it('captures a real PNG screenshot through the browser runner', async () => {
    const shot = await screenshotPage({ url: 'https://example.com/', device: 'mobile', fullPage: true, thumbnail: false });
    const bytes = Buffer.from(shot.base64, 'base64');
    expect(shot.contentType).toBe('image/png');
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  }, 120_000);
});

