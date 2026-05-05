ALTER TABLE workshops
ADD COLUMN IF NOT EXISTS pdf_url TEXT,
ADD COLUMN IF NOT EXISTS ai_summary TEXT,
ADD COLUMN IF NOT EXISTS summary_status TEXT NOT NULL DEFAULT 'idle' CHECK (summary_status IN ('idle','processing','ready','fallback','failed')),
ADD COLUMN IF NOT EXISTS summary_generated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS summary_error_code TEXT;
