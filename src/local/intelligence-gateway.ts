import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLocalD1, type LocalD1Database } from '../worker/adapters/local-d1';
import { routeRequest } from '../worker/api/router';
import type { IntelligenceEnvironment } from '../worker/intelligence/config';

/**
 * Development gateway for the Intelligence workspace. It forwards requests to
 * the same router the Worker serves, backed by the local SQLite database, so
 * local and deployed behavior cannot drift apart.
 */
export interface LocalIntelligenceGatewayOptions {
  databasePath: string;
  environment: IntelligenceEnvironment;
}

export interface LocalIntelligenceGateway {
  handle(request: IncomingMessage, response: ServerResponse, next: () => void): void;
}

const LOCAL_PREFIX = '/__roundseo/intelligence';
const FORWARDED_HEADERS = ['authorization', 'content-type', 'idempotency-key'];

export function createLocalIntelligenceGateway(options: LocalIntelligenceGatewayOptions): LocalIntelligenceGateway {
  let database: LocalD1Database | null = null;
  // Only a database with the Intelligence tables is used. An older local database is
  // reported rather than migrated, so its existing data is never changed silently.
  const open = (): { db: LocalD1Database } | { problem: string; code: string } => {
    if (database) return { db: database };
    if (!existsSync(options.databasePath)) {
      return { problem: 'The local database is not set up. Run npm run dev:setup-db first.', code: 'LOCAL_DATABASE_MISSING' };
    }
    const candidate = createLocalD1(options.databasePath);
    const ready = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'intelligence_runs'").first();
    if (!ready) {
      candidate.close();
      return { problem: 'The local database has no RoundSEO Intelligence tables yet. Run npm run dev:setup-db to apply the migrations.', code: 'LOCAL_DATABASE_NOT_READY' };
    }
    database = candidate;
    return { db: candidate };
  };

  return {
    handle(request, response, next) {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        sendJson(response, 403, { error: 'The local RoundSEO Intelligence gateway is available only from this machine.' });
        return;
      }
      // Connect strips the mount prefix from request.url and keeps the full path in originalUrl.
      const fullUrl = (request as IncomingMessage & { originalUrl?: string }).originalUrl || request.url || '/';
      const apiPath = toApiPath(fullUrl);
      if (!apiPath) {
        next();
        return;
      }
      if (isMutation(request.method) && !isSameOriginJson(request)) {
        sendJson(response, 403, { error: 'Intelligence changes must be same-origin JSON requests from the RoundSEO development UI.' });
        return;
      }
      const opened = open();
      if ('problem' in opened) {
        sendJson(response, 503, { error: opened.problem, code: opened.code });
        return;
      }
      void forward(request, response, apiPath, { ...options.environment, DB: opened.db });
    },
  };
}

/** Map `/__roundseo/intelligence/...` to the Worker path it mirrors. */
export function toApiPath(url: string): string | null {
  const parsed = new URL(url, 'http://localhost');
  if (!parsed.pathname.startsWith(LOCAL_PREFIX)) return null;
  const rest = parsed.pathname.slice(LOCAL_PREFIX.length) || '/';
  if (rest === '/status') return `/api/v2/intelligence/status${parsed.search}`;
  const scoped = /^\/websites\/([^/]+)\/(runs|evidence|assets\/[^/]+)(.*)$/.exec(rest);
  if (!scoped) return null;
  return `/api/v2/websites/${scoped[1]}/intelligence/${scoped[2]}${scoped[3]}${parsed.search}`;
}

async function forward(
  request: IncomingMessage,
  response: ServerResponse,
  apiPath: string,
  env: IntelligenceEnvironment & { DB: LocalD1Database },
): Promise<void> {
  const host = request.headers.host || 'localhost';
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  const body = isMutation(request.method) ? await readBody(request) : undefined;
  const webRequest = new Request(`http://${host}${apiPath}`, { method: request.method, headers, body: body && body.length ? new Uint8Array(body) : undefined });
  const ctx = { waitUntil(promise: Promise<unknown>) { void promise.catch(error => console.error('Local intelligence job failed:', error)); } };
  try {
    const result = await routeRequest(webRequest, env.DB, env, ctx) ?? new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    const contentType = result.headers.get('content-type') || 'application/json';
    if (contentType.startsWith('image/')) {
      const bytes = Buffer.from(await result.arrayBuffer());
      response.writeHead(result.status, { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=300' });
      response.end(bytes);
      return;
    }
    const text = (await result.text()).replace(screenshotLinkPattern(host), '/__roundseo/intelligence/websites/$1/assets/$2?');
    response.writeHead(result.status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(text);
  } catch (error) {
    console.error('Local intelligence request failed:', error);
    sendJson(response, 500, { error: 'RoundSEO could not complete this intelligence request.', code: 'INTELLIGENCE_ERROR' });
  }
}

function screenshotLinkPattern(host: string): RegExp {
  return new RegExp(`http://${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/v2/websites/([^/"?]+)/intelligence/assets/([^"?]+)\\?`, 'g');
}

function isMutation(method: string | undefined): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function isSameOriginJson(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin') return false;
  const origin = request.headers.origin;
  if (typeof origin === 'string' && (!request.headers.host || new URL(origin).host !== request.headers.host)) return false;
  return true;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function isLoopbackAddress(value: string | undefined): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
