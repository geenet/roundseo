/**
 * Rules Management
 * Load and query Google SEO rules from the specification
 */

import { Rule, RuleCategory, RulePriority, EvidenceLevel } from './types';

/**
 * In-memory rules catalog (populated from google-seo-rules.json)
 * This would normally be loaded at startup
 */
let rulesCache: Map<string, Rule> | null = null;
let allRulesCache: Rule[] | null = null;

/**
 * Comprehensive rules extracted from google-seo-rules.json
 * Partial list - full list would be imported from the JSON file
 */
const rulesDefinition: Rule[] = [
  {
    id: 'OVERALL-001',
    category: 'overall',
    name: 'Declare the intended URL inventory',
    priority: 'P0',
    evidence: 'engineering_practice',
    impact: 'operations',
    automation: 'mixed',
    scope: 'All route families',
    rule: 'Declare which URLs should be indexed, excluded, private, redirected or gone. Resolve these states from business purpose and content ownership before applying SEO changes.',
    verification:
      'Join router/CMS records, sitemap URLs and crawl discoveries; reconcile disagreements into a versioned inventory. A crawler alone cannot reveal orphaned records.',
    metric: {
      name: 'Important routes with an explicit intended state',
      unit: 'percent',
      official_threshold: null,
      project_target: '100%',
    },
    caveats: [
      'This is a project control, not a Google ranking metric. Never expose private application data to satisfy an indexing check.',
    ],
    sources: ['https://developers.google.com/search/docs/essentials/technical'],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'TECH-001',
    category: 'technical',
    name: 'Public access for Googlebot',
    priority: 'P0',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'mixed',
    scope: 'Public landing pages intended for Google indexing',
    rule: 'Allow Googlebot to retrieve the page without login, authentication, WAF challenge, geographic denial, or other access restriction.',
    verification:
      'Inspect representative live URLs in Search Console; compare verified Googlebot server logs with ordinary HTTP requests.',
    metric: {
      name: 'Intended URLs inaccessible to verified Googlebot',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'A successful ordinary browser request does not establish Googlebot access.',
      'Private application routes should remain protected.',
    ],
    sources: [
      'https://developers.google.com/search/docs/essentials/technical',
      'https://developers.google.com/search/docs/crawling-indexing/googlebot',
    ],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'TECH-002',
    category: 'technical',
    name: 'Successful content response',
    priority: 'P0',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'Canonical content pages intended for indexing',
    rule: 'Serve real indexable content with HTTP 200 rather than a blank app shell that never renders, an error response, or an error page disguised as success.',
    verification: 'Fetch each intended URL and inspect status plus rendered main content.',
    metric: {
      name: 'Intended content URLs with successful content response',
      unit: 'percent',
      official_threshold: null,
      project_target: '100%',
    },
    caveats: [
      'HTTP 200 is necessary eligibility evidence, not a promise of indexing.',
      'A 204 response supplies no content.',
    ],
    sources: [
      'https://developers.google.com/search/docs/essentials/technical',
      'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes',
    ],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'CONTENT-001',
    category: 'on_page',
    name: 'Match pages to user tasks',
    priority: 'P1',
    evidence: 'confirmed_mechanism',
    impact: 'relevance',
    automation: 'mixed',
    scope: 'Intended search landing pages',
    rule: 'Define each page\'s audience, primary task, language and useful page type; make its content and functionality satisfy the task represented by its target queries.',
    verification:
      'Store intent metadata, then have a reviewer complete the target task using the published page; record unresolved gaps rather than inventing a quality score.',
    metric: {
      name: 'Reviewed task alignment',
      unit: 'percent',
      official_threshold: null,
      project_target: '100% of priority landing pages reviewed',
    },
    caveats: [
      'Metadata completion does not establish intent satisfaction.',
      'Ranking depends on the query and competition.',
    ],
    sources: [
      'https://www.google.com/search/howsearchworks/how-search-works/ranking-results/',
    ],
    last_verified_at: '2026-10-28',
  },
  {
    id: 'LINK-001',
    category: 'linking',
    name: 'Crawlable navigation links',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Navigation and contextual links to public pages',
    rule: 'Render discoverable navigation and contextual links as anchor elements with valid href destinations, including links inserted by JavaScript. Ensure destinations resolve to actual crawlable URLs.',
    verification:
      'Inspect raw and rendered HTML; extract anchor href values; report important destinations reachable only through script events, buttons, or non-URL href values.',
    metric: {
      name: 'Important destinations without crawlable anchor links',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Client-rendered anchors can be crawlable when Google renders them; server-rendered HTML is an implementation choice.',
      'Other discovery mechanisms do not replace a usable site navigation structure.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
    ],
    last_verified_at: '2026-10-28',
  },

  // ---------------------------------------------------------------------
  // Phase 2: Eligibility and Rendering
  // ---------------------------------------------------------------------
  {
    id: 'TECH-003',
    category: 'technical',
    name: 'Correct status for genuinely missing pages',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'URLs with indexing_intent gone or redirect',
    rule: 'Serve HTTP 404 or 410 for genuinely removed or nonexistent pages rather than a soft 404 (HTTP 200 with a "not found" message) or a silent redirect to the homepage.',
    verification: 'Fetch intended-gone or intended-redirect URLs and confirm the HTTP status matches the declared indexing_intent; cross-check Search Console Coverage > Excluded > Soft 404.',
    metric: {
      name: 'Gone/redirect-intent URLs returning the wrong status',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'A 200 response with a human-readable "not found" message is a soft 404 and is treated as low-value content, not an absence signal.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/http-network-errors',
      'https://support.google.com/webmasters/answer/181708',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-004',
    category: 'technical',
    name: 'Monitor server health against Googlebot',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'All crawl requests from verified Googlebot',
    rule: 'Track the rate of 5xx, 429, and DNS-failure responses to verified Googlebot requests; investigate when failures exceed 5% of requests in a monitoring window.',
    verification: 'Aggregate crawl log entries (filtered to verified Googlebot) by HTTP status; alert when the failing share crosses the threshold.',
    metric: {
      name: 'Crawl requests failing with 5xx/429/DNS error',
      unit: 'percent',
      official_threshold: null,
      project_target: '≤5%',
    },
    caveats: [
      'The 5% figure is a project alerting convention for operational monitoring, not a documented Google cutoff.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/http-network-errors',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-005',
    category: 'technical',
    name: 'Permit crawling of important content',
    priority: 'P0',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: '/robots.txt and the content it governs',
    rule: 'robots.txt must stay under the 500 KiB interpreted-size limit and must not disallow important public content or the CSS/JS assets needed to render it.',
    verification: 'Fetch /robots.txt, check byte size against the limit, and diff Disallow rules against the page inventory\'s indexable URLs.',
    metric: {
      name: 'robots.txt size',
      unit: 'bytes',
      official_threshold: '500 KiB (Google stops reading beyond this)',
      project_target: '< 500 KiB',
    },
    caveats: [
      'Disallowing a noindex page in robots.txt prevents Google from reading the noindex directive — see TECH-007.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-006',
    category: 'technical',
    name: 'Remove accidental noindex',
    priority: 'P0',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'URLs with indexing_intent index',
    rule: 'Only pages intentionally excluded from Search should carry a noindex directive, whether via the robots meta tag or the X-Robots-Tag HTTP header.',
    verification: 'For every page with indexing_intent \'index\', confirm neither the rendered meta robots tag nor the X-Robots-Tag header contains noindex.',
    metric: {
      name: 'Indexable pages carrying an unintended noindex directive',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'A noindex directive can be inherited from a shared template; check the directive actually served, not just the source template.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-007',
    category: 'technical',
    name: 'Allow crawling of noindex pages',
    priority: 'P1',
    evidence: 'confirmed_mechanism',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'URLs with indexing_intent noindex',
    rule: 'Pages intentionally marked noindex must still return HTTP 200 and remain crawlable; Google can only honor a noindex directive it is able to fetch and read.',
    verification: 'Fetch pages with indexing_intent \'noindex\' and confirm they return 200, not 401/403 from robots.txt or auth.',
    metric: {
      name: 'Noindex pages blocked from crawling',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Blocking a noindex page in robots.txt is a common mistake that silently defeats the noindex directive.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-015',
    category: 'technical',
    name: 'Verify critical content renders',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'Indexable pages that depend on client-side rendering',
    rule: 'The rendered HTML must contain the page\'s main content — headings, body text, links — not just raw HTML that becomes substantial only after script execution fails or partially completes.',
    verification: 'Compare raw and rendered HTML text length and structure for each indexable page; flag renders that collapse to near-empty content.',
    metric: {
      name: 'Indexable pages where rendering loses the main content',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Text-length comparison is a proxy signal; use Search Console "View Rendered HTML" for an authoritative check on specific URLs.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-017',
    category: 'technical',
    name: 'Never rely on JavaScript to remove noindex',
    priority: 'P0',
    evidence: 'confirmed_mechanism',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'URLs with indexing_intent index',
    rule: 'The initial (raw) HTML must already carry the correct robots directive. If Google sees noindex in the raw HTML it may stop processing before executing JavaScript, so a script that removes noindex afterward can be too late.',
    verification: 'Fetch raw HTML (no JS execution) for every indexable page and confirm no noindex directive is present.',
    metric: {
      name: 'Indexable pages with noindex in the initial HTML',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-018',
    category: 'technical',
    name: 'Keep canonical consistent between raw and rendered HTML',
    priority: 'P1',
    evidence: 'confirmed_mechanism',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'All pages',
    rule: 'The canonical tag\'s href must be identical in the initial HTML and after JavaScript execution; a canonical that changes at runtime sends Google a signal it may discount.',
    verification: 'Compare the canonical href extracted from raw HTML against the one in rendered HTML for each page.',
    metric: {
      name: 'Pages where canonical differs between raw and rendered HTML',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-021',
    category: 'technical',
    name: 'Maintain mobile content parity',
    priority: 'P1',
    evidence: 'confirmed_mechanism',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'Indexable pages',
    rule: 'The mobile rendering of a page must expose the same main content, headings, links, images, and metadata as any other version — Google primarily uses the mobile version for indexing (mobile-first indexing).',
    verification: 'Render each indexable page in a mobile viewport and confirm headings and body content are present and substantial.',
    metric: {
      name: 'Indexable pages missing main content on mobile render',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-022',
    category: 'technical',
    name: 'Keep resources under Googlebot fetch limits',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: 'Each individually fetched resource (HTML, CSS, JS, PDF)',
    rule: 'Googlebot stops fetching a resource at 2 MB uncompressed (64 MB for PDFs); content past that point is never seen, so critical content must load before the limit.',
    verification: 'Measure the uncompressed byte size of each page\'s HTML response and compare against the fetch limit.',
    metric: {
      name: 'Resources exceeding the per-resource fetch limit',
      unit: 'count',
      official_threshold: '2 MB uncompressed per resource (64 MB for PDFs)',
      project_target: 'within official limits',
    },
    caveats: [
      'The limit applies per resource, not to the total weight of a page\'s combined assets.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/googlebot',
    ],
    last_verified_at: '2026-10-29',
  },

  // ---------------------------------------------------------------------
  // Phase 3: Canonicalization and Architecture
  // ---------------------------------------------------------------------
  {
    id: 'TECH-008',
    category: 'technical',
    name: 'Serve a valid robots.txt',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'eligibility',
    automation: 'automatic',
    scope: '/robots.txt',
    rule: 'robots.txt must be valid UTF-8 text with correctly formed directives (User-agent, Disallow, Allow, Sitemap) that Google\'s parser can interpret.',
    verification: 'Parse the live robots.txt and confirm directive syntax, encoding, and overall structure are well-formed.',
    metric: {
      name: 'robots.txt parse errors',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'An unreachable or malformed robots.txt does not reliably block crawling — treat validity as a correctness requirement, not a safety net.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-009',
    category: 'technical',
    name: 'Align canonicalization signals',
    priority: 'P1',
    evidence: 'confirmed_mechanism',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Indexable pages',
    rule: 'The canonical tag, sitemap entry, and internal links for a page should all agree on the same URL; conflicting signals make Google\'s canonical selection less predictable.',
    verification: 'For each indexable page, compare its canonical tag, its sitemap <loc>, and the URLs used to link to it internally.',
    metric: {
      name: 'Pages with conflicting canonicalization signals',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Google can still select a different canonical than declared even when all project-controlled signals agree — see TECH-011.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-010',
    category: 'technical',
    name: 'Self-referential canonical by default',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Indexable pages',
    rule: 'Every indexable page should carry a canonical tag pointing at its own URL, unless it is intentionally being deduplicated into a different URL.',
    verification: 'Confirm the canonical tag\'s href matches the page\'s own intended_canonical for every indexable page.',
    metric: {
      name: 'Indexable pages missing a self-referential canonical',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'A page can intentionally canonicalize elsewhere (e.g. a filtered list view pointing at the unfiltered page); flag for review, not automatic failure.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-011',
    category: 'technical',
    name: 'Inspect Google\'s chosen canonical',
    priority: 'P2',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'manual',
    scope: 'High-priority indexable pages',
    rule: 'Periodically confirm, via Search Console URL Inspection, that Google\'s selected canonical for high-priority pages matches the intended canonical.',
    verification: 'Use the URL Inspection API/UI to check the "Google-selected canonical" field for a sample of high-priority indexable pages.',
    metric: {
      name: 'High-priority pages where Google\'s selected canonical mismatches intent',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'This can only be observed through Search Console; it cannot be inferred from page content alone, so it always requires manual review.',
    ],
    sources: [
      'https://support.google.com/webmasters/answer/9012289',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-012',
    category: 'technical',
    name: 'Keep sitemaps focused on indexable URLs',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'automatic',
    scope: '/sitemap.xml',
    rule: 'Sitemaps should list only canonical, indexable URLs — never noindex, private, redirect, or gone pages, and never non-canonical duplicates.',
    verification: 'Cross-check every sitemap <loc> against the inventory\'s indexing_intent; flag any entry that isn\'t \'index\'.',
    metric: {
      name: 'Non-indexable URLs listed in the sitemap',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Listing a noindex URL in the sitemap sends Google a mixed signal even though it does not force indexing.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-013',
    category: 'technical',
    name: 'Respect sitemap size and URL-count limits',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Each individual sitemap file',
    rule: 'Each sitemap file must stay within 50,000 URLs and 50 MB uncompressed; larger inventories must be split across multiple sitemap files referenced by a sitemap index.',
    verification: 'Count <url> entries and measure byte size of each generated sitemap file; split and index when either limit is exceeded.',
    metric: {
      name: 'Sitemap file URL count / byte size',
      unit: 'count / bytes',
      official_threshold: '50,000 URLs / 50 MB uncompressed per file',
      project_target: 'within official limits',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-025',
    category: 'technical',
    name: 'Expose crawlable pagination links',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Paginated listing pages',
    rule: 'Every paginated page must expose real, crawlable <a href> links to adjacent pages rather than JS-only "next/previous" controls; rel=next/prev is not used by Google as a grouping signal.',
    verification: 'Render each paginated page and confirm an <a href> to the next/previous page exists in the HTML.',
    metric: {
      name: 'Paginated pages without crawlable adjacent-page links',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Google deprecated rel=next/prev in 2019 — do not rely on it as a canonicalization or grouping mechanism.',
    ],
    sources: [
      'https://developers.google.com/search/blog/2019/03/pagination-doesnt-use-relnext',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-028',
    category: 'technical',
    name: 'Map redirects to relevant destinations',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'All redirect map entries',
    rule: 'Redirect each retired URL to the most relevant replacement page, not a generic fallback like the homepage, unless the source genuinely was the homepage.',
    verification: 'Review every redirect map entry\'s destination for topical relevance to its source.',
    metric: {
      name: 'Redirects pointing at a generic fallback instead of a relevant page',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Relevance is a judgment call the automated check can only approximate (e.g. flagging a generic "/" destination); it does not replace editorial review.',
    ],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-029',
    category: 'technical',
    name: 'Minimize redirect chains',
    priority: 'P1',
    evidence: 'confirmed_mechanism',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'All redirect map entries',
    rule: 'Each redirect should resolve to its final destination in a single hop; multi-hop chains and loops waste crawl budget and can prevent Google from reaching the destination at all.',
    verification: 'Walk every redirect entry\'s destination chain; flag chains longer than one hop and any that loop back on themselves.',
    metric: {
      name: 'Redirect chains longer than one hop',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-030',
    category: 'technical',
    name: 'Retain migration redirects for at least one year',
    priority: 'P2',
    evidence: 'official_recommendation',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Redirects created during a URL migration',
    rule: 'Retain redirects created during a site migration or URL change for at least one year before considering removal, giving Google time to transfer signals to the new URL.',
    verification: 'Confirm each redirect\'s retain_until date is at least one year after its created_at date, and that it hasn\'t already passed.',
    metric: {
      name: 'Migration redirects retired before one year',
      unit: 'count',
      official_threshold: '≥1 year (official recommendation)',
      project_target: '0',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-031',
    category: 'technical',
    name: 'Distinct URLs for every language variant',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Translated/localized content',
    rule: 'Each language or regional variant of a page must live at its own distinct URL; hreflang cannot substitute for separate URLs.',
    verification: 'For every translation group, confirm each member has a unique canonical URL and that no two members share a locale.',
    metric: {
      name: 'Translation groups with duplicate URLs or duplicate locales',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/specialty/international/localized-versions',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'TECH-032',
    category: 'technical',
    name: 'Implement valid, reciprocal hreflang',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'discovery',
    automation: 'automatic',
    scope: 'Translated/localized content',
    rule: 'hreflang annotations must use valid BCP 47 language/region codes, be reciprocal across all variants in the group, and include a self-reference for each page.',
    verification: 'Validate each translation group\'s hreflang codes against a BCP-47-shaped pattern and confirm the set is fully reciprocal.',
    metric: {
      name: 'Invalid or non-reciprocal hreflang entries',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Google ignores an entire hreflang set if it finds return-tag errors, so partial correctness does not provide partial benefit.',
    ],
    sources: [
      'https://developers.google.com/search/docs/specialty/international/localized-versions',
    ],
    last_verified_at: '2026-10-29',
  },

  // ---------------------------------------------------------------------
  // Phase 4: Page Content and Presentation
  // ---------------------------------------------------------------------
  {
    id: 'CONTENT-003',
    category: 'on_page',
    name: 'Descriptive, distinct titles',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'appearance',
    automation: 'automatic',
    scope: 'Indexable pages',
    rule: 'Every indexable page needs a specific, non-generic <title> that is distinct from every other page\'s title; Google frequently rewrites unhelpful titles in the search snippet.',
    verification: 'Confirm every indexable page has a non-empty title that isn\'t a generic placeholder and doesn\'t duplicate another indexable page\'s title.',
    metric: {
      name: 'Indexable pages with missing, generic, or duplicate titles',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'There is no required title length — Google typically displays roughly 32-60 characters, but a longer title is not an error.',
    ],
    sources: [
      'https://developers.google.com/search/docs/appearance/title-link',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-004',
    category: 'on_page',
    name: 'One clear main heading',
    priority: 'P2',
    evidence: 'official_recommendation',
    impact: 'appearance',
    automation: 'automatic',
    scope: 'Indexable pages',
    rule: 'Every indexable page should have exactly one clear <h1> that identifies the page\'s main topic.',
    verification: 'Count <h1> elements in the rendered HTML of each indexable page; flag zero or more than one.',
    metric: {
      name: 'Indexable pages with zero or multiple <h1> elements',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Google can infer a heading from other signals when no <h1> is present; this is a presentation-quality check, not a hard indexing requirement.',
    ],
    sources: [
      'https://developers.google.com/search/docs/appearance/structured-data',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-005',
    category: 'on_page',
    name: 'Useful, distinct meta descriptions',
    priority: 'P2',
    evidence: 'official_recommendation',
    impact: 'appearance',
    automation: 'automatic',
    scope: 'Indexable pages',
    rule: 'Provide a substantive, page-specific meta description; Google uses it as a candidate for the search snippet but may rewrite it when it judges a better snippet is available.',
    verification: 'Confirm every indexable page has a meta description that is present, reasonably substantive, and distinct from other pages\'.',
    metric: {
      name: 'Indexable pages with missing, trivial, or duplicate meta descriptions',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Meta descriptions do not influence ranking; they only affect the displayed snippet, and Google may replace them regardless of quality.',
    ],
    sources: [
      'https://developers.google.com/search/docs/appearance/snippet',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-006',
    category: 'on_page',
    name: 'Consistent declared language',
    priority: 'P2',
    evidence: 'engineering_practice',
    impact: 'experience',
    automation: 'automatic',
    scope: 'All pages',
    rule: 'The declared document language (<html lang>) should match the page\'s intended locale, and title/body content shouldn\'t be in a different language than declared.',
    verification: 'Compare the rendered <html lang> attribute against the page\'s inventory locale.',
    metric: {
      name: 'Pages with declared language mismatching inventory locale',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'This is a best-effort heuristic check; genuine language/content-match review needs editorial judgment, not just attribute comparison.',
    ],
    sources: [
      'https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-009',
    category: 'content_quality',
    name: 'Publish original value',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'quality',
    automation: 'manual',
    scope: 'Priority indexable pages',
    rule: 'Priority indexable content should offer original value beyond what competitors or syndicated sources already provide, rather than being thin or substantially duplicative.',
    verification: 'Editorial review: confirm the page offers something a reader can\'t already get elsewhere before publishing or re-indexing.',
    metric: {
      name: 'Priority pages reviewed for original value',
      unit: 'percent',
      official_threshold: null,
      project_target: '100% of priority pages reviewed',
    },
    caveats: [
      'Originality and helpfulness cannot be scored automatically from page content; this always requires genuine editorial judgment.',
    ],
    sources: [
      'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-010',
    category: 'content_quality',
    name: 'Substantiate factual claims',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'trust',
    automation: 'manual',
    scope: 'Article content',
    rule: 'Factual claims in article content should be substantiated with citations or verifiable evidence.',
    verification: 'Editorial fact-checking review of article content before publication.',
    metric: {
      name: 'Article pages fact-checked before publishing',
      unit: 'percent',
      official_threshold: null,
      project_target: '100% of article content reviewed',
    },
    caveats: [
      'Fact-checking is inherently an editorial process; no automated check can verify the truth of a claim.',
    ],
    sources: [
      'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-011',
    category: 'content_quality',
    name: 'Show accountable authorship',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'trust',
    automation: 'mixed',
    scope: 'Article content',
    rule: 'Article content should carry an accountable author — a real name plus a profile URL or stated credential — rather than being unattributed or attributed to a generic byline.',
    verification: 'Confirm every article-type indexable page has an author name, and either a profile URL or a stated credential recorded.',
    metric: {
      name: 'Article pages missing accountable authorship',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Recording an author name and profile link establishes accountability bookkeeping; it does not itself establish genuine expertise.',
    ],
    sources: [
      'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-012',
    category: 'content_quality',
    name: 'Update content when the topic changes',
    priority: 'P2',
    evidence: 'engineering_practice',
    impact: 'quality',
    automation: 'automatic',
    scope: 'High-priority indexable pages',
    rule: 'Review high-priority content periodically and update it when the underlying topic has changed, rather than letting it go stale indefinitely.',
    verification: 'Flag high-priority indexable pages whose last substantive update is older than a review threshold for editorial attention.',
    metric: {
      name: 'High-priority pages exceeding the freshness review threshold',
      unit: 'URL count',
      official_threshold: null,
      project_target: 'reviewed within threshold',
    },
    caveats: [
      'There is no official Google "freshness" threshold; the review window is a project convention, and content age alone never implies the content is wrong.',
    ],
    sources: [
      'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-013',
    category: 'content_quality',
    name: 'Keep publication and update dates honest',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'trust',
    automation: 'automatic',
    scope: 'All pages with a publication date',
    rule: 'Publication and update dates must be internally coherent: an update date can\'t precede the publication date, and neither date may be set in the future.',
    verification: 'Parse publication and update dates for every page and confirm their ordering and that neither is in the future.',
    metric: {
      name: 'Pages with incoherent or future-dated publication/update dates',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'This checks internal date coherence only; it cannot detect a plausible but fabricated date.',
    ],
    sources: [
      'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-015',
    category: 'content_quality',
    name: 'Review AI-generated content before publishing',
    priority: 'P1',
    evidence: 'official_recommendation',
    impact: 'quality',
    automation: 'automatic',
    scope: 'AI-assisted content',
    rule: 'AI-assisted content must have a recorded human editorial review before, or as part of, publication; AI assistance is not a substitute for editorial accountability.',
    verification: 'For every page marked AI-assisted, confirm a human review is recorded and is not after the publication date.',
    metric: {
      name: 'AI-assisted pages missing a recorded human review',
      unit: 'URL count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'Recording a review timestamp confirms the bookkeeping exists; it does not verify the review was substantive.',
    ],
    sources: [
      'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-020',
    category: 'structured_data',
    name: 'Generate structured data from shared page data',
    priority: 'P1',
    evidence: 'engineering_practice',
    impact: 'appearance',
    automation: 'automatic',
    scope: 'Pages declaring applicable structured-data features',
    rule: 'Structured data markup should be generated programmatically from the same page data used elsewhere (title, canonical, dates, author), never hand-authored in parallel where it can drift out of sync.',
    verification: 'Confirm every declared applicable feature has a corresponding markup generator, rather than being hand-maintained separately.',
    metric: {
      name: 'Declared structured-data features without a markup generator',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [],
    sources: [
      'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
    ],
    last_verified_at: '2026-10-29',
  },
  {
    id: 'CONTENT-021',
    category: 'structured_data',
    name: 'Validate structured data before publishing',
    priority: 'P1',
    evidence: 'requirement',
    impact: 'appearance',
    automation: 'automatic',
    scope: 'Generated structured data objects',
    rule: 'Generated structured data must include every field required by its declared @type before publishing; invalid or incomplete markup can disqualify a page from the associated rich result.',
    verification: 'Validate every generated JSON-LD object against its @type\'s required-field set before deploying.',
    metric: {
      name: 'Structured data objects missing a required field',
      unit: 'count',
      official_threshold: null,
      project_target: '0',
    },
    caveats: [
      'This is a minimal required-field check, not full schema.org conformance validation — use Search Console / the Rich Results Test for that.',
    ],
    sources: [
      'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
    ],
    last_verified_at: '2026-10-29',
  },
];

/**
 * Get all rules
 */
export function getAllRules(): Rule[] {
  if (!allRulesCache) {
    allRulesCache = rulesDefinition;
  }
  return allRulesCache;
}

/**
 * Get a rule by ID
 */
export function getRule(ruleId: string): Rule | undefined {
  if (!rulesCache) {
    rulesCache = new Map(rulesDefinition.map((r) => [r.id, r]));
  }
  return rulesCache.get(ruleId);
}

/**
 * Get rules by category
 */
export function getRulesByCategory(category: RuleCategory): Rule[] {
  return getAllRules().filter((r) => r.category === category);
}

/**
 * Get rules by priority
 */
export function getRulesByPriority(priority: RulePriority): Rule[] {
  return getAllRules().filter((r) => r.priority === priority);
}

/**
 * Get rules by evidence level
 */
export function getRulesByEvidence(evidence: EvidenceLevel): Rule[] {
  return getAllRules().filter((r) => r.evidence === evidence);
}

/**
 * Get P0 (critical) rules
 */
export function getCriticalRules(): Rule[] {
  return getRulesByPriority('P0');
}

/**
 * Rule statistics
 */
export function getRuleStatistics() {
  const rules = getAllRules();

  const byCategory = new Map<RuleCategory, number>();
  const byPriority = new Map<RulePriority, number>();
  const byEvidence = new Map<EvidenceLevel, number>();

  rules.forEach((rule) => {
    byCategory.set(rule.category, (byCategory.get(rule.category) || 0) + 1);
    byPriority.set(rule.priority, (byPriority.get(rule.priority) || 0) + 1);
    byEvidence.set(rule.evidence, (byEvidence.get(rule.evidence) || 0) + 1);
  });

  return {
    total: rules.length,
    byCategory: Object.fromEntries(byCategory),
    byPriority: Object.fromEntries(byPriority),
    byEvidence: Object.fromEntries(byEvidence),
  };
}
