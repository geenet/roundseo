import { expect, test } from 'playwright/test';

const seededWorkspace = {
  id: 'e2e-site',
  name: 'Example workspace',
  domain: 'example.test',
  url: 'https://example.test',
  status: 'complete',
  result: {
    pages: 1,
    issues: 0,
    evidenceCount: 0,
    checkedAt: '2026-10-31T00:00:00.000Z',
    source: 'live',
    rendered: false,
    technicalHealth: { value: null, passedChecks: 0, evaluatedChecks: 0, expectedChecks: 0, unknownChecks: 0, ruleSetVersion: 'e2e' },
    crawlCoverage: { availability: 'measured', inspectedPages: 1, discoveredUrls: 1, failedUrls: 0, renderingRequiredPages: 0, limitReached: false, method: 'http', scopeNote: 'E2E fixture crawl' },
    findings: [],
    actions: [],
    pagesInventory: [
      { url: 'https://example.test/', statusCode: 200, crawlDepth: 0, title: 'Example home | Exact saved title', metaDescription: 'The saved description for the example homepage.', h1: ['An exact primary heading'], h2: ['A saved section heading'], h3: [], canonicalUrl: 'https://example.test/', robots: 'index, follow', indexable: true, wordCount: 450, internalLinks: 2, externalLinks: 0, imageCount: 1, imagesWithoutAlt: 0, contentExcerpt: 'Saved homepage evidence.', structuredDataTypes: ['WebSite'], linkEvidence: [{ target: 'https://example.test/pricing', anchorText: 'View pricing', placement: 'main', isInternal: true }] },
      { url: 'https://example.test/pricing', statusCode: 200, crawlDepth: 1, title: 'Pricing', h1: ['Pricing and plans'], h2: [], h3: [], indexable: true, wordCount: 200, internalLinks: 1, externalLinks: 0, contentExcerpt: 'Pricing evidence.', structuredDataTypes: [], linkEvidence: [] },
    ],
    changes: [],
    issueComparison: {
      status: 'comparable', previousAt: '2026-10-01', overlappingPages: 2, excludedRules: 0,
      newlyObserved: 1, noLongerObserved: 1, stillObserved: 1,
      rows: [
        { ruleId: 'title', title: 'Missing title', priority: 'High', category: 'Search appearance', newlyObserved: ['/pricing'], noLongerObserved: [], stillObserved: [] },
        { ruleId: 'links', title: 'Broken link', priority: 'Medium', category: 'Internal structure', newlyObserved: [], noLongerObserved: ['/guide'], stillObserved: ['/pricing'] },
      ],
    },
    dataSources: [],
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(workspace => {
    localStorage.clear();
    localStorage.setItem('roundseo-user', JSON.stringify({ name: 'E2E Tester', email: 'e2e@example.test' }));
    localStorage.setItem('roundseo-selected', JSON.stringify(workspace.id));
    localStorage.setItem('roundseo-websites', JSON.stringify([workspace]));
  }, seededWorkspace);
});

test('imports Pages and screens data without confusing it with crawl evidence', async ({ page }) => {
  await page.goto('/site/example.test/analytics');

  await expect(page.getByRole('heading', { name: 'Audience & engagement' })).toBeVisible();
  await expect(page.getByText('RoundSEO never derives visitor behavior from a crawl, keywords, or loading test.')).toBeVisible();
  await page.getByLabel('Pages and screens export').fill(`page_title,page_path,views,active_users,average_engagement_time,event_count,date
Pricing,/pricing,1250,800,1m 17s,4240,2026-10-31
Guides,/guides,900,600,45s,1800,2026-10-31`);
  await page.getByRole('button', { name: 'Import page metrics' }).click();

  await expect(page.getByText('2 page rows imported.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Imported page trend.' })).toBeVisible();
  await expect(page.getByText('Pricing', { exact: true })).toBeVisible();
  await expect(page.getByText('Guides', { exact: true })).toBeVisible();
  await expect(page.getByText('2,150')).toBeVisible();
});

test('imports retention cohorts and plots a source-reported curve', async ({ page }) => {
  await page.goto('/site/example.test/analytics');
  await page.getByRole('button', { name: 'Retention cohorts' }).click();
  await page.getByLabel('Retention export').fill(`cohort,day,retention_rate,average_engagement_time,new_users,returning_users,date
2026-10-01,1,10%,1m 30s,100,10,2026-10-31
2026-10-08,1,5%,45s,80,4,2026-10-31
2026-10-01,7,2.5%,20s,100,2,2026-10-31`);
  await page.getByRole('button', { name: 'Import cohorts' }).click();

  await expect(page.getByText('3 cohort rows imported.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cohort retention curve.' })).toBeVisible();
  await expect(page.locator('.capability-stat').filter({ hasText: 'Day-one retention' }).getByText('7.5%', { exact: true })).toBeVisible();
  await expect(page.locator('.retention-table').getByText('Day 7', { exact: true })).toBeVisible();
});

test('groups imported keyword ideas and filters the research table from a focus topic', async ({ page }) => {
  await page.goto('/site/example.test/keywords');
  await page.getByText('Import an existing keyword export').click();
  await page.getByLabel('Research export').fill(`keyword,volume,difficulty
seo audit,1200,32
best seo audit tool,450,28
how to do an seo audit,,
technical seo checklist,300,25`);
  await page.getByRole('button', { name: 'Import research' }).click();
  await page.getByLabel('Focus topic').fill('seo audit');

  await expect(page.locator('.keyword-idea-group').filter({ hasText: 'Matching terms' }).getByText('best seo audit tool')).toBeVisible();
  await expect(page.locator('.keyword-idea-group').filter({ hasText: 'Questions' }).getByText('how to do an seo audit')).toBeVisible();
  await page.getByRole('button', { name: 'Show 1 in table' }).first().click();
  await expect(page.locator('.research-table-row')).toHaveCount(1);
  await expect(page.locator('.research-table-row').getByText('best seo audit tool')).toBeVisible();
});

test('shows URL-scoped issue movement and filters newly observed findings', async ({ page }) => {
  await page.goto('/site/example.test/audit');

  await expect(page.getByRole('heading', { name: 'Issue movement between crawls' })).toBeVisible();
  await page.getByRole('button', { name: 'Newly observed 1' }).click();
  await expect(page.locator('.issue-movement-row')).toHaveCount(1);
  await page.locator('.issue-movement-row summary').click();
  await expect(page.locator('.issue-movement-detail').getByRole('button', { name: '/pricing' })).toBeVisible();
});

test('shows exact on-page values, all inspected pages and supporting references', async ({ page }, testInfo) => {
  await page.goto('/site/example.test/on-page');
  await expect(page.locator('.onpage-pages > details')).toHaveCount(2);
  await expect(page.locator('.onpage-fields').first()).toContainText('Example home | Exact saved title');
  await expect(page.getByText('An exact primary heading', { exact: true })).toBeVisible();
  await expect(page.locator('.onpage-fields').first().getByRole('link', { name: 'Google: title links' })).toHaveAttribute('href', 'https://developers.google.com/search/docs/appearance/title-link');
  await page.screenshot({ path: testInfo.outputPath('on-page-desktop.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Page condition', exact: true }).selectOption('metadata');
  await expect(page.locator('.onpage-pages > details')).toHaveCount(1);
  await expect(page.locator('.onpage-pages')).toContainText('/pricing');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download evidence JSON' }).click();
  expect((await downloading).suggestedFilename()).toBe('roundseo-on-page-evidence.json');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('on-page-mobile.png'), fullPage: true });
});

test('shows individual backlink evidence and drills into aggregate counts', async ({ page }, testInfo) => {
  await page.goto('/site/example.test/backlinks');
  await page.getByLabel('Backlink export').fill(`referring_page,target_page,anchor_text,rel,first_seen,source
https://news.example/review,https://example.test/pricing,Example pricing,nofollow,2026-10-30,News export`);
  await page.getByRole('button', { name: 'Import backlinks' }).click();
  const evidence = page.locator('#backlink-evidence');
  await expect(evidence).toContainText('1 of 1 backlink shown');
  await expect(evidence.getByRole('link', { name: 'https://news.example/review' })).toHaveAttribute('href', 'https://news.example/review');
  await expect(evidence.getByRole('link', { name: 'https://example.test/pricing' })).toHaveAttribute('href', 'https://example.test/pricing');
  await expect(evidence).toContainText('Example pricing');
  await expect(evidence).toContainText('nofollow');
  await expect(evidence).toContainText('News export');
  await page.screenshot({ path: testInfo.outputPath('backlinks-desktop.png'), fullPage: true });

  await page.getByLabel('Backlink export').fill(`referring_page,target_page,anchor_text,rel
https://other.example/post,https://example.test/,Home,follow`);
  await page.getByRole('button', { name: 'Import backlinks' }).click();
  await page.locator('#referring-domains').getByRole('button', { name: 'news.example' }).click();
  await expect(evidence).toContainText('1 of 2 backlinks shown');
  await expect(evidence).not.toContainText('https://other.example/post');
  await evidence.getByRole('button', { name: 'Clear filters' }).click();
  await expect(evidence.locator('.backlink-evidence-row')).toHaveCount(2);
  await page.getByLabel('Filter backlink evidence').fill('Home');
  await expect(evidence.locator('.backlink-evidence-row')).toHaveCount(1);
  await expect(evidence).toContainText('https://other.example/post');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('backlinks-mobile.png'), fullPage: true });
});
