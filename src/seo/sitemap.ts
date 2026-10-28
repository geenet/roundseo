/**
 * XML Sitemap Generator
 * Builds a valid sitemap.xml from the page inventory.
 * Rules: TECH-012 (sitemaps focused on indexable URLs), TECH-013 (limits).
 *
 * Limits: 50,000 URLs / 50 MB uncompressed per sitemap file.
 * Only include URLs with indexing_intent === 'index'.
 * Do NOT include noindex, private, redirect, or gone pages.
 */

import { pageInventory } from './inventory';
import type { PageInventory } from './types';

const SITEMAP_MAX_URLS = 50_000;
const SITEMAP_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export interface SitemapConfig {
  /** Base URL for building absolute URLs, e.g. 'https://example.com' */
  baseUrl: string;
  /** Default change frequency */
  defaultChangefreq?: ChangeFreq;
  /** Override priority per page_id */
  priorityOverrides?: Record<string, number>;
}

type ChangeFreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

function pagePriority(page: PageInventory): number {
  switch (page.priority) {
    case 'high':   return 1.0;
    case 'medium': return 0.6;
    case 'low':    return 0.3;
  }
}

function pageChangefreq(page: PageInventory): ChangeFreq {
  switch (page.page_type) {
    case 'home':    return 'weekly';
    case 'article': return 'monthly';
    case 'form':    return 'yearly';
    default:        return 'monthly';
  }
}

function lastmod(page: PageInventory): string {
  const date = page.substantive_update_date ?? page.publication_date;
  if (date) return date.slice(0, 10); // YYYY-MM-DD
  return new Date().toISOString().slice(0, 10);
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildUrl(config: SitemapConfig, page: PageInventory): string {
  const base = config.baseUrl.replace(/\/$/, '');
  const path = page.url.endsWith('/*') ? page.url.slice(0, -2) : page.url;
  return `${base}${path}`;
}

/**
 * Generate the XML sitemap string.
 */
export function generateSitemapXml(config: SitemapConfig): string {
  const indexable = pageInventory.filter(
    (p) => p.indexing_intent === 'index' && !p.url.includes('*')
  );

  if (indexable.length > SITEMAP_MAX_URLS) {
    console.warn(
      `[SEO] Sitemap has ${indexable.length} URLs, exceeding the 50,000 limit. Consider a sitemap index.`
    );
  }

  const urlEntries = indexable.map((page) => {
    const loc = xmlEscape(buildUrl(config, page));
    const lm = lastmod(page);
    const cf = config.defaultChangefreq ?? pageChangefreq(page);
    const pri =
      config.priorityOverrides?.[page.page_id] ?? pagePriority(page);

    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lm}</lastmod>`,
      `    <changefreq>${cf}</changefreq>`,
      `    <priority>${pri.toFixed(1)}</priority>`,
      '  </url>',
    ].join('\n');
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urlEntries,
    '</urlset>',
    '',
  ].join('\n');

  return xml;
}

/**
 * Validate sitemap content.
 * Returns a list of issues, empty when valid.
 */
export function validateSitemap(xml: string): string[] {
  const issues: string[] = [];
  const bytes = new TextEncoder().encode(xml).length;

  if (bytes > SITEMAP_MAX_BYTES) {
    issues.push(
      `Sitemap is ${bytes} bytes, exceeding the 50 MB limit. Split into multiple sitemaps with a sitemap index.`
    );
  }

  const urlCount = (xml.match(/<url>/g) ?? []).length;
  if (urlCount > SITEMAP_MAX_URLS) {
    issues.push(
      `Sitemap has ${urlCount} <url> entries, exceeding the 50,000 limit. Split into multiple sitemaps.`
    );
  }

  if (!xml.includes('<urlset')) {
    issues.push('Sitemap is missing the <urlset> root element.');
  }

  return issues;
}

/**
 * Build the HTTP Response for GET /sitemap.xml
 */
export function buildSitemapResponse(config: SitemapConfig): Response {
  const xml = generateSitemapXml(config);
  const issues = validateSitemap(xml);

  if (issues.length > 0) {
    console.error('[SEO] Sitemap validation issues:', issues);
  }

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
