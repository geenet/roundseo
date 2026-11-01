-- Provider spend and task ownership ledger. This intentionally stores only
-- operational metadata, not raw provider payloads or credentials.

CREATE TABLE IF NOT EXISTS dataforseo_runs (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  task_id TEXT,
  provider_status INTEGER NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reservation_cost REAL NOT NULL DEFAULT 0,
  reservation_expires_at TEXT,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dataforseo_runs_website_created
  ON dataforseo_runs(website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dataforseo_runs_task_website
  ON dataforseo_runs(task_id, website_id);
CREATE INDEX IF NOT EXISTS idx_dataforseo_runs_reservation
  ON dataforseo_runs(website_id, reservation_expires_at);
