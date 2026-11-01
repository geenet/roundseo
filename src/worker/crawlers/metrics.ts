import { evaluateAssurance } from './assurance/engine';
import type { AuditAssurance } from './assurance/types';
import type { PageMetrics } from './parser';
import type { CrawlDiscovery } from './base';
import type { Availability, CrawlCoverage, EvidenceKind, TechnicalHealth } from '../../shared/operating-model';

export const CRAWL_RULE_SET_VERSION = '2026.10.6';

export interface IssueEvidence {
  url: string;
  element: string;
  observed: string;
  recommendation: string;
  relatedUrls?: string[];
}

/** A crawl outcome retained even when no HTML was available to parse. */
export interface CrawlObservation {
  url: string;
  finalUrl?: string;
  depth: number;
  statusCode: number;
  error?: string;
  redirected?: boolean;
  blockedByRobots?: boolean;
}

export interface AuditFinding {
  category: 'technical' | 'indexability' | 'onpage' | 'content' | 'linking';
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Stable evaluation identifier, separate from the owner-facing title. */
  ruleId?: string;
  ruleVersion?: string;
  evidenceKind?: EvidenceKind;
  availability?: Availability;
  confidence?: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  effort: 'quick_win' | 'medium' | 'complex';
  evidence: IssueEvidence[];
  matchCount?: number;
  affectedUrlCount?: number;
  evidenceTruncated?: boolean;
}

export interface SiteMetrics {
  assurance: AuditAssurance;
  /** Legacy compatibility only. Use technicalHealth for owner-facing reporting. */
  overallScore: number;
  onPageScore: number;
  contentScore: number;
  technicalScore: number;
  indexabilityScore: number;
  performanceScore: number;
  internalLinkingScore: number;
  totalPages: number;
  indexablePages: number;
  pagesWithoutTitle: number;
  pagesWithDuplicateTitle: number;
  pagesWithoutMetaDescription: number;
  pagesWithDuplicateMetaDescription: number;
  pagesWithMissingH1: number;
  pagesWithMultipleH1: number;
  thinContentPages: number;
  duplicateContentPages: number;
  pagesWithMissingAlt: number;
  pagesWithoutCanonical: number;
  pagesWithoutViewport: number;
  pagesWithoutLanguage: number;
  pagesWithoutStructuredData: number;
  pagesWithTitleLengthToReview: number;
  pagesWithMetaLengthToReview: number;
  pagesWithHeadingHierarchyIssues: number;
  pagesWithNonSelfCanonical: number;
  pagesRequiringJavaScriptRendering: number;
  crawlFailures: number;
  pagesWithHttpErrors: number;
  redirectedPages: number;
  orphanedPages: number;
  deeplyNestedPages: number;
  pagesWithoutInternalLinks: number;
  pagesWithGenericAnchors: number;
  averageWordCount: number;
  pagesWithIssues: number;
  technicalHealth: TechnicalHealth;
  crawlCoverage: CrawlCoverage;
  findings: AuditFinding[];
}

export interface CrawlScopeOptions {
  maxPages?: number;
  maxDepth?: number;
  rendered?: boolean;
  limitReached?: boolean;
  discoveredUrls?: number;
  discovery?: CrawlDiscovery;
}

export function calculateSiteMetrics(pages: Array<PageMetrics | LegacyPageMetrics>, crawlObservations: CrawlObservation[] = [], scope: CrawlScopeOptions = {}): SiteMetrics {
  const normalizedPages = pages.map(page => ({ ...normalizePage(page), mainContentText: page.mainContentText }));
  return calculateNormalizedSiteMetrics(normalizedPages, crawlObservations, scope);
}

type LegacyPageMetrics = Partial<PageMetrics> & { pageUrl?: string };

function calculateNormalizedSiteMetrics(pages: PageMetrics[], crawlObservations: CrawlObservation[], scope: CrawlScopeOptions): SiteMetrics {
  const crawlCoverage = calculateCrawlCoverage(pages, crawlObservations, scope);
  const technicalHealth = calculateTechnicalHealth(pages, crawlObservations, scope);
  const assurance = evaluateAssurance(pages, scope);
  if (pages.length === 0) {
    const findings: AuditFinding[] = [];
    pushCrawlFindings(findings, [], crawlObservations);
    return {
      ...emptyMetrics(),
      assurance,
      crawlFailures: crawlObservations.filter(observation => observation.statusCode === 0 && !observation.blockedByRobots).length,
      pagesWithHttpErrors: crawlObservations.filter(observation => observation.statusCode >= 400).length,
      redirectedPages: crawlObservations.filter(observation => observation.redirected).length,
      pagesWithIssues: new Set(findings.flatMap(finding => finding.evidence.map(item => item.url))).size,
      technicalHealth,
      crawlCoverage,
      findings: enrichFindings(findings),
    };
  }
  const titleGroups = groupPages(pages, page => normalize(page.title));
  const metaGroups = groupPages(pages, page => normalize(page.metaDescription));
  const contentGroups = groupPages(pages, page => page.contentFingerprint);
  const internalInlinks = new Map<string, number>();
  const pageUrls = new Set(pages.map(page => normalizeUrl(page.url)));
  const evaluatedObservations = crawlObservations.filter(observation => !observation.blockedByRobots);
  const crawlErrorRate = evaluatedObservations.length
    ? evaluatedObservations.filter(observation => observation.statusCode === 0 || observation.statusCode >= 400).length / evaluatedObservations.length
    : 0;

  for (const page of pages) {
    for (const link of page.links.filter(item => item.isInternal && item.target)) {
      const target = normalizeUrl(link.target!);
      if (pageUrls.has(target)) internalInlinks.set(target, (internalInlinks.get(target) || 0) + 1);
    }
  }

  const metrics: Omit<SiteMetrics, 'findings' | 'technicalHealth' | 'crawlCoverage' | 'assurance'> = {
    overallScore: technicalHealth.value ?? 0,
    onPageScore: average(pages.map(calculateOnPageScore)),
    contentScore: average(pages.map(calculateContentScore)),
    technicalScore: Math.max(0, average(pages.map(calculateTechnicalScore)) - Math.round(crawlErrorRate * 60)),
    indexabilityScore: Math.round((pages.filter(page => page.isIndexable).length / pages.length) * 100),
    performanceScore: 0,
    internalLinkingScore: 0,
    totalPages: pages.length,
    indexablePages: pages.filter(page => page.isIndexable).length,
    pagesWithoutTitle: pages.filter(page => !page.title).length,
    pagesWithDuplicateTitle: duplicatePageCount(titleGroups),
    pagesWithoutMetaDescription: pages.filter(page => !page.metaDescription).length,
    pagesWithDuplicateMetaDescription: duplicatePageCount(metaGroups),
    pagesWithMissingH1: pages.filter(page => !page.requiresJavaScriptRendering && page.h1Count === 0).length,
    pagesWithMultipleH1: pages.filter(page => !page.requiresJavaScriptRendering && page.h1Count > 1).length,
    thinContentPages: pages.filter(page => !page.requiresJavaScriptRendering && (page.wordCount < 250 || page.textToHtmlRatio < 10)).length,
    duplicateContentPages: duplicatePageCount(contentGroups),
    pagesWithMissingAlt: pages.filter(page => page.imagesWithoutAlt > 0).length,
    pagesWithoutCanonical: pages.filter(page => page.inspectionComplete && !page.canonicalTag).length,
    pagesWithoutViewport: pages.filter(page => page.inspectionComplete && !page.hasViewport).length,
    pagesWithoutLanguage: pages.filter(page => page.inspectionComplete && !page.lang).length,
    pagesWithoutStructuredData: pages.filter(page => page.inspectionComplete && !page.hasStructuredData).length,
    pagesWithTitleLengthToReview: pages.filter(page => hasTitleLengthToReview(page)).length,
    pagesWithMetaLengthToReview: pages.filter(page => hasMetaLengthToReview(page)).length,
    pagesWithHeadingHierarchyIssues: pages.filter(page => hasHeadingHierarchyIssue(page)).length,
    pagesWithNonSelfCanonical: pages.filter(page => page.inspectionComplete && Boolean(page.canonicalTag) && page.canonicalIsSelf === false).length,
    pagesRequiringJavaScriptRendering: pages.filter(page => page.requiresJavaScriptRendering).length,
    crawlFailures: crawlObservations.filter(observation => observation.statusCode === 0 && !observation.blockedByRobots).length,
    pagesWithHttpErrors: crawlObservations.filter(observation => observation.statusCode >= 400).length,
    redirectedPages: crawlObservations.filter(observation => observation.redirected).length,
    orphanedPages: pages.filter(page => !isHomepage(page.url) && (internalInlinks.get(normalizeUrl(page.url)) || 0) === 0).length,
    deeplyNestedPages: pages.filter(page => (page.crawlDepth || 0) > 3).length,
    pagesWithoutInternalLinks: pages.filter(page => !page.requiresJavaScriptRendering && page.internalLinks === 0).length,
    pagesWithGenericAnchors: pages.filter(page => page.nonDescriptiveInternalAnchors > 0).length,
    averageWordCount: Math.round(pages.reduce((sum, page) => sum + page.wordCount, 0) / pages.length),
    pagesWithIssues: 0,
  };

  metrics.internalLinkingScore = calculateLinkingScore(metrics);
  metrics.performanceScore = 0; // Field/lab performance is collected by its own integration, never guessed by a crawl.
  const findings = enrichFindings(buildFindings(pages, titleGroups, metaGroups, contentGroups, crawlObservations));
  // Existing finding families retain their stable IDs and action history.
  // New dimensions feed the same evidence and owner workflow.
  const additionalControls = new Set(['access.refresh', 'access.charset', 'metadata.viewport_zoom', 'canonical.head', 'canonical.absolute', 'links.empty', 'media.source', 'media.dimensions', 'international.language_valid', 'international.hreflang_valid', 'international.hreflang_absolute', 'international.hreflang_unique', 'international.hreflang_return', 'schema.objects', 'schema.type', 'schema.context']);
  for (const control of assurance.controls.filter(c => additionalControls.has(c.id) && ['fail', 'review'].includes(c.status))) {
    const evidence = control.evidence.map(item => ({ ...item, element: control.name, recommendation: control.requirement }));
    findings.push({ ruleId: control.id, ruleVersion: assurance.version, category: 'technical', priority: control.severity, confidence: control.status === 'review' ? 'medium' : 'high', evidenceKind: control.status === 'review' ? 'inferred' : 'observed', availability: control.unknown > 0 ? 'partial' : 'measured', title: control.name, description: control.requirement, impact: `Review ${control.group.toLowerCase()} evidence for the affected URLs.`, effort: 'medium', evidence, affectedUrlCount: control.failed, evidenceTruncated: control.evidenceTruncated });
  }
  findings.sort((a,b) => priorityValue(a.priority)-priorityValue(b.priority));
  metrics.pagesWithIssues = new Set(findings.flatMap(finding => finding.evidence.map(item => item.url))).size;
  return { ...metrics, assurance, technicalHealth, crawlCoverage, findings };
}

function buildFindings(pages: PageMetrics[], titleGroups: Map<string, PageMetrics[]>, metaGroups: Map<string, PageMetrics[]>, contentGroups: Map<string, PageMetrics[]>, crawlObservations: CrawlObservation[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  pushCrawlFindings(findings, pages, crawlObservations);
  const diagnostics = new Map<string, AuditFinding>();
  for (const page of pages) for (const item of page.markupDiagnostics || []) {
    const finding = diagnostics.get(item.code) || {
      ruleId: `markup.${item.code}`, category: 'technical' as const, priority: item.priority,
      title: ({ multiple_titles: 'Multiple title elements', multiple_descriptions: 'Multiple meta descriptions', multiple_canonicals: 'Multiple canonical declarations', canonical_fragment: 'Canonical URL contains a fragment', invalid_canonical: 'Invalid canonical destination', invalid_jsonld: 'Malformed JSON-LD' } as Record<string, string>)[item.code] || item.code,
      description: 'Syntax defect observed in the inspected HTML. Review the recorded declaration and its intended behavior.',
      impact: 'Ambiguous or unreadable declarations reduce control over search processing.', effort: 'quick_win' as const, evidence: [],
    };
    finding.evidence.push({ url: page.url, element: item.element, observed: item.observed, recommendation: item.recommendation });
    diagnostics.set(item.code, finding);
  }
  findings.push(...diagnostics.values());
  pushFinding(findings, pages.filter(page => page.requiresJavaScriptRendering), { category: 'technical', priority: 'medium', title: 'The raw HTML looks like a JavaScript application shell', description: 'The crawler found very little visible page content before JavaScript runs, so content, headings, and internal links cannot be judged reliably from the initial HTML alone.', impact: 'A static crawl may under-report or misclassify page-level content and links.', effort: 'medium', element: 'Initial HTML response', observed: page => `${page.wordCount} visible words before rendering · ${page.contentSource} content source`, recommendation: 'Use JavaScript rendering for this audit, or ensure important content and crawlable links are available in the server-rendered HTML.' });
  pushFinding(findings, pages.filter(page => !page.isIndexable), { category: 'indexability', priority: 'medium', title: 'Pages have a noindex instruction to review', description: 'These pages instruct search engines not to index them. This may be intentional; the crawl does not know each page’s intended indexing status.', impact: 'Pages intended to appear in search may be excluded.', effort: 'quick_win', element: 'Robots meta or X-Robots-Tag', observed: page => page.robotsMeta || 'Contains noindex or none', recommendation: 'Confirm whether this page should appear in search; remove noindex only if indexing is intended.' });
  pushFinding(findings, pages.filter(page => !page.title), { category: 'onpage', priority: 'critical', title: 'Pages are missing a title tag', description: 'A title gives search engines and visitors the clearest first description of the page.', impact: 'Search appearance and relevance signals are incomplete.', effort: 'quick_win', element: '<title>', observed: 'No title tag found', recommendation: 'Add a unique, descriptive title that matches the page’s actual topic.' });
  pushGroupFinding(findings, titleGroups, { category: 'onpage', priority: 'high', title: 'Pages reuse the same title tag', description: 'Repeated titles make it harder to distinguish pages in search results.', impact: 'Search engines and visitors get weaker page-level context.', effort: 'quick_win', element: '<title>', observed: group => `Title ${quoted(group[0].title)} · matches ${group.length - 1} other page${group.length === 2 ? '' : 's'}`, recommendation: 'Write a distinct title for each page, led by the page-specific topic.' });
  pushFinding(findings, pages.filter(hasTitleLengthToReview), { category: 'onpage', priority: 'low', title: 'Title lengths need a relevance review', description: 'Very short or very long titles can make a page’s topic harder to understand at a glance. Length is a review signal, not a ranking rule.', impact: 'Less clear search-result messaging.', effort: 'quick_win', element: '<title>', observed: page => `${page.titleLength || 0} characters`, recommendation: 'Keep the title specific to the page and concise enough to communicate the primary topic clearly.' });
  pushFinding(findings, pages.filter(page => !page.metaDescription), { category: 'onpage', priority: 'high', title: 'Pages are missing meta descriptions', description: 'A strong summary gives searchers context before they decide to visit.', impact: 'Less control over the text shown in search results.', effort: 'quick_win', element: 'meta[name="description"]', observed: 'No meta description found', recommendation: 'Add a concise, benefit-led description that summarizes the page.' });
  pushGroupFinding(findings, metaGroups, { category: 'onpage', priority: 'medium', title: 'Pages reuse the same meta description', description: 'Duplicate summaries make several pages look interchangeable in search.', impact: 'Lower clarity in search snippets.', effort: 'quick_win', element: 'meta[name="description"]', observed: group => `Description ${quoted(group[0].metaDescription)} · matches ${group.length - 1} other page${group.length === 2 ? '' : 's'}`, recommendation: 'Write a distinct summary that adds context beyond the title.' });
  pushFinding(findings, pages.filter(hasMetaLengthToReview), { category: 'onpage', priority: 'low', title: 'Meta descriptions need a clarity review', description: 'Very short or very long descriptions may not give a searcher enough useful context. Length is a review signal, not a ranking rule.', impact: 'Weaker control over search-result messaging.', effort: 'quick_win', element: 'meta[name="description"]', observed: page => `${page.metaDescLength || 0} characters`, recommendation: 'Write a page-specific summary that explains the topic, benefit, or decision it helps a visitor make.' });
  pushFinding(findings, pages.filter(page => !page.requiresJavaScriptRendering && page.h1Count === 0), { category: 'content', priority: 'high', title: 'Pages are missing a primary heading', description: 'A clear H1 aligns the visible page purpose with the topic search engines evaluate.', impact: 'Weaker page structure and topical clarity.', effort: 'quick_win', element: '<h1>', observed: 'No H1 found', recommendation: 'Add one descriptive H1 that states the page’s primary topic or outcome.' });
  pushFinding(findings, pages.filter(page => !page.requiresJavaScriptRendering && page.h1Count > 1), { category: 'content', priority: 'low', title: 'Multiple main headings need a hierarchy review', description: 'More than one H1 is not automatically an SEO failure, but competing main headings can make the page purpose unclear.', impact: 'A visitor or crawler may receive an ambiguous page topic.', effort: 'quick_win', element: '<h1>', observed: 'Multiple H1 elements found', recommendation: 'Confirm each H1 serves the same page purpose; if not, use one clear primary heading and supporting section headings.' });
  pushFinding(findings, pages.filter(hasHeadingHierarchyIssue), { category: 'content', priority: 'low', title: 'Heading levels skip the content hierarchy', description: 'Skipping directly from a broad heading to a much narrower level can make the content outline harder to scan.', impact: 'Less clear content structure for readers and assistive technology.', effort: 'quick_win', element: 'Heading outline', observed: page => `Heading sequence: ${page.headingLevels.map(level => `H${level}`).join(' → ')}`, recommendation: 'Use headings in a logical hierarchy: introduce a section with H2 before using its H3 subsections.' });
  pushFinding(findings, pages.filter(page => !page.requiresJavaScriptRendering && (page.wordCount < 150 || page.textToHtmlRatio < 6)), { category: 'content', priority: 'medium', title: 'Pages need a usefulness review', description: 'Very little primary-page text is a review signal, not a word-count ranking rule. Confirm that the page still explains the offer or enables the visitor’s task.', impact: 'Visitors may not find enough context to complete a decision or task.', effort: 'medium', element: 'Visible main-page text', observed: page => `${page.wordCount} words · ${page.textToHtmlRatio}% text-to-HTML ratio`, recommendation: 'Review the visitor task first. Add only the specifics, proof, explanation, or interactive help the page genuinely needs.' });
  pushGroupFinding(findings, contentGroups, { category: 'content', priority: 'high', title: 'Pages have identical extracted content', description: 'Exact content duplicates split signals and give visitors multiple versions of the same answer.', impact: 'Potential duplicate-content and canonicalization confusion.', effort: 'medium', element: 'Visible page content', observed: group => `Same extracted-content fingerprint ${group[0].contentFingerprint} · matches ${group.length - 1} other page${group.length === 2 ? '' : 's'}`, recommendation: 'Consolidate duplicate pages, differentiate their content, or establish the preferred canonical version.' });
  pushNearDuplicateFinding(findings, pages);
  pushCrossPageFindings(findings, pages, crawlObservations);
  pushFinding(findings, pages.filter(page => page.imagesWithoutAlt > 0), { category: 'content', priority: 'medium', title: 'Images are missing alternative text', description: 'Meaningful images need text alternatives for accessibility and image understanding.', impact: 'Lost context for users and search systems.', effort: 'quick_win', element: '<img alt>', observed: page => `${page.imagesWithoutAlt} image${page.imagesWithoutAlt === 1 ? '' : 's'} without alt text`, recommendation: 'Add concise alt text for meaningful images; use empty alt only for decorative images.' });
  pushFinding(findings, pages.filter(page => page.inspectionComplete && !page.canonicalTag), { category: 'technical', priority: 'medium', title: 'Pages have no canonical URL', description: 'Canonical references clarify which URL should represent substantially similar content.', impact: 'Less control over duplicate URL consolidation.', effort: 'quick_win', element: 'link[rel="canonical"]', observed: 'No canonical link found', recommendation: 'Add a self-referencing canonical to the preferred indexable URL.' });
  pushFinding(findings, pages.filter(page => page.inspectionComplete && Boolean(page.canonicalTag) && page.canonicalIsSelf === false), { category: 'technical', priority: 'medium', title: 'Canonical URLs point away from the crawled page', description: 'A non-self canonical can be intentional, but it deserves confirmation because it asks search engines to consolidate this page elsewhere.', impact: 'Potentially unexpected canonicalization.', effort: 'quick_win', element: 'link[rel="canonical"]', observed: page => `Canonical points to ${page.canonicalTag}`, recommendation: 'Confirm this page should consolidate to that canonical URL; otherwise use the page’s preferred self-referencing URL.' });
  pushFinding(findings, pages.filter(page => page.inspectionComplete && !page.hasViewport), { category: 'technical', priority: 'high', title: 'Pages are missing the mobile viewport declaration', description: 'Without a viewport meta tag, a page may not present correctly on mobile devices.', impact: 'Risk to mobile usability.', effort: 'quick_win', element: 'meta[name="viewport"]', observed: 'No viewport declaration found', recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' });
  pushFinding(findings, pages.filter(page => page.inspectionComplete && !page.lang), { category: 'technical', priority: 'low', title: 'Pages do not declare a document language', description: 'The HTML language helps browsers, assistive technology, and search systems interpret the page.', impact: 'Reduced language clarity and accessibility support.', effort: 'quick_win', element: '<html lang>', observed: 'No lang attribute found', recommendation: 'Set the document language, for example <html lang="en">.' });
  pushFinding(findings, pages.filter(page => !page.requiresJavaScriptRendering && page.internalLinks === 0), { category: 'linking', priority: 'high', title: 'Pages have no internal links out', description: 'Pages should guide users and crawlers to the next relevant destination.', impact: 'Weak site navigation and limited crawl paths.', effort: 'medium', element: 'Internal links', observed: 'No crawlable internal outlinks found', recommendation: 'Add relevant contextual links and a clear next step to related pages.' });
  pushFinding(findings, pages.filter(page => page.nonDescriptiveInternalAnchors > 0), { category: 'linking', priority: 'medium', title: 'Internal links use generic anchor text', description: 'Link text should help users and crawlers understand the destination before they click.', impact: 'Less descriptive internal-link context.', effort: 'quick_win', element: 'Internal anchor text', observed: page => { const anchors = Array.from(new Set(page.links.filter(link => link.isInternal && !link.isDescriptive).map(link => link.anchorText).filter(Boolean))).slice(0, 3).map(anchor => quoted(anchor, 50)).join(', '); return `${page.nonDescriptiveInternalAnchors} generic internal anchor${page.nonDescriptiveInternalAnchors === 1 ? '' : 's'}${anchors ? `: ${anchors}` : ''}`; }, recommendation: 'Replace generic phrases like “learn more” with concise, destination-specific text.' });
  pushFinding(findings, pages.filter(page => (page.crawlDepth || 0) > 3), { category: 'linking', priority: 'medium', title: 'Pages are buried deep in the site structure', description: 'Pages discovered many clicks from the entry point are harder to find and tend to receive fewer internal signals.', impact: 'Lower discoverability for important content.', effort: 'medium', element: 'Crawl depth', observed: page => `Discovered at depth ${page.crawlDepth}`, recommendation: 'Create relevant internal links from more prominent hub, category, or product pages.' });
  return findings.sort((left, right) => priorityValue(left.priority) - priorityValue(right.priority));
}

function pushFinding(output: AuditFinding[], pages: PageMetrics[], definition: Omit<AuditFinding, 'evidence'> & { element: string; observed: string | ((page: PageMetrics) => string); recommendation: string }) { if (!pages.length) return; output.push({ category: definition.category, priority: definition.priority, title: definition.title, description: definition.description, impact: definition.impact, effort: definition.effort, evidence: pages.map(page => ({ url: page.url, element: definition.element, observed: typeof definition.observed === 'function' ? definition.observed(page) : definition.observed, recommendation: definition.recommendation })) }); }
function pushGroupFinding(output: AuditFinding[], groups: Map<string, PageMetrics[]>, definition: Omit<AuditFinding, 'evidence'> & { element: string; recommendation: string; observed?: (group: PageMetrics[]) => string }) { const duplicates = Array.from(groups.values()).filter(group => group.length > 1); if (!duplicates.length) return; output.push({ category: definition.category, priority: definition.priority, title: definition.title, description: definition.description, impact: definition.impact, effort: definition.effort, evidence: duplicates.flatMap(group => group.map(page => ({ url: page.url, element: definition.element, observed: definition.observed ? definition.observed(group) : `Matches ${group.length - 1} other page${group.length === 2 ? '' : 's'}`, recommendation: definition.recommendation, relatedUrls: group.filter(other => other.url !== page.url).slice(0, 5).map(other => other.url) }))) }); }

function pushNearDuplicateFinding(output: AuditFinding[], pages: PageMetrics[]): void {
  const candidates = pages.filter(page => !page.requiresJavaScriptRendering && page.wordCount >= 80 && page.mainContentExcerpt.length >= 240).map(page => ({ page, phrases: excerptShingles(page.mainContentText || page.mainContentExcerpt) }));
  const evidence: IssueEvidence[] = [];
  const affected = new Set<string>();
  let matchCount = 0;
  let sampleSeed = 0x6d2b79f5;
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex].page;
      const right = candidates[rightIndex].page;
      if (left.contentFingerprint === right.contentFingerprint) continue;
      const similarity = excerptSimilarity(candidates[leftIndex].phrases, candidates[rightIndex].phrases);
      if (similarity < 0.58) continue;
      matchCount += 1;
      affected.add(left.url); affected.add(right.url);
      const percentage = Math.round(similarity * 100);
      const fullText = Boolean(left.mainContentText && right.mainContentText);
      const example = { url: left.url, relatedUrls: [right.url], element: 'Main-content similarity', observed: `${percentage}% overlap of three-word phrases with ${right.url}, comparing ${fullText ? 'extracted main text (up to 60,000 characters per page)' : 'saved excerpts (up to 900 characters per page)'}.`, recommendation: 'Compare both pages and their intended audiences. Shared templates or repeated navigation can create a match; decide whether consolidation, differentiation, or a canonical change is appropriate.' };
      if (evidence.length < 200) evidence.push(example);
      else {
        // Deterministic reservoir sampling avoids filling the examples with
        // only the first page in a large cluster of similar templates.
        sampleSeed ^= sampleSeed << 13; sampleSeed ^= sampleSeed >>> 17; sampleSeed ^= sampleSeed << 5;
        const slot = Math.floor(((sampleSeed >>> 0) / 0x1_0000_0000) * matchCount);
        if (slot < evidence.length) evidence[slot] = example;
      }
    }
  }
  if (!evidence.length) return;
  output.push({ category: 'content', priority: 'medium', confidence: 'medium', title: 'Review pages with similar content excerpts', description: `${matchCount} matching pairs across ${affected.size} pages; ${evidence.length} pairs shown. New crawls compare extracted main text up to 60,000 characters; older inputs use saved excerpts. Similarity is a review signal and does not establish whether the pages satisfy different visitor needs.`, impact: 'Pages with substantially similar purposes may compete with one another; shared templates can also create matches.', effort: 'medium', evidence, matchCount, affectedUrlCount: affected.size, evidenceTruncated: matchCount > evidence.length });
}

function excerptShingles(value: string): Set<string> {
    const words = value.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const output = new Set<string>();
    for (let index = 0; index <= words.length - 3; index += 1) output.add(words.slice(index, index + 3).join(' '));
    return output;
}

function pushCrossPageFindings(output: AuditFinding[], pages: PageMetrics[], observations: CrawlObservation[]): void {
  const byUrl = new Map(pages.map(page => [normalizeUrl(page.url), page]));
  const responses = new Map(observations.map(item => [normalizeUrl(item.url), item]));
  const incoming = new Map<string, Set<string>>();
  const canonicalEvidence: IssueEvidence[] = [];
  const noindexLinks: IssueEvidence[] = [];
  const cycles: IssueEvidence[] = [];
  for (const page of pages) {
    for (const link of page.links.filter(link => link.isInternal && link.target)) {
      let target: string;
      try { target = normalizeUrl(link.target!); } catch { continue; }
      if (target !== normalizeUrl(page.url)) {
        const sources = incoming.get(target) || new Set<string>();
        sources.add(page.url); incoming.set(target, sources);
      }
      const destination = byUrl.get(target);
      if (destination && !destination.isIndexable && noindexLinks.length < 200) noindexLinks.push({ url: page.url, relatedUrls: [destination.url], element: 'Internal link to a noindex page', observed: `Anchor ${quoted(link.anchorText)} points to ${destination.url}; observed directive: ${destination.robotsMeta || 'noindex'}.`, recommendation: 'Confirm whether this destination should be excluded from search. Keep useful visitor links when the exclusion is intentional.' });
    }
    if (!page.canonicalTag) continue;
    let canonical: string;
    try { canonical = normalizeUrl(new URL(page.canonicalTag, page.url).href); } catch { continue; }
    const destination = byUrl.get(canonical);
    const response = responses.get(canonical);
    const conflictingNoindex = page.isIndexable && destination?.isIndexable === false;
    const unavailableTarget = response && !response.blockedByRobots && (response.statusCode === 0 || response.statusCode >= 400);
    if (conflictingNoindex || unavailableTarget) canonicalEvidence.push({ url: page.url, relatedUrls: [canonical], element: 'Canonical target', observed: `Canonical ${canonical} ${conflictingNoindex ? `has directive ${destination?.robotsMeta || 'noindex'} while the source permits indexing` : `returned ${response?.statusCode || 'a request failure'}`}.`, recommendation: 'Choose an accessible canonical URL whose indexing instructions match the intended search result.' });
    if (destination?.canonicalTag && canonical !== normalizeUrl(page.url)) {
      try {
        if (normalizeUrl(new URL(destination.canonicalTag, destination.url).href) === normalizeUrl(page.url)) cycles.push({ url: page.url, relatedUrls: [destination.url], element: 'Canonical loop', observed: `${page.url} canonicalizes to ${destination.url}, which canonicalizes back to ${page.url}.`, recommendation: 'Select the intended preferred URL and make both canonical declarations agree on it.' });
      } catch { /* The target canonical was not a usable URL. */ }
    }
  }
  const add = (title: string, priority: AuditFinding['priority'], description: string, evidence: IssueEvidence[], category: AuditFinding['category'] = 'technical') => {
    if (evidence.length) output.push({ category, priority, title, description, impact: description, effort: 'medium', evidence });
  };
  add('Canonical targets are unavailable or marked noindex', 'high', 'The source page points its canonical declaration at a target with conflicting observed availability or indexing instructions.', canonicalEvidence);
  add('Canonical declarations form a two-page loop', 'high', 'Two inspected pages each nominate the other as their canonical URL.', cycles);
  add('Review internal links to noindex pages', 'medium', 'These visitor links lead to pages excluded from search. Exclusion may be intentional; review the destination and link context together. Up to 200 examples are retained.', noindexLinks, 'linking');
  pushFinding(output, pages.filter(page => !isHomepage(page.url) && !page.requiresJavaScriptRendering && !incoming.has(normalizeUrl(page.url))), { category: 'linking', priority: 'medium', title: 'Pages have no incoming links from inspected pages', description: 'No inspected page links to these URLs. They may have been found in a sitemap; links from uninspected pages and external sites remain unknown.', impact: 'Important pages may be difficult to reach through internal navigation.', effort: 'medium', element: 'Observed internal link graph', observed: 'Zero incoming links from another inspected page', recommendation: 'If this page should be discoverable through the site, add a relevant link from a useful hub or related page.' });
}
function excerptSimilarity(leftSet: Set<string>, rightSet: Set<string>): number {
  if (!leftSet.size || !rightSet.size) return 0;
  let intersection = 0;
  for (const item of leftSet) if (rightSet.has(item)) intersection += 1;
  return intersection / (leftSet.size + rightSet.size - intersection);
}
function pushCrawlFindings(output: AuditFinding[], pages: PageMetrics[], observations: CrawlObservation[]) {
  const requestFailures = observations.filter(observation => observation.statusCode === 0 && !observation.blockedByRobots);
  const serverErrors = observations.filter(observation => observation.statusCode >= 500);
  const clientErrors = observations.filter(observation => observation.statusCode >= 400 && observation.statusCode < 500);
  const redirected = observations.filter(observation => observation.redirected && observation.finalUrl && !sameUrl(observation.url, observation.finalUrl));

  if (requestFailures.length) output.push(crawlFinding('critical', 'Some URLs could not be reached during the crawl', 'The crawler could not retrieve these URLs, so their content and links could not be evaluated.', 'Important pages may be unavailable to visitors and search engines.', requestFailures, pages, observation => observation.error ? `Request failed: ${observation.error}` : 'Request failed before an HTTP response was received', 'Confirm the page is publicly reachable, then repair or redirect any internal links that point to it.'));
  if (serverErrors.length) output.push(crawlFinding('critical', 'Some URLs returned server errors', 'Server errors prevent visitors and crawlers from reliably accessing a page.', 'Indexing and user access may be interrupted.', serverErrors, pages, observation => `HTTP ${observation.statusCode}`, 'Investigate the server error and restore a successful response for a page that should be available.'));
  if (clientErrors.length) output.push(crawlFinding('high', 'Some URLs returned client errors', 'These URLs return an error response when the crawler follows them.', 'Visitors and crawlers may reach a dead end.', clientErrors, pages, observation => `HTTP ${observation.statusCode}`, 'Restore the page, redirect it to the most relevant replacement, or remove internal links that point to it.'));
  if (redirected.length) output.push({ category: 'technical', priority: 'low', title: 'Crawled URLs redirect to another destination', description: 'Redirects can be intentional, but direct internal links avoid an unnecessary hop.', impact: 'Less efficient crawling and a slower route for visitors.', effort: 'quick_win', evidence: redirected.map(observation => ({ url: observation.url, element: 'HTTP redirect', observed: `Redirects to ${observation.finalUrl}`, recommendation: 'If this is an internal link target, update links to point directly to the final preferred URL.' })) });
}

function enrichFindings(findings: AuditFinding[]): AuditFinding[] {
  return findings
    .map(finding => ({
      ...finding,
      ruleId: finding.ruleId || `${finding.category}.${slug(finding.title)}`,
      ruleVersion: CRAWL_RULE_SET_VERSION,
      evidenceKind: 'observed' as const,
      availability: 'measured' as const,
      confidence: finding.category === 'content' ? 'medium' as const : 'high' as const,
    }))
    .sort((left, right) => priorityValue(left.priority) - priorityValue(right.priority));
}

function calculateTechnicalHealth(pages: PageMetrics[], observations: CrawlObservation[], scope: CrawlScopeOptions): TechnicalHealth {
  let expectedChecks = 0;
  let evaluatedChecks = 0;
  let failedChecks = 0;
  let unknownChecks = 0;

  for (const observation of observations.filter(item => !item.blockedByRobots)) {
    expectedChecks += 1;
    if (observation.statusCode === 0) {
      evaluatedChecks += 1;
      failedChecks += 1;
    } else if (observation.statusCode >= 400) {
      evaluatedChecks += 1;
      failedChecks += 1;
    } else {
      evaluatedChecks += 1;
    }
  }

  for (const page of pages) {
    const pageChecks = 4; // indexability, canonical, viewport, language; HTTP is observed above.
    expectedChecks += pageChecks;
    if (page.requiresJavaScriptRendering && !scope.rendered) {
      unknownChecks += pageChecks;
      continue;
    }
    evaluatedChecks += pageChecks;
    if (!page.isIndexable) failedChecks += 1;
    if (page.inspectionComplete && !page.canonicalTag) failedChecks += 1;
    if (page.inspectionComplete && !page.hasViewport) failedChecks += 1;
    if (page.inspectionComplete && !page.lang) failedChecks += 1;
  }

  const passedChecks = Math.max(0, evaluatedChecks - failedChecks);
  return {
    value: evaluatedChecks ? Math.round((passedChecks / evaluatedChecks) * 100) : null,
    passedChecks,
    evaluatedChecks,
    expectedChecks,
    unknownChecks,
    ruleSetVersion: CRAWL_RULE_SET_VERSION,
  };
}

function calculateCrawlCoverage(pages: PageMetrics[], observations: CrawlObservation[], scope: CrawlScopeOptions): CrawlCoverage {
  const failedUrls = observations.filter(item => (item.statusCode === 0 || item.statusCode >= 400 || Boolean(item.error)) && !item.blockedByRobots).length;
  const robotsExcludedUrls = observations.filter(item => item.blockedByRobots).length;
  const renderingRequiredPages = pages.filter(page => page.requiresJavaScriptRendering).length;
  const discoveredUrls = Math.max(observations.length, scope.discovery?.discoveredUrls || scope.discoveredUrls || 0);
  const remainingUrls = scope.discovery?.remainingUrls ?? Math.max(0, discoveredUrls - observations.length);
  const limitReached = Boolean(scope.limitReached || scope.discovery?.limitReached || remainingUrls > 0);
  const availability: Availability = !observations.length
    ? 'not_measured'
    : !pages.length && failedUrls > 0
      ? 'failed'
    : limitReached || failedUrls > 0 || robotsExcludedUrls > 0 || scope.discovery?.sitemapStatus === 'partial' || Boolean(scope.discovery?.warnings.length) || (!scope.rendered && renderingRequiredPages > 0)
      ? 'partial'
      : 'measured';
  const method = scope.rendered ? 'browser' : 'http';
  const details = [
    `${discoveredUrls} URLs discovered · ${observations.length} URLs attempted · ${pages.length} unique pages inspected`,
    scope.maxDepth !== undefined ? `depth limited to ${scope.maxDepth}` : undefined,
    remainingUrls ? `${remainingUrls} discovered URL${remainingUrls === 1 ? '' : 's'} not attempted` : undefined,
    robotsExcludedUrls ? `${robotsExcludedUrls} excluded by robots.txt` : undefined,
    failedUrls ? `${failedUrls} failed` : undefined,
    !scope.rendered && renderingRequiredPages ? `${renderingRequiredPages} page${renderingRequiredPages === 1 ? '' : 's'} need browser rendering` : undefined,
  ].filter(Boolean).join(' · ');
  return { availability, inspectedPages: pages.length, discoveredUrls, failedUrls, renderingRequiredPages, limitReached, method, scopeNote: details,
    attemptedUrls: observations.length, remainingUrls, robotsExcludedUrls,
    pendingUrls: scope.discovery?.pendingUrls, sitemapStatus: scope.discovery?.sitemapStatus,
    sitemapFiles: scope.discovery?.sitemapFiles, sitemapUrls: scope.discovery?.sitemapUrls,
    discoveryWarnings: scope.discovery?.warnings };
}
function crawlFinding(priority: AuditFinding['priority'], title: string, description: string, impact: string, observations: CrawlObservation[], pages: PageMetrics[], observed: (observation: CrawlObservation) => string, recommendation: string): AuditFinding {
  return { category: 'technical', priority, title, description, impact, effort: 'medium', evidence: observations.flatMap(observation => {
    const sourceLinks = pages.flatMap(page => page.links.filter(link => link.isInternal && link.target && sameUrl(link.target, observation.url)).map(link => ({ page, link })));
    if (!sourceLinks.length) return [{ url: observation.url, element: 'HTTP response', observed: observed(observation), recommendation }];
    return sourceLinks.map(({ page, link }) => ({ url: page.url, element: 'Internal link', observed: `${link.anchorText ? `“${link.anchorText}” points to ` : ''}${observation.url} · ${observed(observation)}`, recommendation }));
  }) };
}
function calculateOnPageScore(page: PageMetrics): number { let score = 100; if (!page.title) score -= 18; if (!page.metaDescription) score -= 12; if (!page.requiresJavaScriptRendering && page.h1Count !== 1) score -= 12; if (!page.canonicalTag) score -= 6; return Math.max(0, score); }
function calculateContentScore(page: PageMetrics): number { if (page.requiresJavaScriptRendering) return 100; let score = 100; if (page.wordCount < 250) score -= 20; if (page.textToHtmlRatio < 10) score -= 12; if (page.imagesWithoutAlt > 0) score -= Math.min(12, page.imagesWithoutAlt * 3); if (page.h2Count === 0 && page.wordCount > 350) score -= 8; return Math.max(0, score); }
function calculateTechnicalScore(page: PageMetrics): number { let score = 100; if (page.inspectionComplete && !page.hasViewport) score -= 20; if (page.inspectionComplete && !page.lang) score -= 8; if (page.inspectionComplete && !page.canonicalTag) score -= 12; if (!page.isIndexable) score -= 35; return Math.max(0, score); }
function calculateLinkingScore(metrics: Pick<SiteMetrics, 'totalPages' | 'pagesRequiringJavaScriptRendering' | 'pagesWithoutInternalLinks' | 'orphanedPages' | 'deeplyNestedPages' | 'pagesWithGenericAnchors'>): number { let score = 100; const total = Math.max(1, metrics.totalPages - metrics.pagesRequiringJavaScriptRendering); if (total === 0) return score; score -= Math.round((metrics.pagesWithoutInternalLinks / total) * 35); score -= Math.round((metrics.orphanedPages / total) * 30); score -= Math.round((metrics.deeplyNestedPages / total) * 20); score -= Math.round((metrics.pagesWithGenericAnchors / total) * 15); return Math.max(0, score); }
function groupPages(pages: PageMetrics[], selector: (page: PageMetrics) => string): Map<string, PageMetrics[]> { const groups = new Map<string, PageMetrics[]>(); for (const page of pages) { const key = selector(page); if (!key) continue; const existing = groups.get(key) || []; existing.push(page); groups.set(key, existing); } return groups; }
function duplicatePageCount(groups: Map<string, PageMetrics[]>): number { return Array.from(groups.values()).filter(group => group.length > 1).reduce((count, group) => count + group.length, 0); }
function hasTitleLengthToReview(page: PageMetrics): boolean { return Boolean(page.title) && ((page.titleLength || 0) < 25 || (page.titleLength || 0) > 65); }
function hasMetaLengthToReview(page: PageMetrics): boolean { return Boolean(page.metaDescription) && ((page.metaDescLength || 0) < 70 || (page.metaDescLength || 0) > 170); }
function hasHeadingHierarchyIssue(page: PageMetrics): boolean { let previous = 0; for (const level of page.headingLevels) { if (previous && level > previous + 1) return true; previous = level; } return false; }
function quoted(value: string | undefined, limit = 140): string { const normalized = (value || '').replace(/\s+/g, ' ').trim(); return `“${normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized}”`; }
function normalize(value: string | undefined): string { return value?.replace(/\s+/g, ' ').trim().toLowerCase() || ''; }
function normalizeUrl(value: string): string { const url = new URL(value); url.hash = ''; if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, ''); return url.href; }
function sameUrl(left: string, right: string): boolean { try { return normalizeUrl(left) === normalizeUrl(right); } catch { return left === right; } }
function isHomepage(value: string): boolean { return new URL(value).pathname === '/'; }
function average(values: number[]): number { return Math.round(values.reduce((total, value) => total + value, 0) / values.length); }
function priorityValue(priority: AuditFinding['priority']): number { return { critical: 0, high: 1, medium: 2, low: 3 }[priority]; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function normalizePage(page: LegacyPageMetrics): PageMetrics { const url = page.url || page.pageUrl || ''; return { documentEvidence: page.documentEvidence, markupDiagnostics: page.markupDiagnostics, url, inspectionComplete: page.inspectionComplete === true, statusCode: page.statusCode, crawlDepth: page.crawlDepth, title: page.title, titleLength: page.titleLength, metaDescription: page.metaDescription, metaDescLength: page.metaDescLength, h1Count: page.h1Count || 0, h1Text: page.h1Text || [], h2Count: page.h2Count || 0, h2Text: page.h2Text || [], h3Count: page.h3Count || 0, h3Text: page.h3Text || [], headingsCount: page.headingsCount || 0, headingLevels: page.headingLevels || [], contentSource: page.contentSource || 'document', mainContentExcerpt: page.mainContentExcerpt || '', requiresJavaScriptRendering: page.requiresJavaScriptRendering === true, wordCount: page.wordCount || 0, textToHtmlRatio: page.textToHtmlRatio ?? 100, readabilityScore: page.readabilityScore ?? 0, contentFingerprint: page.contentFingerprint || url, imageCount: page.imageCount || 0, imagesWithoutAlt: page.imagesWithoutAlt || 0, internalLinks: page.internalLinks || 0, externalLinks: page.externalLinks || 0, nofollowInternalLinks: page.nofollowInternalLinks || 0, nonDescriptiveInternalAnchors: page.nonDescriptiveInternalAnchors || 0, links: page.links || [], canonicalTag: page.canonicalTag, canonicalIsSelf: page.canonicalIsSelf, robotsMeta: page.robotsMeta, lang: page.lang, hasViewport: page.hasViewport ?? true, hasStructuredData: page.hasStructuredData ?? false, structuredDataTypes: page.structuredDataTypes || [], ogTags: page.ogTags || {}, isIndexable: page.isIndexable !== false, mobileFriendly: page.mobileFriendly }; }
function emptyMetrics(): SiteMetrics { return { assurance: evaluateAssurance([]), overallScore: 0, onPageScore: 0, contentScore: 0, technicalScore: 0, indexabilityScore: 0, performanceScore: 0, internalLinkingScore: 0, totalPages: 0, indexablePages: 0, pagesWithoutTitle: 0, pagesWithDuplicateTitle: 0, pagesWithoutMetaDescription: 0, pagesWithDuplicateMetaDescription: 0, pagesWithMissingH1: 0, pagesWithMultipleH1: 0, thinContentPages: 0, duplicateContentPages: 0, pagesWithMissingAlt: 0, pagesWithoutCanonical: 0, pagesWithoutViewport: 0, pagesWithoutLanguage: 0, pagesWithoutStructuredData: 0, pagesWithTitleLengthToReview: 0, pagesWithMetaLengthToReview: 0, pagesWithHeadingHierarchyIssues: 0, pagesWithNonSelfCanonical: 0, pagesRequiringJavaScriptRendering: 0, crawlFailures: 0, pagesWithHttpErrors: 0, redirectedPages: 0, orphanedPages: 0, deeplyNestedPages: 0, pagesWithoutInternalLinks: 0, pagesWithGenericAnchors: 0, averageWordCount: 0, pagesWithIssues: 0, technicalHealth: { value: null, passedChecks: 0, evaluatedChecks: 0, expectedChecks: 0, unknownChecks: 0, ruleSetVersion: CRAWL_RULE_SET_VERSION }, crawlCoverage: { availability: 'not_measured', inspectedPages: 0, discoveredUrls: 0, failedUrls: 0, renderingRequiredPages: 0, limitReached: false, method: 'http', scopeNote: 'No URL observations were collected.' }, findings: [] }; }
