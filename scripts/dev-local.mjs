#!/usr/bin/env node
/**
 * Local development server for RoundSEO
 * This starts the Worker code as a Node.js HTTP server with local SQLite
 *
 * Usage: npm run dev:local
 * Or: node scripts/dev-local.mjs
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const dbPath = path.join(projectRoot, '.local', 'roundseo-dev.db');

// Verify database exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found. Run: node scripts/setup-local-sqlite.mjs');
  process.exit(1);
}

console.log('🚀 RoundSEO Local Dev Server\n');
console.log(`📊 Database: ${dbPath}`);
console.log(`🔗 API: http://localhost:8787`);
console.log(`🎨 React UI: http://localhost:5173\n`);

// Create database instance
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

console.log('✅ Connected to local SQLite database\n');

// Simple HTTP server for testing
const server = createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Database test endpoint
  if (req.url === '/api/db-test') {
    try {
      const users = db.prepare('SELECT COUNT(*) as count FROM users').get();
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        database: 'local-sqlite',
        tables: ['users', 'websites', 'audits', '...'],
        users_count: users.count,
      }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // Default: return a helpful message
  res.writeHead(200);
  res.end(JSON.stringify({
    message: 'RoundSEO API Server (Local Development)',
    database: 'SQLite',
    endpoints: [
      '  GET  /health - Health check',
      '  GET  /api/db-test - Database test',
      '  NOTE: Full API not yet implemented in this dev server',
    ],
    help: 'For full API, run: npm run dev (requires Cloudflare D1)',
  }));
});

const PORT = 8787;
server.listen(PORT, () => {
  console.log(`📡 Server listening on port ${PORT}\n`);
  console.log('Test endpoints:');
  console.log(`  curl http://localhost:${PORT}/health`);
  console.log(`  curl http://localhost:${PORT}/api/db-test\n`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  db.close();
  server.close();
  process.exit(0);
});
