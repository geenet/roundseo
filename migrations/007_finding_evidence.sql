-- Preserve the page-level observation behind every durable audit finding.
-- A finding is a grouped condition; this table keeps its exact URL, element,
-- observed context and proposed fix independently queryable.

CREATE TABLE IF NOT EXISTS audit_finding_evidence (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  page_identity_id TEXT,
  page_url TEXT NOT NULL,
  element TEXT NOT NULL,
  observed TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  availability TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (finding_id) REFERENCES audit_findings(id),
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (page_identity_id) REFERENCES page_identities(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_finding_evidence_finding_id ON audit_finding_evidence(finding_id);
CREATE INDEX IF NOT EXISTS idx_audit_finding_evidence_audit_id ON audit_finding_evidence(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_finding_evidence_page_identity ON audit_finding_evidence(page_identity_id);
