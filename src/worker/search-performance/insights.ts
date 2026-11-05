// Rules that turn two Search Console windows into the few findings worth acting on.
// Pure functions: no I/O, so each rule is tested directly. Every finding quotes the figures it
// is based on, and rules stay silent when the sample is too small to judge.
import type {
  InsightRule,
  InsightSeverity,
  SearchPerformanceInsight,
  SearchPerformanceItem,
  SearchPerformanceMetrics,
  SearchPerformanceWindow,
} from '../../shared/search-performance';

export const INSIGHT_THRESHOLDS = {
  /** Below this many impressions a rate says little, so click-through rules stay silent. */
  minImpressionsForRate: 50,
  /** Below this many impressions a ranking average is too thin to call a finding. */
  minImpressionsForRank: 20,
  minPreviousClicks: 5,
  minSitePreviousClicks: 10,
  /** Current clicks at or below this share of the previous clicks count as a drop. */
  clickDropRatio: 0.5,
  siteClickDropRatio: 0.7,
  /** Positions past this point are beyond the second page of results. */
  deepPosition: 20,
  firstPageLastPosition: 10,
  topThreePosition: 3,
  maxInsightsPerRule: 5,
  maxInsightsTotal: 20,
} as const;

const SEVERITY_ORDER: Record<InsightSeverity, number> = { warning: 0, opportunity: 1, info: 2 };

function metricsOf(item: SearchPerformanceMetrics): SearchPerformanceMetrics {
  return { clicks: item.clicks, impressions: item.impressions, ctr: item.ctr, position: item.position };
}

function percentLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function positionLabel(position: number): string {
  return position > 0 ? position.toFixed(1) : 'unknown';
}

/** Matches current rows to the previous window's rows by key. */
function previousByKey(items: SearchPerformanceItem[]): Map<string, SearchPerformanceItem> {
  return new Map(items.map(item => [item.key, item]));
}

function topByImpressions(items: SearchPerformanceItem[]): SearchPerformanceItem[] {
  return [...items].sort((a, b) => b.impressions - a.impressions || a.key.localeCompare(b.key));
}

function itemInsights(
  scope: 'page' | 'query',
  current: SearchPerformanceItem[],
  previous: SearchPerformanceItem[],
): SearchPerformanceInsight[] {
  const before = previousByKey(previous);
  const found: SearchPerformanceInsight[] = [];
  const kind = scope;
  const make = (
    rule: InsightRule,
    severity: InsightSeverity,
    item: SearchPerformanceItem,
    title: string,
    detail: string,
    prior: SearchPerformanceItem | undefined,
  ): SearchPerformanceInsight => ({
    id: `${rule}:${scope}:${item.key}`,
    rule,
    severity,
    scope,
    item: item.key,
    title,
    detail,
    metrics: metricsOf(item),
    previous: prior ? metricsOf(prior) : null,
  });

  // Visible in results but not clicked: the page or query is shown on pages one and two, so the
  // snippet or the page's match to the search is the likely problem.
  const visibleNotClicked = topByImpressions(current).filter(item =>
    item.impressions >= INSIGHT_THRESHOLDS.minImpressionsForRate &&
    item.clicks === 0 &&
    item.position > 0 && item.position <= INSIGHT_THRESHOLDS.deepPosition,
  );
  for (const item of visibleNotClicked.slice(0, INSIGHT_THRESHOLDS.maxInsightsPerRule)) {
    found.push(make(
      'visible_not_clicked', 'opportunity', item,
      `${item.impressions.toLocaleString()} impressions, no clicks`,
      `This ${kind} appears in results (average position ${positionLabel(item.position)}) but nobody clicked it. Check its title and description against what people search for.`,
      before.get(item.key),
    ));
  }

  // Ranking beyond the second page: most people never scroll that far, so the page needs real work.
  const deep = topByImpressions(current).filter(item =>
    item.impressions >= INSIGHT_THRESHOLDS.minImpressionsForRank &&
    item.position > INSIGHT_THRESHOLDS.deepPosition,
  );
  for (const item of deep.slice(0, INSIGHT_THRESHOLDS.maxInsightsPerRule)) {
    found.push(make(
      'ranking_beyond_page_two', 'opportunity', item,
      `Average position ${positionLabel(item.position)} across ${item.impressions.toLocaleString()} impressions`,
      `This ${kind} is shown well past the second page of results. Strengthen the content for this search, or consolidate overlapping pages.`,
      before.get(item.key),
    ));
  }

  // Close to the top of page one: a modest improvement moves it into the top three.
  const nearTop = topByImpressions(current).filter(item =>
    item.impressions >= INSIGHT_THRESHOLDS.minImpressionsForRate &&
    item.position > INSIGHT_THRESHOLDS.topThreePosition &&
    item.position <= INSIGHT_THRESHOLDS.firstPageLastPosition,
  );
  for (const item of nearTop.slice(0, INSIGHT_THRESHOLDS.maxInsightsPerRule)) {
    found.push(make(
      'near_first_page', 'opportunity', item,
      `Position ${positionLabel(item.position)} on ${item.impressions.toLocaleString()} impressions`,
      `This ${kind} is on page one but outside the top three. Small gains here usually bring the most extra clicks.`,
      before.get(item.key),
    ));
  }

  // Clicks fell sharply compared with the previous window.
  const falling = current
    .map(item => ({ item, prior: before.get(item.key) }))
    .filter((pair): pair is { item: SearchPerformanceItem; prior: SearchPerformanceItem } =>
      pair.prior !== undefined &&
      pair.prior.clicks >= INSIGHT_THRESHOLDS.minPreviousClicks &&
      pair.item.clicks <= pair.prior.clicks * INSIGHT_THRESHOLDS.clickDropRatio)
    .sort((a, b) => (b.prior.clicks - b.item.clicks) - (a.prior.clicks - a.item.clicks));
  for (const { item, prior } of falling.slice(0, INSIGHT_THRESHOLDS.maxInsightsPerRule)) {
    found.push(make(
      'clicks_down', 'warning', item,
      `Clicks fell from ${prior.clicks.toLocaleString()} to ${item.clicks.toLocaleString()}`,
      `Compared with the previous 28 days, this ${kind} lost more than half of its clicks. Check for ranking changes, content changes, or a removed page.`,
      prior,
    ));
  }

  // Dropped off page one: it was in the top ten last window and is now beyond it.
  const dropped = current
    .map(item => ({ item, prior: before.get(item.key) }))
    .filter((pair): pair is { item: SearchPerformanceItem; prior: SearchPerformanceItem } =>
      pair.prior !== undefined &&
      pair.prior.position > 0 && pair.prior.position <= INSIGHT_THRESHOLDS.firstPageLastPosition &&
      pair.item.position > INSIGHT_THRESHOLDS.firstPageLastPosition &&
      pair.item.impressions >= INSIGHT_THRESHOLDS.minImpressionsForRank)
    .sort((a, b) => b.item.impressions - a.item.impressions);
  for (const { item, prior } of dropped.slice(0, INSIGHT_THRESHOLDS.maxInsightsPerRule)) {
    found.push(make(
      'dropped_off_first_page', 'warning', item,
      `Dropped from position ${positionLabel(prior.position)} to ${positionLabel(item.position)}`,
      `This ${kind} was on page one last window and is now past it. Check for competing pages, content changes, or a recent update to the site.`,
      prior,
    ));
  }

  return found;
}

/** Findings for one comparison of the current window with the previous one. */
export function buildInsights(current: SearchPerformanceWindow | null, previous: SearchPerformanceWindow | null): SearchPerformanceInsight[] {
  if (!current) return [];
  const found: SearchPerformanceInsight[] = [];
  const site = current.site;
  const priorSite = previous?.site ?? null;

  if (!site || site.impressions === 0) {
    found.push({
      id: 'no_recent_impressions:site',
      rule: 'no_recent_impressions',
      severity: 'info',
      scope: 'site',
      item: null,
      title: 'No impressions in the last 28 days',
      detail: 'Google reports no search impressions for this property in the window. Check that the selected property is the live site, and that its pages are indexed.',
      metrics: site ? metricsOf(site) : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      previous: priorSite ? metricsOf(priorSite) : null,
    });
    return found.slice(0, INSIGHT_THRESHOLDS.maxInsightsTotal);
  }

  if (priorSite && priorSite.clicks >= INSIGHT_THRESHOLDS.minSitePreviousClicks &&
    site.clicks <= priorSite.clicks * INSIGHT_THRESHOLDS.siteClickDropRatio) {
    const drop = 1 - site.clicks / priorSite.clicks;
    found.push({
      id: 'site_clicks_down:site',
      rule: 'site_clicks_down',
      severity: 'warning',
      scope: 'site',
      item: null,
      title: `Clicks down ${percentLabel(drop)} on the previous 28 days`,
      detail: `Site clicks went from ${priorSite.clicks.toLocaleString()} to ${site.clicks.toLocaleString()}. Start with the pages and queries below that lost clicks.`,
      metrics: metricsOf(site),
      previous: metricsOf(priorSite),
    });
  }

  const previousPages = previous?.pages ?? [];
  const previousQueries = previous?.queries ?? [];
  found.push(...itemInsights('page', current.pages, previousPages));
  found.push(...itemInsights('query', current.queries, previousQueries));

  const ranked = [...found].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.metrics.impressions - a.metrics.impressions,
  );
  return ranked.slice(0, INSIGHT_THRESHOLDS.maxInsightsTotal);
}
