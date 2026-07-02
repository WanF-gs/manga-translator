-- ============================================================
-- P0 修复: export_tasks 添加 updated_at 列
-- Bug: 导出接口查询 updated_at 列，但 DDL 中缺少
-- ============================================================
ALTER TABLE export_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 添加自动更新触发器
DROP TRIGGER IF EXISTS trg_export_tasks_updated_at ON export_tasks;
CREATE TRIGGER trg_export_tasks_updated_at
    BEFORE UPDATE ON export_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
