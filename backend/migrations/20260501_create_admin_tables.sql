CREATE TABLE IF NOT EXISTS workshops (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  speaker_name TEXT NOT NULL,
  room TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0),
  confirmed_registrations INT NOT NULL DEFAULT 0 CHECK (confirmed_registrations >= 0),
  price_vnd INT NOT NULL CHECK (price_vnd >= 0),
  payment_required BOOLEAN NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  actor_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL
);
