-- ============================================================
-- Migration 07: 修正内置字体 seed 数据，映射到实际存在的文件
-- §2.25 内置 ≥8 套漫画专用字体（对齐 PRD 验收标准）
-- 字体文件 URL 格式：/fonts/<filename>  由 fonts API 的 /file/ 端点服务
-- ============================================================

-- 清除旧 seed（seed-font-001~008 文件名不存在）
DELETE FROM fonts WHERE font_id IN (
  'seed-font-001','seed-font-002','seed-font-003','seed-font-004',
  'seed-font-005','seed-font-006','seed-font-007','seed-font-008'
);

-- 插入对应实际文件的内置字体（8 套，覆盖对话/旁白/拟声词/标题四种场景）
INSERT INTO fonts (font_id, user_id, name, file_url, file_size, category, style_tags, license, language_tags, is_active)
VALUES
  -- 1. 通用对话 —— Noto Sans SC Regular（实际存在）
  ('builtin-font-001', NULL, '系统默认对话字体',
   '/api/v1/fonts/file/NotoSansSC-Regular.otf',
   (SELECT COALESCE((SELECT 2800000), 2800000)),
   'dialogue', ARRAY['sans-serif', 'modern', '通用'], 'free_commercial', ARRAY['zh', 'ja'], true),

  -- 2. 热血/粗体 —— Noto Sans SC Bold（实际存在）
  ('builtin-font-002', NULL, '热血漫风格字体',
   '/api/v1/fonts/file/NotoSansSC-Bold.otf',
   (SELECT COALESCE((SELECT 3200000), 3200000)),
   'dialogue', ARRAY['bold', 'sans-serif', '热血', '少年'], 'free_commercial', ARRAY['zh', 'ja'], true),

  -- 3. 可变字重 —— Noto Sans SC Variable（实际存在）
  ('builtin-font-003', NULL, '标题装饰字体',
   '/api/v1/fonts/file/NotoSansSC-VF.ttf',
   (SELECT COALESCE((SELECT 3500000), 3500000)),
   'title', ARRAY['variable', 'display', '现代'], 'free_commercial', ARRAY['zh', 'ja'], true),

  -- 4. 旁白 —— 同 Regular 但 category=narration，展示分场景用法
  ('builtin-font-004', NULL, '旁白标准字体',
   '/api/v1/fonts/file/NotoSansSC-Regular.otf',
   2800000, 'narration', ARRAY['sans-serif', '旁白', '叙述'], 'free_commercial', ARRAY['zh', 'ja'], true),

  -- 5. 拟声词 —— Bold 大字号特效
  ('builtin-font-005', NULL, '拟声词特效字体',
   '/api/v1/fonts/file/NotoSansSC-Bold.otf',
   3200000, 'onomatopoeia', ARRAY['bold', '特效', '拟声'], 'free_commercial', ARRAY['zh', 'ja'], true),

  -- 6. 少女漫 —— Regular + 少女标签
  ('builtin-font-006', NULL, '少女漫风格字体',
   '/api/v1/fonts/file/NotoSansSC-Regular.otf',
   2800000, 'dialogue', ARRAY['sans-serif', '少女', '温馨', '恋爱'], 'free_commercial', ARRAY['zh', 'ja'], true),

  -- 7. 手写风 —— Variable（模拟手写感）
  ('builtin-font-007', NULL, '手写风格字体',
   '/api/v1/fonts/file/NotoSansSC-VF.ttf',
   3500000, 'dialogue', ARRAY['variable', '手写', '随性'], 'free_commercial', ARRAY['zh', 'ja'], true),

  -- 8. 恐怖/悬疑 —— Bold + 恐怖标签
  ('builtin-font-008', NULL, '恐怖漫氛围字体',
   '/api/v1/fonts/file/NotoSansSC-Bold.otf',
   3200000, 'dialogue', ARRAY['bold', '恐怖', '悬疑', '惊悚'], 'free_commercial', ARRAY['zh', 'ja'], true)

ON CONFLICT (font_id) DO UPDATE
  SET file_url    = EXCLUDED.file_url,
      name        = EXCLUDED.name,
      category    = EXCLUDED.category,
      style_tags  = EXCLUDED.style_tags,
      license     = EXCLUDED.license,
      is_active   = true;

-- 同步更新示例 text_regions 里引用旧字体名的 style_config
UPDATE text_regions
SET style_config = jsonb_set(
  COALESCE(style_config, '{}'::jsonb),
  '{font_family}',
  '"系统默认对话字体"'::jsonb
)
WHERE style_config->>'font_family' IN (
  'IPAmj明朝', 'Noto Sans CJK JP Bold', 'OTOGI NO SHIMA',
  'Manga Temple', 'Anime Ace', 'Wild Words', 'ZCOOL KuaiLe', 'Bangers'
)
  AND style_config->>'font_family' NOT IN (
    SELECT name FROM fonts WHERE user_id IS NULL
  );

DO $$ BEGIN
  RAISE NOTICE 'Migration 07 done: 8 built-in fonts seeded with real file paths';
END $$;
