# 测试与巡检插件整合说明文档

> 版本: v1.0
> 适用范围: 漫画多语言智能翻译与图像合成系统 - 阶段二
> 依赖: webapp-testing + data 插件, Playwright MCP, Neon MCP

---

## 一、整合概述

阶段二的核心目标是将 webapp-testing 和 data 两个插件深度整合到项目的多Agent测试审计闭环体系中，实现：

1. **webapp-testing**: 规范 E2E 全链路测试流程，强制绑定项目固定测试素材，杜绝无效测试
2. **data**: 对接 Neon 任务状态表，实现进度可视化、自动巡检与迭代简报生成

整合后的测试体系替代了原来依赖人工判断的主观汇报模式，全部转为数据驱动的自动化流程。

---

## 二、webapp-testing 插件整合（测试侧）

### 2.1 测试环境配置

配置文件: `tests/e2e/webapp-testing.config.js`

该配置文件定义了完整的测试环境参数，包括：

- **固定素材路径**: `测试项目/` 目录硬编码（36张JPG + 9个PDF + 1个RAR），所有E2E测试强制从此目录读取素材
- **前端应用地址**: `http://localhost:3000`（Next.js 14 开发服务器）
- **后端API地址**: `http://localhost:8080`（Go 网关代理）
- **Playwright 配置**: Chromium 浏览器，1280x720 视口，自动截图
- **Neon 数据库配置**: `agent_task_status` 表字段映射，巡检阈值
- **GitHub 仓库配置**: 交付物路径规范

### 2.2 素材强制绑定机制

所有E2E测试用例必须引用 `测试项目/` 目录内的固定素材，系统通过以下三层校验确保合规：

1. **配置层硬编码**: 所有素材路径在 `webapp-testing.config.js` 中预定义，测试脚本只能引用配置中的路径
2. **运行时校验**: `run-all.sh` 启动前检查测试素材目录存在性，不存在则立即终止
3. **代码审查校验**: 代码审查专家在审查测试代码时，检查是否使用了外部/生成式素材

### 2.3 用例标准化

模板文件: `tests/e2e/case-template.md`

每个测试用例包含以下标准化字段：
- PRD条款编号（精确到 §X.Y.Z）
- 优先级（P0-P3）
- 测试类型（正向/异常/边界/误操作）
- 测试层（L1-L4）
- 关联素材路径（必须来自 `测试项目/` 目录）
- 操作步骤表格（含元素定位、输入数据）
- 预期断言表格（含断言类型、严重级别）
- 测试结果记录表格

### 2.4 测试分层

| 层级 | 名称 | 说明 | 时限 | 通过率要求 |
|------|------|------|------|-----------|
| L1 | 冒烟测试 | 核心流程快速验证 | 10分钟 | 100% |
| L2 | 单元测试 | 单模块功能点验证 | 30分钟 | 90% |
| L3 | 集成测试 | 跨模块联调测试 | 45分钟 | 85% |
| L4 | 全量回归 | 全功能端到端回归 | 120分钟 | ≥85% (P0=100%) |

### 2.5 一键全量回归

执行脚本: `tests/e2e/run-all.sh`

用法:
```bash
# 全量回归
bash tests/e2e/run-all.sh

# 仅执行冒烟测试
bash tests/e2e/run-all.sh --layer L1

# 有头浏览器模式（调试用）
bash tests/e2e/run-all.sh --headed

# 失败自动重试2次
bash tests/e2e/run-all.sh --retry 2
```

执行流程:
1. 前置校验（素材目录、前端服务、后端API）
2. 按顺序执行 L1 → L2 → L3 → L4
3. 每层测试完成后生成独立日志和报告
4. 汇总生成总报告，标注失败层级
5. 输出后续操作提醒（GitHub提交 + Neon更新）

### 2.6 测试结果自动同步

测试完成后自动执行三步同步:
1. 测试报告提交至 GitHub `reports/test/` 目录
2. Neon 数据库 `agent_task_status` 更新为「已提交」
3. 失败用例与错误日志写入 `reports/test/bug_summary.md`

---

## 三、data 插件整合（巡检侧）

### 3.1 数据源配置

对接表: Neon 数据库 `agent_task_status`

表结构:
| 字段 | 类型 | 说明 |
|------|------|------|
| task_id | UUID | 任务唯一标识 |
| role | VARCHAR(50) | Agent角色名 |
| phase | VARCHAR(50) | 当前阶段 |
| task_desc | TEXT | 任务描述 |
| status | VARCHAR(20) | 状态: 执行中/已提交/验收通过/驳回重传/待接管 |
| deliverable_path | VARCHAR(500) | 交付物路径 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间（自动触发器） |

### 3.2 进度可视化看板

SQL文件: `data/progress-dashboard.sql`

提供10组视图和函数，覆盖全部核心指标：

| # | 视图/函数 | 用途 |
|---|----------|------|
| 1 | `v_phase_completion_rate` | 各阶段任务完成率 |
| 2 | `v_role_status_distribution` | 各岗位任务状态分布 |
| 3 | `v_daily_pass_rate_trend` | 分日通过率趋势 |
| 4 | `v_iteration_pass_rate` | 连续迭代通过率变化曲线 |
| 5 | `v_remaining_issues` | 剩余问题数量统计 |
| 6 | `v_timeout_tasks` | 超时任务检测 |
| 7 | `v_global_overview` | 全量状态概览 |
| 8 | 内联查询 | 迭代简报数据聚合 |
| 9 | `fn_check_phase_completion()` | 阶段完成检测（自动推进） |
| 10 | `fn_send_reminder()` | 催办标记 |

查看方式:
```sql
-- 全局概览（在 Neon SQL Editor 中执行）
SELECT * FROM v_global_overview;

-- 超时任务
SELECT * FROM v_timeout_tasks;

-- 检查阶段是否可推进
SELECT fn_check_phase_completion('phase-0');
```

### 3.3 自动迭代简报生成

脚本: `scripts/generate-iteration-report.js`

用法:
```bash
# 生成 Phase-0 迭代简报
node scripts/generate-iteration-report.js --phase phase-0

# 指定输出目录
node scripts/generate-iteration-report.js --phase phase-0 --output reports/
```

报告内容包含六大板块:
1. **执行概览**: 任务总数、验收通过数、通过率
2. **各组别完成情况**: 按管理层/需求合规组/开发组/修复组/测试质量组分组展示
3. **通过率变化**: 与上一轮对比
4. **风险项**: 驳回重传、待接管、超时任务
5. **终止条件判断**: 8项逐条确认
6. **下一步行动**: 具体可执行的后继步骤

### 3.4 异常自动告警

配置的超时规则:
- 任务处于「执行中」超过30分钟 → 自动标记为「超时」
- 任务处于「执行中」超过10分钟 → 标记为「需催办」
- 连续2次催办无状态更新 → 自动标记为「待接管」

巡检逻辑由 `v_timeout_tasks` 视图提供检测能力，实际的催办和接管动作由阶段三的 SDK 中心化任务状态机执行。

---

## 四、数据流图

```
测试执行 (run-all.sh)
    │
    ├──→ Playwright MCP: 浏览器自动化测试
    │       └── 截图 → reports/test/screenshots/
    │
    ├──→ 结构化测试报告 (Markdown)
    │       └── GitHub MCP → reports/test/
    │
    ├──→ Neon MCP: 更新 agent_task_status
    │       └── UPDATE status = '已提交'
    │
    └──→ 触发迭代简报生成
            │
            └──→ generate-iteration-report.js
                    │
                    ├──→ Neon MCP: 拉取全量任务数据
                    │
                    ├──→ 生成简报 → reports/audit/
                    │
                    └──→ GitHub MCP: 提交简报
```

---

## 五、验收验证

### 5.1 测试侧验收

执行以下命令验证测试整合是否正常：
```bash
# 1. 检查配置
node -e "const c = require('./tests/e2e/webapp-testing.config.js'); console.log('素材路径:', c.TEST_MATERIALS.root); console.log('图片数量:', c.TEST_MATERIALS.images.length);"

# 2. 执行冒烟测试
bash tests/e2e/run-all.sh --layer L1

# 3. 验证素材绑定
grep -r "测试项目" tests/e2e/ --include="*.js" --include="*.py" --include="*.mjs"
```

### 5.2 巡检侧验收

在 Neon SQL Editor 中执行：
```sql
-- 1. 验证视图创建
SELECT * FROM v_global_overview;

-- 2. 验证超时检测
SELECT * FROM v_timeout_tasks;

-- 3. 验证阶段推进检测
SELECT fn_check_phase_completion('phase-0');
```

### 5.3 简报生成验收

```bash
# 生成 Phase-0 简报
node scripts/generate-iteration-report.js --phase phase-0

# 检查输出文件
ls reports/audit/iteration_report_phase-0_*.md
```

---

## 六、注意事项

1. **素材只读原则**: `测试项目/` 目录为只读，测试过程中不得修改、删除、添加任何文件
2. **Neon 连接**: 确保 Neon MCP 已正确配置数据库连接字符串
3. **GitHub 权限**: 确保 GitHub MCP 有对仓库的写入权限
4. **Playwright 浏览器**: 首次运行需安装 Playwright 浏览器: `npx playwright install chromium`
5. **并行限制**: 多个测试脚本不应同时在同一个 Neon 数据库操作，避免状态冲突
6. **报告归档**: 生成的测试报告和简报均为只读历史记录，不得事后修改

---

> **本文档由项目监理维护，每次测试体系变更后同步更新。**
