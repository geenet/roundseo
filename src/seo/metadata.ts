/**
 * Canonical URL Policy and Head Metadata Helpers
 * Rules: TECH-009 (align canonicalization signals), TECH-010 (self-referential canonical),
 *        TECH-017 (correct robots directive in initial HTML), TECH-018 (canonical stable).
 *
 * Usage: call these helpers in your server-side render functions to build
 * the <head> section. Never mutate canonical or robots directives in JS.
 */

import { pageInventory, shouldBeIndexed } from './inventory';
import type { PageInventory } from './types';

export interface HeadMetadata {
  /** Absolute canonical URL */
  canonical: string;
  /**
   * Robots meta content string, e.g. 'index, follow' or 'noindex, nofollow'
   * This must appear in the initial HTML – not patched by JS (TECH-017).
   */
  robots: string;
  /** hreflang alternate links (if applicable) */
  hreflang?: HreflangEntry[];
}

export interface HreflangEntry {
  hreflang: string;
  href: string;
}

export interface PageMetaInput {
  /** Current page URL path, e.g. '/blog/seo-101' */
  url: string;
  /** Override locale for this render (falls back to inventory entry) */
  locale?: string;
  /** Override title */
  title?: string;
  /** Override description */
  description?: string;
}

/**
 * Look up the inventory entry for a URL path.
 * Supports wildcard routes (e.g. '/admin/*').
 */
export function findInventoryEntry(url: string): PageInventory | undefined {
  return pageInventory.find(
    (p) =>
      p.url === url ||
      (p.url.endsWith('/*') && url.startsWith(p.url.slice(0, -2)))
  );
}

/**
 * Derive the canonical URL from the inventory entry.
 * Falls back to building one from the base URL + path.
 */
export function getCanonicalUrl(url: string, baseUrl: string): string {
  const entry = findInventoryEntry(url);

  if (entry?.intended_canonical) {
    return entry.intended_canonical;
  }

  const base = baseUrl.replace(/\/$/, '');
  return `${base}${url}`;
}

/**
 * Derive the correct robots meta content for the initial HTML.
 * This must reflect the server-side intent – never rely on JS to flip noindex.
 * TECH-006: only noindex when intent requires it.
 * TECH-017: initial HTML must have correct directive.
 */
export function getRobotsDirective(url: string): string {
  const entry = findInventoryEntry(url);

  if (!entry) {
    // Unknown URL: default to noindex to avoid accidental indexing
    return 'noindex, nofollow';
  }

  switch (entry.indexing_intent) {
    case 'index':
      return 'index, follow';
    case 'noindex':
      return 'noindex, follow';
    case 'private':
      return 'noindex, nofollow';
    case 'redirect':
      return 'noindex, nofollow';
    case 'gone':
      return 'noindex, nofollow';
    default:
      return 'noindex, nofollow';
  }
}

/**
 * Build complete head metadata for a page.
 */
export function buildHeadMetadata(
  input: PageMetaInput,
  baseUrl: string
): HeadMetadata {
  return {
    canonical: getCanonicalUrl(input.url, baseUrl),
    robots: getRobotsDirective(input.url),
  };
}

/**
 * Render the canonical and robots tags as HTML strings.
 * Inject these in your server-rendered <head> – never patch them in JS.
 */
export function renderHeadTags(meta: HeadMetadata): string {
  const tags: string[] = [
    `<link rel="canonical" href="${escapeAttr(meta.canonical)}">`,
    `<meta name="robots" content="${escapeAttr(meta.robots)}">`,
  ];

  if (meta.hreflang) {
    for (const entry of meta.hreflang) {
      tags.push(
        `<link rel="alternate" hreflang="${escapeAttr(entry.hreflang)}" href="${escapeAttr(entry.href)}">`
      );
    }
  }

  return tags.join('\n');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Validate that canonical URL is consistent with inventory.
 * Returns issues (empty = pass).
 */
export function validateCanonical(url: string, canonicalInPage: string, baseUrl: string): string[] {
  const issues: string[] = [];
  const expectedCanonical = getCanonicalUrl(url, baseUrl);

  if (canonicalInPage !== expectedCanonical) {
    issues.push(
      `Canonical mismatch on ${url}: page has "${canonicalInPage}", expected "${expectedCanonical}".`
    );
  }

  // Canonical must be absolute
  if (!canonicalInPage.startsWith('http')) {
    issues.push(`Canonical URL on ${url} is relative ("${canonicalInPage}"). Must be absolute.`);
  }

  return issues;
}

/**
 * Validate robots directive on an already-rendered page.
 * Checks that the initial HTML has the right directive, not a JS-injected one.
 */
export function validateRobotsDirective(
  url: string,
  robotsInInitialHtml: string | null
): string[] {
  const issues: string[] = [];
  const isIndexable = shouldBeIndexed(url);

  if (isIndexable && robotsInInitialHtml?.toLowerCase().includes('noindex')) {
    issues.push(
      `TECH-006/TECH-017: ${url} is marked for indexing but initial HTML contains noindex. ` +
      `Remove the noindex directive or correct the inventory entry.`
    );
  }

  if (!isIndexable && !robotsInInitialHtml?.toLowerCase().includes('noindex')) {
    // Only warn – some non-indexed pages use HTTP headers instead
    issues.push(
      `TECH-006: ${url} is marked noindex/private but no noindex found in initial HTML meta robots tag. ` +
      `Verify X-Robots-Tag header is set.`
    );
  }

  return issues;
}
