ALTER TABLE payments
ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
ADD COLUMN IF NOT EXISTS payment_url TEXT,
ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
ADD COLUMN IF NOT EXISTS provider_result_code TEXT,
ADD COLUMN IF NOT EXISTS provider_message TEXT,
ADD COLUMN IF NOT EXISTS provider_trans_id TEXT,
ADD COLUMN IF NOT EXISTS provider_raw_response JSONB,
ADD COLUMN IF NOT EXISTS callback_first_received_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS callback_last_received_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS callback_signature TEXT,
ADD COLUMN IF NOT EXISTS callback_payload JSONB,
ADD COLUMN IF NOT EXISTS callback_count INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS reconciliation_attempts INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS review_reason TEXT;

UPDATE payments
SET provider_order_id = merchant_order_id
WHERE provider_order_id IS NULL
  AND gateway = 'simulation';

UPDATE payments
SET provider_result_code = COALESCE(provider_result_code, 'SIMULATION')
WHERE gateway = 'simulation';

UPDATE payments
SET provider_message = COALESCE(provider_message, 'Legacy simulation payment')
WHERE gateway = 'simulation';

ALTER TABLE payments
DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE payments
ADD CONSTRAINT chk_payments_status_valid CHECK (
  status IN (
    'pending_simulation',
    'pending_provider',
    'unknown',
    'completed',
    'failed',
    'expired',
    'requires_review'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_order_id_not_null
ON payments(provider_order_id)
WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_trans_id_not_null
ON payments(provider_trans_id)
WHERE provider_trans_id IS NOT NULL;
