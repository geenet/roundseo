import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** SQLite database with every migration applied, in order, as the deployed schema would be. */
export function migratedDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  const directory = path.join(process.cwd(), 'migrations');
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(path.join(directory, file), 'utf8'));
  }
  return database;
}

/** D1-shaped adapter over better-sqlite3, matching the calls the Worker services make. */
export function d1(database: Database.Database) {
  return {
    prepare(sql: string) {
      const statement = database.prepare(sql);
      const run = (values: unknown[]) => {
        const result = statement.run(...values);
        return { success: true, meta: { changes: result.changes } };
      };
      return {
        bind(...values: unknown[]) {
          return {
            first: async () => statement.get(...values),
            all: async () => ({ results: statement.all(...values) }),
            run: async () => run(values),
          };
        },
        first: async () => statement.get(),
        all: async () => ({ results: statement.all() }),
        run: async () => run([]),
      };
    },
    /** Runs bound statements in order. D1 runs a batch as one transaction; this adapter runs them sequentially. */
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

export const ISO_NOW = '2026-11-01T12:00:00.000Z';

/** Two organizations' worth of tenancy: an owner, a read-only client, and an outsider. */
export function seedWorkspace(database: Database.Database) {
  const insert = (sql: string, ...values: unknown[]) => database.prepare(sql).run(...values);
  insert(`INSERT INTO users (id, email, name, auth_method, created_at, updated_at) VALUES (?, ?, ?, 'email_password', ?, ?)`, 'user-owner', 'owner@example.test', 'Owner', ISO_NOW, ISO_NOW);
  insert(`INSERT INTO users (id, email, name, auth_method, created_at, updated_at) VALUES (?, ?, ?, 'email_password', ?, ?)`, 'user-client', 'client@example.test', 'Client', ISO_NOW, ISO_NOW);
  insert(`INSERT INTO users (id, email, name, auth_method, created_at, updated_at) VALUES (?, ?, ?, 'email_password', ?, ?)`, 'user-outsider', 'outsider@example.test', 'Outsider', ISO_NOW, ISO_NOW);
  insert(`INSERT INTO organizations (id, name, slug, owner_id, billing_email, created_at, updated_at) VALUES ('org-1', 'Agency', 'agency', 'user-owner', 'billing@example.test', ?, ?)`, ISO_NOW, ISO_NOW);
  insert(`INSERT INTO teams (id, organization_id, name, created_at, updated_at) VALUES ('team-1', 'org-1', 'Clients', ?, ?)`, ISO_NOW, ISO_NOW);
  insert(`INSERT INTO team_members (id, team_id, user_id, role, joined_at) VALUES ('member-1', 'team-1', 'user-client', 'client', ?)`, ISO_NOW);
  insert(`INSERT INTO websites (id, organization_id, name, domain, url, created_at, updated_at) VALUES ('site-1', 'org-1', 'Example', 'example.com', 'https://example.com/', ?, ?)`, ISO_NOW, ISO_NOW);
  insert(`INSERT INTO websites (id, organization_id, name, domain, url, created_at, updated_at) VALUES ('site-2', 'org-1', 'Other', 'other.test', 'https://other.test/', ?, ?)`, ISO_NOW, ISO_NOW);
}
