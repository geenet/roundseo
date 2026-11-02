import { expect, test } from 'playwright/test';
import type { BacklinkMonitor } from '../../src/shared/backlinks';

const workspace = {
  id: 'web-1', name: 'Backlinks workspace', domain: 'example.test', url: 'https://example.test', status: 'complete',
  result: {
    pages: 1, issues: 0, evidenceCount: 0, checkedAt: '2026-11-02T00:00:00.000Z', source: 'live', rendered: false,
    technicalHealth: { value: null, passedChecks: 0, evaluatedChecks: 0, expectedChecks: 0, unknownChecks: 0, ruleSetVersion: '2026.10.6' },
    crawlCoverage: { availability: 'measured', inspectedPages: 1, discoveredUrls: 1, failedUrls: 0, renderingRequiredPages: 0, limitReached: false, method: 'http', scopeNote: 'E2E backlinks fixture' },
    findings: [], actions: [], changes: [], dataSources: [],
    pagesInventory: [{ url: 'https://example.test/', statusCode: 200, crawlDepth: 0, title: 'Example', h1: ['Example'], h2: [], h3: [], indexable: true, wordCount: 120, internalLinks: 0, externalLinks: 0, contentExcerpt: 'Example backlinks fixture.', structuredDataTypes: [], linkEvidence: [] }],
  },
};

const monitor: BacklinkMonitor = {
  id: 'backlink_e2e1', websiteId: 'web-1', sourceUrl: 'https://news.example/review', expectedTargetUrl: 'https://example.test/pricing',
  matchMode: 'exact_page', expectedAnchor: null, expectedRel: [], notes: null, status: 'active', cadence: 'weekly',
  placementDate: null, nextCheckAt: '2026-11-09T00:00:00.000Z', lastAttemptAt: '2026-11-02T00:00:00.000Z',
  lastSuccessfulCheckAt: '2026-11-02T00:00:00.000Z', lastConfirmedPresence: 'present', lastConfirmedAt: '2026-11-02T00:00:00.000Z',
  confirmationDueAt: null, pendingConfirmationObservationId: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(seed => {
    localStorage.clear();
    localStorage.setItem('roundseo-user', JSON.stringify({ name: 'E2E Tester', email: 'e2e@example.test' }));
    localStorage.setItem('roundseo-token', 'e2e-test-token');
    localStorage.setItem('roundseo-selected', JSON.stringify(seed.id));
    localStorage.setItem('roundseo-websites', JSON.stringify([seed]));
  }, workspace);

  await page.route('**/api/v2/organizations', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ organizations: [{ id: 'org-1', name: 'E2E Org' }] }) });
  });
  await page.route('**/api/v2/organizations/org-1/backlinks/usage', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ capacity: { limit: 2000, used: 1, remaining: 1999 } }) });
  });
  await page.route('**/api/v2/websites/web-1/backlink-lists', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ lists: [] }) });
    await route.continue();
  });
});

test('shows monitored backlinks, queues a recheck, and surfaces its history (false-positive protection evidence)', async ({ page }) => {
  let monitors = [monitor];
  await page.route('**/api/v2/websites/web-1/backlinks*', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ monitors, total: monitors.length }) });
    if (route.request().method() === 'POST') {
      const added: BacklinkMonitor = { ...monitor, id: 'backlink_new', status: 'active', lastConfirmedPresence: 'unknown', lastSuccessfulCheckAt: null };
      monitors = [...monitors, added];
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ monitor: added }) });
    }
    await route.continue();
  });
  await page.route('**/api/v2/backlinks/backlink_e2e1/checks', async route => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'bjob_1', status: 'queued' }) });
  });
  await page.route('**/api/v2/backlinks/backlink_e2e1/history', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        observations: [{ id: 'obs_1', monitorId: 'backlink_e2e1', attemptedAt: '2026-11-02T00:00:00.000Z', fetchOutcome: 'blocked', httpStatus: 403, finalUrl: null, redirectChain: [], contentType: null, presence: 'unknown', presenceMethod: 'html', confirmationState: 'unconfirmed', targetStatusCode: null, targetFinalUrl: null, targetRedirectChain: [], sourceMetaRobots: null, sourceXRobotsTag: null, sourceCanonical: null, errorMessage: null, occurrences: [], createdAt: '2026-11-02T00:00:00.000Z' }],
        events: [],
      }),
    });
  });

  await page.goto('/site/example.test/backlinks');
  await expect(page.getByRole('heading', { name: 'Monitor the backlinks you already know about.' })).toBeVisible();
  await expect(page.getByText('1 of 2000 workspace slots used.')).toBeVisible();
  await expect(page.getByText('https://news.example/review')).toBeVisible();

  // Add a second monitor through the form.
  await page.getByRole('textbox', { name: 'Source page (where the link should appear)' }).fill('https://partner.example/mention');
  await page.getByRole('textbox', { name: 'Expected target' }).fill('https://example.test/features');
  await page.getByRole('button', { name: 'Add monitor' }).click();
  await expect(page.getByText('Monitor added. Its first check runs on the next scheduled sweep.')).toBeVisible();

  // Recheck and inspect history: a 403 is inconclusive, not a confirmed loss.
  await page.getByRole('button', { name: 'Recheck now' }).first().click();
  await expect(page.getByText('Recheck queued.')).toBeVisible();
  await page.getByRole('button', { name: /View history/ }).first().click();
  await expect(page.getByText(/blocked.*unconfirmed/)).toBeVisible();
});

test('indexing tab offers to connect Google when no property is connected', async ({ page }) => {
  await page.route('**/api/v2/websites/web-1/google-connection', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connection: null }) });
  });
  await page.route('**/api/v2/websites/web-1/indexing', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ coverage: { intendedCount: 0, inspectedCount: 0, indexedCount: 0, notIndexedCount: 0, uninspectedCount: 0, indexedShareOfInspected: null, quota: { limit: 2000, used: 0, resetAt: '2026-11-03T00:00:00.000Z' } } }) });
  });
  await page.route('**/api/v2/websites/web-1/indexing/inventory*', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
  });
  await page.route('**/api/v2/websites/web-1/indexing/actions', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ actions: [] }) });
  });

  await page.goto('/site/example.test/indexing');
  await expect(page.getByRole('heading', { name: 'Know what Google has actually indexed.' })).toBeVisible();
  await expect(page.getByText('RoundSEO starts with read-only access.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Google' })).toBeVisible();
});
