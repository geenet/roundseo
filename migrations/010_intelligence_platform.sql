-- RoundSEO-native search intelligence ledger.
-- Provider identifiers are implementation metadata; product requests,
-- summaries, and evidence remain provider-neutral JSON contracts.

CREATE TABLE IF NOT EXISTS intelligence_runs (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  status_message TEXT NOT NULL,
  idempotency_key TEXT,
  request_json TEXT NOT NULL,
  summary_json TEXT,
  evidence_version TEXT NOT NULL DEFAULT 'initial',
  provider_key TEXT,
  provider_task_id TEXT,
  provider_endpoint TEXT,
  provider_asset_url TEXT,
  provider_cost REAL,
  checked_at TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(website_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS intelligence_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  evidence_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(run_id, evidence_version, evidence_kind, identity_key)
);

CREATE TABLE IF NOT EXISTS intelligence_mutation_keys (
  website_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  mutation TEXT NOT NULL,
  run_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (website_id, idempotency_key),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (run_id) REFERENCES intelligence_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intelligence_runs_website_created
  ON intelligence_runs(website_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_runs_website_capability
  ON intelligence_runs(website_id, capability, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_runs_provider_task
  ON intelligence_runs(website_id, provider_task_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_evidence_website_capability
  ON intelligence_evidence(website_id, capability, evidence_kind, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_evidence_run
  ON intelligence_evidence(run_id, evidence_version, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_mutation_run
  ON intelligence_mutation_keys(website_id, run_id, created_at DESC);
