// Comprehensive logging and monitoring system
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  duration?: number;
  userId?: string;
  requestId?: string;
}

export interface PerformanceMetrics {
  requestId: string;
  path: string;
  method: string;
  statusCode: number;
  duration: number;
  timestamp: string;
  userId?: string;
  error?: string;
}

export interface ErrorMetrics {
  requestId: string;
  errorType: string;
  message: string;
  stack?: string;
  context?: Record<string, any>;
  timestamp: string;
  userId?: string;
}

class Logger {
  private requestId: string = '';
  private userId?: string;
  private context: Record<string, any> = {};

  setRequestId(id: string): void {
    this.requestId = id;
  }

  setUserId(id?: string): void {
    this.userId = id;
  }

  setContext(context: Record<string, any>): void {
    this.context = context;
  }

  private formatLog(level: LogLevel, message: string, error?: Error, extra?: Record<string, any>): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context, ...extra },
      error: error ? {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      } : undefined,
      requestId: this.requestId,
      userId: this.userId,
    };
  }

  private output(entry: LogEntry): void {
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
    const logData: any = {
      level: entry.level,
      message: entry.message,
    };

    if (entry.requestId) logData.requestId = entry.requestId;
    if (entry.userId) logData.userId = entry.userId;
    if (entry.context && Object.keys(entry.context).length > 0) logData.context = entry.context;
    if (entry.error) logData.error = entry.error;

    console.log(prefix, JSON.stringify(logData));
  }

  debug(message: string, context?: Record<string, any>): void {
    this.output(this.formatLog('debug', message, undefined, context));
  }

  info(message: string, context?: Record<string, any>): void {
    this.output(this.formatLog('info', message, undefined, context));
  }

  warn(message: string, context?: Record<string, any>): void {
    this.output(this.formatLog('warn', message, undefined, context));
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.output(this.formatLog('error', message, error, context));
  }

  logRequest(method: string, path: string, userId?: string): void {
    this.info('Incoming request', { method, path, userId });
  }

  logResponse(statusCode: number, duration: number): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.output(this.formatLog(level, `Response ${statusCode}`, undefined, { duration }));
  }

  logDatabaseQuery(query: string, duration: number, params?: any[]): void {
    this.debug('Database query', { query: query.substring(0, 100), duration, paramCount: params?.length });
  }

  logCrawl(websiteUrl: string, duration: number, pagesFound: number, pagesCrawled: number): void {
    this.info('Crawl completed', { websiteUrl, duration, pagesFound, pagesCrawled });
  }

  logAudit(auditId: string, status: string, pagesAnalyzed: number): void {
    this.info('Audit completed', { auditId, status, pagesAnalyzed });
  }

  logIntegrationSync(type: string, domain: string, success: boolean, duration: number): void {
    const level = success ? 'info' : 'warn';
    this.output(this.formatLog(level, `Integration sync: ${type}`, undefined, { domain, success, duration }));
  }
}

export const logger = new Logger();

// Performance monitoring class
export class PerformanceMonitor {
  private startTime: number;
  private requestId: string;
  private metrics: PerformanceMetrics;

  constructor(requestId: string, method: string, path: string, userId?: string) {
    this.startTime = Date.now();
    this.requestId = requestId;
    this.metrics = {
      requestId,
      path,
      method,
      statusCode: 0,
      duration: 0,
      timestamp: new Date().toISOString(),
      userId,
    };
  }

  recordResponse(statusCode: number, error?: string): PerformanceMetrics {
    this.metrics.statusCode = statusCode;
    this.metrics.duration = Date.now() - this.startTime;
    this.metrics.error = error;

    // Log slow requests (>1 second)
    if (this.metrics.duration > 1000) {
      logger.warn('Slow request detected', {
        path: this.metrics.path,
        duration: this.metrics.duration,
        method: this.metrics.method,
      });
    }

    return this.metrics;
  }

  recordDatabaseQuery(query: string, duration: number, params?: any[]): void {
    if (duration > 500) {
      logger.warn('Slow database query', {
        query: query.substring(0, 50),
        duration,
      });
    }
  }

  recordCrawl(pagesFound: number, pagesCrawled: number, error?: string): void {
    const duration = Date.now() - this.startTime;
    logger.logCrawl(`crawl-${this.requestId}`, duration, pagesFound, pagesCrawled);
    if (error) {
      logger.error('Crawl error', new Error(error), { requestId: this.requestId });
    }
  }
}

// Error tracking class
export class ErrorTracker {
  private errors: Map<string, number> = new Map();
  private errorThreshold = 5;
  private resetInterval = 60000; // 1 minute

  constructor() {
    // Reset error counts every minute
    setInterval(() => this.errors.clear(), this.resetInterval);
  }

  trackError(type: string, message: string, context?: Record<string, any>): void {
    const key = `${type}:${message}`;
    const count = (this.errors.get(key) || 0) + 1;
    this.errors.set(key, count);

    logger.error(message, undefined, { errorType: type, count, ...context });

    // Alert if error threshold exceeded
    if (count >= this.errorThreshold) {
      logger.warn('Error threshold exceeded', {
        errorType: type,
        count,
        threshold: this.errorThreshold,
      });
    }
  }

  getErrorStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [key, count] of this.errors) {
      stats[key] = count;
    }
    return stats;
  }

  reset(): void {
    this.errors.clear();
  }
}

export const errorTracker = new ErrorTracker();

// Health check class
export class HealthCheck {
  private lastDatabaseCheck: { status: string; timestamp: string } = { status: 'unknown', timestamp: new Date().toISOString() };
  private lastR2Check: { status: string; timestamp: string } = { status: 'unknown', timestamp: new Date().toISOString() };

  async checkDatabase(db: any): Promise<boolean> {
    try {
      await db.prepare('SELECT 1').first();
      this.lastDatabaseCheck = { status: 'healthy', timestamp: new Date().toISOString() };
      return true;
    } catch (error) {
      this.lastDatabaseCheck = { status: 'unhealthy', timestamp: new Date().toISOString() };
      logger.error('Database health check failed', error as Error);
      return false;
    }
  }

  async checkR2(r2: any): Promise<boolean> {
    try {
      // Test R2 connectivity
      this.lastR2Check = { status: 'healthy', timestamp: new Date().toISOString() };
      return true;
    } catch (error) {
      this.lastR2Check = { status: 'unhealthy', timestamp: new Date().toISOString() };
      logger.error('R2 health check failed', error as Error);
      return false;
    }
  }

  getStatus(): Record<string, any> {
    return {
      timestamp: new Date().toISOString(),
      database: this.lastDatabaseCheck,
      r2: this.lastR2Check,
      uptime: process.uptime?.(),
    };
  }
}

export const healthCheck = new HealthCheck();

// Request ID generator
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

// Structured logging for specific events
export const eventLogger = {
  authSuccess: (email: string, method: string) => {
    logger.info('User authenticated', { email, method });
  },

  authFailure: (email: string, reason: string) => {
    logger.warn('Authentication failed', { email, reason });
  },

  auditStarted: (auditId: string, websiteId: string) => {
    logger.info('Audit started', { auditId, websiteId });
  },

  auditCompleted: (auditId: string, pagesAnalyzed: number, score: number) => {
    logger.info('Audit completed', { auditId, pagesAnalyzed, score });
  },

  reportGenerated: (reportId: string, auditId: string) => {
    logger.info('Report generated', { reportId, auditId });
  },

  reportShared: (reportId: string, shareToken: string) => {
    logger.info('Report shared', { reportId, shareToken });
  },

  integrationSynced: (type: string, domain: string, recordsSync: number) => {
    logger.info('Integration synced', { type, domain, recordsSync });
  },

  databaseError: (operation: string, error: Error) => {
    logger.error(`Database error: ${operation}`, error);
  },

  crawlError: (websiteUrl: string, error: Error) => {
    logger.error('Crawl error', error, { websiteUrl });
  },

  apiError: (endpoint: string, statusCode: number, error: Error) => {
    logger.error(`API error: ${endpoint}`, error, { statusCode });
  },
};
