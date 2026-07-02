# 技能触发规则与说明文档

> 版本: v2.0
> 适用范围: 漫画多语言智能翻译与图像合成系统 - 多Agent测试审计闭环
> 依赖: skills/audit-closure-master.skills v2.0 + skills/roles/*.skills (17个技能包)
> 更新说明: v2.0 新增测试用例审计师岗位，增补黑盒规则、素材强制规则、MCP/插件全量绑定规则的触发机制

---

## 一、技能架构总览

本项目技能体系采用「1+N」层级架构：

| 层级 | 技能包 | 触发级别 | 说明 |
|------|--------|---------|------|
| L0 总控层 | `audit-closure-master.skills` (v2.0) | 项目级自动 | 全局规则，所有子Agent强制加载，含黑盒隔离/素材铁则/MCP全量绑定/跨岗防火墙/违规触发 |
| L1 岗位层 | `roles/role-{id}.skills` | 任务级自动 | 17个岗位专属（新增测试用例审计师），按任务角色触发 |

总控技能 v2.0 在原有9条质量红线、8项终止条件基础上，增补了全局测试素材铁则、MCP/插件全量强制绑定（7款MCP+2款插件）、全局黑盒权责隔离原则、跨岗信息防火墙、违规触发机制五大模块。17个岗位子技能分别定义各自的身份、权责、交付物、工具绑定和完成标准。

---

## 二、触发机制详解

### 2.1 项目级触发（Level 0）

**触发条件**: 打开或切换到 `demo_04` 项目工作区。

**自动加载**: `skills/audit-closure-master.skills` (v2.0)

**生效范围**: 所有在此项目上下文中运行的子Agent实例，无论承接什么岗位任务，都必须遵守总控技能中的全局规则，包括：

- 9条全局质量红线（R1-R9）
- 8项全局终止条件（T1-T8）
- 全局测试素材铁则（最高强制级）
- 7款MCP+2款插件强制绑定规则
- 全局黑盒权责隔离原则
- 跨岗信息防火墙
- 违规触发与累计处罚机制

**实现方式**: 
- 项目根目录存在 `skills/audit-closure-master.skills` 文件时，CodeBuddy IDE 自动识别并加载
- 所有子Agent的system prompt中应包含对该技能文件的引用

### 2.2 任务级触发（Level 1）

**触发条件**: 子Agent承接特定岗位任务。触发关键词映射如下：

| 触发关键词 | 加载技能 |
|-----------|---------|
| 优先级排序、任务派发、终止条件判定、双签验收 | `role-director.skills` |
| 巡检、催办、迭代简报、进度汇报 | `role-supervisor.skills` |
| 质量验收、红线校验、终验判定 | `role-quality-director.skills` |
| PRD对标、功能覆盖检查、条款映射 | `role-prd-compliance.skills` |
| 边界审计、越权检查、接口契约校验 | `role-boundary-auditor.skills` |
| 合规审计、数据合规、安全审计 | `role-compliance-expert.skills` |
| 后端开发、API实现、数据库修改 | `role-backend-dev.skills` |
| 前端开发、UI实现、组件开发 | `role-frontend-dev.skills` |
| 基础设施、Docker配置、CI/CD | `role-infra-engineer.skills` |
| 后端修复、Bug修复、后端故障排查 | `role-backend-fixer.skills` |
| 前端修复、UI修复、前端故障排查 | `role-frontend-fixer.skills` |
| 测试设计、测试方案、用例设计、测试体系、黑盒用例 | `role-test-architect.skills` (v2.0 黑盒版) |
| 执行测试、Playwright测试、冒烟测试、E2E测试、测试报告、黑盒执行 | `role-test-engineer.skills` (v2.0 黑盒版) |
| 测试审计、用例审计、审计测试、黑盒复核、合规审计测试 | `role-test-auditor.skills` (v1.0 新增) |
| 回归测试、全量回归、测试验证 | `role-regression-tester.skills` |
| 代码审查、PR审查、代码质量检查 | `role-code-reviewer.skills` |

**重叠处理规则**: 当一条任务匹配多个岗位关键词时，按以下优先级选取：
1. 直接声明角色名称 → 最高优先级
2. 核心动词匹配（如"审计"优先于"查看"）
3. 岗位权责范围包含度（范围越窄匹配越精确）

### 2.3 操作级触发（Level 2）

**触发条件**: 子Agent每执行3次核心操作（文件读取、代码修改、分析操作）。

**自动动作**:
1. 输出心跳唤醒锚定语句：`[心跳唤醒] 角色{角色ID} | 已完成{count}次操作 | 当前目标: {sub-goal} | 下一步: {next-action}`
2. 校验当前操作是否在岗位权责范围内
3. 若检测到角色漂移（跨岗操作），自动拦截并输出警告

**计数规则**:
- 以下操作计入核心操作计数: `read_file`, `replace_in_file`, `write_to_file`, `execute_command`, `search_content`, `search_file`
- 以下操作不计入: `list_dir`, 对话文本输出, 状态查询
- 计数器在每个子Agent实例内独立维护，任务完成时重置

### 2.4 黑盒规则触发（Level 2-B 新增）

**触发条件**: 测试与质量组角色执行任何文件读取操作时。

**自动校验**:
1. 检查读取的文件路径是否位于业务源代码目录（src/、app/、server/、api/、components/、internal/、cmd/、manga-translator-backend/ 下的服务实现子目录）
2. 若命中禁止目录，自动拦截并输出：`[黑盒隔离警告] 检测到越界访问: {文件路径}。测试岗禁止读取业务源代码，操作已拦截。`
3. 拦截记录写入 Neon agent_task_status 表

**触发条件**: 开发实现组角色读取测试用例目录文件时。

**自动校验**:
1. 检查读取的文件路径是否位于 tests/、e2e/ 下的测试脚本源码
2. 若命中，自动拦截并输出：`[信息防火墙警告] 检测到越界访问: {文件路径}。开发岗禁止查看测试用例源码，操作已拦截。`

### 2.5 素材规则触发（Level 2-C 新增）

**触发条件**: 任何角色在测试相关任务中引用文件路径时。

**自动校验**:
1. 检查文件路径是否以 `测试项目/` 为前缀
2. 若路径不包含 `测试项目/` 前缀，自动拦截并输出：`[素材违规警告] 检测到非指定目录素材: {文件路径}。唯一合法测试素材目录为「测试项目/」，操作已拦截。`
3. 违规记录写入 Neon

**触发条件**: 测试用例审计师审计素材路径时。

**强制校验**:
1. 扫描所有用例中的素材引用路径
2. 非 `测试项目/` 路径的用例结果直接作废
3. 输出素材合规审计报告

### 2.6 工具绑定规则触发（Level 2-D 新增）

**触发条件**: 子Agent执行以下关键操作时，检查对应MCP/插件是否已调用：

| 关键操作 | 强制绑定工具 | 无记录动作 |
|---------|------------|-----------|
| PRD对标/功能拆解 | Firecrawl MCP | 拦截并提示：请使用Firecrawl抓取PRD原文后再进行功能判定 |
| 页面测试/E2E测试 | Playwright MCP | 拦截并提示：请使用Playwright在真实浏览器中执行测试，纯接口调用结果无效 |
| 任务状态变更 | Neon MCP | 拦截并提示：请通过Neon同步任务状态，口头更新无效 |
| 交付物提交 | GitHub MCP | 拦截并提示：请通过GitHub提交交付物，本地保存不算正式交付 |
| 任务启动 | SequentialThinking | 拦截并提示：请先调用SequentialThinking完成六项锚定 |
| 测试环境配置 | webapp-testing 插件 | 拦截并提示：请使用webapp-testing插件管理测试环境 |
| 数据统计/简报 | data 插件 | 拦截并提示：请使用data插件生成统计报告 |

### 2.7 违规累计触发（Level 3 新增）

**触发条件**: 同一角色在 Neon 中累计违规次数达到阈值。

| 累计次数 | 触发动作 | 执行角色 |
|---------|---------|---------|
| 1次 | 任务标记为「违规警告」，本轮结果纳入审计复核 | 测试用例审计师 |
| 2次 | 触发质量红线回退，代码回退至上一全量通过版本，本轮全部作废 | 项目监理 |
| 3次 | 暂停该岗位操作权限，通知项目总监人工介入 | 项目总监 |

---

## 三、技能加载验证方法

### 3.1 项目级加载验证

在子Agent启动时检查其是否输出了以下任一内容：
- 质量红线引用（R1-R9中的任意一条）
- 终止条件引用（T1-T8中的任意一条）
- MCP/插件强制规约引用
- 黑盒隔离规则引用
- 素材铁则引用

若启动后5轮对话内未出现上述内容，说明总控技能未正确加载，需要手动触发重新加载。

### 3.2 任务级加载验证

检查子Agent输出的角色锚定语句是否包含：
- 角色身份声明（含所属组别）
- 信息域声明（测试域/开发域/管控域）
- 交付物路径
- 岗位权责边界描述（含绝对禁止项）
- 强制绑定工具声明

缺少任一要素说明岗位技能未正确加载。

### 3.3 黑盒隔离验证

测试与质量组角色启动后，验证是否：
- 声明了「不得读取业务源代码」
- 未读取 src/、app/、server/、api/ 等业务源码目录
- 功能判定仅基于页面操作结果

### 3.4 操作级触发验证

统计子Agent操作序列，每3次核心操作后检查是否输出心跳唤醒语句。连续2个周期无心跳输出视为触发失效。

---

## 四、技能修改与更新流程

1. 任何人对技能文件的修改必须经过项目总监审批
2. 修改后需要重新加载才能生效（重启子Agent实例或手动触发技能刷新）
3. 每次修改后必须在本文档末尾追加变更记录
4. 技能文件版本号必须与PRD版本保持同步

---

## 五、技能与团队角色的映射关系

| # | 角色 | 技能ID | 组别 | GitHub提交路径 |
|---|------|--------|------|---------------|
| 1 | 项目总监 | role-director | 管理层 | deliverables/phase-{N}/director/ |
| 2 | 项目监理 | role-supervisor | 管理层 | deliverables/phase-{N}/supervisor/ |
| 3 | 质量总监 | role-quality-director | 管理层 | deliverables/phase-{N}/quality-director/ |
| 4 | PRD首席合规官 | role-prd-compliance | 需求与合规组 | deliverables/phase-{N}/prd-compliance/ |
| 5 | 业务边界审计师 | role-boundary-auditor | 需求与合规组 | deliverables/phase-{N}/boundary-auditor/ |
| 6 | 数据与合规专家 | role-compliance-expert | 需求与合规组 | deliverables/phase-{N}/compliance-expert/ |
| 7 | 后端开发工程师 | role-backend-dev | 开发组 | deliverables/phase-{N}/backend-dev/ |
| 8 | 前端开发工程师 | role-frontend-dev | 开发组 | deliverables/phase-{N}/frontend-dev/ |
| 9 | 基础设施工程师 | role-infra-engineer | 开发组 | deliverables/phase-{N}/infra-engineer/ |
| 10 | 后端修复工程师 | role-backend-fixer | 修复组 | deliverables/phase-{N}/backend-fixer/ |
| 11 | 前端修复工程师 | role-frontend-fixer | 修复组 | deliverables/phase-{N}/frontend-fixer/ |
| 12 | 测试架构首席专家 | role-test-architect (v2.0) | 测试与质量组 | deliverables/phase-{N}/test-architect/ |
| 13 | 自动化测试工程师 | role-test-engineer (v2.0) | 测试与质量组 | deliverables/phase-{N}/test-engineer/ |
| 14 | 测试用例审计师 | role-test-auditor (v1.0 新增) | 测试与质量组 | deliverables/phase-{N}/test-auditor/ |
| 15 | 回归测试专员 | role-regression-tester | 测试与质量组 | deliverables/phase-{N}/regression-tester/ |
| 16 | 代码审查专家 | role-code-reviewer | 测试与质量组 | deliverables/phase-{N}/code-reviewer/ |

---

## 六、变更记录

| 日期 | 版本 | 变更内容 | 变更人 |
|------|------|---------|--------|
| 2026-06-26 | v2.0 | 新增黑盒隔离规则、素材强制规则、MCP/插件全量绑定规则、跨岗防火墙、违规触发机制的触发逻辑；新增测试用例审计师岗位（role-test-auditor）；测试架构师和测试工程师升级为v2.0黑盒版 | 系统自动生成 |

---

> **本文档由项目总监维护，每次技能文件变更后同步更新。**
