/**
 * Structured Data (JSON-LD) Generation and Validation
 * Rules: CONTENT-020 (generate markup from shared page data, not hand-authored
 *        duplicates), CONTENT-021 (validate structured data before publishing).
 *
 * Markup is derived from the same PageInventory record that drives canonical
 * URLs and metadata, so the JSON-LD can never drift from what the page
 * actually declares elsewhere.
 */

import type { PageInventory, StructuredDataObject } from './types';

/**
 * Build the Article schema for a page with the 'Article' or 'NewsArticle'
 * feature. Returns null if the page lacks the required fields.
 */
function buildArticleSchema(page: PageInventory, type: 'Article' | 'NewsArticle'): StructuredDataObject | null {
  if (!page.title || !page.publication_date) return null;

  const schema: StructuredDataObject = {
    '@context': 'https://schema.org',
    '@type': type,
    headline: page.title,
    url: page.intended_canonical,
    datePublished: page.publication_date,
  };

  if (page.substantive_update_date) {
    schema.dateModified = page.substantive_update_date;
  }

  if (page.author) {
    schema.author = {
      '@type': 'Person',
      name: page.author.name,
      ...(page.author.url ? { url: page.author.url } : {}),
    };
  }

  return schema;
}

/**
 * Build the Organization schema. Intended for the homepage / about page.
 */
function buildOrganizationSchema(orgName: string, orgUrl: string): StructuredDataObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: orgName,
    url: orgUrl,
    sameAs: [],
  };
}

/**
 * Build the ContactPage schema.
 */
function buildContactPageSchema(page: PageInventory): StructuredDataObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: page.title ?? 'Contact',
    url: page.intended_canonical,
  };
}

export interface StructuredDataConfig {
  organizationName?: string;
  organizationUrl?: string;
}

/**
 * Generate every applicable JSON-LD object for a page, driven entirely by
 * its `applicable_features` and inventory fields.
 */
export function generateStructuredData(
  page: PageInventory,
  config: StructuredDataConfig = {}
): StructuredDataObject[] {
  const objects: StructuredDataObject[] = [];

  for (const feature of page.applicable_features) {
    switch (feature) {
      case 'Article':
      case 'NewsArticle': {
        const schema = buildArticleSchema(page, feature);
        if (schema) objects.push(schema);
        break;
      }
      case 'Organization': {
        objects.push(
          buildOrganizationSchema(
            config.organizationName ?? page.title ?? 'Organization',
            config.organizationUrl ?? page.intended_canonical
          )
        );
        break;
      }
      case 'ContactPage': {
        objects.push(buildContactPageSchema(page));
        break;
      }
      default:
        // Unsupported feature: no generator yet. Leave it out rather than
        // emit a guess at markup we can't back with real data.
        break;
    }
  }

  return objects;
}

/**
 * Render JSON-LD objects as a single <script> tag for the <head>.
 */
export function renderStructuredDataScript(objects: StructuredDataObject[]): string {
  if (objects.length === 0) return '';

  const payload = objects.length === 1 ? objects[0] : objects;
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

/**
 * CONTENT-021: Validate a structured data object has the fields required
 * by its @type before publishing. This is a minimal presence check, not a
 * full schema.org conformance validator — use Google's Rich Results Test
 * for that.
 */
export function validateStructuredData(obj: StructuredDataObject): string[] {
  const issues: string[] = [];

  if (!obj['@context'] || obj['@context'] !== 'https://schema.org') {
    issues.push('CONTENT-021: missing or incorrect @context (must be "https://schema.org").');
  }

  if (!obj['@type']) {
    issues.push('CONTENT-021: missing @type.');
    return issues;
  }

  switch (obj['@type']) {
    case 'Article':
    case 'NewsArticle':
      if (!obj.headline) issues.push(`CONTENT-021: ${obj['@type']} is missing required field "headline".`);
      if (!obj.datePublished) issues.push(`CONTENT-021: ${obj['@type']} is missing required field "datePublished".`);
      if (!obj.author) issues.push(`CONTENT-021: ${obj['@type']} is missing recommended field "author" (CONTENT-011).`);
      break;
    case 'Organization':
      if (!obj.name) issues.push('CONTENT-021: Organization is missing required field "name".');
      if (!obj.url) issues.push('CONTENT-021: Organization is missing required field "url".');
      break;
    case 'ContactPage':
      if (!obj.url) issues.push('CONTENT-021: ContactPage is missing required field "url".');
      break;
    default:
      // Unknown type: nothing to validate against here.
      break;
  }

  return issues;
}

/**
 * Validate every structured data object generated for a page.
 */
export function validateAllStructuredData(objects: StructuredDataObject[]): string[] {
  return objects.flatMap(validateStructuredData);
}
