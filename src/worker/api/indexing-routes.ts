// API routes for the Indexing module (Google Search Console connection, inventory, inspections, sitemap submission).
import { requireAuth } from '../auth/middleware';
import type { AuthEnvironment } from '../auth/jwt';
import { canAccessIndexingInventoryItem, canAccessOrganization, canAccessWebsite } from '../services/access';
import { getWebsite } from '../services/websites';
import {
  buildConsentUrl, completeGoogleConnection, getGoogleConnection, googleOAuthApp, requiredReadScopes, requiredWriteScopes,
  selectSearchConsoleProperty, type GoogleConnectionEnv,
} from '../indexing/google-connection';
import { listSearchConsoleSites, type GoogleOAuthApp } from '../indexing/search-console-client';
import { getValidAccessToken } from '../indexing/google-connection';
import { bulkUpsertInventory, getInventoryItem, listInventory, upsertInventoryUrl } from '../indexing/inventory';
import { getIndexingCoverage } from '../indexing/coverage';
import { queueInspection, runInspectionJob } from '../indexing/inspection-jobs';
import { buildSearchConsoleHandoff, listIndexingActions, resolveGoogleIndexingApiAdapter, resolveIndexNowAdapter, submitWebsiteSitemap } from '../indexing/adapters';

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };
type Env = GoogleConnectionEnv & AuthEnvironment & { [key: string]: unknown };

const STATE_COOKIE = 'roundseo_indexing_oauth_state';

function json(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); }
function notFound(): Response { return json({ error: 'Resource not found' }, 404); }
function badRequest(message: string): Response { return json({ error: message }, 400); }

export async function handleIndexingRoutes(pathname: string, request: Request, db: any, env: Env, ctx?: WaitUntilContext): Promise<Response | null> {
  const callbackMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/google-connection\/callback$/);
  if (callbackMatch && request.method === 'GET') return handleOAuthCallback(request, db, env, callbackMatch[1]);

  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) return json({ error }, 401);

  try {
    const startMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/google-connection\/start$/);
    if (startMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, startMatch[1]))) return notFound();
      const app = googleOAuthApp(env);
      if (!app) return json({ error: 'Google OAuth is not configured on this deployment.' }, 503);
      const url = new URL(request.url);
      const wantsWrite = url.searchParams.get('scope') === 'write';
      return startOAuth(app, startMatch[1], auth.userId, wantsWrite);
    }

    const connectionMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/google-connection$/);
    if (connectionMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, connectionMatch[1]))) return notFound();
      return json({ connection: await getGoogleConnection(db, connectionMatch[1]) });
    }

    const sitesMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/google-connection\/sites$/);
    if (sitesMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, sitesMatch[1]))) return notFound();
      const accessToken = await getValidAccessToken(db, env, sitesMatch[1]);
      if (!accessToken) return json({ error: 'Reconnect Google access for this website.' }, 409);
      return json({ sites: await listSearchConsoleSites(accessToken) });
    }

    const propertyMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/google-connection\/property$/);
    if (propertyMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, propertyMatch[1]))) return notFound();
      const body = await request.json().catch(() => null) as { selectedProperty?: string; propertyType?: 'domain' | 'url_prefix' } | null;
      if (!body?.selectedProperty || !body?.propertyType) return badRequest('Provide the selected property and its type.');
      const connection = await selectSearchConsoleProperty(db, propertyMatch[1], body.selectedProperty, body.propertyType);
      if (!connection) return notFound();
      return json({ connection });
    }

    const inventoryMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/indexing\/inventory$/);
    if (inventoryMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, inventoryMatch[1]))) return notFound();
      const url = new URL(request.url);
      const result = await listInventory(db, inventoryMatch[1], { limit: numberParam(url, 'limit'), offset: numberParam(url, 'offset'), onlyIntended: url.searchParams.get('onlyIntended') === 'true' });
      return json(result);
    }
    if (inventoryMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, inventoryMatch[1]))) return notFound();
      const body = await request.json().catch(() => null) as { urls?: string[]; source?: 'crawl' | 'sitemap' | 'priority' | 'manual' } | null;
      if (!Array.isArray(body?.urls) || !body.urls.length) return badRequest('Provide at least one URL.');
      const added = await bulkUpsertInventory(db, inventoryMatch[1], body.urls, body.source || 'manual');
      return json({ added }, 201);
    }

    const coverageMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/indexing$/);
    if (coverageMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, coverageMatch[1]))) return notFound();
      return json({ coverage: await getIndexingCoverage(db, coverageMatch[1]) });
    }

    const inspectionMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/inspection-jobs$/);
    if (inspectionMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, inspectionMatch[1]))) return notFound();
      const body = await request.json().catch(() => null) as { url?: string; inventoryId?: string; reason?: 'priority' | 'manual' } | null;
      if (!body?.url && !body?.inventoryId) return badRequest('Provide a URL or an inventory ID to inspect.');
      const inventoryId = body.inventoryId || await upsertInventoryUrl(db, inspectionMatch[1], body.url!, 'manual', { isPriority: true });
      const jobId = await queueInspection(db, inspectionMatch[1], inventoryId, body.reason || 'manual', auth.userId);
      const run = runInspectionJob(db, env, jobId);
      if (ctx) ctx.waitUntil(run); else await run;
      return json({ jobId, status: 'queued' }, 202);
    }

    const sitemapMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/sitemap-submissions$/);
    if (sitemapMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, sitemapMatch[1]))) return notFound();
      const body = await request.json().catch(() => null) as { sitemapUrl?: string } | null;
      if (!body?.sitemapUrl) return badRequest('Provide the sitemap URL.');
      const result = await submitWebsiteSitemap(db, env, sitemapMatch[1], body.sitemapUrl, auth.userId);
      return json(result, result.submitted ? 201 : 409);
    }

    const handoffMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/indexing\/handoff$/);
    if (handoffMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, handoffMatch[1]))) return notFound();
      const body = await request.json().catch(() => null) as { inventoryId?: string } | null;
      if (!body?.inventoryId || !(await canAccessIndexingInventoryItem(db, auth.userId, body.inventoryId))) return badRequest('Provide a valid inventory ID.');
      const item = await getInventoryItem(db, body.inventoryId);
      const link = await buildSearchConsoleHandoff(db, handoffMatch[1], item?.latestObservation?.inspectionResultLink || null, auth.userId);
      return json({ inspectionResultLink: link });
    }

    const actionsMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/indexing\/actions$/);
    if (actionsMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, actionsMatch[1]))) return notFound();
      return json({ actions: await listIndexingActions(db, actionsMatch[1]) });
    }

    const adaptersMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/indexing\/adapters$/);
    if (adaptersMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, adaptersMatch[1]))) return notFound();
      return json({ indexNow: resolveIndexNowAdapter().availability(), googleIndexingApi: resolveGoogleIndexingApiAdapter().availability('') });
    }

    void canAccessOrganization;
    return null;
  } catch (routeError) {
    return json({ error: routeError instanceof Error ? routeError.message : 'Request could not be completed.' }, 400);
  }
}

function startOAuth(app: GoogleOAuthApp, websiteId: string, userId: string, wantsWrite: boolean): Response {
  const nonce = crypto.randomUUID();
  const scopes = wantsWrite ? requiredWriteScopes() : requiredReadScopes();
  const state = `${encodeURIComponent(websiteId)}.${encodeURIComponent(userId)}.${wantsWrite ? 'write' : 'read'}.${nonce}`;
  const consentUrl = buildConsentUrl(app, state, scopes);
  return new Response(JSON.stringify({ url: consentUrl }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${STATE_COOKIE}=${nonce}; HttpOnly; SameSite=Lax; Path=/api/v2/websites; Max-Age=600`,
    },
  });
}

async function handleOAuthCallback(request: Request, db: any, env: Env, websiteId: string): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  const [stateWebsiteId, userId, , nonce] = state.split('.').map(part => decodeURIComponent(part || ''));
  const stateCookie = request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1);
  const clearCookie = `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/v2/websites; Max-Age=0`;
  if (!code || !nonce || !stateCookie || stateCookie !== nonce || stateWebsiteId !== websiteId) {
    return new Response(JSON.stringify({ error: 'The connection request could not be verified. Try connecting again.' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie } });
  }
  const website = await getWebsite(db, websiteId);
  if (!website) return new Response(JSON.stringify({ error: 'Website not found' }), { status: 404, headers: { 'Set-Cookie': clearCookie } });
  try {
    const connection = await completeGoogleConnection(db, env, websiteId, website.organizationId, userId, code);
    return new Response(JSON.stringify({ connection }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie } });
  } catch (connectError) {
    return new Response(JSON.stringify({ error: connectError instanceof Error ? connectError.message : 'Could not complete the Google connection.' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie } });
  }
}

function numberParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
