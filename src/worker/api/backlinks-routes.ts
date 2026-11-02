// API routes for the Backlinks module.
import { requireAuth } from '../auth/middleware';
import type { AuthEnvironment } from '../auth/jwt';
import { canAccessBacklinkImport, canAccessBacklinkList, canAccessBacklinkMonitor, canAccessOrganization, canAccessWebsite } from '../services/access';
import { getWebsite } from '../services/websites';
import { BacklinkCapacityError, createBacklinkMonitor, getBacklinkMonitor, listBacklinkMonitors, patchBacklinkMonitor } from '../backlinks/monitors';
import { getBacklinkCapacity } from '../backlinks/capacity';
import { commitBacklinkImport, previewBacklinkImport } from '../backlinks/imports';
import { addListMembers, createBacklinkList, listBacklinkLists } from '../backlinks/lists';
import { getMonitorHistory } from '../backlinks/history';
import { ManualCheckRateLimitError, queueManualBacklinkCheck, type BacklinkJobEnvironment } from '../backlinks/jobs';
import { startDiscoveryJob } from '../backlinks/discovery';
import { createReportShare, getReportShare, resolveSharedList, revokeReportShare } from '../backlinks/report-shares';

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function notFound(): Response { return json({ error: 'Resource not found' }, 404); }
function badRequest(message: string): Response { return json({ error: message }, 400); }

export async function handleBacklinkRoutes(pathname: string, request: Request, db: any, env: BacklinkJobEnvironment & AuthEnvironment, ctx?: WaitUntilContext): Promise<Response | null> {
  // The public, token-scoped client view needs no auth and must never leak which organizations exist.
  const shareMatch = pathname.match(/^\/api\/v2\/backlink-shares\/([^/]+)$/);
  if (shareMatch && request.method === 'GET') {
    const view = await resolveSharedList(db, decodeURIComponent(shareMatch[1]));
    if (!view) return notFound();
    return json({ share: view });
  }

  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) return json({ error }, 401);

  try {
    const importsMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/backlinks\/imports$/);
    if (importsMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, importsMatch[1]))) return notFound();
      const website = await getWebsite(db, importsMatch[1]);
      if (!website) return notFound();
      const idempotencyKey = request.headers.get('Idempotency-Key');
      if (!idempotencyKey) return badRequest('Idempotency-Key is required for an import.');
      const body = await request.json().catch(() => null) as { csv?: string; columnMapping?: Record<string, string>; defaultListId?: string } | null;
      if (!body?.csv?.trim()) return badRequest('Provide CSV, TSV, or semicolon-separated text to import.');
      const preview = await previewBacklinkImport(db, website.id, website.organizationId, auth.userId, body.csv, idempotencyKey, { columnMapping: body.columnMapping, defaultListId: body.defaultListId });
      return json({ import: preview }, 201);
    }

    const commitMatch = pathname.match(/^\/api\/v2\/backlinks\/imports\/([^/]+)\/commit$/);
    if (commitMatch && request.method === 'POST') {
      if (!(await canAccessBacklinkImport(db, auth.userId, commitMatch[1]))) return notFound();
      const website = await websiteForImport(db, commitMatch[1]);
      if (!website) return notFound();
      const result = await commitBacklinkImport(db, commitMatch[1], website.organizationId, auth.userId);
      return json({ import: result });
    }

    const listMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/backlinks$/);
    if (listMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, listMatch[1]))) return notFound();
      const url = new URL(request.url);
      const { monitors, total } = await listBacklinkMonitors(db, listMatch[1], {
        status: (url.searchParams.get('status') as any) || undefined,
        listId: url.searchParams.get('listId') || undefined,
        confirmedLoss: url.searchParams.get('confirmedLoss') === 'true',
        limit: numberParam(url, 'limit'), offset: numberParam(url, 'offset'),
      });
      return json({ monitors, total });
    }
    if (listMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, listMatch[1]))) return notFound();
      const website = await getWebsite(db, listMatch[1]);
      if (!website) return notFound();
      const body = await request.json().catch(() => null) as { sourceUrl?: string; expectedTargetUrl?: string } & Record<string, unknown>;
      if (!body?.sourceUrl || !body?.expectedTargetUrl) return badRequest('Provide a source URL and the expected target URL.');
      try {
        const { monitor, created } = await createBacklinkMonitor(db, website.id, website.organizationId, auth.userId, body as any);
        return json({ monitor }, created ? 201 : 200);
      } catch (createError) {
        return errorResponse(createError);
      }
    }

    const monitorMatch = pathname.match(/^\/api\/v2\/backlinks\/([^/]+)$/);
    if (monitorMatch && request.method === 'PATCH') {
      if (!(await canAccessBacklinkMonitor(db, auth.userId, monitorMatch[1]))) return notFound();
      const website = await websiteForMonitor(db, monitorMatch[1]);
      if (!website) return notFound();
      const body = await request.json().catch(() => null);
      if (!body) return badRequest('Provide fields to update.');
      try {
        const monitor = await patchBacklinkMonitor(db, monitorMatch[1], website.organizationId, body);
        if (!monitor) return notFound();
        return json({ monitor });
      } catch (patchError) { return errorResponse(patchError); }
    }

    const checkMatch = pathname.match(/^\/api\/v2\/backlinks\/([^/]+)\/checks$/);
    if (checkMatch && request.method === 'POST') {
      if (!(await canAccessBacklinkMonitor(db, auth.userId, checkMatch[1]))) return notFound();
      const monitor = await getBacklinkMonitor(db, checkMatch[1]);
      if (!monitor) return notFound();
      try {
        const jobId = await queueManualBacklinkCheck(db, env, ctx, checkMatch[1], monitor.websiteId);
        return json({ jobId, status: 'queued' }, 202);
      } catch (checkError) { return errorResponse(checkError); }
    }

    const historyMatch = pathname.match(/^\/api\/v2\/backlinks\/([^/]+)\/history$/);
    if (historyMatch && request.method === 'GET') {
      if (!(await canAccessBacklinkMonitor(db, auth.userId, historyMatch[1]))) return notFound();
      const url = new URL(request.url);
      const history = await getMonitorHistory(db, historyMatch[1], numberParam(url, 'limit') ?? 50);
      return json(history);
    }

    const listsCollectionMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/backlink-lists$/);
    if (listsCollectionMatch && request.method === 'GET') {
      if (!(await canAccessWebsite(db, auth.userId, listsCollectionMatch[1]))) return notFound();
      return json({ lists: await listBacklinkLists(db, listsCollectionMatch[1]) });
    }
    if (listsCollectionMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, listsCollectionMatch[1]))) return notFound();
      const body = await request.json().catch(() => null) as { name?: string; description?: string } | null;
      if (!body?.name) return badRequest('List name is required.');
      try {
        const list = await createBacklinkList(db, listsCollectionMatch[1], auth.userId, { name: body.name, description: body.description });
        return json({ list }, 201);
      } catch (listError) { return errorResponse(listError); }
    }

    const membersMatch = pathname.match(/^\/api\/v2\/backlink-lists\/([^/]+)\/members$/);
    if (membersMatch && request.method === 'POST') {
      if (!(await canAccessBacklinkList(db, auth.userId, membersMatch[1]))) return notFound();
      const body = await request.json().catch(() => null) as { monitorIds?: string[] } | null;
      if (!Array.isArray(body?.monitorIds) || !body.monitorIds.length) return badRequest('Provide at least one monitor ID.');
      const added = await addListMembers(db, membersMatch[1], body.monitorIds);
      return json({ added });
    }

    const sharesMatch = pathname.match(/^\/api\/v2\/backlink-lists\/([^/]+)\/shares$/);
    if (sharesMatch && request.method === 'POST') {
      if (!(await canAccessBacklinkList(db, auth.userId, sharesMatch[1]))) return notFound();
      const body = await request.json().catch(() => ({})) as { expiresAt?: string };
      const share = await createReportShare(db, sharesMatch[1], auth.userId, body.expiresAt);
      return json({ share }, 201);
    }

    const revokeMatch = pathname.match(/^\/api\/v2\/backlink-shares\/([^/]+)\/revoke$/);
    if (revokeMatch && request.method === 'POST') {
      // Revocation is authorized against the share's owning list, never against the public shared_token.
      const share = await getReportShare(db, revokeMatch[1]);
      if (!share || !(await canAccessBacklinkList(db, auth.userId, share.listId))) return notFound();
      await revokeReportShare(db, revokeMatch[1]);
      return json({ revoked: true });
    }

    const discoveryMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/discovery-jobs$/);
    if (discoveryMatch && request.method === 'POST') {
      if (!(await canAccessWebsite(db, auth.userId, discoveryMatch[1]))) return notFound();
      const website = await getWebsite(db, discoveryMatch[1]);
      if (!website) return notFound();
      const idempotencyKey = request.headers.get('Idempotency-Key');
      if (!idempotencyKey) return badRequest('Idempotency-Key is required.');
      const body = await request.json().catch(() => ({})) as { budget?: number };
      const job = await startDiscoveryJob(db, env, website.id, website.domain, body.budget || 0, idempotencyKey, auth.userId);
      return json({ job }, 202);
    }

    const usageMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/backlinks\/usage$/);
    if (usageMatch && request.method === 'GET') {
      if (!(await canAccessOrganization(db, auth.userId, usageMatch[1]))) return notFound();
      const capacity = await getBacklinkCapacity(db, usageMatch[1]);
      return json({ capacity: { limit: capacity.limit, used: capacity.used, remaining: Math.max(capacity.limit - capacity.used, 0) } });
    }

    return null;
  } catch (routeError) {
    return errorResponse(routeError);
  }
}

async function websiteForMonitor(db: any, monitorId: string) {
  const monitor = await db.prepare('SELECT website_id FROM backlink_monitors WHERE id = ?').bind(monitorId).first();
  return monitor ? getWebsite(db, String(monitor.website_id)) : null;
}

async function websiteForImport(db: any, importId: string) {
  const imp = await db.prepare('SELECT website_id FROM backlink_imports WHERE id = ?').bind(importId).first();
  return imp ? getWebsite(db, String(imp.website_id)) : null;
}

function numberParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function errorResponse(error: unknown): Response {
  if (error instanceof BacklinkCapacityError) return json({ error: error.message, code: 'BACKLINK_CAPACITY_REACHED' }, 409);
  if (error instanceof ManualCheckRateLimitError) return json({ error: error.message, code: 'BACKLINK_MANUAL_CHECK_RATE_LIMIT' }, 429);
  return json({ error: error instanceof Error ? error.message : 'Request could not be completed.' }, 400);
}
