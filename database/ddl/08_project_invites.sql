-- ============================================================
-- Migration 08: 项目邀请链接表（PRD §2.23 协作邀请）
-- 支持生成一次性/多次使用邀请链接，含过期时间和角色预设。
-- ============================================================

CREATE TABLE IF NOT EXISTS project_invites (
    invite_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    created_by  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    code        VARCHAR(64) NOT NULL UNIQUE,
    role        VARCHAR(20) NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('editor','translator','reviewer','viewer')),
    max_uses    INTEGER NOT NULL DEFAULT 0,  -- 0 = unlimited
    use_count   INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_invites_code ON project_invites(code);
CREATE INDEX IF NOT EXISTS idx_project_invites_project ON project_invites(project_id);

COMMENT ON TABLE project_invites IS '项目邀请链接 — 含一次性/多次使用、过期时间、角色预设';
COMMENT ON COLUMN project_invites.max_uses IS '最大使用次数，0表示不限';
COMMENT ON COLUMN project_invites.role IS '受邀者默认角色：editor/translator/reviewer/viewer';
