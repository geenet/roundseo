#!/usr/bin/env node
/**
 * Local API Server for RoundSEO Development
 * Direct Node.js server using local SQLite
 * Serves the API on http://localhost:8787
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const dbPath = path.join(projectRoot, '.local', 'roundseo-dev.db');

// Configuration
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-key-12345');
const PORT = 8787;

// Initialize database
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found. Run: npm run dev:setup-db');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
console.log(`✅ Connected to database: ${dbPath}\n`);

// Helper functions
async function createJWT(payload, expiresIn = '7d') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

async function verifyJWT(token) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  return createHash('sha256').update(password + 'salt').digest('hex');
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

// Parse request body
async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Send JSON response
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// Authentication middleware
async function getAuth(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  return await verifyJWT(token);
}

// Routes
async function handleRequest(req, res) {
  const { method, url } = req;
  const pathname = new URL(url, `http://${req.headers.host}`).pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ============ AUTH ROUTES ============
  if (pathname === '/health' && method === 'GET') {
    sendJSON(res, { status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  if (pathname === '/api/v2/auth/signup' && method === 'POST') {
    const body = await parseBody(req);
    const { email, name, password } = body;

    if (!email || !name || !password) {
      sendJSON(res, { error: 'Missing email, name, or password' }, 400);
      return;
    }

    if (name.length < 2) {
      sendJSON(res, { error: 'Name must be at least 2 characters' }, 400);
      return;
    }

    try {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        sendJSON(res, { error: 'User already exists' }, 409);
        return;
      }

      const userId = `user_${randomUUID()}`;
      const now = new Date().toISOString();
      const passwordHash = hashPassword(password);

      db.prepare(`
        INSERT INTO users (id, email, name, auth_method, password_hash, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, email, name, 'email_password', passwordHash, 0, now, now);

      const token = await createJWT({ userId, email }, '7d');
      sendJSON(res, { user: { id: userId, email, name }, token }, 201);
    } catch (error) {
      console.error('Signup error:', error.message);
      sendJSON(res, { error: 'Failed to create user' }, 500);
    }
    return;
  }

  if (pathname === '/api/v2/auth/login' && method === 'POST') {
    const body = await parseBody(req);
    const { email, password } = body;

    try {
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !verifyPassword(password, user.password_hash)) {
        sendJSON(res, { error: 'Invalid credentials' }, 401);
        return;
      }

      const token = await createJWT({ userId: user.id, email: user.email }, '7d');
      sendJSON(res, { user: { id: user.id, email: user.email, name: user.name }, token });
    } catch (error) {
      console.error('Login error:', error.message);
      sendJSON(res, { error: 'Login failed' }, 500);
    }
    return;
  }

  if (pathname === '/api/v2/auth/me' && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    try {
      const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(auth.userId);
      if (!user) {
        sendJSON(res, { error: 'User not found' }, 404);
        return;
      }
      sendJSON(res, { user });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch user' }, 500);
    }
    return;
  }

  // ============ ORGANIZATION ROUTES ============
  if (pathname === '/api/v2/organizations' && method === 'POST') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const body = await parseBody(req);
    const { name, billingEmail } = body;

    try {
      const orgId = `org_${randomUUID()}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO organizations (id, owner_id, name, billing_email, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(orgId, auth.userId, name, billingEmail, now, now);

      sendJSON(res, { organization: { id: orgId, name, billingEmail } }, 201);
    } catch (error) {
      console.error('Create org error:', error.message);
      sendJSON(res, { error: 'Failed to create organization' }, 500);
    }
    return;
  }

  if (pathname === '/api/v2/organizations' && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    try {
      const orgs = db.prepare(`
        SELECT id, name, billing_email FROM organizations
        WHERE owner_id = ?
        ORDER BY created_at DESC
      `).all(auth.userId);

      sendJSON(res, { organizations: orgs });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch organizations' }, 500);
    }
    return;
  }

  // ============ WEBSITE ROUTES ============
  const websitesMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/websites$/);
  if (websitesMatch && method === 'POST') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const orgId = websitesMatch[1];
    const body = await parseBody(req);
    const { name, url } = body;

    try {
      const websiteId = `site_${randomUUID()}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO websites (id, organization_id, name, domain, url, crawl_schedule, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(websiteId, orgId, name, url, url, 'weekly', now, now);

      sendJSON(res, { website: { id: websiteId, name, url } }, 201);
    } catch (error) {
      console.error('Create website error:', error.message);
      sendJSON(res, { error: 'Failed to create website' }, 500);
    }
    return;
  }

  if (websitesMatch && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const orgId = websitesMatch[1];

    try {
      const websites = db.prepare(`
        SELECT id, name, url FROM websites
        WHERE organization_id = ?
        ORDER BY created_at DESC
      `).all(orgId);

      sendJSON(res, { websites });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch websites' }, 500);
    }
    return;
  }

  // ============ WEBSITE DETAIL ROUTE ============
  const websiteDetailMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/websites\/([^/]+)$/);
  if (websiteDetailMatch && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const [, orgId, websiteId] = websiteDetailMatch;

    try {
      const website = db.prepare(`
        SELECT id, name, url, crawl_schedule FROM websites
        WHERE id = ? AND organization_id = ?
      `).get(websiteId, orgId);

      if (!website) {
        sendJSON(res, { error: 'Website not found' }, 404);
        return;
      }

      sendJSON(res, { website });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch website' }, 500);
    }
    return;
  }

  // ============ AUDIT ROUTES ============
  const auditMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/websites\/([^/]+)\/audits(?:\/([^/]+))?$/);
  if (auditMatch && method === 'POST') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const [, orgId, websiteId] = auditMatch;

    try {
      const auditId = `audit_${randomUUID()}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO audits (id, website_id, organization_id, status, started_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(auditId, websiteId, orgId, 'pending', now, now);

      sendJSON(res, { audit: { id: auditId, status: 'pending', createdAt: now } }, 201);
    } catch (error) {
      console.error('Create audit error:', error.message);
      sendJSON(res, { error: 'Failed to create audit' }, 500);
    }
    return;
  }

  if (auditMatch && method === 'GET' && auditMatch[3]) {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const auditId = auditMatch[3];

    try {
      const audit = db.prepare(`
        SELECT id, status, overall_score FROM audits
        WHERE id = ?
      `).get(auditId);

      if (!audit) {
        sendJSON(res, { error: 'Audit not found' }, 404);
        return;
      }

      sendJSON(res, { audit });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch audit' }, 500);
    }
    return;
  }

  // Alternative audit status route: /api/v2/organizations/:orgId/audits/:auditId
  const auditByOrgMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/audits\/([^/]+)$/);
  if (auditByOrgMatch && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const [, orgId, auditId] = auditByOrgMatch;

    try {
      const audit = db.prepare(`
        SELECT id, status, overall_score FROM audits
        WHERE id = ? AND organization_id = ?
      `).get(auditId, orgId);

      if (!audit) {
        sendJSON(res, { error: 'Audit not found' }, 404);
        return;
      }

      sendJSON(res, { audit });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch audit' }, 500);
    }
    return;
  }

  // List audits for website
  if (auditMatch && method === 'GET' && !auditMatch[3]) {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const [, orgId, websiteId] = auditMatch;

    try {
      const audits = db.prepare(`
        SELECT id, status, overall_score, created_at FROM audits
        WHERE website_id = ? AND organization_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all(websiteId, orgId);

      sendJSON(res, { audits });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch audits' }, 500);
    }
    return;
  }

  // ============ TEAM ROUTES ============
  const teamMembersMatch = pathname.match(/^\/api\/v2\/organizations\/([^/]+)\/members/);
  if (teamMembersMatch && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const [, orgId] = teamMembersMatch;

    try {
      const members = db.prepare(`
        SELECT tm.id, tm.user_id, u.email, u.name, tm.role, tm.created_at
        FROM team_members tm
        JOIN users u ON tm.user_id = u.id
        WHERE tm.organization_id = ?
        ORDER BY tm.created_at DESC
      `).all(orgId);

      sendJSON(res, { members });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch team members' }, 500);
    }
    return;
  }

  if (teamMembersMatch && method === 'POST') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const body = await parseBody(req);
    const { email, role = 'member' } = body;
    const [, orgId] = teamMembersMatch;

    if (!email || !['owner', 'editor', 'member', 'viewer'].includes(role)) {
      sendJSON(res, { error: 'Invalid email or role' }, 400);
      return;
    }

    try {
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (!user) {
        sendJSON(res, { error: 'User not found' }, 404);
        return;
      }

      const memberId = `tm_${randomUUID()}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO team_members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(memberId, orgId, user.id, role, now);

      sendJSON(res, { member: { id: memberId, email, role } }, 201);
    } catch (error) {
      console.error('Add team member error:', error.message);
      sendJSON(res, { error: 'Failed to add team member' }, 500);
    }
    return;
  }

  // ============ WEBSITE FILTERING & SEARCH ============
  if (pathname === '/api/v2/websites/search' && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const url = new URL(`http://localhost${pathname}?${new URL(`http://localhost${pathname}${req.url.split('?')[1] || ''}`).searchParams}`);
    const query = url.searchParams.get('q') || '';
    const sortBy = url.searchParams.get('sort') || 'created_at';
    const order = url.searchParams.get('order') || 'DESC';
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 100);

    try {
      const websites = db.prepare(`
        SELECT w.id, w.name, w.domain, w.url, w.organization_id,
               (SELECT COUNT(*) FROM audits WHERE website_id = w.id) as audit_count,
               (SELECT overall_score FROM audits WHERE website_id = w.id ORDER BY created_at DESC LIMIT 1) as latest_score,
               w.created_at
        FROM websites w
        JOIN organizations o ON w.organization_id = o.id
        WHERE o.owner_id = ? AND (w.name LIKE ? OR w.domain LIKE ? OR w.url LIKE ?)
        ORDER BY ${['name', 'domain', 'audit_count', 'latest_score', 'created_at'].includes(sortBy) ? sortBy : 'created_at'} ${['ASC', 'DESC'].includes(order) ? order : 'DESC'}
        LIMIT ?
      `).all(auth.userId, `%${query}%`, `%${query}%`, `%${query}%`, limit);

      sendJSON(res, { websites, total: websites.length });
    } catch (error) {
      sendJSON(res, { error: 'Search failed' }, 500);
    }
    return;
  }

  // ============ SCHEDULE ROUTES ============
  if (pathname === '/api/v2/audits/schedules' && method === 'POST') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const body = await parseBody(req);
    const { websiteId, scheduleType = 'daily' } = body;

    if (!websiteId) {
      sendJSON(res, { error: 'Missing websiteId' }, 400);
      return;
    }

    try {
      const scheduleId = `schedule_${randomUUID()}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO audit_schedules (id, website_id, schedule_type, is_active, created_at, next_run_at, updated_at)
        VALUES (?, ?, ?, 1, ?, datetime('now'), ?)
      `).run(scheduleId, websiteId, scheduleType, now, now);

      sendJSON(res, { schedule: { id: scheduleId, websiteId, scheduleType, active: true } }, 201);
    } catch (error) {
      console.error('Create schedule error:', error.message);
      sendJSON(res, { error: 'Failed to create schedule' }, 500);
    }
    return;
  }

  if (pathname === '/api/v2/audits/schedules' && method === 'GET') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    try {
      const schedules = db.prepare(`
        SELECT s.id, s.website_id, s.schedule_type, s.is_active, s.last_run_at, s.next_run_at
        FROM audit_schedules s
        JOIN websites w ON s.website_id = w.id
        WHERE w.organization_id IN (SELECT id FROM organizations WHERE owner_id = ?)
        ORDER BY s.next_run_at ASC
      `).all(auth.userId);

      sendJSON(res, { schedules });
    } catch (error) {
      sendJSON(res, { error: 'Failed to fetch schedules' }, 500);
    }
    return;
  }

  // Metrics calculation endpoint
  if (pathname === '/api/v2/audits/calculate-metrics' && method === 'POST') {
    const auth = await getAuth(req);
    if (!auth) {
      sendJSON(res, { error: 'No authorization token provided' }, 401);
      return;
    }

    const body = await parseBody(req);
    const { auditId } = body;

    if (!auditId) {
      sendJSON(res, { error: 'Missing auditId' }, 400);
      return;
    }

    try {
      const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(auditId);
      if (!audit) {
        sendJSON(res, { error: 'Audit not found' }, 404);
        return;
      }

      // Calculate scores (75-100 range)
      const overallScore = Math.floor(Math.random() * 25) + 75;
      const technicalScore = Math.floor(Math.random() * 25) + 75;
      const onPageScore = Math.floor(Math.random() * 25) + 75;
      const linkageScore = Math.floor(Math.random() * 25) + 75;
      const performanceScore = Math.floor(Math.random() * 25) + 75;

      // Update audit with scores
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE audits
        SET overall_score = ?, status = 'completed', completed_at = ?
        WHERE id = ?
      `).run(overallScore, now, auditId);

      // Add sample recommendations
      const website = db.prepare('SELECT website_id FROM audits WHERE id = ?').get(auditId);
      const recommendations = [
        { title: 'Fix broken links', category: 'technical', impact: '+5 points', effort: 'medium' },
        { title: 'Add missing meta descriptions', category: 'onpage', impact: '+3 points', effort: 'quick_win' },
        { title: 'Improve page load time', category: 'performance', impact: '+8 points', effort: 'complex' },
      ];

      for (const rec of recommendations) {
        db.prepare(`
          INSERT INTO recommendations
          (id, audit_id, website_id, category, priority, title, description, estimated_impact, estimated_effort, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `rec_${Math.random().toString(36).substr(2, 9)}`,
          auditId,
          website.website_id,
          rec.category,
          'medium',
          rec.title,
          `Found issues that can be fixed to improve your SEO`,
          rec.impact,
          rec.effort,
          now
        );
      }

      sendJSON(res, {
        audit: {
          id: auditId,
          status: 'completed',
          overallScore,
          scores: {
            technical: technicalScore,
            onPage: onPageScore,
            linkage: linkageScore,
            performance: performanceScore,
          },
          recommendationsCount: recommendations.length,
        },
      }, 200);
    } catch (error) {
      console.error('Metrics calculation error:', error.message);
      sendJSON(res, { error: 'Failed to calculate metrics' }, 500);
    }
    return;
  }

  // Database test endpoint
  if (pathname === '/api/db-test' && method === 'GET') {
    try {
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
      const websiteCount = db.prepare('SELECT COUNT(*) as count FROM websites').get();
      const auditCount = db.prepare('SELECT COUNT(*) as count FROM audits').get();

      sendJSON(res, {
        status: 'ok',
        database: 'local-sqlite',
        tables: ['users', 'organizations', 'websites', 'audits', '...28 total'],
        counts: {
          users: userCount.count,
          websites: websiteCount.count,
          audits: auditCount.count,
        },
      });
    } catch (error) {
      sendJSON(res, { error: 'Database test failed' }, 500);
    }
    return;
  }

  // Catch-all
  sendJSON(res, { error: 'Not Found', message: `No handler for ${method} ${pathname}` }, 404);
}

// Start server
const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`✅ Local API Server running on http://localhost:${PORT}`);
  console.log(`\n📡 Available endpoints:`);
  console.log(`   AUTH & ORGS`);
  console.log(`   POST   /api/v2/auth/signup`);
  console.log(`   POST   /api/v2/auth/login`);
  console.log(`   GET    /api/v2/auth/me`);
  console.log(`   POST   /api/v2/organizations`);
  console.log(`   GET    /api/v2/organizations`);
  console.log(`   \n   TEAM & WEBSITES`);
  console.log(`   GET    /api/v2/organizations/:id/members`);
  console.log(`   POST   /api/v2/organizations/:id/members`);
  console.log(`   POST   /api/v2/organizations/:id/websites`);
  console.log(`   GET    /api/v2/organizations/:id/websites`);
  console.log(`   GET    /api/v2/websites/search`);
  console.log(`   \n   AUDITS & METRICS`);
  console.log(`   POST   /api/v2/organizations/:id/websites/:siteId/audits`);
  console.log(`   GET    /api/v2/organizations/:id/audits/:auditId`);
  console.log(`   POST   /api/v2/audits/calculate-metrics`);
  console.log(`   POST   /api/v2/audits/schedules`);
  console.log(`   GET    /api/v2/audits/schedules`);
  console.log(`   GET    /health\n`);
  console.log(`🔗 React UI: http://localhost:5175\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  db.close();
  server.close();
  process.exit(0);
});
