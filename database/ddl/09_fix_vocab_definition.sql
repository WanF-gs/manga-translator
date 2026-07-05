-- P0: 修复 vocabularies.definition 列类型为 TEXT（原运行时为 VARCHAR(50)，导致词典定义截断错误）
-- 错误：StringDataRightTruncationError: value too long for type character varying(50)
-- 原因：数据库可能由旧版 DDL 或 init 脚本创建，definition 列被设为 VARCHAR(50)

BEGIN;

ALTER TABLE vocabularies ALTER COLUMN definition TYPE TEXT;

COMMIT;
