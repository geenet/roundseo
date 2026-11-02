-- Follow-up correctness fixes for 013_backlinks_and_indexing.sql, found during review.

-- Enforces one observation per job at the database level (not just application logic), so a
-- redelivered or double-dispatched job can never write a second observation/event pair for the
-- same check (AC13: queue redelivery must not duplicate results or actions).
CREATE UNIQUE INDEX IF NOT EXISTS idx_backlink_observations_job_id ON backlink_observations(job_id);

-- SQLite treats every NULL as distinct in a UNIQUE constraint, so the existing
-- UNIQUE(website_id, provider, source_url, target_url) on backlink_candidates never caught a
-- duplicate source-only candidate (target_url IS NULL for all of them). A partial unique index
-- covers exactly that case; the original constraint continues to cover candidates with a known target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_backlink_candidates_source_only
  ON backlink_candidates(website_id, provider, source_url) WHERE target_url IS NULL;

-- Pending Google indexing-connection OAuth requests, keyed by the state nonce. The Indexing
-- module's OAuth flow is per-website and must carry websiteId/userId/scope through Google's
-- redirect round trip; storing them here (one-time use, short-lived) instead of embedding them
-- unsigned in the `state` query parameter means the callback trusts only what this server itself
-- recorded at /start time, not anything a crafted callback URL could supply.
CREATE TABLE IF NOT EXISTS google_oauth_states (
  nonce TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
