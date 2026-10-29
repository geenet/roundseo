/**
 * Redirect Mapping and Chain Management
 * Rules: TECH-028 (map to relevant destinations), TECH-029 (minimize chains),
 *        TECH-030 (retain migration redirects >= 1 year).
 *
 * Every entry must point to its FINAL destination. If a chain forms
 * (A -> B -> C), resolveRedirect() collapses it so A redirects straight to C
 * in a single hop — multi-hop chains waste crawl budget and dilute signals.
 */

import type { RedirectEntry, RedirectType } from './types';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Central redirect map: declare every retired URL and its destination.
 * Add entries here when pages move or merge. Do not remove an entry before
 * its retain_until date (TECH-030).
 */
export const redirectMap: RedirectEntry[] = [
  // Example:
  // {
  //   from: '/old-about-us',
  //   to: '/about',
  //   type: 301,
  //   reason: 'Page rename during 2026 site redesign',
  //   created_at: '2026-01-15',
  //   retain_until: '2027-01-15',
  // },
];

/**
 * Resolve a request path to its final redirect target, collapsing chains.
 * Returns null if there is no redirect for this path.
 */
export function resolveRedirect(path: string): RedirectEntry | null {
  const visited = new Set<string>();
  let current = redirectMap.find((r) => r.from === path);

  if (!current) return null;

  let finalType: RedirectType = current.type;
  let hops = 0;
  const maxHops = redirectMap.length + 1;

  while (current) {
    if (visited.has(current.from)) {
      // Loop detected — stop and return what we have to avoid infinite recursion
      break;
    }
    visited.add(current.from);
    hops++;

    const next = redirectMap.find((r) => r.from === current!.to);
    if (!next || hops > maxHops) break;

    current = next;
    finalType = current.type; // final hop's type governs the collapsed redirect
  }

  return {
    from: path,
    to: current.to,
    type: finalType,
    reason: current.reason,
    created_at: current.created_at,
    retain_until: current.retain_until,
  };
}

/**
 * Build the single-hop HTTP redirect Response for a request path.
 * Returns null if the path has no redirect entry.
 */
export function buildRedirectResponse(path: string, baseUrl: string): Response | null {
  const resolved = resolveRedirect(path);
  if (!resolved) return null;

  const location = resolved.to.startsWith('http')
    ? resolved.to
    : `${baseUrl.replace(/\/$/, '')}${resolved.to}`;

  return new Response(null, {
    status: resolved.type,
    headers: { Location: location },
  });
}

/**
 * Detect redirect chains longer than one hop (TECH-029).
 * Returns the offending `from` paths and how many hops they require.
 */
export function detectRedirectChains(): { from: string; hops: number }[] {
  const chains: { from: string; hops: number }[] = [];

  for (const entry of redirectMap) {
    const visited = new Set<string>([entry.from]);
    let hops = 0;
    let cursor = entry.to;

    while (true) {
      const next = redirectMap.find((r) => r.from === cursor);
      if (!next) break;
      if (visited.has(next.from)) break; // loop
      visited.add(next.from);
      cursor = next.to;
      hops++;
    }

    if (hops > 0) {
      chains.push({ from: entry.from, hops: hops + 1 });
    }
  }

  return chains;
}

/**
 * Detect redirect loops (A -> B -> A).
 */
export function detectRedirectLoops(): string[] {
  const loops: string[] = [];

  for (const entry of redirectMap) {
    const visited = new Set<string>([entry.from]);
    let cursor = entry.to;
    let hops = 0;

    while (hops <= redirectMap.length) {
      if (visited.has(cursor)) {
        loops.push(entry.from);
        break;
      }
      visited.add(cursor);
      const next = redirectMap.find((r) => r.from === cursor);
      if (!next) break;
      cursor = next.to;
      hops++;
    }
  }

  return loops;
}

/**
 * Validate the redirect map for consistency issues.
 */
export function validateRedirects(): string[] {
  const issues: string[] = [];
  const seenFrom = new Set<string>();

  for (const entry of redirectMap) {
    if (seenFrom.has(entry.from)) {
      issues.push(`Duplicate redirect source: ${entry.from}`);
    }
    seenFrom.add(entry.from);

    if (entry.from === entry.to) {
      issues.push(`Redirect ${entry.from} points to itself.`);
    }

    // TECH-028: don't collapse everything to a generic destination like '/'
    // unless the source was genuinely the homepage.
    if (entry.to === '/' && entry.from !== '/') {
      issues.push(
        `Redirect ${entry.from} -> / is a generic fallback. Prefer the closest relevant page (TECH-028).`
      );
    }

    // TECH-030: migration redirects should be retained >= 1 year from creation
    const created = new Date(entry.created_at).getTime();
    const retainUntil = new Date(entry.retain_until).getTime();
    if (!isNaN(created) && !isNaN(retainUntil)) {
      if (retainUntil - created < ONE_YEAR_MS) {
        issues.push(
          `Redirect ${entry.from} has retain_until less than 1 year after created_at (TECH-030).`
        );
      }
      if (retainUntil < Date.now()) {
        issues.push(
          `Redirect ${entry.from} has passed its retain_until date (${entry.retain_until}). Review before removing.`
        );
      }
    }
  }

  const chains = detectRedirectChains();
  for (const chain of chains) {
    issues.push(
      `Redirect chain at ${chain.from} requires ${chain.hops} hops. Collapse to a single hop (TECH-029).`
    );
  }

  const loops = detectRedirectLoops();
  for (const from of loops) {
    issues.push(`Redirect loop detected starting at ${from}.`);
  }

  return issues;
}
