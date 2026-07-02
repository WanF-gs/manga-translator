-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- DDL回滚脚本 v1.0
-- 创建时间: 2025-07-11
-- ============================================================

-- ⚠️ 危险操作警告：此脚本将删除所有表和数据，不可恢复！
-- 执行前请确认已备份数据！

\c manga_translator;

-- ============================================================
-- 第一步：删除物化视图
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mv_daily_stats;

-- ============================================================
-- 第二步：删除视图
-- ============================================================
DROP VIEW IF EXISTS v_user_notifications;
DROP VIEW IF EXISTS v_project_overview;

-- ============================================================
-- 第三步：删除函数/存储过程
-- ============================================================
DROP FUNCTION IF EXISTS validate_user_registration(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS get_translation_cache(UUID, TEXT, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS reorder_chapters(UUID);
DROP FUNCTION IF EXISTS reorder_pages(UUID);
DROP FUNCTION IF EXISTS clean_trashed_projects();
DROP FUNCTION IF EXISTS clean_expired_sessions();
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS audit_schema_changes();

-- ============================================================
-- 第四步：按外键依赖逆序删除表
-- ============================================================
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS translation_cache CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS vocabularies CASCADE;
DROP TABLE IF EXISTS export_tasks CASCADE;
DROP TABLE IF EXISTS operation_histories CASCADE;
DROP TABLE IF EXISTS style_presets CASCADE;
DROP TABLE IF EXISTS term_entries CASCADE;
DROP TABLE IF EXISTS text_regions CASCADE;
DROP TABLE IF EXISTS pages CASCADE;
DROP TABLE IF EXISTS chapters CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- 第五步：删除扩展（可选，如其他数据库共用则不删除）
-- ============================================================
-- DROP EXTENSION IF EXISTS pg_trgm;
-- DROP EXTENSION IF EXISTS pgcrypto;

DO $$
BEGIN
    RAISE NOTICE '✅ 所有表和数据已成功回滚删除';
END $$;
