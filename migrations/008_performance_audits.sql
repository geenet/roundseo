-- Page experience is a separate evidence stream from crawl health. Store the
-- provider run, then preserve mobile and desktop results independently so a
-- desktop result cannot be mistaken for the mobile experience.

CREATE TABLE IF NOT EXISTS performance_audits (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL UNIQUE,
  website_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  provider TEXT NOT NULL,
  availability TEXT NOT NULL,
  method_version TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  error_message TEXT,
  source_evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE TABLE IF NOT EXISTS performance_device_results (
  id TEXT PRIMARY KEY,
  performance_audit_id TEXT NOT NULL,
  device TEXT NOT NULL,
  availability TEXT NOT NULL,
  lab_score REAL,
  field_data_availability TEXT NOT NULL,
  field_data_scope TEXT NOT NULL,
  lab_metrics_json TEXT NOT NULL DEFAULT '[]',
  field_metrics_json TEXT NOT NULL DEFAULT '[]',
  opportunities_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (performance_audit_id) REFERENCES performance_audits(id),
  UNIQUE(performance_audit_id, device)
);

CREATE INDEX IF NOT EXISTS idx_performance_audits_website_fetched_at
  ON performance_audits(website_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_performance_device_results_audit
  ON performance_device_results(performance_audit_id, device);
