# SDK 部署与启动文档

> 版本: v1.0
> 适用范围: 漫画多语言智能翻译与图像合成系统 - 阶段三 SDK管控层
> 依赖: Node.js 18+, Neon MCP, GitHub MCP, Playwright MCP

---

## 一、SDK 架构概览

阶段三的 SDK 层由四个核心模块组成，从代码层面硬编码任务生命周期与流程流转：

| 模块 | 文件 | 功能 |
|------|------|------|
| 生命周期钩子 | `sdk/agent-lifecycle-hooks.js` | 子Agent创建→锚定→心跳→终止全流程硬管控 |
| 任务状态机 | `sdk/task-state-machine.js` | 中心化状态流转引擎，自动巡检/催办/降级 |
| 统一提交网关 | `sdk/unified-submit-gateway.js` | 交付物提交唯一入口，五重校验+双提交 |
| 流程编排器 | `sdk/workflow-orchestrator.js` | 第0阶段→迭代→最终验收全自动编排 |

四模块之间的关系：

```
workflow-orchestrator.js (顶层编排)
    │
    ├─→ agent-lifecycle-hooks.js (Agent实例管理)
    │       └─→ 每个Agent实例受生命周期钩子管控
    │
    ├─→ task-state-machine.js (状态流转)
    │       └─→ 巡检 + 催办 + 接管 + 阶段推进
    │
    └─→ unified-submit-gateway.js (提交校验)
            └─→ GitHub MCP + Neon MCP 双提交
```

---

## 二、部署前置条件

### 2.1 环境要求

- Node.js 18+ 
- 项目已安装依赖: `npm install`
- 以下 MCP 服务器已正确配置并可用:
  - GitHub MCP Server
  - Neon MCP Server
  - Playwright MCP Server
  - SequentialThinking MCP Server
  - Firecrawl MCP Server

### 2.2 数据库准备

确保 Neon 数据库中 `agent_task_status` 表已创建：

```sql
-- 连接到 Neon 数据库
\c manga_translator;

-- 确认表存在
SELECT * FROM agent_task_status LIMIT 1;

-- 如果没有数据，表结构应来自 database/ddl/04_agent_task_status.sql
```

### 2.3 技能包准备

确保以下技能文件存在：
- `skills/audit-closure-master.skills` — 总控技能
- `skills/roles/role-*.skills` — 15个岗位子技能

### 2.4 测试素材准备

确保 `测试项目/` 目录存在且包含36张JPG、9个PDF、1个RAR文件。

---

## 三、SDK 模块初始化

### 3.1 生命周期管理器初始化

```javascript
const { AgentLifecycleManager } = require('./sdk/agent-lifecycle-hooks');

const lifecycleMgr = new AgentLifecycleManager();

// 创建一个后端开发Agent实例
const agent = lifecycleMgr.createInstance(
  'backend-dev',          // 角色ID
  'task-uuid-001',        // 任务UUID
  '实现用户认证API',       // 任务描述
  'phase-1'               // 当前阶段
);
// 输出: [角色锚定] 我是后端开发工程师(backend-dev)，属于开发组...
```

### 3.2 任务状态机初始化

```javascript
const { TaskStateMachine } = require('./sdk/task-state-machine');

const stateMachine = new TaskStateMachine({
  pollInterval: 30000,      // 巡检间隔30秒
  executionTimeout: 1800,   // 执行超时30分钟
  idleTimeout: 600,         // 空闲超时10分钟
  maxReminders: 2,          // 最大催办次数
});

// 启动自动巡检
stateMachine.startPatrol();
```

### 3.3 统一提交网关初始化

```javascript
const { UnifiedSubmitGateway } = require('./sdk/unified-submit-gateway');

const submitGateway = new UnifiedSubmitGateway({
  projectRoot: __dirname,
  strictMode: true,         // 严格模式：所有校验必须通过
});
```

### 3.4 全流程编排器初始化

```javascript
const { WorkflowOrchestrator } = require('./sdk/workflow-orchestrator');

const orchestrator = new WorkflowOrchestrator({
  maxIterations: 10,
  autoStart: true,
  phase0AutoMode: true,
});

// 启动全流程（第0阶段 → 迭代 → 最终验收）
orchestrator.run().then(result => {
  console.log('全流程完成:', result);
});
```

---

## 四、使用 CodeBuddy Agent SDK 集成

### 4.1 在 Agent 定义中集成生命周期钩子

```typescript
// 示例: 子Agent启动脚本
const { onInit, onOperation, onTerminate } = require('./sdk/agent-lifecycle-hooks');

// 初始化Agent
let agent = null;

// 系统启动时自动调用
function systemInit(role, taskId, taskDesc, phase) {
  agent = onInit(role, taskId, taskDesc, phase);
  // agent 已锚定，技能包已加载
}

// 每次工具调用前自动调用
function beforeToolCall(operation, operationType) {
  const allowed = onOperation(agent, operation, operationType);
  if (!allowed) {
    throw new Error(`操作被拦截: ${operationType} 不在角色 ${agent.role} 的权限范围内`);
  }
}

// Agent 终止前自动调用
async function beforeTerminate(submissionResult) {
  const result = onTerminate(agent, submissionResult);
  if (!result.canTerminate) {
    console.log('请完成以下步骤后再终止:');
    result.actions.forEach(action => console.log(action));
    return false;
  }
  return true;
}
```

### 4.2 集成提交网关

```javascript
const { UnifiedSubmitGateway } = require('./sdk/unified-submit-gateway');
const gateway = new UnifiedSubmitGateway();

async function submitReport(content) {
  const result = await gateway.submitDeliverable({
    content: content,
    filePath: 'deliverables/phase-1/test-engineer/test-report.md',
    type: 'test-report',
    role: 'test-engineer',
    taskId: 'task-uuid-001',
    phase: 'phase-1',
    prdReferences: ['§2.1.1', '§2.2.1'],
    testMaterials: ['测试项目/Ming Zhen Tan Ke Nan (102) - Qing Shan Gang Chang_页面_001_图像_0001.jpg'],
  });
  
  if (result.passed) {
    console.log('提交成功!', result.githubResult);
  } else {
    console.log('提交失败:', result.errors);
  }
}
```

---

## 五、启动流程

### 5.1 完整启动命令

```bash
# 1. 确保技能包完整
ls skills/audit-closure-master.skills && ls skills/roles/*.skills

# 2. 确保数据库就绪
# (通过 Neon MCP 验证连接)

# 3. 启动全流程编排
node -e "
const { WorkflowOrchestrator } = require('./sdk/workflow-orchestrator');
const orch = new WorkflowOrchestrator({ maxIterations: 10 });
orch.run().then(r => console.log(JSON.stringify(r, null, 2)));
"
```

### 5.2 仅执行第0阶段

```bash
node -e "
const { WorkflowOrchestrator } = require('./sdk/workflow-orchestrator');
const orch = new WorkflowOrchestrator();
orch.executePhase0().then(stats => console.log('Phase 0 done:', stats));
"
```

### 5.3 启动状态监控

```bash
node -e "
const { WorkflowOrchestrator } = require('./sdk/workflow-orchestrator');
const orch = new WorkflowOrchestrator();
orch.run();
setInterval(() => console.log(orch.getStatus()), 30000);
"
```

---

## 六、异常处理

### 6.1 Agent失活自动接管

当任务状态机检测到任务连续2次催办无响应时，自动将任务标记为「待接管」，并调度同组备用角色创建新任务实例。

```javascript
// 接管逻辑在 task-state-machine.js 的 _patrol() 中自动执行
// 接管事件被 workflow-orchestrator.js 监听处理
```

### 6.2 提交失败重试

统一提交网关在 GitHub 或 Neon 操作失败时，会返回明确的失败原因。编排引擎会记录失败并尝试重新派发修复任务。

### 6.3 流程中断恢复

状态机的所有状态变更都会同步到 Neon 数据库，即使编排引擎进程异常退出，重新启动后可以从数据库中恢复当前状态继续执行。

---

## 七、验收验证

执行以下命令验证 SDK 部署成功：

```bash
# 1. 验证模块可加载
node -e "
const hooks = require('./sdk/agent-lifecycle-hooks');
const tsm = require('./sdk/task-state-machine');
const gw = require('./sdk/unified-submit-gateway');
const orch = require('./sdk/workflow-orchestrator');
console.log('所有SDK模块加载成功');
"

# 2. 验证生命周期钩子
node -e "
const { AgentLifecycleManager } = require('./sdk/agent-lifecycle-hooks');
const mgr = new AgentLifecycleManager();
const agent = mgr.createInstance('frontend-dev', 'test-001', '测试任务', 'phase-0');
console.log('Agent创建成功:', agent.lifecycleState);
// 验证终止拦截
const result = mgr.terminateInstance('test-001', {});
console.log('终止拦截:', !result.canTerminate ? '有效' : '失败');
"

# 3. 验证提交网关
node -e "
const { UnifiedSubmitGateway } = require('./sdk/unified-submit-gateway');
const gw = new UnifiedSubmitGateway({ strictMode: true });
const result = gw.quickValidate({
  content: '# 测试报告\n\nprd_version: v3.0',
  filePath: 'deliverables/phase-0/test-engineer/test-report.md',
  type: 'test-report',
  role: 'test-engineer',
  taskId: 'test-001',
  phase: 'phase-0',
  prdReferences: ['§2.1.1'],
});
console.log('校验结果:', result.passed);
"
```

---

> **本文档由基础设施工程师维护，SDK变更后同步更新。**
