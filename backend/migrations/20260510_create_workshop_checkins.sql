CREATE TABLE IF NOT EXISTS workshop_checkins (
  id UUID PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_in_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('online_scan', 'offline_sync')),
  device_id TEXT,
  device_scan_id TEXT,
  scanned_at_device TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workshop_checkins_registration UNIQUE (registration_id),
  CONSTRAINT chk_workshop_checkins_device_pair CHECK (
    (device_id IS NULL AND device_scan_id IS NULL)
    OR (device_id IS NOT NULL AND device_scan_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_checkins_staff_device_scan
ON workshop_checkins(checked_in_by, device_id, device_scan_id)
WHERE device_id IS NOT NULL AND device_scan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workshop_checkins_workshop_id
ON workshop_checkins(workshop_id);

CREATE INDEX IF NOT EXISTS idx_workshop_checkins_checked_in_by
ON workshop_checkins(checked_in_by);
