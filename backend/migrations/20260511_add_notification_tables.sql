CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT,
  event_type TEXT NOT NULL,
  registration_id UUID NOT NULL REFERENCES registrations(id),
  workshop_id UUID NOT NULL REFERENCES workshops(id),
  user_id UUID NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'in_app')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_deliveries_event_registration_channel
ON notification_deliveries(event_type, registration_id, channel);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_created
ON notification_deliveries(status, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_created
ON notification_deliveries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_notifications_user_created_desc
ON app_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_notifications_user_unread
ON app_notifications(user_id, is_read, created_at DESC);
