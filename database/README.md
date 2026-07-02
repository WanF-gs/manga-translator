# 数据库运维操作执行手册

## 漫画多语言智能翻译与图像合成系统

---

### 📁 目录结构

```
database/
├── README.md                          ← 本文件
├── ddl/                               ← DDL脚本目录
│   ├── 01_create_database.sql         ← 创建数据库实例
│   ├── 02_create_tables.sql           ← 创建所有表/索引/触发器/函数/视图（13张核心表）
│   ├── 02_rollback.sql                ← DDL回滚脚本
│   ├── 02_hotfix_category_check.sql   ← 🔧 在线修复：style_presets CHECK约束
│   ├── 03_create_users.sql            ← 创建数据库用户与权限
│   ├── 03_reading_progress.sql        ← 阅读进度表（独立扩展表）
│   ├── 03_v3_migration.sql            ← v3.0 迁移脚本
│   └── 04_agent_task_status.sql       ← Neon Agent 多角色任务状态表
├── dml/                               ← DML脚本目录（唯一权威版本）
│   ├── 01_seed_data.sql               ← 基础数据导入（字典/配置/样式预设）
│   └── 02_test_data.sql               ← 仿真测试数据生成
├── backup/                            ← 备份策略目录
│   └── backup_strategy.sql            ← 备份恢复策略文档
└── changelog/                         ← 变更日志目录
    └── CHANGELOG.md                   ← Schema变更日志
```

---

### 🚀 快速开始（执行顺序）

**⚠️ 重要提示**：以下脚本必须严格按照顺序执行，否则会因外键依赖而失败。

#### Step 1：创建数据库实例

```bash
# 以 postgres 超级用户身份执行
psql -U postgres -f database/ddl/01_create_database.sql
```

**作用**：创建 `manga_translator` 数据库，配置字符集和实例参数。

---

#### Step 2：执行DDL建表

```bash
# 以 postgres 超级用户身份执行
psql -U postgres -d manga_translator -f database/ddl/02_create_tables.sql
```

**作用**：
- 创建 13 张核心业务表
- 创建 35+ 个索引
- 创建 7 个自动更新触发器
- 创建 6 个存储过程/函数
- 创建 2 个视图 + 1 个物化视图

**预计执行时间**：< 30秒

**验证方法**：
```sql
-- 检查表是否创建成功
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- 应输出13张表：
-- chapters, export_tasks, notifications, operation_histories,
-- pages, projects, style_presets, term_entries, text_regions,
-- translation_cache, user_sessions, users, vocabularies, agent_task_status
```

---

#### Step 3：创建数据库用户

```bash
psql -U postgres -d manga_translator -f database/ddl/03_create_users.sql
```

**作用**：创建 4 个数据库角色并分配最小必要权限。

| 角色 | 密码 | 用途 |
|------|------|------|
| manga_app_rw | Manga@App2025!Rw | 后端微服务连接 |
| manga_app_ro | Manga@Read2025!Ro | 报表查询（只读） |
| manga_dba | Manga@DBA2025!Admin | DBA运维管理 |
| manga_worker | Manga@Worker2025!Async | Celery异步任务 |

> ⚠️ 生产环境请务必修改以上默认密码！

**验证方法**：
```sql
\du manga_*
```

---

#### Step 4：导入基础数据

```bash
psql -U postgres -d manga_translator -f database/dml/01_seed_data.sql
```

**作用**：
- 导入 8 套系统内置字体样式预设
- 导入 26 项系统配置参数
- 导入 5 种语言代码、5 种区域类型、4 种页面状态等字典数据
- 导入默认用户偏好设置

**预计执行时间**：< 5秒

> ⚠️ 如果执行时 style_presets 插入报错（category CHECK约束），请先执行热修复脚本：
> ```bash
> psql -U postgres -d manga_translator -f database/ddl/02_hotfix_category_check.sql
> ```
> 然后再重新执行 Step 4。DDL 脚本 `02_create_tables.sql` 已同步修复，新创建的数据库不受影响。

---

#### Step 5：生成测试数据（可选）

```bash
psql -U postgres -d manga_translator -f database/dml/02_test_data.sql
```

**作用**：生成仿真测试数据用于开发和测试。

**数据量**：
- 3 个用户 + 7 个作品 + 8 个章节 + 17 个页面
- 9 个文字区域 + 6 个术语 + 3 个导出任务
- 总计约 100+ 条记录

---

### 🔄 回滚方案

如果需要回滚所有操作：

```bash
# 回滚DDL（删除所有表和对象）
psql -U postgres -d manga_translator -f database/ddl/02_rollback.sql

# 回滚数据库用户
psql -U postgres -f database/ddl/03_create_users.sql  # 执行脚本底部的回滚部分

# 删除数据库
psql -U postgres -c "DROP DATABASE IF EXISTS manga_translator;"
```

---

### 📊 备份恢复

备份策略详见 `database/backup/backup_strategy.sql`：

| 备份类型 | 频率 | 保留 | 工具 |
|----------|------|------|------|
| 全量备份 | 每天 | 30天 | pg_dump -Fc |
| 增量备份 | 每6小时 | 7天 | pg_basebackup + WAL |
| 逻辑备份 | 每周 | 90天 | pg_dump --inserts |

**快速手动备份**：
```bash
pg_dump -U manga_dba -d manga_translator -F c -f manga_translator_$(date +%Y%m%d).dump
```

**快速恢复**：
```bash
pg_restore -U manga_dba -d manga_translator -j 4 --clean --if-exists manga_translator_20250711.dump
```

---

### 📋 变更日志

所有Schema变更记录在 `database/changelog/CHANGELOG.md`，包括：
- 变更编号、日期、类型
- 变更内容详细描述
- 回滚方案
- 审批记录

---

### ✅ 验证清单

数据库初始化完成后，请逐项验证：

- [ ] 数据库 `manga_translator` 存在且可连接
- [ ] 15张业务表全部创建成功（含 agent_task_status）
- [ ] 索引数量 ≥ 35 个
- [ ] 7个触发器正常工作（更新任意记录后检查 updated_at）
- [ ] 6个存储过程/函数可正常调用
- [ ] 4个数据库角色创建成功且权限正确
- [ ] 8套样式预设数据存在
- [ ] 26项系统配置参数完整
- [ ] 字典数据完整（语言、区域类型、页面状态等）

**一键验证SQL**：
```sql
-- 复制以下SQL到psql执行
SELECT '数据库' AS 检查项, 
       CASE WHEN EXISTS(SELECT 1 FROM pg_database WHERE datname='manga_translator') 
            THEN '✅' ELSE '❌' END AS 状态
UNION ALL
SELECT '表(' || COUNT(*) || '张)', '✅' FROM information_schema.tables 
WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL
SELECT '索引(' || COUNT(*) || '个)', '✅' FROM pg_indexes WHERE schemaname='public'
UNION ALL
SELECT '样式预设(' || COUNT(*) || '套)', '✅' FROM style_presets WHERE scope='system'
UNION ALL
SELECT '系统配置(' || COUNT(*) || '项)', '✅' FROM system_config
UNION ALL
SELECT '用户角色(' || COUNT(*) || '个)', '✅' FROM pg_roles WHERE rolname LIKE 'manga_%';
```

---

**文档版本**：1.0  
**创建时间**：2025-07-11  
**DBA**：资深数据库管理员
