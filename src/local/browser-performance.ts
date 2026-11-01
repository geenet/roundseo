import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { PerformanceAudit, PerformanceDevice, PerformanceDeviceResult, PerformanceMetric, PerformanceOpportunity, PerformanceResource } from '../shared/operating-model';
import { isPublicCrawlUrl } from '../worker/crawlers/base';

/** Collect our own cold-load browser observations without a third-party performance API. */
export async function measureLocalBrowserPerformance(targetUrl: string): Promise<PerformanceAudit> {
  const fetchedAt = new Date().toISOString();
  const { chromium, devices: browserDevices } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const dnsChecks = new Map<string, Promise<boolean>>();
  const publicHost = (hostname: string): Promise<boolean> => {
    if (!dnsChecks.has(hostname)) dnsChecks.set(hostname, lookup(hostname, { all: true, verbatim: true })
      .then(addresses => addresses.length > 0 && addresses.every(item => isPublicAddress(item.address)))
      .catch(() => false));
    return dnsChecks.get(hostname)!;
  };
  const measure = async (device: PerformanceDevice): Promise<PerformanceDeviceResult> => {
    const context = await browser.newContext(device === 'mobile'
      ? { ...browserDevices['Pixel 7'], serviceWorkers: 'block' }
      : { viewport: { width: 1365, height: 768 } });
    try {
      await context.route('**/*', async route => {
        const requestUrl = route.request().url();
        let parsed: URL;
        try { parsed = new URL(requestUrl); } catch { await route.abort(); return; }
        if (!isPublicCrawlUrl(requestUrl) || (route.request().isNavigationRequest() && !isPublicCrawlUrl(requestUrl, targetUrl)) || !await publicHost(parsed.hostname)) {
          await route.abort(); return;
        }
        await route.continue();
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const observed = new Map<string, PerformanceResource & { started?: number; encoding?: string }>();
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      if (device === 'mobile') {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 93_750 });
      }
      cdp.on('Network.requestWillBeSent', event => {
        if (!observed.has(event.requestId)) observed.set(event.requestId, { url: event.request.url, kind: event.type || 'Other', status: 0, transferredBytes: null, started: event.timestamp });
      });
      cdp.on('Network.responseReceived', event => {
        const item = observed.get(event.requestId);
        if (!item) return;
        item.url = event.response.url; item.kind = event.type; item.status = event.response.status;
        const encoding = Object.entries(event.response.headers).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1];
        item.encoding = typeof encoding === 'string' ? encoding : '';
      });
      cdp.on('Network.loadingFinished', event => {
        const item = observed.get(event.requestId);
        if (!item) return;
        item.transferredBytes = event.encodedDataLength;
        if (item.started !== undefined) item.durationMs = Math.max(0, Math.round((event.timestamp - item.started) * 1000));
      });
      await page.addInitScript(() => {
        const state = { lcp: null as number | null, lcpElement: '', lcpUrl: '', cls: 0, clsAvailable: false, longTasks: [] as Array<{ start: number; duration: number }>, longTaskAvailable: false };
        let sessionStart = -1; let previousShift = -1; let sessionScore = 0;
        (window as any).__roundseoPerformance = state;
        try {
          new PerformanceObserver(list => {
            for (const entry of list.getEntries() as Array<PerformanceEntry & { element?: Element; url?: string }>) {
              state.lcp = entry.startTime;
              state.lcpElement = entry.element ? `${entry.element.tagName.toLowerCase()}${entry.element.id ? `#${entry.element.id}` : ''}` : '';
              state.lcpUrl = entry.url || '';
            }
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch { /* Browser did not expose LCP. */ }
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
        } catch { /* Browser did not expose layout shifts. */ }
        try {
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration });
          }).observe({ type: 'longtask', buffered: true });
          state.longTaskAvailable = true;
        } catch { /* Browser did not expose long tasks. */ }
      });
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (!response || response.status() >= 400) throw new Error(response ? `HTTP ${response.status()} while opening the page.` : 'The browser did not receive a page response.');
      const loaded = await page.waitForLoadState('load', { timeout: 15_000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(2_000);
      const values = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        const paint = performance.getEntriesByName('first-contentful-paint')[0];
        const state = (window as any).__roundseoPerformance as { lcp: number | null; lcpElement: string; lcpUrl: string; cls: number; clsAvailable: boolean; longTasks: Array<{ start: number; duration: number }>; longTaskAvailable: boolean } | undefined;
        const fcp = paint?.startTime ?? null;
        const blocking = fcp !== null && state?.longTaskAvailable ? state.longTasks.reduce((total, task) => total + Math.max(0, task.start + task.duration - Math.max(task.start + 50, fcp)), 0) : null;
        const stylesheets = Array.from(document.head.querySelectorAll('link[rel~="stylesheet"][href]')).filter(element => {
          const media = element.getAttribute('media');
          return !media || window.matchMedia(media).matches;
        }).map(element => (element as HTMLLinkElement).href).slice(0, 20);
        return { ttfb: navigation && navigation.responseStart > 0 ? navigation.responseStart : null, fcp, lcp: state?.lcp ?? null, lcpElement: state?.lcpElement || '', lcpUrl: state?.lcpUrl || '', cls: state?.clsAvailable ? state.cls : null, blocking, stylesheets };
      });
      const metric = (key: PerformanceMetric['key'], label: string, value: number | null, unit: 'ms' | 'ratio'): PerformanceMetric | null =>
        value !== null && Number.isFinite(value) ? { key, label, value, unit, rating: 'unknown', source: 'lab' } : null;
      const labMetrics = [metric('ttfb', 'Time to first byte', values.ttfb, 'ms'), metric('fcp', 'First Contentful Paint', values.fcp, 'ms'), metric('lcp', 'Largest Contentful Paint', values.lcp, 'ms'), metric('cls', 'Layout shift during sample', values.cls, 'ratio'), metric('tbt', 'Long-task blocking during sample', values.blocking, 'ms')].filter((item): item is PerformanceMetric => item !== null);
      const resources = [...observed.values()].filter(item => item.status > 0 && /^https?:/i.test(item.url));
      const opportunities = buildLocalOpportunities(targetUrl, resources, values);
      const transferredBytes = resources.reduce((sum, item) => sum + (item.transferredBytes || 0), 0);
      return { device, availability: labMetrics.length ? 'partial' : 'not_measured', labScore: null, labMetrics, fieldMetrics: [], fieldDataAvailability: 'not_measured', fieldDataScope: 'none', opportunities, fetchedAt,
        resources: resources.sort((a, b) => (b.transferredBytes || 0) - (a.transferredBytes || 0)).slice(0, 50).map(({ url, kind, status, transferredBytes: bytes, durationMs }) => ({ url, kind, status, transferredBytes: bytes, durationMs })),
        requests: resources.length, transferredBytes, profile: device === 'mobile' ? 'Mobile viewport, 4× CPU slowdown, 1.6 Mbps download and 150 ms latency' : 'Desktop viewport, local connection and CPU',
        error: !labMetrics.length ? 'This browser did not expose usable timing measurements.' : loaded ? undefined : 'The page did not finish loading before the sampling deadline; results may be incomplete.' };
    } catch (error) {
      return { device, availability: 'failed', labScore: null, labMetrics: [], fieldMetrics: [], fieldDataAvailability: 'not_measured', fieldDataScope: 'none', opportunities: [], fetchedAt, error: error instanceof Error ? error.message : 'Local browser measurement failed.' };
    } finally { await context.close(); }
  };
  try {
    const devices = [await measure('mobile'), await measure('desktop')];
    const available = devices.some(device => device.labMetrics.length > 0);
    return {
      targetUrl, provider: 'local_browser', providerLabel: 'RoundSEO browser test',
      availability: available ? 'partial' : 'failed', fetchedAt, methodVersion: 'roundseo-browser-2026.10.2', devices,
      error: available ? undefined : devices.map(device => device.error).filter(Boolean).join(' '),
      sourceNote: 'One cold-load Chromium run per device. Mobile uses simulated network and CPU limits; desktop uses the local connection. These are lab samples, not Lighthouse scores or real-user Core Web Vitals. INP requires real interactions and is not measured.',
    };
  } finally { await browser.close(); }
}

type CapturedResource = PerformanceResource & { encoding?: string };
type BrowserValues = { ttfb: number | null; fcp: number | null; lcp: number | null; lcpElement: string; lcpUrl: string; cls: number | null; blocking: number | null; stylesheets: string[] };

export function buildLocalOpportunities(targetUrl: string, resources: CapturedResource[], values: BrowserValues): PerformanceOpportunity[] {
  const opportunities: PerformanceOpportunity[] = [];
  const add = (key: string, title: string, evidence: NonNullable<PerformanceOpportunity['evidence']>) => {
    if (evidence.length) opportunities.push({ key, title, estimatedSavingsMs: null, estimatedSavingsBytes: null, evidence: evidence.slice(0, 12) });
  };
  const large = (kind: string) => resources.filter(item => item.kind.toLowerCase() === kind && item.transferredBytes !== null && item.transferredBytes >= 200 * 1024);
  add('large_images', 'Review large image transfers', large('image').map(item => ({ url: item.url, observed: `${Math.round(item.transferredBytes! / 1024)} KB transferred during this test.`, recommendation: 'Check the image dimensions and displayed size; consider a suitable compressed format or responsive image variants.' })));
  add('large_scripts', 'Review large JavaScript transfers', large('script').map(item => ({ url: item.url, observed: `${Math.round(item.transferredBytes! / 1024)} KB transferred during this test.`, recommendation: 'Inspect this bundle for code splitting and defer code that is not needed for the first view.' })));
  add('failed_resources', 'Review requests with error responses', resources.filter(item => item.status >= 400).map(item => ({ url: item.url, observed: `HTTP ${item.status} for a ${item.kind.toLowerCase()} request.`, recommendation: item.status === 401 || item.status === 403 ? 'Check whether this response is expected for a signed-out visitor; investigate only if the page needs this request to succeed.' : 'Check whether this resource is needed on this page, then restore or remove the request if the error is unintended.' })));
  add('uncompressed_text', 'Review text responses without compression', resources.filter(item => ['script', 'stylesheet', 'document'].includes(item.kind.toLowerCase()) && item.status === 200 && item.transferredBytes !== null && item.transferredBytes >= 50 * 1024 && item.encoding === '').map(item => ({ url: item.url, observed: `${Math.round(item.transferredBytes! / 1024)} KB transferred; no Content-Encoding response header was observed.`, recommendation: 'Check server or CDN compression for this text response and compare a fresh request after changing it.' })));
  add('head_stylesheets', 'Review slow stylesheets in the document head', resources.filter(item => values.stylesheets.includes(item.url) && (item.durationMs || 0) >= 100).map(item => ({ url: item.url, observed: `A stylesheet referenced in the document head took ${item.durationMs} ms to load in this test.`, recommendation: 'Check whether the stylesheet is needed for the initial view and reduce or defer noncritical styles where appropriate.' })));
  if (values.lcp !== null && values.lcp > 2500) add('slow_lcp', 'Investigate the largest visible element', [{ url: values.lcpUrl || targetUrl, observed: `Largest contentful paint occurred at ${(values.lcp / 1000).toFixed(1)} s${values.lcpElement ? ` for ${values.lcpElement}` : ''} in this browser sample.`, recommendation: 'Inspect when the element and its resource are discovered, loaded and rendered; retest after any change.' }]);
  if (values.ttfb !== null && values.ttfb > 800) add('slow_first_byte', 'Investigate the initial server response', [{ url: targetUrl, observed: `The first response byte arrived ${Math.round(values.ttfb)} ms after navigation began in this test.`, recommendation: 'Compare repeat requests and investigate redirects, network latency, server processing and cache behavior.' }]);
  if (values.cls !== null && values.cls > 0.1) add('layout_shift', 'Review unexpected layout movement', [{ url: targetUrl, observed: `The maximum layout-shift session during the sample was ${values.cls.toFixed(3)}.`, recommendation: 'Record a performance trace and check late-loading images, fonts and injected content; reserve space where needed.' }]);
  return opportunities;
}

export function isPublicAddress(value: string): boolean {
  const address = value.toLowerCase();
  if (address.startsWith('::ffff:')) return isPublicAddress(address.slice(7));
  if (isIP(address) === 6) return address !== '::' && address !== '::1' && !/^(fc|fd|fe[89ab]|ff)/.test(address);
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return first !== 0 && first !== 10 && first !== 127 && first < 224 && !(first === 169 && second === 254) && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168);
}
