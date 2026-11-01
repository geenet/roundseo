import { expect, test } from 'playwright/test';

const workspace = {
  id: 'intelligence-site', name: 'Intelligence workspace', domain: 'example.test', url: 'https://example.test', status: 'complete',
  result: {
    pages: 1, issues: 0, evidenceCount: 0, checkedAt: '2026-11-01T00:00:00.000Z', source: 'live', rendered: false,
    technicalHealth: { value: null, passedChecks: 0, evaluatedChecks: 0, expectedChecks: 0, unknownChecks: 0, ruleSetVersion: '2026.10.6' },
    crawlCoverage: { availability: 'measured', inspectedPages: 1, discoveredUrls: 1, failedUrls: 0, renderingRequiredPages: 0, limitReached: false, method: 'http', scopeNote: 'E2E intelligence fixture' },
    findings: [], actions: [], changes: [], dataSources: [],
    pagesInventory: [{ url: 'https://example.test/', statusCode: 200, crawlDepth: 0, title: 'Example', h1: ['Example'], h2: [], h3: [], indexable: true, wordCount: 120, internalLinks: 0, externalLinks: 0, contentExcerpt: 'Example intelligence fixture.', structuredDataTypes: [], linkEvidence: [] }],
  },
};

const capabilities = ['serp_analysis', 'market_intelligence', 'app_intelligence', 'page_intelligence', 'keyword_research', 'answer_engine_visibility'];

type ActionState = { action: string; capability: string; available: boolean; reason: string | null; sources: string[] };
/** Per-action availability as the Worker reports it for a deployment with no keyword or answer-engine sources. */
const actions: ActionState[] = [
  { action: 'keyword_discovery', capability: 'keyword_research', available: true, reason: 'Ideas, search volume, and CPC need the keyword-metrics source, which is not configured.', sources: ['Google results page'] },
  { action: 'keyword_overview', capability: 'keyword_research', available: false, reason: 'Volume, CPC range, and competition need the keyword-metrics source, which is not configured.', sources: ['Google Ads Keyword Plan'] },
  { action: 'keyword_metrics', capability: 'keyword_research', available: false, reason: 'Google metrics need the keyword-metrics source, which is not configured.', sources: ['Google Ads Keyword Plan'] },
  { action: 'keyword_trends', capability: 'keyword_research', available: false, reason: 'Monthly trends need the keyword-metrics source, which is not configured.', sources: ['Google Ads Keyword Plan'] },
  { action: 'domain_rankings', capability: 'market_intelligence', available: true, reason: 'Built from RoundSEO SERP observations stored for this website.', sources: ['RoundSEO SERP observations'] },
  { action: 'domain_competitors', capability: 'market_intelligence', available: true, reason: 'Competitor overlap is built from RoundSEO SERP observations stored for this website.', sources: ['RoundSEO SERP observations'] },
  { action: 'market_categories', capability: 'market_intelligence', available: true, reason: 'Categories are a keyword-lexicon classification of observed keywords, not a registry or survey.', sources: ['RoundSEO SERP observations'] },
  { action: 'app_competitors', capability: 'app_intelligence', available: true, reason: 'Apple data uses the public iTunes API.', sources: ['Apple iTunes Search API'] },
  { action: 'app_rankings', capability: 'app_intelligence', available: true, reason: 'Apple data uses the public iTunes API.', sources: ['Apple iTunes Search API'] },
  { action: 'serp_snapshot', capability: 'serp_analysis', available: true, reason: 'Search pages are fetched directly. Blocked or CAPTCHA pages are reported, not bypassed.', sources: ['Search results pages'] },
  { action: 'answer_response', capability: 'answer_engine_visibility', available: false, reason: 'No answer-engine API key is configured on this deployment.', sources: [] },
  { action: 'answer_snapshot', capability: 'answer_engine_visibility', available: false, reason: 'No answer-engine API key is configured on this deployment.', sources: [] },
  { action: 'answer_demand', capability: 'answer_engine_visibility', available: false, reason: 'No public source for AI query volume is connected. RoundSEO does not estimate AI demand.', sources: [] },
  { action: 'page_inspection', capability: 'page_intelligence', available: true, reason: null, sources: ['Fetched HTML'] },
  { action: 'content_extraction', capability: 'page_intelligence', available: true, reason: 'Rendered extraction needs the browser runner. Without it, RoundSEO saves the HTML result and says so.', sources: ['Fetched HTML'] },
  { action: 'page_screenshot', capability: 'page_intelligence', available: false, reason: 'Screenshots need both the browser runner and screenshot storage, and at least one is not configured.', sources: ['Browser runner'] },
  { action: 'site_crawl', capability: 'page_intelligence', available: true, reason: 'Durable crawl of this website\'s public HTML pages, capped at 500 pages.', sources: ['Fetched HTML'] },
];

function statusBody() {
  return { available: true, capabilities, actions, safeguards: { maximumSiteCrawlPages: 500, maximumLiveRequestsPerDay: 500 }, markets: { countries: ['GB', 'PL', 'US'], languages: ['en', 'pl'] } };
}


test.beforeEach(async ({ page }) => {
  await page.addInitScript(seed => {
    if (localStorage.getItem('roundseo-user')) return;
    localStorage.clear();
    localStorage.setItem('roundseo-user', JSON.stringify({ name: 'E2E Tester', email: 'e2e@example.test' }));
    localStorage.setItem('roundseo-selected', JSON.stringify(seed.id));
    localStorage.setItem('roundseo-websites', JSON.stringify([seed]));
  }, workspace);
});

test('exposes every RoundSEO Intelligence workflow and explains each unavailable source', async ({ page }) => {
  await page.route('**/__roundseo/intelligence/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/status')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(statusBody()) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(pathname.endsWith('/evidence') ? { evidence: [] } : { runs: [] }) });
  });

  await page.goto('/site/example.test/keywords');
  await expect(page.getByRole('heading', { name: 'Research keywords with RoundSEO' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Research keywords with RoundSEO' })
    .getByText('Ideas, search volume, and CPC need the keyword-metrics source, which is not configured.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run keyword research' })).toBeDisabled();

  await page.goto('/site/example.test/search-intelligence?tool=serp-analysis');
  await expect(page.getByRole('heading', { name: 'Capture a SERP snapshot' })).toBeVisible();

  await page.goto('/site/example.test/ai-visibility');
  await expect(page.getByRole('heading', { name: 'Run answer-engine research' })).toBeVisible();
  await expect(page.getByText('No answer engine has an API key configured on this deployment.')).toBeVisible();

  await page.goto('/site/example.test/on-page');
  await expect(page.getByRole('heading', { name: 'Inspect pages with RoundSEO' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('captures a native SERP snapshot with coverage and source, then reloads it from saved evidence', async ({ page }, testInfo) => {
  let savedRun: Record<string, unknown> | null = null;
  await page.route('**/__roundseo/intelligence/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/status')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(statusBody()) });
      return;
    }
    if (request.method() === 'GET' && pathname.endsWith('/runs')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ runs: savedRun ? [savedRun] : [] }) });
      return;
    }
    if (request.method() === 'GET' && pathname.endsWith('/evidence')) {
      const evidence = savedRun && Array.isArray(savedRun.evidence) ? savedRun.evidence : [];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ evidence }) });
      return;
    }
    const payload = request.postDataJSON();
    expect(payload).toMatchObject({ action: 'serp_snapshot', surface: 'google', query: 'seo audit', countryCode: 'US', languageCode: 'en', device: 'desktop' });
    expect(payload).not.toHaveProperty('confirmSpend');
    expect(request.headers()['idempotency-key']).toMatch(/^intelligence-run-[A-Za-z0-9-]{36}$/);
    const source = { origin: 'search_results_page', label: 'Google organic results collected by RoundSEO', method: 'serp-html-v1', observedAt: '2026-11-01T00:00:00.000Z', limitations: ['Results reflect one collection at the stated location and device.'] };
    savedRun = {
      id: 'intelligence-serp-1', capability: 'serp_analysis', action: 'serp_snapshot', status: 'complete', statusMessage: 'RoundSEO saved the search results.',
      requestedAt: '2026-11-01T00:00:00.000Z', startedAt: '2026-11-01T00:00:00.000Z', completedAt: '2026-11-01T00:00:00.000Z', request: payload, source,
      progress: { completed: 1, total: 1, updatedAt: '2026-11-01T00:00:00.000Z' },
      coverage: { surface: 'google', query: 'seo audit', status: 'complete', resultsRequested: 20, resultsParsed: 1, featuresDetected: ['organic'], reason: null },
      unavailable: [], error: null,
      summary: { evidenceCount: 1, keywordCount: 0, resultCount: 1, citationCount: 0, pagesCrawled: null, pagesQueued: null, unavailableMetricCount: 0 },
      evidence: [{ kind: 'serp_result', id: 'serp-1', query: 'seo audit', surface: 'google', position: 1, feature: 'organic', title: 'Example result', url: 'https://example.test/', domain: 'example.test', description: null, source }],
    };
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ run: savedRun }) });
  });

  await page.goto('/site/example.test/search-intelligence?tool=serp-analysis');
  await expect(page.getByText('Collection ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByLabel('Query').fill('seo audit');
  await page.getByRole('button', { name: 'Capture SERP snapshot' }).click();

  await expect(page.getByText('intelligence-serp-1', { exact: true })).toBeVisible();
  await expect(page.getByText('Coverage: Complete')).toBeVisible();
  await expect(page.getByText('Google organic results collected by RoundSEO')).toBeVisible();
  await expect(page.locator('.intelligence-table-row.serp')).toContainText('Example result');
  await expect(page.locator('.intelligence-table-row.serp')).toContainText('example.test');
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('intelligence-serp-desktop.png'), fullPage: true });

  await page.reload();
  await expect(page.locator('.intelligence-table-row.serp')).toContainText('Example result');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('intelligence-serp-mobile.png'), fullPage: true });
});
