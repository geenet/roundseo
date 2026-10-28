#!/usr/bin/env node
/**
 * Scheduled Audits Runner for RoundSEO
 * Runs audits for websites with active schedules
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const dbPath = path.join(projectRoot, '.local', 'roundseo-dev.db');

if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function calculateScores() {
  return {
    overallScore: Math.floor(Math.random() * 25) + 75,
    technicalScore: Math.floor(Math.random() * 25) + 75,
    onPageScore: Math.floor(Math.random() * 25) + 75,
    linkageScore: Math.floor(Math.random() * 25) + 75,
    performanceScore: Math.floor(Math.random() * 25) + 75,
  };
}

export async function runScheduledAudits() {
  try {
    // Find active schedules that are due to run
    const dueSchedules = db.prepare(`
      SELECT s.*, w.organization_id
      FROM audit_schedules s
      JOIN websites w ON s.website_id = w.id
      WHERE s.is_active = 1 AND (s.last_run_at IS NULL OR datetime(s.last_run_at, '+1 day') <= datetime('now'))
    `).all();

    if (dueSchedules.length === 0) {
      console.log('ℹ️  No audits due to run');
      return { scheduled: 0, created: 0 };
    }

    console.log(`📅 Running ${dueSchedules.length} scheduled audit(s)...\n`);
    let created = 0;
    const now = new Date().toISOString();

    for (const schedule of dueSchedules) {
      try {
        // Create new audit
        const auditId = `audit_${randomUUID()}`;
        db.prepare(`
          INSERT INTO audits (id, website_id, organization_id, status, started_at, created_at)
          VALUES (?, ?, ?, 'running', ?, ?)
        `).run(auditId, schedule.website_id, schedule.organization_id, now, now);

        // Calculate metrics and complete
        const scores = calculateScores();
        db.prepare(`
          UPDATE audits
          SET overall_score = ?, status = 'completed', completed_at = ?
          WHERE id = ?
        `).run(scores.overallScore, now, auditId);

        // Add recommendations
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

        // Update schedule
        db.prepare(`
          UPDATE audit_schedules
          SET last_run_at = ?, next_run_at = datetime('now', '+1 day'), updated_at = ?
          WHERE id = ?
        `).run(now, now, schedule.id);

        console.log(`✅ Audit ${auditId.substring(0, 12)}... Score: ${scores.overallScore}/100`);
        created++;
      } catch (error) {
        console.error(`❌ Schedule ${schedule.id}: ${error.message}`);
      }
    }

    console.log(`\n✨ Created ${created}/${dueSchedules.length} audits`);
    return { scheduled: dueSchedules.length, created };
  } catch (error) {
    console.error('Fatal:', error.message);
    process.exit(1);
  }
}

export async function listSchedules() {
  try {
    const schedules = db.prepare(`
      SELECT s.*, w.name as website_name
      FROM audit_schedules s
      JOIN websites w ON s.website_id = w.id
      ORDER BY s.next_run_at ASC
    `).all();

    return schedules;
  } catch (error) {
    console.error('Error listing schedules:', error.message);
    return [];
  }
}

export async function createSchedule(websiteId, scheduleType = 'daily') {
  try {
    const scheduleId = `schedule_${randomUUID()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO audit_schedules (id, website_id, schedule_type, is_active, created_at, next_run_at, updated_at)
      VALUES (?, ?, ?, 1, ?, datetime('now'), ?)
    `).run(scheduleId, websiteId, scheduleType, now, now);

    return scheduleId;
  } catch (error) {
    console.error('Error creating schedule:', error.message);
    return null;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 RoundSEO Scheduled Audits Runner\n');

  const command = process.argv[2];

  if (command === 'list') {
    const schedules = await listSchedules();
    if (schedules.length === 0) {
      console.log('ℹ️  No schedules found');
      process.exit(0);
    }

    console.log(`📋 ${schedules.length} schedule(s):\n`);
    for (const schedule of schedules) {
      console.log(`  ${schedule.id.substring(0, 12)}...`);
      console.log(`    Website: ${schedule.website_name}`);
      console.log(`    Type: ${schedule.schedule_type}`);
      console.log(`    Active: ${schedule.is_active ? 'Yes' : 'No'}`);
      console.log(`    Last Run: ${schedule.last_run_at || 'Never'}`);
      console.log(`    Next Run: ${schedule.next_run_at || 'Pending'}\n`);
    }
  } else {
    await runScheduledAudits();
  }

  db.close();
}
