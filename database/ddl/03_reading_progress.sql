-- ============================================================
-- 阅读进度表 - 持久化用户每页阅读位置
-- 创建时间: 2025-07-13
-- 依赖: users, projects, chapters, pages 表已存在
-- ============================================================

\c manga_translator;

-- -----------------------------------------------------------
-- reading_progress（阅读进度表）
-- 记录用户在某个项目中每章节/每页的阅读进度
-- -----------------------------------------------------------
DROP TABLE IF EXISTS reading_progress CASCADE;
CREATE TABLE reading_progress (
    progress_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id      UUID NOT NULL REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    page_id         UUID NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    scroll_position FLOAT NOT NULL DEFAULT 0,
    zoom_level      FLOAT NOT NULL DEFAULT 1.0,
    read_duration   INTEGER NOT NULL DEFAULT 0,  -- 阅读时长（秒）
    is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
    last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 每个用户每页只有一条进度记录
    UNIQUE (user_id, page_id)
);

COMMENT ON TABLE reading_progress IS '阅读进度表 - 持久化用户每页阅读位置';
COMMENT ON COLUMN reading_progress.scroll_position IS '滚动位置(0-1百分比)';
COMMENT ON COLUMN reading_progress.zoom_level IS '缩放级别';
COMMENT ON COLUMN reading_progress.read_duration IS '累计阅读时长(秒)';
COMMENT ON COLUMN reading_progress.is_completed IS '是否已完成阅读';
COMMENT ON COLUMN reading_progress.last_read_at IS '最后阅读时间';

-- 索引
CREATE INDEX idx_reading_progress_user ON reading_progress(user_id);
CREATE INDEX idx_reading_progress_project ON reading_progress(user_id, project_id);
CREATE INDEX idx_reading_progress_chapter ON reading_progress(user_id, chapter_id);
CREATE INDEX idx_reading_progress_last_read ON reading_progress(user_id, last_read_at DESC);
CREATE INDEX idx_reading_progress_user_page ON reading_progress(user_id, page_id);

-- 触发器
DROP TRIGGER IF EXISTS trg_reading_progress_updated_at ON reading_progress;
CREATE TRIGGER trg_reading_progress_updated_at
    BEFORE UPDATE ON reading_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

RAISE NOTICE '✅ reading_progress 表创建完成';
