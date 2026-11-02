-- Backlinks monitoring and Indexing modules.
--
-- Backlinks separates "a link exists on a source page" from "Google reports
-- it indexed" from "we asked a search engine to look." The crawler pipeline
-- writes one observation per attempt and derives idempotent events; a job's
-- lease and attempted_at guard against an old delayed check overwriting a
-- newer one. Discovery and external-search tables are schema-ready adapters:
-- no provider is wired in by default (see src/worker/backlinks/discovery.ts).

-- Workspace (organization) capacity for active backlink monitors. Paused and
-- archived monitors release their slot; pending/unsuccessful active monitors
-- still hold one, because they remain scheduled.
CREATE TABLE IF NOT EXISTS backlink_capacity (
  organization_id TEXT PRIMARY KEY,
  limit_count INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Consumable allowances (discovery rows, external-search checks, rendering
-- checks, Google inspections) are counted separately from monitor capacity.
CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  website_id TEXT,
  billing_period TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  upstream_cost REAL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(organization_id, operation_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_org_period ON usage_ledger(organization_id, billing_period, operation_key);

-- One monitored relationship: a source page, an expected target, and a match
-- mode. The unique key is the monitor's identity (workspace, project, source,
-- target, match mode); exact-page and domain-wide configurations for the same
-- source are intentionally two slots.
CREATE TABLE IF NOT EXISTS backlink_monitors (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_url_normalized TEXT NOT NULL,
  expected_target_url TEXT NOT NULL,
  expected_target_normalized TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'exact_page',
  expected_anchor TEXT,
  expected_rel_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  cadence TEXT NOT NULL DEFAULT 'weekly',
  placement_date TEXT,
  next_check_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_successful_check_at TEXT,
  last_confirmed_presence TEXT NOT NULL DEFAULT 'unknown',
  last_confirmed_at TEXT,
  pending_confirmation_observation_id TEXT,
  confirmation_due_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  UNIQUE(website_id, source_url_normalized, expected_target_normalized, match_mode)
);

CREATE INDEX IF NOT EXISTS idx_backlink_monitors_website ON backlink_monitors(website_id, status);
CREATE INDEX IF NOT EXISTS idx_backlink_monitors_due ON backlink_monitors(status, next_check_at);

CREATE TABLE IF NOT EXISTS backlink_lists (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enrollment_defaults_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE INDEX IF NOT EXISTS idx_backlink_lists_website ON backlink_lists(website_id);

-- Adding one monitor to several lists consumes one active slot; membership is
-- tracked here, never by duplicating the monitor row.
CREATE TABLE IF NOT EXISTS backlink_list_members (
  list_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, monitor_id),
  FOREIGN KEY (list_id) REFERENCES backlink_lists(id),
  FOREIGN KEY (monitor_id) REFERENCES backlink_monitors(id)
);

CREATE INDEX IF NOT EXISTS idx_backlink_list_members_monitor ON backlink_list_members(monitor_id);

-- A durable job for one check attempt. Status plus lease_expires_at let the
-- scheduled() sweep reconcile a job whose queue delivery or worker crashed,
-- the same recovery shape as crawl_jobs and intelligence_runs.
CREATE TABLE IF NOT EXISTS backlink_jobs (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'scheduled_check',
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_expires_at TEXT,
  idempotency_key TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  FOREIGN KEY (monitor_id) REFERENCES backlink_monitors(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(monitor_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_backlink_jobs_status ON backlink_jobs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_backlink_jobs_monitor ON backlink_jobs(monitor_id, requested_at DESC);

-- One row per check attempt. last_attempt_at / last_successful_check_at on the
-- monitor are only ever advanced monotonically by attempted_at, so a job that
-- was delayed cannot overwrite a newer observation (AC12).
CREATE TABLE IF NOT EXISTS backlink_observations (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  fetch_outcome TEXT NOT NULL,
  http_status INTEGER,
  final_url TEXT,
  redirect_chain_json TEXT NOT NULL DEFAULT '[]',
  content_type TEXT,
  presence TEXT NOT NULL DEFAULT 'unknown',
  presence_method TEXT NOT NULL DEFAULT 'html',
  confirmation_state TEXT NOT NULL DEFAULT 'confirmed',
  target_status_code INTEGER,
  target_final_url TEXT,
  target_redirect_json TEXT NOT NULL DEFAULT '[]',
  source_meta_robots TEXT,
  source_x_robots_tag TEXT,
  source_canonical TEXT,
  raw_snippet TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (monitor_id) REFERENCES backlink_monitors(id),
  FOREIGN KEY (job_id) REFERENCES backlink_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_backlink_observations_monitor ON backlink_observations(monitor_id, attempted_at DESC);

-- Every matching occurrence on a successful fetch. A page can hold a regular
-- link and a nofollow link to the same destination; both rows are kept.
CREATE TABLE IF NOT EXISTS backlink_occurrences (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  original_href TEXT NOT NULL,
  resolved_url TEXT NOT NULL,
  anchor_text TEXT,
  image_alt TEXT,
  rel_tokens_json TEXT NOT NULL DEFAULT '[]',
  element_kind TEXT NOT NULL DEFAULT 'text',
  locator TEXT NOT NULL,
  context_fingerprint TEXT NOT NULL,
  matches_expected_target INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES backlink_observations(id),
  FOREIGN KEY (monitor_id) REFERENCES backlink_monitors(id)
);

CREATE INDEX IF NOT EXISTS idx_backlink_occurrences_observation ON backlink_occurrences(observation_id);
CREATE INDEX IF NOT EXISTS idx_backlink_occurrences_monitor ON backlink_occurrences(monitor_id, created_at DESC);

-- Idempotent change events. The unique key means a redelivered job or a
-- re-run confirmation check can never produce a second event or notification
-- for the same transition (AC11, AC13).
CREATE TABLE IF NOT EXISTS backlink_events (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  prior_observation_id TEXT,
  new_observation_id TEXT NOT NULL,
  confirmation_state TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  notified_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (monitor_id) REFERENCES backlink_monitors(id),
  FOREIGN KEY (new_observation_id) REFERENCES backlink_observations(id),
  UNIQUE(monitor_id, event_type, new_observation_id)
);

CREATE INDEX IF NOT EXISTS idx_backlink_events_monitor ON backlink_events(monitor_id, created_at DESC);

-- CSV import: an upload is previewed and persisted before commit, so a
-- retried commit of the same import never creates duplicate monitors or
-- reserves slots twice (AC2).
CREATE TABLE IF NOT EXISTS backlink_imports (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'previewed',
  column_mapping_json TEXT NOT NULL DEFAULT '{}',
  default_list_id TEXT,
  idempotency_key TEXT NOT NULL,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  over_limit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (default_list_id) REFERENCES backlink_lists(id),
  UNIQUE(website_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS backlink_import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  source_url TEXT,
  target_url TEXT,
  expected_anchor TEXT,
  expected_rel TEXT,
  notes TEXT,
  placement_date TEXT,
  row_status TEXT NOT NULL,
  error_message TEXT,
  monitor_id TEXT,
  candidate_id TEXT,
  FOREIGN KEY (import_id) REFERENCES backlink_imports(id),
  FOREIGN KEY (monitor_id) REFERENCES backlink_monitors(id)
);

CREATE INDEX IF NOT EXISTS idx_backlink_import_rows_import ON backlink_import_rows(import_id, row_index);

-- Second-release discovery scaffolding. No provider is configured by default
-- (src/worker/backlinks/discovery.ts); starting a job always records why.
CREATE TABLE IF NOT EXISTS discovery_jobs (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  budget_requested INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,
  retrieved_count INTEGER NOT NULL DEFAULT 0,
  unique_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  error_message TEXT,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(website_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS backlink_candidates (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  discovery_job_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT,
  provider TEXT NOT NULL,
  provider_record_id TEXT,
  provider_last_seen_at TEXT,
  imported_at TEXT NOT NULL,
  enrollment_status TEXT NOT NULL DEFAULT 'pending',
  monitor_id TEXT,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (discovery_job_id) REFERENCES discovery_jobs(id),
  FOREIGN KEY (monitor_id) REFERENCES backlink_monitors(id),
  UNIQUE(website_id, provider, source_url, target_url)
);

CREATE INDEX IF NOT EXISTS idx_backlink_candidates_website ON backlink_candidates(website_id, enrollment_status);

-- Revocable client sharing for a list. A view excludes private notes and
-- other lists/projects (AC24); revoking sets revoked_at and the token stops
-- resolving immediately.
CREATE TABLE IF NOT EXISTS backlink_report_shares (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  shared_token TEXT NOT NULL UNIQUE,
  permission_scope TEXT NOT NULL DEFAULT 'view',
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_viewed_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (list_id) REFERENCES backlink_lists(id)
);

-- Indexing module. A website's authorized Google Search Console connection.
-- The refresh token is encrypted at rest; the write (sitemaps) scope is only
-- ever requested when sitemap submission is explicitly enabled.
CREATE TABLE IF NOT EXISTS google_connections (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  google_account_email TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TEXT,
  granted_scopes_json TEXT NOT NULL DEFAULT '[]',
  selected_property TEXT,
  property_type TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- The intended-index inventory: crawled pages, sitemap URLs, and manually
-- flagged priority pages, each marked whether it is meant to be indexed.
CREATE TABLE IF NOT EXISTS indexing_inventory (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  url TEXT NOT NULL,
  url_normalized TEXT NOT NULL,
  intended_indexed INTEGER NOT NULL DEFAULT 1,
  is_priority INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'crawl',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(website_id, url_normalized)
);

CREATE INDEX IF NOT EXISTS idx_indexing_inventory_website ON indexing_inventory(website_id, is_priority DESC, last_seen_at DESC);

-- One Google verdict per inspection. checked_at (when RoundSEO called the
-- API) is kept apart from google_crawl_time (Google's own last-crawl date),
-- since a fresh API call can describe a much older crawl.
CREATE TABLE IF NOT EXISTS index_observations (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  inventory_id TEXT NOT NULL,
  evidence_method TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'unknown',
  coverage_reason TEXT,
  google_crawl_time TEXT,
  declared_canonical TEXT,
  selected_canonical TEXT,
  sitemap_refs_json TEXT NOT NULL DEFAULT '[]',
  inspection_result_link TEXT,
  raw_fetched_status INTEGER,
  raw_meta_robots TEXT,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (inventory_id) REFERENCES indexing_inventory(id)
);

CREATE INDEX IF NOT EXISTS idx_index_observations_inventory ON index_observations(inventory_id, checked_at DESC);

-- Bounded, lease-protected inspection scheduling, so a priority recheck never
-- competes unfairly with the rotation sweep and a stuck job is recoverable.
CREATE TABLE IF NOT EXISTS inspection_jobs (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  inventory_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  reason TEXT NOT NULL DEFAULT 'rotation',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  idempotency_key TEXT NOT NULL,
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  result_observation_id TEXT,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (inventory_id) REFERENCES indexing_inventory(id),
  UNIQUE(website_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inspection_jobs_status ON inspection_jobs(status, lease_expires_at);

-- Google's URL Inspection quota (2,000/day, 600/minute per site) tracked as a
-- bucketed counter, mirroring intelligence_request_windows.
CREATE TABLE IF NOT EXISTS inspection_quota_windows (
  website_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (website_id, bucket),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

-- An authorized action taken (inspect, sitemap submit, IndexNow notify,
-- Google Indexing API notify, publisher follow-up). Acceptance never becomes
-- an indexed verdict without a later, independent index_observations row.
CREATE TABLE IF NOT EXISTS indexing_actions (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_user_id TEXT,
  target_url TEXT,
  target_sitemap TEXT,
  submission_state TEXT NOT NULL,
  outcome_evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE INDEX IF NOT EXISTS idx_indexing_actions_website ON indexing_actions(website_id, created_at DESC);
