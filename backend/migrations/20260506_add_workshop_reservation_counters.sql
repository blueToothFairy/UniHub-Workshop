ALTER TABLE workshops
ADD COLUMN IF NOT EXISTS reserved_count INT NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
ADD COLUMN IF NOT EXISTS confirmed_count INT NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0);

UPDATE workshops
SET confirmed_count = confirmed_registrations
WHERE confirmed_count = 0 AND confirmed_registrations > 0;

UPDATE workshops
SET reserved_count = confirmed_count
WHERE reserved_count < confirmed_count;

ALTER TABLE workshops
DROP CONSTRAINT IF EXISTS chk_workshop_counts_valid;

ALTER TABLE workshops
ADD CONSTRAINT chk_workshop_counts_valid CHECK (
  capacity >= 0
  AND reserved_count >= 0
  AND confirmed_count >= 0
  AND confirmed_count <= reserved_count
  AND reserved_count <= capacity
);
