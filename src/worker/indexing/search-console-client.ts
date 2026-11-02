/**
 * Minimal Google Search Console / URL Inspection HTTP client. Every call
 * uses the authorized access token for one website's connection; nothing
 * here aggregates across websites or organizations.
 */

export interface GoogleOAuthApp { clientId: string; clientSecret: string; redirectUri: string }

export interface TokenExchangeResult { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string }

export async function exchangeCodeForTokens(code: string, app: GoogleOAuthApp): Promise<TokenExchangeResult | null> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, grant_type: 'authorization_code' }).toString(),
  });
  if (!response.ok) return null;
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!body.access_token) return null;
  return { accessToken: body.access_token, refreshToken: body.refresh_token || null, expiresIn: body.expires_in || 3600, scope: body.scope || '' };
}

export type RefreshResult = { kind: 'ok'; accessToken: string; expiresIn: number } | { kind: 'rejected' } | { kind: 'transient' };

/** Distinguishes Google explicitly rejecting the refresh token (permanent — needs reconnect) from a
 * network/transient failure reaching Google at all (temporary — the stored token is still fine). */
export async function refreshAccessToken(refreshToken: string, app: GoogleOAuthApp): Promise<RefreshResult> {
  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token' }).toString(),
    });
  } catch {
    return { kind: 'transient' };
  }
  if (response.status >= 500 || response.status === 429) return { kind: 'transient' };
  if (!response.ok) return { kind: 'rejected' };
  const body = await response.json().catch(() => null) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) return { kind: 'rejected' };
  return { kind: 'ok', accessToken: body.access_token, expiresIn: body.expires_in || 3600 };
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string | null> {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  const body = await response.json() as { email?: string };
  return body.email || null;
}

export interface SearchConsoleSite { siteUrl: string; permissionLevel: string }

export async function listSearchConsoleSites(accessToken: string): Promise<SearchConsoleSite[]> {
  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return [];
  const body = await response.json() as { siteEntry?: SearchConsoleSite[] };
  return body.siteEntry || [];
}

export interface InspectionResult {
  verdict: 'indexed' | 'not_indexed' | 'unknown';
  coverageState: string | null;
  lastCrawlTime: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  declaredCanonical: string | null;
  selectedCanonical: string | null;
  sitemaps: string[];
  inspectionResultLink: string | null;
}

/** Google's stored index information for this URL and property — not a live re-crawl (spec: Google indexing evidence). */
export async function inspectUrl(accessToken: string, siteUrl: string, inspectionUrl: string): Promise<InspectionResult | { quotaExceeded: true } | null> {
  const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  });
  if (response.status === 429 || response.status === 403) {
    const body = await response.json().catch(() => null) as { error?: { status?: string } } | null;
    if (response.status === 429 || body?.error?.status === 'RESOURCE_EXHAUSTED') return { quotaExceeded: true };
  }
  if (!response.ok) return null;
  const body = await response.json() as { inspectionResult?: Record<string, any> };
  const result = body.inspectionResult;
  if (!result) return null;
  const indexResult = result.indexStatusResult || {};
  const verdictRaw = String(indexResult.verdict || 'UNKNOWN').toLowerCase();
  return {
    verdict: verdictRaw === 'pass' ? 'indexed' : verdictRaw === 'fail' || verdictRaw === 'neutral' ? 'not_indexed' : 'unknown',
    coverageState: indexResult.coverageState || null,
    lastCrawlTime: indexResult.lastCrawlTime || null,
    robotsTxtState: indexResult.robotsTxtState || null,
    indexingState: indexResult.indexingState || null,
    // Google's own field names are the reverse of what they mean here: userCanonical is the page's
    // own declared canonical, googleCanonical is the one Google selected to index.
    declaredCanonical: indexResult.userCanonical || null,
    selectedCanonical: indexResult.googleCanonical || indexResult.userCanonical || null,
    sitemaps: Array.isArray(indexResult.sitemap) ? indexResult.sitemap : [],
    inspectionResultLink: result.inspectionResultLink || null,
  };
}

/** Submits (or re-submits) a sitemap for crawling. Requires the write (webmasters) scope. */
export async function submitSitemap(accessToken: string, siteUrl: string, sitemapUrl: string): Promise<boolean> {
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return response.ok;
}
