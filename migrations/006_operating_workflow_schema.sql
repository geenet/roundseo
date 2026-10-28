-- Evidence-led operating workflow foundation.
--
-- This migration keeps measurements, audit observations, findings and owner
-- actions separate. A missing source remains a declared availability state
-- rather than being represented as a zero or failed metric.

CREATE TABLE IF NOT EXISTS site_profiles (
  website_id TEXT PRIMARY KEY,
  business_description TEXT,
  target_countries_json TEXT NOT NULL DEFAULT '[]',
  target_languages_json TEXT NOT NULL DEFAULT '[]',
  conversion_goals_json TEXT NOT NULL DEFAULT '[]',
  important_pages_json TEXT NOT NULL DEFAULT '[]',
  excluded_paths_json TEXT NOT NULL DEFAULT '[]',
  private_paths_json TEXT NOT NULL DEFAULT '[]',
  intended_public_paths_json TEXT NOT NULL DEFAULT '[]',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE TABLE IF NOT EXISTS site_hosts (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  hostname TEXT NOT NULL,
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  is_included BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(website_id, origin)
);

CREATE TABLE IF NOT EXISTS connector_accounts (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  selected_account TEXT,
  selected_property TEXT,
  authorized_scopes_json TEXT NOT NULL DEFAULT '[]',
  supported_metrics_json TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT 'not_connected',
  quota_state TEXT,
  available_from TEXT,
  available_to TEXT,
  last_successful_sync_at TEXT,
  next_scheduled_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(website_id, provider, selected_property)
);

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  source TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_expires_at TEXT,
  cost_budget_json TEXT NOT NULL DEFAULT '{}',
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  result_ref TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  UNIQUE(website_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_metadata (
  audit_id TEXT PRIMARY KEY,
  collection_method TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  availability TEXT NOT NULL,
  method_version TEXT NOT NULL,
  crawl_scope_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (audit_id) REFERENCES audits(id)
);

CREATE TABLE IF NOT EXISTS page_identities (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(website_id, normalized_url)
);

CREATE TABLE IF NOT EXISTS page_snapshots (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  page_identity_id TEXT NOT NULL,
  requested_url TEXT NOT NULL,
  final_url TEXT,
  status_code INTEGER,
  response_headers_json TEXT NOT NULL DEFAULT '{}',
  title TEXT,
  meta_description TEXT,
  h1_json TEXT NOT NULL DEFAULT '[]',
  canonical_url TEXT,
  robots_directive TEXT,
  main_content_excerpt TEXT,
  content_fingerprint TEXT,
  rendered BOOLEAN NOT NULL DEFAULT FALSE,
  observation_method TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  availability TEXT NOT NULL,
  raw_evidence_ref TEXT,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (page_identity_id) REFERENCES page_identities(id),
  UNIQUE(audit_id, requested_url, observation_method)
);

CREATE TABLE IF NOT EXISTS link_edges (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  source_page_identity_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  final_target_url TEXT,
  anchor_text TEXT,
  placement TEXT NOT NULL DEFAULT 'unknown',
  rel_attributes TEXT,
  is_internal BOOLEAN NOT NULL,
  observation_method TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (source_page_identity_id) REFERENCES page_identities(id),
  UNIQUE(audit_id, source_url, target_url, anchor_text, placement)
);

CREATE TABLE IF NOT EXISTS measurement_definitions (
  metric_key TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  unit TEXT NOT NULL,
  source_family TEXT NOT NULL,
  supported_dimensions_json TEXT NOT NULL DEFAULT '[]',
  statistic TEXT,
  numerator_meaning TEXT,
  denominator_meaning TEXT,
  aggregation_rule TEXT NOT NULL,
  threshold_reference TEXT,
  version TEXT NOT NULL,
  availability_requirements_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_observations (
  id TEXT PRIMARY KEY,
  audit_id TEXT,
  website_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value REAL,
  numerator REAL,
  denominator REAL,
  unit TEXT NOT NULL,
  statistic TEXT,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  availability TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  source_timezone TEXT,
  fetched_at TEXT NOT NULL,
  sample_size INTEGER,
  method_version TEXT NOT NULL,
  configuration_hash TEXT,
  raw_evidence_ref TEXT,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (metric_key) REFERENCES measurement_definitions(metric_key)
);

CREATE TABLE IF NOT EXISTS audit_findings (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  availability TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  impact TEXT,
  proposed_fix TEXT,
  effort_band TEXT,
  affected_page_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(audit_id, rule_id)
);

CREATE TABLE IF NOT EXISTS action_items (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  action_key TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  business_impact TEXT,
  effort_band TEXT,
  owner_id TEXT,
  proposed_fix TEXT,
  verification_method TEXT NOT NULL,
  affected_page_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  verified_at TEXT,
  ignored_reason TEXT,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(action_key)
);

CREATE TABLE IF NOT EXISTS action_occurrences (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES action_items(id),
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (finding_id) REFERENCES audit_findings(id),
  UNIQUE(action_id, audit_id)
);

CREATE TABLE IF NOT EXISTS page_changes (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  page_identity_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  detected_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (page_identity_id) REFERENCES page_identities(id),
  FOREIGN KEY (audit_id) REFERENCES audits(id)
);

CREATE INDEX IF NOT EXISTS idx_site_hosts_website_id ON site_hosts(website_id);
CREATE INDEX IF NOT EXISTS idx_connector_accounts_website_id ON connector_accounts(website_id);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status_requested_at ON crawl_jobs(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_website_id ON crawl_jobs(website_id);
CREATE INDEX IF NOT EXISTS idx_page_identities_website_id ON page_identities(website_id);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_audit_id ON page_snapshots(audit_id);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_identity_observed_at ON page_snapshots(page_identity_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_link_edges_audit_id ON link_edges(audit_id);
CREATE INDEX IF NOT EXISTS idx_link_edges_target_url ON link_edges(website_id, target_url);
CREATE INDEX IF NOT EXISTS idx_metric_observations_site_key_time ON metric_observations(website_id, metric_key, fetched_at);
CREATE INDEX IF NOT EXISTS idx_audit_findings_audit_id ON audit_findings(audit_id);
CREATE INDEX IF NOT EXISTS idx_action_items_website_status ON action_items(website_id, status);
CREATE INDEX IF NOT EXISTS idx_action_occurrences_audit_id ON action_occurrences(audit_id);
CREATE INDEX IF NOT EXISTS idx_page_changes_website_detected_at ON page_changes(website_id, detected_at);
