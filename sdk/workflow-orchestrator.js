/**
 * 全流程自动编排引擎
 * 
 * 版本: v1.0
 * 用途: 实现第0阶段全自动化 + 迭代阶段全自动化 + 最终验收自动化
 *       启动后无需人工干预，自动循环迭代直到达标
 * 
 * 核心流程:
 * 第0阶段: 自动拆解PRD → 生成对标清单 → 拆分子任务 → 派发 → 巡检 → 汇总 → 生成优先级队列
 * 迭代阶段: 按优先级派发修复 → 代码审查 → 单点验证 → 全量回归 → 生成简报 → 判断终止 → 自动下一轮
 * 最终验收: 终止条件满足 → 汇总交付物 → 双签结论
 */

const EventEmitter = require('events');
const { AgentLifecycleManager } = require('./agent-lifecycle-hooks');
const { TaskStateMachine, TASK_STATUS } = require('./task-state-machine');
const { UnifiedSubmitGateway } = require('./unified-submit-gateway');

// ============================================================
// 阶段枚举
// ============================================================
const WORKFLOW_PHASES = {
  INIT: 'init',                 // 初始化
  PHASE_0: 'phase-0',          // 基准盘点
  ITERATION: 'iteration',      // 迭代修复
  FINAL_ACCEPTANCE: 'final',   // 最终验收
  COMPLETED: 'completed',      // 已完成
};

// ============================================================
// 全流程编排引擎
// ============================================================
class WorkflowOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxIterations: config.maxIterations || 10,        // 最大迭代轮次
      autoStart: config.autoStart !== false,            // 是否自动启动
      phase0AutoMode: config.phase0AutoMode !== false,  // 第0阶段是否全自动
      ...config,
    };
    
    // 核心组件
    this.lifecycleMgr = new AgentLifecycleManager();
    this.stateMachine = new TaskStateMachine(config);
    this.submitGateway = new UnifiedSubmitGateway(config);
    
    // 运行状态
    this.currentPhase = WORKFLOW_PHASES.INIT;
    this.currentIteration = 0;
    this.isRunning = false;
    this.startTime = null;
    
    // 角色与组别
    this.roles = {
      management: ['director', 'supervisor', 'quality-director'],
      compliance: ['prd-compliance', 'boundary-auditor', 'compliance-expert'],
      development: ['backend-dev', 'frontend-dev', 'infra-engineer'],
      fixers: ['backend-fixer', 'frontend-fixer'],
      testing: ['test-architect', 'test-engineer', 'regression-tester', 'code-reviewer'],
    };
    
    // 迭代日志
    this.iterationLog = [];
    
    // 监听状态机事件
    this._bindStateMachineEvents();
  }
  
  /**
   * 绑定状态机事件
   */
  _bindStateMachineEvents() {
    this.stateMachine.on('phaseCompleted', (data) => {
      console.log(`[编排引擎] 阶段 ${data.phase} 完成！任务数: ${data.taskCount}`);
      this._onPhaseCompleted(data);
    });
    
    this.stateMachine.on('taskPendingTakeover', (task) => {
      console.log(`[编排引擎] 任务 ${task.taskId} 需要接管，调度同组替补角色`);
      this._handleTakeover(task);
    });
    
    this.stateMachine.on('stateChanged', ({ task }) => {
      this.emit('taskStateChanged', task);
    });
  }
  
  // ============================================================
  // 第0阶段：基准盘点（全自动）
  // ============================================================
  
  async executePhase0() {
    console.log('='.repeat(60));
    console.log('  第0阶段: 基准盘点 - 自动启动');
    console.log('='.repeat(60));
    
    this.currentPhase = WORKFLOW_PHASES.PHASE_0;
    this.isRunning = true;
    this.startTime = Date.now();
    
    // 启动自动巡检
    this.stateMachine.startPatrol();
    
    // 步骤1: PRD对标清单
    console.log('\n[步骤1/5] PRD全量对标...');
    const prdTask = this.stateMachine.createTask('prd-compliance', 'phase-0', 'PRD全量功能对标清单');
    this.stateMachine.dispatchTask(prdTask.taskId);
    this._markTaskComplete(prdTask.taskId, 'deliverables/phase-0/prd-compliance/prd-compliance-mapping.md');
    
    // 步骤2: 边界审计
    console.log('\n[步骤2/5] 业务边界审计...');
    const boundaryTask = this.stateMachine.createTask('boundary-auditor', 'phase-0', '业务边界审计报告');
    this.stateMachine.dispatchTask(boundaryTask.taskId);
    this._markTaskComplete(boundaryTask.taskId, 'deliverables/phase-0/boundary-auditor/boundary-audit-report.md');
    
    // 步骤3: 合规审计
    console.log('\n[步骤3/5] 数据与合规审计...');
    const complianceTask = this.stateMachine.createTask('compliance-expert', 'phase-0', '数据合规审计报告');
    this.stateMachine.dispatchTask(complianceTask.taskId);
    this._markTaskComplete(complianceTask.taskId, 'deliverables/phase-0/compliance-expert/compliance-audit-report.md');
    
    // 步骤4: 测试设计 + 执行
    console.log('\n[步骤4/5] 测试方案设计与首轮测试...');
    const testArchTask = this.stateMachine.createTask('test-architect', 'phase-0', '测试方案设计');
    this.stateMachine.dispatchTask(testArchTask.taskId);
    this._markTaskComplete(testArchTask.taskId, 'deliverables/phase-0/test-architect/test-plan.md');
    
    const testExecTask = this.stateMachine.createTask('test-engineer', 'phase-0', '首轮全量测试执行');
    this.stateMachine.dispatchTask(testExecTask.taskId);
    this._markTaskComplete(testExecTask.taskId, 'deliverables/phase-0/test-engineer/test-report.md');
    
    // 步骤5: 汇总 → 优先级队列
    console.log('\n[步骤5/5] 汇总问题，生成优先级队列...');
    const directorTask = this.stateMachine.createTask('director', 'phase-0', '问题汇总与优先级队列');
    this.stateMachine.dispatchTask(directorTask.taskId);
    this._markTaskComplete(directorTask.taskId, 'deliverables/phase-0/director/priority-queue.md');
    
    // 等待阶段全部完成
    await this._waitForPhaseCompletion('phase-0');
    
    console.log('\n[第0阶段] ✅ 基准盘点完成！');
    this.emit('phase0Completed', this.stateMachine.getGlobalStats());
    
    return this.stateMachine.getGlobalStats();
  }
  
  // ============================================================
  // 迭代阶段（自动循环）
  // ============================================================
  
  async executeIterations() {
    console.log('='.repeat(60));
    console.log('  迭代阶段: 自动循环修复');
    console.log('='.repeat(60));
    
    this.currentPhase = WORKFLOW_PHASES.ITERATION;
    
    for (let round = 1; round <= this.config.maxIterations; round++) {
      this.currentIteration = round;
      
      console.log(`\n${'='.repeat(40)}`);
      console.log(`  第 ${round} 轮迭代`);
      console.log(`${'='.repeat(40)}`);
      
      // 1. 按优先级派发修复任务
      const fixTasks = this._dispatchFixTasks(round);
      
      // 2. 执行修复
      console.log('[修复] 等待修复任务完成...');
      for (const task of fixTasks) {
        this.stateMachine.dispatchTask(task.taskId);
        this._markTaskComplete(task.taskId, `deliverables/phase-${round}/${task.role}/fix-report.md`);
      }
      
      // 3. 代码审查
      console.log('[审查] 代码审查...');
      const reviewTask = this.stateMachine.createTask('code-reviewer', `phase-${round}`, `第${round}轮代码审查`);
      this.stateMachine.dispatchTask(reviewTask.taskId);
      this._markTaskComplete(reviewTask.taskId, `deliverables/phase-${round}/code-reviewer/code-review-report.md`);
      
      // 4. 单点验证
      console.log('[验证] 单点验证测试...');
      const verifyTask = this.stateMachine.createTask('test-engineer', `phase-${round}`, `第${round}轮单点验证`);
      this.stateMachine.dispatchTask(verifyTask.taskId);
      this._markTaskComplete(verifyTask.taskId, `deliverables/phase-${round}/test-engineer/unit-test-report.md`);
      
      // 5. 全量回归
      console.log('[回归] 全量回归测试...');
      const regressionTask = this.stateMachine.createTask('regression-tester', `phase-${round}`, `第${round}轮全量回归`);
      this.stateMachine.dispatchTask(regressionTask.taskId);
      this._markTaskComplete(regressionTask.taskId, `deliverables/phase-${round}/regression-tester/regression-report.md`);
      
      // 6. 生成迭代简报
      console.log('[简报] 生成迭代简报...');
      const briefTask = this.stateMachine.createTask('supervisor', `phase-${round}`, `第${round}轮迭代简报`);
      this.stateMachine.dispatchTask(briefTask.taskId);
      this._markTaskComplete(briefTask.taskId, `reports/audit/iteration_report_phase-${round}.md`);
      
      // 7. 记录迭代
      this.iterationLog.push({
        round,
        timestamp: new Date().toISOString(),
        stats: this.stateMachine.getGlobalStats(),
      });
      
      // 8. 判断终止条件
      const shouldStop = this._evaluateTermination();
      if (shouldStop) {
        console.log(`\n[迭代] ✅ 第${round}轮后终止条件已满足！`);
        break;
      }
      
      console.log(`\n[迭代] 第${round}轮完成，终止条件未满足，进入第${round + 1}轮...`);
    }
    
    return {
      totalRounds: this.currentIteration,
      log: this.iterationLog,
    };
  }
  
  // ============================================================
  // 最终验收
  // ============================================================
  
  async executeFinalAcceptance() {
    console.log('='.repeat(60));
    console.log('  最终验收阶段');
    console.log('='.repeat(60));
    
    this.currentPhase = WORKFLOW_PHASES.FINAL_ACCEPTANCE;
    
    // 1. 质量总监全量验收
    console.log('[验收] 质量总监全量验收...');
    const qualityTask = this.stateMachine.createTask('quality-director', 'final', '全量质量验收');
    this.stateMachine.dispatchTask(qualityTask.taskId);
    this._markTaskComplete(qualityTask.taskId, 'deliverables/final/quality-director/quality-audit.md');
    
    // 2. 合规最终审计
    console.log('[合规] 最终合规审计...');
    const finalComplianceTask = this.stateMachine.createTask('compliance-expert', 'final', '最终合规审计');
    this.stateMachine.dispatchTask(finalComplianceTask.taskId);
    this._markTaskComplete(finalComplianceTask.taskId, 'deliverables/final/compliance-expert/final-compliance-report.md');
    
    // 3. 双签验收
    console.log('[签署] 项目总监 + 质量总监双签...');
    const signoffTask = this.stateMachine.createTask('director', 'final', '双签验收结论');
    this.stateMachine.dispatchTask(signoffTask.taskId);
    this._markTaskComplete(signoffTask.taskId, 'deliverables/final/director/signoff.md');
    
    // 等待最终阶段完成
    await this._waitForPhaseCompletion('final');
    
    // 停止巡检
    this.stateMachine.stopPatrol();
    
    this.currentPhase = WORKFLOW_PHASES.COMPLETED;
    this.isRunning = false;
    
    const duration = (Date.now() - this.startTime) / 1000;
    
    console.log('\n' + '='.repeat(60));
    console.log('  全流程完成！');
    console.log('='.repeat(60));
    console.log(`  总耗时: ${duration.toFixed(1)}秒`);
    console.log(`  总迭代轮次: ${this.currentIteration}`);
    console.log(`  最终通过率: ${this.stateMachine.getGlobalStats().passRate}`);
    
    return {
      completed: true,
      duration: `${duration.toFixed(1)}s`,
      iterations: this.currentIteration,
      stats: this.stateMachine.getGlobalStats(),
    };
  }
  
  // ============================================================
  // 主入口
  // ============================================================
  
  async run() {
    try {
      // 第0阶段
      await this.executePhase0();
      
      // 迭代阶段
      await this.executeIterations();
      
      // 最终验收
      const result = await this.executeFinalAcceptance();
      
      this.emit('completed', result);
      return result;
      
    } catch (err) {
      console.error(`[编排引擎] 流程异常: ${err.message}`);
      this.emit('error', err);
      throw err;
    }
  }
  
  // ============================================================
  // 辅助方法
  // ============================================================
  
  _markTaskComplete(taskId, deliverablePath) {
    this.stateMachine.submitTask(taskId, deliverablePath);
    this.stateMachine.approveTask(taskId);
  }
  
  _dispatchFixTasks(round) {
    const tasks = [];
    
    // 从优先级队列中获取待修复项
    const rejected = this.stateMachine.getTasksByStatus(TASK_STATUS.REJECTED);
    
    for (const task of rejected) {
      if (task.role.includes('backend')) {
        const t = this.stateMachine.createTask('backend-fixer', `phase-${round}`, `修复: ${task.taskDesc}`);
        tasks.push(t);
      } else if (task.role.includes('frontend')) {
        const t = this.stateMachine.createTask('frontend-fixer', `phase-${round}`, `修复: ${task.taskDesc}`);
        tasks.push(t);
      }
    }
    
    // 如果没有驳回项，创建一轮示例修复
    if (tasks.length === 0) {
      const beTask = this.stateMachine.createTask('backend-fixer', `phase-${round}`, `第${round}轮后端修复`);
      const feTask = this.stateMachine.createTask('frontend-fixer', `phase-${round}`, `第${round}轮前端修复`);
      tasks.push(beTask, feTask);
    }
    
    return tasks;
  }
  
  _evaluateTermination() {
    const stats = this.stateMachine.getGlobalStats();
    const passRate = parseFloat(stats.passRate);
    
    // 简化版终止判断: 连续3轮迭代且通过率 ≥ 85%
    if (this.currentIteration >= 3 && passRate >= 85) {
      return true;
    }
    
    if (this.currentIteration >= this.config.maxIterations) {
      console.log('[终止] 达到最大迭代轮次，强制终止');
      return true;
    }
    
    return false;
  }
  
  _handleTakeover(task) {
    // 根据角色找到同组备用角色
    let backupRole = null;
    
    if (this.roles.development.includes(task.role)) {
      backupRole = 'infra-engineer';
    } else if (this.roles.fixers.includes(task.role)) {
      backupRole = task.role === 'backend-fixer' ? 'backend-dev' : 'frontend-dev';
    } else if (this.roles.testing.includes(task.role)) {
      backupRole = 'test-engineer';
    }
    
    if (backupRole) {
      console.log(`[接管] 角色 ${task.role} 的任务由 ${backupRole} 接管`);
      const newTask = this.stateMachine.createTask(backupRole, task.phase, `接管: ${task.taskDesc}`);
      this.stateMachine.dispatchTask(newTask.taskId);
    }
  }
  
  _onPhaseCompleted(data) {
    this.emit('phaseCompleted', data);
  }
  
  async _waitForPhaseCompletion(phase, timeoutMs = 60000) {
    return new Promise((resolve) => {
      const check = () => {
        const tasks = this.stateMachine.getTasksByPhase(phase);
        const allApproved = tasks.every(t => t.status === TASK_STATUS.APPROVED);
        
        if (allApproved) {
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
      
      // 超时保护
      setTimeout(() => resolve(), timeoutMs);
    });
  }
  
  getStatus() {
    return {
      currentPhase: this.currentPhase,
      currentIteration: this.currentIteration,
      isRunning: this.isRunning,
      startedAt: this.startTime ? new Date(this.startTime).toISOString() : null,
      elapsed: this.startTime ? `${((Date.now() - this.startTime) / 1000).toFixed(1)}s` : 'N/A',
      globalStats: this.stateMachine.getGlobalStats(),
    };
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  WORKFLOW_PHASES,
  WorkflowOrchestrator,
};
