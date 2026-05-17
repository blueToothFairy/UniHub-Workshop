CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_id ON audit_logs (created_at DESC, id DESC);
