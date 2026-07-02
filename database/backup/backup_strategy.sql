-- ============================================================
-- 漫画多语言智能翻译与图像合成系统
-- 备份恢复策略文档 v1.0
-- 创建时间: 2025-07-11
-- DBA: 资深数据库管理员
-- ============================================================

-- ============================================================
-- 一、备份策略总览
-- ============================================================

/*
| 备份类型     | 频率         | 保留时间     | 工具           | 存储位置            |
|-------------|-------------|-------------|---------------|--------------------|
| 全量备份     | 每天凌晨3:00 | 30天         | pg_dump       | /backups/full/      |
| 增量备份     | 每6小时      | 7天          | pg_dump + WAL | /backups/incremental/|
| WAL归档      | 实时         | 7天          | archive_command| /backups/wal/      |
| 逻辑备份     | 每周日       | 90天         | pg_dumpall    | /backups/logical/   |
| 表级备份     | 按需         | 永久         | pg_dump -t    | /backups/tables/    |
*/

-- ============================================================
-- 二、全量备份脚本
-- ============================================================

-- 2.1 物理全量备份（推荐）
/*
#!/bin/bash
# 文件: /scripts/backup_full.sh
# 执行频率: 每天凌晨3:00 (通过crontab)

PG_HOST="localhost"
PG_PORT="5432"
PG_DB="manga_translator"
PG_USER="manga_dba"
BACKUP_DIR="/backups/full"
RETENTION_DAYS=30

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/manga_translator_full_${TIMESTAMP}.sql.gz"

# 设置环境变量避免密码提示
export PGPASSWORD="Manga@DBA2025!Admin"

# 执行全量备份（自定义格式，支持并行恢复）
pg_dump -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB} \
    -F c \                    # 自定义格式（压缩）
    -j 4 \                    # 4并行
    -v \                      # 详细输出
    -f ${BACKUP_FILE} \
    2>> ${BACKUP_DIR}/backup_error.log

# 验证备份文件
if [ $? -eq 0 ]; then
    echo "[$(date)] ✅ 全量备份成功: ${BACKUP_FILE}" >> ${BACKUP_DIR}/backup.log
    # 检查备份文件大小
    BACKUP_SIZE=$(stat -c%s "${BACKUP_FILE}")
    if [ ${BACKUP_SIZE} -lt 1024 ]; then
        echo "[$(date)] ⚠️ 备份文件异常小(${BACKUP_SIZE} bytes)!" >> ${BACKUP_DIR}/backup_error.log
    fi
else
    echo "[$(date)] ❌ 全量备份失败!" >> ${BACKUP_DIR}/backup_error.log
    exit 1
fi

# 清理过期备份
find ${BACKUP_DIR} -name "manga_translator_full_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
echo "[$(date)] 🗑️ 已清理${RETENTION_DAYS}天前的备份文件" >> ${BACKUP_DIR}/backup.log
*/

-- 2.2 逻辑全量备份（纯SQL文本，可读性好）
/*
#!/bin/bash
# 文件: /scripts/backup_logical.sh
# 执行频率: 每周日凌晨2:00

PG_HOST="localhost"
PG_PORT="5432"
PG_DB="manga_translator"
PG_USER="manga_dba"
BACKUP_DIR="/backups/logical"
RETENTION_DAYS=90

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/manga_translator_logical_${TIMESTAMP}.sql.gz"

export PGPASSWORD="Manga@DBA2025!Admin"

# 纯SQL格式（不含角色/表空间，只备份数据+结构）
pg_dump -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d ${PG_DB} \
    --inserts \               # INSERT格式（而非COPY）
    --column-inserts \         # 带列名的INSERT
    --no-owner \               # 不含所有者
    --no-privileges \          # 不含权限
    | gzip > ${BACKUP_FILE}

if [ $? -eq 0 ]; then
    echo "[$(date)] ✅ 逻辑备份成功: ${BACKUP_FILE}" >> ${BACKUP_DIR}/backup.log
else
    echo "[$(date)] ❌ 逻辑备份失败!" >> ${BACKUP_DIR}/backup_error.log
fi

find ${BACKUP_DIR} -name "manga_translator_logical_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
*/

-- ============================================================
-- 三、增量备份（WAL归档配置）
-- ============================================================

-- 3.1 PostgreSQL 配置（postgresql.conf）
/*
# WAL归档配置
wal_level = replica           # 至少 replica 级别
archive_mode = on
archive_command = 'test ! -f /backups/wal/%f && cp %p /backups/wal/%f'
archive_timeout = 300         # 5分钟强制切换WAL段
wal_keep_size = 1024          # 保留1GB WAL文件

# 用于增量备份的恢复配置
restore_command = 'cp /backups/wal/%f %p'
*/

-- 3.2 增量备份脚本
/*
#!/bin/bash
# 文件: /scripts/backup_incremental.sh
# 执行频率: 每6小时 (0,6,12,18点)

PG_DATA="/var/lib/postgresql/15/main"
BACKUP_DIR="/backups/incremental"
WAL_DIR="/backups/wal"
RETENTION_DAYS=7

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 使用 pg_basebackup 进行增量备份
pg_basebackup -h localhost -p 5432 -U manga_dba \
    -D ${BACKUP_DIR}/incr_${TIMESTAMP} \
    -F t -z -P \
    --wal-method=stream

if [ $? -eq 0 ]; then
    echo "[$(date)] ✅ 增量备份成功" >> ${BACKUP_DIR}/backup.log
else
    echo "[$(date)] ❌ 增量备份失败!" >> ${BACKUP_DIR}/backup_error.log
fi

# 清理过期增量备份和WAL
find ${BACKUP_DIR} -name "incr_*" -mtime +${RETENTION_DAYS} -exec rm -rf {} \;
find ${WAL_DIR} -name "*" -mtime +${RETENTION_DAYS} -delete
*/

-- ============================================================
-- 四、备份验证脚本
-- ============================================================

-- 4.1 备份文件完整性验证
/*
#!/bin/bash
# 文件: /scripts/verify_backup.sh
# 执行频率: 每天上午9:00

BACKUP_DIR="/backups/full"
VERIFY_DIR="/tmp/backup_verify"
PG_HOST="localhost"
PG_PORT="5433"               # 验证用独立端口
PG_USER="manga_dba"

# 获取最新的备份文件
LATEST_BACKUP=$(ls -t ${BACKUP_DIR}/manga_translator_full_*.sql.gz | head -1)

if [ -z "${LATEST_BACKUP}" ]; then
    echo "[$(date)] ❌ 未找到备份文件!" >> ${BACKUP_DIR}/verify_error.log
    exit 1
fi

echo "[$(date)] 🔍 验证备份: ${LATEST_BACKUP}" >> ${BACKUP_DIR}/verify.log

# 创建临时恢复目录
rm -rf ${VERIFY_DIR}
mkdir -p ${VERIFY_DIR}

# 尝试恢复到临时目录
pg_restore -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} \
    -d verify_db \
    -j 2 \
    --clean --if-exists \
    --no-owner --no-privileges \
    ${LATEST_BACKUP} \
    2>> ${BACKUP_DIR}/verify_error.log

if [ $? -eq 0 ]; then
    echo "[$(date)] ✅ 备份验证通过" >> ${BACKUP_DIR}/verify.log
    
    # 验证表行数
    psql -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} -d verify_db \
        -c "SELECT COUNT(*) FROM users;" \
        -c "SELECT COUNT(*) FROM projects;" \
        -c "SELECT COUNT(*) FROM pages;" \
        >> ${BACKUP_DIR}/verify.log
    
    # 清理验证数据库
    dropdb -h ${PG_HOST} -p ${PG_PORT} -U ${PG_USER} verify_db
else
    echo "[$(date)] ❌ 备份验证失败!" >> ${BACKUP_DIR}/verify_error.log
    # 发送告警
    # curl -X POST https://hooks.slack.com/services/xxx -d '{"text":"数据库备份验证失败!"}'
fi
*/

-- ============================================================
-- 五、数据恢复操作手册
-- ============================================================

-- 5.1 全量恢复（从全量备份恢复整个数据库）
/*
#!/bin/bash
# 文件: /scripts/restore_full.sh
# ⚠️ 危险操作：将覆盖当前数据库！

BACKUP_FILE=$1   # 备份文件路径

if [ -z "${BACKUP_FILE}" ]; then
    echo "用法: $0 <备份文件路径>"
    exit 1
fi

echo "⚠️ 即将从 ${BACKUP_FILE} 恢复数据库 manga_translator"
echo "⚠️ 此操作将覆盖当前所有数据！"
echo "按 Ctrl+C 取消，或等待10秒自动执行..."

sleep 10

# 断开所有连接
psql -h localhost -U manga_dba -d postgres -c "
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = 'manga_translator'
      AND pid <> pg_backend_pid();
"

# 删除旧数据库
dropdb -h localhost -U manga_dba manga_translator

# 创建新数据库
createdb -h localhost -U manga_dba -O postgres \
    --encoding=UTF8 --locale=zh_CN.utf8 \
    manga_translator

# 恢复数据
pg_restore -h localhost -U manga_dba -d manga_translator \
    -j 4 \                       # 4并行恢复
    --clean --if-exists \
    --no-owner --no-privileges \
    -v \
    ${BACKUP_FILE}

if [ $? -eq 0 ]; then
    echo "✅ 数据库恢复成功!"
    
    # 重新创建用户权限
    psql -h localhost -U manga_dba -d manga_translator \
        -f /database/ddl/03_create_users.sql
    
    echo "✅ 用户权限恢复完成!"
else
    echo "❌ 数据库恢复失败!"
    exit 1
fi
*/

-- 5.2 时间点恢复（PITR - Point-In-Time Recovery）
/*
#!/bin/bash
# 文件: /scripts/restore_pitr.sh
# 恢复到指定时间点

TARGET_TIME=$1   # 格式: "2025-07-11 14:30:00+08"

# 1. 停止PostgreSQL
pg_ctl stop

# 2. 备份当前数据目录
cp -r /var/lib/postgresql/15/main /var/lib/postgresql/15/main_backup_$(date +%Y%m%d)

# 3. 清理当前数据目录
rm -rf /var/lib/postgresql/15/main/*

# 4. 恢复基础备份
cp -r /backups/incremental/latest/* /var/lib/postgresql/15/main/

# 5. 创建 recovery.conf
cat > /var/lib/postgresql/15/main/recovery.conf << EOF
restore_command = 'cp /backups/wal/%f %p'
recovery_target_time = '${TARGET_TIME}'
recovery_target_action = 'promote'
EOF

# 6. 启动PostgreSQL（自动进入恢复模式）
pg_ctl start
*/

-- ============================================================
-- 六、备份Crontab配置
-- ============================================================

/*
# 编辑: crontab -e

# 全量备份 - 每天凌晨3:00
0 3 * * * /scripts/backup_full.sh >> /var/log/backup_cron.log 2>&1

# 增量备份 - 每6小时
0 0,6,12,18 * * * /scripts/backup_incremental.sh >> /var/log/backup_cron.log 2>&1

# 逻辑备份 - 每周日凌晨2:00
0 2 * * 0 /scripts/backup_logical.sh >> /var/log/backup_cron.log 2>&1

# 备份验证 - 每天上午9:00
0 9 * * * /scripts/verify_backup.sh >> /var/log/backup_cron.log 2>&1

# 清理过期WAL - 每小时
0 * * * * find /backups/wal -name "*" -mtime +7 -delete
*/

-- ============================================================
-- 七、备份监控SQL
-- ============================================================

-- 7.1 查看数据库大小
SELECT
    pg_database.datname AS 数据库名,
    pg_size_pretty(pg_database_size(pg_database.datname)) AS 总大小,
    pg_size_pretty(pg_database_size(pg_database.datname) -
        (SELECT COALESCE(SUM(pg_total_relation_size(relid)), 0)
         FROM pg_stat_user_tables)) AS 元数据大小
FROM pg_database
WHERE datname = 'manga_translator';

-- 7.2 查看各表大小（TOP 10）
SELECT
    tablename AS 表名,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS 总大小,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS 数据大小,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) -
                   pg_relation_size(schemaname||'.'||tablename)) AS 索引大小,
    n_live_tup AS 行数
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- 7.3 检查长时间未备份
SELECT
    setting AS data_directory,
    (SELECT MAX(modification) FROM pg_ls_dir(pg_read_file('backup.log')::text)) AS last_backup
FROM pg_settings
WHERE name = 'data_directory';
