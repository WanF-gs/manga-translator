-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- 基础数据导入脚本 v1.0 (字典表 + 配置表 + 系统参数)
-- 创建时间: 2025-07-11
-- DBA: 资深数据库管理员
-- ============================================================

-- ⚠️ 执行前提: 已完成 DDL 建表
-- 回滚方案: 执行脚本底部的 DELETE 语句

\c manga_translator;

-- ============================================================
-- 第一部分：系统内置样式预设
-- ============================================================

-- 系统内置 5 套专业漫画字体样式包
-- scope = 'system', user_id = NULL

INSERT INTO style_presets (preset_id, user_id, project_id, name, category, style_config, scope) VALUES
-- 预设1：漫画对话体（默认）
('00000000-0000-0000-0000-000000000001', NULL, NULL,
 '漫画对话体（默认）', 'speech',
 '{"font_family":"Noto Sans SC","font_size":14,"color":"#000000","stroke_width":1,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":0,"line_height":1.5}',
 'system'),

-- 预设2：热血喊叫体
('00000000-0000-0000-0000-000000000002', NULL, NULL,
 '热血喊叫体', 'speech',
 '{"font_family":"Noto Sans SC Bold","font_size":18,"color":"#CC0000","stroke_width":2,"stroke_color":"#FFD700","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":2,"line_height":1.3}',
 'system'),

-- 预设3：内心独白体
('00000000-0000-0000-0000-000000000003', NULL, NULL,
 '内心独白体', 'thought',
 '{"font_family":"Noto Serif SC","font_size":12,"color":"#555555","stroke_width":0,"stroke_color":"#FFFFFF","opacity":0.9,"text_align":"left","vertical":false,"letter_spacing":0,"line_height":1.6}',
 'system'),

-- 预设4：旁白叙述体
('00000000-0000-0000-0000-000000000004', NULL, NULL,
 '旁白叙述体', 'narration',
 '{"font_family":"Noto Serif SC","font_size":13,"color":"#333333","stroke_width":0,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"left","vertical":true,"letter_spacing":0,"line_height":1.8}',
 'system'),

-- 预设5：拟声词特效体
('00000000-0000-0000-0000-000000000005', NULL, NULL,
 '拟声词特效体', 'onomatopoeia',
 '{"font_family":"Noto Sans SC Black","font_size":22,"color":"#FF6600","stroke_width":3,"stroke_color":"#000000","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":3,"line_height":1.2}',
 'system'),

-- 预设6：萌系可爱体
('00000000-0000-0000-0000-000000000006', NULL, NULL,
 '萌系可爱体', 'speech',
 '{"font_family":"Noto Sans SC Light","font_size":13,"color":"#FF69B4","stroke_width":1,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":1,"line_height":1.4}',
 'system'),

-- 预设7：日文竖排对话体
('00000000-0000-0000-0000-000000000007', NULL, NULL,
 '日文竖排对话体', 'speech',
 '{"font_family":"Noto Sans JP","font_size":14,"color":"#000000","stroke_width":1,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":true,"letter_spacing":0,"line_height":1.5}',
 'system'),

-- 预设8：英文对话体
('00000000-0000-0000-0000-000000000008', NULL, NULL,
 '英文对话体', 'speech',
 '{"font_family":"Inter","font_size":13,"color":"#000000","stroke_width":1,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":0,"line_height":1.4}',
 'system');

-- ============================================================
-- 第二部分：系统配置参数
-- ============================================================

-- 创建一个系统配置表（运行时配置）
CREATE TABLE IF NOT EXISTS system_config (
    config_key      VARCHAR(100) PRIMARY KEY,
    config_value    TEXT NOT NULL,
    config_type     VARCHAR(20) NOT NULL DEFAULT 'string'
                    CHECK (config_type IN ('string','integer','boolean','float','json')),
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE system_config IS '系统配置表 - 运行时动态配置参数';

-- 插入默认系统配置
INSERT INTO system_config (config_key, config_value, config_type, description) VALUES
-- 文件上传限制
('upload.image_max_size_mb', '50', 'integer', '单张图片最大上传大小(MB)'),
('upload.archive_max_size_mb', '500', 'integer', '压缩包最大上传大小(MB)'),
('upload.font_max_size_mb', '20', 'integer', '字体文件最大上传大小(MB)'),
('upload.max_batch_count_free', '50', 'integer', '免费版单批次最大页数'),
('upload.max_batch_count_premium', '200', 'integer', '高级版单批次最大页数'),
('upload.chunk_size_mb', '5', 'integer', '分片上传每片大小(MB)'),
('upload.chunk_threshold_mb', '10', 'integer', '触发分片上传的文件大小阈值(MB)'),

-- 处理超时配置
('process.ocr_timeout_seconds', '3', 'integer', 'OCR单区域识别超时(秒)'),
('process.translate_timeout_seconds', '2', 'integer', '基础翻译单句超时(秒)'),
('process.inpaint_timeout_seconds', '15', 'integer', '背景修复单区域超时(秒)'),
('process.super_resolution_timeout_seconds', '30', 'integer', '超分辨率单页超时(秒)'),
('process.retry_max_count', '1', 'integer', '失败自动重试次数'),
('process.retry_delay_seconds', '5', 'integer', '重试间隔(秒)'),

-- 翻译配置
('translate.confidence_threshold', '0.6', 'float', '低置信度提醒阈值'),
('translate.similarity_threshold', '0.9', 'float', '翻译记忆相似度匹配阈值'),
('translate.default_engine', 'basic', 'string', '默认翻译引擎(basic/multimodal)'),
('translate.font_min_scale_ratio', '0.7', 'float', '文字溢出时最小字号比例'),

-- 存储清理
('storage.temp_file_retention_days', '7', 'integer', '临时处理文件保留天数'),
('storage.trash_retention_days', '30', 'integer', '回收站保留天数'),
('storage.session_expire_days', '7', 'integer', 'Refresh Token过期天数'),

-- 业务限制
('business.free_project_limit', '10', 'integer', '免费版最大作品数'),
('business.undo_max_steps', '20', 'integer', '最大撤销步数'),
('business.bubble_padding_px', '2', 'integer', '气泡边框与文字区域最小边距(px)'),

-- 内容安全
('security.content_check_enabled', 'true', 'boolean', '是否启用内容安全检测'),
('security.content_check_max_false_positive', '0.05', 'float', '内容安全最大误拦截率'),

-- 通知配置
('notification.email_enabled', 'true', 'boolean', '是否启用邮件通知'),
('notification.push_enabled', 'true', 'boolean', '是否启用浏览器推送');

-- ============================================================
-- 第三部分：语言代码字典
-- ============================================================

CREATE TABLE IF NOT EXISTS language_codes (
    lang_code       VARCHAR(10) PRIMARY KEY,
    lang_name_zh    VARCHAR(50) NOT NULL,
    lang_name_en    VARCHAR(50) NOT NULL,
    lang_name_native VARCHAR(50) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE language_codes IS '语言代码字典表 - 系统支持的语言列表';

INSERT INTO language_codes (lang_code, lang_name_zh, lang_name_en, lang_name_native, sort_order) VALUES
('ja', '日语', 'Japanese', '日本語', 1),
('zh-CN', '简体中文', 'Simplified Chinese', '简体中文', 2),
('zh-TW', '繁体中文', 'Traditional Chinese', '繁體中文', 3),
('en', '英语', 'English', 'English', 4),
('ko', '韩语', 'Korean', '한국어', 5);

-- ============================================================
-- 第四部分：文字区域类型字典
-- ============================================================

CREATE TABLE IF NOT EXISTS region_types (
    type_code       VARCHAR(20) PRIMARY KEY,
    type_name_zh    VARCHAR(50) NOT NULL,
    type_name_en    VARCHAR(50) NOT NULL,
    color_code      VARCHAR(7) NOT NULL,       -- 选区标注颜色
    sort_order      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE region_types IS '文字区域类型字典表 - 5种文字区域类型';

INSERT INTO region_types (type_code, type_name_zh, type_name_en, color_code, sort_order) VALUES
('speech', '对话气泡', 'Speech Bubble', '#4CAF50', 1),
('thought', '内心独白', 'Thought Bubble', '#2196F3', 2),
('narration', '旁白框', 'Narration Box', '#FF9800', 3),
('onomatopoeia', '拟声词', 'Onomatopoeia', '#E91E63', 4),
('effect', '效果字', 'Effect Text', '#9C27B0', 5);

-- ============================================================
-- 第五部分：页面状态字典
-- ============================================================

CREATE TABLE IF NOT EXISTS page_statuses (
    status_code     VARCHAR(20) PRIMARY KEY,
    status_name_zh  VARCHAR(50) NOT NULL,
    status_name_en  VARCHAR(50) NOT NULL,
    color_code      VARCHAR(7) NOT NULL,       -- 状态颜色编码
    sort_order      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE page_statuses IS '页面状态字典表 - 4种处理状态';

INSERT INTO page_statuses (status_code, status_name_zh, status_name_en, color_code, sort_order) VALUES
('pending', '待处理', 'Pending', '#9E9E9E', 1),        -- 灰
('translating', '翻译中', 'Translating', '#2196F3', 2), -- 蓝
('reviewed', '已校对', 'Reviewed', '#FFC107', 3),       -- 黄
('completed', '已完成', 'Completed', '#4CAF50', 4);      -- 绿

-- ============================================================
-- 第六部分：导出格式字典
-- ============================================================

CREATE TABLE IF NOT EXISTS export_formats (
    format_code     VARCHAR(10) PRIMARY KEY,
    format_name     VARCHAR(50) NOT NULL,
    mime_type       VARCHAR(50) NOT NULL,
    extension       VARCHAR(10) NOT NULL,
    supports_quality BOOLEAN NOT NULL DEFAULT TRUE,
    supports_bilingual BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE export_formats IS '导出格式字典表';

INSERT INTO export_formats (format_code, format_name, mime_type, extension, supports_quality, supports_bilingual, sort_order) VALUES
('jpg', 'JPEG 图像', 'image/jpeg', '.jpg', TRUE, FALSE, 1),
('png', 'PNG 图像（无损）', 'image/png', '.png', FALSE, FALSE, 2),
('webp', 'WebP 图像', 'image/webp', '.webp', TRUE, FALSE, 3),
('cbz', 'CBZ 漫画包', 'application/x-cbz', '.cbz', TRUE, TRUE, 4),
('pdf', 'PDF 文档', 'application/pdf', '.pdf', TRUE, TRUE, 5);

-- ============================================================
-- 第七部分：通知类型字典
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_types (
    type_code       VARCHAR(30) PRIMARY KEY,
    type_name_zh    VARCHAR(50) NOT NULL,
    default_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE notification_types IS '通知类型字典表';

INSERT INTO notification_types (type_code, type_name_zh, default_enabled, sort_order) VALUES
('export_complete', '导出完成通知', TRUE, 1),
('task_complete', '任务完成通知', TRUE, 2),
('system', '系统通知', TRUE, 3),
('promotion', '推广通知', FALSE, 4);

-- ============================================================
-- 第八部分：拟声词处理模式字典
-- ============================================================

CREATE TABLE IF NOT EXISTS onomatopoeia_modes (
    mode_code       VARCHAR(20) PRIMARY KEY,
    mode_name_zh    VARCHAR(50) NOT NULL,
    mode_desc       TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE onomatopoeia_modes IS '拟声词处理模式字典表';

INSERT INTO onomatopoeia_modes (mode_code, mode_name_zh, mode_desc, sort_order) VALUES
('keep_annotation', '保留+译注', '保留原文拟声词，旁附小字译注', 1),
('replace', '替换', '替换为目标语言等效拟声词', 2),
('bilingual_overlay', '双语叠加', '原文保留，译文叠加显示', 3);

-- ============================================================
-- 第九部分：文化梗处理策略字典
-- ============================================================

CREATE TABLE IF NOT EXISTS culture_strategies (
    strategy_code   VARCHAR(20) PRIMARY KEY,
    strategy_name_zh VARCHAR(50) NOT NULL,
    strategy_desc   TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE culture_strategies IS '文化梗处理策略字典表';

INSERT INTO culture_strategies (strategy_code, strategy_name_zh, strategy_desc, sort_order) VALUES
('localize', '本地化替换', '替换为目标语言文化等效表达', 1),
('footnote', '页脚注释', '在页面底部添加注释说明', 2),
('hover_note', '悬浮注释', '阅读器中点击弹出注释', 3);

-- ============================================================
-- 第十部分：默认用户偏好设置模板
-- ============================================================

CREATE TABLE IF NOT EXISTS default_user_settings (
    setting_key     VARCHAR(50) PRIMARY KEY,
    setting_value   JSONB NOT NULL,
    description     TEXT
);

COMMENT ON TABLE default_user_settings IS '默认用户偏好设置模板表';

INSERT INTO default_user_settings (setting_key, setting_value, description) VALUES
('translation', '{"default_engine":"basic","default_target_lang":"zh-CN","style":"simplified"}',
 '翻译默认设置'),
('export', '{"default_format":"png","default_quality":90,"default_resolution":"original"}',
 '导出默认设置'),
('display', '{"theme":"dark","font_size":"medium","night_mode":false}',
 '显示默认设置'),
('preprocessing', '{"auto_rotate":true,"auto_crop":true,"dedup_check":true,"exposure_correct":true}',
 '预处理默认设置'),
('notification', '{"export_complete":true,"task_complete":true,"system":true,"promotion":false}',
 '通知默认设置');

-- ============================================================
-- 输出确认信息
-- ============================================================
DO $$
DECLARE
    preset_count INTEGER;
    config_count INTEGER;
    lang_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO preset_count FROM style_presets WHERE scope = 'system';
    SELECT COUNT(*) INTO config_count FROM system_config;
    SELECT COUNT(*) INTO lang_count FROM language_codes;

    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 基础数据导入完成';
    RAISE NOTICE '   - 系统样式预设: % 套', preset_count;
    RAISE NOTICE '   - 系统配置参数: % 项', config_count;
    RAISE NOTICE '   - 支持语言: % 种', lang_count;
    RAISE NOTICE '   - 区域类型: 5 种';
    RAISE NOTICE '   - 页面状态: 4 种';
    RAISE NOTICE '   - 导出格式: 5 种';
    RAISE NOTICE '   - 通知类型: 4 种';
    RAISE NOTICE '   - 拟声词模式: 3 种';
    RAISE NOTICE '   - 文化梗策略: 3 种';
    RAISE NOTICE '========================================';
END $$;

-- ============================================================
-- 回滚脚本（取消注释执行）
-- ============================================================
/*
DELETE FROM style_presets WHERE scope = 'system';
DELETE FROM system_config;
DELETE FROM language_codes;
DELETE FROM region_types;
DELETE FROM page_statuses;
DELETE FROM export_formats;
DELETE FROM notification_types;
DELETE FROM onomatopoeia_modes;
DELETE FROM culture_strategies;
DELETE FROM default_user_settings;
*/
