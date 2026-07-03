-- P1: vocabularies 表缺少 updated_at 列（BaseModel 自动要求）
-- 触发场景：vocab_extractor 写入时 SQLAlchemy ORM 报错
-- "column vocabularies.updated_at does not exist"
-- 同时为 learning_progress 加上 ON UPDATE 触发器，保证 updated_at 自动更新

ALTER TABLE vocabularies
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 触发器：UPDATE 时自动刷新 updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vocabularies_updated_at ON vocabularies;
CREATE TRIGGER trg_vocabularies_updated_at
    BEFORE UPDATE ON vocabularies
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- learning_progress 同理（如果还没有）
ALTER TABLE learning_progress
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_learning_progress_updated_at ON learning_progress;
CREATE TRIGGER trg_learning_progress_updated_at
    BEFORE UPDATE ON learning_progress
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
