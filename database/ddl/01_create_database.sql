-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- 数据库初始化脚本 v1.1 (Docker Compose 兼容版)
-- 适用: PostgreSQL 15+
-- ============================================================
-- 注意：此脚本适用于 Docker Compose 环境。
-- Docker Compose 已通过 POSTGRES_DB 创建 manga_translator 数据库，
-- 并自动连接到此数据库执行 init 脚本，因此无需 CREATE DATABASE。
-- 本脚本仅配置数据库实例参数。

-- ============================================================
-- 配置数据库实例参数
-- ============================================================

-- 连接与认证
ALTER DATABASE manga_translator SET statement_timeout = '300s';
ALTER DATABASE manga_translator SET idle_in_transaction_session_timeout = '60s';

-- 性能相关
ALTER DATABASE manga_translator SET work_mem = '64MB';
ALTER DATABASE manga_translator SET maintenance_work_mem = '256MB';
ALTER DATABASE manga_translator SET effective_cache_size = '2GB';
ALTER DATABASE manga_translator SET random_page_cost = 1.1;

-- 日志
ALTER DATABASE manga_translator SET log_min_duration_statement = '1000';
ALTER DATABASE manga_translator SET log_lock_waits = 'on';

-- 自动清理
ALTER DATABASE manga_translator SET autovacuum = 'on';
ALTER DATABASE manga_translator SET autovacuum_vacuum_scale_factor = '0.05';
ALTER DATABASE manga_translator SET autovacuum_analyze_scale_factor = '0.02';

-- 添加数据库注释
COMMENT ON DATABASE manga_translator IS '漫画多语言智能翻译与图像合成系统 - 主数据库';

-- ============================================================
-- 输出确认信息
-- ============================================================
DO $$
BEGIN
    RAISE NOTICE '✅ 数据库 manga_translator 参数配置完成';
    RAISE NOTICE '   - statement_timeout: 300s';
    RAISE NOTICE '   - work_mem: 64MB';
END $$;
