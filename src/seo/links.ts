/**
 * Internal Link Graph Health
 * Rule: LINK-001 (crawlable navigation links — see rules.ts for full text).
 * Metrics: Orphan Pages = 0, Internal Link Integrity = 0 critical.
 *
 * Operates on a plain edge list the caller supplies (extracted from crawled
 * or rendered pages) rather than crawling itself — this module is pure
 * graph analysis over whatever link evidence is already collected.
 */

import { pageInventory } from './inventory';
import type { PageInventory } from './types';

export interface LinkEdge {
  /** URL of the page containing the link */
  from: string;
  /** href target, as found in the anchor */
  to: string;
  /** True if the link was only reachable via JS event handling, not a real href */
  scriptOnly?: boolean;
}

/**
 * Pages with indexing_intent 'index' that receive zero internal links.
 * The homepage is exempt — it's reachable by definition (URL bar, external
 * links, browser bookmarks) even with no internal inbound links recorded.
 */
export function findOrphanPages(edges: LinkEdge[], inventory: PageInventory[] = pageInventory): PageInventory[] {
  const linkedTargets = new Set(edges.map((e) => normalizePath(e.to)));

  return inventory.filter(
    (page) =>
      page.indexing_intent === 'index' &&
      page.page_type !== 'home' &&
      !linkedTargets.has(normalizePath(page.url))
  );
}

/**
 * Links whose destination doesn't resolve to any known inventory URL, or
 * resolves to a page marked 'gone'. Both are broken from a crawler's
 * perspective: the first likely 404s, the second is intentionally retired.
 */
export function findBrokenLinks(edges: LinkEdge[], inventory: PageInventory[] = pageInventory): LinkEdge[] {
  const byUrl = new Map(inventory.map((p) => [normalizePath(p.url), p]));

  return edges.filter((edge) => {
    // External links (absolute URLs to another host) aren't ours to validate here.
    if (/^https?:\/\//i.test(edge.to) && !isSameOrigin(edge.to, inventory)) return false;

    const target = byUrl.get(normalizePath(edge.to));
    if (!target) return true; // no matching inventory entry — likely broken
    return target.indexing_intent === 'gone';
  });
}

/**
 * Links that exist only as script-triggered navigation, not a real <a href>.
 * These are invisible to crawlers that don't execute arbitrary event handlers.
 */
export function findScriptOnlyLinks(edges: LinkEdge[]): LinkEdge[] {
  return edges.filter((e) => e.scriptOnly === true);
}

/**
 * Run every internal-link check and return a flat issue list for LINK-001.
 */
export function validateInternalLinks(edges: LinkEdge[], inventory: PageInventory[] = pageInventory): string[] {
  const issues: string[] = [];

  for (const page of findOrphanPages(edges, inventory)) {
    issues.push(`Orphan page: ${page.url} is indexable but has no incoming internal links.`);
  }

  for (const broken of findBrokenLinks(edges, inventory)) {
    issues.push(`Broken internal link: ${broken.from} links to "${broken.to}", which doesn't resolve to a live page.`);
  }

  for (const scriptOnly of findScriptOnlyLinks(edges)) {
    issues.push(
      `LINK-001: ${scriptOnly.from} links to "${scriptOnly.to}" only via a script event handler, not a crawlable <a href>.`
    );
  }

  return issues;
}

/**
 * BFS click-depth from the homepage to every other reachable page.
 * Informational only — the spec explicitly avoids mandating "3 clicks max"
 * as a hard rule, so this returns depths without asserting a target.
 */
export function calculateClickDepths(edges: LinkEdge[], rootUrl = '/'): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = normalizePath(edge.from);
    const to = normalizePath(edge.to);
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(to);
  }

  const depths = new Map<string, number>([[normalizePath(rootUrl), 0]]);
  const queue: string[] = [normalizePath(rootUrl)];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depths.get(current)!;
    for (const next of adjacency.get(current) ?? []) {
      if (!depths.has(next)) {
        depths.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }

  return depths;
}

function normalizePath(url: string): string {
  try {
    return new URL(url, 'https://placeholder.invalid').pathname.replace(/\/$/, '') || '/';
  } catch {
    return url.replace(/\/$/, '') || '/';
  }
}

function isSameOrigin(absoluteUrl: string, inventory: PageInventory[]): boolean {
  const sample = inventory.find((p) => p.intended_canonical.startsWith('http'));
  if (!sample) return false;
  try {
    return new URL(absoluteUrl).hostname === new URL(sample.intended_canonical).hostname;
  } catch {
    return false;
  }
}
