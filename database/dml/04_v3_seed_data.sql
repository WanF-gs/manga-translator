-- ============================================================
-- PRD v3.0 Seed Data: Sample Project with Pre-translated Pages
-- Provides a complete "getting started" experience for new users
-- ============================================================

-- ===== Insert Sample Fonts (for demo) — 对齐 §2.25 字体系统，使用实际存在的 NotoSansSC 文件 =====
-- 注意：新部署时 07_font_seed_fix.sql 会以 builtin-font-001~008 覆盖此处，用 NOTHING 避免冲突
INSERT INTO fonts (font_id, user_id, name, file_url, file_size, category, style_tags, license, language_tags, is_active)
VALUES
  ('seed-font-001', '00000000-0000-0000-0000-000000000000', '系统默认对话字体', '/api/v1/fonts/file/NotoSansSC-Regular.otf', 2800000, 'dialogue', ARRAY['sans-serif', 'modern', '通用'], 'free_commercial', ARRAY['zh', 'ja'], true),
  ('seed-font-002', '00000000-0000-0000-0000-000000000000', '热血漫风格字体', '/api/v1/fonts/file/NotoSansSC-Bold.otf', 3200000, 'dialogue', ARRAY['bold', 'sans-serif', '热血', '少年'], 'free_commercial', ARRAY['zh', 'ja'], true),
  ('seed-font-003', '00000000-0000-0000-0000-000000000000', '标题装饰字体', '/api/v1/fonts/file/NotoSansSC-VF.ttf', 3500000, 'title', ARRAY['variable', 'display', '现代'], 'free_commercial', ARRAY['zh', 'ja'], true),
  ('seed-font-004', '00000000-0000-0000-0000-000000000000', '旁白标准字体', '/api/v1/fonts/file/NotoSansSC-Regular.otf', 2800000, 'narration', ARRAY['sans-serif', '旁白', '叙述'], 'free_commercial', ARRAY['zh', 'ja'], true),
  ('seed-font-005', '00000000-0000-0000-0000-000000000000', '拟声词特效字体', '/api/v1/fonts/file/NotoSansSC-Bold.otf', 3200000, 'onomatopoeia', ARRAY['bold', '特效', '拟声'], 'free_commercial', ARRAY['zh', 'ja'], true),
  ('seed-font-006', '00000000-0000-0000-0000-000000000000', '少女漫风格字体', '/api/v1/fonts/file/NotoSansSC-Regular.otf', 2800000, 'dialogue', ARRAY['sans-serif', '少女', '温馨', '恋爱'], 'free_commercial', ARRAY['zh', 'ja'], true),
  ('seed-font-007', '00000000-0000-0000-0000-000000000000', '手写风格字体', '/api/v1/fonts/file/NotoSansSC-VF.ttf', 3500000, 'dialogue', ARRAY['variable', '手写', '随性'], 'free_commercial', ARRAY['zh', 'ja'], true),
  ('seed-font-008', '00000000-0000-0000-0000-000000000000', '恐怖漫氛围字体', '/api/v1/fonts/file/NotoSansSC-Bold.otf', 3200000, 'dialogue', ARRAY['bold', '恐怖', '悬疑', '惊悚'], 'free_commercial', ARRAY['zh', 'ja'], true)
ON CONFLICT (font_id) DO NOTHING;

-- ===== Insert Sample TTS Voices =====
INSERT INTO voices (voice_id, name, language, gender, description, engine, sample_url)
VALUES
  ('seed-voice-001', 'Nanami (Japanese Female)', 'ja', 'female', 'Natural Japanese female voice, suitable for shoujo manga heroines', 'edge-tts', NULL),
  ('seed-voice-002', 'Keita (Japanese Male)', 'ja', 'male', 'Deep Japanese male voice, suitable for shounen protagonists', 'edge-tts', NULL),
  ('seed-voice-003', 'Xiaoxiao (Chinese Female)', 'zh', 'female', 'Warm Chinese female voice, suitable for daily conversations', 'edge-tts', NULL),
  ('seed-voice-004', 'Yunxi (Chinese Male)', 'zh', 'male', 'Clear Chinese male voice, suitable for narration', 'edge-tts', NULL),
  ('seed-voice-005', 'Jenny (English Female)', 'en', 'female', 'Natural American English female voice', 'edge-tts', NULL),
  ('seed-voice-006', 'Guy (English Male)', 'en', 'male', 'Professional American English male voice', 'edge-tts', NULL),
  ('seed-voice-007', 'SunHi (Korean Female)', 'ko', 'female', 'Bright Korean female voice, suitable for webtoons', 'edge-tts', NULL),
  ('seed-voice-008', 'InJoon (Korean Male)', 'ko', 'male', 'Calm Korean male voice, suitable for drama', 'edge-tts', NULL)
ON CONFLICT (voice_id) DO NOTHING;

-- ===== Insert Sample Achievements =====
INSERT INTO achievements (achievement_id, name, description, icon, condition_type, condition_value)
VALUES
  ('seed-ach-001', '初次翻译', '完成你的第一次翻译', '🎉', 'translate_count', 1),
  ('seed-ach-002', '翻译达人', '完成10次翻译', '📚', 'translate_count', 10),
  ('seed-ach-003', '词汇大师', '学习50个单词', '📖', 'learned_words', 50),
  ('seed-ach-004', '连续打卡', '连续7天学习', '🔥', 'streak_days', 7),
  ('seed-ach-005', '完美校对', '一次性校对通过率100%', '✅', 'perfect_review', 1),
  ('seed-ach-006', '收藏大师', '收藏10部作品', '⭐', 'favorite_count', 10),
  ('seed-ach-007', '导出高手', '导出10次翻译结果', '📦', 'export_count', 10),
  ('seed-ach-008', '社交达人', '邀请3位好友', '👥', 'invite_count', 3),
  ('seed-ach-009', '配音演员', '生成100段TTS音频', '🎙️', 'tts_count', 100),
  ('seed-ach-010', '漫画大师', '处理100页漫画', '🏆', 'page_count', 100)
ON CONFLICT (achievement_id) DO NOTHING;

-- ===== Insert Sample Project =====
-- The project uses a system user placeholder. In practice, this would be replaced
-- by the actual user ID when "Load Sample Project" is clicked.
INSERT INTO projects (project_id, user_id, name, description, source_lang, target_langs, status, thumbnail_url, is_favorite, created_at, updated_at)
SELECT
  'seed-project-001',
  '00000000-0000-0000-0000-000000000000',
  '示例：三页漫画入门',
  '这是一个预翻译的示例作品，展示系统的完整功能：文本检测→OCR识别→智能翻译→图像修复→文字渲染。点击进入查看翻译效果！',
  'ja',
  ARRAY['zh', 'en'],
  'translated',
  NULL,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE project_id = 'seed-project-001');

-- ===== Insert Sample Chapters =====
INSERT INTO chapters (chapter_id, project_id, chapter_number, title, sort_order, status, created_at, updated_at)
SELECT 'seed-chapter-001', 'seed-project-001', 1, '第一章：相遇', 1, 'completed', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM chapters WHERE chapter_id = 'seed-chapter-001');

-- ===== Insert Sample Pages =====
-- Three sample pages with placeholder image URLs
-- In production, replace with actual image URLs or use generated test images
INSERT INTO pages (page_id, chapter_id, page_number, original_image_url, processed_image_url, status, width, height, sort_order, created_at, updated_at)
SELECT 'seed-page-001', 'seed-chapter-001', 1, 'https://picsum.photos/seed/manga1/800/1100', NULL, 'translated', 800, 1100, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE page_id = 'seed-page-001');

INSERT INTO pages (page_id, chapter_id, page_number, original_image_url, processed_image_url, status, width, height, sort_order, created_at, updated_at)
SELECT 'seed-page-002', 'seed-chapter-001', 2, 'https://picsum.photos/seed/manga2/800/1100', NULL, 'translated', 800, 1100, 2, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE page_id = 'seed-page-002');

INSERT INTO pages (page_id, chapter_id, page_number, original_image_url, processed_image_url, status, width, height, sort_order, created_at, updated_at)
SELECT 'seed-page-003', 'seed-chapter-001', 3, 'https://picsum.photos/seed/manga3/800/1100', NULL, 'translated', 800, 1100, 3, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE page_id = 'seed-page-003');

-- ===== Insert Sample Text Regions (Pre-OCR + Pre-Translated) =====
-- Page 1: Dialogue between two characters meeting for the first time
INSERT INTO text_regions (region_id, page_id, bbox_x, bbox_y, bbox_width, bbox_height, original_text, translated_text, region_type, confidence, style_config, sort_order, created_at, updated_at)
VALUES
  -- Page 1 regions
  ('seed-region-001', 'seed-page-001', 100, 200, 300, 80,
   'こんにちは、初めまして！',
   '你好，初次见面！',
   'speech', 0.95,
   '{"font_family": "热血漫风格字体", "font_size": 14, "color": "#000000", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   1, NOW(), NOW()),

  ('seed-region-002', 'seed-page-001', 100, 350, 300, 80,
   'あ、君は転校生？',
   '啊，你是转校生吗？',
   'speech', 0.92,
   '{"font_family": "热血漫风格字体", "font_size": 14, "color": "#000000", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   2, NOW(), NOW()),

  ('seed-region-003', 'seed-page-001', 500, 250, 280, 90,
   'はい、今日からお世話になります。',
   '是的，从今天起请多关照。',
   'speech', 0.88,
   '{"font_family": "系统默认对话字体", "font_size": 13, "color": "#333333", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   3, NOW(), NOW()),

  ('seed-region-004', 'seed-page-001', 200, 500, 400, 70,
   '（この学校、思ったより大きいな...）',
   '（这所学校，比想象中要大呢...）',
   'thought', 0.85,
   '{"font_family": "系统默认对话字体", "font_size": 12, "color": "#666666", "stroke_color": "#FFFFFF", "text_align": "left", "vertical": false}',
   4, NOW(), NOW()),

  ('seed-region-005', 'seed-page-001', 50, 800, 700, 60,
   'こうして、二人の物語が始まった──',
   '就这样，两人的故事开始了——',
   'narration', 0.90,
   '{"font_family": "旁白标准字体", "font_size": 13, "color": "#444444", "stroke_color": "#F0F0F0", "text_align": "center", "vertical": false}',
   5, NOW(), NOW()),

  -- Page 2 regions: Action scene with onomatopoeia
  ('seed-region-006', 'seed-page-002', 150, 150, 250, 80,
   '待って！危ない！',
   '等等！危险！',
   'speech', 0.93,
   '{"font_family": "热血漫风格字体", "font_size": 16, "color": "#FF0000", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   1, NOW(), NOW()),

  ('seed-region-007', 'seed-page-002', 500, 300, 150, 150,
   'ドカーン！！',
   '轰隆！！',
   'onomatopoeia', 0.91,
   '{"font_family": "拟声词特效字体", "font_size": 24, "color": "#FF4500", "stroke_color": "#FFD700", "text_align": "center", "vertical": false}',
   2, NOW(), NOW()),

  ('seed-region-008', 'seed-page-002', 100, 500, 350, 80,
   '大丈夫...君のおかげで助かった。',
   '没事...多亏了你才得救了。',
   'speech', 0.87,
   '{"font_family": "系统默认对话字体", "font_size": 13, "color": "#000000", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   3, NOW(), NOW()),

  ('seed-region-009', 'seed-page-002', 400, 600, 300, 80,
   'な、なんてこった...',
   '这、这到底是怎么回事...',
   'speech', 0.89,
   '{"font_family": "热血漫风格字体", "font_size": 14, "color": "#333333", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   4, NOW(), NOW()),

  -- Page 3 regions: Emotional resolution
  ('seed-region-010', 'seed-page-003', 150, 200, 350, 90,
   '実は、ずっと言いたかったことがあるんだ...',
   '其实，一直有件事想对你说...',
   'speech', 0.94,
   '{"font_family": "系统默认对话字体", "font_size": 13, "color": "#000000", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   1, NOW(), NOW()),

  ('seed-region-011', 'seed-page-003', 450, 300, 300, 90,
   '...なに？',
   '...什么？',
   'speech', 0.96,
   '{"font_family": "热血漫风格字体", "font_size": 14, "color": "#000000", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   2, NOW(), NOW()),

  ('seed-region-012', 'seed-page-003', 200, 500, 400, 80,
   'これからも、ずっと一緒にいてください！',
   '从今以后，请一直和我在一起！',
   'speech', 0.90,
   '{"font_family": "热血漫风格字体", "font_size": 15, "color": "#E91E63", "stroke_color": "#FFFFFF", "text_align": "center", "vertical": false}',
   3, NOW(), NOW()),

  ('seed-region-013', 'seed-page-003', 100, 700, 600, 70,
   '──桜の花びらが舞い散る中、新しい絆が生まれた。',
   '——樱花纷飞中，新的羁绊诞生了。',
   'narration', 0.88,
   '{"font_family": "旁白标准字体", "font_size": 12, "color": "#555555", "stroke_color": "#FFF5F5", "text_align": "center", "vertical": false}',
   4, NOW(), NOW());

-- ===== Insert Sample Translation Cache =====
INSERT INTO translation_cache (cache_id, project_id, source_text, translated_text, source_lang, target_lang, similarity_hash, hit_count, created_at)
VALUES
  ('seed-cache-001', 'seed-project-001', 'こんにちは、初めまして！', '你好，初次见面！', 'ja', 'zh', 'a1b2c3d4', 5, NOW()),
  ('seed-cache-002', 'seed-project-001', '待って！危ない！', '等等！危险！', 'ja', 'zh', 'e5f6g7h8', 3, NOW()),
  ('seed-cache-003', 'seed-project-001', 'ありがとう', '谢谢', 'ja', 'zh', 'i9j0k1l2', 8, NOW()),
  ('seed-cache-004', 'seed-project-001', '大丈夫', '没关系', 'ja', 'zh', 'm3n4o5p6', 6, NOW())
ON CONFLICT (cache_id) DO NOTHING;

-- ===== Print Summary =====
DO $$
BEGIN
  RAISE NOTICE 'Seed data inserted: 1 project, 1 chapter, 3 pages, 13 text regions, 4 cache entries';
  RAISE NOTICE 'Fonts: 8, Voices: 8, Achievements: 10';
END $$;
