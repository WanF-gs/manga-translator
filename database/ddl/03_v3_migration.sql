-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- DDL 迁移脚本 v3.0
-- 适用: PostgreSQL 15+
-- 创建时间: 2026-06-25
-- 说明: v1.0 → v3.0 增量迁移，新增10张表，修改5张已有表
-- 回滚方案: 执行 03_v3_rollback.sql 删除新增表并还原修改
-- ============================================================

\c manga_translator;

-- ============================================================
-- 第一部分：已有表字段修改
-- ============================================================

-- 1.1 pages 表：新增擦除质量评分字段
ALTER TABLE pages 
ADD COLUMN IF NOT EXISTS erase_quality_score FLOAT CHECK (erase_quality_score >= 0 AND erase_quality_score <= 100);

COMMENT ON COLUMN pages.erase_quality_score IS '擦除质量评分(0-100)，低于60分提示用户复核 [NEW v3.0]';

-- 添加页面状态 'needs_repair' 到 CHECK 约束
-- PostgreSQL 不支持直接修改 CHECK，需重建约束
ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_status_check;
ALTER TABLE pages ADD CONSTRAINT pages_status_check 
    CHECK (status IN ('pending','translating','reviewing','reviewed','needs_repair','completed'));

COMMENT ON CONSTRAINT pages_status_check ON pages IS '状态: pending-待处理, translating-翻译中, reviewing-待校对, reviewed-已校对, needs_repair-待修复, completed-已完成';

-- 1.2 text_regions 表：新增选区包围模式字段
ALTER TABLE text_regions 
ADD COLUMN IF NOT EXISTS boundary_mode VARCHAR(10) NOT NULL DEFAULT 'rect'
    CHECK (boundary_mode IN ('rect', 'polygon', 'bezier'));

COMMENT ON COLUMN text_regions.boundary_mode IS '选区包围模式: rect-矩形(降级), polygon-多边形(优选), bezier-贝塞尔曲线 [NEW v3.0]';

-- 1.3 text_regions 表：新增关联角色ID字段
ALTER TABLE text_regions 
ADD COLUMN IF NOT EXISTS character_id UUID;

COMMENT ON COLUMN text_regions.character_id IS '关联角色ID(语气一致性引擎用) [NEW v2.0]';

-- 1.4 export_tasks 表：format 字段新增 mp4
ALTER TABLE export_tasks DROP CONSTRAINT IF EXISTS export_tasks_format_check;
ALTER TABLE export_tasks ADD CONSTRAINT export_tasks_format_check 
    CHECK (format IN ('jpg','png','webp','cbz','pdf','mp4'));

-- ============================================================
-- 第二部分：新增业务表 (v2.0遗留 + v3.0新增)
-- ============================================================

-- -----------------------------------------------------------
-- 2.1 characters（角色表）[NEW v2.0 + v3.0增强]
-- 漫画角色管理，支持语气类型、视觉特征、TTS音色、专属字体绑定
-- -----------------------------------------------------------
DROP TABLE IF EXISTS characters CASCADE;
CREATE TABLE characters (
    character_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    name                VARCHAR(200) NOT NULL,
    tone_type           VARCHAR(20) NOT NULL DEFAULT 'custom'
                        CHECK (tone_type IN (
                            'tsundere','hotblooded','calm','cold','loli',
                            'genki','lazy','chuunibyou','natural','bellyblack','custom'
                        )),
    custom_tone_params  JSONB,
    catchphrase         TEXT,
    honorific_level     VARCHAR(10) CHECK (honorific_level IN ('casual','polite','formal')),
    gender              VARCHAR(10) CHECK (gender IN ('male','female','neutral')),
    visual_features     JSONB,
    voice_id            VARCHAR(100),
    font_id             UUID,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE characters IS '角色表 - 漫画角色管理与语气配置 [NEW v2.0+v3.0]';
COMMENT ON COLUMN characters.tone_type IS '语气类型: tsundere-傲娇, hotblooded-热血, calm-沉稳, cold-冷酷, loli-萝莉, genki-元气, lazy-慵懒, chuunibyou-中二, natural-天然呆, bellyblack-腹黑, custom-自定义';
COMMENT ON COLUMN characters.custom_tone_params IS '自定义语气参数JSON: {formality,affinity,aggression,cuteness} 各项0-1';
COMMENT ON COLUMN characters.catchphrase IS '角色口头禅';
COMMENT ON COLUMN characters.honorific_level IS '敬语等级: casual-随意, polite-礼貌, formal-正式';
COMMENT ON COLUMN characters.visual_features IS '视觉特征向量(JSON)，用于自动角色检测归属';
COMMENT ON COLUMN characters.voice_id IS '绑定的TTS音色ID [NEW v3.0]';
COMMENT ON COLUMN characters.font_id IS '绑定的专属字体ID，关联fonts表 [NEW v3.0]';

CREATE INDEX idx_characters_project_id ON characters(project_id);
CREATE INDEX idx_characters_tone_type ON characters(tone_type);
CREATE INDEX idx_characters_project_sort ON characters(project_id, sort_order);

-- -----------------------------------------------------------
-- 2.2 fonts（字体表）[NEW v3.0]
-- 字体库管理：内置字体+用户上传字体，支持分类、风格标签、版权标注
-- -----------------------------------------------------------
DROP TABLE IF EXISTS fonts CASCADE;
CREATE TABLE fonts (
    font_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(user_id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    file_url        VARCHAR(500) NOT NULL,
    file_size       INTEGER CHECK (file_size <= 20971520),
    category        VARCHAR(20) NOT NULL
                    CHECK (category IN ('dialogue','narration','onomatopoeia','title')),
    style_tags      JSONB DEFAULT '[]'::jsonb,
    license         VARCHAR(30) NOT NULL DEFAULT 'personal_only'
                    CHECK (license IN ('free_commercial','attribution','personal_only')),
    language_tags   JSONB DEFAULT '[]'::jsonb,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE fonts IS '字体表 - 字体库管理 [NEW v3.0]';
COMMENT ON COLUMN fonts.user_id IS '所属用户ID(null=系统内置字体)';
COMMENT ON COLUMN fonts.file_url IS '字体文件存储URL(MinIO)';
COMMENT ON COLUMN fonts.file_size IS '字体文件大小(bytes)，最大20MB';
COMMENT ON COLUMN fonts.category IS '用途分类: dialogue-对话, narration-旁白, onomatopoeia-拟声词, title-标题';
COMMENT ON COLUMN fonts.style_tags IS '风格标签JSON数组: ["热血","温馨","搞笑","恐怖"...]';
COMMENT ON COLUMN fonts.license IS '版权类型: free_commercial-免费可商用, attribution-需署名, personal_only-仅个人使用';
COMMENT ON COLUMN fonts.language_tags IS '语言标签JSON数组: ["ja","zh","en","ko"...]';
COMMENT ON COLUMN fonts.is_active IS '是否启用';

CREATE INDEX idx_fonts_user_id ON fonts(user_id);
CREATE INDEX idx_fonts_category ON fonts(category);
CREATE INDEX idx_fonts_license ON fonts(license);
CREATE INDEX idx_fonts_is_active ON fonts(is_active);
CREATE INDEX idx_fonts_style_tags ON fonts USING GIN (style_tags jsonb_path_ops);
CREATE INDEX idx_fonts_language_tags ON fonts USING GIN (language_tags jsonb_path_ops);

-- characters 表的 font_id 外键(延迟创建)
ALTER TABLE characters 
ADD CONSTRAINT fk_characters_font_id 
FOREIGN KEY (font_id) REFERENCES fonts(font_id) ON DELETE SET NULL;

-- -----------------------------------------------------------
-- 2.3 voices（TTS音色表）[NEW v3.0]
-- 有声剧场的音色预设管理
-- -----------------------------------------------------------
DROP TABLE IF EXISTS voices CASCADE;
CREATE TABLE voices (
    voice_id            VARCHAR(100) PRIMARY KEY,
    user_id             UUID REFERENCES users(user_id) ON DELETE CASCADE,
    name                VARCHAR(100) NOT NULL,
    gender              VARCHAR(10) NOT NULL CHECK (gender IN ('male','female','neutral')),
    age_group           VARCHAR(20) CHECK (age_group IN ('child','teen','young_adult','adult','elder')),
    tone_description    VARCHAR(200),
    language            VARCHAR(10) NOT NULL DEFAULT 'ja',
    sample_url          VARCHAR(500),
    is_system           BOOLEAN NOT NULL DEFAULT FALSE,
    is_custom_clone     BOOLEAN NOT NULL DEFAULT FALSE,
    clone_sample_url    VARCHAR(500),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE voices IS 'TTS音色表 - 有声剧场音色预设管理 [NEW v3.0]';
COMMENT ON COLUMN voices.age_group IS '年龄段: child-儿童, teen-少年, young_adult-青年, adult-成人, elder-老者';
COMMENT ON COLUMN voices.tone_description IS '音色描述';
COMMENT ON COLUMN voices.is_system IS '是否系统预设音色';
COMMENT ON COLUMN voices.is_custom_clone IS '是否为声音克隆(高级版)';
COMMENT ON COLUMN voices.clone_sample_url IS '声音克隆的音频样本URL';

CREATE INDEX idx_voices_user_id ON voices(user_id);
CREATE INDEX idx_voices_gender ON voices(gender);
CREATE INDEX idx_voices_language ON voices(language);

-- characters 表的 voice_id 外键
ALTER TABLE characters 
ADD CONSTRAINT fk_characters_voice_id 
FOREIGN KEY (voice_id) REFERENCES voices(voice_id) ON DELETE SET NULL;

-- -----------------------------------------------------------
-- 2.4 api_keys（API密钥表）[NEW v2.0]
-- API开放平台的密钥管理
-- -----------------------------------------------------------
DROP TABLE IF EXISTS api_keys CASCADE;
CREATE TABLE api_keys (
    api_key_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    key_hash        VARCHAR(255) NOT NULL,
    key_prefix      VARCHAR(8) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    permissions     JSONB NOT NULL DEFAULT '["detect","ocr","translate"]'::jsonb,
    rate_limit      INTEGER NOT NULL DEFAULT 60,
    total_calls     BIGINT NOT NULL DEFAULT 0,
    monthly_calls   BIGINT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE api_keys IS 'API密钥表 - API开放平台密钥管理 [NEW v2.0]';
COMMENT ON COLUMN api_keys.key_hash IS 'API Key的bcrypt哈希值(不存储明文)';
COMMENT ON COLUMN api_keys.key_prefix IS '密钥前缀(展示用，如 msk_abc123)';
COMMENT ON COLUMN api_keys.permissions IS '权限列表JSON: ["detect","ocr","translate","pipeline"]';
COMMENT ON COLUMN api_keys.rate_limit IS '速率限制(次/分钟)';
COMMENT ON COLUMN api_keys.total_calls IS '总调用次数';
COMMENT ON COLUMN api_keys.monthly_calls IS '当月调用次数';

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX idx_api_keys_user_active ON api_keys(user_id, is_active) WHERE is_active = TRUE;

-- -----------------------------------------------------------
-- 2.5 project_members（项目成员表）[NEW v2.0]
-- 轻量级团队协作 - 成员管理
-- -----------------------------------------------------------
DROP TABLE IF EXISTS project_members CASCADE;
CREATE TABLE project_members (
    member_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('owner','editor','reviewer','viewer')),
    invited_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE (project_id, user_id)
);

COMMENT ON TABLE project_members IS '项目成员表 - 团队协作成员管理 [NEW v2.0]';
COMMENT ON COLUMN project_members.role IS '角色: owner-所有者, editor-编辑者, reviewer-校对者, viewer-查看者';
COMMENT ON COLUMN project_members.invited_by IS '邀请者ID';

CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_project_members_role ON project_members(project_id, role);

-- -----------------------------------------------------------
-- 2.6 collaboration_locks（协作锁表）[NEW v2.0]
-- 页面级编辑锁定，防止协同时编辑冲突
-- -----------------------------------------------------------
DROP TABLE IF EXISTS collaboration_locks CASCADE;
CREATE TABLE collaboration_locks (
    lock_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         UUID NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    lock_type       VARCHAR(10) NOT NULL CHECK (lock_type IN ('edit','review')),
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    
    UNIQUE (page_id)
);

COMMENT ON TABLE collaboration_locks IS '协作锁表 - 页面级编辑锁定(30分钟自动过期) [NEW v2.0]';
COMMENT ON COLUMN collaboration_locks.lock_type IS '锁定类型: edit-编辑锁, review-校对锁';

CREATE INDEX idx_collab_locks_page ON collaboration_locks(page_id);
CREATE INDEX idx_collab_locks_user ON collaboration_locks(user_id);
CREATE INDEX idx_collab_locks_expires ON collaboration_locks(expires_at);

-- -----------------------------------------------------------
-- 2.7 comments（评论标注表）[NEW v2.0]
-- 区域/页面级评论与讨论
-- -----------------------------------------------------------
DROP TABLE IF EXISTS comments CASCADE;
CREATE TABLE comments (
    comment_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id           UUID REFERENCES text_regions(region_id) ON DELETE CASCADE,
    page_id             UUID NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    content             TEXT NOT NULL,
    mentioned_user_ids  JSONB DEFAULT '[]'::jsonb,
    status              VARCHAR(10) NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','resolved')),
    parent_comment_id   UUID REFERENCES comments(comment_id) ON DELETE CASCADE,
    resolved_by         UUID REFERENCES users(user_id) ON DELETE SET NULL,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE comments IS '评论标注表 - 区域/页面级评论与讨论 [NEW v2.0]';
COMMENT ON COLUMN comments.mentioned_user_ids IS '@提及的用户ID列表JSON';
COMMENT ON COLUMN comments.status IS '状态: open-开启讨论, resolved-已解决';

CREATE INDEX idx_comments_page_id ON comments(page_id);
CREATE INDEX idx_comments_project_id ON comments(project_id);
CREATE INDEX idx_comments_region_id ON comments(region_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
CREATE INDEX idx_comments_status ON comments(status);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);

-- -----------------------------------------------------------
-- 2.8 change_logs（变更日志表）[NEW v2.0]
-- 编辑操作审计追踪
-- -----------------------------------------------------------
DROP TABLE IF EXISTS change_logs CASCADE;
CREATE TABLE change_logs (
    log_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    page_id         UUID REFERENCES pages(page_id) ON DELETE CASCADE,
    region_id       UUID REFERENCES text_regions(region_id) ON DELETE SET NULL,
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    action          VARCHAR(50) NOT NULL,
    field_name      VARCHAR(50),
    old_value       TEXT,
    new_value       TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE change_logs IS '变更日志表 - 编辑操作审计追踪 [NEW v2.0]';
COMMENT ON COLUMN change_logs.action IS '操作类型: region_add/region_delete/region_move/text_edit/style_change/snapshot_create等';
COMMENT ON COLUMN change_logs.metadata IS '额外元数据JSON';

CREATE INDEX idx_change_logs_project ON change_logs(project_id);
CREATE INDEX idx_change_logs_page ON change_logs(page_id);
CREATE INDEX idx_change_logs_user ON change_logs(user_id);
CREATE INDEX idx_change_logs_created ON change_logs(created_at DESC);

-- -----------------------------------------------------------
-- 2.9 snapshots（版本快照表）[NEW v2.0]
-- 手动保存的版本快照，支持一键恢复
-- -----------------------------------------------------------
DROP TABLE IF EXISTS snapshots CASCADE;
CREATE TABLE snapshots (
    snapshot_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    snapshot_data   JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE snapshots IS '版本快照表 - 手动版本保存与恢复 [NEW v2.0]';
COMMENT ON COLUMN snapshots.snapshot_data IS '快照数据JSON(页面状态+区域状态+翻译+样式)';

CREATE INDEX idx_snapshots_project ON snapshots(project_id);
CREATE INDEX idx_snapshots_user ON snapshots(user_id);
CREATE INDEX idx_snapshots_created ON snapshots(created_at DESC);

-- -----------------------------------------------------------
-- 2.10 translation_quality（翻译质量评估表）[NEW v2.0]
-- 自动质量评分 + 雷达图数据
-- -----------------------------------------------------------
DROP TABLE IF EXISTS translation_quality CASCADE;
CREATE TABLE translation_quality (
    quality_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id             UUID NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
    bleu_score          FLOAT CHECK (bleu_score >= 0 AND bleu_score <= 1),
    meteor_score        FLOAT CHECK (meteor_score >= 0 AND meteor_score <= 1),
    tone_consistency    FLOAT CHECK (tone_consistency >= 0 AND tone_consistency <= 1),
    term_consistency    FLOAT CHECK (term_consistency >= 0 AND term_consistency <= 1),
    overall_score       FLOAT CHECK (overall_score >= 0 AND overall_score <= 1),
    report_json         JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE translation_quality IS '翻译质量评估表 - BLEU/METEOR自动评分 [NEW v2.0]';
COMMENT ON COLUMN translation_quality.bleu_score IS 'BLEU分数(n-gram匹配度)';
COMMENT ON COLUMN translation_quality.meteor_score IS 'METEOR分数(词形变化+同义词)';
COMMENT ON COLUMN translation_quality.tone_consistency IS '语气一致性评分';
COMMENT ON COLUMN translation_quality.term_consistency IS '术语一致性评分';
COMMENT ON COLUMN translation_quality.overall_score IS '综合质量评分';
COMMENT ON COLUMN translation_quality.report_json IS '详细质量报告JSON(含雷达图数据)';

CREATE INDEX idx_trans_quality_page ON translation_quality(page_id);
CREATE INDEX idx_trans_quality_score ON translation_quality(overall_score);

-- -----------------------------------------------------------
-- 2.11 feedback（用户反馈表）[NEW v2.0]
-- 翻译用户反馈闭环 - 好评/差评/修正
-- -----------------------------------------------------------
DROP TABLE IF EXISTS feedback CASCADE;
CREATE TABLE feedback (
    feedback_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    region_id               UUID NOT NULL REFERENCES text_regions(region_id) ON DELETE CASCADE,
    original_translation    TEXT NOT NULL,
    user_translation        TEXT,
    rating                  VARCHAR(10) CHECK (rating IN ('good','bad','neutral')),
    correction_reason       TEXT,
    used_for_training       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE feedback IS '用户反馈表 - 翻译反馈闭环 [NEW v2.0]';
COMMENT ON COLUMN feedback.original_translation IS '系统原始翻译';
COMMENT ON COLUMN feedback.user_translation IS '用户修正后的翻译';
COMMENT ON COLUMN feedback.rating IS '评分: good-好评, bad-差评, neutral-中性';
COMMENT ON COLUMN feedback.correction_reason IS '修改原因说明';
COMMENT ON COLUMN feedback.used_for_training IS '是否已用于模型训练';

CREATE INDEX idx_feedback_user ON feedback(user_id);
CREATE INDEX idx_feedback_region ON feedback(region_id);
CREATE INDEX idx_feedback_rating ON feedback(rating);
CREATE INDEX idx_feedback_training ON feedback(used_for_training) WHERE used_for_training = FALSE;

-- -----------------------------------------------------------
-- 2.12 learning_progress（学习进度表）[NEW v2.0]
-- 社交化学习的艾宾浩斯复习进度
-- -----------------------------------------------------------
DROP TABLE IF EXISTS learning_progress CASCADE;
CREATE TABLE learning_progress (
    progress_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    vocab_id        UUID REFERENCES vocabularies(vocab_id) ON DELETE CASCADE,
    review_count    INTEGER NOT NULL DEFAULT 0,
    last_review_at  TIMESTAMPTZ,
    next_review_at  TIMESTAMPTZ,
    mastery_level   INTEGER NOT NULL DEFAULT 1 CHECK (mastery_level >= 1 AND mastery_level <= 5),
    streak_days     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE learning_progress IS '学习进度表 - 艾宾浩斯复习追踪 [NEW v2.0]';
COMMENT ON COLUMN learning_progress.review_count IS '复习总次数';
COMMENT ON COLUMN learning_progress.next_review_at IS '下次复习时间(艾宾浩斯算法)';
COMMENT ON COLUMN learning_progress.mastery_level IS '掌握程度: 1-初学, 2-了解, 3-熟悉, 4-掌握, 5-精通';
COMMENT ON COLUMN learning_progress.streak_days IS '连续学习天数';

CREATE INDEX idx_learning_progress_user ON learning_progress(user_id);
CREATE INDEX idx_learning_progress_vocab ON learning_progress(vocab_id);
CREATE INDEX idx_learning_progress_next_review ON learning_progress(next_review_at);
CREATE INDEX idx_learning_progress_mastery ON learning_progress(user_id, mastery_level);

-- -----------------------------------------------------------
-- 2.13 achievements（成就表）[NEW v2.0]
-- 学习成就与徽章系统
-- -----------------------------------------------------------
DROP TABLE IF EXISTS achievements CASCADE;
CREATE TABLE achievements (
    achievement_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(100) NOT NULL,
    description         TEXT,
    icon_url            VARCHAR(500),
    category            VARCHAR(30) NOT NULL CHECK (category IN ('translation','vocabulary','learning','streak','social')),
    required_value      INTEGER NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE achievements IS '成就定义表 - 学习成就与徽章 [NEW v2.0]';
COMMENT ON COLUMN achievements.category IS '分类: translation-翻译量, vocabulary-词汇量, learning-学习, streak-连续天数, social-社交';

CREATE INDEX idx_achievements_category ON achievements(category);

-- -----------------------------------------------------------
-- 2.14 user_achievements（用户成就关联表）[NEW v2.0]
-- -----------------------------------------------------------
DROP TABLE IF EXISTS user_achievements CASCADE;
CREATE TABLE user_achievements (
    user_achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    achievement_id      UUID NOT NULL REFERENCES achievements(achievement_id) ON DELETE CASCADE,
    progress            FLOAT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
    unlocked_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE (user_id, achievement_id)
);

COMMENT ON TABLE user_achievements IS '用户成就关联表 [NEW v2.0]';

CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);
CREATE INDEX idx_user_achievements_unlocked ON user_achievements(user_id, unlocked_at) WHERE unlocked_at IS NOT NULL;

-- -----------------------------------------------------------
-- 2.15 reading_progress（阅读进度表）[NEW v3.0]
-- 阅读器页面阅读进度追踪
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
    read_duration   INTEGER NOT NULL DEFAULT 0,
    is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
    last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reading_progress IS '阅读进度表 - 阅读器页面阅读进度追踪 [NEW v3.0]';
COMMENT ON COLUMN reading_progress.scroll_position IS '滚动位置(百分比 0-100)';
COMMENT ON COLUMN reading_progress.zoom_level IS '缩放级别(默认1.0)';
COMMENT ON COLUMN reading_progress.read_duration IS '阅读时长(秒)';
COMMENT ON COLUMN reading_progress.is_completed IS '是否已完成阅读';
COMMENT ON COLUMN reading_progress.last_read_at IS '最后阅读时间';

CREATE INDEX idx_reading_progress_user ON reading_progress(user_id);
CREATE INDEX idx_reading_progress_page ON reading_progress(page_id);
CREATE INDEX idx_reading_progress_chapter ON reading_progress(chapter_id);
CREATE INDEX idx_reading_progress_project ON reading_progress(project_id);
CREATE UNIQUE INDEX idx_reading_progress_user_page ON reading_progress(user_id, page_id);

-- ============================================================
-- 第三部分：已有表字段修复 (P0-8)
-- ============================================================

-- 3.0a operation_histories 表字段补齐：ORM用snapshot_before/snapshot_after/regions_snapshot/is_undone
-- 替代原有before_state/after_state；同时添加缺失字段description/undo_stack_position
ALTER TABLE operation_histories 
ADD COLUMN IF NOT EXISTS snapshot_before JSONB;

ALTER TABLE operation_histories 
ADD COLUMN IF NOT EXISTS snapshot_after JSONB;

ALTER TABLE operation_histories 
ADD COLUMN IF NOT EXISTS regions_snapshot JSONB;

ALTER TABLE operation_histories 
ADD COLUMN IF NOT EXISTS description VARCHAR(500);

ALTER TABLE operation_histories 
ADD COLUMN IF NOT EXISTS undo_stack_position INTEGER NOT NULL DEFAULT 0;

ALTER TABLE operation_histories 
ADD COLUMN IF NOT EXISTS is_undone BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN operation_histories.snapshot_before IS '操作前完整页面状态快照(JSON): {status, processed_url, text_regions}';
COMMENT ON COLUMN operation_histories.snapshot_after IS '操作后完整页面状态快照(JSON)';
COMMENT ON COLUMN operation_histories.regions_snapshot IS '文字区域完整状态快照(JSON): {region_id: {original_text, translated_text, boundary, type, ...}}';
COMMENT ON COLUMN operation_histories.description IS '操作的人类可读描述';
COMMENT ON COLUMN operation_histories.undo_stack_position IS '撤销栈位置(0=最新)';
COMMENT ON COLUMN operation_histories.is_undone IS '是否已被撤销(在重做栈中)';

-- 3.0b change_logs 表字段修复：ORM用extra_data，DDL用metadata
ALTER TABLE change_logs 
ADD COLUMN IF NOT EXISTS extra_data JSONB;

COMMENT ON COLUMN change_logs.extra_data IS '额外数据JSON(ORM字段名: extra_data)';

-- 3.0c translation_quality 表补充 updated_at
ALTER TABLE translation_quality 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3.0d feedback 表补充 updated_at
ALTER TABLE feedback 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3.0e snapshots 表补充 updated_at
ALTER TABLE snapshots 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3.0f api_keys 表补充 updated_at（已有，确认存在即可）

-- 3.0g achievements 表补充 updated_at
ALTER TABLE achievements 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3.0h user_achievements 表补充 updated_at
ALTER TABLE user_achievements 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ============================================================
-- 第四部分：搜索优化索引
-- ============================================================

-- 3.1 跨作品全文搜索索引 (使用 pg_trgm + tsvector)
ALTER TABLE text_regions ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION update_text_region_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('simple', COALESCE(NEW.original_text, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.translated_text, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_text_regions_search_vector ON text_regions;
CREATE TRIGGER trg_text_regions_search_vector
    BEFORE INSERT OR UPDATE OF original_text, translated_text ON text_regions
    FOR EACH ROW EXECUTE FUNCTION update_text_region_search_vector();

CREATE INDEX IF NOT EXISTS idx_text_regions_search ON text_regions USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_text_regions_original_trgm ON text_regions USING GIN (original_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_text_regions_translated_trgm ON text_regions USING GIN (translated_text gin_trgm_ops);

-- 3.2 为跨作品搜索创建物化视图
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_search_index AS
SELECT
    tr.region_id,
    tr.page_id,
    pg.page_id AS search_page_id,
    ch.chapter_id,
    prj.project_id,
    prj.user_id,
    prj.name AS project_name,
    ch.name AS chapter_name,
    pg.sort_order AS page_number,
    tr.original_text,
    tr.translated_text,
    tr.type AS region_type,
    tr.confidence,
    prj.source_lang,
    tr.search_vector
FROM text_regions tr
JOIN pages pg ON tr.page_id = pg.page_id
JOIN chapters ch ON pg.chapter_id = ch.chapter_id
JOIN projects prj ON ch.project_id = prj.project_id
WHERE prj.status = 'active';

CREATE INDEX IF NOT EXISTS idx_mv_search_search ON mv_search_index USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_mv_search_user ON mv_search_index(user_id);
CREATE INDEX IF NOT EXISTS idx_mv_search_project ON mv_search_index(project_id);

-- ============================================================
-- 第四部分：新增触发器
-- ============================================================

-- 4.1 characters 表 updated_at 触发器
DROP TRIGGER IF EXISTS trg_characters_updated_at ON characters;
CREATE TRIGGER trg_characters_updated_at
    BEFORE UPDATE ON characters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.2 fonts 表 updated_at 触发器
DROP TRIGGER IF EXISTS trg_fonts_updated_at ON fonts;
CREATE TRIGGER trg_fonts_updated_at
    BEFORE UPDATE ON fonts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.3 comments 表 updated_at 触发器
DROP TRIGGER IF EXISTS trg_comments_updated_at ON comments;
CREATE TRIGGER trg_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.4 collaboration_locks 触发器（用户新增页面操作时自动续期）
DROP TRIGGER IF EXISTS trg_collab_locks_updated_at ON collaboration_locks;
CREATE TRIGGER trg_collab_locks_updated_at
    BEFORE UPDATE ON collaboration_locks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 第五部分：新增函数/存储过程
-- ============================================================

-- 5.1 清理过期协作锁
CREATE OR REPLACE FUNCTION clean_expired_locks()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM collaboration_locks WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION clean_expired_locks() IS '清理过期协作锁(超过30分钟自动释放)';

-- 5.2 获取角色跨页语气一致性数据
CREATE OR REPLACE FUNCTION get_character_tone_consistency(
    p_character_id UUID,
    p_project_id UUID
)
RETURNS TABLE(
    total_regions BIGINT,
    tone_variance FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) AS total_regions,
        COALESCE(STDDEV(tr.confidence), 0) AS tone_variance
    FROM text_regions tr
    JOIN pages pg ON tr.page_id = pg.page_id
    JOIN chapters ch ON pg.chapter_id = ch.chapter_id
    WHERE ch.project_id = p_project_id
      AND tr.character_id = p_character_id
      AND tr.translated_text IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_character_tone_consistency IS '获取角色跨页语气一致性数据';

-- 5.3 跨作品全文搜索函数
CREATE OR REPLACE FUNCTION search_across_works(
    p_user_id UUID,
    p_query TEXT,
    p_project_id UUID DEFAULT NULL,
    p_language VARCHAR(10) DEFAULT NULL,
    p_region_type VARCHAR(20) DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    region_id UUID,
    page_id UUID,
    project_id UUID,
    project_name VARCHAR,
    chapter_name VARCHAR,
    page_number INTEGER,
    original_text TEXT,
    translated_text TEXT,
    region_type VARCHAR,
    confidence FLOAT,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        si.region_id,
        si.search_page_id AS page_id,
        si.project_id,
        si.project_name,
        si.chapter_name,
        si.page_number,
        si.original_text,
        si.translated_text,
        si.region_type,
        si.confidence,
        ts_rank(si.search_vector, query) AS rank
    FROM mv_search_index si,
         plainto_tsquery('simple', p_query) AS query
    WHERE si.user_id = p_user_id
      AND si.search_vector @@ query
      AND (p_project_id IS NULL OR si.project_id = p_project_id)
      AND (p_language IS NULL OR si.source_lang = p_language)
      AND (p_region_type IS NULL OR si.region_type = p_region_type)
    ORDER BY rank DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_across_works IS '跨作品全文搜索 - 支持高级筛选(作品/语言/区域类型)';

-- 5.4 获取用户每日使用配额
CREATE OR REPLACE FUNCTION get_user_daily_quota(p_user_id UUID)
RETURNS TABLE(
    daily_pages_used BIGINT,
    daily_pages_limit INTEGER,
    total_projects BIGINT,
    projects_limit INTEGER,
    plan_type VARCHAR
) AS $$
DECLARE
    v_plan_type VARCHAR;
    v_daily_limit INTEGER;
    v_projects_limit INTEGER;
BEGIN
    SELECT u.plan_type INTO v_plan_type FROM users u WHERE u.user_id = p_user_id;
    
    v_daily_limit := CASE WHEN v_plan_type = 'premium' THEN 999999 ELSE 10 END;
    v_projects_limit := CASE WHEN v_plan_type = 'premium' THEN 999999 ELSE 10 END;
    
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM pages pg
         JOIN chapters ch ON pg.chapter_id = ch.chapter_id
         JOIN projects pr ON ch.project_id = pr.project_id
         WHERE pr.user_id = p_user_id
           AND pg.created_at::date = CURRENT_DATE) AS daily_pages_used,
        v_daily_limit AS daily_pages_limit,
        (SELECT COUNT(*) FROM projects WHERE user_id = p_user_id AND status = 'active') AS total_projects,
        v_projects_limit AS projects_limit,
        v_plan_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_daily_quota IS '获取用户每日使用配额(免费版/高级版)';

-- 5.5 擦除质量评分函数
CREATE OR REPLACE FUNCTION evaluate_erase_quality(
    p_page_id UUID,
    p_ssim_score FLOAT
)
RETURNS VOID AS $$
BEGIN
    UPDATE pages 
    SET erase_quality_score = ROUND(p_ssim_score * 100),
        status = CASE 
            WHEN p_ssim_score < 0.60 THEN 'needs_repair' 
            ELSE status 
        END,
        updated_at = NOW()
    WHERE page_id = p_page_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION evaluate_erase_quality IS '评估擦除质量并更新页面状态';

-- ============================================================
-- 第六部分：新增视图
-- ============================================================

-- 6.1 用户学习概览视图
CREATE OR REPLACE VIEW v_user_learning AS
SELECT
    u.user_id,
    u.nickname,
    COUNT(DISTINCT v.vocab_id) AS total_vocab,
    COUNT(DISTINCT v.vocab_id) FILTER (WHERE lp.mastery_level >= 4) AS mastered_count,
    COUNT(DISTINCT v.vocab_id) FILTER (WHERE lp.next_review_at <= NOW()) AS due_review_count,
    COALESCE(MAX(lp.streak_days), 0) AS max_streak,
    COUNT(DISTINCT ua.achievement_id) FILTER (WHERE ua.unlocked_at IS NOT NULL) AS achievements_count
FROM users u
LEFT JOIN vocabularies v ON v.user_id = u.user_id
LEFT JOIN learning_progress lp ON lp.vocab_id = v.vocab_id AND lp.user_id = u.user_id
LEFT JOIN user_achievements ua ON ua.user_id = u.user_id
GROUP BY u.user_id, u.nickname;

COMMENT ON VIEW v_user_learning IS '用户学习概览视图 - 词汇量/掌握度/成就统计';

-- 6.2 翻译质量汇总视图
CREATE OR REPLACE VIEW v_translation_quality_summary AS
SELECT
    prj.project_id,
    prj.name AS project_name,
    ch.chapter_id,
    ch.name AS chapter_name,
    COUNT(tq.quality_id) AS assessed_pages,
    ROUND(AVG(tq.bleu_score)::numeric, 3) AS avg_bleu,
    ROUND(AVG(tq.meteor_score)::numeric, 3) AS avg_meteor,
    ROUND(AVG(tq.overall_score)::numeric, 3) AS avg_overall,
    ROUND(AVG(tq.tone_consistency)::numeric, 3) AS avg_tone_consistency,
    ROUND(AVG(tq.term_consistency)::numeric, 3) AS avg_term_consistency
FROM translation_quality tq
JOIN pages pg ON tq.page_id = pg.page_id
JOIN chapters ch ON pg.chapter_id = ch.chapter_id
JOIN projects prj ON ch.project_id = prj.project_id
GROUP BY prj.project_id, prj.name, ch.chapter_id, ch.name;

COMMENT ON VIEW v_translation_quality_summary IS '翻译质量汇总视图 - 按章节聚合评分';

-- ============================================================
-- 第六部分补充：支付订单表（PRD §7.3 商业化）
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_orders (
    order_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    out_trade_no    VARCHAR(64) NOT NULL UNIQUE,
    user_id         UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    plan_type       VARCHAR(20) NOT NULL DEFAULT 'premium',
    months          INTEGER NOT NULL DEFAULT 1 CHECK (months >= 1 AND months <= 36),
    amount          NUMERIC(10,2) NOT NULL,
    currency        VARCHAR(8) NOT NULL DEFAULT 'CNY',
    provider        VARCHAR(20) NOT NULL DEFAULT 'sandbox',
    status          VARCHAR(20) NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created','paid','cancelled','failed')),
    trade_no        VARCHAR(64),
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

COMMENT ON TABLE payment_orders IS '订阅支付订单：权益仅在网关回调验签通过后授予 [v3.0]';
COMMENT ON COLUMN payment_orders.out_trade_no IS '商户订单号（对账用，唯一）';
COMMENT ON COLUMN payment_orders.status IS 'created-待支付, paid-已支付, cancelled-已取消, failed-失败';


-- ============================================================
-- 第七部分：种子数据 - 系统预设
-- ============================================================
-- 7.1 内置8套字体预设
INSERT INTO fonts (user_id, name, file_url, category, style_tags, license, language_tags, is_active) VALUES
(NULL, '系统默认对话字体', 'system://default-dialogue', 'dialogue', '["通用","标准","可读"]', 'free_commercial', '["ja","zh","en","ko"]', TRUE),
(NULL, '热血漫风格字体', 'system://hotblood-dialogue', 'dialogue', '["热血","粗体","力量"]', 'free_commercial', '["ja","zh"]', TRUE),
(NULL, '少女漫风格字体', 'system://shojo-dialogue', 'dialogue', '["温馨","圆体","柔和"]', 'free_commercial', '["ja","zh"]', TRUE),
(NULL, '旁白标准字体', 'system://narration-standard', 'narration', '["标准","可读","正式"]', 'free_commercial', '["ja","zh","en","ko"]', TRUE),
(NULL, '拟声词特效字体', 'system://onomatopoeia-effect', 'onomatopoeia', '["特效","粗体","冲击"]', 'free_commercial', '["ja","zh","en","ko"]', TRUE),
(NULL, '标题大字字体', 'system://title-large', 'title', '["大号","醒目","标题"]', 'free_commercial', '["ja","zh","en","ko"]', TRUE),
(NULL, '手写风格字体', 'system://handwriting', 'dialogue', '["手写","自然","亲切"]', 'free_commercial', '["ja","zh"]', TRUE),
(NULL, '恐怖漫氛围字体', 'system://horror-dialogue', 'dialogue', '["恐怖","尖锐","紧张"]', 'free_commercial', '["ja","zh"]', TRUE)
ON CONFLICT DO NOTHING;

-- 7.2 预设8种TTS音色
INSERT INTO voices (voice_id, name, gender, age_group, tone_description, language, is_system) VALUES
('sys-male-hotblood', '热血男主音', 'male', 'young_adult', '充满激情和力量的热血少年', 'ja', TRUE),
('sys-male-calm', '沉稳男声', 'male', 'adult', '低沉稳重的成熟男性', 'ja', TRUE),
('sys-female-tsundere', '傲娇女声', 'female', 'teen', '略带傲气的少女音', 'ja', TRUE),
('sys-female-loli', '萝莉女声', 'female', 'child', '甜美可爱的幼女音', 'ja', TRUE),
('sys-female-mature', '御姐女声', 'female', 'adult', '成熟优雅的女性声音', 'ja', TRUE),
('sys-male-boy', '正太男声', 'male', 'child', '活泼可爱的少年音', 'ja', TRUE),
('sys-male-elder', '老者男声', 'male', 'elder', '沧桑智慧的老者声音', 'ja', TRUE),
('sys-neutral-narrator', '旁白音', 'neutral', 'adult', '标准中性的旁白朗读', 'ja', TRUE)
ON CONFLICT (voice_id) DO NOTHING;

-- 7.3 预设成就定义
INSERT INTO achievements (achievement_id, name, description, category, required_value) VALUES
(gen_random_uuid(), '初出茅庐', '完成第一次翻译', 'translation', 1),
(gen_random_uuid(), '翻译达人', '累计翻译100页', 'translation', 100),
(gen_random_uuid(), '翻译大师', '累计翻译1000页', 'translation', 1000),
(gen_random_uuid(), '词汇收集家', '收藏50个生词', 'vocabulary', 50),
(gen_random_uuid(), '词汇达人', '收藏500个生词', 'vocabulary', 500),
(gen_random_uuid(), '学习新星', '连续学习7天', 'streak', 7),
(gen_random_uuid(), '学霸', '连续学习30天', 'streak', 30),
(gen_random_uuid(), '学习狂人', '连续学习100天', 'streak', 100),
(gen_random_uuid(), '知识分享者', '贡献10个术语到公开词典', 'social', 10),
(gen_random_uuid(), '社群贡献者', '贡献100个术语到公开词典', 'social', 100)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 输出确认信息
-- ============================================================
DO $$
DECLARE
    table_count INTEGER;
    new_tables INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ v3.0 数据库迁移完成';
    RAISE NOTICE '   总业务表: % 张', table_count;
    RAISE NOTICE '   新增表: fonts, characters, voices, api_keys, project_members, collaboration_locks, comments, change_logs, snapshots, translation_quality, feedback, learning_progress, achievements, user_achievements, reading_progress (15张)';
    RAISE NOTICE '   修改表: pages(erase_quality_score+status), text_regions(boundary_mode+character_id+search_vector), export_tasks(format+mp4)';
    RAISE NOTICE '   字段修复: operation_histories(snapshot_before/snapshot_after/regions_snapshot/description/undo_stack_position/is_undone), change_logs(extra_data), translation_quality/feedback/snapshots/achievements/user_achievements(updated_at)';
    RAISE NOTICE '   新增视图: v_user_learning, v_translation_quality_summary (2个)';
    RAISE NOTICE '   新增物化视图: mv_search_index (1个)';
    RAISE NOTICE '   新增函数: clean_expired_locks, get_character_tone_consistency, search_across_works, get_user_daily_quota, evaluate_erase_quality (5个)';
    RAISE NOTICE '   种子数据: 8套字体 + 8种TTS音色 + 10个成就定义';
    RAISE NOTICE '========================================';
END $$;
