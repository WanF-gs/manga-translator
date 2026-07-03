-- ============================================================
-- 成就系统修复 & 回填脚本
-- 用法: psql -U manga -d manga_translator -f 08_achievement_fix.sql
-- ============================================================

-- 1. 删除可能存在的错误种子数据（使用了错误列名）
DELETE FROM achievements WHERE achievement_id LIKE 'seed-ach-%';

-- 2. 重新插入成就定义（正确列名: icon_url, category）
INSERT INTO achievements (achievement_id, name, description, icon_url, category, required_value)
VALUES
  ('seed-ach-001', '初次翻译', '完成你的第一次翻译', '🎉', 'translation', 1),
  ('seed-ach-002', '翻译达人', '完成10次翻译', '📚', 'translation', 10),
  ('seed-ach-003', '词汇大师', '学习50个单词', '📖', 'vocabulary', 50),
  ('seed-ach-004', '连续打卡', '连续7天学习', '🔥', 'streak', 7),
  ('seed-ach-005', '完美校对', '一次性校对通过率100%', '✅', 'translation', 1),
  ('seed-ach-006', '收藏大师', '收藏10部作品', '⭐', 'social', 10),
  ('seed-ach-007', '导出高手', '导出10次翻译结果', '📦', 'translation', 10),
  ('seed-ach-008', '社交达人', '邀请3位好友', '👥', 'social', 3),
  ('seed-ach-009', '配音演员', '生成100段TTS音频', '🎙️', 'social', 100),
  ('seed-ach-010', '漫画大师', '处理100页漫画', '🏆', 'translation', 100)
ON CONFLICT (achievement_id) DO NOTHING;

-- 3. 确保 migration 中的成就也存在（使用 INSERT ... ON CONFLICT）
INSERT INTO achievements (achievement_id, name, description, icon_url, category, required_value) VALUES
(gen_random_uuid(), '初出茅庐', '完成第一次翻译', '🎉', 'translation', 1),
(gen_random_uuid(), '翻译达人', '累计翻译100页', '📚', 'translation', 100),
(gen_random_uuid(), '翻译大师', '累计翻译1000页', '🏆', 'translation', 1000),
(gen_random_uuid(), '词汇收集家', '收藏50个生词', '📖', 'vocabulary', 50),
(gen_random_uuid(), '词汇达人', '收藏500个生词', '📚', 'vocabulary', 500),
(gen_random_uuid(), '学习新星', '连续学习7天', '🔥', 'streak', 7),
(gen_random_uuid(), '学霸', '连续学习30天', '📚', 'streak', 30),
(gen_random_uuid(), '学习狂人', '连续学习100天', '👑', 'streak', 100),
(gen_random_uuid(), '知识分享者', '贡献10个术语到公开词典', '📤', 'social', 10),
(gen_random_uuid(), '社群贡献者', '贡献100个术语到公开词典', '🌟', 'social', 100)
ON CONFLICT DO NOTHING;

-- 4. 为所有现有用户创建成就进度记录（仅对没有记录的用户）
INSERT INTO user_achievements (user_id, achievement_id, progress, unlocked_at, created_at)
SELECT u.user_id, a.achievement_id, 0, NULL, NOW()
FROM users u
CROSS JOIN achievements a
WHERE NOT EXISTS (
    SELECT 1 FROM user_achievements ua
    WHERE ua.user_id = u.user_id AND ua.achievement_id = a.achievement_id
);

-- 5. 回填现有用户的成就进度
UPDATE user_achievements ua
SET progress = LEAST(1.0, 
    CASE 
        WHEN a.category = 'vocabulary' THEN
            (SELECT COUNT(*)::FLOAT / NULLIF(a.required_value, 0)
             FROM vocabularies v WHERE v.user_id = ua.user_id)
        WHEN a.category = 'translation' THEN
            (SELECT COUNT(*)::FLOAT / NULLIF(a.required_value, 0)
             FROM learning_progress lp WHERE lp.user_id = ua.user_id)
        WHEN a.category = 'streak' THEN
            (SELECT COALESCE(MAX(lp.streak_days), 0)::FLOAT / NULLIF(a.required_value, 0)
             FROM learning_progress lp WHERE lp.user_id = ua.user_id)
        ELSE 0
    END
)
FROM achievements a
WHERE ua.achievement_id = a.achievement_id;

-- 6. 自动解锁已达成的成就
UPDATE user_achievements ua
SET unlocked_at = NOW()
FROM achievements a
WHERE ua.achievement_id = a.achievement_id
  AND ua.progress >= 1.0
  AND ua.unlocked_at IS NULL;
