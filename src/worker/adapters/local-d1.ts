/**
 * Local D1 adapter for development
 * Wraps a local SQLite database to be compatible with D1Database interface
 *
 * Usage: Only used in local development when DATABASE_URL is set
 */

import Database from 'better-sqlite3';

export interface LocalD1Database {
  prepare(sql: string): {
    bind(...params: unknown[]): { first(): unknown; all(): unknown[] };
    first(): unknown;
    all(): unknown[];
    run(): { success: boolean; meta: { last_row_id?: number; changes?: number } };
  };
  exec(sql: string): void;
  dump(): Buffer;
  close(): void;
}

/**
 * Create a local SQLite database instance
 * This is only used in local development
 */
export function createLocalD1(dbPath: string): LocalD1Database {
  let db: Database.Database;

  try {
    db = new Database(dbPath);
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
  } catch (error) {
    throw new Error(`Failed to open database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);

      return {
        bind(...params: unknown[]) {
          const bound = stmt.bind(...params);
          return {
            first: () => {
              try {
                return bound.get();
              } catch (e) {
                console.error('D1 query error:', sql, params, e);
                return null;
              }
            },
            all: () => {
              try {
                return bound.all();
              } catch (e) {
                console.error('D1 query error:', sql, params, e);
                return [];
              }
            },
          };
        },
        first() {
          try {
            return stmt.get();
          } catch (e) {
            console.error('D1 query error:', sql, e);
            return null;
          }
        },
        all() {
          try {
            return stmt.all();
          } catch (e) {
            console.error('D1 query error:', sql, e);
            return [];
          }
        },
        run() {
          try {
            const info = stmt.run();
            return {
              success: true,
              meta: {
                last_row_id: info.lastInsertRowid as number,
                changes: info.changes,
              },
            };
          } catch (e) {
            console.error('D1 query error:', sql, e);
            return {
              success: false,
              meta: { changes: 0 },
            };
          }
        },
      };
    },
    exec(sql: string) {
      try {
        db.exec(sql);
      } catch (e) {
        console.error('D1 exec error:', sql, e);
      }
    },
    dump() {
      try {
        return db.serialize();
      } catch (e) {
        console.error('D1 dump error:', e);
        return Buffer.alloc(0);
      }
    },
    close() {
      db.close();
    },
  };
}
