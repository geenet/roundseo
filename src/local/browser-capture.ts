import { lookup } from 'node:dns/promises';
import type { BrowserContext, Page } from 'playwright';
import { isPublicCrawlUrl } from '../worker/crawlers/base';
import { isPublicAddress } from './browser-performance';

/**
 * Browser capture for RoundSEO Intelligence: rendered page HTML for rendered
 * extraction and SERP collection, and PNG screenshots. Every browser request is
 * checked against the public-URL policy, including redirects and subresources,
 * so the runner cannot be pointed at private networks.
 */
export type CaptureDevice = 'desktop' | 'mobile' | 'tablet';

export interface RenderRequest {
  url: string;
  device: CaptureDevice;
  countryCode: string | null;
  languageCode: string | null;
}

export interface ScreenshotRequest {
  url: string;
  device: CaptureDevice;
  fullPage: boolean;
  /** Small preview: a fixed 1280x800 viewport captured at half scale, for lists and cards. */
  thumbnail: boolean;
}

export interface RenderResult {
  finalUrl: string;
  status: number;
  html: string;
}

export interface ScreenshotResult {
  finalUrl: string;
  base64: string;
  contentType: 'image/png';
}

const MAX_HTML_CHARACTERS = 3 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

/** Validate a capture request body. Returns a message describing the first problem, or null. */
export function captureRequestProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'Send a JSON object with a public URL.';
  const input = value as Record<string, unknown>;
  if (typeof input.url !== 'string' || !isPublicCrawlUrl(input.url)) return 'Provide a public HTTP or HTTPS URL.';
  if (input.device !== undefined && !['desktop', 'mobile', 'tablet'].includes(String(input.device))) return 'Choose desktop, mobile, or tablet.';
  if (input.countryCode !== undefined && input.countryCode !== null && !/^[A-Za-z]{2}$/.test(String(input.countryCode))) return 'countryCode must be a two-letter code.';
  if (input.languageCode !== undefined && input.languageCode !== null && !/^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(String(input.languageCode))) return 'languageCode must be a language code.';
  if (input.fullPage !== undefined && typeof input.fullPage !== 'boolean') return 'fullPage must be true or false.';
  if (input.thumbnail !== undefined && typeof input.thumbnail !== 'boolean') return 'thumbnail must be true or false.';
  return null;
}

export function parseRenderRequest(value: Record<string, unknown>): RenderRequest {
  return {
    url: String(value.url),
    device: (value.device as CaptureDevice | undefined) ?? 'desktop',
    countryCode: typeof value.countryCode === 'string' ? value.countryCode.toUpperCase() : null,
    languageCode: typeof value.languageCode === 'string' ? value.languageCode.toLowerCase() : null,
  };
}

export function parseScreenshotRequest(value: Record<string, unknown>): ScreenshotRequest {
  return {
    url: String(value.url),
    device: (value.device as CaptureDevice | undefined) ?? 'desktop',
    fullPage: value.fullPage !== false,
    thumbnail: value.thumbnail === true,
  };
}

export async function renderPage(input: RenderRequest): Promise<RenderResult> {
  return withPage(input, async page => {
    const html = await page.content();
    return { finalUrl: page.url(), status: 200, html: html.slice(0, MAX_HTML_CHARACTERS) };
  }, input.url);
}

export async function screenshotPage(input: ScreenshotRequest): Promise<ScreenshotResult> {
  return withPage({ device: input.device, countryCode: null, languageCode: null, thumbnail: input.thumbnail }, async page => {
    const bytes = await page.screenshot({ type: 'png', fullPage: input.fullPage });
    if (bytes.byteLength > MAX_SCREENSHOT_BYTES) throw new Error('The screenshot is larger than RoundSEO accepts.');
    return { finalUrl: page.url(), base64: Buffer.from(bytes).toString('base64'), contentType: 'image/png' as const };
  }, input.url);
}

async function withPage<T>(
  input: { device: CaptureDevice; countryCode: string | null; languageCode: string | null; thumbnail?: boolean },
  work: (page: Page) => Promise<T>,
  targetUrl: string,
): Promise<T> {
  const { chromium, devices } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const locale = input.languageCode && input.countryCode ? `${input.languageCode}-${input.countryCode}` : input.languageCode ?? undefined;
    const context = await browser.newContext(contextOptions(input.device, devices, locale, input.thumbnail === true));
    try {
      await guardRequests(context, targetUrl);
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      return await work(page);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

type Devices = Awaited<typeof import('playwright')>['devices'];

function contextOptions(device: CaptureDevice, devices: Devices, locale: string | undefined, thumbnail: boolean) {
  const base = thumbnail ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.5 }
    : device === 'mobile' ? devices['Pixel 7']
      : device === 'tablet' ? devices['iPad (gen 7)']
        : { viewport: { width: 1365, height: 900 } };
  return { ...base, ...(locale ? { locale } : {}), serviceWorkers: 'block' as const };
}

/** Abort any request that is not public, and any navigation that leaves the target's host. */
async function guardRequests(context: BrowserContext, targetUrl: string): Promise<void> {
  const dnsChecks = new Map<string, Promise<boolean>>();
  const publicHost = (hostname: string): Promise<boolean> => {
    if (!dnsChecks.has(hostname)) {
      dnsChecks.set(hostname, lookup(hostname, { all: true, verbatim: true })
        .then(addresses => addresses.length > 0 && addresses.every(item => isPublicAddress(item.address)))
        .catch(() => false));
    }
    return dnsChecks.get(hostname)!;
  };
  await context.route('**/*', async route => {
    const requestUrl = route.request().url();
    let parsed: URL;
    try { parsed = new URL(requestUrl); } catch { await route.abort(); return; }
    const navigation = route.request().isNavigationRequest();
    if (!isPublicCrawlUrl(requestUrl) || (navigation && !sameHost(requestUrl, targetUrl)) || !await publicHost(parsed.hostname)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

function sameHost(value: string, target: string): boolean {
  const normalise = (host: string) => host.toLowerCase().replace(/^www\./, '');
  return normalise(new URL(value).hostname) === normalise(new URL(target).hostname);
}
