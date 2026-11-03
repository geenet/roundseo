import { describe, expect, it } from 'vitest';
import { rootHostOf, rootTargetUrlFor } from '../../src/shared/backlinks';
import { findLinkingPages, normalizeKeyPages, planWatchlist, type WatchlistDeps } from '../../src/worker/backlinks/default-watchlist';

const linking = (href: string) => `<html><body><p>Partner list</p><a href="${href}">Dadaphone</a></body></html>`;
const mentioning = '<html><body><p>dadaphone.com is an international calling service.</p></body></html>';

const ROOT_QUERIES = ['"dadaphone.com" -site:dadaphone.com', 'dadaphone.com -site:dadaphone.com'];
const rootTarget = { url: 'https://dadaphone.com/', matchMode: 'domain_wide' as const };
const pricingQuery = '"dadaphone.com/pricing" -site:dadaphone.com';

/** Fake deps: `results` and `blocked` are keyed by exact search query; `pages` maps each URL to its HTML. */
function fakeDeps(results: Record<string, string[]>, pages: Record<string, string | null>, blocked: Record<string, string> = {}) {
  const queries: string[] = [];
  let fetches = 0;
  const deps: WatchlistDeps & { queries: string[]; fetchCount: () => number } = {
    queries,
    fetchCount: () => fetches,
    async search(query) {
      queries.push(query);
      return { urls: results[query] ?? [], blockedReason: blocked[query] ?? null };
    },
    async fetchPage(url) {
      fetches += 1;
      return { html: pages[url] ?? null, finalUrl: url };
    },
  };
  return deps;
}

describe('rootHostOf and rootTargetUrlFor', () => {
  it('reduces a stored domain, with or without scheme, path, or www, to its root host', () => {
    expect(rootHostOf('DadaPhone.com')).toBe('dadaphone.com');
    expect(rootHostOf('https://www.dadaphone.com/pricing')).toBe('dadaphone.com');
    expect(rootHostOf('www.dadaphone.com')).toBe('dadaphone.com');
  });

  it('builds the root domain as the expected target', () => {
    expect(rootTargetUrlFor('https://www.dadaphone.com/pricing')).toBe('https://dadaphone.com/');
  });
});

describe('findLinkingPages', () => {
  it('keeps only pages whose markup links to the target', async () => {
    const deps = fakeDeps(
      { [ROOT_QUERIES[0]]: ['https://news.example/review', 'https://blog.example/mention', 'https://other.example/link'] },
      { 'https://news.example/review': linking('https://dadaphone.com/'), 'https://blog.example/mention': mentioning, 'https://other.example/link': linking('https://elsewhere.example/') },
    );
    const finding = await findLinkingPages('dadaphone.com', rootTarget, deps, 10, 16);
    expect(finding.verifiedSourceUrls).toEqual(['https://news.example/review']);
  });

  it('does not count the site\'s own pages or subdomains as inbound links', async () => {
    const deps = fakeDeps(
      { [ROOT_QUERIES[0]]: ['https://dadaphone.com/tools', 'https://www.dadaphone.com/blog', 'https://app.dadaphone.com/'] },
      { 'https://dadaphone.com/tools': linking('https://dadaphone.com/'), 'https://www.dadaphone.com/blog': linking('https://dadaphone.com/'), 'https://app.dadaphone.com/': linking('https://dadaphone.com/') },
    );
    const finding = await findLinkingPages('dadaphone.com', rootTarget, deps, 10, 16);
    expect(finding.candidatesFound).toBe(0);
    expect(finding.verifiedSourceUrls).toEqual([]);
  });

  it('checks a URL once even when both queries return it', async () => {
    const deps = fakeDeps(
      { [ROOT_QUERIES[0]]: ['https://news.example/review'], [ROOT_QUERIES[1]]: ['https://news.example/review'] },
      { 'https://news.example/review': linking('https://dadaphone.com/') },
    );
    const finding = await findLinkingPages('dadaphone.com', rootTarget, deps, 10, 16);
    expect(deps.fetchCount()).toBe(1);
    expect(finding.verifiedSourceUrls).toEqual(['https://news.example/review']);
  });

  it('caps the result at the requested size, and fetches at most the page budget', async () => {
    const urls = Array.from({ length: 30 }, (_, index) => `https://site${index}.example/page`);
    const pages = Object.fromEntries(urls.map(url => [url, linking('https://dadaphone.com/')]));
    const capped = await findLinkingPages('dadaphone.com', rootTarget, fakeDeps({ [ROOT_QUERIES[0]]: urls }, pages), 10, 16);
    expect(capped.verifiedSourceUrls).toHaveLength(10);
    expect(capped.candidatesChecked).toBe(10);

    const none = Object.fromEntries(urls.map(url => [url, mentioning]));
    const unlinked = await findLinkingPages('dadaphone.com', rootTarget, fakeDeps({ [ROOT_QUERIES[0]]: urls }, none), 10, 16);
    expect(unlinked.verifiedSourceUrls).toEqual([]);
    expect(unlinked.candidatesChecked).toBe(16);
  });

  it('skips a page that could not be fetched as HTML rather than verifying it', async () => {
    const deps = fakeDeps({ [ROOT_QUERIES[0]]: ['https://news.example/review'] }, { 'https://news.example/review': null });
    const finding = await findLinkingPages('dadaphone.com', rootTarget, deps, 10, 16);
    expect(finding.candidatesChecked).toBe(1);
    expect(finding.verifiedSourceUrls).toEqual([]);
  });

  it('counts only a link to the exact page for an exact-page target', async () => {
    const deps = fakeDeps(
      { [pricingQuery]: ['https://a.example/pricing-link', 'https://b.example/home'] },
      { 'https://a.example/pricing-link': linking('https://dadaphone.com/pricing'), 'https://b.example/home': linking('https://dadaphone.com/') },
    );
    const finding = await findLinkingPages('dadaphone.com', { url: 'https://dadaphone.com/pricing', matchMode: 'exact_page' }, deps, 10, 8);
    expect(finding.verifiedSourceUrls).toEqual(['https://a.example/pricing-link']);
  });

  it('reports a blocked search instead of presenting it as "no pages found"', async () => {
    const blocked = { [ROOT_QUERIES[0]]: 'Blocked by a consent page.', [ROOT_QUERIES[1]]: 'Blocked by a consent page.' };
    const finding = await findLinkingPages('dadaphone.com', rootTarget, fakeDeps({}, {}, blocked), 10, 16);
    expect(finding.searchBlockedReason).toBe('Blocked by a consent page.');
    expect(finding.verifiedSourceUrls).toEqual([]);
  });

  it('treats a search that ran and found nothing as complete, not blocked', async () => {
    const finding = await findLinkingPages('dadaphone.com', rootTarget, fakeDeps({}, {}), 10, 16);
    expect(finding.searchBlockedReason).toBeNull();
    expect(finding.candidatesFound).toBe(0);
  });
});

describe('planWatchlist', () => {
  it('searches only the root domain when no key pages are saved', async () => {
    const deps = fakeDeps({}, {});
    const plan = await planWatchlist('dadaphone.com', [], deps);
    expect(deps.queries).toEqual(ROOT_QUERIES);
    expect(plan.keyPagesSearched).toBe(0);
    expect(plan.sources).toEqual([]);
  });

  it('never searches key pages when the root domain already has a verified link', async () => {
    const deps = fakeDeps(
      { [ROOT_QUERIES[0]]: ['https://news.example/review'] },
      { 'https://news.example/review': linking('https://dadaphone.com/') },
    );
    const plan = await planWatchlist('dadaphone.com', ['https://dadaphone.com/pricing'], deps);
    expect(plan.keyPagesSearched).toBe(0);
    expect(plan.sources).toEqual([{ sourceUrl: 'https://news.example/review', target: rootTarget }]);
  });

  it('falls back to the saved key pages only when the root domain has no verified link', async () => {
    const deps = fakeDeps(
      { [ROOT_QUERIES[0]]: ['https://blog.example/mention'], [pricingQuery]: ['https://c.example/pricing-link'] },
      { 'https://blog.example/mention': mentioning, 'https://c.example/pricing-link': linking('https://dadaphone.com/pricing') },
    );
    const plan = await planWatchlist('dadaphone.com', ['https://dadaphone.com/pricing'], deps);
    expect(plan.keyPagesSearched).toBe(1);
    expect(plan.sources).toEqual([{ sourceUrl: 'https://c.example/pricing-link', target: { url: 'https://dadaphone.com/pricing', matchMode: 'exact_page' } }]);
  });

  it('searches at most three key pages and never exceeds the ten-source limit', async () => {
    const pages = ['/a', '/b', '/c', '/d'].map(path => `https://dadaphone.com${path}`);
    const results: Record<string, string[]> = {};
    const htmlPages: Record<string, string> = {};
    for (const path of ['a', 'b', 'c', 'd']) {
      results[`"dadaphone.com/${path}" -site:dadaphone.com`] = Array.from({ length: 8 }, (_, index) => `https://site${path}${index}.example/`);
      for (let index = 0; index < 8; index += 1) htmlPages[`https://site${path}${index}.example/`] = linking(`https://dadaphone.com/${path}`);
    }
    const plan = await planWatchlist('dadaphone.com', pages, fakeDeps(results, htmlPages));
    expect(plan.sources).toHaveLength(10);
    expect(plan.keyPagesSearched).toBe(2);
  });

  it('does not run the fallback when the root search was blocked', async () => {
    const blocked = { [ROOT_QUERIES[0]]: 'Blocked by a consent page.', [ROOT_QUERIES[1]]: 'Blocked by a consent page.' };
    const deps = fakeDeps({ [pricingQuery]: ['https://c.example/pricing-link'] }, { 'https://c.example/pricing-link': linking('https://dadaphone.com/pricing') }, blocked);
    const plan = await planWatchlist('dadaphone.com', ['https://dadaphone.com/pricing'], deps);
    expect(plan.searchBlockedReason).toBe('Blocked by a consent page.');
    expect(plan.keyPagesSearched).toBe(0);
    expect(plan.sources).toEqual([]);
  });
});

describe('normalizeKeyPages', () => {
  it('resolves relative paths against the root domain and keeps the site\'s own hosts', () => {
    expect(normalizeKeyPages(['/pricing', 'https://www.dadaphone.com/features?x=1'], 'dadaphone.com')).toEqual([
      'https://dadaphone.com/pricing',
      'https://www.dadaphone.com/features?x=1',
    ]);
  });

  it('drops other hosts, the root itself, invalid or non-web values, blanks, and duplicates', () => {
    expect(normalizeKeyPages(['https://other.example/x', 'https://dadaphone.com/', 'javascript:alert(1)', '/pricing', '/pricing', '   '], 'dadaphone.com')).toEqual([
      'https://dadaphone.com/pricing',
    ]);
  });

  it('caps the saved list at ten pages, and ignores a value that is not a list', () => {
    expect(normalizeKeyPages(Array.from({ length: 12 }, (_, index) => `/p${index}`), 'dadaphone.com')).toHaveLength(10);
    expect(normalizeKeyPages('/pricing', 'dadaphone.com')).toEqual([]);
  });
});
