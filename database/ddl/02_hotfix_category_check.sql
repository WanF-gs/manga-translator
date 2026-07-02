-- ============================================================
-- 在线修复脚本：style_presets 表 category CHECK 约束修复
-- 问题: DDL中CHECK约束遗漏了 'thought' 和 'effect' 两个分类
-- 修复: 删除旧约束，重建包含全部5种分类的约束
-- 创建时间: 2025-06-22
-- ============================================================

-- ⚠️ 执行前提: 已连接 manga_translator 数据库
-- 回滚方案: 脚本底部

\c manga_translator;

-- Step 1: 查找当前约束名称
DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'style_presets'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%category%';

    IF v_constraint_name IS NOT NULL THEN
        RAISE NOTICE '发现约束: %', v_constraint_name;
        -- 动态删除旧约束
        EXECUTE format('ALTER TABLE style_presets DROP CONSTRAINT %I', v_constraint_name);
        RAISE NOTICE '已删除旧约束: %', v_constraint_name;
    ELSE
        RAISE NOTICE '未找到旧约束，可能已经被修复';
    END IF;
END $$;

-- Step 2: 重建约束（包含全部5种分类）
ALTER TABLE style_presets
    ADD CONSTRAINT style_presets_category_check
    CHECK (category IN ('speech', 'thought', 'narration', 'onomatopoeia', 'effect'));

-- Step 3: 重新插入被跳过的数据（幂等：已存在则跳过）
INSERT INTO style_presets (preset_id, user_id, project_id, name, category, style_config, scope)
VALUES
    -- 预设3：内心独白体
    ('00000000-0000-0000-0000-000000000003', NULL, NULL,
     '内心独白体', 'thought',
     '{"font_family":"Noto Serif SC","font_size":12,"color":"#555555","stroke_width":0,"stroke_color":"#FFFFFF","opacity":0.9,"text_align":"left","vertical":false,"letter_spacing":0,"line_height":1.6}',
     'system')
ON CONFLICT (preset_id) DO NOTHING;

-- Step 4: 验证修复结果
DO $$
DECLARE
    preset_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO preset_count FROM style_presets WHERE scope = 'system';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 修复完成！系统样式预设数量: % (应为8)', preset_count;
    RAISE NOTICE '========================================';
END $$;

-- ============================================================
-- 回滚脚本（如需回滚，取消注释执行）
-- ============================================================
/*
-- 恢复为旧的3分类约束
ALTER TABLE style_presets DROP CONSTRAINT IF EXISTS style_presets_category_check;
ALTER TABLE style_presets
    ADD CONSTRAINT style_presets_category_check
    CHECK (category IN ('speech', 'narration', 'onomatopoeia'));

-- 删除 thought 分类的预设
DELETE FROM style_presets WHERE preset_id = '00000000-0000-0000-0000-000000000003';
*/
