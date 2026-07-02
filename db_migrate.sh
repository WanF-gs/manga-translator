#!/bin/bash
docker exec mt-postgres psql -U postgres -d manga_translator -c "ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_target_lang VARCHAR(10) DEFAULT 'zh-CN';"
echo "Done: $?"
