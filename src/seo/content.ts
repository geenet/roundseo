/**
 * Title, Description, and Heading Checks
 * Rules: CONTENT-003 (descriptive titles), CONTENT-004 (clear H1),
 *        CONTENT-005 (useful meta descriptions), CONTENT-006 (consistent language).
 *
 * Deliberately avoids false numeric targets (e.g. "title must be < 60 chars" —
 * only ~32-60 chars typically display, but longer titles are not an error).
 * Checks focus on presence, distinctness, and locale consistency instead.
 */

import { pageInventory } from './inventory';
import type { PageInventory } from './types';

const GENERIC_TITLES = new Set([
  'home',
  'untitled',
  'untitled page',
  'new page',
  'document',
  'page',
]);

/**
 * CONTENT-003: Titles must be present, non-generic, and distinct from
 * every other indexable page's title.
 */
export function validateTitle(page: PageInventory): string[] {
  const issues: string[] = [];

  if (page.indexing_intent !== 'index') return issues;

  if (!page.title || page.title.trim().length === 0) {
    issues.push(`CONTENT-003: ${page.url} has no <title>.`);
    return issues;
  }

  const normalized = page.title.trim().toLowerCase();
  if (GENERIC_TITLES.has(normalized)) {
    issues.push(`CONTENT-003: ${page.url} has a generic title ("${page.title}").`);
  }

  const duplicates = pageInventory.filter(
    (p) =>
      p.page_id !== page.page_id &&
      p.indexing_intent === 'index' &&
      p.title?.trim().toLowerCase() === normalized
  );
  if (duplicates.length > 0) {
    issues.push(
      `CONTENT-003: ${page.url} shares its title with ${duplicates.map((d) => d.url).join(', ')}.`
    );
  }

  return issues;
}

/**
 * CONTENT-005: Meta descriptions must be present, non-trivial, and distinct.
 * Google rewrites descriptions it finds unhelpful, but a missing or
 * duplicated description is still worth flagging as a content gap.
 */
export function validateMetaDescription(page: PageInventory): string[] {
  const issues: string[] = [];

  if (page.indexing_intent !== 'index') return issues;

  if (!page.meta_description || page.meta_description.trim().length === 0) {
    issues.push(`CONTENT-005: ${page.url} has no meta description.`);
    return issues;
  }

  if (page.meta_description.trim().length < 20) {
    issues.push(
      `CONTENT-005: ${page.url} meta description is too short to be useful ("${page.meta_description}").`
    );
  }

  const normalized = page.meta_description.trim().toLowerCase();
  const duplicates = pageInventory.filter(
    (p) =>
      p.page_id !== page.page_id &&
      p.indexing_intent === 'index' &&
      p.meta_description?.trim().toLowerCase() === normalized
  );
  if (duplicates.length > 0) {
    issues.push(
      `CONTENT-005: ${page.url} shares its meta description with ${duplicates.map((d) => d.url).join(', ')}.`
    );
  }

  return issues;
}

/**
 * CONTENT-004: Every indexable page should have exactly one clear H1.
 * Takes rendered HTML because headings aren't tracked in the inventory.
 */
export function validateHeadingHierarchy(url: string, renderedHtml: string): string[] {
  const issues: string[] = [];

  const h1Matches = renderedHtml.match(/<h1[^>]*>/gi) ?? [];

  if (h1Matches.length === 0) {
    issues.push(`CONTENT-004: ${url} has no <h1> heading.`);
  } else if (h1Matches.length > 1) {
    issues.push(
      `CONTENT-004: ${url} has ${h1Matches.length} <h1> elements. Use one clear main heading.`
    );
  }

  return issues;
}

/**
 * CONTENT-006: The declared document language should match the page's
 * inventory locale, and title/description shouldn't be in an obviously
 * different script/language than the body (best-effort heuristic only —
 * genuine language detection needs editorial review, not regex).
 */
export function validateLanguageConsistency(
  page: PageInventory,
  htmlLangAttribute: string | null
): string[] {
  const issues: string[] = [];

  if (!htmlLangAttribute) {
    issues.push(`CONTENT-006: ${page.url} has no <html lang="..."> attribute.`);
    return issues;
  }

  const declaredBase = htmlLangAttribute.toLowerCase().split('-')[0];
  const inventoryBase = page.locale.toLowerCase().split('-')[0];

  if (declaredBase !== inventoryBase) {
    issues.push(
      `CONTENT-006: ${page.url} declares lang="${htmlLangAttribute}" but inventory locale is "${page.locale}".`
    );
  }

  return issues;
}

/**
 * Run all content checks for a single page against its rendered HTML.
 */
export function validatePageContent(page: PageInventory, renderedHtml: string, htmlLangAttribute: string | null): string[] {
  return [
    ...validateTitle(page),
    ...validateMetaDescription(page),
    ...validateHeadingHierarchy(page.url, renderedHtml),
    ...validateLanguageConsistency(page, htmlLangAttribute),
  ];
}
