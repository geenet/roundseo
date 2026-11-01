import { expect, test, type Page } from 'playwright/test';

const token = 'portfolio-media-token';
const organization = { id: 'org_media', name: 'Media agency' };
const capturedAt = '2026-11-01T00:00:00.000Z';
const sites = [
  { id: 'web_alpha', name: 'Alpha', domain: 'alpha.test', url: 'https://alpha.test', createdAt: capturedAt },
  { id: 'web_beta', name: 'Beta', domain: 'beta.test', url: 'https://beta.test', createdAt: capturedAt },
];

type BetaState = 'uncaptured' | 'failed' | 'captured';

function json(body: unknown) {
  return { contentType: 'application/json', body: JSON.stringify(body) };
}

function image(websiteId: string, kind: 'favicon' | 'thumbnail', width: number | null, height: number | null) {
  return { kind, status: 'available', url: `/api/v2/websites/${websiteId}/media/${kind}?expires=4102444800&sig=test`, width, height, capturedAt, reason: null };
}

const alphaMedia = { websiteId: 'web_alpha', favicon: image('web_alpha', 'favicon', 32, 32), thumbnail: image('web_alpha', 'thumbnail', 640, 400) };

/** Mirrors the Worker: a website with no media row reports `missing` with no capture time. */
function betaMedia(state: BetaState) {
  if (state === 'uncaptured') {
    return {
      websiteId: 'web_beta',
      favicon: { kind: 'favicon', status: 'missing', url: null, width: null, height: null, capturedAt: null, reason: 'Not captured yet.' },
      thumbnail: { kind: 'thumbnail', status: 'missing', url: null, width: null, height: null, capturedAt: null, reason: 'Not captured yet.' },
    };
  }
  if (state === 'failed') {
    return {
      websiteId: 'web_beta',
      favicon: { kind: 'favicon', status: 'missing', url: null, width: null, height: null, capturedAt, reason: 'This site does not publish an icon.' },
      thumbnail: { kind: 'thumbnail', status: 'failed', url: null, width: null, height: null, capturedAt, reason: 'The page did not render in time.' },
    };
  }
  return { websiteId: 'web_beta', favicon: image('web_beta', 'favicon', 32, 32), thumbnail: image('web_beta', 'thumbnail', 640, 400) };
}

/** Serves an account with two websites and returns the list of website ids whose previews were refreshed. */
async function mockAccount(page: Page, state: { beta: BetaState }) {
  const refreshed: string[] = [];
  await page.route('**/api/v2/organizations', route => route.fulfill(json({ organizations: [organization] })));
  await page.route(`**/api/v2/organizations/${organization.id}/websites`, route => route.fulfill(json({ websites: sites })));
  await page.route(`**/api/v2/organizations/${organization.id}/website-media`, route => route.fulfill(json({ media: [alphaMedia, betaMedia(state.beta)] })));
  await page.route(/\/api\/v2\/websites\/[^/]+\/media\/refresh$/, async route => {
    const websiteId = new URL(route.request().url()).pathname.split('/')[4];
    refreshed.push(websiteId);
    if (websiteId === 'web_beta') state.beta = 'captured';
    await route.fulfill(json({ media: websiteId === 'web_alpha' ? alphaMedia : betaMedia('captured') }));
  });
  await page.route(/\/api\/v2\/websites\/[^/]+\/media\/(favicon|thumbnail)\?/, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dbeafe"/></svg>',
  }));
  return refreshed;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(sessionToken => {
    if (localStorage.getItem('roundseo-user')) return;
    localStorage.clear();
    localStorage.setItem('roundseo-user', JSON.stringify({ name: 'E2E Tester', email: 'e2e@example.test' }));
    localStorage.setItem('roundseo-token', JSON.stringify(sessionToken));
  }, token);
});

test('shows each website\'s favicon and preview, and says why one is missing', async ({ page }) => {
  const refreshed = await mockAccount(page, { beta: 'failed' });
  await page.goto('/');

  const alpha = page.locator('.site-row', { hasText: 'alpha.test' });
  const beta = page.locator('.site-row', { hasText: 'beta.test' });
  await expect(alpha.locator('img.site-favicon')).toHaveAttribute('src', /web_alpha\/media\/favicon/);
  await expect(alpha.locator('.site-thumb img')).toHaveAttribute('src', /web_alpha\/media\/thumbnail/);
  await expect(beta.locator('img.site-favicon')).toHaveCount(0);
  await expect(beta.locator('.site-thumb.is-empty')).toHaveAttribute('title', 'The page did not render in time.');
  // Sites that already have a capture attempt are not re-captured on every visit.
  expect(refreshed).toEqual([]);
});

test('captures a website with no preview once, then refreshes every website on demand', async ({ page }) => {
  const state = { beta: 'uncaptured' as BetaState };
  const refreshed = await mockAccount(page, state);
  await page.goto('/');

  const beta = page.locator('.site-row', { hasText: 'beta.test' });
  await expect(beta.locator('.site-thumb img')).toHaveAttribute('src', /web_beta\/media\/thumbnail/);
  expect(refreshed).toEqual(['web_beta']);

  await page.getByRole('button', { name: 'Refresh previews' }).click();
  await expect.poll(() => refreshed.length).toBe(3);
  expect(refreshed.slice(1).sort()).toEqual(['web_alpha', 'web_beta']);
});
