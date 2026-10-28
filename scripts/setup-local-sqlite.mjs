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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const dbPath = path.join(projectRoot, '.local', 'roundseo-dev.db');

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

let applied = 0;
let errors = 0;

for (const file of migrationFiles) {
  const filePath = path.join(migrationsDir, file);

  try {
    const sql = fs.readFileSync(filePath, 'utf-8');

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      db.exec(statement);
    }

    console.log(`  ✅ ${file}`);
    applied++;
  } catch (error) {
    console.error(`  ❌ ${file}`);
    console.error(`     Error: ${error.message}`);
    errors++;
  }
}

console.log(`\n${applied}/${migrationFiles.length} migrations applied`);

if (errors > 0) {
  console.error(`⚠️  ${errors} migration(s) failed`);
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
