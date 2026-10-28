/**
 * Local D1 Adapter - Uses local SQLite when DATABASE_URL env var is set
 * Falls back to real D1 in production
 */

import Database from 'better-sqlite3';

interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  first(): Promise<unknown>;
  all(): Promise<unknown[]>;
  run(): Promise<{ success: boolean }>;
}

export interface LocalD1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<void>;
}

let dbInstance: Database.Database | null = null;

function getDatabase(): Database.Database {
  if (!dbInstance) {
    const dbPath = process.env.DATABASE_URL || '.local/roundseo-dev.db';
    dbInstance = new Database(dbPath);
    dbInstance.pragma('foreign_keys = ON');
  }
  return dbInstance;
}

export function createLocalD1Adapter(): LocalD1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      const db = getDatabase();
      const stmt = db.prepare(sql);
      let boundParams: unknown[] = [];

      return {
        bind(...params: unknown[]): D1PreparedStatement {
          boundParams = params;
          return this;
        },
        async first(): Promise<unknown> {
          try {
            if (boundParams.length > 0) {
              return stmt.get(...boundParams);
            }
            return stmt.get();
          } catch (error) {
            console.error('D1 first() error:', sql, boundParams, error);
            throw error;
          }
        },
        async all(): Promise<unknown[]> {
          try {
            if (boundParams.length > 0) {
              return stmt.all(...boundParams);
            }
            return stmt.all();
          } catch (error) {
            console.error('D1 all() error:', sql, boundParams, error);
            throw error;
          }
        },
        async run(): Promise<{ success: boolean }> {
          try {
            if (boundParams.length > 0) {
              stmt.run(...boundParams);
            } else {
              stmt.run();
            }
            return { success: true };
          } catch (error) {
            console.error('D1 run() error:', sql, boundParams, error);
            throw error;
          }
        },
      };
    },
    async exec(sql: string): Promise<void> {
      try {
        const db = getDatabase();
        db.exec(sql);
      } catch (error) {
        console.error('D1 exec() error:', sql, error);
        throw error;
      }
    },
  };
}

export function isLocalD1Enabled(): boolean {
  return typeof process !== 'undefined' && !!process.env.DATABASE_URL;
}
