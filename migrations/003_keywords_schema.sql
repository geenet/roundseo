-- RoundSEO Keywords & Rankings Schema

CREATE TABLE IF NOT EXISTS tracked_keywords (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  search_volume INTEGER DEFAULT 0,
  difficulty INTEGER DEFAULT 0, -- 0-100 SEO difficulty
  intent TEXT, -- commercial, informational, navigational
  is_tracked BOOLEAN DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(website_id, keyword)
);

CREATE TABLE IF NOT EXISTS keyword_rankings (
  id TEXT PRIMARY KEY,
  keyword_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  rank INTEGER,
  position_change INTEGER DEFAULT 0,
  traffic_estimate INTEGER DEFAULT 0,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE TABLE IF NOT EXISTS keyword_history (
  id TEXT PRIMARY KEY,
  keyword_id TEXT NOT NULL,
  rank_before INTEGER,
  rank_after INTEGER,
  change_date TEXT NOT NULL,
  FOREIGN KEY (keyword_id) REFERENCES tracked_keywords(id)
);

-- Create indexes
CREATE INDEX idx_tracked_keywords_website_id ON tracked_keywords(website_id);
CREATE INDEX idx_tracked_keywords_keyword ON tracked_keywords(keyword);
CREATE INDEX idx_keyword_rankings_keyword_id ON keyword_rankings(keyword_id);
CREATE INDEX idx_keyword_rankings_website_id ON keyword_rankings(website_id);
CREATE INDEX idx_keyword_rankings_checked_at ON keyword_rankings(checked_at);
CREATE INDEX idx_keyword_history_keyword_id ON keyword_history(keyword_id);
CREATE INDEX idx_keyword_history_change_date ON keyword_history(change_date);
