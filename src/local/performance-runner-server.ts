import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { measureLocalBrowserPerformance } from './browser-performance';
import { captureRequestProblem, parseRenderRequest, parseScreenshotRequest, renderPage, screenshotPage } from './browser-capture';
import { isPublicCrawlUrl } from '../worker/crawlers/base';

const token = process.env.ROUNDSEO_RUNNER_TOKEN || '';
const host = process.env.ROUNDSEO_RUNNER_HOST || '127.0.0.1';
const port = Number(process.env.ROUNDSEO_RUNNER_PORT || 8788);
if (token.length < 24) throw new Error('Set ROUNDSEO_RUNNER_TOKEN to a secret of at least 24 characters before starting the performance runner.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ROUNDSEO_RUNNER_PORT must be a valid TCP port.');
let running = false;

const server = createServer(async (request, response) => {
  const send = (status: number, data: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  };
  const routes = ['/audit', '/render', '/screenshot'];
  if (request.method !== 'POST' || !request.url || !routes.includes(request.url)) { send(404, { error: 'Not found.' }); return; }
  const supplied = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expectedBytes = Buffer.from(token);
  const suppliedBytes = Buffer.from(supplied);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) { send(401, { error: 'Unauthorized.' }); return; }
  if (running) { send(429, { error: 'The browser runner is busy. Try again shortly.' }); return; }
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > 10_000) { send(413, { error: 'Request too large.' }); return; }
      chunks.push(bytes);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    if (request.url === '/audit') {
      if (typeof input.url !== 'string' || !isPublicCrawlUrl(input.url)) { send(400, { error: 'Provide a public HTTP or HTTPS URL.' }); return; }
      running = true;
      try { send(200, await measureLocalBrowserPerformance(input.url)); }
      finally { running = false; }
      return;
    }
    const problem = captureRequestProblem(input);
    if (problem) { send(400, { error: problem }); return; }
    running = true;
    try {
      if (request.url === '/render') send(200, await renderPage(parseRenderRequest(input)));
      else send(200, await screenshotPage(parseScreenshotRequest(input)));
    } finally {
      running = false;
    }
  } catch (error) {
    send(500, { error: error instanceof Error ? error.message : 'Browser measurement failed.' });
  }
});

server.listen(port, host, () => console.log(`RoundSEO performance runner listening on ${host}:${port}`));
