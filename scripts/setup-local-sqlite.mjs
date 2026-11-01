#!/usr/bin/env node
/**
 * Setup local SQLite database for development
 * This creates a local SQLite database and applies all migrations
 * Usage: node scripts/setup-local-sqlite.mjs
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const pathArgument = process.argv.indexOf('--path');
if (pathArgument >= 0 && !process.argv[pathArgument + 1]) throw new Error('--path requires a database file path');
const dbPath = pathArgument >= 0 ? path.resolve(process.argv[pathArgument + 1]) : path.join(projectRoot, '.local', 'roundseo-dev.db');

console.log('🗄️  RoundSEO Local SQLite Setup\n');

// Create directory if it doesn't exist
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`✅ Created directory: ${dbDir}`);
}

// Remove existing database if --fresh flag is passed
if (process.argv.includes('--fresh') && fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('🔄 Removed existing database (--fresh flag)');
}

// Create or open database
let db;
try {
  db = new Database(dbPath);
  console.log(`✅ Database: ${dbPath}\n`);
} catch (error) {
  console.error('❌ Failed to create/open database:', error.message);
  process.exit(1);
}

// Read and apply all migrations
const migrationsDir = path.join(projectRoot, 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.error('❌ No migration files found in', migrationsDir);
  db.close();
  process.exit(1);
}

console.log(`📋 Found ${migrationFiles.length} migrations\n`);
console.log('Running migrations...\n');
db.exec('CREATE TABLE IF NOT EXISTS _roundseo_local_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');

let applied = 0;
let skipped = 0;
let errors = 0;

for (const file of migrationFiles) {
  const filePath = path.join(migrationsDir, file);

  try {
    const sql = fs.readFileSync(filePath, 'utf-8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = db.prepare('SELECT checksum FROM _roundseo_local_migrations WHERE name = ?').get(file);
    if (previous) {
      if (previous.checksum !== checksum) throw new Error('An applied migration changed. Add a new migration instead of editing the applied file.');
      console.log(`  ✓ ${file} already applied`);
      skipped++;
      continue;
    }

    // SQLite handles comments and semicolons inside SQL literals correctly.
    // Existing local databases can predate the migration ledger.
    const adoptableSql = sql.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/gi, (_match, unique) => `CREATE ${unique || ''}INDEX IF NOT EXISTS `);
    db.transaction(() => {
      db.exec(adoptableSql);
      db.prepare('INSERT INTO _roundseo_local_migrations (name, checksum, applied_at) VALUES (?, ?, ?)').run(file, checksum, new Date().toISOString());
    })();

    console.log(`  ✅ ${file}`);
    applied++;
  } catch (error) {
    console.error(`  ❌ ${file}`);
    console.error(`     Error: ${error.message}`);
    errors++;
    break;
  }
}

console.log(`\n${applied} migrations applied · ${skipped} already applied · ${migrationFiles.length} total`);

if (errors > 0) {
  console.error(`⚠️  ${errors} migration(s) failed`);
  db.close();
  process.exit(1);
}

// Verify schema
console.log('\n📊 Database schema:\n');
try {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    ORDER BY name
  `).all();

  if (tables.length === 0) {
    console.warn('  ⚠️  No tables found. Migrations may have failed.');
  } else {
    tables.forEach(t => {
      const columns = db.prepare(`PRAGMA table_info(${t.name})`).all();
      console.log(`  📋 ${t.name} (${columns.length} columns)`);
    });
  }
} catch (error) {
  console.error('  ❌ Error reading schema:', error.message);
}

// Show connection info
console.log(`\n🚀 Ready for local development!\n`);
console.log(`Database location: ${dbPath}`);
console.log(`\n📝 Next steps:`);
console.log(`  1. Set environment variable: export DATABASE_URL="${dbPath}"`);
console.log(`  2. Start the dev server: npm run dev`);
console.log(`  3. In another terminal: npm run dev:ui`);
console.log(`\n💡 To reset database: node scripts/setup-local-sqlite.mjs --fresh\n`);

db.close();
