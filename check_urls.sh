#!/bin/bash
echo "=== Pages with self-referencing URLs ==="
PGPASSWORD=manga_pass psql -h localhost -p 5433 -U manga_user -d manga_translator -t -A -c "SELECT count(*) FROM pages WHERE original_url LIKE '/api/v1/pages/%/image'" 2>/dev/null

echo "=== Pages with local storage URLs ==="
PGPASSWORD=manga_pass psql -h localhost -p 5433 -U manga_user -d manga_translator -t -A -c "SELECT count(*) FROM pages WHERE original_url LIKE '/storage/%'" 2>/dev/null

echo "=== Total pages ==="
PGPASSWORD=manga_pass psql -h localhost -p 5433 -U manga_user -d manga_translator -t -A -c "SELECT count(*) FROM pages" 2>/dev/null

echo "=== Sample self-ref pages ==="
PGPASSWORD=manga_pass psql -h localhost -p 5433 -U manga_user -d manga_translator -t -A -c "SELECT page_id, original_url FROM pages WHERE original_url LIKE '/api/v1/pages/%/image' LIMIT 3" 2>/dev/null
