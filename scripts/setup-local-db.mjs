#!/usr/bin/env node

import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const dbPath = path.join(projectRoot, '.local', 'roundseo-dev.db');

// Create directory if it doesn't exist
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`✅ Created directory: ${dbDir}`);
}

// Create or open database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err);
    process.exit(1);
  }
  console.log(`✅ Database created at: ${dbPath}`);

  // Read and apply all migrations
  const migrationsDir = path.join(projectRoot, 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`\n📋 Applying ${migrationFiles.length} migrations...\n`);

  let applied = 0;

  const applyMigration = (index) => {
    if (index >= migrationFiles.length) {
      console.log(`\n✨ Successfully applied all ${applied} migrations!`);
      console.log(`   Path: ${dbPath}`);
      console.log('\n💡 Next: Set DATABASE_URL=.local/roundseo-dev.db npm run dev\n');
      db.close();
      process.exit(0);
    }

    const file = migrationFiles[index];
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    db.exec(sql, (err) => {
      if (err) {
        console.error(`❌ ${file}: ${err.message}`);
      } else {
        console.log(`✅ ${file}`);
        applied++;
      }
      applyMigration(index + 1);
    });
  };

  applyMigration(0);
});
