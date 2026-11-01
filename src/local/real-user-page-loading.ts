import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Browser, BrowserContext, Page } from 'playwright';
import type {
  PerformanceDevice,
  PerformanceDeviceResult,
  PerformanceMetric,
  PerformanceResource,
  RealUserDeliveryHost,
  RealUserLoadStructure,
  RealUserPageLoadingAudit,
  RealUserPageLoadingLink,
  RealUserPageLoadingPage,
} from '../shared/operating-model';
import { isPublicCrawlUrl } from '../worker/crawlers/base';

const MAX_LINKED_PAGES = 10;
const ASSET_PATH = /\.(?:pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|xml)(?:$|[?#])/i;

export type RealUserPageLoadingProgress = {
  phase: 'discovering' | 'measuring';
  completedPages: number;
  totalPages: number;
  currentUrl?: string;
};

export type LandingLinkCandidate = {
  href: string;
  text: string;
  placement: RealUserPageLoadingLink['placement'];
};

type BrowserValues = {
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  blocking: number | null;
};

type CapturedResource = PerformanceResource & {
  started?: number;
};

type DeviceMeasurement = {
  result: PerformanceDeviceResult;
  structure?: RealUserLoadStructure;
};

/**
 * Selects actual same-site links from a rendered landing page. Main-content
 * links come first; navigation, other body links and footer links fill the
 * remaining slots. It intentionally never manufactures missing pages.
 */
export function selectRealUserPageLinks(landingUrl: string, candidates: LandingLinkCandidate[], limit = MAX_LINKED_PAGES): RealUserPageLoadingLink[] {
  const safeLimit = Math.max(0, Math.min(MAX_LINKED_PAGES, Math.floor(limit)));
  let landing: URL;
  try { landing = new URL(landingUrl); } catch { return []; }
  const deduped = new Map<string, { link: RealUserPageLoadingLink; rank: number; index: number }>();
  const placementRank: Record<RealUserPageLoadingLink['placement'], number> = { main: 0, header: 1, other: 2, footer: 3 };

  candidates.forEach((candidate, index) => {
    let url: URL;
    try { url = new URL(candidate.href, landing); } catch { return; }
    url.hash = '';
    if (!isPublicCrawlUrl(url.href, landing.href) || ASSET_PATH.test(url.href) || url.href === landing.href) return;
    const text = candidate.text.replace(/\s+/g, ' ').trim() || 'Unlabelled link';
    const link: RealUserPageLoadingLink = { url: url.href, text: text.slice(0, 180), placement: candidate.placement };
    const key = normalisedUrlKey(url);
    const existing = deduped.get(key);
    const rank = placementRank[candidate.placement];
    if (!existing || rank < existing.rank) deduped.set(key, { link, rank, index });
  });

  return [...deduped.values()]
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, safeLimit)
    .map(item => item.link);
}

/** Groups live response observations by delivery hostname without guessing a CDN vendor. */
export function summarizeDeliveryHosts(resources: PerformanceResource[], firstPartyHostname: string): RealUserDeliveryHost[] {
  const firstParty = normaliseHostname(firstPartyHostname);
  const byHost = new Map<string, { requests: number; transferredBytes: number; cacheControl: Set<string>; cacheStatus: Set<string>; age: Set<string> }>();
  for (const resource of resources) {
    const hostname = resource.hostname || hostnameFor(resource.url);
    if (!hostname) continue;
    const current = byHost.get(hostname) || { requests: 0, transferredBytes: 0, cacheControl: new Set<string>(), cacheStatus: new Set<string>(), age: new Set<string>() };
    current.requests += 1;
    current.transferredBytes += resource.transferredBytes || 0;
    if (resource.cacheControl) current.cacheControl.add(resource.cacheControl);
    if (resource.cacheStatus) current.cacheStatus.add(resource.cacheStatus);
    if (resource.age) current.age.add(resource.age);
    byHost.set(hostname, current);
  }
  return [...byHost.entries()]
    .map(([hostname, value]) => ({
      hostname,
      firstParty: normaliseHostname(hostname) === firstParty,
      requests: value.requests,
      transferredBytes: value.transferredBytes,
      cacheControl: [...value.cacheControl].slice(0, 3),
      cacheStatus: [...value.cacheStatus].slice(0, 3),
      age: [...value.age].slice(0, 3),
    }))
    .sort((left, right) => right.transferredBytes - left.transferredBytes || right.requests - left.requests || left.hostname.localeCompare(right.hostname));
}

/**
 * Replays a cold visitor path: the landing page plus up to ten same-site links
 * found in its live DOM. This is browser evidence, not real-user/RUM data.
 */
export async function measureRealUserPageLoading(
  targetUrl: string,
  options: { maxLinkedPages?: number; onProgress?: (progress: RealUserPageLoadingProgress) => void } = {},
): Promise<RealUserPageLoadingAudit> {
  const fetchedAt = new Date().toISOString();
  const requestedLinkedPages = Math.max(0, Math.min(MAX_LINKED_PAGES, Math.floor(options.maxLinkedPages ?? MAX_LINKED_PAGES)));
  const sourceNote = 'RoundSEO opens the landing page, takes up to ten eligible same-site links from its live DOM (main-content links first), and loads each page in fresh Chromium contexts. Cache is disabled and service workers are blocked to keep this cold-load replay comparable. It is controlled browser evidence, not aggregated visitor/RUM telemetry, so it cannot report field Core Web Vitals or interaction latency.';
  const fallbackLanding = canonicalUrl(targetUrl) || targetUrl;
  let browser: Browser | undefined;
  try {
    if (!isPublicCrawlUrl(targetUrl)) throw new Error('Only public HTTP or HTTPS websites can be measured.');
    const { chromium, devices: browserDevices } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const publicHost = createPublicHostCheck();
    const target = new URL(targetUrl);
    if (!await publicHost(target.hostname)) throw new Error('That website does not resolve to a public address.');

    options.onProgress?.({ phase: 'discovering', completedPages: 0, totalPages: 1, currentUrl: targetUrl });
    const discovery = await discoverLandingPage(browser, browserDevices, targetUrl, publicHost);
    const eligibleLinks = selectRealUserPageLinks(discovery.landingUrl, discovery.candidates, MAX_LINKED_PAGES);
    const selectedLinks = eligibleLinks.slice(0, requestedLinkedPages);
    const requestedPages: Array<{ url: string; role: RealUserPageLoadingPage['role']; link?: RealUserPageLoadingLink }> = [
      { url: discovery.landingUrl, role: 'landing' },
      ...selectedLinks.map(link => ({ url: link.url, role: 'linked' as const, link })),
    ];
    const pages: RealUserPageLoadingPage[] = [];

    for (const [index, requested] of requestedPages.entries()) {
      options.onProgress?.({ phase: 'measuring', completedPages: index, totalPages: requestedPages.length, currentUrl: requested.url });
      pages.push(await measureVisitorPathPage(browser, browserDevices, requested, publicHost, fetchedAt));
      options.onProgress?.({ phase: 'measuring', completedPages: index + 1, totalPages: requestedPages.length, currentUrl: requested.url });
    }

    const measuredPages = pages.filter(page => page.availability === 'measured' || page.availability === 'partial');
    return {
      targetUrl,
      landingUrl: discovery.landingUrl,
      availability: measuredPages.length === pages.length ? 'measured' : measuredPages.length ? 'partial' : 'failed',
      fetchedAt,
      methodVersion: 'roundseo-visitor-path-browser-2026.10.31',
      requestedLinkedPages,
      eligibleLinkedPages: eligibleLinks.length,
      pages,
      error: measuredPages.length ? undefined : pages.map(page => page.error).filter(Boolean).join(' ') || 'The browser did not return usable page-load timings.',
      sourceNote,
    };
  } catch (error) {
    return {
      targetUrl,
      landingUrl: fallbackLanding,
      availability: 'failed',
      fetchedAt,
      methodVersion: 'roundseo-visitor-path-browser-2026.10.31',
      requestedLinkedPages,
      eligibleLinkedPages: 0,
      pages: [],
      error: error instanceof Error ? error.message : 'The real user page-loading replay could not be started.',
      sourceNote,
    };
  } finally {
    await browser?.close();
  }
}

async function discoverLandingPage(
  browser: Browser,
  browserDevices: typeof import('playwright').devices,
  targetUrl: string,
  publicHost: (hostname: string) => Promise<boolean>,
): Promise<{ landingUrl: string; candidates: LandingLinkCandidate[] }> {
  const context = await createColdContext(browser, browserDevices, 'desktop');
  try {
    await installPublicNetworkGuard(context, targetUrl, publicHost);
    const page = await context.newPage();
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!response || response.status() >= 400) throw new Error(response ? `HTTP ${response.status()} while opening the landing page.` : 'The browser did not receive a landing-page response.');
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    const landingUrl = canonicalUrl(page.url());
    if (!landingUrl || !isPublicCrawlUrl(landingUrl, targetUrl)) throw new Error('The landing page navigated outside the website scope.');
    return { landingUrl, candidates: await collectLandingCandidates(page) };
  } finally {
    await context.close();
  }
}

async function measureVisitorPathPage(
  browser: Browser,
  browserDevices: typeof import('playwright').devices,
  requested: { url: string; role: RealUserPageLoadingPage['role']; link?: RealUserPageLoadingLink },
  publicHost: (hostname: string) => Promise<boolean>,
  fetchedAt: string,
): Promise<RealUserPageLoadingPage> {
  const mobile = await measureColdDevice(browser, browserDevices, requested.url, 'mobile', publicHost, fetchedAt);
  const desktop = await measureColdDevice(browser, browserDevices, requested.url, 'desktop', publicHost, fetchedAt);
  const devices = [mobile.result, desktop.result];
  const usable = devices.filter(device => device.availability === 'measured' || device.availability === 'partial');
  const structureMeasurement = mobile.structure ? mobile : desktop.structure ? desktop : undefined;
  return {
    url: requested.url,
    role: requested.role,
    discoveredFrom: requested.link,
    availability: usable.length === devices.length ? 'measured' : usable.length ? 'partial' : 'failed',
    fetchedAt,
    devices,
    loadStructure: structureMeasurement?.structure,
    loadStructureDevice: structureMeasurement?.result.device,
    error: usable.length ? undefined : devices.map(device => device.error).filter(Boolean).join(' ') || 'No usable browser timings were returned for this page.',
  };
}

async function measureColdDevice(
  browser: Browser,
  browserDevices: typeof import('playwright').devices,
  targetUrl: string,
  device: PerformanceDevice,
  publicHost: (hostname: string) => Promise<boolean>,
  fetchedAt: string,
): Promise<DeviceMeasurement> {
  const context = await createColdContext(browser, browserDevices, device);
  try {
    await installPublicNetworkGuard(context, targetUrl, publicHost);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const observed = new Map<string, CapturedResource>();
    let firstRequestTimestamp: number | undefined;
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (device === 'mobile') {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
    }
    cdp.on('Network.requestWillBeSent', event => {
      if (observed.has(event.requestId)) return;
      firstRequestTimestamp ??= event.timestamp;
      observed.set(event.requestId, {
        url: event.request.url,
        kind: event.type || 'Other',
        status: 0,
        transferredBytes: null,
        sequence: observed.size + 1,
        started: event.timestamp,
        initiator: event.initiator?.type || undefined,
      });
    });
    cdp.on('Network.responseReceived', event => {
      const item = observed.get(event.requestId);
      if (!item) return;
      item.url = event.response.url;
      item.kind = event.type;
      item.status = event.response.status;
      item.hostname = hostnameFor(event.response.url) || undefined;
      item.cacheControl = responseHeader(event.response.headers, 'cache-control');
      item.cacheStatus = responseHeader(event.response.headers, 'cf-cache-status') || responseHeader(event.response.headers, 'x-cache') || responseHeader(event.response.headers, 'x-cache-status');
      item.age = responseHeader(event.response.headers, 'age');
      item.contentEncoding = responseHeader(event.response.headers, 'content-encoding');
    });
    cdp.on('Network.loadingFinished', event => {
      const item = observed.get(event.requestId);
      if (!item) return;
      item.transferredBytes = event.encodedDataLength;
      if (item.started !== undefined) item.durationMs = Math.max(0, Math.round((event.timestamp - item.started) * 1_000));
    });
    await installPerformanceObservers(page);
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!response || response.status() >= 400) throw new Error(response ? `HTTP ${response.status()} while opening the page.` : 'The browser did not receive a page response.');
    const loaded = await page.waitForLoadState('load', { timeout: 15_000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(2_000);
    const values = await collectPerformanceValues(page);
    const pageHostname = hostnameFor(page.url()) || hostnameFor(targetUrl);
    const resources = [...observed.values()]
      .filter(item => item.status > 0 && /^https?:/i.test(item.url))
      .map(item => ({
        ...item,
        startedAtMs: item.started !== undefined && firstRequestTimestamp !== undefined ? Math.max(0, Math.round((item.started - firstRequestTimestamp) * 1_000)) : undefined,
        hostname: item.hostname || hostnameFor(item.url) || undefined,
        thirdParty: pageHostname ? normaliseHostname(item.hostname || hostnameFor(item.url) || '') !== normaliseHostname(pageHostname) : undefined,
      }));
    const labMetrics = browserMetrics(values);
    const profile = device === 'mobile'
      ? 'Fresh mobile browser · Pixel 7 viewport · 4× CPU slowdown · 1.6 Mbps download · 150 ms latency'
      : 'Fresh desktop browser · 1365 × 768 viewport · local connection and CPU';
    const result: PerformanceDeviceResult = {
      device,
      availability: labMetrics.length ? 'partial' : 'not_measured',
      labScore: null,
      labMetrics,
      fieldMetrics: [],
      fieldDataAvailability: 'not_measured',
      fieldDataScope: 'none',
      opportunities: [],
      fetchedAt,
      resources: [...resources].sort((left, right) => (right.transferredBytes || 0) - (left.transferredBytes || 0)).slice(0, 50).map(stripCapturedResource),
      loadSequence: [...resources].sort((left, right) => (left.sequence || 0) - (right.sequence || 0)).slice(0, 40).map(stripCapturedResource),
      requests: resources.length,
      transferredBytes: resources.reduce((total, resource) => total + (resource.transferredBytes || 0), 0),
      profile,
      error: !labMetrics.length ? 'This browser did not expose usable timing measurements.' : loaded ? undefined : 'The page did not finish loading before the sampling deadline; results may be incomplete.',
    };
    return {
      result,
      structure: {
        ...(await collectLoadStructure(page, pageHostname || '')),
        deliveryHosts: summarizeDeliveryHosts(resources, pageHostname || ''),
      },
    };
  } catch (error) {
    return {
      result: {
        device,
        availability: 'failed',
        labScore: null,
        labMetrics: [],
        fieldMetrics: [],
        fieldDataAvailability: 'not_measured',
        fieldDataScope: 'none',
        opportunities: [],
        fetchedAt,
        error: error instanceof Error ? error.message : 'Browser measurement failed.',
      },
    };
  } finally {
    await context.close();
  }
}

async function createColdContext(browser: Browser, browserDevices: typeof import('playwright').devices, device: PerformanceDevice): Promise<BrowserContext> {
  return browser.newContext(device === 'mobile'
    ? { ...browserDevices['Pixel 7'], serviceWorkers: 'block' }
    : { viewport: { width: 1365, height: 768 }, serviceWorkers: 'block' });
}

async function installPublicNetworkGuard(context: BrowserContext, baseUrl: string, publicHost: (hostname: string) => Promise<boolean>): Promise<void> {
  await context.route('**/*', async route => {
    const requestUrl = route.request().url();
    let parsed: URL;
    try { parsed = new URL(requestUrl); } catch { await route.abort(); return; }
    const navigationOutOfScope = route.request().isNavigationRequest() && !isPublicCrawlUrl(requestUrl, baseUrl);
    if (!isPublicCrawlUrl(requestUrl) || navigationOutOfScope || !await publicHost(parsed.hostname)) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function collectLandingCandidates(page: Page): Promise<LandingLinkCandidate[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(anchor => {
    const style = window.getComputedStyle(anchor);
    return anchor.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }).map(anchor => {
    const placement = anchor.closest('main, [role="main"], article') ? 'main'
      : anchor.closest('header, nav, [role="navigation"]') ? 'header'
        : anchor.closest('footer, [role="contentinfo"]') ? 'footer'
          : 'other';
    return { href: anchor.href, text: anchor.textContent || anchor.getAttribute('aria-label') || anchor.title || '', placement };
  }));
}

async function installPerformanceObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { lcp: null as number | null, cls: 0, clsAvailable: false, longTasks: [] as Array<{ start: number; duration: number }>, longTaskAvailable: false };
    let sessionStart = -1;
    let previousShift = -1;
    let sessionScore = 0;
    (window as typeof window & { __roundseoVisitorPath?: typeof state }).__roundseoVisitorPath = state;
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* The browser did not expose LCP. */ }
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
          if (entry.hadRecentInput) continue;
          if (previousShift < 0 || entry.startTime - previousShift > 1_000 || entry.startTime - sessionStart > 5_000) { sessionStart = entry.startTime; sessionScore = 0; }
          sessionScore += entry.value || 0;
          previousShift = entry.startTime;
          state.cls = Math.max(state.cls, sessionScore);
        }
      }).observe({ type: 'layout-shift', buffered: true });
      state.clsAvailable = true;
    } catch { /* The browser did not expose layout shifts. */ }
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
      state.longTaskAvailable = true;
    } catch { /* The browser did not expose long tasks. */ }
  });
}

async function collectPerformanceValues(page: Page): Promise<BrowserValues> {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName('first-contentful-paint')[0];
    const state = (window as typeof window & { __roundseoVisitorPath?: { lcp: number | null; cls: number; clsAvailable: boolean; longTasks: Array<{ start: number; duration: number }>; longTaskAvailable: boolean } }).__roundseoVisitorPath;
    const fcp = paint?.startTime ?? null;
    const blocking = fcp !== null && state?.longTaskAvailable
      ? state.longTasks.reduce((total, task) => total + Math.max(0, task.start + task.duration - Math.max(task.start + 50, fcp)), 0)
      : null;
    return {
      ttfb: navigation && navigation.responseStart > 0 ? navigation.responseStart : null,
      fcp,
      lcp: state?.lcp ?? null,
      cls: state?.clsAvailable ? state.cls : null,
      blocking,
    };
  });
}

async function collectLoadStructure(page: Page, pageHostname: string): Promise<Omit<RealUserLoadStructure, 'deliveryHosts'>> {
  return page.evaluate((firstPartyHostname) => {
    const normalise = (value: string): string => value.toLowerCase().replace(/^www\./, '');
    const isThirdParty = (value: string): boolean => {
      try { return normalise(new URL(value).hostname) !== normalise(firstPartyHostname); } catch { return false; }
    };
    const potentialBlockingScripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).flatMap(script => {
      const type = script.getAttribute('type')?.trim().toLowerCase() || null;
      if (script.async || script.defer || type === 'module') return [];
      const location: 'head' | 'body' = script.closest('head') ? 'head' : 'body';
      return [{ url: script.src, location, type, thirdParty: isThirdParty(script.src) }];
    });
    const inlineHeadScriptCount = Array.from(document.head.querySelectorAll('script:not([src])')).length;
    const headStylesheets = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map(link => ({
      url: link.href,
      media: link.getAttribute('media'),
      thirdParty: isThirdParty(link.href),
    }));
    return { potentialBlockingScripts, inlineHeadScriptCount, headStylesheets };
  }, pageHostname);
}

function browserMetrics(values: BrowserValues): PerformanceMetric[] {
  const metric = (key: PerformanceMetric['key'], label: string, value: number | null, unit: 'ms' | 'ratio'): PerformanceMetric | null =>
    value !== null && Number.isFinite(value) ? { key, label, value, unit, rating: 'unknown', source: 'lab' } : null;
  return [
    metric('ttfb', 'Time to first byte', values.ttfb, 'ms'),
    metric('fcp', 'First Contentful Paint', values.fcp, 'ms'),
    metric('lcp', 'Largest Contentful Paint', values.lcp, 'ms'),
    metric('cls', 'Layout shift during sample', values.cls, 'ratio'),
    metric('tbt', 'Long-task blocking during sample', values.blocking, 'ms'),
  ].filter((item): item is PerformanceMetric => item !== null);
}

function stripCapturedResource(resource: CapturedResource): PerformanceResource {
  const { started: _started, ...visible } = resource;
  return visible;
}

function responseHeader(headers: Record<string, string>, name: string): string | undefined {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found && typeof found[1] === 'string' ? found[1] : undefined;
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function hostnameFor(value: string): string | null {
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function normaliseHostname(value: string): string { return value.toLowerCase().replace(/^www\./, ''); }

function normalisedUrlKey(url: URL): string {
  const copy = new URL(url.href);
  copy.hostname = normaliseHostname(copy.hostname);
  return copy.href;
}

function createPublicHostCheck(): (hostname: string) => Promise<boolean> {
  const checks = new Map<string, Promise<boolean>>();
  return (hostname: string): Promise<boolean> => {
    if (!checks.has(hostname)) {
      checks.set(hostname, lookup(hostname, { all: true, verbatim: true })
        .then(addresses => addresses.length > 0 && addresses.every(address => isPublicAddress(address.address)))
        .catch(() => false));
    }
    return checks.get(hostname)!;
  };
}

function isPublicAddress(value: string): boolean {
  const address = value.toLowerCase();
  if (address.startsWith('::ffff:')) return isPublicAddress(address.slice(7));
  if (isIP(address) === 6) return address !== '::' && address !== '::1' && !/^(fc|fd|fe[89ab]|ff)/.test(address);
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return first !== 0 && first !== 10 && first !== 127 && first < 224 && !(first === 169 && second === 254) && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168);
}
