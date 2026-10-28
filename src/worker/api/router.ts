// API router for RoundSEO
import { requireAuth } from '../auth/middleware';
import { handleSignup, handleLogin, handleGoogleCallback, handleGetMe, handleRefresh } from '../auth';
import { createOrganization, getOrganization, listOrganizations } from '../services/organizations';
import { createWebsite, getWebsite, listWebsites, updateSiteProfile, type SiteSetupInput } from '../services/websites';
import { buildAuditJobMessage, createAudit, createPerformanceAudit, getAudit, getAuditInsights, getCrawlJob, runAuditJob } from '../services/audits';
import { createReport, getReportByToken, listReports, shareReport, recordReportView } from '../services/reports';
import { trackKeyword, listWebsiteKeywords, getKeywordTrends, recordRanking } from '../services/keywords';
import { addCompetitor, listCompetitors, getCompetitorAdvantages } from '../services/competitor-analysis';
import { analyzePageContent } from '../services/content-analysis';
import { getAuditFoundation, getPageSnapshotDetail } from '../services/audit-foundation';
import { getPerformanceAuditForAudit } from '../services/performance';
import { getAuditPageInventory, getWebsiteOperatingOverview } from '../services/operating-overview';
import { getAction, listWebsiteActions, updateActionStatus } from '../services/actions';
import { canAccessAction, canAccessAudit, canAccessCrawlJob, canAccessOrganization, canAccessPageIdentity, canAccessWebsite } from '../services/access';
import type { ActionStatus } from '../../shared/operating-model';

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };

function resourceNotFound(): Response {
  return new Response(JSON.stringify({ error: 'Resource not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleAuthRoutes(pathname: string, request: Request, db: any, env: any): Promise<Response | null> {
  if (pathname === '/api/v2/auth/signup' && request.method === 'POST') {
    return handleSignup(request, db);
  }

  if (pathname === '/api/v2/auth/login' && request.method === 'POST') {
    return handleLogin(request, db);
  }

  if (pathname === '/api/v2/auth/google/callback' && request.method === 'POST') {
    return handleGoogleCallback(request, env, db);
  }

  if (pathname === '/api/v2/auth/me' && request.method === 'GET') {
    return handleGetMe(request);
  }

  if (pathname === '/api/v2/auth/refresh' && request.method === 'POST') {
    return handleRefresh(request);
  }

  return null;
}

export async function handleOrgRoutes(pathname: string, request: Request, db: any): Promise<Response | null> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // GET /api/v2/organizations - list user's organizations
  if (pathname === '/api/v2/organizations' && request.method === 'GET') {
    const orgs = await listOrganizations(db, auth.userId);
    return new Response(JSON.stringify({ organizations: orgs }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/organizations - create organization
  if (pathname === '/api/v2/organizations' && request.method === 'POST') {
    const { name, billingEmail } = await request.json();
    const org = await createOrganization(db, auth.userId, name, billingEmail);
    return new Response(JSON.stringify({ organization: org }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/organizations/:id - get organization
  const orgMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)$/);
  if (orgMatch && request.method === 'GET') {
    if (!(await canAccessOrganization(db, auth.userId, orgMatch[1]))) return resourceNotFound();
    const org = await getOrganization(db, orgMatch[1]);
    if (!org) {
      return new Response(JSON.stringify({ error: 'Organization not found' }), { status: 404 });
    }
    return new Response(JSON.stringify({ organization: org }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function handleWebsiteRoutes(pathname: string, request: Request, db: any): Promise<Response | null> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // GET /api/v2/organizations/:orgId/websites
  const listMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/websites$/);
  if (listMatch && request.method === 'GET') {
    if (!(await canAccessOrganization(db, auth.userId, listMatch[1]))) return resourceNotFound();
    const websites = await listWebsites(db, listMatch[1]);
    return new Response(JSON.stringify({ websites }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/organizations/:orgId/websites
  if (listMatch && request.method === 'POST') {
    if (!(await canAccessOrganization(db, auth.userId, listMatch[1]))) return resourceNotFound();
    const { name, domain, url, setup } = await request.json();
    try {
      const website = await createWebsite(db, listMatch[1], name, domain, url, setup as SiteSetupInput || {});
      return new Response(JSON.stringify({ website }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (createError) {
      return new Response(JSON.stringify({ error: createError instanceof Error ? createError.message : 'Website could not be added.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // GET /api/v2/websites/:id
  const getMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)$/);
  if (getMatch && request.method === 'GET') {
    if (!(await canAccessWebsite(db, auth.userId, getMatch[1]))) return resourceNotFound();
    const website = await getWebsite(db, getMatch[1]);
    if (!website) {
      return new Response(JSON.stringify({ error: 'Website not found' }), { status: 404 });
    }
    return new Response(JSON.stringify({ website }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/websites/:id/overview - persisted results, actions and source freshness
  const overviewMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/overview$/);
  if (overviewMatch && request.method === 'GET') {
    if (!(await canAccessWebsite(db, auth.userId, overviewMatch[1]))) return resourceNotFound();
    const website = await getWebsite( db, overviewMatch[1]);
    if (!website) return new Response(JSON.stringify({ error: 'Website not found' }), { status: 404 });
    const overview = await getWebsiteOperatingOverview(db, website.id);
    return new Response(JSON.stringify({ website, ...overview }), { headers: { 'Content-Type': 'application/json' } });
  }

  // GET /api/v2/websites/:id/actions - the operating queue rather than raw issue counts
  const actionPlanMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/actions$/);
  if (actionPlanMatch && request.method === 'GET') {
    if (!(await canAccessWebsite(db, auth.userId, actionPlanMatch[1]))) return resourceNotFound();
    const website = await getWebsite(db, actionPlanMatch[1]);
    if (!website) return new Response(JSON.stringify({ error: 'Website not found' }), { status: 404 });
    const status = new URL(request.url).searchParams.get('status') as ActionStatus | null;
    const actions = await listWebsiteActions(db, website.id, status || undefined);
    return new Response(JSON.stringify({ actions }), { headers: { 'Content-Type': 'application/json' } });
  }

  const profileMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/profile$/);
  if (profileMatch && request.method === 'PUT') {
    if (!(await canAccessWebsite(db, auth.userId, profileMatch[1]))) return resourceNotFound();
    const profile = await updateSiteProfile(db, profileMatch[1], await request.json() as SiteSetupInput);
    if (!profile) return new Response(JSON.stringify({ error: 'Website not found' }), { status: 404 });
    return new Response(JSON.stringify({ profile }), { headers: { 'Content-Type': 'application/json' } });
  }

  return null;
}

export async function handleAuditRoutes(pathname: string, request: Request, db: any, env: any, ctx?: WaitUntilContext): Promise<Response | null> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // POST /api/v2/websites/:id/performance-audits - PageSpeed lab and CrUX field data
  const performanceMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/performance-audits$/);
  if (performanceMatch && request.method === 'POST') {
    if (!(await canAccessWebsite(db, auth.userId, performanceMatch[1]))) return resourceNotFound();
    const payload = await request.json().catch(() => ({})) as { idempotencyKey?: string };
    const idempotencyKey = request.headers.get('Idempotency-Key') || payload.idempotencyKey;
    const audit = await createPerformanceAudit(db, performanceMatch[1], { idempotencyKey: idempotencyKey || undefined });
    await dispatchAudit(db, env, ctx, audit);
    return new Response(JSON.stringify({ audit, jobId: audit.jobId }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/websites/:id/audits - start audit
  const auditMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/audits$/);
  if (auditMatch && request.method === 'POST') {
    if (!(await canAccessWebsite(db, auth.userId, auditMatch[1]))) return resourceNotFound();
    const payload = await request.json().catch(() => ({})) as { type?: 'full' | 'quick'; idempotencyKey?: string };
    const idempotencyKey = request.headers.get('Idempotency-Key') || payload.idempotencyKey;
    const audit = await createAudit(db, auditMatch[1], payload.type || 'full', {
      source: 'user',
      idempotencyKey: idempotencyKey || undefined,
    });
    await dispatchAudit(db, env, ctx, audit);

    return new Response(JSON.stringify({ audit, jobId: audit.jobId }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/audits/:id - get audit results
  const getMatch = pathname.match(/^\/api\/v2\/audits\/([^/]+)$/);
  if (getMatch && request.method === 'GET') {
    if (!(await canAccessAudit(db, auth.userId, getMatch[1]))) return resourceNotFound();
    const audit = await getAudit(db, getMatch[1]);
    if (!audit) {
      return new Response(JSON.stringify({ error: 'Audit not found' }), { status: 404 });
    }
    return new Response(JSON.stringify({ audit }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/audits/:id/performance - exact mobile/desktop evidence from a provider run
  const performanceDetailMatch = pathname.match(/^\/api\/v2\/audits\/([^/]+)\/performance$/);
  if (performanceDetailMatch && request.method === 'GET') {
    if (!(await canAccessAudit(db, auth.userId, performanceDetailMatch[1]))) return resourceNotFound();
    const performance = await getPerformanceAuditForAudit(db, performanceDetailMatch[1]);
    if (!performance) return new Response(JSON.stringify({ error: 'Performance evidence not found' }), { status: 404 });
    return new Response(JSON.stringify({ performance }), { headers: { 'Content-Type': 'application/json' } });
  }

  // GET /api/v2/audits/:id/insights - recommendations with per-page evidence
  const insightsMatch = pathname.match(/^\/api\/v2\/audits\/([^/]+)\/insights$/);
  if (insightsMatch && request.method === 'GET') {
    if (!(await canAccessAudit(db, auth.userId, insightsMatch[1]))) return resourceNotFound();
    const insights = await getAuditInsights(db, insightsMatch[1]);
    if (!insights) {
      return new Response(JSON.stringify({ error: 'Audit not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(insights), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/audits/:id/pages - page inventory with snapshot state
  const pageInventoryMatch = pathname.match(/^\/api\/v2\/audits\/([^/]+)\/pages$/);
  if (pageInventoryMatch && request.method === 'GET') {
    if (!(await canAccessAudit(db, auth.userId, pageInventoryMatch[1]))) return resourceNotFound();
    const audit = await getAudit(db, pageInventoryMatch[1]);
    if (!audit) return new Response(JSON.stringify({ error: 'Audit not found' }), { status: 404 });
    const pages = await getAuditPageInventory(db, audit.id);
    return new Response(JSON.stringify({ auditId: audit.id, pages }), { headers: { 'Content-Type': 'application/json' } });
  }

  // GET /api/v2/audits/:id/foundation - raw availability, snapshots, actions and changes
  const foundationMatch = pathname.match(/^\/api\/v2\/audits\/([^/]+)\/foundation$/);
  if (foundationMatch && request.method === 'GET') {
    if (!(await canAccessAudit(db, auth.userId, foundationMatch[1]))) return resourceNotFound();
    const foundation = await getAuditFoundation(db, foundationMatch[1]);
    if (!foundation) return new Response(JSON.stringify({ error: 'Audit evidence not found' }), { status: 404 });
    return new Response(JSON.stringify(foundation), { headers: { 'Content-Type': 'application/json' } });
  }

  const jobMatch = pathname.match(/^\/api\/v2\/crawl-jobs\/([^/]+)$/);
  if (jobMatch && request.method === 'GET') {
    if (!(await canAccessCrawlJob(db, auth.userId, jobMatch[1]))) return resourceNotFound();
    const job = await getCrawlJob(db, jobMatch[1]);
    if (!job) return new Response(JSON.stringify({ error: 'Crawl job not found' }), { status: 404 });
    return new Response(JSON.stringify({ job }), { headers: { 'Content-Type': 'application/json' } });
  }

  return null;
}

export async function handleActionRoutes(pathname: string, request: Request, db: any, env: any, ctx?: WaitUntilContext): Promise<Response | null> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) return new Response(JSON.stringify({ error }), { status: 401 });

  const detailMatch = pathname.match(/^\/api\/v2\/actions\/([^/]+)$/);
  if (detailMatch && request.method === 'GET') {
    if (!(await canAccessAction(db, auth.userId, detailMatch[1]))) return resourceNotFound();
    const action = await getAction(db, detailMatch[1]);
    if (!action) return new Response(JSON.stringify({ error: 'Action not found' }), { status: 404 });
    return new Response(JSON.stringify({ action }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (detailMatch && request.method === 'PATCH') {
    if (!(await canAccessAction(db, auth.userId, detailMatch[1]))) return resourceNotFound();
    const payload = await request.json() as { status?: ActionStatus; ignoredReason?: string; ownerId?: string };
    if (!payload.status) return new Response(JSON.stringify({ error: 'Choose an action status.' }), { status: 400 });
    try {
      const action = await updateActionStatus(db, detailMatch[1], payload.status, { ignoredReason: payload.ignoredReason, ownerId: payload.ownerId });
      if (!action) return new Response(JSON.stringify({ error: 'Action not found' }), { status: 404 });
      return new Response(JSON.stringify({ action }), { headers: { 'Content-Type': 'application/json' } });
    } catch (updateError) {
      return new Response(JSON.stringify({ error: updateError instanceof Error ? updateError.message : 'Action could not be updated.' }), { status: 400 });
    }
  }

  const verifyMatch = pathname.match(/^\/api\/v2\/actions\/([^/]+)\/verify$/);
  if (verifyMatch && request.method === 'POST') {
    if (!(await canAccessAction(db, auth.userId, verifyMatch[1]))) return resourceNotFound();
    const action = await updateActionStatus(db, verifyMatch[1], 'awaiting_verification');
    if (!action) return new Response(JSON.stringify({ error: 'Action not found' }), { status: 404 });
    const audit = await createAudit(db, action.website_id, 'verification', { source: 'verification', idempotencyKey: `verify:${action.id}:${Date.now()}` });
    await dispatchAudit(db, env, ctx, audit);
    return new Response(JSON.stringify({ action, audit, jobId: audit.jobId }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  }

  const pageMatch = pathname.match(/^\/api\/v2\/page-identities\/([^/]+)$/);
  if (pageMatch && request.method === 'GET') {
    if (!(await canAccessPageIdentity(db, auth.userId, pageMatch[1]))) return resourceNotFound();
    const page = await getPageSnapshotDetail(db, pageMatch[1]);
    if (!page) return new Response(JSON.stringify({ error: 'Page not found' }), { status: 404 });
    return new Response(JSON.stringify({ page }), { headers: { 'Content-Type': 'application/json' } });
  }

  return null;
}

async function dispatchAudit(db: any, env: any, ctx: WaitUntilContext | undefined, audit: Awaited<ReturnType<typeof createAudit>>): Promise<void> {
  if (!audit.jobId) return;
  const job = await getCrawlJob(db, audit.jobId);
  if (!job || !['queued', 'retrying'].includes(job.status)) return;
  const message = await buildAuditJobMessage(db, audit);
  if (env?.CRAWL_JOBS?.send) {
    await env.CRAWL_JOBS.send(message);
    return;
  }
  const run = runAuditJob(db, env, message);
  if (ctx) ctx.waitUntil(run);
  else void run;
}

export async function handleReportRoutes(pathname: string, request: Request, db: any): Promise<Response | null> {
  // GET /api/v2/reports/:token - public report view
  const publicMatch = pathname.match(/^\/api\/v2\/reports\/([^/]+)\/view$/);
  if (publicMatch && request.method === 'GET') {
    const report = await getReportByToken(db, publicMatch[1]);
    if (!report) {
      return new Response(JSON.stringify({ error: 'Report not found' }), { status: 404 });
    }

    await recordReportView(db, report.id);

    return new Response(JSON.stringify({ report }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // GET /api/v2/organizations/:id/reports - list reports
  const listMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/reports$/);
  if (listMatch && request.method === 'GET') {
    const reports = await listReports(db, listMatch[1]);
    return new Response(JSON.stringify({ reports }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/audits/:id/reports - create report
  const createMatch = pathname.match(/^\/api\/v2\/audits\/([^/]+)\/reports$/);
  if (createMatch && request.method === 'POST') {
    const audit = await getAudit(db, createMatch[1]);
    if (!audit) {
      return new Response(JSON.stringify({ error: 'Audit not found' }), { status: 404 });
    }

    const website = await getWebsite(db, audit.websiteId);
    const org = await getOrganization(db, website?.organizationId || '');

    if (!website || !org) {
      return new Response(JSON.stringify({ error: 'Invalid audit' }), { status: 400 });
    }

    const report = await createReport(
      db,
      audit.id,
      audit.websiteId,
      org.id,
      auth.userId
    );

    return new Response(JSON.stringify({ report }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/reports/:id/share - share report
  const shareMatch = pathname.match(/^\/api\/v2\/reports\/([^/]+)\/share$/);
  if (shareMatch && request.method === 'POST') {
    const result = await shareReport(db, shareMatch[1]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function handleKeywordRoutes(pathname: string, request: Request, db: any): Promise<Response | null> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // POST /api/v2/websites/:id/keywords - track keyword
  const trackMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/keywords$/);
  if (trackMatch && request.method === 'POST') {
    const { keyword, searchVolume, difficulty } = await request.json();
    const kw = await trackKeyword(db, trackMatch[1], keyword, searchVolume, difficulty);
    return new Response(JSON.stringify({ keyword: kw }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/websites/:id/keywords - list keywords
  if (trackMatch && request.method === 'GET') {
    const keywords = await listWebsiteKeywords(db, trackMatch[1]);
    const trends = await getKeywordTrends(db, trackMatch[1]);
    return new Response(JSON.stringify({ keywords, trends }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/keywords/:id/ranking - record ranking
  const rankMatch = pathname.match(/^\/api\/v2\/keywords\/([^/]+)\/ranking$/);
  if (rankMatch && request.method === 'POST') {
    const { rank, trafficEstimate } = await request.json();
    const ranking = await recordRanking(db, rankMatch[1], 'website_id', rank, trafficEstimate);
    return new Response(JSON.stringify({ ranking }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function handleCompetitorRoutes(pathname: string, request: Request, db: any): Promise<Response | null> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // POST /api/v2/organizations/:id/competitors - add competitor
  const addMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/competitors$/);
  if (addMatch && request.method === 'POST') {
    const { baseWebsite, competitorDomain, competitorUrl } = await request.json();
    const competitor = await addCompetitor(db, addMatch[1], baseWebsite, competitorDomain, competitorUrl);
    return new Response(JSON.stringify({ competitor }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/organizations/:id/competitors - list competitors
  if (addMatch && request.method === 'GET') {
    const competitors = await listCompetitors(db, addMatch[1]);
    return new Response(JSON.stringify({ competitors }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/competitors/:domain/comparison - compare with competitor
  const compareMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/competitors\/([^/]+)\/comparison$/);
  if (compareMatch && request.method === 'GET') {
    const advantages = await getCompetitorAdvantages(db, compareMatch[1], compareMatch[2]);
    return new Response(JSON.stringify(advantages), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function handleContentRoutes(pathname: string, request: Request, db: any): Promise<Response | null> {
  const { auth, error } = await requireAuth(request);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // POST /api/v2/pages/:id/analyze - analyze page content
  const analyzeMatch = pathname.match(/^\/api\/v2\/pages\/([^/]+)\/analyze$/);
  if (analyzeMatch && request.method === 'POST') {
    const { html, title, keyword } = await request.json();

    // Get page from database
    const page = await db.prepare('SELECT url FROM pages WHERE id = ?').bind(analyzeMatch[1]).first();
    if (!page) {
      return new Response(JSON.stringify({ error: 'Page not found' }), { status: 404 });
    }

    const metrics = analyzePageContent(page.url, html, title, keyword);
    return new Response(JSON.stringify({
      metrics,
      review: {
        evidenceKind: 'observed',
        availability: metrics.wordCount ? 'measured' : 'insufficient',
        message: 'This is a structured content review. It is not a Google content-quality or E-E-A-T score.',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function routeRequest(request: Request, db: any, env: any, ctx?: WaitUntilContext): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Try auth routes first
  let response = await handleAuthRoutes(pathname, request, db, env);
  if (response) return response;

  // Try organization routes
  response = await handleOrgRoutes(pathname, request, db);
  if (response) return response;

  // Try website routes
  response = await handleWebsiteRoutes(pathname, request, db);
  if (response) return response;

  // Try audit routes
  response = await handleAuditRoutes(pathname, request, db, env, ctx);
  if (response) return response;

  response = await handleActionRoutes(pathname, request, db, env, ctx);
  if (response) return response;

  // Try report routes
  response = await handleReportRoutes(pathname, request, db);
  if (response) return response;

  // Try keyword routes
  response = await handleKeywordRoutes(pathname, request, db);
  if (response) return response;

  // Try competitor routes
  response = await handleCompetitorRoutes(pathname, request, db);
  if (response) return response;

  // Try content routes
  response = await handleContentRoutes(pathname, request, db);
  if (response) return response;

  return null;
}
