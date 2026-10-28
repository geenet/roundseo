-- Detailed evidence lets every recommendation point to the affected pages,
-- observed markup, and an implementation-ready change.

CREATE TABLE IF NOT EXISTS recommendation_evidence (
  id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  page_url TEXT NOT NULL,
  element TEXT NOT NULL,
  observed TEXT NOT NULL,
  recommended_change TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
  FOREIGN KEY (audit_id) REFERENCES audits(id)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_evidence_recommendation_id
  ON recommendation_evidence(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_evidence_audit_id
  ON recommendation_evidence(audit_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_evidence_page_url
  ON recommendation_evidence(page_url);
