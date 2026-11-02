/**
 * Conservative URL identity for backlink matching.
 *
 * Only scheme and hostname are case-folded and the fragment is dropped.
 * Path case, trailing slash, and query string are preserved exactly, so
 * http/https, www/bare-host, and trailing-slash variants are never silently
 * treated as the same identity (spec: URL identity).
 */
import { isPublicCrawlUrl } from '../crawlers/base';

export interface UrlIdentity {
  normalized: string;
  hostname: string;
}

export function normalizeUrlForIdentity(raw: string): UrlIdentity {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public HTTP or HTTPS URLs can be monitored.');
  const hostname = url.hostname.toLowerCase();
  const port = url.port ? `:${url.port}` : '';
  return {
    normalized: `${url.protocol.toLowerCase()}//${hostname}${port}${url.pathname}${url.search}`,
    hostname,
  };
}

/** Validated normalization for a monitor's source or expected-target field; throws a user-facing message on failure. */
export function normalizeMonitorUrl(raw: string, label: 'Source' | 'Expected target'): UrlIdentity {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${label} URL is required.`);
  let identity: UrlIdentity;
  try {
    identity = normalizeUrlForIdentity(trimmed);
  } catch {
    throw new Error(`${label} URL must be a valid absolute HTTP or HTTPS URL.`);
  }
  if (!isPublicCrawlUrl(trimmed)) throw new Error(`${label} URL must be a public HTTP or HTTPS address.`);
  return identity;
}

/**
 * True when a resolved occurrence URL satisfies the monitor's expected
 * target under its match mode. exact_page requires identical normalized
 * identity; domain_wide requires the same normalized hostname only.
 */
export function matchesExpectedTarget(resolvedUrl: string, expectedTargetNormalized: string, expectedTargetHostname: string, matchMode: 'exact_page' | 'domain_wide'): boolean {
  let resolved: UrlIdentity;
  try {
    resolved = normalizeUrlForIdentity(resolvedUrl);
  } catch {
    return false;
  }
  return matchMode === 'domain_wide' ? resolved.hostname === expectedTargetHostname : resolved.normalized === expectedTargetNormalized;
}
