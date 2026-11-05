// API routes for Search Console performance: the dashboard read model and a manual sync.
import { requireAuth } from '../auth/middleware';
import type { AuthEnvironment } from '../auth/jwt';
import { canAccessWebsite } from '../services/access';
import type { GoogleConnectionEnv } from '../indexing/google-connection';
import { readSearchPerformance } from '../search-performance/read-model';
import { syncSearchPerformance } from '../search-performance/sync';

type Env = GoogleConnectionEnv & AuthEnvironment & { [key: string]: unknown };

/** A manual sync may run at most once in this window, so a button can't turn into a quota drain. */
const MANUAL_SYNC_COOLDOWN_MS = 15 * 60 * 1000;

function json(payload: unknown, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); }
function notFound(): Response { return json({ error: 'Resource not found' }, 404); }

export async function handleSearchPerformanceRoutes(pathname: string, request: Request, db: any, env: Env): Promise<Response | null> {
  const match = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/search-performance(\/sync)?$/);
  if (!match) return null;
  const websiteId = match[1];
  const isSync = Boolean(match[2]);

  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) return json({ error }, 401);
  if (!(await canAccessWebsite(db, auth.userId, websiteId))) return notFound();

  try {
    if (!isSync && request.method === 'GET') {
      return json(await readSearchPerformance(db, websiteId));
    }

    if (isSync && request.method === 'POST') {
      const lastStarted = await db.prepare(`
        SELECT started_at FROM search_performance_syncs WHERE website_id = ? ORDER BY started_at DESC LIMIT 1
      `).bind(websiteId).first();
      const elapsed = lastStarted ? Date.now() - Date.parse(String(lastStarted.started_at)) : Infinity;
      if (elapsed < MANUAL_SYNC_COOLDOWN_MS) {
        const minutes = Math.ceil((MANUAL_SYNC_COOLDOWN_MS - elapsed) / 60_000);
        return json({ error: `Search Console was synced recently. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }, 429);
      }
      const outcome = await syncSearchPerformance(db, env, websiteId);
      const status = outcome.status === 'succeeded' ? 200 : outcome.status === 'skipped' ? 409 : 502;
      return json(outcome, status);
    }

    return null;
  } catch (routeError) {
    return json({ error: routeError instanceof Error ? routeError.message : 'Request could not be completed.' }, 400);
  }
}
