CREATE TABLE IF NOT EXISTS registrations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  workshop_id UUID NOT NULL REFERENCES workshops(id),
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'expired')),
  reservation_expires_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  qr_token TEXT,
  qr_token_hash TEXT,
  qr_issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_registration_user_workshop
ON registrations(user_id, workshop_id)
WHERE status IN ('pending_payment', 'confirmed');

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES registrations(id) UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  workshop_id UUID NOT NULL REFERENCES workshops(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  merchant_order_id TEXT NOT NULL UNIQUE,
  gateway TEXT NOT NULL DEFAULT 'simulation',
  gateway_txn_id TEXT,
  amount_vnd INT NOT NULL CHECK (amount_vnd >= 0),
  currency TEXT NOT NULL DEFAULT 'VND',
  status TEXT NOT NULL CHECK (status IN ('pending_simulation', 'completed', 'failed', 'expired')),
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_gateway_txn_id_not_null
ON payments(gateway_txn_id)
WHERE gateway_txn_id IS NOT NULL;
