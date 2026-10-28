-- RoundSEO Crawl Data Schema
-- Audits, Pages, Crawl Errors, SEO Metrics

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'full', -- full, quick, keyword
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  pages_crawled INTEGER DEFAULT 0,
  pages_found INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status_code INTEGER,
  title TEXT,
  meta_description TEXT,
  h1_count INTEGER DEFAULT 0,
  h2_count INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  images_count INTEGER DEFAULT 0,
  internal_links_count INTEGER DEFAULT 0,
  external_links_count INTEGER DEFAULT 0,
  mobile_score INTEGER,
  desktop_score INTEGER,
  crawled_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  UNIQUE(audit_id, url)
);

CREATE TABLE IF NOT EXISTS crawl_errors (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  url TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  error_type TEXT, -- timeout, dns, ssl, robots, crawl_depth
  created_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE TABLE IF NOT EXISTS seo_metrics (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  overall_score INTEGER DEFAULT 0,
  indexability_score INTEGER DEFAULT 0,
  onpage_score INTEGER DEFAULT 0,
  technical_score INTEGER DEFAULT 0,
  internal_linking_score INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE TABLE IF NOT EXISTS page_metrics (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  title_length INTEGER,
  meta_desc_length INTEGER,
  h1_present BOOLEAN DEFAULT FALSE,
  keyword_in_title BOOLEAN DEFAULT FALSE,
  keyword_in_meta BOOLEAN DEFAULT FALSE,
  canonical_tag TEXT,
  robots_meta TEXT,
  is_indexable BOOLEAN DEFAULT TRUE,
  mobile_friendly BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id),
  FOREIGN KEY (audit_id) REFERENCES audits(id)
);

-- Create indexes for performance
CREATE INDEX idx_audits_website_id ON audits(website_id);
CREATE INDEX idx_audits_status ON audits(status);
CREATE INDEX idx_audits_created_at ON audits(created_at);
CREATE INDEX idx_pages_audit_id ON pages(audit_id);
CREATE INDEX idx_pages_website_id ON pages(website_id);
CREATE INDEX idx_pages_url ON pages(url);
CREATE INDEX idx_crawl_errors_audit_id ON crawl_errors(audit_id);
CREATE INDEX idx_crawl_errors_website_id ON crawl_errors(website_id);
CREATE INDEX idx_seo_metrics_audit_id ON seo_metrics(audit_id);
CREATE INDEX idx_seo_metrics_website_id ON seo_metrics(website_id);
CREATE INDEX idx_page_metrics_page_id ON page_metrics(page_id);
CREATE INDEX idx_page_metrics_audit_id ON page_metrics(audit_id);
