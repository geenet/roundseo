-- Per-website brand media: the site's favicon and a small page thumbnail.
-- Image bytes live in R2 under an internal key. Public access is only through
-- short-lived signed URLs minted for the website's own organization members.

CREATE TABLE IF NOT EXISTS website_media (
  website_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  storage_key TEXT,
  content_type TEXT,
  byte_length INTEGER,
  width INTEGER,
  height INTEGER,
  source_url TEXT,
  reason TEXT,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (website_id, kind),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);
