# 数据库Schema变更日志

> 记录所有DDL/DML变更，遵循 [Keep a Changelog](https://keepachangelog.com/) 格式。

---

## [2025-07-13] v1.1 - 扩展表

### Added
- 新增 `reading_progress` 表（阅读进度持久化）
  - 文件：`database/ddl/03_reading_progress.sql`
  - 用途：记录用户每页阅读位置、缩放级别、阅读时长
  - 唯一约束：`UNIQUE(user_id, page_id)`

### Fixed
- `style_presets.category` CHECK约束扩展：`('speech','thought','narration','onomatopoeia','effect')` 5类
  - 热修复脚本：`database/ddl/02_hotfix_category_check.sql`
  - 主DDL已同步更新

### Cleaned
- 删除 `ddl/03_operation_histories.sql`（冲突版本，主DDL `02_create_tables.sql` 已包含正确版本）
- 删除 `ddl/04_seed_data.sql`（重复文件，权威版本在 `dml/01_seed_data.sql`）
- 删除 `ddl/05_test_data.sql`（重复文件，权威版本在 `dml/02_test_data.sql`）

---

## [2025-07-11] v1.0 - 初始版本

### Added
- 13张核心业务表：users, projects, chapters, pages, text_regions, term_entries,
  style_presets, operation_histories, export_tasks, vocabularies, notifications,
  translation_cache, user_sessions
- 35+索引
- 7个自动更新触发器
- 6个存储过程/函数
- 2个视图 + 1个物化视图
- 4个数据库角色（manga_app_rw, manga_app_ro, manga_dba, manga_worker）
- 8套系统内置样式预设
- 26项系统配置参数
- 字典种子数据
