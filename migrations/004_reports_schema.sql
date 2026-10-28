-- RoundSEO Reports & Recommendations Schema

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'full', -- full, summary, custom
  title TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  expires_at TEXT,
  shared_token TEXT UNIQUE,
  is_shared BOOLEAN DEFAULT FALSE,
  is_password_protected BOOLEAN DEFAULT FALSE,
  password_hash TEXT,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TEXT,
  s3_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  category TEXT NOT NULL, -- onpage, technical, indexability, performance, linking
  priority TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  title TEXT NOT NULL,
  description TEXT,
  affected_pages INTEGER DEFAULT 0,
  estimated_impact TEXT, -- low, medium, high
  estimated_effort TEXT, -- quick, medium, hard
  implementation_steps TEXT,
  is_fixed BOOLEAN DEFAULT FALSE,
  fixed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (audit_id) REFERENCES audits(id),
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

CREATE TABLE IF NOT EXISTS report_shares (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  shared_with_email TEXT NOT NULL,
  shared_by_user_id TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'view', -- view, comment, edit
  shared_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id),
  FOREIGN KEY (shared_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  notification_type TEXT NOT NULL, -- audit_complete, rank_change, new_error
  title TEXT NOT NULL,
  description TEXT,
  related_id TEXT, -- audit_id, keyword_id, etc.
  is_read BOOLEAN DEFAULT FALSE,
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS audit_schedules (
  id TEXT PRIMARY KEY,
  website_id TEXT NOT NULL,
  schedule_type TEXT NOT NULL, -- daily, weekly, monthly, custom
  day_of_week INTEGER, -- 0-6 for weekly
  time_of_day TEXT, -- HH:MM format
  is_active BOOLEAN DEFAULT TRUE,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (website_id) REFERENCES websites(id)
);

-- Create indexes
CREATE INDEX idx_reports_audit_id ON reports(audit_id);
CREATE INDEX idx_reports_website_id ON reports(website_id);
CREATE INDEX idx_reports_organization_id ON reports(organization_id);
CREATE INDEX idx_reports_shared_token ON reports(shared_token);
CREATE INDEX idx_reports_created_at ON reports(created_at);
CREATE INDEX idx_recommendations_audit_id ON recommendations(audit_id);
CREATE INDEX idx_recommendations_website_id ON recommendations(website_id);
CREATE INDEX idx_recommendations_category ON recommendations(category);
CREATE INDEX idx_recommendations_priority ON recommendations(priority);
CREATE INDEX idx_report_shares_report_id ON report_shares(report_id);
CREATE INDEX idx_report_shares_email ON report_shares(shared_with_email);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_organization_id ON notifications(organization_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_audit_schedules_website_id ON audit_schedules(website_id);
CREATE INDEX idx_audit_schedules_next_run_at ON audit_schedules(next_run_at);
