-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- DDL建表脚本 v1.0 (完整版)
-- 适用: PostgreSQL 15+
-- 创建时间: 2025-07-11
-- DBA: 资深数据库管理员
-- ============================================================

-- ⚠️ 执行前提: 已创建 manga_translator 数据库
-- 回滚方案: 执行 02_rollback.sql 删除所有表

\c manga_translator;

-- ============================================================
-- 第一部分：扩展与基础函数
-- ============================================================

-- 启用UUID扩展（用于生成主键）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
COMMENT ON EXTENSION pgcrypto IS '用于 gen_random_uuid() 生成UUID主键';

-- 启用模糊匹配扩展（用于翻译记忆相似度搜索）
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
COMMENT ON EXTENSION pg_trgm IS '用于翻译记忆缓存的文本相似度搜索';

-- ============================================================
-- 第二部分：自动更新 updated_at 触发器函数
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS '自动更新 updated_at 字段为当前时间戳';

-- ============================================================
-- 第三部分：核心业务表
-- 建表顺序严格遵循外键依赖关系
-- ============================================================

-- -----------------------------------------------------------
-- 3.1 users（用户表）
-- 存储所有注册用户的基本信息和付费状态
-- -----------------------------------------------------------
DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE,
    phone           VARCHAR(20) UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    nickname        VARCHAR(100) NOT NULL,
    avatar_url      VARCHAR(500),
    plan_type       VARCHAR(20) NOT NULL DEFAULT 'free'
                    CHECK (plan_type IN ('free', 'premium')),
    premium_expires TIMESTAMPTZ,
    settings        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 邮箱和手机号至少提供一个
    CONSTRAINT chk_email_phone CHECK (email IS NOT NULL OR phone IS NOT NULL),
    -- 昵称长度校验
    CONSTRAINT chk_nickname_length CHECK (char_length(nickname) BETWEEN 1 AND 50)
);

COMMENT ON TABLE users IS '用户表 - 存储注册用户基本信息与付费状态';
COMMENT ON COLUMN users.user_id IS '用户唯一标识(UUID)';
COMMENT ON COLUMN users.email IS '邮箱地址(与phone至少一个)';
COMMENT ON COLUMN users.phone IS '手机号(与email至少一个)';
COMMENT ON COLUMN users.password_hash IS '密码bcrypt哈希';
COMMENT ON COLUMN users.nickname IS '用户昵称(1-50字符)';
COMMENT ON COLUMN users.plan_type IS '付费方案: free-免费版, premium-高级版';
COMMENT ON COLUMN users.premium_expires IS '高级版过期时间(NULL=永久)';
COMMENT ON COLUMN users.settings IS '用户偏好设置JSON';

-- 索引
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_phone ON users(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_plan_type ON users(plan_type);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- -----------------------------------------------------------
-- 3.2 projects（作品表）
-- 存储用户创建的漫画翻译项目
-- -----------------------------------------------------------
DROP TABLE IF EXISTS projects CASCADE;
CREATE TABLE projects (
    project_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    source_lang     VARCHAR(10) NOT NULL CHECK (source_lang IN ('ja','zh','en','ko')),
    cover_url       VARCHAR(500),
    is_favorite     BOOLEAN NOT NULL DEFAULT FALSE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'trashed')),
    trashed_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE projects IS '作品表 - 用户创建的漫画翻译项目';
COMMENT ON COLUMN projects.source_lang IS '源语言: ja-日语, zh-中文, en-英语, ko-韩语';
COMMENT ON COLUMN projects.is_favorite IS '是否收藏(收藏作品列表置顶)';
COMMENT ON COLUMN projects.status IS '状态: active-活跃, trashed-已删除(回收站)';
COMMENT ON COLUMN projects.trashed_at IS '删除时间(30天后自动清理)';

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_user_status ON projects(user_id, status);
CREATE INDEX idx_projects_user_favorite ON projects(user_id, is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX idx_projects_trashed_at ON projects(trashed_at) WHERE status = 'trashed';

-- -----------------------------------------------------------
-- 3.3 chapters（章节表）
-- 作品下的章节管理
-- -----------------------------------------------------------
DROP TABLE IF EXISTS chapters CASCADE;
CREATE TABLE chapters (
    chapter_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    sort_order      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- 同一作品内排序序号唯一
    UNIQUE (project_id, sort_order)
);

COMMENT ON TABLE chapters IS '章节表 - 作品下的章节管理';
COMMENT ON COLUMN chapters.sort_order IS '排序序号(同作品内唯一，自动维护)';

CREATE INDEX idx_chapters_project_id ON chapters(project_id);
CREATE INDEX idx_chapters_project_sort ON chapters(project_id, sort_order);

-- -----------------------------------------------------------
-- 3.4 pages（页面表）
-- 章节内的漫画页面
-- -----------------------------------------------------------
DROP TABLE IF EXISTS pages CASCADE;
CREATE TABLE pages (
    page_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id          UUID NOT NULL REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    original_url        VARCHAR(500) NOT NULL,
    processed_url       VARCHAR(500),
    thumbnail_url       VARCHAR(500),
    sort_order          INTEGER NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','translating','reviewing','reviewed','needs_repair','completed')),
    width               INTEGER NOT NULL,
    height              INTEGER NOT NULL,
    file_size           INTEGER NOT NULL,  -- 单位: bytes
    erase_quality_score FLOAT CHECK (erase_quality_score >= 0 AND erase_quality_score <= 100),
    ocr_result          JSONB,
    translation_result  JSONB,
    preprocessing_result JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (chapter_id, sort_order)
);

COMMENT ON TABLE pages IS '页面表 - 章节内的漫画页面';
COMMENT ON COLUMN pages.original_url IS '原始图片存储URL';
COMMENT ON COLUMN pages.processed_url IS '处理后图片URL';
COMMENT ON COLUMN pages.thumbnail_url IS '缩略图URL';
COMMENT ON COLUMN pages.status IS '状态: pending-待处理, translating-翻译中, reviewing-待校对, reviewed-已校对, needs_repair-待修复, completed-已完成';
COMMENT ON COLUMN pages.erase_quality_score IS '擦除质量评分(0-100)，低于60分提示用户复核 [v3.0]';
COMMENT ON COLUMN pages.ocr_result IS 'OCR识别结果JSON';
COMMENT ON COLUMN pages.translation_result IS '翻译结果JSON';
COMMENT ON COLUMN pages.preprocessing_result IS '预处理结果JSON';

CREATE INDEX idx_pages_chapter_id ON pages(chapter_id);
CREATE INDEX idx_pages_status ON pages(status);
CREATE INDEX idx_pages_chapter_sort ON pages(chapter_id, sort_order);
-- JSONB字段的部分索引（低置信度快速查询）
CREATE INDEX idx_pages_ocr_result ON pages USING GIN (ocr_result jsonb_path_ops);

-- -----------------------------------------------------------
-- 3.5 text_regions（文字区域表）
-- 每个页面上检测到的文字区域
-- -----------------------------------------------------------
DROP TABLE IF EXISTS text_regions CASCADE;
CREATE TABLE text_regions (
    region_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         UUID NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('speech','thought','narration','onomatopoeia','effect')),
    boundary        JSONB NOT NULL,
    boundary_mode   VARCHAR(10) NOT NULL DEFAULT 'rect'
                    CHECK (boundary_mode IN ('rect', 'polygon', 'bezier')),
    character_id    UUID,
    original_text   TEXT,
    translated_text TEXT,
    confidence      FLOAT CHECK (confidence >= 0 AND confidence <= 1),
    is_locked       BOOLEAN NOT NULL DEFAULT FALSE,
    style_config    JSONB,
    sort_order      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE text_regions IS '文字区域表 - 页面上检测到的文字区域';
COMMENT ON COLUMN text_regions.type IS '类型: speech-对话, thought-内心独白, narration-旁白, onomatopoeia-拟声词, effect-效果字';
COMMENT ON COLUMN text_regions.boundary IS '边界坐标JSON: {x,y,width,height,points,rotation,polygon}';
COMMENT ON COLUMN text_regions.boundary_mode IS '选区包围模式: rect-矩形(降级), polygon-多边形(优选), bezier-贝塞尔曲线 [v3.0]';
COMMENT ON COLUMN text_regions.character_id IS '关联角色ID(语气一致性引擎用) [v2.0]';
COMMENT ON COLUMN text_regions.confidence IS 'OCR置信度(0-1)';
COMMENT ON COLUMN text_regions.is_locked IS '是否锁定(锁定词不翻译)';
COMMENT ON COLUMN text_regions.style_config IS '样式配置JSON: {font_family,font_size,color,...}';

CREATE INDEX idx_text_regions_page_id ON text_regions(page_id);
CREATE INDEX idx_text_regions_type ON text_regions(type);
CREATE INDEX idx_text_regions_confidence ON text_regions(confidence) WHERE confidence < 0.6;
CREATE INDEX idx_text_regions_page_sort ON text_regions(page_id, sort_order);
CREATE INDEX idx_text_regions_boundary ON text_regions USING GIN (boundary jsonb_path_ops);

-- -----------------------------------------------------------
-- 3.6 term_entries（术语条目表）
-- 用户自定义的翻译术语库
-- -----------------------------------------------------------
DROP TABLE IF EXISTS term_entries CASCADE;
CREATE TABLE term_entries (
    term_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects(project_id) ON DELETE CASCADE,
    source_text     VARCHAR(500) NOT NULL,
    target_text     VARCHAR(500) NOT NULL,
    note            TEXT,
    category        VARCHAR(50),
    scope           VARCHAR(20) NOT NULL DEFAULT 'account'
                    CHECK (scope IN ('account', 'project')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE term_entries IS '术语条目表 - 用户自定义翻译术语库';
COMMENT ON COLUMN term_entries.scope IS '适用范围: account-账号级, project-作品级';
COMMENT ON COLUMN term_entries.category IS '分类标签(如: 人名、地名、招式名)';

CREATE INDEX idx_term_entries_user_id ON term_entries(user_id);
CREATE INDEX idx_term_entries_project_id ON term_entries(project_id);
CREATE INDEX idx_term_entries_scope ON term_entries(scope);
CREATE INDEX idx_term_entries_user_scope ON term_entries(user_id, scope);
-- 术语搜索索引
CREATE INDEX idx_term_entries_source_text ON term_entries USING GIN (source_text gin_trgm_ops);

-- -----------------------------------------------------------
-- 3.7 style_presets（样式预设表）
-- 系统内置与用户自定义的字体样式
-- -----------------------------------------------------------
DROP TABLE IF EXISTS style_presets CASCADE;
CREATE TABLE style_presets (
    preset_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(user_id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects(project_id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    category        VARCHAR(20) NOT NULL
                    CHECK (category IN ('speech','thought','narration','onomatopoeia','effect')),
    style_config    JSONB NOT NULL,
    scope           VARCHAR(20) NOT NULL DEFAULT 'system'
                    CHECK (scope IN ('system', 'account', 'project')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE style_presets IS '样式预设表 - 系统内置与用户自定义字体样式';
COMMENT ON COLUMN style_presets.category IS '分类: speech-对话气泡, narration-旁白, onomatopoeia-拟声词';
COMMENT ON COLUMN style_presets.scope IS '范围: system-系统内置, account-账号级, project-作品级';
COMMENT ON COLUMN style_presets.style_config IS '样式配置JSON: {font_family,font_size,color,stroke_width,stroke_color,opacity,text_align,vertical,letter_spacing,line_height}';

CREATE INDEX idx_style_presets_scope ON style_presets(scope);
CREATE INDEX idx_style_presets_user_id ON style_presets(user_id);
CREATE INDEX idx_style_presets_category ON style_presets(category);
CREATE INDEX idx_style_presets_user_scope ON style_presets(user_id, scope) WHERE user_id IS NOT NULL;

-- -----------------------------------------------------------
-- 3.8 operation_histories（操作历史表）
-- 撤销/重做功能的数据支撑
-- -----------------------------------------------------------
DROP TABLE IF EXISTS operation_histories CASCADE;
CREATE TABLE operation_histories (
    history_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    page_id         UUID REFERENCES pages(page_id) ON DELETE CASCADE,
    operation_type  VARCHAR(50) NOT NULL,
    before_state    JSONB NOT NULL,
    after_state     JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE operation_histories IS '操作历史表 - 撤销/重做数据支撑(最多保留20步/页面)';
COMMENT ON COLUMN operation_histories.operation_type IS '操作类型: region_add/region_delete/region_move/text_edit/style_change 等';
COMMENT ON COLUMN operation_histories.before_state IS '操作前状态快照(JSON)';
COMMENT ON COLUMN operation_histories.after_state IS '操作后状态快照(JSON)';

CREATE INDEX idx_op_histories_user_page ON operation_histories(user_id, page_id);
CREATE INDEX idx_op_histories_created ON operation_histories(created_at DESC);
CREATE INDEX idx_op_histories_project ON operation_histories(project_id);

-- -----------------------------------------------------------
-- 3.9 export_tasks（导出任务表）
-- 后台异步导出任务管理
-- -----------------------------------------------------------
DROP TABLE IF EXISTS export_tasks CASCADE;
CREATE TABLE export_tasks (
    task_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_ids     JSONB NOT NULL,
    format          VARCHAR(10) NOT NULL CHECK (format IN ('jpg','png','webp','cbz','pdf')),
    quality         INTEGER NOT NULL DEFAULT 90 CHECK (quality >= 1 AND quality <= 100),
    resolution      VARCHAR(10) NOT NULL DEFAULT 'original'
                    CHECK (resolution IN ('original','1080p','2k','4k')),
    bilingual_mode  VARCHAR(20) CHECK (bilingual_mode IN ('side-by-side','top-bottom','in-bubble')),
    naming_rule     VARCHAR(200) DEFAULT '{project_name}_{chapter}_{page}_{lang}',
    status          VARCHAR(20) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','processing','completed','failed','cancelled')),
    progress        FLOAT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    result_url      VARCHAR(500),
    error_msg       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

COMMENT ON TABLE export_tasks IS '导出任务表 - 后台异步导出任务管理';
COMMENT ON COLUMN export_tasks.format IS '导出格式: jpg/png/webp/cbz/pdf';
COMMENT ON COLUMN export_tasks.bilingual_mode IS '双语模式: side-by-side-左右分屏, top-bottom-上下对照, in-bubble-气泡内双语';
COMMENT ON COLUMN export_tasks.status IS '状态: queued-排队, processing-处理中, completed-已完成, failed-失败, cancelled-已取消';

CREATE INDEX idx_export_tasks_user_id ON export_tasks(user_id);
CREATE INDEX idx_export_tasks_status ON export_tasks(status);
CREATE INDEX idx_export_tasks_user_status ON export_tasks(user_id, status);
CREATE INDEX idx_export_tasks_created ON export_tasks(created_at DESC);

-- -----------------------------------------------------------
-- 3.10 vocabularies（生词本表）
-- 阅读器单词收藏与学习
-- -----------------------------------------------------------
DROP TABLE IF EXISTS vocabularies CASCADE;
CREATE TABLE vocabularies (
    vocab_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    word                VARCHAR(200) NOT NULL,
    language            VARCHAR(10) NOT NULL CHECK (language IN ('ja','zh','en','ko')),
    definition          TEXT,
    part_of_speech      VARCHAR(50),
    example_sentence    TEXT,
    source_project_id   UUID REFERENCES projects(project_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vocabularies IS '生词本表 - 阅读器单词收藏与学习';
COMMENT ON COLUMN vocabularies.source_project_id IS '来源作品ID(可为NULL)';

CREATE INDEX idx_vocabularies_user_id ON vocabularies(user_id);
CREATE INDEX idx_vocabularies_language ON vocabularies(language);
CREATE INDEX idx_vocabularies_user_lang ON vocabularies(user_id, language);
CREATE INDEX idx_vocabularies_word ON vocabularies USING GIN (word gin_trgm_ops);

-- -----------------------------------------------------------
-- 3.11 notifications（通知表）
-- 系统消息与任务完成通知
-- -----------------------------------------------------------
DROP TABLE IF EXISTS notifications CASCADE;
CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    type            VARCHAR(30) NOT NULL
                    CHECK (type IN ('export_complete','task_complete','system','promotion')),
    title           VARCHAR(200) NOT NULL,
    content         TEXT,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    ref_type        VARCHAR(20),
    ref_id          UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notifications IS '通知表 - 系统消息与任务完成通知';
COMMENT ON COLUMN notifications.type IS '通知类型: export_complete-导出完成, task_complete-任务完成, system-系统通知, promotion-推广';
COMMENT ON COLUMN notifications.ref_type IS '关联资源类型(如: project, export_task)';
COMMENT ON COLUMN notifications.ref_id IS '关联资源ID';

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- -----------------------------------------------------------
-- 3.12 translation_cache（翻译记忆缓存表）
-- 同作品内翻译记忆复用
-- -----------------------------------------------------------
DROP TABLE IF EXISTS translation_cache CASCADE;
CREATE TABLE translation_cache (
    cache_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    source_text     TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    source_lang     VARCHAR(10) NOT NULL,
    target_lang     VARCHAR(10) NOT NULL,
    similarity_hash VARCHAR(64) NOT NULL,
    hit_count       INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE translation_cache IS '翻译记忆缓存表 - 同作品内翻译记忆复用';
COMMENT ON COLUMN translation_cache.similarity_hash IS '文本相似度哈希(用于快速匹配相似句子)';
COMMENT ON COLUMN translation_cache.hit_count IS '命中次数(统计热度)';

CREATE INDEX idx_trans_cache_project ON translation_cache(project_id);
CREATE INDEX idx_trans_cache_hash ON translation_cache(similarity_hash);
CREATE INDEX idx_trans_cache_langs ON translation_cache(source_lang, target_lang);

-- -----------------------------------------------------------
-- 3.13 user_sessions（用户会话表）
-- JWT Refresh Token 管理
-- -----------------------------------------------------------
DROP TABLE IF EXISTS user_sessions CASCADE;
CREATE TABLE user_sessions (
    session_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    refresh_token_hash  VARCHAR(255) NOT NULL,
    device_info         VARCHAR(500),
    ip_address          VARCHAR(45),
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE user_sessions IS '用户会话表 - JWT Refresh Token管理';
COMMENT ON COLUMN user_sessions.refresh_token_hash IS 'Refresh Token的哈希值(不存储明文)';
COMMENT ON COLUMN user_sessions.device_info IS '设备信息(User-Agent)';
COMMENT ON COLUMN user_sessions.ip_address IS '登录IP地址';

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_sessions_token_hash ON user_sessions(refresh_token_hash);

-- ============================================================
-- 第四部分：创建触发器（自动更新 updated_at）
-- ============================================================

-- 4.1 users 表触发器
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.2 projects 表触发器
DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.3 chapters 表触发器
DROP TRIGGER IF EXISTS trg_chapters_updated_at ON chapters;
CREATE TRIGGER trg_chapters_updated_at
    BEFORE UPDATE ON chapters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.4 pages 表触发器
DROP TRIGGER IF EXISTS trg_pages_updated_at ON pages;
CREATE TRIGGER trg_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.5 text_regions 表触发器
DROP TRIGGER IF EXISTS trg_text_regions_updated_at ON text_regions;
CREATE TRIGGER trg_text_regions_updated_at
    BEFORE UPDATE ON text_regions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.6 term_entries 表触发器
DROP TRIGGER IF EXISTS trg_term_entries_updated_at ON term_entries;
CREATE TRIGGER trg_term_entries_updated_at
    BEFORE UPDATE ON term_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.7 translation_cache 表触发器
DROP TRIGGER IF EXISTS trg_trans_cache_updated_at ON translation_cache;
CREATE TRIGGER trg_trans_cache_updated_at
    BEFORE UPDATE ON translation_cache
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 第五部分：创建视图
-- ============================================================

-- 5.1 作品概览视图（含页面统计信息）
CREATE OR REPLACE VIEW v_project_overview AS
SELECT
    p.project_id,
    p.user_id,
    p.name,
    p.source_lang,
    p.cover_url,
    p.is_favorite,
    p.status,
    p.created_at,
    p.updated_at,
    COUNT(DISTINCT ch.chapter_id) AS chapter_count,
    COUNT(DISTINCT pg.page_id) AS page_count,
    COUNT(DISTINCT pg.page_id) FILTER (WHERE pg.status = 'completed') AS completed_count,
    COUNT(DISTINCT pg.page_id) FILTER (WHERE pg.status = 'reviewed') AS reviewed_count,
    COUNT(DISTINCT pg.page_id) FILTER (WHERE pg.status = 'reviewing') AS reviewing_count,
    COUNT(DISTINCT pg.page_id) FILTER (WHERE pg.status = 'needs_repair') AS needs_repair_count,
    COUNT(DISTINCT pg.page_id) FILTER (WHERE pg.status = 'translating') AS translating_count,
    COUNT(DISTINCT pg.page_id) FILTER (WHERE pg.status = 'pending') AS pending_count,
    CASE
        WHEN COUNT(DISTINCT pg.page_id) = 0 THEN 0
        ELSE ROUND(COUNT(DISTINCT pg.page_id) FILTER (WHERE pg.status = 'completed') * 100.0
             / COUNT(DISTINCT pg.page_id), 1)
    END AS completion_percentage
FROM projects p
LEFT JOIN chapters ch ON ch.project_id = p.project_id
LEFT JOIN pages pg ON pg.chapter_id = ch.chapter_id
WHERE p.status = 'active'
GROUP BY p.project_id;

COMMENT ON VIEW v_project_overview IS '作品概览视图 - 包含章节数、页面数、完成进度等统计信息';

-- 5.2 用户通知概览视图
CREATE OR REPLACE VIEW v_user_notifications AS
SELECT
    n.notification_id,
    n.user_id,
    n.type,
    n.title,
    n.content,
    n.is_read,
    n.ref_type,
    n.ref_id,
    n.created_at,
    CASE
        WHEN n.created_at > NOW() - INTERVAL '1 hour' THEN '刚刚'
        WHEN n.created_at > NOW() - INTERVAL '24 hours' THEN
            EXTRACT(HOUR FROM NOW() - n.created_at)::INT || '小时前'
        WHEN n.created_at > NOW() - INTERVAL '7 days' THEN
            EXTRACT(DAY FROM NOW() - n.created_at)::INT || '天前'
        ELSE to_char(n.created_at, 'YYYY-MM-DD')
    END AS time_display
FROM notifications n;

COMMENT ON VIEW v_user_notifications IS '用户通知视图 - 包含人性化时间显示';

-- ============================================================
-- 第六部分：创建存储过程/函数
-- ============================================================

-- 6.1 清理过期会话
CREATE OR REPLACE FUNCTION clean_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION clean_expired_sessions() IS '清理过期会话 - 删除已过期的Refresh Token记录，返回删除行数';

-- 6.2 清理回收站30天过期项目
CREATE OR REPLACE FUNCTION clean_trashed_projects()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM projects
    WHERE status = 'trashed'
      AND trashed_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION clean_trashed_projects() IS '清理回收站 - 永久删除30天前放入回收站的项目，返回删除行数';

-- 6.3 页面排序自动重排（删除/插入后维护连续性）
CREATE OR REPLACE FUNCTION reorder_pages(p_chapter_id UUID)
RETURNS void AS $$
DECLARE
    rec RECORD;
    new_order INTEGER := 1;
BEGIN
    FOR rec IN
        SELECT page_id FROM pages
        WHERE chapter_id = p_chapter_id
        ORDER BY sort_order, created_at
    LOOP
        UPDATE pages SET sort_order = new_order
        WHERE page_id = rec.page_id;
        new_order := new_order + 1;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reorder_pages(UUID) IS '页面排序重排 - 删除/插入页面后自动重新编号';

-- 6.4 章节排序自动重排
CREATE OR REPLACE FUNCTION reorder_chapters(p_project_id UUID)
RETURNS void AS $$
DECLARE
    rec RECORD;
    new_order INTEGER := 1;
BEGIN
    FOR rec IN
        SELECT chapter_id FROM chapters
        WHERE project_id = p_project_id
        ORDER BY sort_order, created_at
    LOOP
        UPDATE chapters SET sort_order = new_order
        WHERE chapter_id = rec.chapter_id;
        new_order := new_order + 1;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reorder_chapters(UUID) IS '章节排序重排 - 删除/插入章节后自动重新编号';

-- 6.5 获取翻译记忆缓存（带相似度匹配）
CREATE OR REPLACE FUNCTION get_translation_cache(
    p_project_id UUID,
    p_source_text TEXT,
    p_source_lang VARCHAR,
    p_target_lang VARCHAR
)
RETURNS TABLE(
    translated_text TEXT,
    hit_count INTEGER,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.translated_text,
        tc.hit_count,
        similarity(tc.source_text, p_source_text) AS similarity
    FROM translation_cache tc
    WHERE tc.project_id = p_project_id
      AND tc.source_lang = p_source_lang
      AND tc.target_lang = p_target_lang
      AND similarity(tc.source_text, p_source_text) >= 0.9
    ORDER BY similarity DESC
    LIMIT 1;

    -- 命中时更新计数
    IF FOUND THEN
        UPDATE translation_cache
        SET hit_count = hit_count + 1, updated_at = NOW()
        WHERE project_id = p_project_id
          AND source_text = p_source_text;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_translation_cache IS '获取翻译记忆缓存 - 基于文本相似度(≥90%)匹配并自动更新命中计数';

-- 6.6 用户注册函数（密码bcrypt哈希由应用层处理，此处仅做数据校验）
CREATE OR REPLACE FUNCTION validate_user_registration(
    p_email VARCHAR,
    p_phone VARCHAR,
    p_nickname VARCHAR
)
RETURNS TABLE(is_valid BOOLEAN, error_message VARCHAR) AS $$
BEGIN
    -- 检查邮箱或手机号至少一个
    IF p_email IS NULL AND p_phone IS NULL THEN
        RETURN QUERY SELECT FALSE, '邮箱和手机号至少填写一个'::VARCHAR;
        RETURN;
    END IF;

    -- 检查邮箱格式
    IF p_email IS NOT NULL AND p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN QUERY SELECT FALSE, '邮箱格式不正确'::VARCHAR;
        RETURN;
    END IF;

    -- 检查昵称长度
    IF char_length(p_nickname) < 1 OR char_length(p_nickname) > 50 THEN
        RETURN QUERY SELECT FALSE, '昵称长度应在1-50字符之间'::VARCHAR;
        RETURN;
    END IF;

    -- 检查邮箱唯一性
    IF p_email IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE email = p_email) THEN
        RETURN QUERY SELECT FALSE, '该邮箱已被注册'::VARCHAR;
        RETURN;
    END IF;

    -- 检查手机号唯一性
    IF p_phone IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE phone = p_phone) THEN
        RETURN QUERY SELECT FALSE, '该手机号已被注册'::VARCHAR;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, '验证通过'::VARCHAR;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_user_registration IS '用户注册校验 - 检查邮箱/手机号唯一性和格式';

-- ============================================================
-- 第七部分：创建物化视图（可选，用于报表）
-- ============================================================

-- 7.1 每日处理统计（需定期刷新）
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_stats AS
SELECT
    DATE(created_at) AS stat_date,
    COUNT(DISTINCT user_id) AS active_users,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed_pages,
    COUNT(*) FILTER (WHERE status = 'reviewed') AS reviewed_pages,
    COUNT(DISTINCT user_id) FILTER (WHERE plan_type = 'premium') AS premium_users
FROM pages
JOIN chapters ON pages.chapter_id = chapters.chapter_id
JOIN projects ON chapters.project_id = projects.project_id
JOIN users ON projects.user_id = users.user_id
WHERE pages.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(t1.created_at)
ORDER BY stat_date DESC;

COMMENT ON MATERIALIZED VIEW mv_daily_stats IS '每日处理统计物化视图(近30天) - 需定期 REFRESH';

-- ============================================================
-- 第八部分：创建事件触发器（Schema变更审计）
-- ============================================================

CREATE OR REPLACE FUNCTION audit_schema_changes()
RETURNS EVENT_TRIGGER AS $$
DECLARE
    obj RECORD;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
    LOOP
        RAISE NOTICE 'DDL变更审计: 用户=%, 操作=%, 对象=%, 时间=%',
            current_user,
            obj.command_tag,
            obj.object_identity,
            NOW();
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 仅在开发/测试环境启用
-- CREATE EVENT TRIGGER trg_audit_schema_changes
--     ON ddl_command_end
--     EXECUTE FUNCTION audit_schema_changes();

-- ============================================================
-- 输出确认信息
-- ============================================================
DO $$
DECLARE
    table_count INTEGER;
    index_count INTEGER;
    trigger_count INTEGER;
    function_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

    SELECT COUNT(*) INTO index_count FROM pg_indexes
    WHERE schemaname = 'public';

    SELECT COUNT(*) INTO trigger_count FROM pg_trigger
    WHERE tgname LIKE 'trg_%';

    SELECT COUNT(*) INTO function_count FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prokind = 'f';

    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ DDL建表脚本执行完成';
    RAISE NOTICE '   - 业务表: % 张', table_count;
    RAISE NOTICE '   - 索引: % 个', index_count;
    RAISE NOTICE '   - 触发器: % 个', trigger_count;
    RAISE NOTICE '   - 函数/存储过程: % 个', function_count;
    RAISE NOTICE '   - 视图: 2 个 (v_project_overview, v_user_notifications)';
    RAISE NOTICE '   - 物化视图: 1 个 (mv_daily_stats)';
    RAISE NOTICE '========================================';
END $$;
