// Scheduled crawl orchestration using Durable Objects
import { nanoid } from 'nanoid';

export interface ScheduledCrawl {
  id: string;
  websiteId: string;
  scheduleType: 'daily' | 'weekly' | 'monthly';
  dayOfWeek?: number;
  timeOfDay: string;
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
}

export class CrawlScheduler {
  private state: DurableObjectState;
  private env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/schedule') {
      return this.handleSchedule(request);
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      return this.handleStatus();
    }

    if (request.method === 'POST' && url.pathname === '/trigger') {
      return this.handleTrigger(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleSchedule(request: Request): Promise<Response> {
    const schedule = (await request.json()) as ScheduledCrawl;

    // Store schedule in Durable Object state
    await this.state.storage.put(`schedule:${schedule.websiteId}`, schedule);

    // Calculate next run time
    const nextRun = this.calculateNextRun(schedule);
    schedule.nextRunAt = nextRun.toISOString();

    // Set alarm for next run
    await this.state.storage.setAlarm(nextRun.getTime());

    return new Response(JSON.stringify({ schedule }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleStatus(): Promise<Response> {
    const schedules = await this.state.storage.list({
      prefix: 'schedule:',
    });

    const statusMap: Record<string, any> = {};
    for (const [key, value] of schedules) {
      statusMap[key] = value;
    }

    return new Response(JSON.stringify(statusMap), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleTrigger(request: Request): Promise<Response> {
    const { websiteId } = (await request.json()) as { websiteId: string };

    // Trigger crawl immediately
    await this.triggerCrawl(websiteId);

    return new Response(JSON.stringify({ triggered: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async alarm(): Promise<void> {
    // Get all schedules
    const schedules = await this.state.storage.list({
      prefix: 'schedule:',
    });

    const now = new Date();

    for (const [key, schedule] of schedules) {
      const sched = schedule as ScheduledCrawl;

      // Check if it's time to run
      if (new Date(sched.nextRunAt) <= now && sched.isActive) {
        await this.triggerCrawl(sched.websiteId);

        // Update next run time
        const nextRun = this.calculateNextRun(sched);
        sched.lastRunAt = now.toISOString();
        sched.nextRunAt = nextRun.toISOString();

        await this.state.storage.put(key, sched);
        await this.state.storage.setAlarm(nextRun.getTime());
      }
    }
  }

  private calculateNextRun(schedule: ScheduledCrawl): Date {
    const now = new Date();
    const [hours, minutes] = schedule.timeOfDay.split(':').map(Number);

    let next = new Date(now);
    next.setHours(hours, minutes, 0, 0);

    // If time has passed today, move to next period
    if (next <= now) {
      switch (schedule.scheduleType) {
        case 'daily':
          next.setDate(next.getDate() + 1);
          break;
        case 'weekly':
          next.setDate(next.getDate() + (7 - next.getDay() + (schedule.dayOfWeek || 0)));
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          break;
      }
    }

    return next;
  }

  private async triggerCrawl(websiteId: string): Promise<void> {
    // Trigger crawl API endpoint
    const crawlId = `crawl_${nanoid(16)}`;

    try {
      await fetch(`${this.env.API_URL}/api/v2/websites/${websiteId}/audits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.INTERNAL_TOKEN}`,
        },
        body: JSON.stringify({
          type: 'scheduled',
          auditId: crawlId,
        }),
      });
    } catch (error) {
      console.error(`Failed to trigger crawl for website ${websiteId}:`, error);
    }
  }
}
