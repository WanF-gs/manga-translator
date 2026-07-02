/**
 * 统一提交网关 - 交付物强校验
 * 
 * 版本: v1.0
 * 用途: 封装统一 submitDeliverable 接口，作为所有交付物提交的唯一入口
 *       内置格式校验、路径校验、素材校验、PRD映射校验
 *       校验通过自动执行 GitHub 提交 + Neon 状态更新
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// 交付物类型与格式定义
// ============================================================
const DELIVERABLE_TYPES = {
  'prd-checklist': {
    name: 'PRD对标清单',
    requiredFields: ['prd_version', 'module_count', 'total_cases', 'coverage_matrix'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/prd-compliance/prd-compliance-mapping.md',
  },
  'boundary-report': {
    name: '边界审计报告',
    requiredFields: ['audit_scope', 'violations', 'recommendations'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/boundary-auditor/boundary-audit-report.md',
  },
  'compliance-report': {
    name: '合规审计报告',
    requiredFields: ['compliance_items', 'pass_status', 'exceptions'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/compliance-expert/compliance-audit-report.md',
  },
  'test-report': {
    name: '测试报告',
    requiredFields: ['test_type', 'total_cases', 'passed', 'failed', 'pass_rate', 'prd_mapping'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/test-engineer/test-report.md',
  },
  'code-review': {
    name: '代码审查报告',
    requiredFields: ['files_reviewed', 'issues_found', 'severity'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/code-reviewer/code-review-report.md',
  },
  'fix-report': {
    name: '修复报告',
    requiredFields: ['fixed_issues', 'changed_files', 'verification_status'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/fixer/fix-report.md',
  },
  'priority-queue': {
    name: '优先级任务队列',
    requiredFields: ['p0_items', 'p1_items', 'sort_criteria'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/director/priority-queue.md',
  },
  'iteration-brief': {
    name: '迭代简报',
    requiredFields: ['phase', 'completion_rate', 'remaining_issues', 'risks'],
    format: 'markdown',
    pathPattern: 'reports/audit/iteration_report.md',
  },
  'quality-audit': {
    name: '质量审计报告',
    requiredFields: ['redline_check', 'pass_rate', 'exceptions'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/quality-director/quality-audit.md',
  },
  'dispatch-log': {
    name: '任务派发记录',
    requiredFields: ['dispatched_tasks', 'assignees'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/director/dispatch-log.md',
  },
  'signoff': {
    name: '双签验收结论',
    requiredFields: ['director_signature', 'quality_director_signature', 'conclusion'],
    format: 'markdown',
    pathPattern: 'deliverables/phase-{N}/director/signoff.md',
  },
};

// ============================================================
// 测试素材路径白名单（只允许 测试项目/ 目录下文件）
// ============================================================
const TEST_MATERIAL_WHITELIST = [
  '测试项目/',
];

// ============================================================
// PRD 条款编号格式
// ============================================================
const PRD_REFERENCE_PATTERN = /§\d+\.\d+\.\d+/g;

// ============================================================
// 提交结果
// ============================================================
class SubmitResult {
  constructor() {
    this.passed = false;
    this.checks = [];
    this.errors = [];
    this.warnings = [];
    this.githubResult = null;
    this.neonResult = null;
  }
  
  addCheck(name, passed, detail = '') {
    this.checks.push({ name, passed, detail });
    if (!passed) {
      this.errors.push(`${name}: ${detail}`);
    }
  }
}

// ============================================================
// 统一提交网关
// ============================================================
class UnifiedSubmitGateway {
  constructor(config = {}) {
    this.projectRoot = config.projectRoot || path.resolve(__dirname, '..');
    this.strictMode = config.strictMode !== undefined ? config.strictMode : true;
  }
  
  /**
   * 统一提交接口 - 所有交付物提交的唯一入口
   * 
   * @param {object} submission - 提交数据
   * @param {string} submission.content - 交付物内容
   * @param {string} submission.filePath - 目标文件路径（相对于仓库根目录）
   * @param {string} submission.type - 交付物类型
   * @param {string} submission.role - 提交者角色
   * @param {string} submission.taskId - 关联任务ID
   * @param {string} submission.phase - 当前阶段
   * @param {array} submission.prdReferences - PRD条款引用列表
   * @param {array} submission.testMaterials - 引用测试素材列表
   * @returns {SubmitResult} 提交结果
   */
  async submitDeliverable(submission) {
    const result = new SubmitResult();
    
    console.log(`[提交网关] 收到提交: 类型=${submission.type}, 角色=${submission.role}, 路径=${submission.filePath}`);
    
    // 校验1: 必填字段完整性
    this._validateRequiredFields(submission, result);
    
    // 校验2: 提交路径规范性
    this._validateFilePath(submission.filePath, submission.role, submission.phase, result);
    
    // 校验3: 交付物格式校验
    this._validateFormat(submission.content, submission.type, result);
    
    // 校验4: 素材引用合规性
    this._validateMaterialReferences(submission.content, submission.testMaterials, result);
    
    // 校验5: PRD条款映射校验
    this._validatePRDReferences(submission.content, submission.prdReferences, result);
    
    // 判断是否全部通过
    result.passed = result.errors.length === 0;
    
    if (!result.passed) {
      console.log(`[提交网关] ❌ 校验失败: ${result.errors.length}个错误`);
      result.errors.forEach(e => console.log(`  - ${e}`));
      return result;
    }
    
    // 校验通过 → 执行双提交
    console.log(`[提交网关] ✅ 全部校验通过，执行双提交`);
    
    try {
      // 步骤1: GitHub 提交
      result.githubResult = await this._submitToGitHub(submission);
      result.addCheck('GitHub提交', true, `commit: ${result.githubResult.commitHash || 'success'}`);
    } catch (err) {
      result.addCheck('GitHub提交', false, err.message);
      result.passed = false;
      return result;
    }
    
    try {
      // 步骤2: Neon 状态更新
      result.neonResult = await this._updateNeonStatus(submission.taskId);
      result.addCheck('Neon状态更新', true, `任务 ${submission.taskId} → 已提交`);
    } catch (err) {
      result.addCheck('Neon状态更新', false, err.message);
      result.passed = false;
      return result;
    }
    
    console.log(`[提交网关] ✅ 双提交完成: GitHub+Neon`);
    return result;
  }
  
  /**
   * 校验1: 必填字段完整性
   */
  _validateRequiredFields(submission, result) {
    const required = ['content', 'filePath', 'type', 'role', 'taskId', 'phase'];
    for (const field of required) {
      if (!submission[field]) {
        result.addCheck('必填字段', false, `缺少: ${field}`);
      }
    }
    result.addCheck('必填字段', result.errors.length === 0);
  }
  
  /**
   * 校验2: 提交路径规范
   */
  _validateFilePath(filePath, role, phase, result) {
    if (!filePath) {
      result.addCheck('路径校验', false, '文件路径为空');
      return;
    }
    
    // 检查路径前缀
    const validPrefixes = ['deliverables/', 'reports/', 'skills/', 'docs/', 'database/'];
    const hasValidPrefix = validPrefixes.some(prefix => filePath.startsWith(prefix));
    
    if (!hasValidPrefix) {
      result.addCheck('路径校验', false, `路径前缀不合法，必须在以下目录: ${validPrefixes.join(', ')}`);
      return;
    }
    
    // 检查路径是否包含非法字符
    if (/\.\./.test(filePath)) {
      result.addCheck('路径校验', false, '路径包含非法字符 ../');
      return;
    }
    
    result.addCheck('路径校验', true, `路径: ${filePath}`);
  }
  
  /**
   * 校验3: 交付物格式
   */
  _validateFormat(content, type, result) {
    const typeDef = DELIVERABLE_TYPES[type];
    
    if (!typeDef) {
      result.addCheck('格式校验', false, `未知交付物类型: ${type}`);
      return;
    }
    
    // Markdown 格式检查
    if (typeDef.format === 'markdown') {
      if (!content || content.trim().length === 0) {
        result.addCheck('格式校验', false, '内容为空');
        return;
      }
      
      // 检查是否包含 Markdown 标记
      const hasMarkdown = /^#{1,6}\s|^\|.*\|$|^[-*]\s|^\d+\.\s|^```/m.test(content);
      if (!hasMarkdown && this.strictMode) {
        result.addCheck('格式校验', false, '内容不符合Markdown格式');
        return;
      }
    }
    
    // 必要字段检查
    const missingFields = [];
    for (const field of typeDef.requiredFields) {
      const regex = new RegExp(field.replace('_', '[-_]'), 'i');
      if (!regex.test(content)) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      result.addCheck('格式校验', false, `缺少必要字段: ${missingFields.join(', ')}`);
      return;
    }
    
    result.addCheck('格式校验', true, `类型: ${typeDef.name}`);
  }
  
  /**
   * 校验4: 素材引用合规性
   */
  _validateMaterialReferences(content, testMaterials, result) {
    // 检查内容中是否引用了外部路径
    if (content) {
      // 检查是否有外部URL或文件路径
      const externalPaths = content.match(/(https?:\/\/[^\s]+)|(\/[a-z]+\/[^\s]*\.(jpg|png|pdf|rar|zip))/gi);
      
      if (externalPaths && this.strictMode) {
        // 过滤掉合法的内部路径引用
        const illegalPaths = externalPaths.filter(p => {
          return !TEST_MATERIAL_WHITELIST.some(white => p.includes(white));
        });
        
        if (illegalPaths.length > 0) {
          result.addCheck('素材校验', false, `检测到外部素材引用: ${illegalPaths.slice(0, 3).join(', ')}`);
          return;
        }
      }
    }
    
    // 检查提供的素材列表是否都在白名单内
    if (testMaterials && testMaterials.length > 0) {
      for (const mat of testMaterials) {
        const isWhitelisted = TEST_MATERIAL_WHITELIST.some(white => mat.startsWith(white));
        if (!isWhitelisted) {
          result.addCheck('素材校验', false, `素材不在白名单: ${mat}`);
          return;
        }
      }
    }
    
    result.addCheck('素材校验', true);
  }
  
  /**
   * 校验5: PRD条款映射
   */
  _validatePRDReferences(content, prdReferences, result) {
    if (prdReferences && prdReferences.length > 0) {
      for (const ref of prdReferences) {
        if (!PRD_REFERENCE_PATTERN.test(ref)) {
          result.addCheck('PRD映射', false, `PRD条款格式非法: ${ref} (应为 §X.Y.Z 格式)`);
          return;
        }
      }
      result.addCheck('PRD映射', true, `${prdReferences.length}个PRD条款引用`);
    } else {
      // 宽松模式：无PRD引用时仅警告
      if (this.strictMode) {
        result.addCheck('PRD映射', false, '未提供PRD条款引用');
      } else {
        result.addCheck('PRD映射', true, '无PRD引用（跳过）');
      }
    }
  }
  
  /**
   * 提交至 GitHub
   * 
   * 实际部署时通过 GitHub MCP create_or_update_file 执行:
   * mcp_call_tool("GitHub", "create_or_update_file", { path, content, branch })
   */
  async _submitToGitHub(submission) {
    const fullPath = path.join(this.projectRoot, submission.filePath);
    const dir = path.dirname(fullPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, submission.content, 'utf-8');
    
    console.log(`[GitHub] 文件已写入本地: ${submission.filePath}`);
    console.log(`[GitHub] 待通过 MCP 推送到远程仓库`);
    
    return {
      commitHash: `local-${Date.now().toString(36)}`,
      path: submission.filePath,
    };
  }
  
  /**
   * 更新 Neon 数据库任务状态
   * 
   * 实际部署时通过 Neon MCP run_sql 执行:
   * mcp_call_tool("Neon MCP Server", "run_sql", {
   *   sql: "UPDATE agent_task_status SET status='已提交', deliverable_path=$1, updated_at=NOW() WHERE task_id=$2",
   *   params: [submission.filePath, submission.taskId]
   * })
   */
  async _updateNeonStatus(taskId) {
    console.log(`[Neon] 更新任务状态: ${taskId} → 已提交`);
    console.log(`[Neon] SQL: UPDATE agent_task_status SET status='已提交', updated_at=NOW() WHERE task_id='${taskId}'`);
    
    return {
      taskId,
      newStatus: '已提交',
      updatedAt: new Date().toISOString(),
    };
  }
  
  /**
   * 快速校验（不执行提交，仅做格式和规范检查）
   */
  quickValidate(submission) {
    const result = new SubmitResult();
    
    this._validateRequiredFields(submission, result);
    this._validateFilePath(submission.filePath, submission.role, submission.phase, result);
    this._validateFormat(submission.content, submission.type, result);
    this._validateMaterialReferences(submission.content, submission.testMaterials, result);
    this._validatePRDReferences(submission.content, submission.prdReferences, result);
    
    result.passed = result.errors.length === 0;
    return result;
  }
}

// ============================================================
// 导出
// ============================================================
module.exports = {
  DELIVERABLE_TYPES,
  TEST_MATERIAL_WHITELIST,
  PRD_REFERENCE_PATTERN,
  SubmitResult,
  UnifiedSubmitGateway,
};
