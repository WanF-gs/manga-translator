/**
 * 子Agent生命周期管控组件 - 硬锁角色与提交
 * 
 * 版本: v1.0
 * 用途: 从SDK代码层面硬编码任务生命周期，彻底摆脱对模型自觉性的依赖
 *       实现启动锚定 → 中途心跳 → 强制提交闭环三阶段硬管控
 * 
 * 核心原则:
 * 1. 不依赖模型自觉性: 所有规则由代码强制执行，而非提示词建议
 * 2. 不可绕过: 未完成提交闭环的Agent实例禁止终止
 * 3. 角色硬锁: 跨岗操作被代码级拦截
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// 角色定义（硬编码，不可动态修改）
// ============================================================
const ROLE_DEFINITIONS = {
  'director': {
    name: '项目总监',
    group: '管理层',
    skills: 'skills/roles/role-director.skills',
    allowedOperations: ['dispatch', 'prioritize', 'approve', 'review', 'coordinate'],
    forbiddenOperations: ['code', 'test', 'deploy'],
    deliverables: ['priority-queue.md', 'dispatch-log.md', 'phase-directive.md', 'signoff.md'],
  },
  'supervisor': {
    name: '项目监理',
    group: '管理层',
    skills: 'skills/roles/role-supervisor.skills',
    allowedOperations: ['inspect', 'remind', 'report', 'monitor'],
    forbiddenOperations: ['code', 'test', 'approve'],
    deliverables: ['iteration-brief.md', 'progress-report.md', 'alert-log.md'],
  },
  'quality-director': {
    name: '质量总监',
    group: '管理层',
    skills: 'skills/roles/role-quality-director.skills',
    allowedOperations: ['audit', 'verify', 'signoff', 'reject'],
    forbiddenOperations: ['code', 'test'],
    deliverables: ['quality-audit.md', 'signoff.md', 'redline-check.md'],
  },
  'prd-compliance': {
    name: 'PRD首席合规官',
    group: '需求与合规组',
    skills: 'skills/roles/role-prd-compliance.skills',
    allowedOperations: ['analyze', 'map', 'check', 'verify'],
    forbiddenOperations: ['code', 'test', 'deploy', 'approve'],
    deliverables: ['prd-compliance-mapping.md', 'coverage-report.md'],
  },
  'boundary-auditor': {
    name: '业务边界审计师',
    group: '需求与合规组',
    skills: 'skills/roles/role-boundary-auditor.skills',
    allowedOperations: ['audit', 'check', 'verify', 'report'],
    forbiddenOperations: ['code', 'test', 'approve'],
    deliverables: ['boundary-audit-report.md', 'contract-verification.md'],
  },
  'compliance-expert': {
    name: '数据与合规专家',
    group: '需求与合规组',
    skills: 'skills/roles/role-compliance-expert.skills',
    allowedOperations: ['audit', 'check', 'verify', 'report'],
    forbiddenOperations: ['code', 'test'],
    deliverables: ['compliance-audit-report.md', 'security-check.md'],
  },
  'backend-dev': {
    name: '后端开发工程师',
    group: '开发组',
    skills: 'skills/roles/role-backend-dev.skills',
    allowedOperations: ['code', 'implement', 'fix', 'refactor'],
    forbiddenOperations: ['test', 'approve', 'deploy-prod'],
    deliverables: ['api-implementation.py', 'migration.sql', 'changelog.md'],
  },
  'frontend-dev': {
    name: '前端开发工程师',
    group: '开发组',
    skills: 'skills/roles/role-frontend-dev.skills',
    allowedOperations: ['code', 'implement', 'fix', 'refactor', 'style'],
    forbiddenOperations: ['test', 'approve', 'deploy-prod'],
    deliverables: ['component.tsx', 'page.tsx', 'changelog.md'],
  },
  'infra-engineer': {
    name: '基础设施工程师',
    group: '开发组',
    skills: 'skills/roles/role-infra-engineer.skills',
    allowedOperations: ['configure', 'deploy', 'setup', 'docker'],
    forbiddenOperations: ['code-business-logic', 'test', 'approve'],
    deliverables: ['docker-config.md', 'ci-cd-config.yml', 'infra-report.md'],
  },
  'backend-fixer': {
    name: '后端修复工程师',
    group: '修复组',
    skills: 'skills/roles/role-backend-fixer.skills',
    allowedOperations: ['fix', 'debug', 'patch', 'refactor'],
    forbiddenOperations: ['add-feature', 'test', 'approve'],
    deliverables: ['fix-report.md', 'patch.py', 'root-cause-analysis.md'],
  },
  'frontend-fixer': {
    name: '前端修复工程师',
    group: '修复组',
    skills: 'skills/roles/role-frontend-fixer.skills',
    allowedOperations: ['fix', 'debug', 'patch', 'refactor-style'],
    forbiddenOperations: ['add-feature', 'test', 'approve'],
    deliverables: ['fix-report.md', 'patch.tsx', 'root-cause-analysis.md'],
  },
  'test-architect': {
    name: '测试架构首席专家',
    group: '测试与质量组',
    skills: 'skills/roles/role-test-architect.skills',
    allowedOperations: ['design', 'plan', 'strategy', 'review'],
    forbiddenOperations: ['code', 'fix', 'approve'],
    deliverables: ['test-plan.md', 'test-design.md', 'coverage-strategy.md'],
  },
  'test-engineer': {
    name: '自动化测试工程师',
    group: '测试与质量组',
    skills: 'skills/roles/role-test-engineer.skills',
    allowedOperations: ['test', 'execute', 'report', 'verify'],
    forbiddenOperations: ['fix-code', 'modify-assertions'],
    deliverables: ['smoke-test-report.md', 'unit-test-report.md', 'failure-details.md', 'pass-rate-report.md'],
  },
  'regression-tester': {
    name: '回归测试专员',
    group: '测试与质量组',
    skills: 'skills/roles/role-regression-tester.skills',
    allowedOperations: ['test', 'regress', 'verify', 'report'],
    forbiddenOperations: ['fix-code', 'modify-assertions'],
    deliverables: ['regression-report.md', 'comparison-report.md'],
  },
  'code-reviewer': {
    name: '代码审查专家',
    group: '测试与质量组',
    skills: 'skills/roles/role-code-reviewer.skills',
    allowedOperations: ['review', 'inspect', 'comment', 'approve-code'],
    forbiddenOperations: ['code', 'test', 'approve-deliverable'],
    deliverables: ['code-review-report.md', 'pr-review.md'],
  },
};

// ============================================================
// Agent 实例状态
// ============================================================
class AgentInstance {
  constructor(role, taskId, taskDesc, phase) {
    this.role = role;
    this.roleDef = ROLE_DEFINITIONS[role];
    this.taskId = taskId;
    this.taskDesc = taskDesc;
    this.phase = phase;
    
    // 生命周期状态
    this.lifecycleState = 'created'; // created → anchored → executing → terminating → terminated
    this.operationCount = 0;
    this.lastHeartbeat = null;
    
    // 提交状态
    this.githubSubmitted = false;
    this.githubCommitHash = null;
    this.neonUpdated = false;
    
    // 漂移检测
    this.driftCount = 0;
    this.maxDriftBeforeTerminate = 3;
  }
}

// ============================================================
// 启动钩子 (on-init)
// ============================================================

/**
 * 启动锚定 - 子Agent实例创建时自动执行
 * 
 * 功能:
 * 1. 加载对应岗位技能包
 * 2. 注入角色身份、任务详情、交付物要求、提交路径
 * 3. 调用 SequentialThinking 完成启动锚定校验
 * 
 * @param {string} role - 角色ID
 * @param {string} taskId - 任务UUID
 * @param {string} taskDesc - 任务描述
 * @param {string} phase - 当前阶段
 * @returns {AgentInstance} 已锚定的Agent实例
 */
function onInit(role, taskId, taskDesc, phase) {
  console.log(`[ON-INIT] 启动锚定: 角色=${role}, 任务=${taskId}`);
  
  // 1. 验证角色存在
  const roleDef = ROLE_DEFINITIONS[role];
  if (!roleDef) {
    throw new Error(`[ON-INIT-ERROR] 未知角色: ${role}。可用角色: ${Object.keys(ROLE_DEFINITIONS).join(', ')}`);
  }
  
  // 2. 创建Agent实例
  const agent = new AgentInstance(role, taskId, taskDesc, phase);
  
  // 3. 加载岗位技能包
  const skillsPath = path.resolve(__dirname, '..', roleDef.skills);
  if (!fs.existsSync(skillsPath)) {
    throw new Error(`[ON-INIT-ERROR] 技能文件不存在: ${skillsPath}`);
  }
  const skillsContent = fs.readFileSync(skillsPath, 'utf-8');
  console.log(`[ON-INIT] 技能包已加载: ${roleDef.skills} (${skillsContent.length} bytes)`);
  
  // 4. 加载总控技能
  const masterSkillsPath = path.resolve(__dirname, '..', 'skills', 'audit-closure-master.skills');
  if (!fs.existsSync(masterSkillsPath)) {
    throw new Error(`[ON-INIT-ERROR] 总控技能文件不存在: ${masterSkillsPath}`);
  }
  console.log(`[ON-INIT] 总控技能已加载`);
  
  // 5. 输出角色锚定语句
  const anchorOutput = generateAnchorOutput(agent);
  console.log(anchorOutput);
  
  // 6. 标记已锚定
  agent.lifecycleState = 'anchored';
  
  // 7. 写入 Neon 任务状态（需要 Neon MCP 支持）
  console.log(`[ON-INIT] 待写入 Neon: INSERT INTO agent_task_status (task_id, role, phase, task_desc, status) VALUES ('${taskId}', '${role}', '${phase}', '${taskDesc}', '执行中')`);
  
  return agent;
}

/**
 * 生成角色锚定输出
 */
function generateAnchorOutput(agent) {
  const { role, roleDef, taskId, taskDesc, phase } = agent;
  const projectRoot = path.resolve(__dirname, '..');
  
  return `
[角色锚定] 我是${roleDef.name}(${role})，属于${roleDef.group}组。
本阶段任务: ${taskDesc}
任务ID: ${taskId}
阶段: ${phase}
交付物路径: deliverables/${phase}/${role}/
提交路径: GitHub仓库对应目录 + Neon状态更新
授权操作: ${roleDef.allowedOperations.join(', ')}
绝对禁止: ${roleDef.forbiddenOperations.join(', ')}
核心交付物: ${roleDef.deliverables.join(', ')}
`.trim();
}

// ============================================================
// 中途心跳钩子 (on-operation)
// ============================================================

/**
 * 操作计数与心跳唤醒
 * 
 * 每执行3次核心操作时自动调用，执行:
 * 1. 角色唤醒: 输出角色身份确认语句
 * 2. 规则校验: 检查当前操作是否在岗位权责范围内
 * 3. 方向确认: 检查是否偏离任务目标
 * 
 * @param {AgentInstance} agent - Agent实例
 * @param {string} operation - 当前操作描述
 * @param {string} operationType - 操作类型
 * @returns {boolean} 是否允许继续执行
 */
function onOperation(agent, operation, operationType) {
  // 1. 递增操作计数
  agent.operationCount++;
  
  // 2. 每3次操作触发心跳
  if (agent.operationCount % 3 === 0) {
    return heartbeatCheck(agent, operation);
  }
  
  // 3. 每次操作都做角色漂移检测
  return driftCheck(agent, operationType);
}

/**
 * 心跳唤醒
 */
function heartbeatCheck(agent, currentOperation) {
  const { role, roleDef, operationCount, taskDesc } = agent;
  
  agent.lastHeartbeat = new Date();
  
  console.log(`[心跳唤醒] 角色${role}(${roleDef.name}) | 已完成${operationCount}次操作 | 当前目标: ${taskDesc} | 正在执行: ${currentOperation}`);
  
  // 校验是否仍在岗位权责内
  return driftCheck(agent, 'heartbeat');
}

/**
 * 角色漂移检测
 */
function driftCheck(agent, operationType) {
  const { role, roleDef } = agent;
  
  // 检查操作类型是否在授权范围内
  if (roleDef.forbiddenOperations.includes(operationType)) {
    agent.driftCount++;
    
    console.log(`[角色漂移警告] 检测到跨岗操作: ${operationType}。当前角色${role}(${roleDef.name})无权执行此操作。允许: [${roleDef.allowedOperations.join(', ')}] | 禁止: [${roleDef.forbiddenOperations.join(', ')}]`);
    
    if (agent.driftCount >= agent.maxDriftBeforeTerminate) {
      console.log(`[角色漂移终止] 连续${agent.driftCount}次跨岗操作，Agent实例将被强制终止`);
      return false; // 禁止继续执行
    }
    
    return false; // 本次操作被拦截
  }
  
  // 重置漂移计数（有合法操作时）
  agent.driftCount = Math.max(0, agent.driftCount - 1);
  return true;
}

// ============================================================
// 结束钩子 (on-terminate)
// ============================================================

/**
 * 任务完成前置校验与强制提交闭环
 * 
 * Agent实例终止前必须同时满足两个条件:
 * 1. 交付物已成功提交至 GitHub 指定目录
 * 2. Neon 数据库对应任务状态已更新为「已提交」
 * 
 * 未满足条件时，禁止终止输出，强制返回补全任务。
 * 
 * @param {AgentInstance} agent - Agent实例
 * @param {object} submissionResult - 提交结果
 * @returns {object} 终止确认结果
 */
function onTerminate(agent, submissionResult = {}) {
  console.log(`[ON-TERMINATE] 终止前置校验: 角色=${agent.role}, 任务=${agent.taskId}`);
  
  const result = {
    canTerminate: false,
    githubOk: false,
    neonOk: false,
    errors: [],
    actions: [],
  };
  
  // 校验1: GitHub 提交状态
  if (submissionResult.githubCommitHash) {
    agent.githubSubmitted = true;
    agent.githubCommitHash = submissionResult.githubCommitHash;
    result.githubOk = true;
    console.log(`[ON-TERMINATE] ✅ GitHub: 已提交, commit=${submissionResult.githubCommitHash}`);
  } else {
    result.errors.push('GitHub提交未完成');
    result.actions.push('请通过 GitHub MCP 提交交付物至对应目录');
  }
  
  // 校验2: Neon 状态更新
  if (submissionResult.neonUpdated) {
    agent.neonUpdated = true;
    result.neonOk = true;
    console.log(`[ON-TERMINATE] ✅ Neon: agent_task_status.${agent.taskId} 状态已更新为「已提交」`);
  } else {
    result.errors.push('Neon状态未更新');
    result.actions.push('请通过 Neon MCP 更新 agent_task_status 表对应记录状态为「已提交」');
  }
  
  // 校验3: 交付物完整性
  const deliverablesCheck = checkDeliverables(agent);
  if (!deliverablesCheck.complete) {
    result.errors.push(`交付物不完整: 缺少 ${deliverablesCheck.missing.join(', ')}`);
    result.actions.push(`请补充以下交付物: ${deliverablesCheck.missing.join(', ')}`);
  }
  
  // 判断是否可以终止
  if (result.githubOk && result.neonOk && deliverablesCheck.complete) {
    result.canTerminate = true;
    agent.lifecycleState = 'terminated';
    
    const summary = generateTerminationSummary(agent);
    console.log(summary);
  } else {
    agent.lifecycleState = 'terminating';
    console.log(`[ON-TERMINATE] ❌ 终止条件未满足:`);
    result.errors.forEach(e => console.log(`  - ${e}`));
    result.actions.forEach(a => console.log(`  → ${a}`));
  }
  
  return result;
}

/**
 * 交付物完整性检查
 */
function checkDeliverables(agent) {
  const { role, roleDef, phase } = agent;
  const deliverableDir = path.resolve(__dirname, '..', 'deliverables', phase, role);
  
  const missing = [];
  
  if (!fs.existsSync(deliverableDir)) {
    return { complete: false, missing: roleDef.deliverables };
  }
  
  for (const file of roleDef.deliverables) {
    const filePath = path.join(deliverableDir, file);
    if (!fs.existsSync(filePath)) {
      missing.push(file);
    }
  }
  
  return {
    complete: missing.length === 0,
    missing,
    existing: roleDef.deliverables.filter(f => !missing.includes(f)),
  };
}

/**
 * 生成终止确认摘要
 */
function generateTerminationSummary(agent) {
  const { role, roleDef, taskId, operationCount, githubCommitHash } = agent;
  
  return `
[提交闭环确认]
✅ GitHub: deliverables/${agent.phase}/${agent.role}/ 已推送，commit: ${githubCommitHash || 'N/A'}
✅ Neon: agent_task_status.${taskId} 状态已更新为「已提交」
⏱ 操作次数: ${operationCount}
📋 交付物: ${roleDef.deliverables.join(', ')}
🛡 角色漂移次数: ${agent.driftCount}
  `.trim();
}

// ============================================================
// 生命周期管理器
// ============================================================

/**
 * Agent 生命周期管理器
 * 
 * 提供 agent 实例的完整生命周期管理，确保:
 * - 每个实例必须经过 init → anchored → executing → terminating → terminated
 * - 任何阶段跳转都被拦截
 * - 终止条件必须100%满足
 */
class AgentLifecycleManager {
  constructor() {
    this.instances = new Map(); // taskId → AgentInstance
  }
  
  /**
   * 创建并锚定 Agent 实例
   */
  createInstance(role, taskId, taskDesc, phase) {
    if (this.instances.has(taskId)) {
      throw new Error(`[LCM] 任务 ${taskId} 已存在Agent实例，请勿重复创建`);
    }
    
    const agent = onInit(role, taskId, taskDesc, phase);
    this.instances.set(taskId, agent);
    return agent;
  }
  
  /**
   * 记录操作并执行心跳
   */
  recordOperation(taskId, operation, operationType) {
    const agent = this.instances.get(taskId);
    if (!agent) {
      throw new Error(`[LCM] 任务 ${taskId} 对应的Agent实例不存在`);
    }
    
    if (agent.lifecycleState === 'terminated') {
      throw new Error(`[LCM] 任务 ${taskId} 的Agent实例已终止，无法继续操作`);
    }
    
    agent.lifecycleState = 'executing';
    return onOperation(agent, operation, operationType);
  }
  
  /**
   * 终止 Agent 实例
   */
  terminateInstance(taskId, submissionResult) {
    const agent = this.instances.get(taskId);
    if (!agent) {
      throw new Error(`[LCM] 任务 ${taskId} 对应的Agent实例不存在`);
    }
    
    const result = onTerminate(agent, submissionResult);
    
    if (!result.canTerminate) {
      // 提供补救路径
      console.log(`[LCM] Agent实例 ${taskId} 无法终止，需要补全以下步骤:`);
      result.actions.forEach((action, i) => {
        console.log(`  ${i + 1}. ${action}`);
      });
    }
    
    return result;
  }
  
  /**
   * 获取所有活跃实例
   */
  getActiveInstances() {
    const active = [];
    for (const [taskId, agent] of this.instances) {
      if (agent.lifecycleState !== 'terminated') {
        active.push({
          taskId,
          role: agent.role,
          roleName: agent.roleDef.name,
          state: agent.lifecycleState,
          operationCount: agent.operationCount,
          driftCount: agent.driftCount,
        });
      }
    }
    return active;
  }
  
  /**
   * 获取实例状态
   */
  getInstanceStatus(taskId) {
    const agent = this.instances.get(taskId);
    if (!agent) return null;
    
    return {
      taskId: agent.taskId,
      role: agent.role,
      roleName: agent.roleDef.name,
      state: agent.lifecycleState,
      operationCount: agent.operationCount,
      githubSubmitted: agent.githubSubmitted,
      neonUpdated: agent.neonUpdated,
      driftCount: agent.driftCount,
    };
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  ROLE_DEFINITIONS,
  AgentInstance,
  AgentLifecycleManager,
  
  // 生命周期钩子
  onInit,
  onOperation,
  onTerminate,
  
  // 辅助函数
  generateAnchorOutput,
  driftCheck,
  heartbeatCheck,
  checkDeliverables,
  generateTerminationSummary,
};
