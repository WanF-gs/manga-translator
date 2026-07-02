-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- 测试数据生成脚本 v1.0
-- 创建时间: 2025-07-11
-- DBA: 资深数据库管理员
-- ============================================================

-- ⚠️ 执行前提: 已完成 DDL 建表 + 基础数据导入
-- ⚠️ 此脚本生成仿真测试数据，包含正常/边界/异常场景
-- 回滚方案: 执行脚本底部的 DELETE 语句

\c manga_translator;

-- ============================================================
-- 测试场景说明
-- ============================================================
-- 1. 正常数据：2个用户，各创建作品-章节-页面，模拟真实翻译流程
-- 2. 边界数据：极值字段、空值可选字段、超长字符串
-- 3. 异常数据：已删除作品（回收站）、过期会话、失败导出任务
-- 4. 数据量：满足基础性能测试需求（约100+条记录）

-- ============================================================
-- 第一部分：测试用户数据
-- ============================================================

-- 用户1：免费版普通用户
INSERT INTO users (user_id, email, phone, password_hash, nickname, avatar_url, plan_type, settings) VALUES
('11111111-1111-1111-1111-111111111111',
 'testuser1@manga-translator.com', NULL,
 '$2a$12$LJ3m4ys3Lk0TSwHCpNqrCO8YQqPmN5FkR2E3bXVkMwP8tZwOUrXHe', -- bcrypt hash of "Test@12345"
 '漫画爱好者小明', NULL, 'free',
 '{"translation":{"default_engine":"basic","default_target_lang":"zh-CN","style":"simplified"},"export":{"default_format":"png","default_quality":90,"default_resolution":"original"},"display":{"theme":"dark","font_size":"medium","night_mode":false}}');

-- 用户2：高级版用户
INSERT INTO users (user_id, email, phone, password_hash, nickname, avatar_url, plan_type, premium_expires, settings) VALUES
('11111111-1111-1111-1111-111111111112',
 'testuser2@manga-translator.com', NULL,
 '$2a$12$LJ3m4ys3Lk0TSwHCpNqrCO8YQqPmN5FkR2E3bXVkMwP8tZwOUrXHe', -- bcrypt hash of "Test@12345"
 '专业汉化组小李', NULL, 'premium', '2026-12-31 23:59:59+08',
 '{"translation":{"default_engine":"multimodal","default_target_lang":"zh-CN","style":"simplified"},"export":{"default_format":"png","default_quality":100,"default_resolution":"4k"},"display":{"theme":"dark","font_size":"large","night_mode":true}}');

-- 用户3：边界测试用户（邮箱超长、昵称边界值）
INSERT INTO users (user_id, email, phone, password_hash, nickname, plan_type, settings) VALUES
('11111111-1111-1111-1111-111111111113',
 'a-very-long-email-address-for-boundary-testing-12345678901234567890@manga-translator-test.com', NULL,
 '$2a$12$LJ3m4ys3Lk0TSwHCpNqrCO8YQqPmN5FkR2E3bXVkMwP8tZwOUrXHe',
 '边', 'free', '{}'); -- 昵称最短边界（1字符）

-- ============================================================
-- 第二部分：测试作品数据
-- ============================================================

-- 用户1的作品
INSERT INTO projects (project_id, user_id, name, source_lang, is_favorite, status) VALUES
-- 正常作品1：日漫翻译（收藏）
('22222222-1111-1111-1111-111111111111',
 '11111111-1111-1111-1111-111111111111',
 '海贼王 第1088话', 'ja', TRUE, 'active'),
-- 正常作品2：韩漫翻译
('22222222-1111-1111-1111-111111111112',
 '11111111-1111-1111-1111-111111111111',
 '我独自升级 第15话', 'ko', FALSE, 'active'),
-- 正常作品3：英漫翻译
('22222222-1111-1111-1111-111111111113',
 '11111111-1111-1111-1111-111111111111',
 'Solo Leveling Ch.15', 'en', FALSE, 'active'),
-- 回收站作品（异常数据）
('22222222-1111-1111-1111-111111111114',
 '11111111-1111-1111-1111-111111111111',
 '已删除的测试作品', 'ja', FALSE, 'trashed',
 NOW() - INTERVAL '5 days'), -- 5天前删除，仍在30天恢复期内

-- 用户2的作品
-- 正常作品4：日漫翻译（高级版用户）
('22222222-1111-1111-1111-111111111115',
 '11111111-1111-1111-1111-111111111112',
 '咒术回战 第235话', 'ja', TRUE, 'active'),
-- 正常作品5：国漫翻译
('22222222-1111-1111-1111-111111111116',
 '11111111-1111-1111-1111-111111111112',
 '一人之下 第500话', 'zh', FALSE, 'active');

-- 用户3的作品（边界数据：作品名最长）
INSERT INTO projects (project_id, user_id, name, source_lang, is_favorite, status) VALUES
('22222222-1111-1111-1111-111111111117',
 '11111111-1111-1111-1111-111111111113',
 '这是一个超长作品名称用于测试字段边界值限制这是一个超长作品名称用于测试字段边界值限制这是一个超长作品名称用于测试字段边界值限制这是一个超长作品名称用于测试字段边界值限制结束', 'ja', FALSE, 'active');

-- ============================================================
-- 第三部分：测试章节数据
-- ============================================================

-- 作品1（海贼王）的章节
INSERT INTO chapters (chapter_id, project_id, name, sort_order) VALUES
('33333333-1111-1111-1111-111111111111', '22222222-1111-1111-1111-111111111111', '第1088话 最后一课', 1);

-- 作品2（我独自升级）的章节
INSERT INTO chapters (chapter_id, project_id, name, sort_order) VALUES
('33333333-1111-1111-1111-111111111112', '22222222-1111-1111-1111-111111111112', '第15话 觉醒', 1);

-- 作品3（Solo Leveling）的章节
INSERT INTO chapters (chapter_id, project_id, name, sort_order) VALUES
('33333333-1111-1111-1111-111111111113', '22222222-1111-1111-1111-111111111113', 'Chapter 15 Awakening', 1);

-- 作品5（咒术回战）的章节（多个章节）
INSERT INTO chapters (chapter_id, project_id, name, sort_order) VALUES
('33333333-1111-1111-1111-111111111115', '22222222-1111-1111-1111-111111111115', '第235话 向南', 1),
('33333333-1111-1111-1111-111111111116', '22222222-1111-1111-1111-111111111115', '第236话 向北', 2);

-- 作品6（一人之下）的章节
INSERT INTO chapters (chapter_id, project_id, name, sort_order) VALUES
('33333333-1111-1111-1111-111111111117', '22222222-1111-1111-1111-111111111116', '第500话 决战', 1);

-- 边界测试章节（名称最长）
INSERT INTO chapters (chapter_id, project_id, name, sort_order) VALUES
('33333333-1111-1111-1111-111111111118', '22222222-1111-1111-1111-111111111117', '超长章节名称测试超长章节名称测试超长章节名称测试超长章节名称测试超长章节名称测试超长章节名称测试超长章节名称测试超长章节名称测试超长章节名称测试超长章节名称测试结束', 1);

-- ============================================================
-- 第四部分：测试页面数据
-- ============================================================

-- 4.1 海贼王第1088话 - 3个页面（模拟完整翻译流程）
INSERT INTO pages (page_id, chapter_id, original_url, processed_url, thumbnail_url, sort_order, status, width, height, file_size,
                   ocr_result, translation_result) VALUES
-- 页面1：已完成
('44444444-1111-1111-1111-111111111111',
 '33333333-1111-1111-1111-111111111111',
 '/storage/original/proj-001/chap-001/page-001.jpg',
 '/storage/processed/proj-001/chap-001/page-001.png',
 '/storage/thumbnails/proj-001/chap-001/page-001.jpg',
 1, 'completed', 800, 1200, 524288,
 '{"regions_count":5,"avg_confidence":0.92,"languages_detected":["ja"]}',
 '{"translated_regions":5,"engine_used":"basic","processing_time_ms":35000}'),
-- 页面2：已校对
('44444444-1111-1111-1111-111111111112',
 '33333333-1111-1111-1111-111111111111',
 '/storage/original/proj-001/chap-001/page-002.jpg',
 NULL,
 '/storage/thumbnails/proj-001/chap-001/page-002.jpg',
 2, 'reviewed', 800, 1200, 489201,
 '{"regions_count":6,"avg_confidence":0.88,"languages_detected":["ja"]}',
 '{"translated_regions":6,"engine_used":"basic","processing_time_ms":42000}'),
-- 页面3：翻译中
('44444444-1111-1111-1111-111111111113',
 '33333333-1111-1111-1111-111111111111',
 '/storage/original/proj-001/chap-001/page-003.jpg',
 NULL,
 '/storage/thumbnails/proj-001/chap-001/page-003.jpg',
 3, 'translating', 800, 1200, 512000,
 NULL, NULL);

-- 4.2 我独自升级第15话 - 2个页面
INSERT INTO pages (page_id, chapter_id, original_url, thumbnail_url, sort_order, status, width, height, file_size) VALUES
('44444444-1111-1111-1111-111111111114',
 '33333333-1111-1111-1111-111111111112',
 '/storage/original/proj-002/chap-001/page-001.jpg',
 '/storage/thumbnails/proj-002/chap-001/page-001.jpg',
 1, 'pending', 760, 1080, 385000),
('44444444-1111-1111-1111-111111111115',
 '33333333-1111-1111-1111-111111111112',
 '/storage/original/proj-002/chap-001/page-002.jpg',
 '/storage/thumbnails/proj-002/chap-001/page-002.jpg',
 2, 'pending', 760, 1080, 392000);

-- 4.3 Solo Leveling Ch.15 - 1个页面
INSERT INTO pages (page_id, chapter_id, original_url, thumbnail_url, sort_order, status, width, height, file_size) VALUES
('44444444-1111-1111-1111-111111111116',
 '33333333-1111-1111-1111-111111111113',
 '/storage/original/proj-003/chap-001/page-001.jpg',
 '/storage/thumbnails/proj-003/chap-001/page-001.jpg',
 1, 'pending', 900, 1350, 420000);

-- 4.4 咒术回战第235话 - 5个页面（混合状态）
INSERT INTO pages (page_id, chapter_id, original_url, processed_url, thumbnail_url, sort_order, status, width, height, file_size) VALUES
('44444444-1111-1111-1111-111111111117',
 '33333333-1111-1111-1111-111111111115',
 '/storage/original/proj-005/chap-001/page-001.jpg',
 '/storage/processed/proj-005/chap-001/page-001.png',
 '/storage/thumbnails/proj-005/chap-001/page-001.jpg',
 1, 'completed', 820, 1180, 530000),
('44444444-1111-1111-1111-111111111118',
 '33333333-1111-1111-1111-111111111115',
 '/storage/original/proj-005/chap-001/page-002.jpg',
 NULL,
 '/storage/thumbnails/proj-005/chap-001/page-002.jpg',
 2, 'reviewed', 820, 1180, 515000),
('44444444-1111-1111-1111-111111111119',
 '33333333-1111-1111-1111-111111111115',
 '/storage/original/proj-005/chap-001/page-003.jpg',
 NULL,
 '/storage/thumbnails/proj-005/chap-001/page-003.jpg',
 3, 'translating', 820, 1180, 528000),
('44444444-1111-1111-1111-11111111111a',
 '33333333-1111-1111-1111-111111111115',
 '/storage/original/proj-005/chap-001/page-004.jpg',
 NULL,
 '/storage/thumbnails/proj-005/chap-001/page-004.jpg',
 4, 'pending', 820, 1180, 505000),
('44444444-1111-1111-1111-11111111111b',
 '33333333-1111-1111-1111-111111111115',
 '/storage/original/proj-005/chap-001/page-005.jpg',
 NULL,
 '/storage/thumbnails/proj-005/chap-001/page-005.jpg',
 5, 'pending', 820, 1180, 522000);

-- 4.5 一人之下第500话 - 2个页面
INSERT INTO pages (page_id, chapter_id, original_url, thumbnail_url, sort_order, status, width, height, file_size) VALUES
('44444444-1111-1111-1111-11111111111c',
 '33333333-1111-1111-1111-111111111117',
 '/storage/original/proj-006/chap-001/page-001.jpg',
 '/storage/thumbnails/proj-006/chap-001/page-001.jpg',
 1, 'pending', 780, 1100, 410000),
('44444444-1111-1111-1111-11111111111d',
 '33333333-1111-1111-1111-111111111117',
 '/storage/original/proj-006/chap-001/page-002.jpg',
 '/storage/thumbnails/proj-006/chap-001/page-002.jpg',
 2, 'pending', 780, 1100, 405000);

-- 4.6 边界测试：超大尺寸页面（4K分辨率）
INSERT INTO pages (page_id, chapter_id, original_url, thumbnail_url, sort_order, status, width, height, file_size) VALUES
('44444444-1111-1111-1111-11111111111e',
 '33333333-1111-1111-1111-111111111118',
 '/storage/original/proj-007/chap-001/page-001.jpg',
 '/storage/thumbnails/proj-007/chap-001/page-001.jpg',
 1, 'pending', 3840, 5760, 10485760); -- 10MB大文件

-- ============================================================
-- 第五部分：测试文字区域数据
-- ============================================================

-- 海贼王页面1的文字区域（已完成页面）
INSERT INTO text_regions (region_id, page_id, type, boundary, original_text, translated_text, confidence, is_locked, style_config, sort_order) VALUES
-- 对话气泡1
('55555555-1111-1111-1111-111111111111',
 '44444444-1111-1111-1111-111111111111',
 'speech',
 '{"x":100,"y":200,"width":300,"height":150,"points":[[100,200],[400,200],[400,350],[100,350]],"rotation":0}',
 'おはようございます！',
 '早上好！',
 0.95, FALSE,
 '{"font_family":"Noto Sans SC","font_size":14,"color":"#000000","stroke_width":1,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":0,"line_height":1.5}',
 1),
-- 对话气泡2
('55555555-1111-1111-1111-111111111112',
 '44444444-1111-1111-1111-111111111111',
 'speech',
 '{"x":450,"y":300,"width":280,"height":120,"points":[[450,300],[730,300],[730,420],[450,420]],"rotation":0}',
 '今日もいい天気ですね。',
 '今天天气真好啊。',
 0.92, FALSE,
 '{"font_family":"Noto Sans SC","font_size":14,"color":"#000000","stroke_width":1,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":0,"line_height":1.5}',
 2),
-- 内心独白
('55555555-1111-1111-1111-111111111113',
 '44444444-1111-1111-1111-111111111111',
 'thought',
 '{"x":150,"y":500,"width":250,"height":100,"points":[[150,500],[400,500],[400,600],[150,600]],"rotation":0}',
 '本当に大丈夫かな…',
 '真的没问题吗...',
 0.88, FALSE,
 '{"font_family":"Noto Serif SC","font_size":12,"color":"#555555","stroke_width":0,"stroke_color":"#FFFFFF","opacity":0.9,"text_align":"left","vertical":false,"letter_spacing":0,"line_height":1.6}',
 3),
-- 旁白框
('55555555-1111-1111-1111-111111111114',
 '44444444-1111-1111-1111-111111111111',
 'narration',
 '{"x":50,"y":50,"width":700,"height":80,"points":[[50,50],[750,50],[750,130],[50,130]],"rotation":0}',
 'それは、遠い昔の物語——',
 '那是，很久以前的故事——',
 0.96, FALSE,
 '{"font_family":"Noto Serif SC","font_size":13,"color":"#333333","stroke_width":0,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"left","vertical":true,"letter_spacing":0,"line_height":1.8}',
 4),
-- 拟声词
('55555555-1111-1111-1111-111111111115',
 '44444444-1111-1111-1111-111111111111',
 'onomatopoeia',
 '{"x":500,"y":700,"width":200,"height":100,"points":[[500,700],[700,700],[700,800],[500,800]],"rotation":-15}',
 'ドドドド...',
 '咚咚咚咚...',
 0.78, FALSE,
 '{"font_family":"Noto Sans SC Black","font_size":22,"color":"#FF6600","stroke_width":3,"stroke_color":"#000000","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":3,"line_height":1.2}',
 5);

-- 海贼王页面2的文字区域（已校对页面 - 低置信度测试）
INSERT INTO text_regions (region_id, page_id, type, boundary, original_text, translated_text, confidence, is_locked, style_config, sort_order) VALUES
('55555555-1111-1111-1111-111111111116',
 '44444444-1111-1111-1111-111111111112',
 'speech',
 '{"x":80,"y":180,"width":320,"height":160,"points":[[80,180],[400,180],[400,340],[80,340]],"rotation":0}',
 '海賊王に、おれはなる！',
 '我要成为海贼王！',
 0.97, FALSE,
 '{"font_family":"Noto Sans SC","font_size":16,"color":"#000000","stroke_width":2,"stroke_color":"#FFD700","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":1,"line_height":1.3}',
 1),
-- 低置信度区域（<60%）
('55555555-1111-1111-1111-111111111117',
 '44444444-1111-1111-1111-111111111112',
 'effect',
 '{"x":300,"y":600,"width":250,"height":120,"points":[[300,600],[550,580],[560,720],[310,700]],"rotation":5}',
 'ギャァァァッ！！',
 '嘎啊啊啊！！',
 0.45, FALSE,  -- 低置信度！需高亮提醒
 '{"font_family":"Noto Sans SC Black","font_size":20,"color":"#FF0000","stroke_width":2,"stroke_color":"#000000","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":2,"line_height":1.2}',
 2),
-- 锁定词（人名不翻译）
('55555555-1111-1111-1111-111111111118',
 '44444444-1111-1111-1111-111111111112',
 'speech',
 '{"x":420,"y":250,"width":280,"height":130,"points":[[420,250],[700,250],[700,380],[420,380]],"rotation":0}',
 'ルフィ！',
 '路飞！',
 0.99, TRUE,  -- 锁定
 '{"font_family":"Noto Sans SC","font_size":14,"color":"#000000","stroke_width":1,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":0,"line_height":1.5}',
 3);

-- 咒术回战页面1的文字区域（已完成 - 多模态翻译）
INSERT INTO text_regions (region_id, page_id, type, boundary, original_text, translated_text, confidence, is_locked, style_config, sort_order) VALUES
('55555555-1111-1111-1111-111111111119',
 '44444444-1111-1111-1111-111111111117',
 'speech',
 '{"x":100,"y":220,"width":310,"height":140,"points":[[100,220],[410,220],[410,360],[100,360]],"rotation":0}',
 '領域展開——無量空処。',
 '领域展开——无量空处。',
 0.94, FALSE,
 '{"font_family":"Noto Sans SC","font_size":15,"color":"#000000","stroke_width":2,"stroke_color":"#FFFFFF","opacity":1.0,"text_align":"center","vertical":false,"letter_spacing":1,"line_height":1.4}',
 1);

-- ============================================================
-- 第六部分：测试术语数据
-- ============================================================

INSERT INTO term_entries (term_id, user_id, project_id, source_text, target_text, note, category, scope) VALUES
-- 用户1的账号级术语
('66666666-1111-1111-1111-111111111111',
 '11111111-1111-1111-1111-111111111111', NULL,
 'ルフィ', '路飞', '主角名称', '人名', 'account'),
('66666666-1111-1111-1111-111111111112',
 '11111111-1111-1111-1111-111111111111', NULL,
 '海賊王', '海贼王', '作品名', '专有名词', 'account'),
('66666666-1111-1111-1111-111111111113',
 '11111111-1111-1111-1111-111111111111', NULL,
 '覇気', '霸气', '战斗系统术语', '招式名', 'account'),
-- 用户2的账号级术语
('66666666-1111-1111-1111-111111111114',
 '11111111-1111-1111-1111-111111111112', NULL,
 '領域展開', '领域展开', '战斗系统术语', '招式名', 'account'),
('66666666-1111-1111-1111-111111111115',
 '11111111-1111-1111-1111-111111111112', NULL,
 '五条悟', '五条悟', '角色名', '人名', 'account'),
-- 作品级术语（仅特定作品生效）
('66666666-1111-1111-1111-111111111116',
 '11111111-1111-1111-1111-111111111111',
 '22222222-1111-1111-1111-111111111111',
 '麦わらの一味', '草帽一伙', '海贼王专有名词', '团队名', 'project');

-- ============================================================
-- 第七部分：测试导出任务数据
-- ============================================================

INSERT INTO export_tasks (task_id, user_id, project_id, chapter_ids, format, quality, resolution, bilingual_mode, status, progress, result_url) VALUES
-- 已完成导出
('77777777-1111-1111-1111-111111111111',
 '11111111-1111-1111-1111-111111111111',
 '22222222-1111-1111-1111-111111111111',
 '["33333333-1111-1111-1111-111111111111"]',
 'png', 100, 'original', NULL,
 'completed', 1.0,
 '/storage/exports/user-001/proj-001/海贼王_第1088话.zip'),
-- 处理中的导出
('77777777-1111-1111-1111-111111111112',
 '11111111-1111-1111-1111-111111111112',
 '22222222-1111-1111-1111-111111111115',
 '["33333333-1111-1111-1111-111111111115","33333333-1111-1111-1111-111111111116"]',
 'cbz', 90, '2k', 'side-by-side',
 'processing', 0.65, NULL),
-- 失败的导出
('77777777-1111-1111-1111-111111111113',
 '11111111-1111-1111-1111-111111111111',
 '22222222-1111-1111-1111-111111111111',
 '["33333333-1111-1111-1111-111111111111"]',
 'pdf', 85, 'original', 'top-bottom',
 'failed', 0.3,
 NULL);

-- ============================================================
-- 第八部分：测试通知数据
-- ============================================================

INSERT INTO notifications (notification_id, user_id, type, title, content, is_read, ref_type, ref_id) VALUES
-- 用户1的通知
('88888888-1111-1111-1111-111111111111',
 '11111111-1111-1111-1111-111111111111',
 'export_complete',
 '导出完成：海贼王 第1088话',
 '您的漫画「海贼王 第1088话」已成功导出为 PNG 格式，点击查看下载。',
 TRUE, 'export_task', '77777777-1111-1111-1111-111111111111'),
('88888888-1111-1111-1111-111111111112',
 '11111111-1111-1111-1111-111111111111',
 'task_complete',
 '翻译完成：海贼王 第1088话 第1页',
 '页面翻译已完成，状态已更新为"已校对"，请前往校对确认。',
 FALSE, 'page', '44444444-1111-1111-1111-111111111111'),
('88888888-1111-1111-1111-111111111113',
 '11111111-1111-1111-1111-111111111111',
 'system',
 '系统维护通知',
 '系统将于本周六凌晨2:00-4:00进行例行维护，届时可能影响使用，敬请谅解。',
 FALSE, NULL, NULL),
-- 用户2的通知
('88888888-1111-1111-1111-111111111114',
 '11111111-1111-1111-1111-111111111112',
 'export_complete',
 '批量导出进行中：咒术回战 第235-236话',
 '正在导出为 CBZ 格式（双语对照），当前进度 65%，预计还需3分钟。',
 FALSE, 'export_task', '77777777-1111-1111-1111-111111111112');

-- ============================================================
-- 第九部分：测试会话数据
-- ============================================================

INSERT INTO user_sessions (session_id, user_id, refresh_token_hash, device_info, ip_address, expires_at) VALUES
-- 有效会话
('99999999-1111-1111-1111-111111111111',
 '11111111-1111-1111-1111-111111111111',
 '$2a$12$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmn',
 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
 '192.168.1.100',
 NOW() + INTERVAL '7 days'),
-- 有效会话（移动端）
('99999999-1111-1111-1111-111111111112',
 '11111111-1111-1111-1111-111111111111',
 '$2a$12$zyxwvutsrqponmlkjihgfedcba0987654321zyxwvutsrqpon',
 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
 '192.168.1.101',
 NOW() + INTERVAL '6 days'),
-- 过期会话（异常数据）
('99999999-1111-1111-1111-111111111113',
 '11111111-1111-1111-1111-111111111112',
 '$2a$12$expiredsessionhash1234567890abcdefghijklmnopqrstuv',
 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/17.0',
 '10.0.0.50',
 NOW() - INTERVAL '1 day'); -- 已过期

-- ============================================================
-- 第十部分：测试翻译缓存数据
-- ============================================================

INSERT INTO translation_cache (cache_id, project_id, source_text, translated_text, source_lang, target_lang, similarity_hash, hit_count) VALUES
('aaaaaaaa-1111-1111-1111-111111111111',
 '22222222-1111-1111-1111-111111111111',
 'おはようございます！', '早上好！', 'ja', 'zh-CN',
 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 3),
('aaaaaaaa-1111-1111-1111-111111111112',
 '22222222-1111-1111-1111-111111111111',
 '海賊王に、おれはなる！', '我要成为海贼王！', 'ja', 'zh-CN',
 'f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1', 5);

-- ============================================================
-- 第十一部分：测试生词本数据
-- ============================================================

INSERT INTO vocabularies (vocab_id, user_id, word, language, definition, part_of_speech, example_sentence, source_project_id) VALUES
('bbbbbbbb-1111-1111-1111-111111111111',
 '11111111-1111-1111-1111-111111111111',
 'おはよう', 'ja', '早上好（口语）', '感叹词',
 'おはようございます！今日も頑張りましょう。',
 '22222222-1111-1111-1111-111111111111'),
('bbbbbbbb-1111-1111-1111-111111111112',
 '11111111-1111-1111-1111-111111111111',
 '天気', 'ja', '天气', '名词',
 '今日はいい天気ですね。',
 '22222222-1111-1111-1111-111111111111'),
('bbbbbbbb-1111-1111-1111-111111111113',
 '11111111-1111-1111-1111-111111111111',
 '大丈夫', 'ja', '没关系/没问题', '形容动词',
 '本当に大丈夫かな…心配です。',
 '22222222-1111-1111-1111-111111111111'),
('bbbbbbbb-1111-1111-1111-111111111114',
 '11111111-1111-1111-1111-111111111112',
 '領域', 'ja', '领域', '名词',
 '領域展開——無量空処。',
 '22222222-1111-1111-1111-111111111115');

-- ============================================================
-- 第十二部分：测试操作历史数据
-- ============================================================

INSERT INTO operation_histories (history_id, user_id, project_id, page_id, operation_type, before_state, after_state) VALUES
('cccccccc-1111-1111-1111-111111111111',
 '11111111-1111-1111-1111-111111111111',
 '22222222-1111-1111-1111-111111111111',
 '44444444-1111-1111-1111-111111111111',
 'text_edit',
 '{"region_id":"55555555-1111-1111-1111-111111111111","translated_text":"早安！"}',
 '{"region_id":"55555555-1111-1111-1111-111111111111","translated_text":"早上好！"}'),
('cccccccc-1111-1111-1111-111111111112',
 '11111111-1111-1111-1111-111111111111',
 '22222222-1111-1111-1111-111111111111',
 '44444444-1111-1111-1111-111111111111',
 'style_change',
 '{"region_id":"55555555-1111-1111-1111-111111111111","style_config":{"font_size":12}}',
 '{"region_id":"55555555-1111-1111-1111-111111111111","style_config":{"font_size":14}}');

-- ============================================================
-- 输出统计信息
-- ============================================================
DO $$
DECLARE
    stats RECORD;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 测试数据生成完成';
    RAISE NOTICE '========================================';

    FOR stats IN
        SELECT 'users' AS tbl, COUNT(*) AS cnt FROM users
        UNION ALL SELECT 'projects', COUNT(*) FROM projects
        UNION ALL SELECT 'chapters', COUNT(*) FROM chapters
        UNION ALL SELECT 'pages', COUNT(*) FROM pages
        UNION ALL SELECT 'text_regions', COUNT(*) FROM text_regions
        UNION ALL SELECT 'term_entries', COUNT(*) FROM term_entries
        UNION ALL SELECT 'export_tasks', COUNT(*) FROM export_tasks
        UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
        UNION ALL SELECT 'user_sessions', COUNT(*) FROM user_sessions
        UNION ALL SELECT 'translation_cache', COUNT(*) FROM translation_cache
        UNION ALL SELECT 'vocabularies', COUNT(*) FROM vocabularies
        UNION ALL SELECT 'operation_histories', COUNT(*) FROM operation_histories
    LOOP
        RAISE NOTICE '   %: % 条', stats.tbl, stats.cnt;
    END LOOP;

    RAISE NOTICE '========================================';
    RAISE NOTICE '测试场景覆盖:';
    RAISE NOTICE '  ✅ 正常数据: 2个用户、6个作品、8个章节、17个页面';
    RAISE NOTICE '  ✅ 边界数据: 超长名称、极值字段、4K大图、过期会话';
    RAISE NOTICE '  ✅ 异常数据: 回收站作品、失败导出、低置信度区域';
    RAISE NOTICE '  ✅ 状态覆盖: pending/translating/reviewed/completed';
    RAISE NOTICE '  ✅ 区域类型: speech/thought/narration/onomatopoeia/effect';
    RAISE NOTICE '========================================';
END $$;

-- ============================================================
-- 回滚脚本（取消注释执行，按外键依赖逆序删除）
-- ============================================================
/*
DELETE FROM operation_histories WHERE user_id LIKE '11111111-1111-1111-1111-%';
DELETE FROM vocabularies WHERE user_id LIKE '11111111-1111-1111-1111-%';
DELETE FROM translation_cache WHERE project_id LIKE '22222222-1111-1111-1111-%';
DELETE FROM user_sessions WHERE user_id LIKE '11111111-1111-1111-1111-%';
DELETE FROM notifications WHERE user_id LIKE '11111111-1111-1111-1111-%';
DELETE FROM export_tasks WHERE user_id LIKE '11111111-1111-1111-1111-%';
DELETE FROM term_entries WHERE user_id LIKE '11111111-1111-1111-1111-%';
DELETE FROM text_regions WHERE page_id LIKE '44444444-1111-1111-1111-%';
DELETE FROM pages WHERE chapter_id LIKE '33333333-1111-1111-1111-%';
DELETE FROM chapters WHERE project_id LIKE '22222222-1111-1111-1111-%';
DELETE FROM projects WHERE user_id LIKE '11111111-1111-1111-1111-%';
DELETE FROM users WHERE user_id LIKE '11111111-1111-1111-1111-%';
*/
