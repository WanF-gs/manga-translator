-- Fix: add missing updated_at columns for v3 models
-- ChangeLog and Vocabulary models inherit BaseModel which expects updated_at

ALTER TABLE change_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE vocabularies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
