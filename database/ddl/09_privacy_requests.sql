-- ============================================================
-- Migration 09: PIPL/GDPR 隐私请求表
-- 支持数据可携带权（导出）和被遗忘权（删除）
-- ============================================================

CREATE TABLE IF NOT EXISTS privacy_requests (
    request_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    request_type    VARCHAR(20) NOT NULL CHECK (request_type IN ('export', 'deletion')),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    result_data     JSONB,
    result_message  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_user ON privacy_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests(status);

COMMENT ON TABLE privacy_requests IS 'PIPL/GDPR 隐私请求 — 数据导出/删除记录';
COMMENT ON COLUMN privacy_requests.request_type IS 'export=数据导出, deletion=数据删除';
