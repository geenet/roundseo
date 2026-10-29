/**
 * Pagination URL Helpers
 * Rule: TECH-025 (expose crawlable pagination).
 *
 * Google deprecated rel="next"/"prev" in 2019 — it no longer uses them as a
 * grouping signal. What still matters: every paginated page must have a
 * real, crawlable <a href> to the next/previous page (not a JS-only control),
 * and each page should self-canonicalize rather than pointing back at page 1.
 */

import type { PaginationSeries } from './types';

/**
 * Build the URL for a specific page in a paginated series.
 */
export function buildPageUrl(series: PaginationSeries, page: number): string {
  return series.url_template.replace('{page}', String(page));
}

/**
 * Build every URL in a paginated series (for sitemap inclusion or testing).
 */
export function buildAllPageUrls(series: PaginationSeries): string[] {
  const urls: string[] = [];
  for (let page = 1; page <= series.total_pages; page++) {
    urls.push(buildPageUrl(series, page));
  }
  return urls;
}

/**
 * Each paginated page canonicalizes to itself, not to page 1.
 * Canonicalizing every page to page 1 hides the rest of the series from
 * search results.
 */
export function getPaginationCanonical(series: PaginationSeries, page: number): string {
  return buildPageUrl(series, page);
}

/**
 * Check that a rendered page exposes real crawlable links to adjacent pages.
 * Pass the rendered HTML of a paginated page; returns issues found.
 */
export function validatePaginationLinks(
  series: PaginationSeries,
  page: number,
  renderedHtml: string
): string[] {
  const issues: string[] = [];

  const hasNext = page < series.total_pages;
  const hasPrev = page > 1;

  if (hasNext) {
    const nextUrl = buildPageUrl(series, page + 1);
    if (!containsAnchorHref(renderedHtml, nextUrl)) {
      issues.push(
        `TECH-025: page ${page} of series "${series.series_id}" has no crawlable <a href> to the next page (${nextUrl}). ` +
        'JS-only "Next" buttons are not crawlable.'
      );
    }
  }

  if (hasPrev) {
    const prevUrl = buildPageUrl(series, page - 1);
    if (!containsAnchorHref(renderedHtml, prevUrl)) {
      issues.push(
        `TECH-025: page ${page} of series "${series.series_id}" has no crawlable <a href> to the previous page (${prevUrl}).`
      );
    }
  }

  return issues;
}

function containsAnchorHref(html: string, href: string): boolean {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<a[^>]+href=["']${escaped}["']`, 'i');
  return pattern.test(html);
}

/**
 * Validate a series definition itself (bounds, template correctness).
 */
export function validatePaginationSeries(series: PaginationSeries): string[] {
  const issues: string[] = [];

  if (!series.url_template.includes('{page}')) {
    issues.push(`Pagination series "${series.series_id}" url_template is missing the {page} placeholder.`);
  }

  if (series.total_pages < 1) {
    issues.push(`Pagination series "${series.series_id}" has total_pages < 1.`);
  }

  return issues;
}
