/**
 * Hreflang Alternate Links
 * Rules: TECH-031 (distinct URLs per language variant), TECH-032 (valid hreflang).
 *
 * Pages that share a `translation_group` in the inventory are locale
 * variants of the same content. Each variant must get a full, reciprocal
 * set of hreflang alternates (including a self-reference and x-default).
 */

import { pageInventory } from './inventory';
import type { PageInventory, HreflangAlternate } from './types';

// Minimal BCP 47 sanity check: language[-REGION], or the literal 'x-default'.
const VALID_HREFLANG_PATTERN = /^(x-default|[a-z]{2,3}(-[A-Z]{2})?)$/;

/**
 * Get all locale variants that share a translation group with this page.
 */
export function getTranslationSiblings(pageId: string): PageInventory[] {
  const page = pageInventory.find((p) => p.page_id === pageId);
  if (!page?.translation_group) return [];

  return pageInventory.filter(
    (p) => p.translation_group === page.translation_group
  );
}

/**
 * Build the hreflang alternate set for a page, including itself (TECH-032
 * requires a self-referential entry) and an x-default fallback.
 */
export function buildHreflangGroup(
  pageId: string,
  defaultLocale = 'en'
): HreflangAlternate[] {
  const siblings = getTranslationSiblings(pageId);
  if (siblings.length === 0) return [];

  const alternates: HreflangAlternate[] = siblings.map((p) => ({
    hreflang: p.locale,
    href: p.intended_canonical,
  }));

  const defaultPage = siblings.find((p) => p.locale === defaultLocale) ?? siblings[0];
  alternates.push({ hreflang: 'x-default', href: defaultPage.intended_canonical });

  return alternates;
}

/**
 * Render hreflang <link> tags for the <head>.
 */
export function renderHreflangTags(alternates: HreflangAlternate[]): string {
  return alternates
    .map(
      (a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${escapeAttr(a.href)}">`
    )
    .join('\n');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Validate a hreflang group for TECH-031 / TECH-032 compliance.
 */
export function validateHreflangGroup(groupId: string): string[] {
  const issues: string[] = [];
  const members = pageInventory.filter((p) => p.translation_group === groupId);

  if (members.length < 2) return issues; // nothing to cross-check

  const seenUrls = new Set<string>();
  const seenLocales = new Set<string>();

  for (const page of members) {
    // TECH-031: each locale variant must have a distinct URL
    if (seenUrls.has(page.intended_canonical)) {
      issues.push(
        `TECH-031: translation group "${groupId}" has duplicate URL "${page.intended_canonical}". Each locale needs a distinct URL.`
      );
    }
    seenUrls.add(page.intended_canonical);

    if (seenLocales.has(page.locale)) {
      issues.push(
        `Translation group "${groupId}" has more than one page for locale "${page.locale}".`
      );
    }
    seenLocales.add(page.locale);

    // TECH-032: locale code must be valid BCP 47-ish
    if (!VALID_HREFLANG_PATTERN.test(page.locale)) {
      issues.push(
        `TECH-032: page ${page.page_id} has invalid locale/hreflang code "${page.locale}".`
      );
    }
  }

  return issues;
}

/**
 * Validate every translation group in the inventory.
 */
export function validateAllHreflang(): string[] {
  const groups = new Set(
    pageInventory
      .map((p) => p.translation_group)
      .filter((g): g is string => Boolean(g))
  );

  const issues: string[] = [];
  for (const group of groups) {
    issues.push(...validateHreflangGroup(group));
  }
  return issues;
}
