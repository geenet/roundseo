// API router for RoundSEO
import { buildRobotsTxtResponse } from '../../seo/robots';
import { buildSitemapResponse } from '../../seo/sitemap';
import { buildRedirectResponse } from '../../seo/redirects';
import { requireAuth } from '../auth/middleware';
import type { AuthEnvironment } from '../auth/jwt';
import { handleSignup, handleLogin, handleGoogleStart, handleGoogleCallback, handleGetMe, handleRefresh } from '../auth';
import { createOrganization, getOrganization, listOrganizations } from '../services/organizations';
import { createWebsite, getWebsite, listWebsites, updateSiteProfile, type SiteSetupInput } from '../services/websites';
import { buildAuditJobMessage, createAudit, createPerformanceAudit, getAudit, getAuditInsights, getCrawlJob, runAuditJob } from '../services/audits';
import { createReport, getReport, getReportByToken, listReports, shareReport, recordReportView } from '../services/reports';
import { getKeyword, trackKeyword, listWebsiteKeywords, getKeywordTrends, recordRanking } from '../services/keywords';
import { addCompetitor, listCompetitors, getCompetitorAdvantages } from '../services/competitor-analysis';
import { analyzePageContent } from '../services/content-analysis';
import { getAuditFoundation, getPageSnapshotDetail } from '../services/audit-foundation';
import { getPerformanceAuditForAudit } from '../services/performance';
import { getAuditPageInventory, getWebsiteOperatingOverview } from '../services/operating-overview';
import { getAction, listWebsiteActions, updateActionStatus } from '../services/actions';
import { canAccessAction, canAccessAudit, canAccessCrawlJob, canAccessOrganization, canAccessPageIdentity, canAccessWebsite, canRunWebsiteIntelligence } from '../services/access';
import {
  assertActionAvailable,
  capabilityForAction,
  executeSingleShotAction,
  INTELLIGENCE_CAPABILITY_ORDER,
  intelligenceCapabilityStatus,
  isAsyncIntelligenceAction,
  persistOutcome,
  publicRun,
  validateIntelligenceRequest,
} from '../services/intelligence';
import { startSiteCrawl } from '../services/intelligence-crawl';
import { enqueueIntelligenceRun } from '../services/intelligence-jobs';
import {
  createIntelligenceRun,
  getIntelligenceAsset,
  getIntelligenceRun,
  getIntelligenceRunByIdempotency,
  listIntelligenceEvidence,
  listIntelligenceRuns,
  updateIntelligenceRun,
  type IntelligenceRunRecord,
} from '../services/intelligence-store';
import { readIntelligenceConfig } from '../intelligence/config';
import { assetSignature, signedAssetUrl, verifyAssetSignature } from '../services/signed-assets';
import { captureWebsiteMedia, listWebsiteMedia, mediaItem, storedKey } from '../services/website-media';
import type { WebsiteMedia, WebsiteMediaItem, WebsiteMediaKind } from '../../shared/website-media';
import { IntelligenceError, publicIntelligenceError } from '../intelligence/errors';
import { handleBacklinkRoutes } from './backlinks-routes';
import { handleIndexingRoutes } from './indexing-routes';
import { domainOf } from '../intelligence/html';
import type { ActionStatus } from '../../shared/operating-model';
import type {
  IntelligenceCapability,
  IntelligenceEvidence,
  IntelligenceRun,
  IntelligenceRunRequest,
} from '../../shared/intelligence';

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };

function resourceNotFound(): Response {
  return new Response(JSON.stringify({ error: 'Resource not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleAuthRoutes(pathname: string, request: Request, db: any, env: any): Promise<Response | null> {
  if (pathname === '/api/v2/auth/signup' && request.method === 'POST') {
    return handleSignup(request, db, env);
  }

  if (pathname === '/api/v2/auth/login' && request.method === 'POST') {
    return handleLogin(request, db, env);
  }

  if (pathname === '/api/v2/auth/google/start' && request.method === 'GET') return handleGoogleStart(request, env);

  if (pathname === '/api/v2/auth/google/callback' && ['GET', 'POST'].includes(request.method)) {
    return handleGoogleCallback(request, env, db);
  }

  if (pathname === '/api/v2/auth/me' && request.method === 'GET') {
    return handleGetMe(request, env);
  }

  if (pathname === '/api/v2/auth/refresh' && request.method === 'POST') {
    return handleRefresh(request, env);
  }

  return null;
}

export async function handleOrgRoutes(pathname: string, request: Request, db: any, env: AuthEnvironment = {}): Promise<Response | null> {
  const { auth, error } = await requireAuth(request, env);
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
    const { name, billingEmail } = await request.json() as { name: string; billingEmail: string };
    if (typeof name !== 'string' || !name.trim() || typeof billingEmail !== 'string') return new Response(JSON.stringify({ error: 'Organization name and billing email are required' }), { status: 400 });
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

export async function handleWebsiteRoutes(pathname: string, request: Request, db: any, env: AuthEnvironment = {}): Promise<Response | null> {
  const { auth, error } = await requireAuth(request, env);
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
    const { name, domain, url, setup } = await request.json() as { name: string; domain: string; url: string; setup?: SiteSetupInput };
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
  const { auth, error } = await requireAuth(request, env);
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
  const { auth, error } = await requireAuth(request, env);
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

export async function handleReportRoutes(pathname: string, request: Request, db: any, env: AuthEnvironment = {}): Promise<Response | null> {
  // GET /api/v2/reports/:token - public report view
  const publicMatch = pathname.match(/^\/api\/v2\/reports\/([^/]+)\/view$/);
  if (publicMatch && request.method === 'GET') {
    const report = await getReportByToken(db, publicMatch[1]);
    if (!report || !report.isShared || report.isPasswordProtected || !report.expiresAt || Date.parse(report.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(report.expiresAt))) {
      return new Response(JSON.stringify({ error: 'Report not found' }), { status: 404 });
    }

    await recordReportView(db, report.id);

    const { title, reportType, generatedAt, expiresAt } = report;
    return new Response(JSON.stringify({ report: { title, reportType, generatedAt, expiresAt } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // GET /api/v2/organizations/:id/reports - list reports
  const listMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/reports$/);
  if (listMatch && request.method === 'GET') {
    if (!(await canAccessOrganization(db, auth.userId, listMatch[1]))) return resourceNotFound();
    const reports = await listReports(db, listMatch[1]);
    return new Response(JSON.stringify({ reports }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/audits/:id/reports - create report
  const createMatch = pathname.match(/^\/api\/v2\/audits\/([^/]+)\/reports$/);
  if (createMatch && request.method === 'POST') {
    if (!(await canAccessAudit(db, auth.userId, createMatch[1]))) return resourceNotFound();
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
    const report = await getReport(db, shareMatch[1]);
    if (!report || !(await canAccessOrganization(db, auth.userId, report.organizationId))) return resourceNotFound();
    const result = await shareReport(db, shareMatch[1]);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function handleKeywordRoutes(pathname: string, request: Request, db: any, env: AuthEnvironment = {}): Promise<Response | null> {
  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // POST /api/v2/websites/:id/keywords - track keyword
  const trackMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/keywords$/);
  if (trackMatch && request.method === 'POST') {
    if (!(await canAccessWebsite(db, auth.userId, trackMatch[1]))) return resourceNotFound();
    const { keyword, searchVolume, difficulty } = await request.json() as { keyword: string; searchVolume?: number; difficulty?: number };
    if (typeof keyword !== 'string' || !keyword.trim() || (searchVolume !== undefined && (!Number.isFinite(searchVolume) || searchVolume < 0)) || (difficulty !== undefined && (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 100))) return new Response(JSON.stringify({ error: 'Provide a keyword and valid source metrics' }), { status: 400 });
    const kw = await trackKeyword(db, trackMatch[1], keyword, searchVolume, difficulty);
    return new Response(JSON.stringify({ keyword: kw }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/websites/:id/keywords - list keywords
  if (trackMatch && request.method === 'GET') {
    if (!(await canAccessWebsite(db, auth.userId, trackMatch[1]))) return resourceNotFound();
    const keywords = await listWebsiteKeywords(db, trackMatch[1]);
    const trends = await getKeywordTrends(db, trackMatch[1]);
    return new Response(JSON.stringify({ keywords, trends }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/v2/keywords/:id/ranking - record ranking
  const rankMatch = pathname.match(/^\/api\/v2\/keywords\/([^/]+)\/ranking$/);
  if (rankMatch && request.method === 'POST') {
    const keyword = await getKeyword(db, rankMatch[1]);
    if (!keyword || !(await canAccessWebsite(db, auth.userId, keyword.websiteId))) return resourceNotFound();
    const { rank, trafficEstimate } = await request.json() as { rank: number; trafficEstimate?: number };
    if (!Number.isFinite(rank) || rank <= 0) return new Response(JSON.stringify({ error: 'Rank must be a positive number' }), { status: 400 });
    const ranking = await recordRanking(db, rankMatch[1], keyword.websiteId, rank, trafficEstimate);
    return new Response(JSON.stringify({ ranking }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function handleCompetitorRoutes(pathname: string, request: Request, db: any, env: AuthEnvironment = {}): Promise<Response | null> {
  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // POST /api/v2/organizations/:id/competitors - add competitor
  const addMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/competitors$/);
  if (addMatch && request.method === 'POST') {
    if (!(await canAccessOrganization(db, auth.userId, addMatch[1]))) return resourceNotFound();
    const { baseWebsite, competitorDomain, competitorUrl } = await request.json() as { baseWebsite: string; competitorDomain: string; competitorUrl: string };
    const website = await getWebsite(db, baseWebsite);
    if (!website || website.organizationId !== addMatch[1]) return resourceNotFound();
    const competitor = await addCompetitor(db, addMatch[1], baseWebsite, competitorDomain, competitorUrl);
    return new Response(JSON.stringify({ competitor }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/organizations/:id/competitors - list competitors
  if (addMatch && request.method === 'GET') {
    if (!(await canAccessOrganization(db, auth.userId, addMatch[1]))) return resourceNotFound();
    const competitors = await listCompetitors(db, addMatch[1]);
    return new Response(JSON.stringify({ competitors }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/v2/competitors/:domain/comparison - compare with competitor
  const compareMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/competitors\/([^/]+)\/comparison$/);
  if (compareMatch && request.method === 'GET') {
    if (!(await canAccessWebsite(db, auth.userId, compareMatch[1]))) return resourceNotFound();
    const advantages = await getCompetitorAdvantages(db, compareMatch[1], compareMatch[2]);
    return new Response(JSON.stringify(advantages), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

export async function handleContentRoutes(pathname: string, request: Request, db: any, env: AuthEnvironment = {}): Promise<Response | null> {
  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) {
    return new Response(JSON.stringify({ error }), { status: 401 });
  }

  // POST /api/v2/pages/:id/analyze - analyze page content
  const analyzeMatch = pathname.match(/^\/api\/v2\/pages\/([^/]+)\/analyze$/);
  if (analyzeMatch && request.method === 'POST') {
    const { html, title, keyword } = await request.json() as { html: string; title: string; keyword?: string };
    if (typeof html !== 'string' || typeof title !== 'string') return new Response(JSON.stringify({ error: 'HTML and title must be supplied as text' }), { status: 400 });

    // Get page from database
    const page = await db.prepare('SELECT url, website_id FROM pages WHERE id = ?').bind(analyzeMatch[1]).first();
    if (!page || !(await canAccessWebsite(db, auth.userId, page.website_id))) {
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

const INTELLIGENCE_ASSET_TTL_SECONDS = 5 * 60;
const INTELLIGENCE_ASSET_PATH = /^\/api\/v2\/websites\/([^/]+)\/intelligence\/assets\/([^/]+)$/;
const INTELLIGENCE_SCREENSHOT_PATH = /^\/api\/v2\/websites\/[^/]+\/intelligence\/assets\/([^/?#]+)$/;

export async function handleIntelligenceRoutes(pathname: string, request: Request, db: any, env: any, ctx?: WaitUntilContext): Promise<Response | null> {
  const assetMatch = pathname.match(INTELLIGENCE_ASSET_PATH);
  if (assetMatch && request.method === 'GET') {
    return serveSignedIntelligenceAsset(request, db, env, decodePathPart(assetMatch[1]), decodePathPart(assetMatch[2]));
  }
  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) return jsonResponse({ error }, 401);

  try {
    if (pathname === '/api/v2/intelligence/status' && request.method === 'GET') {
      return jsonResponse(intelligenceCapabilityStatus(readIntelligenceConfig(env)));
    }

    const collectionMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/intelligence\/runs$/);
    const evidenceMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/intelligence\/evidence$/);
    const runMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/intelligence\/runs\/([^/]+)$/);
    const actionMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/intelligence\/runs\/([^/]+)\/(refresh|cancel)$/);
    const routeMatch = collectionMatch || evidenceMatch || runMatch || actionMatch;
    const websiteId = decodePathPart(routeMatch?.[1]);
    if (!routeMatch || !websiteId) return null;
    if (!(await canAccessWebsite(db, auth.userId, websiteId))) return resourceNotFound();

    const website = await getWebsite(db, websiteId);
    const websiteDomain = website ? domainOf(website.url) : null;
    if (!website || !websiteDomain) return resourceNotFound();
    const context: IntelligenceRequestContext = { db, env, ctx, request, userId: auth.userId, websiteId, websiteDomain };

    if (collectionMatch && request.method === 'GET') return await listIntelligenceRunsRoute(context);
    if (collectionMatch && request.method === 'POST') return await createIntelligenceRunRoute(context);
    if (evidenceMatch && request.method === 'GET') return await listIntelligenceEvidenceRoute(context);
    if (runMatch && request.method === 'GET') return await getIntelligenceRunRoute(context, decodePathPart(runMatch[2]));
    if (actionMatch && request.method === 'POST' && actionMatch[3] === 'refresh') return await refreshCrawlRoute(context, decodePathPart(actionMatch[2]));
    if (actionMatch && request.method === 'POST' && actionMatch[3] === 'cancel') return await cancelCrawlRoute(context, decodePathPart(actionMatch[2]));
    return null;
  } catch (intelligenceError) {
    return intelligenceErrorResponse(intelligenceError);
  }
}

interface IntelligenceRequestContext {
  db: any;
  env: any;
  ctx?: WaitUntilContext;
  request: Request;
  userId: string;
  websiteId: string;
  websiteDomain: string;
}

async function listIntelligenceRunsRoute(context: IntelligenceRequestContext): Promise<Response> {
  const url = new URL(context.request.url);
  const capability = parseCapability(url.searchParams.get('capability'));
  const limit = parseBoundedQueryInteger(url.searchParams.get('limit'), 50, 1, 200, 'limit');
  const offset = parseBoundedQueryInteger(url.searchParams.get('offset'), 0, 0, 100_000, 'offset');
  const records = await listIntelligenceRuns(context.db, context.websiteId, { capability, limit, offset });
  // Run lists carry metadata only; evidence is fetched from the evidence endpoint.
  return jsonResponse({ runs: records.map(record => publicRun(record, [])) });
}

async function listIntelligenceEvidenceRoute(context: IntelligenceRequestContext): Promise<Response> {
  const url = new URL(context.request.url);
  const capability = parseCapability(url.searchParams.get('capability'));
  const kind = url.searchParams.get('kind') || undefined;
  const limit = parseBoundedQueryInteger(url.searchParams.get('limit'), 100, 1, 1000, 'limit');
  const offset = parseBoundedQueryInteger(url.searchParams.get('offset'), 0, 0, 100_000, 'offset');
  const records = await listIntelligenceEvidence<IntelligenceEvidence>(context.db, context.websiteId, { capability, kind, limit, offset });
  const evidence = await signEvidence(records.map(record => record.payload), context);
  return jsonResponse({ evidence });
}

async function getIntelligenceRunRoute(context: IntelligenceRequestContext, runId: string): Promise<Response> {
  const record = await getIntelligenceRun(context.db, context.websiteId, runId);
  if (!record) return resourceNotFound();
  return jsonResponse({ run: await hydrateIntelligenceRun(record, context) });
}

async function createIntelligenceRunRoute(context: IntelligenceRequestContext): Promise<Response> {
  const { db, env, ctx, request, websiteId, websiteDomain } = context;
  if (!(await canRunWebsiteIntelligence(db, context.userId, websiteId))) return intelligenceWriteForbidden();
  const idempotencyKey = parseIdempotencyKey(request.headers.get('Idempotency-Key'));
  if (!idempotencyKey) return idempotencyKeyRequired();
  const config = readIntelligenceConfig(env);
  const payload = await request.json().catch(() => null);
  const normalized = validateIntelligenceRequest(payload, { websiteDomain, config });
  const existing = await getIntelligenceRunByIdempotency(db, websiteId, idempotencyKey);
  if (existing) {
    if (!sameIntelligenceRequest(existing.request, normalized)) return idempotencyConflict();
    return jsonResponse({ run: await hydrateIntelligenceRun(existing, context) });
  }
  assertActionAvailable(config, normalized.action);

  const runId = `intelligence_run_${crypto.randomUUID()}`;
  const scope = { db, websiteId, websiteDomain, config };
  const capability = capabilityForAction(normalized.action);

  if (isAsyncIntelligenceAction(normalized.action)) {
    const record = await createIntelligenceRun(db, {
      id: runId, websiteId, userId: context.userId, capability, action: normalized.action, request: normalized,
      status: 'queued', statusMessage: 'Queued for crawling.', idempotencyKey, progressTotal: null,
    });
    if (record.id !== runId) return jsonResponse({ run: await hydrateIntelligenceRun(record, context) });
    await startSiteCrawl(scope, runId, normalized as Extract<IntelligenceRunRequest, { action: 'site_crawl' }>);
    await enqueueIntelligenceRun(env, ctx, websiteId, runId);
    const queued = await getIntelligenceRun(db, websiteId, runId);
    return jsonResponse({ run: await hydrateIntelligenceRun(queued || record, context) }, 202);
  }

  const record = await createIntelligenceRun(db, {
    id: runId, websiteId, userId: context.userId, capability, action: normalized.action, request: normalized,
    status: 'running', statusMessage: 'RoundSEO is collecting intelligence evidence.', idempotencyKey,
  });
  // A concurrent request with the same key already owns this run; never collect twice.
  if (record.id !== runId) return jsonResponse({ run: await hydrateIntelligenceRun(record, context) });
  try {
    const outcome = await executeSingleShotAction(scope, normalized);
    await persistOutcome(scope, runId, outcome);
  } catch (error) {
    await markIntelligenceRunFailed(db, websiteId, runId, error);
    throw error;
  }
  const saved = await getIntelligenceRun(db, websiteId, runId);
  return jsonResponse({ run: await hydrateIntelligenceRun(saved || record, context) }, 201);
}

async function refreshCrawlRoute(context: IntelligenceRequestContext, runId: string): Promise<Response> {
  const { db, env, ctx, request, websiteId, websiteDomain } = context;
  if (!(await canRunWebsiteIntelligence(db, context.userId, websiteId))) return intelligenceWriteForbidden();
  const idempotencyKey = parseIdempotencyKey(request.headers.get('Idempotency-Key'));
  if (!idempotencyKey) return idempotencyKeyRequired();
  const parent = await getIntelligenceRun(db, websiteId, runId);
  if (!parent) return resourceNotFound();
  if (parent.action !== 'site_crawl' && parent.action !== 'site_crawl_refresh') {
    return jsonResponse({ error: 'Only a site crawl can be refreshed.', code: 'INVALID_INTELLIGENCE_RUN' }, 409);
  }
  if (parent.status === 'queued' || parent.status === 'running') {
    return jsonResponse({ error: 'This crawl is still running. Wait for it to finish before refreshing.', code: 'INTELLIGENCE_RUN_ACTIVE' }, 409);
  }
  const config = readIntelligenceConfig(env);
  const existing = await getIntelligenceRunByIdempotency(db, websiteId, idempotencyKey);
  if (existing) {
    if (existing.parentRunId !== runId) return idempotencyConflict();
    return jsonResponse({ run: await hydrateIntelligenceRun(existing, context) });
  }
  assertActionAvailable(config, 'site_crawl');
  const crawlRequest = parent.request as Extract<IntelligenceRunRequest, { action: 'site_crawl' }>;
  const refreshId = `intelligence_run_${crypto.randomUUID()}`;
  const record = await createIntelligenceRun(db, {
    id: refreshId, websiteId, userId: context.userId, capability: 'page_intelligence', action: 'site_crawl_refresh',
    request: crawlRequest, parentRunId: runId, status: 'queued', statusMessage: 'Queued for a refreshed crawl.', idempotencyKey, progressTotal: null,
  });
  if (record.id !== refreshId) return jsonResponse({ run: await hydrateIntelligenceRun(record, context) });
  await startSiteCrawl({ db, websiteId, websiteDomain, config }, refreshId, crawlRequest);
  await enqueueIntelligenceRun(env, ctx, websiteId, refreshId);
  return jsonResponse({ run: await hydrateIntelligenceRun(record, context) }, 202);
}

async function cancelCrawlRoute(context: IntelligenceRequestContext, runId: string): Promise<Response> {
  const { db, websiteId } = context;
  if (!(await canRunWebsiteIntelligence(db, context.userId, websiteId))) return intelligenceWriteForbidden();
  const record = await getIntelligenceRun(db, websiteId, runId);
  if (!record) return resourceNotFound();
  if (record.action !== 'site_crawl' && record.action !== 'site_crawl_refresh') {
    return jsonResponse({ error: 'Only a site crawl can be cancelled.', code: 'INVALID_INTELLIGENCE_RUN' }, 409);
  }
  if (record.status !== 'queued' && record.status !== 'running') {
    return jsonResponse({ error: 'This crawl is not running.', code: 'INTELLIGENCE_RUN_INACTIVE' }, 409);
  }
  if (record.cancelRequestedAt) return jsonResponse({ run: await hydrateIntelligenceRun(record, context) }, 202);
  const updated = await updateIntelligenceRun(db, websiteId, runId, {
    cancelRequestedAt: new Date().toISOString(),
    statusMessage: 'Cancellation requested. Pages collected so far remain saved.',
  });
  return jsonResponse({ run: await hydrateIntelligenceRun(updated || record, context) }, 202);
}

async function hydrateIntelligenceRun(record: IntelligenceRunRecord, context: IntelligenceRequestContext): Promise<IntelligenceRun> {
  const records = await listIntelligenceEvidence<IntelligenceEvidence>(context.db, record.websiteId, { runId: record.id, limit: 1_000 });
  const evidence = await signEvidence(records.map(item => item.payload), context);
  return publicRun(record, evidence);
}

/** Replace internal screenshot references with short-lived signed URLs. */
async function signEvidence(items: IntelligenceEvidence[], context: IntelligenceRequestContext): Promise<IntelligenceEvidence[]> {
  return Promise.all(items.map(async item => {
    if (item.kind !== 'page' || !item.screenshotUrl) return item;
    const match = INTELLIGENCE_SCREENSHOT_PATH.exec(item.screenshotUrl);
    if (!match) return item;
    const signed = await createSignedIntelligenceAssetUrl(context.request.url, context.env, context.websiteId, decodePathPart(match[1]));
    return { ...item, screenshotUrl: signed };
  }));
}

async function createSignedIntelligenceAssetUrl(requestUrl: string, env: any, websiteId: string, assetId: string): Promise<string | null> {
  const secret = readIntelligenceConfig(env).assetSecret;
  if (!secret) return null;
  const expires = Math.floor(Date.now() / 1000) + INTELLIGENCE_ASSET_TTL_SECONDS;
  const signature = await intelligenceAssetSignature(secret, websiteId, assetId, expires);
  const url = new URL(`/api/v2/websites/${encodeURIComponent(websiteId)}/intelligence/assets/${encodeURIComponent(assetId)}`, requestUrl);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('sig', signature);
  return url.href;
}

async function serveSignedIntelligenceAsset(request: Request, db: any, env: any, websiteId: string, assetId: string): Promise<Response> {
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get('expires'));
  const suppliedSignature = url.searchParams.get('sig') || '';
  const config = readIntelligenceConfig(env);
  const now = Math.floor(Date.now() / 1000);
  if (!config.assetSecret || !Number.isInteger(expires) || expires < now || expires > now + INTELLIGENCE_ASSET_TTL_SECONDS + 30 || !suppliedSignature) {
    return resourceNotFound();
  }
  const expectedSignature = await intelligenceAssetSignature(config.assetSecret, websiteId, assetId, expires);
  if (!constantTimeStringEqual(expectedSignature, suppliedSignature)) return resourceNotFound();
  const asset = await getIntelligenceAsset(db, websiteId, assetId);
  if (!asset || !config.assetStore) return resourceNotFound();
  const object = await config.assetStore.get(asset.storageKey);
  if (!object) return resourceNotFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': asset.contentType,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function intelligenceAssetSignature(secret: string, websiteId: string, assetId: string, expires: number): Promise<string> {
  return assetSignature(secret, 'intelligence-asset', websiteId, assetId, expires);
}

function constantTimeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function decodePathPart(value: string | undefined): string {
  if (!value) return '';
  try { return decodeURIComponent(value); } catch { return ''; }
}

function intelligenceWriteForbidden(): Response {
  return jsonResponse({ error: 'Starting intelligence collection requires an organization owner, admin, or manager.', code: 'INTELLIGENCE_ROLE_REQUIRED' }, 403);
}

function parseCapability(value: string | null): IntelligenceCapability | undefined {
  if (!value) return undefined;
  if (INTELLIGENCE_CAPABILITY_ORDER.includes(value as IntelligenceCapability)) return value as IntelligenceCapability;
  throw new IntelligenceError('The requested intelligence capability is not supported.', { status: 400, code: 'INVALID_INTELLIGENCE_QUERY' });
}

function parseBoundedQueryInteger(value: string | null, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new IntelligenceError(`${label} must be an integer from ${minimum} to ${maximum}.`, { status: 400, code: 'INVALID_INTELLIGENCE_QUERY' });
  }
  return parsed;
}

function parseIdempotencyKey(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw new IntelligenceError('Idempotency-Key must be 8 to 128 URL-safe characters.', { status: 400, code: 'INVALID_IDEMPOTENCY_KEY' });
  }
  return value;
}

function idempotencyKeyRequired(): Response {
  return jsonResponse({ error: 'Idempotency-Key is required for intelligence collection requests.', code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
}

function idempotencyConflict(): Response {
  return jsonResponse({ error: 'This Idempotency-Key is already associated with a different intelligence request.', code: 'IDEMPOTENCY_CONFLICT' }, 409);
}

function sameIntelligenceRequest(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function markIntelligenceRunFailed(db: any, websiteId: string, runId: string, error: unknown): Promise<void> {
  const publicError = publicIntelligenceError(error);
  await updateIntelligenceRun(db, websiteId, runId, {
    status: 'failed',
    statusMessage: publicError.message,
    errorCode: publicError.code,
    errorMessage: publicError.message,
    completedAt: new Date().toISOString(),
    leaseExpiresAt: null,
  });
}

function intelligenceErrorResponse(error: unknown): Response {
  const normalized = publicIntelligenceError(error);
  return jsonResponse({ error: normalized.message, code: normalized.code }, normalized.status);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleSeoRoutes(pathname: string, request: Request, env: any): Promise<Response | null> {
  if (pathname === '/robots.txt' && request.method === 'GET') {
    return buildRobotsTxtResponse({
      sitemapUrl: `${env?.API_URL ?? ''}/sitemap.xml`,
    });
  }

  if (pathname === '/sitemap.xml' && request.method === 'GET') {
    return buildSitemapResponse({
      baseUrl: env?.API_URL ?? 'https://example.com',
    });
  }

  return null;
}

/**
 * Serve declared redirects (TECH-028/029/030) before any other routing.
 * Every entry resolves to its final destination in a single hop (TECH-029).
 */
export function handleRedirectRoutes(pathname: string, request: Request, env: any): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  return buildRedirectResponse(pathname, env?.API_URL ?? '');
}

export async function routeRequest(request: Request, db: any, env: any, ctx?: WaitUntilContext): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Declared redirects take priority over everything else
  const redirectResponse = handleRedirectRoutes(pathname, request, env);
  if (redirectResponse) return redirectResponse;

  // SEO files (public, no auth)
  const response = await handleSeoRoutes(pathname, request, env);
  if (response) return response;

  // Website media (favicon and preview) has its own routes and signed serving.
  if (/^\/api\/v2\/organizations\/[^/]+\/website-media$/.test(pathname) || /^\/api\/v2\/websites\/[^/]+\/media\/(?:refresh|favicon|thumbnail)$/.test(pathname)) {
    return handleWebsiteMediaRoutes(pathname, request, db, env);
  }

  // Select the owning handler before authentication, including public report views.
  if (pathname.startsWith('/api/v2/auth/')) return handleAuthRoutes(pathname, request, db, env);
  if (/^\/api\/v2\/organizations(?:\/[^/]+)?$/.test(pathname)) return handleOrgRoutes(pathname, request, db, env);
  if (/^\/api\/v2\/(?:organizations\/[^/]+\/websites|websites\/[^/]+(?:\/(?:overview|actions|profile))?)$/.test(pathname)) return handleWebsiteRoutes(pathname, request, db, env);
  if (/^\/api\/v2\/(?:websites\/[^/]+\/(?:audits|performance-audits)|audits\/[^/]+(?:\/(?:performance|insights|pages|foundation))?|crawl-jobs\/[^/]+)$/.test(pathname)) return handleAuditRoutes(pathname, request, db, env, ctx);
  if (/^\/api\/v2\/(?:actions\/[^/]+(?:\/verify)?|page-identities\/[^/]+)$/.test(pathname)) return handleActionRoutes(pathname, request, db, env, ctx);
  if (/^\/api\/v2\/(?:reports\/[^/]+\/(?:view|share)|organizations\/[^/]+\/reports|audits\/[^/]+\/reports)$/.test(pathname)) return handleReportRoutes(pathname, request, db, env);
  if (/^\/api\/v2\/(?:websites\/[^/]+\/keywords|keywords\/[^/]+\/ranking)$/.test(pathname)) return handleKeywordRoutes(pathname, request, db, env);
  if (/^\/api\/v2\/(?:organizations\/[^/]+\/competitors|websites\/[^/]+\/competitors\/[^/]+\/comparison)$/.test(pathname)) return handleCompetitorRoutes(pathname, request, db, env);
  if (/^\/api\/v2\/pages\/[^/]+\/analyze$/.test(pathname)) return handleContentRoutes(pathname, request, db, env);
  if (pathname === '/api/v2/intelligence/status' || /^\/api\/v2\/websites\/[^/]+\/intelligence\/(?:runs(?:\/[^/]+(?:\/(?:refresh|cancel))?)?|evidence|assets\/[^/]+)$/.test(pathname)) {
    return handleIntelligenceRoutes(pathname, request, db, env, ctx);
  }
  if (/^\/api\/v2\/(?:backlink-shares\/[^/]+(?:\/revoke)?|websites\/[^/]+\/backlinks\/imports|backlinks\/imports\/[^/]+\/commit|websites\/[^/]+\/backlinks|backlinks\/[^/]+(?:\/checks|\/history)?|websites\/[^/]+\/backlink-lists|backlink-lists\/[^/]+\/(?:members|shares)|websites\/[^/]+\/discovery-jobs|organizations\/[^/]+\/backlinks\/usage)$/.test(pathname)) {
    return handleBacklinkRoutes(pathname, request, db, env, ctx);
  }
  if (/^\/api\/v2\/websites\/[^/]+\/(?:google-connection(?:\/(?:start|callback|sites|property))?|indexing(?:\/(?:inventory|handoff|actions|adapters))?|inspection-jobs|sitemap-submissions)$/.test(pathname)) {
    return handleIndexingRoutes(pathname, request, db, env, ctx);
  }

  return null;
}

const WEBSITE_MEDIA_TTL_SECONDS = 60 * 60;
const WEBSITE_MEDIA_PATH = /^\/api\/v2\/websites\/([^/]+)\/media\/(favicon|thumbnail)$/;

async function handleWebsiteMediaRoutes(pathname: string, request: Request, db: any, env: any): Promise<Response | null> {
  const served = pathname.match(WEBSITE_MEDIA_PATH);
  if (served && request.method === 'GET') {
    return serveSignedWebsiteMedia(request, db, env, decodePathPart(served[1]), served[2] as WebsiteMediaKind);
  }
  const { auth, error } = await requireAuth(request, env);
  if (error || !auth) return jsonResponse({ error }, 401);
  try {
    const listMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/website-media$/);
    if (listMatch && request.method === 'GET') {
      const organizationId = decodePathPart(listMatch[1]);
      if (!(await canAccessOrganization(db, auth.userId, organizationId))) return resourceNotFound();
      return jsonResponse({ media: await organizationWebsiteMedia(db, organizationId, request.url, env) });
    }
    const refreshMatch = pathname.match(/^\/api\/v2\/websites\/([^/]+)\/media\/refresh$/);
    if (refreshMatch && request.method === 'POST') {
      const websiteId = decodePathPart(refreshMatch[1]);
      if (!(await canAccessWebsite(db, auth.userId, websiteId))) return resourceNotFound();
      // Owners, admins, and managers may run collection for the organization; read-only members may not.
      if (!(await canRunWebsiteIntelligence(db, auth.userId, websiteId))) {
        return jsonResponse({ error: 'Refreshing previews requires an organization owner, admin, or manager.', code: 'WEBSITE_ROLE_REQUIRED' }, 403);
      }
      const website = await getWebsite(db, websiteId);
      if (!website) return resourceNotFound();
      const captured = await captureWebsiteMedia({ db, websiteId, websiteUrl: website.url, config: readIntelligenceConfig(env) });
      return jsonResponse({ media: await signWebsiteMedia(captured, request.url, env) });
    }
    return null;
  } catch (mediaError) {
    return intelligenceErrorResponse(mediaError);
  }
}

async function organizationWebsiteMedia(db: any, organizationId: string, requestUrl: string, env: any): Promise<WebsiteMedia[]> {
  const rows = await db.prepare('SELECT id FROM websites WHERE organization_id = ? ORDER BY created_at ASC').bind(organizationId).all();
  const websiteIds = ((rows?.results ?? rows ?? []) as Array<{ id: string }>).map(row => String(row.id));
  const stored = await listWebsiteMedia(db, websiteIds);
  const media: WebsiteMedia[] = [];
  for (const websiteId of websiteIds) {
    const entry = stored.get(websiteId) ?? { favicon: null, thumbnail: null };
    media.push({
      websiteId,
      favicon: await signedMediaItem(entry.favicon, 'favicon', websiteId, requestUrl, env),
      thumbnail: await signedMediaItem(entry.thumbnail, 'thumbnail', websiteId, requestUrl, env),
    });
  }
  return media;
}

async function signedMediaItem(row: Parameters<typeof mediaItem>[0], kind: WebsiteMediaKind, websiteId: string, requestUrl: string, env: any): Promise<WebsiteMediaItem> {
  const secret = readIntelligenceConfig(env).assetSecret;
  const url = storedKey(row) && secret
    ? await signedAssetUrl(requestUrl, `/api/v2/websites/${encodeURIComponent(websiteId)}/media/${kind}`, secret, 'website-media', websiteId, kind, WEBSITE_MEDIA_TTL_SECONDS)
    : null;
  return mediaItem(row, kind, url);
}

async function signWebsiteMedia(media: WebsiteMedia, requestUrl: string, env: any): Promise<WebsiteMedia> {
  const sign = async (item: WebsiteMediaItem | null): Promise<WebsiteMediaItem | null> => {
    if (!item || item.status !== 'available') return item;
    const secret = readIntelligenceConfig(env).assetSecret;
    const url = secret ? await signedAssetUrl(requestUrl, `/api/v2/websites/${encodeURIComponent(media.websiteId)}/media/${item.kind}`, secret, 'website-media', media.websiteId, item.kind, WEBSITE_MEDIA_TTL_SECONDS) : null;
    return { ...item, url };
  };
  return { ...media, favicon: await sign(media.favicon), thumbnail: await sign(media.thumbnail) };
}

async function serveSignedWebsiteMedia(request: Request, db: any, env: any, websiteId: string, kind: WebsiteMediaKind): Promise<Response> {
  const url = new URL(request.url);
  const config = readIntelligenceConfig(env);
  if (!config.assetSecret || !config.assetStore) return resourceNotFound();
  const valid = await verifyAssetSignature(config.assetSecret, 'website-media', websiteId, kind, Number(url.searchParams.get('expires')), url.searchParams.get('sig') || '', WEBSITE_MEDIA_TTL_SECONDS);
  if (!valid) return resourceNotFound();
  const row = await db.prepare('SELECT status, storage_key, content_type FROM website_media WHERE website_id = ? AND kind = ?').bind(websiteId, kind).first();
  if (!row || row.status !== 'available' || !row.storage_key) return resourceNotFound();
  const object = await config.assetStore.get(String(row.storage_key));
  if (!object) return resourceNotFound();
  return new Response(object.body, {
    headers: {
      'Content-Type': String(row.content_type || 'application/octet-stream'),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
