-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- 数据库用户创建与权限分配脚本 v1.0
-- 创建时间: 2025-07-11
-- DBA: 资深数据库管理员
-- ============================================================

-- ⚠️ 安全原则：遵循最小权限原则 (Principle of Least Privilege)
-- 回滚方案: 执行本脚本底部的回滚部分

\c manga_translator;

-- ============================================================
-- 第一部分：创建数据库角色（Role-Based Access Control）
-- ============================================================

-- 1.1 应用读写角色（用于后端微服务连接）
-- 权限范围：所有业务表的 SELECT/INSERT/UPDATE/DELETE + 函数执行
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'manga_app_rw') THEN
        CREATE ROLE manga_app_rw WITH LOGIN PASSWORD 'Manga@App2025!Rw' 
            CONNECTION LIMIT 50
            VALID UNTIL '2026-12-31';
        RAISE NOTICE '✅ 角色 manga_app_rw 创建成功';
    ELSE
        RAISE NOTICE '⚠️ 角色 manga_app_rw 已存在，跳过创建';
    END IF;
END $$;

COMMENT ON ROLE manga_app_rw IS '应用读写角色 - 后端微服务使用，拥有业务表完整DML权限';

-- 1.2 只读角色（用于报表查询、数据分析）
-- 权限范围：所有业务表的 SELECT 权限
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'manga_app_ro') THEN
        CREATE ROLE manga_app_ro WITH LOGIN PASSWORD 'Manga@Read2025!Ro'
            CONNECTION LIMIT 10
            VALID UNTIL '2026-12-31';
        RAISE NOTICE '✅ 角色 manga_app_ro 创建成功';
    ELSE
        RAISE NOTICE '⚠️ 角色 manga_app_ro 已存在，跳过创建';
    END IF;
END $$;

COMMENT ON ROLE manga_app_ro IS '只读角色 - 报表查询/数据分析使用，仅SELECT权限';

-- 1.3 管理角色（DBA运维使用）
-- 权限范围：数据库级别完整权限
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'manga_dba') THEN
        CREATE ROLE manga_dba WITH LOGIN PASSWORD 'Manga@DBA2025!Admin' 
            SUPERUSER
            CONNECTION LIMIT 5
            VALID UNTIL '2026-12-31';
        RAISE NOTICE '✅ 角色 manga_dba 创建成功';
    ELSE
        RAISE NOTICE '⚠️ 角色 manga_dba 已存在，跳过创建';
    END IF;
END $$;

COMMENT ON ROLE manga_dba IS '数据库管理员角色 - 完整数据库运维权限(SUPERUSER)';

-- 1.4 异步任务角色（Celery Worker使用）
-- 权限范围：处理状态更新、导出任务管理、通知写入
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'manga_worker') THEN
        CREATE ROLE manga_worker WITH LOGIN PASSWORD 'Manga@Worker2025!Async'
            CONNECTION LIMIT 20
            VALID UNTIL '2026-12-31';
        RAISE NOTICE '✅ 角色 manga_worker 创建成功';
    ELSE
        RAISE NOTICE '⚠️ 角色 manga_worker 已存在，跳过创建';
    END IF;
END $$;

COMMENT ON ROLE manga_worker IS '异步任务角色 - Celery Worker使用，处理状态更新和导出任务';

-- ============================================================
-- 第二部分：分配权限
-- ============================================================

-- -----------------------------------------------------------
-- 2.1 manga_app_rw（应用读写角色）
-- 所有业务表的 SELECT/INSERT/UPDATE/DELETE
-- -----------------------------------------------------------

-- 授予表级权限
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO manga_app_rw;
-- 授予序列权限（用于自增字段）
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO manga_app_rw;
-- 授予函数执行权限
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO manga_app_rw;
-- 授予Schema使用权限
GRANT USAGE ON SCHEMA public TO manga_app_rw;
-- 确保未来新表自动授权
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO manga_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE ON SEQUENCES TO manga_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO manga_app_rw;

-- -----------------------------------------------------------
-- 2.2 manga_app_ro（只读角色）
-- 仅 SELECT 权限，用于报表查询和数据分析
-- -----------------------------------------------------------

GRANT SELECT ON ALL TABLES IN SCHEMA public TO manga_app_ro;
GRANT USAGE ON SCHEMA public TO manga_app_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO manga_app_ro;

-- -----------------------------------------------------------
-- 2.3 manga_worker（异步任务角色）
-- 特定表的 UPDATE + 导出/通知表的 INSERT
-- -----------------------------------------------------------

-- 授予表级权限
GRANT SELECT ON ALL TABLES IN SCHEMA public TO manga_worker;
GRANT INSERT, UPDATE ON pages TO manga_worker;
GRANT INSERT, UPDATE ON export_tasks TO manga_worker;
GRANT INSERT, UPDATE ON notifications TO manga_worker;
GRANT INSERT ON translation_cache TO manga_worker;
GRANT INSERT ON operation_histories TO manga_worker;
GRANT USAGE ON SCHEMA public TO manga_worker;
GRANT EXECUTE ON FUNCTION get_translation_cache(UUID, TEXT, VARCHAR, VARCHAR) TO manga_worker;
GRANT EXECUTE ON FUNCTION reorder_pages(UUID) TO manga_worker;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO manga_worker;

-- -----------------------------------------------------------
-- 2.4 manga_dba（管理角色）
-- SUPERUSER 角色自动拥有所有权限，无需额外授权
-- -----------------------------------------------------------

-- ============================================================
-- 第三部分：安全加固配置
-- ============================================================

-- 3.1 配置密码策略（通过 ALTER ROLE）
ALTER ROLE manga_app_rw SET log_statement = 'mod';           -- 记录所有修改操作
ALTER ROLE manga_app_rw SET statement_timeout = '120s';       -- 应用连接超时2分钟

ALTER ROLE manga_app_ro SET statement_timeout = '60s';        -- 只读查询超时1分钟
ALTER ROLE manga_app_ro SET default_transaction_read_only = 'on'; -- 强制只读事务

ALTER ROLE manga_worker SET statement_timeout = '300s';       -- 异步任务超时5分钟

-- 3.2 连接限制说明
-- manga_app_rw: 最多50个并发连接（后端微服务池化连接）
-- manga_app_ro: 最多10个并发连接（报表查询）
-- manga_dba:    最多5个并发连接（DBA运维）
-- manga_worker: 最多20个并发连接（Celery Worker）

-- 3.3 IP白名单配置（需在 pg_hba.conf 中配置，此处为注释参考）
-- 以下配置应添加到 PostgreSQL 的 pg_hba.conf 文件中：
--
-- # 漫画翻译系统 - 应用服务器
-- host    manga_translator    manga_app_rw    10.0.1.0/24      scram-sha-256
-- # 漫画翻译系统 - 报表服务器
-- host    manga_translator    manga_app_ro    10.0.2.0/24      scram-sha-256
-- # 漫画翻译系统 - Worker节点
-- host    manga_translator    manga_worker     10.0.3.0/24      scram-sha-256
-- # 漫画翻译系统 - DBA管理网段
-- host    manga_translator    manga_dba        10.0.0.0/24      scram-sha-256
-- # 本地开发
-- host    manga_translator    all              127.0.0.1/32     scram-sha-256

-- 3.4 SSL连接建议
-- 生产环境建议开启SSL连接：
-- ALTER ROLE manga_app_rw SET ssl = 'on';
-- ALTER ROLE manga_app_ro SET ssl = 'on';

-- ============================================================
-- 第四部分：权限验证查询
-- ============================================================

-- 4.1 查看所有角色的表级权限
SELECT
    grantee AS 角色,
    table_schema AS Schema,
    table_name AS 表名,
    privilege_type AS 权限类型
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('manga_app_rw', 'manga_app_ro', 'manga_worker')
ORDER BY grantee, table_name, privilege_type;

-- 4.2 查看角色成员关系
SELECT
    r.rolname AS 角色名,
    r.rolsuper AS 超级用户,
    r.rolconnlimit AS 连接限制,
    r.rolvaliduntil AS 有效期至
FROM pg_roles r
WHERE r.rolname LIKE 'manga_%'
ORDER BY r.rolname;

-- ============================================================
-- 输出确认信息
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ 数据库用户创建与权限分配完成';
    RAISE NOTICE '   - manga_app_rw: 应用读写 (SELECT/INSERT/UPDATE/DELETE)';
    RAISE NOTICE '   - manga_app_ro: 只读查询 (SELECT ONLY)';
    RAISE NOTICE '   - manga_dba:    管理员 (SUPERUSER)';
    RAISE NOTICE '   - manga_worker: 异步任务 (SELECT + 特定UPDATE/INSERT)';
    RAISE NOTICE '========================================';
END $$;

-- ============================================================
-- 回滚部分（取消注释以下内容执行回滚）
-- ============================================================
/*
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM manga_app_rw;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM manga_app_rw;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM manga_app_rw;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM manga_app_rw;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM manga_app_ro;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM manga_app_ro;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM manga_worker;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM manga_worker;

DROP ROLE IF EXISTS manga_app_rw;
DROP ROLE IF EXISTS manga_app_ro;
DROP ROLE IF EXISTS manga_dba;
DROP ROLE IF EXISTS manga_worker;
*/
