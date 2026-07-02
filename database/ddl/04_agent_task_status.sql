-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- Neon Agent 任务状态表
-- 适用: PostgreSQL 15+
-- 说明: 用于多 Agent 协作任务的状态追踪与交接管理
-- ============================================================

\c manga_translator;

-- -----------------------------------------------------------
-- agent_task_status（Agent 任务状态表）
-- -----------------------------------------------------------
DROP TABLE IF EXISTS agent_task_status CASCADE;
CREATE TABLE agent_task_status (
    task_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            VARCHAR(50) NOT NULL,
    phase           VARCHAR(50) NOT NULL,
    task_desc       TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT '执行中'
                    CHECK (status IN ('执行中', '已提交', '验收通过', '驳回重传', '待接管')),
    deliverable_path VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE agent_task_status IS 'Agent任务状态表 - 多Agent协作任务的状态追踪与交接管理';
COMMENT ON COLUMN agent_task_status.role IS 'Agent角色名（如: frontend-dev, backend-dev, db-admin, qa-engineer）';
COMMENT ON COLUMN agent_task_status.phase IS '当前阶段（如: design, develop, test, audit, deploy）';
COMMENT ON COLUMN agent_task_status.task_desc IS '任务描述';
COMMENT ON COLUMN agent_task_status.status IS '状态: 执行中-正在处理, 已提交-已完成待验收, 验收通过-审核通过, 驳回重传-问题需要修正, 待接管-等待下一位Agent接手';
COMMENT ON COLUMN agent_task_status.deliverable_path IS '交付物路径（相对仓库根目录）';

-- 索引
CREATE INDEX idx_task_status_role ON agent_task_status(role);
CREATE INDEX idx_task_status_phase ON agent_task_status(phase);
CREATE INDEX idx_task_status_status ON agent_task_status(status);
CREATE INDEX idx_task_status_role_status ON agent_task_status(role, status);
CREATE INDEX idx_task_status_updated ON agent_task_status(updated_at DESC);

-- 触发器：自动更新 updated_at
DROP TRIGGER IF EXISTS trg_agent_task_updated_at ON agent_task_status;
CREATE TRIGGER trg_agent_task_updated_at
    BEFORE UPDATE ON agent_task_status
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
