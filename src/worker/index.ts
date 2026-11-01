// RoundSEO Worker Entry Point
// Handles all API requests, auth, and crawl orchestration

import { routeRequest } from './api/router';
import { buildAuditJobMessage, createAudit, getCrawlJob, recoverExpiredCrawlJobs, runAuditJob } from './services/audits';
import { isIntelligenceJobMessage, recoverStaleIntelligenceRuns, runIntelligenceJob, enqueueIntelligenceRun } from './services/intelligence-jobs';

interface Env extends WorkerBindings {
  ROUNDSEO_PERFORMANCE_RUNNER_URL?: string;
  ROUNDSEO_RUNNER_TOKEN?: string;
  PERFORMANCE_RUNNER?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  CRAWL_JOBS?: { send(message: unknown): Promise<void> };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Route to API handlers
      const response = await routeRequest(request, env.DB, env, ctx);
      if (response) {
        return response;
      }

      // 404 for unmatched routes
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Request error:', error);
      return new Response(
        JSON.stringify({
          error: error instanceof SyntaxError ? 'Invalid request JSON' : 'Internal Server Error'
        }),
        {
          status: error instanceof SyntaxError ? 400 : 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    try {
      console.log('Scheduled crawl check started');

      // Get all active audit schedules where next_run_at <= now
      const now = new Date().toISOString();
      const recoveredJobs = await recoverExpiredCrawlJobs(env.DB);
      await recoverStaleIntelligenceRuns(env as any, ctx, new Date());
      for (const message of recoveredJobs) await enqueueAuditMessage(env, ctx, message);
      const schedules = await env.DB.prepare(`
        SELECT id, website_id, schedule_type, next_run_at FROM audit_schedules
        WHERE is_active = TRUE AND next_run_at <= ?
      `).bind(now).all();

      console.log(`Found ${schedules.results?.length || 0} schedules to process`);

      // Trigger crawl for each due website
      for (const schedule of schedules.results || []) {
        console.log(`Triggering scheduled crawl for website: ${schedule.website_id}`);

        // Get website details
        const website = await env.DB.prepare(
          'SELECT url FROM websites WHERE id = ?'
        ).bind(schedule.website_id).first();

        if (website) {
          const audit = await createAudit(env.DB, String(schedule.website_id), 'scheduled', {
            source: 'schedule',
            idempotencyKey: `schedule:${schedule.id}:${schedule.next_run_at}`,
          });
          await enqueueAudit(env, ctx, audit);

          // Update next run time for this schedule
          const nextRun = calculateNextRun(schedule);
          await env.DB.prepare(`
            UPDATE audit_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?
          `).bind(now, nextRun, schedule.id).run();
        }
      }

      console.log('Scheduled crawl check completed');
    } catch (error) {
      console.error('Scheduled event error:', error);
    }
  },

  async queue(batch: any, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages || []) {
      if (isIntelligenceJobMessage(message.body)) {
        try {
          const outcome = await runIntelligenceJob(env as any, message.body);
          if (outcome === 'continue') await enqueueIntelligenceRun(env as any, ctx, message.body.websiteId, message.body.intelligenceRunId);
          message.ack();
        } catch (error) {
          console.error('Intelligence job failed:', error);
          message.retry();
        }
        continue;
      }
      const payload = message.body as { jobId?: string; auditId?: string; websiteUrl?: string; websiteId?: string; source?: 'user' | 'schedule' | 'verification'; jobType?: 'site_crawl' | 'verification_crawl' | 'pagespeed_audit' };
      if (!payload.jobId || !payload.auditId || !payload.websiteUrl) {
        message.ack();
        continue;
      }
      const run = runAuditJob(env.DB, env, {
        jobId: payload.jobId,
        auditId: payload.auditId,
        websiteId: payload.websiteId || '',
        websiteUrl: payload.websiteUrl,
        source: payload.source || 'user',
        jobType: payload.jobType,
      });
      await run;
      const job = await getCrawlJob(env.DB, payload.jobId);
      if (job?.status === 'retrying') message.retry();
      else message.ack();
    }
  },
} satisfies ExportedHandler<Env>;

async function enqueueAudit(env: Env, ctx: ExecutionContext, audit: Awaited<ReturnType<typeof createAudit>>): Promise<void> {
  const message = await buildAuditJobMessage(env.DB, audit);
  await enqueueAuditMessage(env, ctx, message);
}

async function enqueueAuditMessage(env: Env, ctx: ExecutionContext, message: Awaited<ReturnType<typeof buildAuditJobMessage>>): Promise<void> {
  if (env.CRAWL_JOBS?.send) {
    await env.CRAWL_JOBS.send(message);
    return;
  }
  ctx.waitUntil(runAuditJob(env.DB, env, message));
}

function calculateNextRun(schedule: any): string {
  const nextRun = new Date(schedule.next_run_at);

  switch (schedule.schedule_type) {
    case 'daily':
      nextRun.setDate(nextRun.getDate() + 1);
      break;
    case 'weekly':
      nextRun.setDate(nextRun.getDate() + 7);
      break;
    case 'monthly':
      nextRun.setMonth(nextRun.getMonth() + 1);
      break;
  }

  return nextRun.toISOString();
}
