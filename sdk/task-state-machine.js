/**
 * 中心化任务状态机 - 自动巡检 + 催办 + 降级
 * 
 * 版本: v1.0
 * 用途: 基于 Neon 数据库实现全流程状态流转引擎
 *       自动巡检、催办、降级，无需主Agent手动触发
 * 
 * 状态枚举: 待派发 → 执行中 → 已提交 → 验收通过 / 驳回重传 → 待接管 → 已完成
 * 
 * 核心功能:
 * 1. 定时轮询任务表，自动检测状态变更
 * 2. 超时自动催办
 * 3. 连续催办无响应自动接管
 * 4. 阶段全部通过后自动触发下一阶段
 */

const EventEmitter = require('events');

// ============================================================
// 状态定义
// ============================================================
const TASK_STATUS = {
  PENDING_DISPATCH: '待派发',     // 任务已创建但未分配
  IN_PROGRESS: '执行中',          // Agent正在处理
  SUBMITTED: '已提交',            // 交付物已提交，等待验收
  APPROVED: '验收通过',           // 验收合格
  REJECTED: '驳回重传',           // 验收不通过，需要修正
  PENDING_TAKEOVER: '待接管',     // 原责任人失活，等待接管
  COMPLETED: '已完成',            // 终态
};

// 合法状态转换映射
const VALID_TRANSITIONS = {
  [TASK_STATUS.PENDING_DISPATCH]: [TASK_STATUS.IN_PROGRESS],
  [TASK_STATUS.IN_PROGRESS]: [TASK_STATUS.SUBMITTED, TASK_STATUS.PENDING_TAKEOVER],
  [TASK_STATUS.SUBMITTED]: [TASK_STATUS.APPROVED, TASK_STATUS.REJECTED],
  [TASK_STATUS.REJECTED]: [TASK_STATUS.IN_PROGRESS, TASK_STATUS.PENDING_TAKEOVER],
  [TASK_STATUS.PENDING_TAKEOVER]: [TASK_STATUS.IN_PROGRESS],
  [TASK_STATUS.APPROVED]: [TASK_STATUS.COMPLETED],
};

// ============================================================
// 任务状态机
// ============================================================
class TaskStateMachine extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // 巡检配置
    this.config = {
      pollInterval: config.pollInterval || 30000,        // 轮询间隔 30秒
      executionTimeout: config.executionTimeout || 1800, // 执行超时 30分钟
      idleTimeout: config.idleTimeout || 600,            // 空闲超时 10分钟
      maxReminders: config.maxReminders || 2,            // 最大催办次数
    };
    
    // 任务缓存（模拟 Neon 数据库中的任务）
    this.tasks = new Map();
    
    // 催办记录
    this.reminderLog = new Map(); // taskId → { count, lastReminderAt, firstReminderAt }
    
    // 巡检定时器
    this.patrolTimer = null;
    
    // 运行状态
    this.isRunning = false;
  }
  
  // ============================================================
  // 任务管理
  // ============================================================
  
  /**
   * 创建新任务
   */
  createTask(role, phase, taskDesc) {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const task = {
      taskId,
      role,
      phase,
      taskDesc,
      status: TASK_STATUS.PENDING_DISPATCH,
      deliverablePath: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{ timestamp: new Date().toISOString(), from: null, to: TASK_STATUS.PENDING_DISPATCH }],
    };
    
    this.tasks.set(taskId, task);
    
    this.emit('taskCreated', task);
    console.log(`[状态机] 任务已创建: ${taskId} (${role}) - ${taskDesc}`);
    
    return task;
  }
  
  /**
   * 派发任务
   */
  dispatchTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    
    this._transition(task, TASK_STATUS.IN_PROGRESS);
    this.emit('taskDispatched', task);
    console.log(`[状态机] 任务已派发: ${taskId} → 执行中`);
    
    return task;
  }
  
  /**
   * 提交任务
   */
  submitTask(taskId, deliverablePath) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    
    task.deliverablePath = deliverablePath;
    this._transition(task, TASK_STATUS.SUBMITTED);
    
    // 清除催办记录
    this.reminderLog.delete(taskId);
    
    this.emit('taskSubmitted', task);
    console.log(`[状态机] 任务已提交: ${taskId}, 交付物: ${deliverablePath}`);
    
    return task;
  }
  
  /**
   * 验收任务
   */
  approveTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    
    this._transition(task, TASK_STATUS.APPROVED);
    this.emit('taskApproved', task);
    console.log(`[状态机] 任务验收通过: ${taskId}`);
    
    // 检查是否该阶段全部完成
    this._checkPhaseCompletion(task.phase);
    
    return task;
  }
  
  /**
   * 驳回任务
   */
  rejectTask(taskId, reason) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    
    this._transition(task, TASK_STATUS.REJECTED);
    task.rejectReason = reason;
    this.emit('taskRejected', task);
    console.log(`[状态机] 任务驳回: ${taskId}, 原因: ${reason}`);
    
    return task;
  }
  
  /**
   * 标记待接管
   */
  markPendingTakeover(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    
    this._transition(task, TASK_STATUS.PENDING_TAKEOVER);
    this.emit('taskPendingTakeover', task);
    console.log(`[状态机] 任务待接管: ${taskId}`);
    
    return task;
  }
  
  // ============================================================
  // 状态转换（带校验）
  // ============================================================
  
  /**
   * 执行状态转换（带合法性校验）
   */
  _transition(task, newStatus) {
    const validTargets = VALID_TRANSITIONS[task.status];
    
    if (!validTargets || !validTargets.includes(newStatus)) {
      throw new Error(
        `[状态机] 非法的状态转换: ${task.status} → ${newStatus}。` +
        `允许的转换: ${task.status} → [${(validTargets || []).join(', ')}]`
      );
    }
    
    const oldStatus = task.status;
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();
    task.history.push({
      timestamp: new Date().toISOString(),
      from: oldStatus,
      to: newStatus,
    });
    
    this.emit('stateChanged', { task, from: oldStatus, to: newStatus });
    
    // 同步写入 Neon 数据库
    this._syncToNeon(task);
  }
  
  /**
   * 同步状态到 Neon 数据库
   * 
   * 实际部署时通过 Neon MCP run_sql 执行:
   * UPDATE agent_task_status SET status = ?, updated_at = NOW() WHERE task_id = ?
   */
  _syncToNeon(task) {
    console.log(`[Neon同步] UPDATE agent_task_status SET status='${task.status}', deliverable_path='${task.deliverablePath || ''}' WHERE task_id='${task.taskId}'`);
    // 实际: await neonMCP.run_sql({ sql: 'UPDATE agent_task_status SET status = $1, updated_at = NOW() WHERE task_id = $2', params: [task.status, task.taskId] });
  }
  
  // ============================================================
  // 自动巡检引擎
  // ============================================================
  
  /**
   * 启动自动巡检
   */
  startPatrol() {
    if (this.isRunning) {
      console.log('[巡检] 巡检引擎已在运行中');
      return;
    }
    
    this.isRunning = true;
    console.log(`[巡检] 启动自动巡检引擎 (间隔: ${this.config.pollInterval / 1000}秒)`);
    
    this.patrolTimer = setInterval(() => {
      this._patrol();
    }, this.config.pollInterval);
    
    // 立即执行一次
    this._patrol();
  }
  
  /**
   * 停止自动巡检
   */
  stopPatrol() {
    if (this.patrolTimer) {
      clearInterval(this.patrolTimer);
      this.patrolTimer = null;
    }
    this.isRunning = false;
    console.log('[巡检] 自动巡检引擎已停止');
  }
  
  /**
   * 单次巡检逻辑
   */
  _patrol() {
    const now = Date.now();
    let actions = [];
    
    for (const [taskId, task] of this.tasks) {
      const taskUpdatedAt = new Date(task.updatedAt).getTime();
      const idleMs = now - taskUpdatedAt;
      const idleMinutes = Math.floor(idleMs / 60000);
      
      switch (task.status) {
        case TASK_STATUS.SUBMITTED:
          // 已提交的任务 → 自动验收（校验交付物完整性）
          this._autoVerify(task);
          actions.push(`验收校验: ${taskId}`);
          break;
          
        case TASK_STATUS.IN_PROGRESS:
          // 执行中的任务 → 检查超时
          if (idleMs > this.config.executionTimeout * 1000) {
            this._sendReminder(task);
            actions.push(`超时催办: ${taskId} (空闲${idleMinutes}分钟)`);
          } else if (idleMs > this.config.idleTimeout * 1000) {
            this._sendReminder(task);
            actions.push(`空闲催办: ${taskId} (空闲${idleMinutes}分钟)`);
          }
          break;
          
        case TASK_STATUS.REJECTED:
          // 驳回的任务 → 检查是否超时未重新提交
          if (idleMs > this.config.executionTimeout * 1000) {
            this.markPendingTakeover(taskId);
            actions.push(`驳回超时接管: ${taskId}`);
          }
          break;
      }
    }
    
    if (actions.length > 0) {
      console.log(`[巡检] 发现 ${actions.length} 个需要处理的事项`);
      actions.forEach(a => console.log(`  - ${a}`));
    }
  }
  
  /**
   * 自动验收已提交任务
   */
  _autoVerify(task) {
    // 校验交付物路径是否有效
    if (task.deliverablePath) {
      // 模拟验收: 自动通过
      console.log(`[自动验收] ${task.taskId} 交付物路径有效: ${task.deliverablePath}`);
      this.approveTask(task.taskId);
    } else {
      console.log(`[自动验收] ${task.taskId} 交付物路径为空，驳回`);
      this.rejectTask(task.taskId, '交付物路径为空');
    }
  }
  
  /**
   * 发送催办
   */
  _sendReminder(task) {
    let log = this.reminderLog.get(task.taskId) || { count: 0, lastReminderAt: null, firstReminderAt: null };
    
    log.count++;
    log.lastReminderAt = new Date().toISOString();
    if (!log.firstReminderAt) {
      log.firstReminderAt = new Date().toISOString();
    }
    
    this.reminderLog.set(task.taskId, log);
    
    console.log(`[催办] 第${log.count}次催办: ${task.taskId} (${task.role}) - ${task.taskDesc}`);
    
    // 规则重申: 输出角色与提交规则
    console.log(`[催办-规则重申] 角色: ${task.role}, 必须完成 GitHub提交 + Neon状态更新双闭环`);
    
    this.emit('reminderSent', { task, reminderCount: log.count });
    
    // 连续2次催办无响应 → 自动接管
    if (log.count >= this.config.maxReminders) {
      console.log(`[催办] ${task.taskId} 连续${log.count}次催办无响应，自动标记为「待接管」`);
      this.markPendingTakeover(task.taskId);
    }
  }
  
  // ============================================================
  // 阶段推进检测
  // ============================================================
  
  /**
   * 检查某阶段是否全部完成
   */
  _checkPhaseCompletion(phase) {
    const phaseTasks = [];
    for (const [taskId, task] of this.tasks) {
      if (task.phase === phase) {
        phaseTasks.push(task);
      }
    }
    
    if (phaseTasks.length === 0) return;
    
    const allApproved = phaseTasks.every(t => t.status === TASK_STATUS.APPROVED);
    
    if (allApproved) {
      console.log(`[阶段推进] 阶段 ${phase} 全部任务已验收通过！自动触发下一阶段启动。`);
      this.emit('phaseCompleted', { phase, taskCount: phaseTasks.length });
    } else {
      const notApproved = phaseTasks.filter(t => t.status !== TASK_STATUS.APPROVED);
      console.log(`[阶段推进] 阶段 ${phase} 尚未完成: ${notApproved.length}/${phaseTasks.length} 个任务未验收通过`);
    }
  }
  
  // ============================================================
  // 查询接口
  // ============================================================
  
  /**
   * 获取任务状态
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }
  
  /**
   * 按阶段查询任务
   */
  getTasksByPhase(phase) {
    return [...this.tasks.values()].filter(t => t.phase === phase);
  }
  
  /**
   * 按状态查询任务
   */
  getTasksByStatus(status) {
    return [...this.tasks.values()].filter(t => t.status === status);
  }
  
  /**
   * 获取全局统计
   */
  getGlobalStats() {
    const tasks = [...this.tasks.values()];
    const total = tasks.length;
    
    const byStatus = {};
    for (const s of Object.values(TASK_STATUS)) {
      byStatus[s] = tasks.filter(t => t.status === s).length;
    }
    
    const approvedCount = byStatus[TASK_STATUS.APPROVED] || 0;
    const passRate = total > 0 ? (approvedCount / total * 100).toFixed(1) : '0.0';
    
    return {
      total,
      byStatus,
      passRate: `${passRate}%`,
      phaseStats: this._getPhaseStats(),
    };
  }
  
  /**
   * 按阶段统计
   */
  _getPhaseStats() {
    const phases = {};
    for (const task of this.tasks.values()) {
      if (!phases[task.phase]) {
        phases[task.phase] = { total: 0, approved: 0 };
      }
      phases[task.phase].total++;
      if (task.status === TASK_STATUS.APPROVED) {
        phases[task.phase].approved++;
      }
    }
    
    const result = {};
    for (const [phase, stats] of Object.entries(phases)) {
      result[phase] = {
        ...stats,
        completionRate: stats.total > 0 ? `${(stats.approved / stats.total * 100).toFixed(1)}%` : 'N/A',
      };
    }
    return result;
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  TASK_STATUS,
  VALID_TRANSITIONS,
  TaskStateMachine,
};
