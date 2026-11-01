-- RoundSEO-native intelligence collection, durable jobs, and observation datasets.
-- Applies on top of 010 without removing or rewriting saved runs or evidence.
-- Legacy provider columns from 009/010 remain readable history; new writes do not use them.

ALTER TABLE intelligence_runs ADD COLUMN progress_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN progress_total INTEGER;
ALTER TABLE intelligence_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE intelligence_runs ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE intelligence_runs ADD COLUMN source_json TEXT;
ALTER TABLE intelligence_runs ADD COLUMN coverage_json TEXT;
ALTER TABLE intelligence_runs ADD COLUMN unavailable_json TEXT;
ALTER TABLE intelligence_runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE intelligence_runs ADD COLUMN updated_progress_at TEXT;

-- Every SERP, app-store, and ranking observation RoundSEO collects. Analysis
-- (domain rankings, competitor overlap, market categories) reads from here,
-- so history accumulates across runs instead of being re-fetched.
CREATE TABLE IF NOT EXISTS intelligence_observations (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  country_code TEXT NOT NULL,
  language_code TEXT NOT NULL,
  device TEXT NOT NULL,
  query_key TEXT NOT NULL,
  query TEXT NOT NULL,
  position INTEGER NOT NULL,
  feature TEXT NOT NULL,
  domain TEXT,
  url TEXT,
  title TEXT,
  description TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (run_id) REFERENCES intelligence_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intelligence_observations_domain
  ON intelligence_observations(website_id, domain, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_observations_query
  ON intelligence_observations(website_id, surface, query_key, country_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_observations_run
  ON intelligence_observations(run_id);

-- Keyword volume, CPC range, competition, and monthly series returned by a
-- configured search-metrics source. Rows are only written from source answers.
CREATE TABLE IF NOT EXISTS intelligence_keyword_metrics (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  metrics_source TEXT NOT NULL,
  keyword_key TEXT NOT NULL,
  keyword TEXT NOT NULL,
  country_code TEXT NOT NULL,
  language_code TEXT NOT NULL,
  search_volume INTEGER,
  cpc_low REAL,
  cpc_high REAL,
  competition REAL,
  monthly_series_json TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (run_id) REFERENCES intelligence_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intelligence_keyword_metrics_lookup
  ON intelligence_keyword_metrics(website_id, metrics_source, keyword_key, country_code, observed_at DESC);

-- Frontier and results for a durable site crawl. A page row is written before
-- it is fetched, so an interrupted job resumes from the stored frontier.
CREATE TABLE IF NOT EXISTS intelligence_crawl_pages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  url TEXT NOT NULL,
  depth INTEGER NOT NULL,
  discovered_from TEXT,
  status TEXT NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, url),
  FOREIGN KEY (run_id) REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_crawl_pages_status
  ON intelligence_crawl_pages(run_id, status, depth);

-- Live-request ceiling per website per UTC day. This protects RoundSEO's own
-- workers and any connected collector from runaway use.
CREATE TABLE IF NOT EXISTS intelligence_request_windows (
  website_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (website_id, bucket),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

-- Screenshot bytes live in R2 under an internal key. Public access is only
-- through short-lived signed URLs minted after a website-scoped run lookup.
CREATE TABLE IF NOT EXISTS intelligence_assets (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_assets_run
  ON intelligence_assets(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_runs_queue
  ON intelligence_runs(status, lease_expires_at);
