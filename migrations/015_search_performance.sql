-- Search Console performance: clicks, impressions, CTR and position by day,
-- and by query, page, country and device for two comparable windows.
--
-- Search Console reports data with a delay of a few days and revises recent
-- days, so each sync re-pulls a trailing window rather than appending. Breakdowns
-- are stored for the "current" and "previous" 28-day windows only, and each
-- successful sync replaces both, so the table stays bounded. The daily series
-- keeps its history, upserted by day.

-- One row per sync attempt. A failed attempt never touches the data tables.
CREATE TABLE IF NOT EXISTS search_performance_syncs (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  property TEXT NOT NULL,
  window_end TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE INDEX IF NOT EXISTS idx_search_performance_syncs_website ON search_performance_syncs(website_id, started_at);

-- Google's own per-day figures (dimension: date), keyed by reporting day.
CREATE TABLE IF NOT EXISTS search_performance_days (
  website_id TEXT NOT NULL,
  day TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (website_id, day),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

-- Windowed breakdowns. period is 'current' or 'previous'. dimension is 'site'
-- (totals, item_key ''), 'query', 'page', 'country' or 'device'. Only the rows
-- with the most impressions are kept per dimension.
CREATE TABLE IF NOT EXISTS search_performance_windows (
  website_id TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('current', 'previous')),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('site', 'query', 'page', 'country', 'device')),
  item_key TEXT NOT NULL,
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (website_id, period, dimension, item_key),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE INDEX IF NOT EXISTS idx_search_performance_windows_lookup ON search_performance_windows(website_id, period, dimension);
