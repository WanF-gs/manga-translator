-- ============================================================
-- 漫画翻译系统 - 迭代进度可视化看板查询SQL
-- 
-- 版本: v1.0
-- 用途: 对接 Neon 数据库 agent_task_status 表，提供进度可视化
-- 数据库: PostgreSQL 15+ (Neon)
-- 执行: psql $NEON_CONNECTION_STRING -f data/progress-dashboard.sql
-- ============================================================

\c manga_translator;

-- ============================================================
-- 1. 各阶段任务完成率视图
-- ============================================================
-- 展示每个阶段(phase)中任务的完成状态分布
CREATE OR REPLACE VIEW v_phase_completion_rate AS
SELECT
    phase,
    COUNT(*) AS total_tasks,
    COUNT(*) FILTER (WHERE status = '验收通过') AS passed,
    COUNT(*) FILTER (WHERE status = '驳回重传') AS rejected,
    COUNT(*) FILTER (WHERE status = '已提交') AS submitted,
    COUNT(*) FILTER (WHERE status = '执行中') AS in_progress,
    COUNT(*) FILTER (WHERE status = '待接管') AS pending_takeover,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / 
        NULLIF(COUNT(*), 0), 1
    ) AS completion_rate_pct,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status IN ('验收通过', '已提交')) / 
        NULLIF(COUNT(*), 0), 1
    ) AS submission_rate_pct
FROM agent_task_status
GROUP BY phase
ORDER BY phase;

-- ============================================================
-- 2. 各岗位任务状态分布
-- ============================================================
-- 按角色展示每个岗位的任务执行状态
CREATE OR REPLACE VIEW v_role_status_distribution AS
SELECT
    role,
    COUNT(*) AS total_tasks,
    COUNT(*) FILTER (WHERE status = '执行中') AS 执行中,
    COUNT(*) FILTER (WHERE status = '已提交') AS 已提交,
    COUNT(*) FILTER (WHERE status = '验收通过') AS 验收通过,
    COUNT(*) FILTER (WHERE status = '驳回重传') AS 驳回重传,
    COUNT(*) FILTER (WHERE status = '待接管') AS 待接管,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / 
        NULLIF(COUNT(*), 0), 1
    ) AS 通过率_pct
FROM agent_task_status
GROUP BY role
ORDER BY role;

-- ============================================================
-- 3. 分优先级通过率趋势（按时间维度）
-- ============================================================
-- 按日统计各优先级任务的通过率变化
CREATE OR REPLACE VIEW v_daily_pass_rate_trend AS
SELECT
    DATE(updated_at) AS stat_date,
    COUNT(*) AS total_updated,
    COUNT(*) FILTER (WHERE status = '验收通过') AS passed_today,
    COUNT(*) FILTER (WHERE status = '驳回重传') AS rejected_today,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / 
        NULLIF(COUNT(*), 0), 1
    ) AS daily_pass_rate_pct,
    -- 累计通过率
    ROUND(
        100.0 * SUM(COUNT(*) FILTER (WHERE status = '验收通过')) OVER (
            ORDER BY DATE(updated_at)
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) / NULLIF(SUM(COUNT(*)) OVER (
            ORDER BY DATE(updated_at)
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ), 0), 1
    ) AS cumulative_pass_rate_pct
FROM agent_task_status
GROUP BY DATE(updated_at)
ORDER BY stat_date DESC;

-- ============================================================
-- 4. 连续迭代通过率变化曲线
-- ============================================================
-- 按阶段统计通过率，用于绘制迭代质量趋势
CREATE OR REPLACE VIEW v_iteration_pass_rate AS
SELECT
    phase,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = '验收通过') AS passed_count,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / NULLIF(COUNT(*), 0), 1
    ) AS pass_rate_pct,
    -- 与上一阶段对比
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / NULLIF(COUNT(*), 0) -
        LAG(ROUND(
            100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / NULLIF(COUNT(*), 0), 1
        )) OVER (ORDER BY phase), 1
    ) AS rate_change_vs_prev
FROM agent_task_status
GROUP BY phase
ORDER BY phase;

-- ============================================================
-- 5. 剩余问题数量统计
-- ============================================================
-- 统计尚未完成的任务（非「验收通过」状态）
CREATE OR REPLACE VIEW v_remaining_issues AS
SELECT
    phase,
    role,
    status,
    COUNT(*) AS issue_count,
    STRING_AGG(task_desc, '; ' ORDER BY created_at) AS task_descriptions
FROM agent_task_status
WHERE status NOT IN ('验收通过')
GROUP BY phase, role, status
ORDER BY phase, 
    CASE status
        WHEN '执行中' THEN 1
        WHEN '已提交' THEN 2
        WHEN '驳回重传' THEN 3
        WHEN '待接管' THEN 4
    END;

-- ============================================================
-- 6. 超时任务检测（自动巡检用）
-- ============================================================
-- 检测处于「执行中」超过30分钟的任务
CREATE OR REPLACE VIEW v_timeout_tasks AS
SELECT
    task_id,
    role,
    phase,
    task_desc,
    status,
    created_at,
    updated_at,
    EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 AS idle_minutes,
    CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 > 30 THEN '超时'
        WHEN EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 > 10 THEN '需催办'
        ELSE '正常'
    END AS alert_level
FROM agent_task_status
WHERE status = '执行中'
ORDER BY idle_minutes DESC;

-- ============================================================
-- 7. 全量状态概览（总控面板）
-- ============================================================
-- 一目了然的全局状态快照
CREATE OR REPLACE VIEW v_global_overview AS
SELECT
    '总任务数' AS metric, COUNT(*)::TEXT AS value FROM agent_task_status
UNION ALL
SELECT '验收通过', COUNT(*)::TEXT FROM agent_task_status WHERE status = '验收通过'
UNION ALL
SELECT '已提交待验收', COUNT(*)::TEXT FROM agent_task_status WHERE status = '已提交'
UNION ALL
SELECT '执行中', COUNT(*)::TEXT FROM agent_task_status WHERE status = '执行中'
UNION ALL
SELECT '驳回重传', COUNT(*)::TEXT FROM agent_task_status WHERE status = '驳回重传'
UNION ALL
SELECT '待接管', COUNT(*)::TEXT FROM agent_task_status WHERE status = '待接管'
UNION ALL
SELECT '整体通过率', ROUND(100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / NULLIF(COUNT(*), 0), 1)::TEXT || '%' 
FROM agent_task_status
UNION ALL
SELECT '超时任务数', COUNT(*)::TEXT FROM v_timeout_tasks WHERE alert_level = '超时'
UNION ALL
SELECT '需催办任务数', COUNT(*)::TEXT FROM v_timeout_tasks WHERE alert_level = '需催办';

-- ============================================================
-- 8. 迭代简报数据聚合查询
-- ============================================================
-- 用于生成迭代简报的结构化数据
SELECT
    '=== 迭代简报数据 ===' AS section;
    
-- 完成项
SELECT
    '完成项' AS category,
    role,
    COUNT(*) AS count,
    STRING_AGG(task_desc, '; ') AS details
FROM agent_task_status
WHERE status = '验收通过'
GROUP BY role;

-- 剩余问题
SELECT
    '剩余问题' AS category,
    role,
    COUNT(*) AS count,
    STRING_AGG(task_desc, '; ') AS details
FROM agent_task_status
WHERE status NOT IN ('验收通过')
GROUP BY role;

-- 通过率变化
SELECT
    '通过率' AS metric,
    phase,
    ROUND(100.0 * COUNT(*) FILTER (WHERE status = '验收通过') / NULLIF(COUNT(*), 0), 1) AS rate_pct
FROM agent_task_status
GROUP BY phase
ORDER BY phase;

-- 风险项
SELECT
    '风险项' AS category,
    task_id,
    role,
    task_desc,
    status,
    EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS hours_since_created
FROM agent_task_status
WHERE status IN ('驳回重传', '待接管')
   OR (status = '执行中' AND EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 > 10);

-- ============================================================
-- 9. 验收通过后自动推进检测
-- ============================================================
-- 当某阶段所有任务状态均为「验收通过」时，触发下一阶段
CREATE OR REPLACE FUNCTION fn_check_phase_completion(p_phase VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    total INT;
    passed INT;
BEGIN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE status = '验收通过')
    INTO total, passed
    FROM agent_task_status
    WHERE phase = p_phase;
    
    IF total > 0 AND total = passed THEN
        RAISE NOTICE '阶段 [%] 全部任务已完成验收 (%/%)', p_phase, passed, total;
        RETURN TRUE;
    ELSE
        RAISE NOTICE '阶段 [%] 尚未完成 (%/%)', p_phase, passed, total;
        RETURN FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 10. 手动催办标记（由巡检引擎调用）
-- ============================================================
-- 用法: SELECT fn_send_reminder('task-uuid-here');
CREATE OR REPLACE FUNCTION fn_send_reminder(p_task_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_role VARCHAR;
    v_status VARCHAR;
    v_reminder_count INT;
BEGIN
    SELECT role, status INTO v_role, v_status
    FROM agent_task_status
    WHERE task_id = p_task_id;
    
    IF NOT FOUND THEN
        RETURN '错误: 任务不存在';
    END IF;
    
    IF v_status != '执行中' THEN
        RETURN '跳过: 任务状态为 ' || v_status || '，无需催办';
    END IF;
    
    -- 计算催办次数（简化逻辑：基于updated_at判断）
    -- 实际催办逻辑由 SDK 层实现
    
    RETURN '催办已发送: 角色=' || v_role || ', 任务=' || p_task_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 执行示例（取消注释以运行）
-- ============================================================

-- 查看全局概览
-- SELECT * FROM v_global_overview;

-- 查看各阶段完成率
-- SELECT * FROM v_phase_completion_rate;

-- 查看各岗位状态分布
-- SELECT * FROM v_role_status_distribution;

-- 查看超时任务
-- SELECT * FROM v_timeout_tasks;

-- 检查某阶段是否可推进
-- SELECT fn_check_phase_completion('phase-0');
